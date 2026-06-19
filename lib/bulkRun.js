// Server-side BULK EDIT pipeline, now built on the shared per-image retry queue
// (lib/generationJob.js, kind='bulk'). Phases — all STREAMING, nothing held whole
// in memory, so it scales to enterprise stores:
//
//   scanning   → stream the store packet-by-packet, seed matching images as
//                pending rows (filtered by source / scope / skip-existing).
//   generating → AI modes run the shared engine (retry/backoff/pause/resume +
//                metered usage); title/template/remove compute the alt in DB pages.
//   applying   → read `done` rows in pages, write back to Shopify in batches of 25,
//                drop applied rows.
//   finished   → settle Compliance overflow, mark done.
//
// The control row lives in generation_jobs(kind='bulk'); the run is RE-ENTRANT by
// `phase`, so the scheduler sweep can resume a paused job (quota/service) with no
// merchant tab open. Runs for BOTH the immediate "Start Bulk Editing" button and
// the scheduler.
import db, { getOfflineToken } from '@/lib/db';
import { scanPacket, embedAlts } from '@/lib/shopifyAdmin';
import { sanitizeAlt } from '@/lib/sanitizeAlt';
import { getEntitlement } from '@/lib/billing/usage';
import {
  ensureGenSchema, getJob, queueCounts, clearQueue, seedRows,
  runGenerationLoop, settleOverflowBestEffort,
} from '@/lib/generationJob';

const now = () => Date.now();
const AI_MODES = new Set(['ai', 'ai_custom']);
const ALL_SOURCES = ['product', 'file', 'article', 'collection'];
const APPLY_PAGE = 25;     // Shopify write-back batch size
const COMPUTE_PAGE = 200;  // non-AI alt computation page

const hasAlt = (i) => !!(i.alt && String(i.alt).trim());

function applyTemplate(tpl, img) {
  const filled = (tpl || '')
    .replace(/\[product_title\]/g, img.title || '')
    .replace(/\[product_type\]/g, img.type || '')
    .replace(/\[product_vendor\]/g, img.vendor || '')
    .replace(/\[option[123]\]/g, '');
  return sanitizeAlt(filled);
}

function normalizeConfig(config) {
  return {
    sources: Array.isArray(config.sources) && config.sources.length ? config.sources : ALL_SOURCES,
    mode: config.mode,
    template: config.template || '',
    scope: config.scope === 'all' ? 'all' : 'missing',
    skipExisting: !!config.skipExisting,
    infoFields: Array.isArray(config.infoFields) ? config.infoFields : [],
    instructions: (config.instructions || '').toString().slice(0, 400),
    triggeredBy: config.triggeredBy === 'schedule' ? 'schedule' : 'manual',
  };
}

// ---- Control-row helpers ---------------------------------------------------
async function setJob(shop, patch) {
  const cols = Object.keys(patch);
  if (!cols.length) return;
  const setSql = cols.map((c) => `${c}=?`).join(', ');
  await db.execute({
    sql: `UPDATE generation_jobs SET ${setSql}, updated_at=? WHERE shop=? AND kind='bulk'`,
    args: [...cols.map((c) => patch[c]), now(), shop],
  });
}

export async function getBulkRun(shop) {
  await ensureGenSchema();
  const job = await getJob(shop, 'bulk');
  if (!job) return null;
  return {
    status: job.status,            // running | done | error | paused_quota | paused_service
    phase: job.phase || null,
    total: Number(job.total),
    done: Number(job.done),
    applied: Number(job.applied),
    errors: Number(job.errors),
    failed: Number(job.failed),
    note: job.error || null,
    source: job.source || null,
    updatedAt: Number(job.updated_at),
  };
}

// In-process guard: one bulk run per shop per instance.
const active = new Set();
export function isBulkActive(shop) { return active.has(shop); }

// Fire-and-forget resume entry, used by the scheduler sweep.
export function resumeBulkEdit(shop) {
  return runBulkEdit(shop).catch((e) => console.error('bulk resume error:', e?.message || e));
}

