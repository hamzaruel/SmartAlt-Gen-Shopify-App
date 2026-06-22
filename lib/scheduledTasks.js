// Scheduled bulk-edit tasks, persisted in Turso so they run with NO merchant tab
// open. Each task carries the full bulk-edit config (which images, how to edit)
// plus its recurrence. The scheduler (instrumentation.js) polls getDueTasks().
//
// Timezone note: the FIRST next_run_at is computed in the BROWSER (which knows the
// merchant's local tz) and sent up as an absolute epoch (ms). The server only ever
// ADDS a fixed interval (1 day / 1 week) for recurring runs, so it needs no tz math.
import crypto from 'crypto';
import db from '@/lib/db';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

let ready;
function ensureSchema() {
  if (ready) return ready;
  ready = db.execute(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id           TEXT PRIMARY KEY,
      shop         TEXT NOT NULL,
      sources      TEXT NOT NULL,        -- JSON array: ['product','file',...]
      mode         TEXT NOT NULL,        -- 'ai' | 'ai_custom' | 'title' | 'template'
      template     TEXT,                 -- template string (mode='template')
      scope        TEXT NOT NULL,        -- 'missing' | 'all'
      skip_existing INTEGER NOT NULL DEFAULT 0,
      info_fields  TEXT,                 -- JSON array (mode='ai_custom')
      instructions TEXT,                 -- extra AI instructions (+ language prefix)
      recurrence   TEXT NOT NULL,        -- 'once' | 'daily' | 'weekly'
      time_label   TEXT,                 -- 'HH:MM' (display only)
      next_run_at  INTEGER NOT NULL,     -- epoch ms of the next run
      status       TEXT NOT NULL,        -- 'scheduled' | 'running' | 'done' | 'error'
      last_run_at  INTEGER,
      last_summary TEXT,                 -- JSON: { processed, applied, errors, note }
      created_at   INTEGER NOT NULL
    )
  `);
  return ready;
}

const now = () => Date.now();

function rowToTask(r) {
  if (!r) return null;
  const parse = (v, fb) => { try { return JSON.parse(v); } catch { return fb; } };
  return {
    id: r.id,
    shop: r.shop,
    sources: parse(r.sources, []),
    mode: r.mode,
    template: r.template || '',
    scope: r.scope,
    skipExisting: !!Number(r.skip_existing),
    infoFields: parse(r.info_fields, []),
    instructions: r.instructions || '',
    recurrence: r.recurrence,
    timeLabel: r.time_label || '',
    nextRunAt: Number(r.next_run_at),
    status: r.status,
    lastRunAt: r.last_run_at != null ? Number(r.last_run_at) : null,
    lastSummary: parse(r.last_summary, null),
    createdAt: Number(r.created_at),
  };
}

// Create a task. `config.nextRunAt` is an absolute epoch (ms) the client computed
// from the merchant's local time + chosen day; the server stores it verbatim.
export async function createTask(shop, config) {
  await ensureSchema();
  const id = crypto.randomUUID();
  await db.execute({
    sql: `
      INSERT INTO scheduled_tasks
        (id, shop, sources, mode, template, scope, skip_existing, info_fields,
         instructions, recurrence, time_label, next_run_at, status, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'scheduled', ?)
    `,
    args: [
      id, shop,
      JSON.stringify(config.sources || []),
      config.mode,
      config.template || '',
      config.scope === 'all' ? 'all' : 'missing',
      config.skipExisting ? 1 : 0,
      JSON.stringify(config.infoFields || []),
      (config.instructions || '').toString().slice(0, 400),
      config.recurrence,
      config.timeLabel || '',
      Number(config.nextRunAt),
      now(),
    ],
  });
  return getTask(id);
}

export async function listTasks(shop) {
  await ensureSchema();
  const r = await db.execute({
    sql: 'SELECT * FROM scheduled_tasks WHERE shop = ? ORDER BY created_at DESC',
    args: [shop],
  });
  return r.rows.map(rowToTask);
}

export async function getTask(id) {
  await ensureSchema();
  const r = await db.execute({ sql: 'SELECT * FROM scheduled_tasks WHERE id = ?', args: [id] });
  return rowToTask(r.rows[0]);
}

export async function deleteTask(shop, id) {
  await ensureSchema();
  await db.execute({ sql: 'DELETE FROM scheduled_tasks WHERE id = ? AND shop = ?', args: [id, shop] });
}

// Tasks that are due to run now (and not already running). Across all shops.
export async function getDueTasks(at = now()) {
  await ensureSchema();
  const r = await db.execute({
    sql: "SELECT * FROM scheduled_tasks WHERE status = 'scheduled' AND next_run_at <= ? ORDER BY next_run_at",
    args: [at],
  });
  return r.rows.map(rowToTask);
}

export async function markRunning(id) {
  await ensureSchema();
  // Only flip a still-'scheduled' row → guards against two ticks grabbing the same task.
  const r = await db.execute({
    sql: "UPDATE scheduled_tasks SET status='running' WHERE id = ? AND status='scheduled'",
    args: [id],
  });
  return r.rowsAffected > 0;
}

// Record the outcome of a run. 'once' tasks finish; recurring tasks advance their
// next_run_at by one interval (catching up past any missed windows) and re-arm.
export async function finishRun(task, summary) {
  await ensureSchema();
  const ts = now();
  let status = 'done';
  let nextRunAt = task.nextRunAt;
  if (task.recurrence === 'daily' || task.recurrence === 'weekly') {
    const step = task.recurrence === 'weekly' ? WEEK_MS : DAY_MS;
    nextRunAt = task.nextRunAt + step;
    while (nextRunAt <= ts) nextRunAt += step; // skip windows missed while down
    status = 'scheduled';
  }
  await db.execute({
    sql: `UPDATE scheduled_tasks
          SET status=?, next_run_at=?, last_run_at=?, last_summary=? WHERE id=?`,
    args: [status, nextRunAt, ts, JSON.stringify(summary || null), task.id],
  });
}

// Re-arm a task that errored hard (so a transient failure doesn't strand it).
export async function markError(id, message) {
  await ensureSchema();
  await db.execute({
    sql: `UPDATE scheduled_tasks SET status='error', last_run_at=?, last_summary=? WHERE id=?`,
    args: [now(), JSON.stringify({ error: String(message || 'failed').slice(0, 200) }), id],
  });
}

// Delete every task for a shop (GDPR uninstall / redact).
export async function deleteTasksForShop(shop) {
  await ensureSchema();
  await db.execute({ sql: 'DELETE FROM scheduled_tasks WHERE shop = ?', args: [shop] });
}
