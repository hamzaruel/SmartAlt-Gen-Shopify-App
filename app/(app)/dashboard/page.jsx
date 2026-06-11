'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ScanLine,
  ArrowRight,
  Loader2,
  X,
  Search,
  MousePointerClick,
  Wand2,
  UploadCloud,
  Info,
  Images as ImagesIcon,
  LayoutGrid,
  AlertTriangle,
  CheckCircle2,
  Package,
  Layers,
  BookOpen,
  FileText,
  SlidersHorizontal,
  Trash2,
  Clock,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const SOURCES = [
  { id: 'product', label: 'Products', icon: Package },
  { id: 'collection', label: 'Collections', icon: Layers },
  { id: 'article', label: 'Blog posts', icon: BookOpen },
  { id: 'file', label: 'Files', icon: FileText },
];
import { loadScan, saveScan } from '@/lib/scanStore';
import { authHeaders } from '@/lib/sessionToken';
import { BASE_PATH } from '@/lib/basePath';
import { loadSettings } from '@/lib/settings';
import { loadActivity, logActivity, relativeTime } from '@/lib/activity';

const STEPS = [
  { title: 'Scan', text: 'Find every image across products, collections, blogs and files, and see which need alt text.', icon: Search, ring: 'bg-sky-100 text-sky-600' },
  { title: 'Choose', text: 'Pick an image type and how to edit: a custom template or AI.', icon: MousePointerClick, ring: 'bg-indigo-100 text-indigo-600' },
  { title: 'Generate', text: 'Get clean, accessible alt text under 120 characters.', icon: Wand2, ring: 'bg-violet-100 text-violet-600' },
  { title: 'Embed', text: 'Save the alt text straight back into Shopify in one click.', icon: UploadCloud, ring: 'bg-emerald-100 text-emerald-600' },
];

function Divider() {
  return <div className="h-px w-full bg-gradient-to-r from-transparent via-slate-200 to-transparent" />;
}

const ACTIVITY_META = {
  scan:     { icon: ScanLine,    chip: 'bg-sky-100 text-sky-600',         text: (a) => `Scanned your store, ${(a.count || 0).toLocaleString()} image${a.count === 1 ? '' : 's'} found` },
  generate: { icon: Wand2,       chip: 'bg-violet-100 text-violet-600',   text: (a) => `Generated alt text for ${a.count} image${a.count === 1 ? '' : 's'}` },
  embed:    { icon: UploadCloud, chip: 'bg-emerald-100 text-emerald-600', text: (a) => `Saved alt text to ${a.count} image${a.count === 1 ? '' : 's'} in Shopify` },
  clear:    { icon: Trash2,      chip: 'bg-rose-100 text-rose-600',       text: (a) => `Cleared alt text from ${a.count} image${a.count === 1 ? '' : 's'}` },
};

const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);

// Drives a linear 0→1 progress over `duration` ms, restarting whenever `trigger`
// changes — used to "fill up" the donut + bars realistically on load / re-scan.
function useProgress(trigger, duration = 1300) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf;
    let start = null;
    setP(0);
    const tick = (now) => {
      if (start === null) start = now;
      const x = Math.min(1, (now - start) / duration);
      setP(x);
      if (x < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [trigger, duration]);
  return p;
}

