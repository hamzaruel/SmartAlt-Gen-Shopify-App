// Background AI-generation jobs. The generation runs SERVER-SIDE in the
// long-running Node process (PM2), decoupled from the merchant's tab — so it
// keeps going after a refresh or tab close. Progress + results live in Turso, so
// the client reconnects by polling, and a server restart resumes from where it
// left off (already-generated images are skipped).
import db, { getAccessToken } from '@/lib/db';
import { generateWithGemini } from '@/lib/altText';
import { incrementAiUsage, getUsage } from '@/lib/billing/usage';
import { settleOverflow } from '@/lib/billing/meter';
import { getPlan } from '@/lib/billing/plans';

let ready;
async function ensureSchema() {
  if (ready) return ready;
  ready = (async () => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS generation_jobs (
        shop TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        total INTEGER NOT NULL DEFAULT 0,
        done INTEGER NOT NULL DEFAULT 0,
        plan_id TEXT, ai_budget INTEGER, cycle_key TEXT,
        mode TEXT, instructions TEXT, info_fields TEXT,
        queue TEXT,
        error TEXT,
        updated_at INTEGER NOT NULL
      )
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS generation_results (
        shop TEXT NOT NULL,
        image_key TEXT NOT NULL,
        alt TEXT NOT NULL,
        seq INTEGER NOT NULL,
        PRIMARY KEY (shop, image_key)
      )
    `);
  })();
  return ready;
}

const now = () => Date.now();

function buildContext(mode, infoFields, item) {
  if (mode !== 'ai_custom') return '';
  const bits = [];
  if (infoFields.includes('title') && item.title) bits.push(`Title: ${item.title}`);
  if (infoFields.includes('type') && item.type) bits.push(`Type: ${item.type}`);
  if (infoFields.includes('vendor') && item.vendor) bits.push(`Vendor: ${item.vendor}`);
  return bits.join('; ');
}

export async function getJob(shop) {
  await ensureSchema();
  const r = await db.execute({ sql: 'SELECT * FROM generation_jobs WHERE shop = ?', args: [shop] });
  return r.rows[0] || null;
}

export async function getResultsSince(shop, sinceSeq) {
  await ensureSchema();
  const r = await db.execute({
    sql: 'SELECT image_key, alt, seq FROM generation_results WHERE shop = ? AND seq > ? ORDER BY seq',
    args: [shop, Number(sinceSeq) || 0],
  });
  return r.rows.map((row) => ({ key: row.image_key, alt: row.alt, seq: Number(row.seq) }));
}

export async function cancelJob(shop) {
  await ensureSchema();
  await db.execute({
    sql: "UPDATE generation_jobs SET status='cancelled', updated_at=? WHERE shop=?",
    args: [now(), shop],
  });
}

// Create (or replace) a job for the shop and seed its queue. Each item gets a
// stable seq (1-based) so the client can fetch results incrementally.
export async function startJob(shop, { items, mode, instructions, infoFields, planId, aiBudget, cycleKey }) {
  await ensureSchema();
  const seeded = items.map((it, i) => ({ ...it, seq: i + 1 }));
  await db.execute({ sql: 'DELETE FROM generation_results WHERE shop = ?', args: [shop] });
  await db.execute({
    sql: `
      INSERT INTO generation_jobs
        (shop, status, total, done, plan_id, ai_budget, cycle_key, mode, instructions, info_fields, queue, error, updated_at)
      VALUES (?, 'running', ?, 0, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(shop) DO UPDATE SET
        status='running', total=excluded.total, done=0, plan_id=excluded.plan_id,
        ai_budget=excluded.ai_budget, cycle_key=excluded.cycle_key, mode=excluded.mode,
        instructions=excluded.instructions, info_fields=excluded.info_fields,
        queue=excluded.queue, error=NULL, updated_at=excluded.updated_at
    `,
    args: [
      shop, seeded.length, planId, aiBudget, cycleKey, mode,
      instructions || '', JSON.stringify(infoFields || []), JSON.stringify(seeded), now(),
    ],
  });
}

// In-process guard so a shop's job runs once per instance (start + status-resume
// both call runJob; this dedupes them).
const active = new Set();

// The worker. Resumable: skips items already in generation_results, respects the
// plan budget, meters usage, settles Compliance overflow, and heartbeats so a
// stale (crashed/restarted) job can be resumed by a status poll.
export async function runJob(shop) {
  if (active.has(shop)) return;
  active.add(shop);
  try {
    await ensureSchema();
    let job = await getJob(shop);
    if (!job || job.status !== 'running') return;

    const plan = getPlan(job.plan_id);
    const cycleKey = job.cycle_key;
    const aiBudget = Number(job.ai_budget) || 0;
    const mode = job.mode;
    const instructions = job.instructions || '';
    let infoFields = [];
    let queue = [];
    try { infoFields = JSON.parse(job.info_fields || '[]'); } catch { /* ignore */ }
    try { queue = JSON.parse(job.queue || '[]'); } catch { /* ignore */ }

    const doneRows = await db.execute({ sql: 'SELECT image_key FROM generation_results WHERE shop = ?', args: [shop] });
    const doneKeys = new Set(doneRows.rows.map((r) => r.image_key));
    let doneCount = doneKeys.size;
    const remaining = queue.filter((it) => !doneKeys.has(it.key));

    const CHUNK = 3;
    let geminiErr = null;

    for (let i = 0; i < remaining.length; i += CHUNK) {
      if (doneCount >= aiBudget) break; // plan budget reached

      const fresh = await getJob(shop);
      if (!fresh || fresh.status !== 'running') return; // cancelled / replaced

      const room = aiBudget - doneCount;
      const batch = remaining.slice(i, i + CHUNK).slice(0, Math.max(0, room));
      const out = await Promise.all(batch.map(async (it) => {
        try {
          const alt = await generateWithGemini(it.url, buildContext(mode, infoFields, it), instructions);
          return { key: it.key, seq: it.seq || 0, alt };
        } catch (e) {
          const msg = e.message || 'failed';
          if (/\b429\b|quota|rate.?limit/i.test(msg)) { geminiErr = msg; return null; }
          console.error('bg generate error:', msg);
          return null;
        }
      }));

      let made = 0;
      for (const r of out) {
        if (!r) continue;
        await db.execute({
          sql: `INSERT INTO generation_results (shop, image_key, alt, seq) VALUES (?,?,?,?)
                ON CONFLICT(shop, image_key) DO UPDATE SET alt=excluded.alt`,
          args: [shop, r.key, r.alt, r.seq],
        });
        doneCount += 1;
        made += 1;
      }
      if (made) await incrementAiUsage(shop, cycleKey, made);
      await db.execute({ sql: 'UPDATE generation_jobs SET done=?, updated_at=? WHERE shop=?', args: [doneCount, now(), shop] });

      if (geminiErr) break; // AI busy / out of credits → stop; keep what we have
    }

    // Settle Compliance overflow once, best-effort (uses the stored token).
    if (plan.overflow) {
      try {
        const token = await getAccessToken(shop);
        const { aiCount } = await getUsage(shop, cycleKey);
        if (token) await settleOverflow(shop, token, plan, cycleKey, aiCount);
      } catch (e) {
        console.error('overflow settle (bg) failed:', e.message);
      }
    }

    const finalJob = await getJob(shop);
    if (finalJob && finalJob.status === 'running') {
      const status = geminiErr ? 'error' : 'done';
      const error = geminiErr
        ? 'AI is busy or out of credits. Already-generated alt text is saved — try again later.'
        : null;
      await db.execute({ sql: 'UPDATE generation_jobs SET status=?, error=?, updated_at=? WHERE shop=?', args: [status, error, now(), shop] });
    }
  } catch (e) {
    console.error('runJob fatal:', e);
    try {
      await db.execute({ sql: "UPDATE generation_jobs SET status='error', error=?, updated_at=? WHERE shop=?", args: [String(e?.message || e).slice(0, 200), now(), shop] });
    } catch { /* ignore */ }
  } finally {
    active.delete(shop);
  }
}
