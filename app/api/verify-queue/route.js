import { NextResponse } from 'next/server';
import db from '@/lib/db';
import {
  startJob, runJob, getJob, retryFailed, sweepResumableJobs, deleteGenerationData,
  runGenerationLoop, seedRows, queueCounts,
} from '@/lib/generationJob';
import { getUsage } from '@/lib/billing/usage';

export const dynamic = 'force-dynamic';

// GET /api/_verify-queue
// Phase-1 retry-queue verification. HARD-GATED: returns 404 unless
// ALTGEN_TEST_HOOK=1, which also makes generateWithGemini deterministic and
// shrinks the queue timers. NEVER set that flag in production. Uses throwaway
// __verify_*__ shop keys and cleans up after itself.

const CYCLE = '2099-06-01T00:00:00Z'; // far-future cycle key (deterministic resume_at)
const CYCLE_MS = Date.parse(CYCLE);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Per-run nonce keeps the flaky test seam's attempt counter (keyed by URL) fresh
// across runs, so a re-run isn't poisoned by the previous run's counts.
let runNonce = '0';
function mkItems(shop, specs) {
  return specs.map((s, i) => {
    const marker = s === 'img' ? '__IMG_FAIL__'
      : s === 'svc' ? '__SVC_FAIL__'
      : s === 'flaky' ? '__FLAKY2__' : 'ok';
    return {
      key: `${shop}:img${i}`,
      source: 'product',
      url: `https://example.test/${marker}/${shop}-${i}-${runNonce}.jpg`,
      title: `Title ${i}`, type: 'Type', vendor: 'Vendor', position: i + 1,
    };
  });
}

async function qrows(shop) {
  const r = await db.execute({
    sql: 'SELECT image_key, status, attempts, url, alt FROM generation_queue WHERE shop=? ORDER BY seq',
    args: [shop],
  });
  return r.rows;
}

async function cleanup(shop) {
  await deleteGenerationData(shop);
  try { await db.execute({ sql: 'DELETE FROM usage WHERE shop=?', args: [shop] }); } catch { /* ignore */ }
}

async function waitJob(shop, finalStatuses, timeoutMs = 5000) {
  const t0 = Date.now();
  let j = await getJob(shop);
  while (Date.now() - t0 < timeoutMs) {
    if (j && finalStatuses.includes(j.status)) return j;
    await sleep(50);
    j = await getJob(shop);
  }
  return j;
}

// Replace the fail-marker in a row's url, simulating "the image was fixed".
async function fixUrl(shop) {
  await db.execute({
    sql: `UPDATE generation_queue
          SET url = replace(replace(replace(url,'__IMG_FAIL__','ok'),'__SVC_FAIL__','ok'),'__FLAKY2__','ok')
          WHERE shop=?`,
    args: [shop],
  });
}

const seedJob = (shop, specs, aiBudget = 100) =>
  startJob(shop, {
    items: mkItems(shop, specs), mode: 'ai', instructions: '', infoFields: [],
    planId: 'starter', aiBudget, cycleKey: CYCLE,
  });

// ---- Scenarios -------------------------------------------------------------
async function s1() {
  const shop = '__verify_s1__.myshopify.com';
  await cleanup(shop);
  await seedJob(shop, ['ok', 'ok', 'ok', 'ok', 'ok']);
  await runJob(shop);
  const j = await getJob(shop); const rows = await qrows(shop); const u = await getUsage(shop, CYCLE);
  const done = rows.filter((r) => r.status === 'done').length;
  const pass = j.status === 'done' && done === 5 && Number(j.done) === 5 && u.aiCount === 5;
  await cleanup(shop);
  return { name: 'S1 happy path · all done, usage counted exactly once each', pass,
    info: { status: j.status, done, jobDone: Number(j.done), usage: u.aiCount } };
}

async function s2() {
  const shop = '__verify_s2__.myshopify.com';
  await cleanup(shop);
  await seedJob(shop, ['ok', 'img', 'ok']);
  await runJob(shop);
  const j = await getJob(shop); const rows = await qrows(shop); const u = await getUsage(shop, CYCLE);
  const failed = rows.find((r) => r.status === 'failed');
  const pass = j.status === 'done' && Number(j.failed) === 1 && !!failed
    && Number(failed.attempts) === 3 && u.aiCount === 2;
  await cleanup(shop);
  return { name: 'S2 image fault · permanently failed after 3 tries, not billed', pass,
    info: { status: j.status, jobFailed: Number(j.failed), failAttempts: Number(failed?.attempts), usage: u.aiCount } };
}

