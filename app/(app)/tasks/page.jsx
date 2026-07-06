'use client';

// "Bulk edit tasks": a history of every bulk-edit run (both the
// immediate "Start Bulk Editing" button and scheduled tasks). Each run is one
// row: when it ran, its schedule badge, status, matched / edited counts, the
// filter + editing rules it used, plus Details and Re-create.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ListChecks, Clock, RefreshCw, Info, Loader2, CheckCircle2,
  AlertTriangle, ChevronLeft, ChevronRight, X, RotateCcw, Inbox, Calendar,
  Play, Trash2, Hourglass,
} from 'lucide-react';
import { BASE_PATH } from '@/lib/basePath';
import { authHeaders } from '@/lib/sessionToken';

const PAGE_SIZE = 10;

const TYPE_LABEL = { product: 'Product images', collection: 'Collection images', article: 'Blog post images', file: 'Files' };
const MODE_LABEL = { ai: 'AI vision', ai_custom: 'AI (custom context)', title: 'Product title', template: 'Template', remove: 'Clear alt text' };
const REC_LABEL = { once: 'One time', daily: 'Daily', weekly: 'Weekly' };

// Schedule badge shown under the timestamp (mirrors Hextom's "ONE TIME"/"DAILY").
function scheduleBadge(log) {
  if (log.trigger !== 'schedule') return { label: 'MANUAL', cls: 'bg-slate-100 text-slate-600' };
  if (log.recurrence === 'daily') return { label: 'DAILY SCHEDULE', cls: 'bg-emerald-100 text-emerald-700' };
  if (log.recurrence === 'weekly') return { label: 'WEEKLY SCHEDULE', cls: 'bg-violet-100 text-violet-700' };
  return { label: 'ONE TIME SCHEDULE', cls: 'bg-sky-100 text-sky-700' };
}

function statusChip(status) {
  if (status === 'running') return { label: 'RUNNING', cls: 'bg-indigo-100 text-indigo-700', Icon: Loader2, spin: true };
  if (status === 'error') return { label: 'ERROR', cls: 'bg-rose-100 text-rose-700', Icon: AlertTriangle };
  return { label: 'FINISHED', cls: 'bg-emerald-100 text-emerald-700', Icon: CheckCircle2 };
}

// Human-readable "Editing Rules" cell (what the run did to matched images).
function editingRuleText(config = {}) {
  switch (config.mode) {
    case 'title': return 'Set alt text to the product title';
    case 'template': return `Update alt text with template: ${config.template || '[product_title]'}`;
    case 'remove': return 'Clear alt text';
    case 'ai': return 'Generate alt text with AI vision (describes each image)';
    case 'ai_custom': {
      const bits = [];
      if (Array.isArray(config.infoFields) && config.infoFields.length) bits.push(`using ${config.infoFields.join(', ')}`);
      if (config.instructions) bits.push(`“${config.instructions}”`);
      return `Generate alt text with AI + custom context${bits.length ? ': ' + bits.join('; ') : ''}`;
    }
    default: return MODE_LABEL[config.mode] || config.mode || 'Bulk edit';
  }
}