// ---- Phases ----------------------------------------------------------------
async function phaseScan(shop, cfg, token) {
  const isRemove = cfg.mode === 'remove';
  const onlyMissing = !isRemove && (cfg.scope === 'missing' || cfg.skipExisting);
  let state = null;
  let seq = 0;
  let total = 0;
  do {
    const { items, next } = await scanPacket(shop, token, state, cfg.sources);
    state = next;
    let rows = items.filter((i) => cfg.sources.includes(i.source));
    if (isRemove) rows = rows.filter(hasAlt);
    else if (onlyMissing) rows = rows.filter((i) => !hasAlt(i));
    if (rows.length) {
      const seedItems = rows.map((i) => ({
        key: `${i.source}:${i.id}`, source: i.source, url: i.url,
        title: i.title, type: i.type, vendor: i.vendor, position: i.position,
      }));
      await seedRows(shop, 'bulk', seedItems, seq + 1);
      seq += seedItems.length;
      total += seedItems.length;
      await setJob(shop, { total });
    }
  } while (state);
  return total;
}

// title / template / remove — no AI, no quota. Compute alt straight into the rows.
async function phaseComputeNonAI(shop, cfg) {
  while (true) {
    const r = await db.execute({
      sql: `SELECT image_key, title, type, vendor FROM generation_queue
            WHERE shop=? AND kind='bulk' AND status='pending' ORDER BY seq LIMIT ?`,
      args: [shop, COMPUTE_PAGE],
    });
    if (!r.rows.length) break;
    const ts = now();
    const stmts = r.rows.map((row) => {
      let alt = '';
      if (cfg.mode === 'title') alt = applyTemplate('[product_title]', row);
      else if (cfg.mode === 'template') alt = applyTemplate(cfg.template || '[product_title]', row);
      // 'remove' → alt stays ''
      return {
        sql: `UPDATE generation_queue SET status='done', alt=?, updated_at=? WHERE shop=? AND kind='bulk' AND image_key=?`,
        args: [alt, ts, shop, row.image_key],
      };
    });
    stmts.push({ sql: "UPDATE generation_jobs SET done=done+?, updated_at=? WHERE shop=? AND kind='bulk'", args: [r.rows.length, ts, shop] });
    await db.batch(stmts, 'write');
  }
}

// Write `done` rows back to Shopify in pages, then drop them.
async function phaseApply(shop, token) {
  await setJob(shop, { phase: 'applying' });
  while (true) {
    const r = await db.execute({
      sql: `SELECT image_key, source, url, alt FROM generation_queue
            WHERE shop=? AND kind='bulk' AND status='done' ORDER BY seq LIMIT ?`,
      args: [shop, APPLY_PAGE],
    });
    if (!r.rows.length) break;
    const items = r.rows.map((row) => ({
      source: row.source,
      id: row.image_key.slice((row.source || '').length + 1), // image_key = `${source}:${id}`
      url: row.url,
      alt: row.alt ?? '',
    }));
    const res = await embedAlts(shop, token, items);
    const keys = r.rows.map((row) => row.image_key);
    const ph = keys.map(() => '?').join(',');
    await db.batch([
      { sql: `DELETE FROM generation_queue WHERE shop=? AND kind='bulk' AND image_key IN (${ph})`, args: [shop, ...keys] },
      { sql: "UPDATE generation_jobs SET applied=applied+?, errors=errors+?, updated_at=? WHERE shop=? AND kind='bulk'", args: [res.applied || 0, res.errors?.length || 0, now(), shop] },
    ], 'write');
  }
}