async function s3() {
  const shop = '__verify_s3__.myshopify.com';
  await cleanup(shop);
  await seedJob(shop, ['flaky']);
  await runJob(shop);
  const j = await getJob(shop); const rows = await qrows(shop); const u = await getUsage(shop, CYCLE);
  const row = rows[0];
  const pass = j.status === 'done' && row.status === 'done' && Number(row.attempts) === 3 && u.aiCount === 1;
  await cleanup(shop);
  return { name: 'S3 flaky image · retried with backoff, succeeds on 3rd, billed once', pass,
    info: { status: j.status, rowStatus: row?.status, attempts: Number(row?.attempts), usage: u.aiCount } };
}

async function s4() {
  const shop = '__verify_s4__.myshopify.com';
  await cleanup(shop);
  await seedJob(shop, ['ok', 'svc']);
  await runJob(shop);
  const j = await getJob(shop); const rows = await qrows(shop); const u = await getUsage(shop, CYCLE);
  const svc = rows.find((r) => r.url.includes('__SVC_FAIL__'));
  const ok = rows.find((r) => !r.url.includes('__SVC_FAIL__'));
  const pass = j.status === 'paused_service' && Number(j.resume_at) > Date.now()
    && svc.status === 'pending' && Number(svc.attempts) === 0 && ok.status === 'done' && u.aiCount === 1;
  await cleanup(shop);
  return { name: 'S4 service fault · job paused, no attempt burned, good image done', pass,
    info: { status: j.status, resumeInFutureMs: Number(j.resume_at) - Date.now(), svcStatus: svc?.status, svcAttempts: Number(svc?.attempts), usage: u.aiCount } };
}

async function s5() {
  const shop = '__verify_s5__.myshopify.com';
  await cleanup(shop);
  await seedJob(shop, ['ok', 'ok', 'ok']);
  const rows0 = await qrows(shop);
  const staleKey = rows0[0].image_key; const freshKey = rows0[1].image_key;
  // row0 = stranded (old) processing → should be reclaimed; row1 = fresh processing → should NOT.
  await db.execute({ sql: "UPDATE generation_queue SET status='processing', updated_at=? WHERE shop=? AND image_key=?", args: [Date.now() - 5000, shop, staleKey] });
  await db.execute({ sql: "UPDATE generation_queue SET status='processing', updated_at=? WHERE shop=? AND image_key=?", args: [Date.now(), shop, freshKey] });
  await runJob(shop);
  const rows = await qrows(shop);
  const stale = rows.find((r) => r.image_key === staleKey);
  const fresh = rows.find((r) => r.image_key === freshKey);
  const pass = stale.status === 'done' && fresh.status === 'processing';
  await cleanup(shop);
  return { name: 'S5 crash recovery · stale processing reclaimed, fresh in-flight left alone', pass,
    info: { staleStatus: stale?.status, freshStatus: fresh?.status } };
}

async function s6() {
  const shop = '__verify_s6__.myshopify.com';
  await cleanup(shop);
  await seedJob(shop, ['img']);
  await runJob(shop);
  const failed = (await getJob(shop)).status;
  await fixUrl(shop);          // image fixed
  await retryFailed(shop);
  await runJob(shop);
  const j = await getJob(shop); const rows = await qrows(shop); const u = await getUsage(shop, CYCLE);
  const pass = failed === 'done' && j.status === 'done' && Number(j.failed) === 0
    && rows[0].status === 'done' && u.aiCount === 1;
  await cleanup(shop);
  return { name: 'S6 retry failed · re-queues failed image, succeeds after fix', pass,
    info: { afterFirstRun: failed, finalStatus: j.status, jobFailed: Number(j.failed), usage: u.aiCount } };
}