export default function TasksPage() {
  const searchParams = useSearchParams();
  const shop = searchParams.get('shop');

  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);       // log shown in the Details modal
  const [recreatingId, setRecreatingId] = useState(null);
  const [scheduled, setScheduled] = useState([]);   // upcoming scheduled tasks (not yet run)
  const [busyId, setBusyId] = useState(null);       // scheduled task id currently running / deleting

  // Upcoming scheduled tasks (recurring next-run + one-off not-yet-fired). Their
  // past runs already show in the history table below.
  const loadScheduled = useCallback(async () => {
    if (!shop) return;
    try {
      const res = await fetch(`${BASE_PATH}/api/schedule?shop=${encodeURIComponent(shop)}`, { headers: await authHeaders() });
      const data = await res.json();
      const list = Array.isArray(data.tasks) ? data.tasks : [];
      setScheduled(list.filter((t) => t.status === 'scheduled' || t.status === 'running'));
    } catch { /* ignore */ }
  }, [shop]);

  const load = useCallback(async (opts = {}) => {
    if (!shop) return;
    const { silent = false, toPage = page } = opts;
    if (!silent) setLoading(true);
    try {
      const res = await fetch(
        `${BASE_PATH}/api/bulk/tasks?shop=${encodeURIComponent(shop)}&limit=${PAGE_SIZE}&offset=${toPage * PAGE_SIZE}`,
        { headers: await authHeaders() },
      );
      const data = await res.json();
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setTotal(Number(data.total) || 0);
    } catch {
      /* transient, keep what we have */
    } finally {
      if (!silent) setLoading(false);
    }
  }, [shop, page]);

  useEffect(() => { load({ toPage: page }); loadScheduled(); }, [load, page, loadScheduled]);

  // Keep running rows + upcoming schedules fresh (a task fired from the schedule
  // shows up on its own).
  useEffect(() => {
    if (!shop) return;
    const id = setInterval(() => { load({ silent: true, toPage: page }); loadScheduled(); }, 5000);
    return () => clearInterval(id);
  }, [shop, page, load, loadScheduled]);

  // Run an upcoming scheduled task right now (server-side). It then appears in the
  // history table as RUNNING.
  async function runScheduledNow(task) {
    if (!shop) return;
    setError(null); setMessage(null); setBusyId(task.id);
    try {
      const res = await fetch(`${BASE_PATH}/api/bulk/start?shop=${encodeURIComponent(shop)}`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          sources: task.sources, mode: task.mode, template: task.template,
          scope: task.scope, skipExisting: task.skipExisting,
          infoFields: task.infoFields, instructions: task.instructions,
        }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setMessage('Running now in the background. Watch its status below.');
      setPage(0);
      await Promise.all([load({ toPage: 0 }), loadScheduled()]);
    } catch (e) {
      setError(e.message || 'Could not run the task.');
    } finally {
      setBusyId(null);
    }
  }

  // Cancel an upcoming scheduled task (stops future runs).
  async function deleteScheduled(id) {
    if (!shop) return;
    setError(null); setMessage(null); setBusyId(id);
    try {
      await fetch(`${BASE_PATH}/api/schedule?shop=${encodeURIComponent(shop)}&id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      await loadScheduled();
    } catch (e) {
      setError(e.message || 'Could not delete the task.');
    } finally {
      setBusyId(null);
    }
  }

  // Re-create = re-run immediately with the same config (server-side, tab-free).
  async function recreate(log) {
    if (!shop) return;
    setError(null); setMessage(null); setRecreatingId(log.id);
    try {
      const c = log.config || {};
      const res = await fetch(`${BASE_PATH}/api/bulk/start?shop=${encodeURIComponent(shop)}`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          sources: c.sources || [],
          mode: c.mode,
          template: c.template || '',
          scope: c.scope || 'missing',
          skipExisting: !!c.skipExisting,
          infoFields: c.infoFields || [],
          instructions: c.instructions || '',
        }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setMessage('Re-created this task. It’s running in the background, and a new row will appear here.');
      setPage(0);
      await load({ toPage: 0 });
    } catch (e) {
      setError(e.message || 'Could not re-create the task.');
    } finally {
      setRecreatingId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      {/* Premium header */}
      <header className="animate-card-in relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-violet-50 via-white to-indigo-50/60 p-6 shadow-sm sm:p-7">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-violet-200/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/4 h-52 w-52 rounded-full bg-fuchsia-200/25 blur-3xl" />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-violet-600 shadow-sm ring-1 ring-violet-100">
            <ListChecks className="h-3.5 w-3.5" /> Bulk edit tasks
          </span>
          <div className="mt-3 flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-50 to-violet-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
              <ListChecks className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              Task{' '}
              <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">history</span>
            </h1>
          </div>
          <p className="mt-2.5 max-w-xl text-base leading-relaxed text-slate-600">
            Every bulk edit you have run, manual or scheduled, with what it matched, what it changed, and the rules it used.
          </p>
        </div>
      </header>

      {message ? (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> <span>{message}</span>
        </div>
      ) : null}
      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span>
        </div>
      ) : null}

      {/* Scheduled (upcoming): pending tasks that haven't run yet */}
      {scheduled.length ? (
        <div className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50/60 px-5 py-3">
            <Hourglass className="h-4 w-4 text-amber-600" />
            <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">Scheduled · upcoming</span>
          </div>
          <div className="divide-y divide-slate-50">
            {scheduled.map((t) => {
              const running = t.status === 'running';
              const typeText = (t.sources || []).map((s) => TYPE_LABEL[s] || s).join(', ') || 'All images';
              return (
                <div key={t.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold tracking-wide text-sky-700">
                        <RefreshCw className="h-2.5 w-2.5" /> {(REC_LABEL[t.recurrence] || t.recurrence).toUpperCase()}
                      </span>
                      {running ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold tracking-wide text-indigo-700">
                          <Loader2 className="h-2.5 w-2.5 animate-spin" /> RUNNING
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold tracking-wide text-amber-700">
                          <Hourglass className="h-2.5 w-2.5" /> PENDING
                        </span>
                      )}
                      <span className="text-sm font-medium text-slate-800">{typeText}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      {running ? 'Running now…' : `Next run: ${new Date(t.nextRunAt).toLocaleString()}`}
                      {' · '}{editingRuleText(t)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => runScheduledNow(t)}
                      disabled={busyId === t.id || running}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      {busyId === t.id || running ? <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" /> : <Play className="h-3.5 w-3.5 text-indigo-500" />}
                      {running ? 'Running' : 'Run now'}
                    </button>
                    <button
                      onClick={() => deleteScheduled(t.id)}
                      disabled={busyId === t.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* History header + pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Task history {total ? `· ${total} total` : ''}
        </span>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-600">Page {page + 1} of {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Prev
          </button>
          <button
            onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
            disabled={page + 1 >= totalPages}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-16 text-sm text-slate-600 shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading tasks…
        </div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-16 text-center shadow-sm">
          <Inbox className="h-8 w-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-700">No bulk edit tasks yet</p>
          <p className="max-w-sm text-sm text-slate-600">
            Run or schedule a bulk edit from <span className="font-semibold text-indigo-600">Generate &amp; embed</span> and it will show up here with its status.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => {
            const badge = scheduleBadge(log);
            const chip = statusChip(log.status);
            const c = log.config || {};
            const typeText = (c.sources || []).map((s) => TYPE_LABEL[s] || s).join(', ') || 'All images';
            return (
              <div key={log.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md">
                {/* Header: timestamp + badges  ·  actions */}
                <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{new Date(log.createdAt).toLocaleString()}</span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ${badge.cls}`}>
                      {log.trigger === 'schedule' ? <RefreshCw className="h-2.5 w-2.5" /> : <Calendar className="h-2.5 w-2.5" />}
                      {badge.label}
                    </span>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide ${chip.cls}`}>
                      <chip.Icon className={`h-3 w-3 ${chip.spin ? 'animate-spin' : ''}`} /> {chip.label}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => setDetail(log)}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      <Info className="h-3.5 w-3.5" /> Details
                    </button>
                    <button
                      onClick={() => recreate(log)}
                      disabled={recreatingId === log.id || c.mode == null}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {recreatingId === log.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <RotateCcw className="h-3.5 w-3.5" />}
                      Re-create
                    </button>
                  </div>
                </div>

                {/* Body: three labeled fields */}
                <div className="mt-4 grid gap-5 sm:grid-cols-3">
                  {/* Edited items */}
                  <div>
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Edited items</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                        Matched {log.matched}
                      </span>
                      {log.status === 'running' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600">
                          <Loader2 className="h-3 w-3 animate-spin" /> In progress…
                        </span>
                      ) : (
                        <span className="inline-flex rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                          Edited {log.edited}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Filter conditions */}
                  <div>
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Filter conditions</div>
                    <div className="text-sm text-slate-600">
                      <div><span className="font-medium text-slate-700">Type:</span> {typeText}</div>
                      <div className="mt-0.5">
                        <span className="font-medium text-slate-700">Scope:</span>{' '}
                        {c.scope === 'all' ? 'All matching images' : 'Only missing alt text'}
                      </div>
                    </div>
                  </div>

                  {/* Editing rules */}
                  <div>
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Editing rules</div>
                    <div className="text-sm text-slate-600">{editingRuleText(c)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Details modal */}
      {detail ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setDetail(null)}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-bold text-slate-900">Task details</h2>
              <button onClick={() => setDetail(null)} className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 px-5 py-4 text-sm">
              <DetailRow label="Created at" value={new Date(detail.createdAt).toLocaleString()} />
              {detail.finishedAt ? <DetailRow label="Finished at" value={new Date(detail.finishedAt).toLocaleString()} /> : null}
              <DetailRow label="Trigger" value={scheduleBadge(detail).label} />
              <DetailRow label="Status" value={statusChip(detail.status).label} />
              <DetailRow label="Matched" value={`${detail.matched} image${detail.matched === 1 ? '' : 's'}`} />
              <DetailRow label="Edited" value={`${detail.edited} image${detail.edited === 1 ? '' : 's'}`} />
              <DetailRow label="Image type" value={(detail.config?.sources || []).map((s) => TYPE_LABEL[s] || s).join(', ') || 'All images'} />
              <DetailRow label="Scope" value={detail.config?.scope === 'all' ? 'All matching images' : 'Only images missing alt text'} />
              <DetailRow label="Editing rules" value={editingRuleText(detail.config || {})} />
              {detail.note ? (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">Summary</div>
                  <p className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-slate-700">{detail.note}</p>
                </div>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button
                onClick={() => setDetail(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Close
              </button>
              <button
                onClick={() => { const d = detail; setDetail(null); recreate(d); }}
                disabled={detail.config?.mode == null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" /> Re-create
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Note */}
      <div className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
        <span>Scheduled tasks run on our servers even when this tab is closed. Each run adds a new row here.</span>
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</span>
      <span className="text-right font-medium text-slate-800">{value}</span>
    </div>
  );
}
