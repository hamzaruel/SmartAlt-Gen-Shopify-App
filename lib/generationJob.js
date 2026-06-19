// Background AI-generation jobs — PER-IMAGE RETRY QUEUE.
//
// Generation runs SERVER-SIDE in the long-running Node process (PM2), decoupled
// from the merchant's tab, so it keeps going after a refresh / tab close. The
// authoritative state is ONE ROW PER IMAGE in `generation_queue`:
//
//   status: pending → processing → done | failed
//
// Invariant: a job is only "done" when EVERY image is terminal (done or
// permanently failed). No image is ever silently skipped.
//
// Failure handling:
//   • Per-image faults (dead URL, decode/parse, content block) consume an
//     attempt; after MAX_ATTEMPTS they become permanently `failed`.
//   • Service faults (Gemini 429 / 503 / overloaded / rate-limit) do NOT consume
//     an attempt — they pause the whole job and auto-resume (see scheduler sweep).
//   • Plan-quota exhaustion (our own meter) is a clean, surfaced pause that
//     auto-resumes when the billing cycle resets.
//
// Crash safety:
//   • The CLAIM (pending → processing, guarded by rowsAffected===1) is the
//     concurrency gate — only one worker ever owns a row.
//   • "done" + the usage increment commit in ONE db.batch transaction, so a
//     crash can never double-count billing.
//   • Stranded `processing` rows (older than PROCESSING_STALE_MS) are reclaimed
//     on (re)entry — but only the genuinely-stale ones, never an in-flight row.
import db, { getAccessToken, getOfflineToken } from '@/lib/db';
import { generateWithGemini } from '@/lib/altText';
import {
  incrementAiUsage,
  getUsage,
  getEntitlement,
  ensureUsageSchema,
  usageIncrStatement,
} from '@/lib/billing/usage';
import { settleOverflow } from '@/lib/billing/meter';
import { getPlan } from '@/lib/billing/plans';

const now = () => Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Tunables (confirmed against the v2 plan) ------------------------------
const CHUNK = 3;                       // images generated in parallel per round
const MAX_ATTEMPTS = 3;                // per-image attempts before permanent fail
const PROCESSING_STALE_MS = 240000;    // 4 min — safe margin over worst-case 5-model fallback latency
const IMAGE_BACKOFF_MS = [5000, 30000];          // after attempt 1 / attempt 2
const SERVICE_DELAYS_MS = [5 * 60000, 15 * 60000, 30 * 60000]; // escalating, capped

// Service-level failures (the AI provider, not the image) — don't burn attempts.
function isServiceError(msg) {
  return /\b429\b|\b503\b|quota|rate.?limit|overload|unavailable|high demand|temporarily|try again/i.test(msg || '');
}

// Parse the billing cycle key (Shopify currentPeriodEnd ISO string) → epoch ms,
// i.e. when the merchant's monthly AI quota resets. Returns null for 'free'/'bypass'.
function cycleResetAt(cycleKey) {
  const t = Date.parse(cycleKey || '');
  return Number.isNaN(t) ? null : t;
}

let ready;
async function ensureSchema() {
  if (ready) return ready;
  ready = (async () => {
    await ensureUsageSchema();
    // Control row, one per shop.
    await db.execute(`
      CREATE TABLE IF NOT EXISTS generation_jobs (
        shop TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        total INTEGER NOT NULL DEFAULT 0,
        done INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        plan_id TEXT, ai_budget INTEGER, cycle_key TEXT,
        mode TEXT, instructions TEXT, info_fields TEXT,
        error TEXT,
        resume_at INTEGER NOT NULL DEFAULT 0,
        service_pauses INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )
    `);
    // Migrate older installs (table predates the new columns / had a `queue` blob).
    for (const ddl of [
      'ALTER TABLE generation_jobs ADD COLUMN failed INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE generation_jobs ADD COLUMN resume_at INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE generation_jobs ADD COLUMN service_pauses INTEGER NOT NULL DEFAULT 0',
    ]) {
      try { await db.execute(ddl); } catch { /* column already exists */ }
    }
    // One row per image — the authoritative queue.
    await db.execute(`
      CREATE TABLE IF NOT EXISTS generation_queue (
        shop TEXT NOT NULL,
        image_key TEXT NOT NULL,
        seq INTEGER NOT NULL,
        source TEXT,
        url TEXT NOT NULL,
        title TEXT, type TEXT, vendor TEXT, position INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        alt TEXT,
        last_error TEXT,
        batch_id TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (shop, image_key)
      )
    `);
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_genq_shop_status ON generation_queue (shop, status, next_attempt_at)',
    );
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_genq_shop_seq ON generation_queue (shop, seq)',
    );
  })();
  return ready;
}

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