async function s7() {
  const shop = '__verify_s7__.myshopify.com';
  await cleanup(shop);
  await seedJob(shop, ['ok', 'ok', 'ok', 'ok', 'ok'], 2); // plan budget = 2
  await runJob(shop);
  const j = await getJob(shop); const rows = await qrows(shop); const u = await getUsage(shop, CYCLE);
  const pending = rows.filter((r) => r.status === 'pending').length;
  const pass = j.status === 'paused_quota' && Number(j.done) === 2 && pending === 3
    && Number(j.resume_at) === CYCLE_MS && u.aiCount === 2;
  await cleanup(shop);
  return { name: 'S7 plan-quota cap · paused at budget, rest pending, resumes next cycle', pass,
    info: { status: j.status, done: Number(j.done), pending, resumeAt: Number(j.resume_at), expectedResumeAt: CYCLE_MS, usage: u.aiCount } };
}

async function s8() {
  const shop = '__verify_s8__.myshopify.com';
  await cleanup(shop);
  await seedJob(shop, ['svc']);
  await runJob(shop);                                // → paused_service
  const paused = (await getJob(shop)).status;
  await fixUrl(shop);                                // service recovered
  await db.execute({ sql: 'UPDATE generation_jobs SET resume_at=? WHERE shop=?', args: [Date.now() - 1, shop] });
  await sweepResumableJobs();                        // scheduler tick equivalent (fire-and-forget runJob)
  // Generous window — the resumed runJob is fire-and-forget and the DB is remote.
  const j = await waitJob(shop, ['done', 'error', 'paused_service'], 25000);
  const rows = await qrows(shop); const u = await getUsage(shop, CYCLE);
  const pass = paused === 'paused_service' && j.status === 'done' && rows[0].status === 'done' && u.aiCount === 1;
  await cleanup(shop);
  return { name: 'S8 auto-resume sweep · paused job resumed server-side to completion', pass,
    info: { afterFirstRun: paused, finalStatus: j?.status, usage: u.aiCount } };
}

// Phase-2: the engine is kind-aware. A manual job and a bulk job for the SAME
// shop must run on independent queues without colliding, and the bulk generation
// loop must reach completion. (Scan + Shopify write-back need a real shop token,
// so they're verified on staging, not here.)
async function s9() {
  const shop = '__verify_s9__.myshopify.com';
  await cleanup(shop);
  // Manual job
  await seedJob(shop, ['ok', 'ok']);
  await runJob(shop, 'manual');
  // Bulk job for the SAME shop — independent control row + queue (kind='bulk').
  await db.execute({
    sql: `INSERT INTO generation_jobs
            (shop, kind, status, total, done, failed, plan_id, ai_budget, cycle_key,
             mode, instructions, info_fields, phase, applied, errors, source, config, updated_at)
          VALUES (?, 'bulk', 'running', 3, 0, 0, 'starter', 100, ?, 'ai', '', '[]',
                  'generating', 0, 0, 'manual', '{"mode":"ai"}', ?)
          ON CONFLICT(shop, kind) DO UPDATE SET status='running', done=0, phase='generating', updated_at=excluded.updated_at`,
    args: [shop, CYCLE, Date.now()],
  });
  await seedRows(shop, 'bulk', mkItems(shop + '-bulk', ['ok', 'ok', 'ok']), 1);
  const outcome = await runGenerationLoop(shop, 'bulk');
  const man = await queueCounts(shop, 'manual');
  const blk = await queueCounts(shop, 'bulk');
  const u = await getUsage(shop, CYCLE);
  const pass = outcome === 'completed' && man.done === 2 && blk.done === 3 && u.aiCount === 5;
  await cleanup(shop);
  return { name: 'S9 kind-aware · manual + bulk coexist on the same shop, bulk loop completes', pass,
    info: { outcome, manualDone: man.done, bulkDone: blk.done, usage: u.aiCount } };
}

export async function GET() {
  if (process.env.ALTGEN_TEST_HOOK !== '1') {
    return NextResponse.json({ error: 'disabled — set ALTGEN_TEST_HOOK=1 (staging only)' }, { status: 404 });
  }
  runNonce = String(Date.now());
  const scenarios = [s1, s2, s3, s4, s5, s6, s7, s8, s9];
  const results = [];
  for (const fn of scenarios) {
    try {
      results.push(await fn());
    } catch (e) {
      results.push({ name: fn.name, pass: false, error: String(e?.message || e) });
    }
  }
  const passed = results.filter((r) => r.pass).length;
  return NextResponse.json({ ok: passed === results.length, passed, total: results.length, results });
}
