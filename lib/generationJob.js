// Background AI-generation engine — PER-IMAGE RETRY QUEUE, shared by BOTH the
// manual "Generate" flow (kind='manual') and the bulk-edit / scheduler flow
// (kind='bulk'). State is ONE ROW PER IMAGE in `generation_queue`, keyed by
// (shop, kind, image_key):
//
//   status: pending → processing → done | failed
//
// Invariant: a job is only "complete" when EVERY image is terminal (done or
// permanently failed). No image is ever silently skipped.
//
// Failure handling:
//   • Image faults (dead URL, decode/parse, content block) consume an attempt;
//     after MAX_ATTEMPTS they become permanently `failed`.
//   • Service faults (Gemini 429 / 503 / overloaded) do NOT consume an attempt —
//     they pause the job and auto-resume (scheduler sweep).
//   • Plan-quota exhaustion (our meter) is a surfaced pause that auto-resumes at
//     the next billing cycle.
//
// Crash safety:
//   • The CLAIM (pending → processing, guarded by rowsAffected===1) is the
//     concurrency gate — only one worker ever owns a row.
//   • "done" + the usage increment commit in ONE db.batch transaction.
//   • Stranded `processing` rows older than PROCESSING_STALE_MS are reclaimed on
//     (re)entry — only the genuinely-stale ones.
//
// kind-awareness: the generation LOOP (`runGenerationLoop`) is shared. The manual
// wrapper (`runJob`) finalizes a completed manual job to 'done'; the bulk
// orchestrator (lib/bulkRun.js) drives scanning/applying around the same loop.
import db, { getAccessToken } from '@/lib/db';
import { getValidOfflineToken } from '@/lib/offlineToken';
import { generateWithGemini } from '@/lib/altText';
import {
  getUsage,
  getEntitlement,
  ensureUsageSchema,
  usageIncrStatement,
} from '@/lib/billing/usage';
import { settleOverflow } from '@/lib/billing/meter';
import { getPlan } from '@/lib/billing/plans';

const now = () => Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Tunables --------------------------------------------------------------
// ALTGEN_TEST_HOOK shrinks the timers so the verifier runs in seconds; no effect
// in production (the flag is never set there).
const TEST = process.env.ALTGEN_TEST_HOOK === '1';
// Concurrent images in flight per (shop, kind) worker — the real-time throughput
// knob. Raised 3 → 10: Tier-1 Gemini has thousands of RPM of headroom, so 3 left
// most of it idle. Step up to 15/20 ONLY after watching the VPS (RAM/CPU) and
// Gemini 429 pauses on a real run — on Tier 1 the box taps out before the API.
// Keep ≤ ~15: a fallback cascade onto gemini-2.5-pro (lower Tier-1 RPM) must not
// be able to instantly flood Pro's limit. Big backfills go to Batch Mode (Phase 3),
// NOT higher concurrency.
const CHUNK = 10;
const MAX_ATTEMPTS = 3;
const PROCESSING_STALE_MS = TEST ? 1500 : 240000;          // 4 min
const IMAGE_BACKOFF_MS = TEST ? [50, 100] : [5000, 30000]; // after attempt 1 / 2
const SERVICE_DELAYS_MS = [5 * 60000, 15 * 60000, 30 * 60000];

function isServiceError(msg) {
  return /\b429\b|\b503\b|quota|rate.?limit|overload|unavailable|high demand|temporarily|try again/i.test(msg || '');
}

function cycleResetAt(cycleKey) {
  const t = Date.parse(cycleKey || '');
  return Number.isNaN(t) ? null : t;
}

// ---- Schema + one-time (data-preserving) migration to (shop, kind) ----------
let ready;
async function hasColumn(table, col) {
  try {
    const r = await db.execute(`PRAGMA table_info(${table})`);
    return r.rows.some((row) => row.name === col);
  } catch { return false; }
}
async function tableExists(table) {
  const r = await db.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    args: [table],
  });
  return r.rows.length > 0;
}