// ---- Orchestrator ----------------------------------------------------------
// runBulkEdit(shop, config)  → fresh run.
// runBulkEdit(shop)          → resume an in-flight (or paused) run from its phase.
export async function runBulkEdit(shop, config) {
  await ensureGenSchema();
  if (active.has(shop)) return { error: 'A bulk edit is already running for this shop.' };
  active.add(shop);

  const fail = async (note) => {
    await ensureBulkRow(shop);
    await setJob(shop, { status: 'error', phase: 'finished', error: String(note).slice(0, 200) });
    return { error: note };
  };

  try {
    const token = await getOfflineToken(shop);
    if (!token) return await fail('No stored Shopify token — please reopen the app to reconnect.');

    if (config) {
      const cfg = normalizeConfig(config);
      const isAI = AI_MODES.has(cfg.mode);
      let planId = 'free'; let aiBudget = Number.MAX_SAFE_INTEGER; let cycleKey = 'na';
      if (isAI) {
        const ent = await getEntitlement(shop, token);
        if (!ent.plan.ai || !ent.active) return await fail(`AI generation isn’t included in your ${ent.plan.name} plan.`);
        if (ent.remaining <= 0) return await fail('Monthly AI image limit reached. Upgrade or wait for the next cycle.');
        planId = ent.planId; aiBudget = ent.remaining; cycleKey = ent.cycleKey;
      }
      // Fresh start: clear any prior bulk queue + (re)seed the control row.
      await clearQueue(shop, 'bulk');
      await db.execute({
        sql: `INSERT INTO generation_jobs
                (shop, kind, status, total, done, failed, plan_id, ai_budget, cycle_key,
                 mode, instructions, info_fields, error, resume_at, service_pauses,
                 phase, applied, errors, source, config, updated_at)
              VALUES (?, 'bulk', 'running', 0, 0, 0, ?, ?, ?, ?, ?, ?, NULL, 0, 0, 'scanning', 0, 0, ?, ?, ?)
              ON CONFLICT(shop, kind) DO UPDATE SET
                status='running', total=0, done=0, failed=0, plan_id=excluded.plan_id,
                ai_budget=excluded.ai_budget, cycle_key=excluded.cycle_key, mode=excluded.mode,
                instructions=excluded.instructions, info_fields=excluded.info_fields, error=NULL,
                resume_at=0, service_pauses=0, phase='scanning', applied=0, errors=0,
                source=excluded.source, config=excluded.config, updated_at=excluded.updated_at`,
        args: [
          shop, planId, aiBudget, cycleKey, cfg.mode, cfg.instructions,
          JSON.stringify(cfg.infoFields), cfg.triggeredBy, JSON.stringify(cfg), now(),
        ],
      });
    }

    let job = await getJob(shop, 'bulk');
    if (!job) return { error: 'No bulk job to run.' };
    // Resuming a paused/parked job → flip back to running.
    if (job.status !== 'running') {
      await setJob(shop, { status: 'running', resume_at: 0, error: null });
      job = await getJob(shop, 'bulk');
    }
    const cfg = (() => { try { return normalizeConfig(JSON.parse(job.config || '{}')); } catch { return null; } })();
    if (!cfg || !cfg.mode) return await fail('Bulk run is missing its configuration.');
    const isAI = AI_MODES.has(cfg.mode);

    // PHASE: scanning
    if ((job.phase || 'scanning') === 'scanning') {
      await phaseScan(shop, cfg, token);
      const { total } = await queueCounts(shop, 'bulk');
      if (total === 0) {
        await setJob(shop, { status: 'done', phase: 'finished', error: 'No matching images.' });
        return { processed: 0, applied: 0, errors: 0, note: 'No matching images.' };
      }
      await setJob(shop, { phase: 'generating' });
      job = await getJob(shop, 'bulk');
    }

    // PHASE: generating
    if (job.phase === 'generating') {
      if (isAI) {
        const outcome = await runGenerationLoop(shop, 'bulk');
        if (outcome === 'paused_quota' || outcome === 'paused_service') {
          return { paused: outcome, note: 'Bulk edit paused — it will resume automatically.' };
        }
        if (outcome !== 'completed') return { note: `Bulk generation ${outcome}.` };
        await settleOverflowBestEffort(shop, 'bulk');
      } else {
        await phaseComputeNonAI(shop, cfg);
      }
      await setJob(shop, { phase: 'applying' });
    }

    // PHASE: applying (+ resume lands here directly)
    await phaseApply(shop, token);

    // PHASE: finished
    const counts = await queueCounts(shop, 'bulk');
    const final = await getJob(shop, 'bulk');
    const applied = Number(final.applied) || 0;
    const errors = Number(final.errors) || 0;
    const failed = counts.failed;
    const note = failed
      ? `Applied alt text to ${applied} image${applied === 1 ? '' : 's'}. ${failed} could not be generated.`
      : `Applied alt text to ${applied} image${applied === 1 ? '' : 's'}.`;
    await setJob(shop, { status: errors && !applied ? 'error' : 'done', phase: 'finished', error: note });
    return { processed: Number(final.done) || 0, applied, errors, failed, note };
  } catch (e) {
    console.error('runBulkEdit fatal:', e);
    return await fail(String(e?.message || e));
  } finally {
    active.delete(shop);
  }
}

// Make sure a bulk control row exists before writing an error to it (used by fail()).
async function ensureBulkRow(shop) {
  const job = await getJob(shop, 'bulk');
  if (job) return;
  await db.execute({
    sql: `INSERT INTO generation_jobs (shop, kind, status, phase, updated_at)
          VALUES (?, 'bulk', 'error', 'finished', ?)
          ON CONFLICT(shop, kind) DO NOTHING`,
    args: [shop, now()],
  });
}