export default function DashboardPage() {
  const searchParams = useSearchParams();
  const shop = searchParams.get('shop');
  const host = searchParams.get('host');
  const qs = `?shop=${encodeURIComponent(shop || '')}&host=${encodeURIComponent(host || '')}`;

  const [stats, setStats] = useState(null);
  const [images, setImages] = useState([]);
  const [scannedAt, setScannedAt] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanCount, setScanCount] = useState(0); // live "images found so far" while scanning
  const [error, setError] = useState(null);
  const [disabledLabels, setDisabledLabels] = useState([]); // sources turned off in Settings
  const [activity, setActivity] = useState([]); // recent activity log (newest-first)
  const [actPage, setActPage] = useState(0);    // activity pagination

  useEffect(() => {
    const enabled = loadSettings(shop).scanSources;
    setDisabledLabels(SOURCES.filter((s) => !enabled.includes(s.id)).map((s) => s.label));
    setActivity(loadActivity(shop));
  }, [shop]);

  // 0→1 fill progress, restarts on each scan (and when cached results first appear)
  const reveal = useProgress(scannedAt);

  useEffect(() => {
    const cached = loadScan(shop);
    if (cached) {
      setStats(cached.stats);
      setImages(cached.images || []);
      setScannedAt(cached.scannedAt);
    }
  }, [shop]);

  const runScan = useCallback(async () => {
    if (!shop || scanning) return;
    setScanning(true);
    setError(null);
    setScanCount(0);
    try {
      // Packet-by-packet loop: each call fetches one bounded packet and hands back
      // a `next` pointer. We keep going until the store is fully scanned — no single
      // request runs long enough to time out, so it scales to large stores.
      const all = [];
      let state = null;
      const allowedSources = loadSettings(shop).scanSources; // only scan sources enabled in Settings
      const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
      let guard = 0;
      do {
        const res = await fetch(`${BASE_PATH}/api/scan?shop=${encodeURIComponent(shop)}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ state, allowedSources }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (data.images?.length) all.push(...data.images);
        state = data.next || null;
        setScanCount(all.length); // live progress
        guard += 1;
      } while (state && guard < 5000);

      const saved = saveScan(shop, all);
      setStats(saved.stats);
      setImages(all);
      setScannedAt(saved.scannedAt);
      logActivity(shop, { type: 'scan', count: all.length });
      setActivity(loadActivity(shop));
    } catch (e) {
      setError(e.message || 'Scan failed');
    } finally {
      setScanning(false);
    }
  }, [shop, scanning]);

  const total = stats?.total || 0;
  const scanned = stats != null;
  const missing = stats?.missing || 0;
  const withAlt = Math.max(0, total - missing);
  const coverage = total > 0 ? Math.round((withAlt / total) * 100) : 0;
  const ring = 2 * Math.PI * 52; // donut circumference (r=52)
  const ringEase = easeOutCubic(reveal);
  const animCoverage = coverage * ringEase; // donut sweep + count-up
  const animTotal = Math.round(total * ringEase); // tile numbers count up in sync
  const animWithAlt = Math.round(withAlt * ringEase);
  const animMissing = Math.round(missing * ringEase);
  const sourceStats = SOURCES.map((s) => {
    const imgs = images.filter((i) => i.source === s.id);
    const miss = imgs.filter((i) => i.status === 'MISSING').length;
    return { ...s, total: imgs.length, withAlt: imgs.length - miss };
  }).filter((s) => s.total > 0);

  // Activity: stored newest-first; show 5 per page and display each page oldest→newest
  // (top to bottom), so a page reads in the order things happened.
  const ACT_PAGE = 5;
  const actTotalPages = Math.max(1, Math.ceil(activity.length / ACT_PAGE));
  const actSafe = Math.min(actPage, actTotalPages - 1);
  const actItems = activity.slice(actSafe * ACT_PAGE, actSafe * ACT_PAGE + ACT_PAGE).slice().reverse();

  return (
    <div className="space-y-10">
      {error ? (
        <div className="flex items-start justify-between gap-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="shrink-0 text-rose-400 hover:text-rose-600" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {/* ===== HERO ===== */}
      <section className="rounded-2xl bg-gradient-to-b from-indigo-50 to-white px-6 py-12 text-center sm:py-14">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-[40px]">
          Every image, properly described
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-base text-slate-600">
          <span className="font-semibold text-indigo-600">SmartAltGen</span>
          <span className="mx-1.5 text-slate-300">•</span>
          Alt text for every image
        </p>

        <div className="mt-8 flex justify-center">
          <button
            onClick={runScan}
            disabled={!shop || scanning}
            className="group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-8 py-3.5 text-base font-semibold text-white shadow-md shadow-indigo-500/20 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/40 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:shadow-md"
          >
            {/* light sheen that sweeps across on hover */}
            <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full" />
            <span className="relative flex items-center gap-2">
              {scanning ? <Search className="h-5 w-5 animate-scan" /> : <ScanLine className="h-5 w-5 transition-transform duration-300 group-hover:scale-110" />}
              {scanning ? 'Scanning…' : 'Scan now'}
            </span>
          </button>
        </div>

        {scanning ? (
          <p className="mt-3 text-sm text-slate-600">This can take a moment on large stores.</p>
        ) : scannedAt ? (
          <p className="mt-3 text-sm text-slate-600">Last scanned {new Date(scannedAt).toLocaleString()}</p>
        ) : (
          <p className="mt-3 text-sm text-slate-600">Scans your products, files &amp; blog images in one click.</p>
        )}
      </section>

      {/* ===== Disabled-sources note (some sources turned off in Settings) ===== */}
      {disabledLabels.length ? (
        <div className="flex items-start gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-100">
          <SlidersHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p>
            <span className="font-semibold">{disabledLabels.join(', ')}</span>{' '}
            {disabledLabels.length === 1 ? 'is' : 'are'} turned off in Settings, so {disabledLabels.length === 1 ? 'its' : 'their'} images aren’t scanned.{' '}
            <a href={`${BASE_PATH}/settings${qs}`} className="font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950">
              Manage in Settings
            </a>
          </p>
        </div>
      ) : null}

      {/* ===== Live scan progress (shown only while scanning) ===== */}
      {scanning ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
              <Loader2 className="h-5 w-5 animate-spin" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800">Scanning your store…</p>
              <p className="mt-0.5 text-sm text-slate-600">
                <span className="font-semibold text-indigo-600 tabular-nums">{scanCount.toLocaleString()}</span> images found so far
              </p>
            </div>
          </div>
          {/* indeterminate sweeping bar (total isn't known until the scan finishes) */}
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-indigo-400 to-violet-500 animate-scanbar" />
          </div>
        </section>
      ) : null}

      {/* ===== Store overview (hidden while (re)scanning, reappears + re-animates when done) ===== */}
      {scanned && !scanning ? (
        <>
          <Divider />
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Store overview</h2>
              <span className="text-sm text-slate-600">across your whole store</span>
            </div>

            {/* Headline tiles — entrance on the wrapper, hover lift on the inner card
                (kept separate so the animation's transform doesn't block the hover) */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="animate-card-in" style={{ animationDelay: '0ms' }}>
                <div className="h-full cursor-default rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100 transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-lg hover:ring-slate-200">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><LayoutGrid className="h-4 w-4" /></div>
                  <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">{animTotal.toLocaleString()}</div>
                  <div className="text-sm text-slate-600">Total images</div>
                </div>
              </div>
              <div className="animate-card-in" style={{ animationDelay: '90ms' }}>
                <div className="h-full cursor-default rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-100 transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-lg hover:shadow-emerald-500/20 hover:ring-emerald-200">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600"><CheckCircle2 className="h-4 w-4" /></div>
                  <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">{animWithAlt.toLocaleString()}</div>
                  <div className="text-sm text-slate-600">With alt text</div>
                </div>
              </div>
              <div className="animate-card-in" style={{ animationDelay: '180ms' }}>
                <div className="h-full cursor-default rounded-2xl bg-rose-50 p-4 ring-1 ring-rose-100 transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-lg hover:shadow-rose-500/20 hover:ring-rose-200">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-600"><AlertTriangle className="h-4 w-4" /></div>
                  <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">{animMissing.toLocaleString()}</div>
                  <div className="text-sm text-slate-600">Missing alt</div>
                </div>
              </div>
            </div>

            {/* Overall coverage — donut ring (entrance on wrapper, hover lift on inner) */}
            <div className="animate-card-in mt-6" style={{ animationDelay: '260ms' }}>
            <div className="flex flex-col items-center gap-6 rounded-2xl bg-gradient-to-br from-indigo-50/70 via-white to-white p-6 ring-1 ring-slate-100 transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-lg hover:shadow-indigo-500/15 hover:ring-indigo-200 sm:flex-row sm:gap-8">
              <div className="relative h-36 w-36 shrink-0">
                <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                  <defs>
                    <linearGradient id="covGrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#34d399" />
                      <stop offset="100%" stopColor="#059669" />
                    </linearGradient>
                  </defs>
                  {/* track = missing portion (rose); green arc on top = covered */}
                  <circle cx="60" cy="60" r="52" fill="none" stroke="#fb7185" strokeWidth="11" />
                  <circle
                    cx="60" cy="60" r="52" fill="none" stroke="url(#covGrad)" strokeWidth="11"
                    strokeLinecap="round"
                    strokeDasharray={ring}
                    strokeDashoffset={ring * (1 - animCoverage / 100)}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold tracking-tight text-slate-900 tabular-nums">{Math.round(animCoverage)}%</span>
                  <span className="text-xs font-medium text-slate-500">covered</span>
                </div>
              </div>

              <div className="flex-1 text-center sm:text-left">
                <h3 className="text-base font-semibold text-slate-800">Alt text coverage</h3>
                <p className="mt-1 text-sm text-slate-600">
                  <span className="font-semibold text-slate-700 tabular-nums">{animWithAlt.toLocaleString()}</span> of {total.toLocaleString()} images already have alt text.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-2 sm:justify-start">
                  <span className="inline-flex items-center gap-2 text-sm text-slate-600">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    With alt <span className="font-semibold text-slate-800 tabular-nums">{animWithAlt.toLocaleString()}</span>
                  </span>
                  <span className="inline-flex items-center gap-2 text-sm text-slate-600">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                    Missing <span className="font-semibold text-slate-800 tabular-nums">{animMissing.toLocaleString()}</span>
                  </span>
                </div>
              </div>
            </div>
            </div>

            {/* Coverage by source */}
            {sourceStats.length ? (
              <div className="mt-6 space-y-4 border-t border-slate-100 pt-5">
                <p className="animate-card-in text-xs font-semibold uppercase tracking-wide text-slate-500" style={{ animationDelay: '340ms' }}>Coverage by source</p>
                {sourceStats.map(({ id, label, icon: Icon, total: t, withAlt: w }, i) => {
                  const pct = t > 0 ? Math.round((w / t) * 100) : 0;
                  // staggered fill: each bar starts a little after the previous one
                  const barEase = easeOutCubic(Math.min(1, Math.max(0, (reveal - i * 0.12) / 0.6)));
                  return (
                    <div key={id} className="animate-card-in -mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors duration-200 hover:bg-slate-50" style={{ animationDelay: `${400 + i * 90}ms` }}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-slate-100"><Icon className="h-4 w-4" /></span>
                      <span className="w-24 shrink-0 text-sm font-medium text-slate-600">{label}</span>
                      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-violet-500" style={{ width: `${pct * barEase}%` }} />
                      </div>
                      <span className="w-12 shrink-0 text-right text-xs font-semibold text-slate-500 tabular-nums">{Math.round(pct * barEase)}%</span>
                      <span className="w-14 shrink-0 text-right text-xs text-slate-500 tabular-nums">{w}/{t}</span>
                    </div>
                  );
                })}
              </div>
            ) : null}

          </section>

          {/* View all images — outside the card */}
          <div className="flex flex-col items-center gap-2.5 text-center">
            <a
              href={`${BASE_PATH}/images${qs}`}
              className="group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-7 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/40 active:translate-y-0 active:scale-[0.98]"
            >
              {/* light sheen that sweeps across on hover */}
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full" />
              <span className="relative flex items-center gap-2">
                <ImagesIcon className="h-4 w-4" />
                See all images
                <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
              </span>
            </a>
            <p className="text-sm text-slate-600">Browse every image in your store and review its alt text.</p>
          </div>
        </>
      ) : null}

      {/* ===== Recent activity ===== */}
      {activity.length ? (
        <>
          <Divider />
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              <Clock className="h-4 w-4" /> Recent activity
            </h2>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <ol>
                {actItems.map((a, i, arr) => {
                  const meta = ACTIVITY_META[a.type] || ACTIVITY_META.scan;
                  const Icon = meta.icon;
                  const last = i === arr.length - 1;
                  return (
                    <li key={a.ts} className="animate-fade-in relative flex gap-4 pb-5 last:pb-0" style={{ animationDelay: `${i * 60}ms` }}>
                      {!last ? <span className="absolute left-5 top-11 bottom-0 w-px bg-slate-200" /> : null}
                      <span className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${meta.chip}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1 pt-1.5">
                        <p className="text-sm font-medium text-slate-800">{meta.text(a)}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {relativeTime(a.ts)} <span className="text-slate-300">·</span> {new Date(a.ts).toLocaleString()}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>

              {actTotalPages > 1 ? (
                <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-4">
                  <span className="text-xs text-slate-500">
                    {activity.length} total <span className="text-slate-300">·</span> page {actSafe + 1} of {actTotalPages}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setActPage((p) => Math.max(0, p - 1))}
                      disabled={actSafe === 0}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" /> Newer
                    </button>
                    <button
                      onClick={() => setActPage((p) => Math.min(actTotalPages - 1, p + 1))}
                      disabled={actSafe >= actTotalPages - 1}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
                    >
                      Older <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </>
      ) : null}

      <Divider />

      {/* ===== How it works ===== */}
      <section>
        <h2 className="mb-5 text-center text-sm font-semibold uppercase tracking-wide text-slate-500">How it works</h2>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ title, text, icon: Icon, ring }, i) => (
            <div key={title} className="group text-center">
              <div
                className={`animate-float mx-auto flex h-11 w-11 items-center justify-center rounded-full shadow-sm transition-shadow duration-300 group-hover:shadow-md ${ring}`}
                style={{ animationDelay: `${i * 0.4}s` }}
              >
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-3 text-base font-semibold text-slate-800">{i + 1}. {title}</h3>
              <p className="mx-auto mt-1 max-w-[15rem] text-sm text-slate-600">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <Divider />

      {/* ===== WCAG tip (slim soft callout) ===== */}
      <div className="flex items-start gap-3 rounded-2xl bg-sky-50 px-4 py-3 text-sm text-slate-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
        <p>
          Alt text lets screen readers describe images and boosts image SEO. WCAG recommends concise,
          meaningful text, so SmartAltGen keeps every alt under 120 characters.
        </p>
      </div>

    </div>
  );
}
