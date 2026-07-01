// Append-only LOG of bulk-edit runs — one immutable row per run (both the
// immediate "Start Bulk Editing" button and scheduled tasks). Powers the
// Hextom-style "Bulk edit tasks" page: Created At + schedule badge, Status,
// matched / edited counts, the filter + editing rules used, Details, Re-create.
//
// This is separate from `scheduled_tasks` (the *arming* of recurring tasks,
// one row per task, overwritten each run) — here we keep the full HISTORY, so
// a daily task that fires 30 times leaves 30 rows.
import crypto from 'crypto';
import db from '@/lib/db';

let ready;
function ensureSchema() {
  if (ready) return ready;
  ready = db.execute(`
    CREATE TABLE IF NOT EXISTS bulk_task_logs (
      id           TEXT PRIMARY KEY,
      shop         TEXT NOT NULL,
      created_at   INTEGER NOT NULL,     -- run start epoch ms
      finished_at  INTEGER,              -- run end epoch ms (NULL while running)
      trigger      TEXT NOT NULL,        -- 'manual' | 'schedule'
      recurrence   TEXT,                 -- 'once'|'daily'|'weekly' (scheduled) | NULL (manual)
      status       TEXT NOT NULL,        -- 'running' | 'finished' | 'error'
      matched      INTEGER NOT NULL DEFAULT 0,  -- images the filter matched
      edited       INTEGER NOT NULL DEFAULT 0,  -- images written back to Shopify
      config       TEXT NOT NULL,        -- JSON snapshot of the bulk config
      note         TEXT                  -- summary / error text
    )
  `);
  return ready;
}

const now = () => Date.now();

function rowToLog(r) {
  if (!r) return null;
  let config = {};
  try { config = JSON.parse(r.config || '{}'); } catch { config = {}; }
  return {
    id: r.id,
    createdAt: Number(r.created_at),
    finishedAt: r.finished_at != null ? Number(r.finished_at) : null,
    trigger: r.trigger,
    recurrence: r.recurrence || null,
    status: r.status,
    matched: Number(r.matched) || 0,
    edited: Number(r.edited) || 0,
    config,
    note: r.note || null,
  };
}

// Open a new log row when a fresh run starts. Any prior row still stuck in
// 'running' for this shop (e.g. the process died mid-run) is closed out as an
// error first, so the history never shows two live rows for one shop.
export async function logBulkStart(shop, { trigger, recurrence, config }) {
  await ensureSchema();
  const ts = now();
  await db.execute({
    sql: `UPDATE bulk_task_logs SET status='error', note=COALESCE(note,'Interrupted'), finished_at=?
          WHERE shop=? AND status='running'`,
    args: [ts, shop],
  });
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO bulk_task_logs
            (id, shop, created_at, trigger, recurrence, status, matched, edited, config)
          VALUES (?,?,?,?,?, 'running', 0, 0, ?)`,
    args: [
      id, shop, ts,
      trigger === 'schedule' ? 'schedule' : 'manual',
      recurrence || null,
      JSON.stringify(config || {}),
    ],
  });
  return id;
}

// Close out the current run's log row (the most recent 'running' row for the
// shop — there is only ever one, guarded by the in-process bulk lock). Called
// from every terminal path in runBulkEdit, including the resume path where the
// starting log id isn't in scope.
export async function logBulkFinish(shop, { status, matched, edited, note }) {
  await ensureSchema();
  await db.execute({
    sql: `UPDATE bulk_task_logs
          SET status=?, matched=?, edited=?, note=?, finished_at=?
          WHERE id = (
            SELECT id FROM bulk_task_logs WHERE shop=? AND status='running'
            ORDER BY created_at DESC LIMIT 1
          )`,
    args: [
      status === 'error' ? 'error' : 'finished',
      Number(matched) || 0,
      Number(edited) || 0,
      note ? String(note).slice(0, 300) : null,
      now(),
      shop,
    ],
  });
}

// Paginated history for the tasks page, newest first.
export async function listTaskLogs(shop, { limit = 20, offset = 0 } = {}) {
  await ensureSchema();
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const off = Math.max(Number(offset) || 0, 0);
  const [rows, count] = await Promise.all([
    db.execute({
      sql: 'SELECT * FROM bulk_task_logs WHERE shop=? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      args: [shop, lim, off],
    }),
    db.execute({ sql: 'SELECT COUNT(*) AS n FROM bulk_task_logs WHERE shop=?', args: [shop] }),
  ]);
  return {
    logs: rows.rows.map(rowToLog),
    total: Number(count.rows[0]?.n) || 0,
    limit: lim,
    offset: off,
  };
}

// GDPR uninstall / redact — drop this shop's entire run history.
export async function deleteTaskLogsForShop(shop) {
  await ensureSchema();
  await db.execute({ sql: 'DELETE FROM bulk_task_logs WHERE shop=?', args: [shop] });
}