async function ensureSchema() {
  if (ready) return ready;
  ready = (async () => {
    await ensureUsageSchema();

    // Migrate a Phase-1 generation_jobs (PK shop, no `kind`) → PK (shop, kind),
    // tagging existing rows 'manual'. Adds the bulk-only columns.
    if (await tableExists('generation_jobs') && !(await hasColumn('generation_jobs', 'kind'))) {
      await db.execute(`
        CREATE TABLE generation_jobs_new (
          shop TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'manual',
          status TEXT NOT NULL, total INTEGER NOT NULL DEFAULT 0,
          done INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
          plan_id TEXT, ai_budget INTEGER, cycle_key TEXT,
          mode TEXT, instructions TEXT, info_fields TEXT,
          error TEXT, resume_at INTEGER NOT NULL DEFAULT 0,
          service_pauses INTEGER NOT NULL DEFAULT 0,
          phase TEXT, applied INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0,
          source TEXT, config TEXT,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (shop, kind)
        )`);
      await db.execute(`
        INSERT INTO generation_jobs_new
          (shop, kind, status, total, done, failed, plan_id, ai_budget, cycle_key,
           mode, instructions, info_fields, error, resume_at, service_pauses, updated_at)
        SELECT shop, 'manual', status, total, done, failed, plan_id, ai_budget, cycle_key,
           mode, instructions, info_fields, error, resume_at, service_pauses, updated_at
        FROM generation_jobs`);
      await db.execute('DROP TABLE generation_jobs');
      await db.execute('ALTER TABLE generation_jobs_new RENAME TO generation_jobs');
    }

    if (await tableExists('generation_queue') && !(await hasColumn('generation_queue', 'kind'))) {
      await db.execute(`
        CREATE TABLE generation_queue_new (
          shop TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'manual',
          image_key TEXT NOT NULL, seq INTEGER NOT NULL,
          source TEXT, url TEXT NOT NULL,
          title TEXT, type TEXT, vendor TEXT, position INTEGER,
          status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL DEFAULT 0, alt TEXT, last_error TEXT,
          batch_id TEXT, updated_at INTEGER NOT NULL,
          PRIMARY KEY (shop, kind, image_key)
        )`);
      await db.execute(`
        INSERT INTO generation_queue_new
          (shop, kind, image_key, seq, source, url, title, type, vendor, position,
           status, attempts, next_attempt_at, alt, last_error, batch_id, updated_at)
        SELECT shop, 'manual', image_key, seq, source, url, title, type, vendor, position,
           status, attempts, next_attempt_at, alt, last_error, batch_id, updated_at
        FROM generation_queue`);
      await db.execute('DROP TABLE generation_queue');
      await db.execute('ALTER TABLE generation_queue_new RENAME TO generation_queue');
    }

    // Fresh installs.
    await db.execute(`
      CREATE TABLE IF NOT EXISTS generation_jobs (
        shop TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'manual',
        status TEXT NOT NULL, total INTEGER NOT NULL DEFAULT 0,
        done INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
        plan_id TEXT, ai_budget INTEGER, cycle_key TEXT,
        mode TEXT, instructions TEXT, info_fields TEXT,
        error TEXT, resume_at INTEGER NOT NULL DEFAULT 0,
        service_pauses INTEGER NOT NULL DEFAULT 0,
        phase TEXT, applied INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0,
        source TEXT, config TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (shop, kind)
      )`);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS generation_queue (
        shop TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'manual',
        image_key TEXT NOT NULL, seq INTEGER NOT NULL,
        source TEXT, url TEXT NOT NULL,
        title TEXT, type TEXT, vendor TEXT, position INTEGER,
        status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0, alt TEXT, last_error TEXT,
        batch_id TEXT, updated_at INTEGER NOT NULL,
        PRIMARY KEY (shop, kind, image_key)
      )`);
    await db.execute('CREATE INDEX IF NOT EXISTS idx_genq_shop_kind_status ON generation_queue (shop, kind, status, next_attempt_at)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_genq_shop_kind_seq ON generation_queue (shop, kind, seq)');
  })();
  return ready;
}

export async function ensureGenSchema() {
  return ensureSchema();
}

function buildContext(mode, infoFields, item) {
  if (mode !== 'ai_custom') return '';
  const bits = [];
  if (infoFields.includes('title') && item.title) bits.push(`Title: ${item.title}`);
  if (infoFields.includes('type') && item.type) bits.push(`Type: ${item.type}`);
  if (infoFields.includes('vendor') && item.vendor) bits.push(`Vendor: ${item.vendor}`);
  return bits.join('; ');
}

export async function getJob(shop, kind = 'manual') {
  await ensureSchema();
  const r = await db.execute({ sql: 'SELECT * FROM generation_jobs WHERE shop=? AND kind=?', args: [shop, kind] });
  return r.rows[0] || null;
}

export async function queueCounts(shop, kind = 'manual') {
  const r = await db.execute({
    sql: `SELECT
            SUM(status='pending')    AS pending,
            SUM(status='processing') AS processing,
            SUM(status='done')       AS done,
            SUM(status='failed')     AS failed,
            COUNT(*)                 AS total
          FROM generation_queue WHERE shop=? AND kind=?`,
    args: [shop, kind],
  });
  const row = r.rows[0] || {};
  return {
    pending: Number(row.pending || 0),
    processing: Number(row.processing || 0),
    done: Number(row.done || 0),
    failed: Number(row.failed || 0),
    total: Number(row.total || 0),
  };
}

export async function getResultsSince(shop, sinceSeq, kind = 'manual') {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT image_key, alt, seq FROM generation_queue
          WHERE shop=? AND kind=? AND status='done' AND seq>? ORDER BY seq`,
    args: [shop, kind, Number(sinceSeq) || 0],
  });
  return r.rows.map((row) => ({ key: row.image_key, alt: row.alt, seq: Number(row.seq) }));
}