async function counts(shop) {
  const r = await db.execute({
    sql: `SELECT
            SUM(status='pending')    AS pending,
            SUM(status='processing') AS processing,
            SUM(status='done')       AS done,
            SUM(status='failed')     AS failed
          FROM generation_queue WHERE shop = ?`,
    args: [shop],
  });
  const row = r.rows[0] || {};
  return {
    pending: Number(row.pending || 0),
    processing: Number(row.processing || 0),
    done: Number(row.done || 0),
    failed: Number(row.failed || 0),
  };
}

// Results the client hasn't seen yet (only completed rows carry an alt).
export async function getResultsSince(shop, sinceSeq) {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT image_key, alt, seq FROM generation_queue
          WHERE shop = ? AND status = 'done' AND seq > ? ORDER BY seq`,
    args: [shop, Number(sinceSeq) || 0],
  });
  return r.rows.map((row) => ({ key: row.image_key, alt: row.alt, seq: Number(row.seq) }));
}

export async function cancelJob(shop) {
  await ensureSchema();
  await db.execute({
    sql: "UPDATE generation_jobs SET status='cancelled', resume_at=0, updated_at=? WHERE shop=?",
    args: [now(), shop],
  });
}

// Create (or replace) a job and seed the queue, one row per image. Stale non-done
// rows from a prior job are cleared; rows already `done` are KEPT (their alt and
// attempts preserved) so re-running never regenerates or re-bills a finished image.
export async function startJob(shop, { items, mode, instructions, infoFields, planId, aiBudget, cycleKey }) {
  await ensureSchema();
  const ts = now();

  // Drop everything that isn't already done — fresh start for this job's work.
  await db.execute({ sql: "DELETE FROM generation_queue WHERE shop = ? AND status <> 'done'", args: [shop] });

  // Seed in batched transactions so 100k+ rows don't choke a single statement.
  const SEED_BATCH = 200;
  for (let i = 0; i < items.length; i += SEED_BATCH) {
    const slice = items.slice(i, i + SEED_BATCH);
    const stmts = slice.map((it, j) => ({
      sql: `INSERT INTO generation_queue
              (shop, image_key, seq, source, url, title, type, vendor, position,
               status, attempts, next_attempt_at, alt, last_error, batch_id, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?, 'pending', 0, 0, NULL, NULL, NULL, ?)
            ON CONFLICT(shop, image_key) DO UPDATE SET
              seq=excluded.seq, source=excluded.source, url=excluded.url,
              title=excluded.title, type=excluded.type, vendor=excluded.vendor, position=excluded.position,
              status = CASE WHEN generation_queue.status='done' THEN 'done' ELSE 'pending' END,
              attempts = CASE WHEN generation_queue.status='done' THEN generation_queue.attempts ELSE 0 END,
              next_attempt_at = CASE WHEN generation_queue.status='done' THEN generation_queue.next_attempt_at ELSE 0 END,
              last_error=NULL, updated_at=excluded.updated_at`,
      args: [
        shop, it.key, i + j + 1, it.source || null, it.url,
        it.title ?? null, it.type ?? null, it.vendor ?? null, it.position ?? null, ts,
      ],
    }));
    await db.batch(stmts, 'write');
  }

  // Already-done rows count toward progress immediately.
  const { done } = await counts(shop);
  await db.execute({
    sql: `INSERT INTO generation_jobs
            (shop, status, total, done, failed, plan_id, ai_budget, cycle_key,
             mode, instructions, info_fields, error, resume_at, service_pauses, updated_at)
          VALUES (?, 'running', ?, ?, 0, ?, ?, ?, ?, ?, ?, NULL, 0, 0, ?)
          ON CONFLICT(shop) DO UPDATE SET
            status='running', total=excluded.total, done=excluded.done, failed=0,
            plan_id=excluded.plan_id, ai_budget=excluded.ai_budget, cycle_key=excluded.cycle_key,
            mode=excluded.mode, instructions=excluded.instructions, info_fields=excluded.info_fields,
            error=NULL, resume_at=0, service_pauses=0, updated_at=excluded.updated_at`,
    args: [
      shop, items.length, Math.min(done, items.length), planId, aiBudget, cycleKey,
      mode, instructions || '', JSON.stringify(infoFields || []), ts,
    ],
  });
}

// Re-queue every permanently-failed image for another pass (the "Retry failed"
// action). attempts reset to 0; the job goes back to running.
export async function retryFailed(shop) {
  await ensureSchema();
  const ts = now();
  await db.execute({
    sql: `UPDATE generation_queue SET status='pending', attempts=0, next_attempt_at=0, last_error=NULL, updated_at=?
          WHERE shop=? AND status='failed'`,
    args: [ts, shop],
  });
  await db.execute({
    sql: "UPDATE generation_jobs SET status='running', failed=0, error=NULL, resume_at=0, updated_at=? WHERE shop=?",
    args: [ts, shop],
  });
}

// Claim up to `limit` eligible pending rows (pending + cooldown elapsed). The
// guarded UPDATE (status='pending' precondition) is the real concurrency gate:
// only the worker whose update reports rowsAffected===1 owns that row.
async function claimChunk(shop, limit) {
  if (limit <= 0) return [];
  const sel = await db.execute({
    sql: `SELECT image_key, seq, source, url, title, type, vendor, position, attempts
          FROM generation_queue
          WHERE shop=? AND status='pending' AND next_attempt_at<=?
          ORDER BY seq LIMIT ?`,
    args: [shop, now(), limit],
  });
  const claimed = [];
  for (const row of sel.rows) {
    const res = await db.execute({
      sql: `UPDATE generation_queue SET status='processing', updated_at=?
            WHERE shop=? AND image_key=? AND status='pending'`,
      args: [now(), shop, row.image_key],
    });
    if (Number(res.rowsAffected) === 1) claimed.push(row);
  }
  return claimed;
}

async function earliestPendingAt(shop) {
  const r = await db.execute({
    sql: "SELECT MIN(next_attempt_at) AS m FROM generation_queue WHERE shop=? AND status='pending'",
    args: [shop],
  });
  const m = r.rows[0]?.m;
  return m == null ? null : Number(m);
}

// In-process guard so a shop's job runs once per instance.
const active = new Set();

export async function runJob(shop) {
  if (active.has(shop)) return;
  active.add(shop);
  try {
    await ensureSchema();
    let job = await getJob(shop);
    if (!job || job.status !== 'running') return;

    const cycleKey = job.cycle_key;
    const aiBudget = Number(job.ai_budget) || 0;
    const mode = job.mode;
    const instructions = job.instructions || '';
    let infoFields = [];
    try { infoFields = JSON.parse(job.info_fields || '[]'); } catch { /* ignore */ }

    // Crash recovery: reclaim only GENUINELY stranded rows (in-flight ones are left alone).
    await db.execute({
      sql: `UPDATE generation_queue SET status='pending', updated_at=?
            WHERE shop=? AND status='processing' AND updated_at < ?`,
      args: [now(), shop, now() - PROCESSING_STALE_MS],
    });

    let doneCount = Number(job.done) || 0;
    let failedCount = Number(job.failed) || 0;

    while (true) {
      const fresh = await getJob(shop);
      if (!fresh || fresh.status !== 'running') return; // cancelled / replaced / paused elsewhere

      // Plan budget reached → surfaced quota pause (not a silent skip).
      if (doneCount >= aiBudget) {
        const { pending, processing } = await counts(shop);
        if (pending + processing > 0) { await pausePlanQuota(shop, cycleKey); return; }
        break; // budget covered everything
      }

      const room = aiBudget - doneCount;
      const batch = await claimChunk(shop, Math.min(CHUNK, room));

      if (batch.length === 0) {
        const nextAt = await earliestPendingAt(shop);
        if (nextAt == null) break; // nothing pending anywhere → finished
        const wait = Math.max(0, nextAt - now());
        await sleep(Math.min(wait || 1000, 30000));
        continue;
      }

      // Generate the chunk in parallel; capture per-image outcome.
      const results = await Promise.all(batch.map(async (row) => {
        try {
          const alt = await generateWithGemini(row.url, buildContext(mode, infoFields, row), instructions);
          return { row, ok: true, alt };
        } catch (e) {
          return { row, ok: false, error: e?.message || 'failed' };
        }
      }));

      const successes = results.filter((r) => r.ok);
      const serviceFails = results.filter((r) => !r.ok && isServiceError(r.error));
      const imageFails = results.filter((r) => !r.ok && !isServiceError(r.error));
      const ts = now();

      // (1) Commit successes atomically: row→done + job.done++ + usage increment.
      if (successes.length) {
        const stmts = successes.map((r) => ({
          sql: `UPDATE generation_queue SET status='done', alt=?, attempts=attempts+1, last_error=NULL, updated_at=?
                WHERE shop=? AND image_key=?`,
          args: [r.alt, ts, shop, r.row.image_key],
        }));
        stmts.push({
          sql: 'UPDATE generation_jobs SET done=done+?, updated_at=? WHERE shop=?',
          args: [successes.length, ts, shop],
        });
        stmts.push(usageIncrStatement(shop, cycleKey, successes.length));
        await db.batch(stmts, 'write');
        doneCount += successes.length;
      }

      // (2) Per-image faults: consume an attempt; retry-with-backoff or permanently fail.
      for (const r of imageFails) {
        const attempts = Number(r.row.attempts || 0) + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await db.batch([
            {
              sql: `UPDATE generation_queue SET status='failed', attempts=?, last_error=?, updated_at=?
                    WHERE shop=? AND image_key=?`,
              args: [attempts, String(r.error).slice(0, 300), ts, shop, r.row.image_key],
            },
            { sql: 'UPDATE generation_jobs SET failed=failed+1, updated_at=? WHERE shop=?', args: [ts, shop] },
          ], 'write');
          failedCount += 1;
        } else {
          const backoff = IMAGE_BACKOFF_MS[Math.min(attempts - 1, IMAGE_BACKOFF_MS.length - 1)];
          await db.execute({
            sql: `UPDATE generation_queue SET status='pending', attempts=?, next_attempt_at=?, last_error=?, updated_at=?
                  WHERE shop=? AND image_key=?`,
            args: [attempts, ts + backoff, String(r.error).slice(0, 300), ts, shop, r.row.image_key],
          });
        }
      }

      // (3) Service faults: NO attempt consumed. Return rows to pending and pause the job.
      if (serviceFails.length) {
        for (const r of serviceFails) {
          await db.execute({
            sql: `UPDATE generation_queue SET status='pending', next_attempt_at=0, last_error=?, updated_at=?
                  WHERE shop=? AND image_key=?`,
            args: [String(r.error).slice(0, 300), ts, shop, r.row.image_key],
          });
        }
        await pauseService(shop, serviceFails[0].error);
        return;
      }
    }

    // Settle Compliance overflow once (best-effort), then mark done.
    await settleOverflowBestEffort(shop, cycleKey);
    const finalJob = await getJob(shop);
    if (finalJob && finalJob.status === 'running') {
      await db.execute({
        sql: "UPDATE generation_jobs SET status='done', error=?, resume_at=0, updated_at=? WHERE shop=?",
        args: [failedCount ? `${failedCount} image(s) could not be generated after ${MAX_ATTEMPTS} tries.` : null, now(), shop],
      });
    }
  } catch (e) {
    console.error('runJob fatal:', e);
    try {
      await db.execute({
        sql: "UPDATE generation_jobs SET status='error', error=?, updated_at=? WHERE shop=?",
        args: [String(e?.message || e).slice(0, 200), now(), shop],
      });
    } catch { /* ignore */ }
  } finally {
    active.delete(shop);
  }
}

async function settleOverflowBestEffort(shop, cycleKey) {
  try {
    const job = await getJob(shop);
    const plan = getPlan(job?.plan_id);
    if (!plan.overflow) return;
    const token = await getAccessToken(shop);
    const { aiCount } = await getUsage(shop, cycleKey);
    if (token) await settleOverflow(shop, token, plan, cycleKey, aiCount);
  } catch (e) {
    console.error('overflow settle (bg) failed:', e.message);
  }
}

// Pause: Gemini-side service outage. Escalating short retry (5 → 15 → 30 min).
async function pauseService(shop, errMsg) {
  const job = await getJob(shop);
  const pauses = (Number(job?.service_pauses) || 0) + 1;
  const delay = SERVICE_DELAYS_MS[Math.min(pauses - 1, SERVICE_DELAYS_MS.length - 1)];
  await db.execute({
    sql: `UPDATE generation_jobs SET status='paused_service', resume_at=?, service_pauses=?, error=?, updated_at=? WHERE shop=?`,
    args: [now() + delay, pauses, 'AI service is busy — auto-retrying shortly.', now(), shop],
  });
}

// Pause: merchant's monthly plan quota is exhausted. Auto-resumes when the
// billing cycle resets (currentPeriodEnd); for Free / non-dated cycles there is
// no auto-resume — the merchant upgrades to continue.
async function pausePlanQuota(shop, cycleKey) {
  const resetAt = cycleResetAt(cycleKey);
  await db.execute({
    sql: `UPDATE generation_jobs SET status='paused_quota', resume_at=?, error=?, updated_at=? WHERE shop=?`,
    args: [
      resetAt || 0,
      resetAt
        ? 'Monthly AI image limit reached — resumes automatically next billing cycle.'
        : 'Monthly AI image limit reached. Upgrade your plan to generate the rest.',
      now(), shop,
    ],
  });
}

// ---- Scheduler hooks -------------------------------------------------------

// Resume paused jobs whose resume_at has arrived. Service pauses just continue;
// quota pauses refresh the entitlement first (fresh cycle → fresh budget/cycleKey),
// so the resumed run counts against the NEW cycle and respects the new quota.
export async function sweepResumableJobs() {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT shop, status FROM generation_jobs
          WHERE status IN ('paused_quota','paused_service') AND resume_at > 0 AND resume_at <= ?`,
    args: [now()],
  });
  for (const row of r.rows) {
    const shop = row.shop;
    try {
      if (row.status === 'paused_quota') {
        const token = await getOfflineToken(shop);
        if (!token) continue; // can't refresh entitlement without a token; try next sweep
        const ent = await getEntitlement(shop, token);
        if (!ent.plan.ai || !ent.active || ent.remaining <= 0) continue; // still capped
        const { done } = await counts(shop);
        await db.execute({
          sql: `UPDATE generation_jobs SET status='running', resume_at=0,
                  plan_id=?, cycle_key=?, ai_budget=?, error=NULL, updated_at=? WHERE shop=?`,
          args: [ent.planId, ent.cycleKey, done + ent.remaining, now(), shop],
        });
      } else {
        await db.execute({
          sql: "UPDATE generation_jobs SET status='running', resume_at=0, error=NULL, updated_at=? WHERE shop=?",
          args: [now(), shop],
        });
      }
      runJob(shop); // fire-and-forget in this process
    } catch (e) {
      console.error('sweepResumableJobs error for', shop, e?.message || e);
    }
  }
}

// TTL cleanup so the queue doesn't grow unbounded across many shops. Terminal
// rows (done/failed) older than the TTL are dropped; failed rows are kept until
// then so the merchant's "Retry failed" has something to act on.
const QUEUE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export async function cleanupQueue() {
  await ensureSchema();
  try {
    await db.execute({
      sql: `DELETE FROM generation_queue
            WHERE status IN ('done','failed') AND updated_at < ?`,
      args: [now() - QUEUE_TTL_MS],
    });
  } catch (e) {
    console.error('cleanupQueue error:', e.message);
  }
}

// Delete specific queue rows once their alt has been applied to Shopify (keeps
// the table lean; called from /api/apply).
export async function dropAppliedRows(shop, keys) {
  if (!Array.isArray(keys) || !keys.length) return;
  await ensureSchema();
  try {
    const ph = keys.map(() => '?').join(',');
    await db.execute({
      sql: `DELETE FROM generation_queue WHERE shop=? AND image_key IN (${ph})`,
      args: [shop, ...keys],
    });
  } catch (e) {
    console.error('dropAppliedRows error:', e.message);
  }
}
