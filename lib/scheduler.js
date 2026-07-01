// Scheduled bulk-edit ticker. Booted once per server process by instrumentation.js.
// Every minute it picks tasks whose next_run_at has passed, runs them through the
// same pipeline as the immediate "Start Bulk Editing" button, then re-arms daily/
// weekly tasks (or finishes a one-off). It self-heals after a restart because due
// state lives in Turso, not memory.
import { getDueTasks, markRunning, finishRun, markError } from '@/lib/scheduledTasks';
import { runBulkEdit } from '@/lib/bulkRun';
import { sweepResumableJobs, cleanupQueue } from '@/lib/generationJob';

const TICK_MS = 60 * 1000;
const CLEANUP_EVERY_TICKS = 60; // ~hourly TTL sweep

let started = false;
let ticking = false;
let tickCount = 0;

async function tick() {
  if (ticking) return; // never overlap ticks
  ticking = true;
  try {
    // Resume any AI-generation jobs whose pause window has elapsed (quota cycle
    // reset / service-outage backoff). Tab-independent — runs with no merchant open.
    try { await sweepResumableJobs(); } catch (e) { console.error('resume sweep error:', e?.message || e); }
    if (++tickCount % CLEANUP_EVERY_TICKS === 0) {
      try { await cleanupQueue(); } catch (e) { console.error('queue cleanup error:', e?.message || e); }
    }

    const due = await getDueTasks();
    for (const task of due) {
      // Atomic claim — guards against a second instance/tick grabbing the same task.
      const claimed = await markRunning(task.id);
      if (!claimed) continue;
      try {
        const summary = await runBulkEdit(task.shop, {
          sources: task.sources,
          mode: task.mode,
          template: task.template,
          scope: task.scope,
          skipExisting: task.skipExisting,
          infoFields: task.infoFields,
          instructions: task.instructions,
          triggeredBy: 'schedule',
          recurrence: task.recurrence, // stamps the task-log row's schedule badge
        });
        await finishRun(task, summary);
        console.log(`⏰ Ran scheduled task ${task.id} for ${task.shop}:`, summary?.note || summary?.error || 'ok');
      } catch (e) {
        console.error(`⏰ Scheduled task ${task.id} failed:`, e?.message || e);
        // Re-arm recurring tasks so a transient failure doesn't strand them.
        if (task.recurrence === 'once') await markError(task.id, e?.message);
        else await finishRun(task, { error: String(e?.message || e).slice(0, 200) });
      }
    }
  } catch (e) {
    console.error('scheduler tick error:', e?.message || e);
  } finally {
    ticking = false;
  }
}

export function startScheduler() {
  if (started) return;
  started = true;
  console.log('⏰ Bulk-edit scheduler started (60s tick)');
  // First sweep shortly after boot (catch up on anything missed while down),
  // then on a fixed interval.
  setTimeout(tick, 8000);
  setInterval(tick, TICK_MS);
}