export async function cancelJob(shop, kind = 'manual') {
  await ensureSchema();
  await db.execute({
    sql: "UPDATE generation_jobs SET status='cancelled', resume_at=0, updated_at=? WHERE shop=? AND kind=?",
    args: [now(), shop, kind],
  });
}

// ---- Queue helpers (used by the manual startJob AND the bulk orchestrator) --

export async function clearQueue(shop, kind, { keepDone = false } = {}) {
  await ensureSchema();
  await db.execute({
    sql: `DELETE FROM generation_queue WHERE shop=? AND kind=?${keepDone ? " AND status<>'done'" : ''}`,
    args: [shop, kind],
  });
}

// Insert a batch of items as pending rows. `startSeq` is the 1-based seq of the
// first item. Keeps any pre-existing `done` row (preserves alt + attempts) so a
// re-run never regenerates or re-bills a finished image.
export async function seedRows(shop, kind, items, startSeq = 1) {
  await ensureSchema();
  const ts = now();
  const SEED_BATCH = 200;
  for (let i = 0; i < items.length; i += SEED_BATCH) {
    const slice = items.slice(i, i + SEED_BATCH);
    const stmts = slice.map((it, j) => ({
      sql: `INSERT INTO generation_queue
              (shop, kind, image_key, seq, source, url, title, type, vendor, position,
               status, attempts, next_attempt_at, alt, last_error, batch_id, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?, 'pending', 0, 0, NULL, NULL, NULL, ?)
            ON CONFLICT(shop, kind, image_key) DO UPDATE SET
              seq=excluded.seq, source=excluded.source, url=excluded.url,
              title=excluded.title, type=excluded.type, vendor=excluded.vendor, position=excluded.position,
              status = CASE WHEN generation_queue.status='done' THEN 'done' ELSE 'pending' END,
              attempts = CASE WHEN generation_queue.status='done' THEN generation_queue.attempts ELSE 0 END,
              next_attempt_at = CASE WHEN generation_queue.status='done' THEN generation_queue.next_attempt_at ELSE 0 END,
              last_error=NULL, updated_at=excluded.updated_at`,
      args: [
        shop, kind, it.key, startSeq + i + j, it.source || null, it.url,
        it.title ?? null, it.type ?? null, it.vendor ?? null, it.position ?? null, ts,
      ],
    }));
    await db.batch(stmts, 'write');
  }
}

// Manual flow: create (or replace) the control row + seed the queue.
export async function startJob(shop, { items, mode, instructions, infoFields, planId, aiBudget, cycleKey }) {
  await ensureSchema();
  const ts = now();
  await clearQueue(shop, 'manual', { keepDone: true });
  await seedRows(shop, 'manual', items, 1);
  const { done } = await queueCounts(shop, 'manual');
  await db.execute({
    sql: `INSERT INTO generation_jobs
            (shop, kind, status, total, done, failed, plan_id, ai_budget, cycle_key,
             mode, instructions, info_fields, error, resume_at, service_pauses, updated_at)
          VALUES (?, 'manual', 'running', ?, ?, 0, ?, ?, ?, ?, ?, ?, NULL, 0, 0, ?)
          ON CONFLICT(shop, kind) DO UPDATE SET
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

export async function retryFailed(shop, kind = 'manual') {
  await ensureSchema();
  const ts = now();
  await db.execute({
    sql: `UPDATE generation_queue SET status='pending', attempts=0, next_attempt_at=0, last_error=NULL, updated_at=?
          WHERE shop=? AND kind=? AND status='failed'`,
    args: [ts, shop, kind],
  });
  await db.execute({
    sql: "UPDATE generation_jobs SET status='running', failed=0, error=NULL, resume_at=0, updated_at=? WHERE shop=? AND kind=?",
    args: [ts, shop, kind],
  });
}

// ---- The shared generation engine ------------------------------------------

async function claimChunk(shop, kind, limit) {
  if (limit <= 0) return [];
  const sel = await db.execute({
    sql: `SELECT image_key, seq, source, url, title, type, vendor, position, attempts
          FROM generation_queue
          WHERE shop=? AND kind=? AND status='pending' AND next_attempt_at<=?
          ORDER BY seq LIMIT ?`,
    args: [shop, kind, now(), limit],
  });
  const claimed = [];
  for (const row of sel.rows) {
    const res = await db.execute({
      sql: `UPDATE generation_queue SET status='processing', updated_at=?
            WHERE shop=? AND kind=? AND image_key=? AND status='pending'`,
      args: [now(), shop, kind, row.image_key],
    });
    if (Number(res.rowsAffected) === 1) claimed.push(row);
  }
  return claimed;
}

async function earliestPendingAt(shop, kind) {
  const r = await db.execute({
    sql: "SELECT MIN(next_attempt_at) AS m FROM generation_queue WHERE shop=? AND kind=? AND status='pending'",
    args: [shop, kind],
  });
  const m = r.rows[0]?.m;
  return m == null ? null : Number(m);
}

async function pauseService(shop, kind, errMsg) {
  const job = await getJob(shop, kind);
  const pauses = (Number(job?.service_pauses) || 0) + 1;
  const delay = SERVICE_DELAYS_MS[Math.min(pauses - 1, SERVICE_DELAYS_MS.length - 1)];
  await db.execute({
    sql: "UPDATE generation_jobs SET status='paused_service', resume_at=?, service_pauses=?, error=?, updated_at=? WHERE shop=? AND kind=?",
    args: [now() + delay, pauses, 'AI service is busy — auto-retrying shortly.', now(), shop, kind],
  });
}

async function pausePlanQuota(shop, kind, cycleKey) {
  const resetAt = cycleResetAt(cycleKey);
  await db.execute({
    sql: "UPDATE generation_jobs SET status='paused_quota', resume_at=?, error=?, updated_at=? WHERE shop=? AND kind=?",
    args: [
      resetAt || 0,
      resetAt
        ? 'Monthly AI image limit reached — resumes automatically next billing cycle.'
        : 'Monthly AI image limit reached. Upgrade your plan to generate the rest.',
      now(), shop, kind,
    ],
  });
}

// The core loop: claim → generate → commit, with retry/backoff + pause. Returns
// an outcome ('completed' | 'paused_quota' | 'paused_service' | <other status>).
// Does NOT finalize the job to 'done' — that's the caller's responsibility, so
// the bulk orchestrator can continue into its apply phase.
export async function runGenerationLoop(shop, kind) {
  await ensureSchema();
  const job = await getJob(shop, kind);
  if (!job || job.status !== 'running') return job?.status || 'idle';

  const cycleKey = job.cycle_key;
  const aiBudget = Number(job.ai_budget) || 0;
  const mode = job.mode;
  const instructions = job.instructions || '';
  let infoFields = [];
  try { infoFields = JSON.parse(job.info_fields || '[]'); } catch { /* ignore */ }

  // Crash recovery: reclaim only genuinely stranded rows.
  await db.execute({
    sql: `UPDATE generation_queue SET status='pending', updated_at=?
          WHERE shop=? AND kind=? AND status='processing' AND updated_at < ?`,
    args: [now(), shop, kind, now() - PROCESSING_STALE_MS],
  });

  let doneCount = Number(job.done) || 0;

  while (true) {
    const fresh = await getJob(shop, kind);
    if (!fresh || fresh.status !== 'running') return fresh?.status || 'cancelled';

    if (doneCount >= aiBudget) {
      const { pending, processing } = await queueCounts(shop, kind);
      if (pending + processing > 0) { await pausePlanQuota(shop, kind, cycleKey); return 'paused_quota'; }
      break;
    }

    const room = aiBudget - doneCount;
    const batch = await claimChunk(shop, kind, Math.min(CHUNK, room));

    if (batch.length === 0) {
      const nextAt = await earliestPendingAt(shop, kind);
      if (nextAt == null) break;
      await sleep(Math.min(Math.max(0, nextAt - now()) || 1000, 30000));
      continue;
    }

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

    if (successes.length) {
      const stmts = successes.map((r) => ({
        sql: `UPDATE generation_queue SET status='done', alt=?, attempts=attempts+1, last_error=NULL, updated_at=?
              WHERE shop=? AND kind=? AND image_key=?`,
        args: [r.alt, ts, shop, kind, r.row.image_key],
      }));
      stmts.push({
        sql: 'UPDATE generation_jobs SET done=done+?, updated_at=? WHERE shop=? AND kind=?',
        args: [successes.length, ts, shop, kind],
      });
      stmts.push(usageIncrStatement(shop, cycleKey, successes.length));
      await db.batch(stmts, 'write');
      doneCount += successes.length;
    }

    for (const r of imageFails) {
      const attempts = Number(r.row.attempts || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await db.batch([
          {
            sql: `UPDATE generation_queue SET status='failed', attempts=?, last_error=?, updated_at=?
                  WHERE shop=? AND kind=? AND image_key=?`,
            args: [attempts, String(r.error).slice(0, 300), ts, shop, kind, r.row.image_key],
          },
          { sql: 'UPDATE generation_jobs SET failed=failed+1, updated_at=? WHERE shop=? AND kind=?', args: [ts, shop, kind] },
        ], 'write');
      } else {
        const backoff = IMAGE_BACKOFF_MS[Math.min(attempts - 1, IMAGE_BACKOFF_MS.length - 1)];
        await db.execute({
          sql: `UPDATE generation_queue SET status='pending', attempts=?, next_attempt_at=?, last_error=?, updated_at=?
                WHERE shop=? AND kind=? AND image_key=?`,
          args: [attempts, ts + backoff, String(r.error).slice(0, 300), ts, shop, kind, r.row.image_key],
        });
      }
    }

    if (serviceFails.length) {
      for (const r of serviceFails) {
        await db.execute({
          sql: `UPDATE generation_queue SET status='pending', next_attempt_at=0, last_error=?, updated_at=?
                WHERE shop=? AND kind=? AND image_key=?`,
          args: [String(r.error).slice(0, 300), ts, shop, kind, r.row.image_key],
        });
      }
      await pauseService(shop, kind, serviceFails[0].error);
      return 'paused_service';
    }
  }

  return 'completed';
}

// ---- Manual wrapper --------------------------------------------------------
const active = new Set(); // keyed `${shop}:${kind}`
export function isActive(shop, kind = 'manual') { return active.has(`${shop}:${kind}`); }

export async function runJob(shop, kind = 'manual') {
  const key = `${shop}:${kind}`;
  if (active.has(key)) return;
  active.add(key);
  try {
    await ensureSchema();
    const outcome = await runGenerationLoop(shop, kind);
    if (outcome === 'completed') {
      await settleOverflowBestEffort(shop, kind);
      const j = await getJob(shop, kind);
      if (j && j.status === 'running') {
        const failed = Number(j.failed) || 0;
        await db.execute({
          sql: "UPDATE generation_jobs SET status='done', error=?, resume_at=0, updated_at=? WHERE shop=? AND kind=?",
          args: [failed ? `${failed} image(s) could not be generated after ${MAX_ATTEMPTS} tries.` : null, now(), shop, kind],
        });
      }
    }
  } catch (e) {
    console.error('runJob fatal:', e);
    try {
      await db.execute({
        sql: "UPDATE generation_jobs SET status='error', error=?, updated_at=? WHERE shop=? AND kind=?",
        args: [String(e?.message || e).slice(0, 200), now(), shop, kind],
      });
    } catch { /* ignore */ }
  } finally {
    active.delete(key);
  }
}

export async function settleOverflowBestEffort(shop, kind = 'manual') {
  try {
    const job = await getJob(shop, kind);
    const plan = getPlan(job?.plan_id);
    if (!plan.overflow) return;
    const token = await getAccessToken(shop);
    const { aiCount } = await getUsage(shop, job.cycle_key);
    if (token) await settleOverflow(shop, token, plan, job.cycle_key, aiCount);
  } catch (e) {
    console.error('overflow settle (bg) failed:', e.message);
  }
}

// ---- Scheduler hooks -------------------------------------------------------

// Resume paused jobs (any kind) whose resume_at has arrived. Quota pauses refresh
// the entitlement first (fresh cycle → fresh budget/cycleKey). Manual jobs resume
// via runJob; bulk jobs re-enter their orchestrator (dynamic import avoids a cycle).
export async function sweepResumableJobs() {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT shop, kind, status FROM generation_jobs
          WHERE status IN ('paused_quota','paused_service') AND resume_at>0 AND resume_at<=?`,
    args: [now()],
  });
  for (const row of r.rows) {
    const { shop, kind } = row;
    try {
      if (row.status === 'paused_quota') {
        const token = await getValidOfflineToken(shop);
        if (!token) continue;
        const ent = await getEntitlement(shop, token);
        if (!ent.plan.ai || !ent.active || ent.remaining <= 0) continue;
        const { done } = await queueCounts(shop, kind);
        await db.execute({
          sql: `UPDATE generation_jobs SET status='running', resume_at=0,
                  plan_id=?, cycle_key=?, ai_budget=?, error=NULL, updated_at=? WHERE shop=? AND kind=?`,
          args: [ent.planId, ent.cycleKey, done + ent.remaining, now(), shop, kind],
        });
      } else {
        await db.execute({
          sql: "UPDATE generation_jobs SET status='running', resume_at=0, error=NULL, updated_at=? WHERE shop=? AND kind=?",
          args: [now(), shop, kind],
        });
      }
      if (kind === 'bulk') {
        const { resumeBulkEdit } = await import('@/lib/bulkRun');
        resumeBulkEdit(shop); // fire-and-forget; re-enters the apply/generate phases
      } else {
        runJob(shop, 'manual');
      }
    } catch (e) {
      console.error('sweepResumableJobs error for', shop, kind, e?.message || e);
    }
  }
}

const QUEUE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export async function cleanupQueue() {
  await ensureSchema();
  try {
    await db.execute({
      sql: "DELETE FROM generation_queue WHERE status IN ('done','failed') AND updated_at < ?",
      args: [now() - QUEUE_TTL_MS],
    });
  } catch (e) {
    console.error('cleanupQueue error:', e.message);
  }
}

export async function deleteGenerationData(shop) {
  await ensureSchema();
  try {
    await db.batch([
      { sql: 'DELETE FROM generation_queue WHERE shop = ?', args: [shop] },
      { sql: 'DELETE FROM generation_jobs WHERE shop = ?', args: [shop] },
    ], 'write');
  } catch (e) {
    console.error('deleteGenerationData error:', e.message);
  }
}

export async function dropAppliedRows(shop, keys, kind = 'manual') {
  if (!Array.isArray(keys) || !keys.length) return;
  await ensureSchema();
  try {
    const ph = keys.map(() => '?').join(',');
    await db.execute({
      sql: `DELETE FROM generation_queue WHERE shop=? AND kind=? AND image_key IN (${ph})`,
      args: [shop, kind, ...keys],
    });
  } catch (e) {
    console.error('dropAppliedRows error:', e.message);
  }
}
