'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ScanLine,
  ArrowRight,
  Loader2,
  X,
  Sparkles,
  Search,
  MousePointerClick,
  Wand2,
  UploadCloud,
  Info,
  Images as ImagesIcon,
  LayoutGrid,
  AlertTriangle,
  AlertCircle,
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
import { loadScan, saveScan, hydrateScan } from '@/lib/scanStore';
import { authHeaders } from '@/lib/sessionToken';
import { BASE_PATH } from '@/lib/basePath';
import { loadSettings } from '@/lib/settings';
import { loadActivity, logActivity, relativeTime } from '@/lib/activity';

const STEPS = [
  { title: 'Scan', text: 'Find every image in your store and see which need alt text.', icon: Search, grad: 'from-sky-500 to-sky-600 shadow-sky-500/30' },
  { title: 'Choose', text: 'Pick an image type, then a template or AI.', icon: MousePointerClick, grad: 'from-indigo-500 to-indigo-600 shadow-indigo-500/30' },
  { title: 'Generate', text: 'Get clean, SEO-friendly alt text in seconds.', icon: Wand2, grad: 'from-violet-500 to-violet-600 shadow-violet-500/30' },
  { title: 'Embed', text: 'Save it back to Shopify in one click.', icon: UploadCloud, grad: 'from-emerald-500 to-emerald-600 shadow-emerald-500/30' },
];

function Divider() {
  return <div className="h-px w-full bg-gradient-to-r from-transparent via-slate-200 to-transparent" />;
}

const ACTIVITY_META = {
  scan:     { icon: ScanLine,    chip: 'bg-sky-100 text-sky-600',         grad: 'from-sky-500 to-sky-600 shadow-sky-500/30',         tag: 'Scan',     text: (a) => `Scanned your store, ${(a.count || 0).toLocaleString()} image${a.count === 1 ? '' : 's'} found` },
  generate: { icon: Wand2,       chip: 'bg-violet-100 text-violet-600',   grad: 'from-violet-500 to-violet-600 shadow-violet-500/30',   tag: 'Generate', text: (a) => `Generated alt text for ${a.count} image${a.count === 1 ? '' : 's'}` },
  embed:    { icon: UploadCloud, chip: 'bg-emerald-100 text-emerald-600', grad: 'from-emerald-500 to-emerald-600 shadow-emerald-500/30', tag: 'Embed',    text: (a) => `Saved alt text to ${a.count} image${a.count === 1 ? '' : 's'} in Shopify` },
  clear:    { icon: Trash2,      chip: 'bg-rose-100 text-rose-600',       grad: 'from-rose-500 to-rose-600 shadow-rose-500/30',       tag: 'Clear',    text: (a) => `Cleared alt text from ${a.count} image${a.count === 1 ? '' : 's'}` },
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

  const overviewRef = useRef(null);             // scroll target after a fresh scan
  const [pendingScroll, setPendingScroll] = useState(false);

  // After a fresh scan finishes and the overview renders, smooth-scroll it into view.
  useEffect(() => {
    if (pendingScroll && !scanning && overviewRef.current) {
      overviewRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setPendingScroll(false);
    }
  }, [pendingScroll, scanning]);

  useEffect(() => {
    const enabled = loadSettings(shop).scanSources;
    setDisabledLabels(SOURCES.filter((s) => !enabled.includes(s.id)).map((s) => s.label));
    setActivity(loadActivity(shop));
  }, [shop]);

  // 0→1 fill progress, restarts on each scan (and when cached results first appear)
  const reveal = useProgress(scannedAt);

  useEffect(() => {
    let alive = true;
    // Local cache first, else restore from the server (survives tab close / new device).
    hydrateScan(shop).then((cached) => {
      if (!alive || !cached) return;
      setStats(cached.stats);
      setImages(cached.images || []);
      setScannedAt(cached.scannedAt);
    });
    return () => {
      alive = false;
    };
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
      setPendingScroll(true); // auto-focus the overview once it renders
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
  const needsImprovement = stats?.needsImprovement || 0;
  const animNeeds = Math.round(needsImprovement * ringEase);
  const optimized = Math.max(0, total - missing - needsImprovement);
  const animOptimized = Math.round(optimized * ringEase);
  // donut: three segments (optimized green, needs-work amber, missing rose) that
  // fill clockwise in order as ringEase sweeps 0→1.
  const fOpt = total ? optimized / total : 0;
  const fNeeds = total ? needsImprovement / total : 0;
  const fMiss = total ? missing / total : 0;
  const segLen = (start, frac) => ring * Math.min(frac, Math.max(0, ringEase - start));
  const greenLen = segLen(0, fOpt);
  const amberLen = segLen(fOpt, fNeeds);
  const roseLen = segLen(fOpt + fNeeds, fMiss);
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
        <div className="flex items-start justify-between gap-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="shrink-0 text-rose-400 hover:text-rose-600" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {/* ===== HERO (white card) ===== */}
      <section className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm sm:p-9">
        <div className="grid items-center gap-10 lg:grid-cols-[0.85fr_1.2fr]">
          {/* LEFT: copy + CTA (left-aligned) */}
          <div className="text-left">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-indigo-600 shadow-sm ring-1 ring-indigo-100">
              <Sparkles className="h-3.5 w-3.5" /> Image SEO &amp; Accessibility
            </span>
            <h1 className="mt-4 text-3xl font-bold leading-[1.25] tracking-[0.01em] text-slate-900 sm:text-4xl sm:leading-[1.25]">
              Every image,<br />
              <span className="whitespace-nowrap bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">described properly</span>
            </h1>
            <p className="mt-4 max-w-md text-base leading-relaxed text-slate-600">
              <span className="font-semibold text-indigo-600">SEO-friendly alt text</span> for{' '}
              <span className="font-semibold text-violet-600">every image</span> in{' '}
              <span className="font-semibold text-indigo-600">one click</span>, so your store ranks higher and stays accessible.
            </p>

            {/* prompt + 3D push button */}
            <div className="mt-9 flex flex-col items-start gap-4">
              <button
                onClick={runScan}
                disabled={!shop || scanning}
                className="btn-3d group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-9 py-4 text-base font-bold text-white focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-80"
              >
                {/* light sheen that sweeps across on hover */}
                <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full" />
                <span className="relative flex items-center gap-2.5">
                  {scanning ? <Search className="h-5 w-5 animate-scan" /> : <ScanLine className="h-5 w-5 transition-transform duration-300 group-hover:scale-110" />}
                  {scanning ? 'Scanning your store…' : 'Scan now'}
                </span>
              </button>

              {scanning ? (
                <p className="text-sm text-slate-500">This can take a moment on large stores.</p>
              ) : scannedAt ? (
                <p className="text-sm font-semibold text-slate-700">Last scanned {new Date(scannedAt).toLocaleString()}</p>
              ) : (
                <p className="max-w-sm text-sm text-slate-500">
                  Press <span className="font-semibold text-slate-700">Scan now</span> to check every image across your whole store, products, files and blog posts.
                </p>
              )}
            </div>
          </div>

          {/* RIGHT: dashboard preview illustration (tilt on the wrapper, gentle
              float on the image — kept separate so the transforms don't fight) */}
          <div className="hidden justify-center lg:flex lg:justify-end" aria-hidden="true">
            <div className="[transform:perspective(1300px)_rotateY(-11deg)_rotateX(4deg)]">
              <img
                src={`${BASE_PATH}/hero-dashboard.png`}
                alt=""
                className="animate-float w-full max-w-md xl:max-w-lg rounded-xl border border-slate-200 shadow-2xl shadow-indigo-500/25"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ===== Disabled-sources note (some sources turned off in Settings) ===== */}
      {disabledLabels.length ? (
        <div className="flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-100">
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
        <section className="rounded-xl border border-slate-200/80 bg-white p-10 shadow-sm sm:p-14">
          <div className="flex flex-col items-center text-center">
            {/* soft spinner ring */}
            <div className="relative h-14 w-14">
              <span className="absolute inset-0 rounded-full border-[3px] border-slate-100" />
              <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-transparent border-t-indigo-500" />
              <span className="absolute inset-0 flex items-center justify-center">
                <Search className="h-5 w-5 text-indigo-500" />
              </span>
            </div>

            <h3 className="mt-6 text-base font-semibold text-slate-900">Scanning your store…</h3>
            <p className="mt-1.5 text-sm text-slate-500">Finding every image across products, collections, blogs and files.</p>

            {/* live count — soft */}
            <div className="mt-6 flex items-baseline gap-1.5">
              <span className="text-3xl font-bold text-slate-900 tabular-nums">{scanCount.toLocaleString()}</span>
              <span className="text-sm text-slate-500">images found so far</span>
            </div>

            {/* indeterminate sweeping bar (total isn't known until the scan finishes) */}
            <div className="mt-6 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-slate-100">
              <div className="h-full w-1/3 rounded-full bg-indigo-500/80 animate-scanbar" />
            </div>
            <p className="mt-4 text-xs text-slate-500">This can take a moment on large stores. Please keep this tab open.</p>
          </div>
        </section>
      ) : null}

      {/* ===== Store overview (hidden while (re)scanning, reappears + re-animates when done) ===== */}
      {scanned && !scanning ? (
        <>
          <section ref={overviewRef} className="scroll-mt-6 rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm sm:p-9">
            {/* header */}
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-slate-900">My store overview</h2>
              <p className="mt-1 text-sm text-slate-500">Alt text coverage across your whole store</p>
            </div>

            {/* KPI row — soft blended icon chip overlapping the top border */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-9 pt-3 lg:grid-cols-4">
              {[
                { label: 'Total store images', value: animTotal, chip: 'bg-indigo-50 text-indigo-600 ring-indigo-100', Icon: LayoutGrid },
                { label: 'Images with alt text', value: animWithAlt, chip: 'bg-emerald-50 text-emerald-600 ring-emerald-100', Icon: CheckCircle2 },
                { label: 'Missing alt text', value: animMissing, chip: 'bg-rose-50 text-rose-600 ring-rose-100', Icon: AlertTriangle },
                { label: 'Needs improvement', value: animNeeds, chip: 'bg-amber-50 text-amber-600 ring-amber-100', Icon: AlertCircle },
              ].map(({ label, value, chip, Icon }, i) => (
                <div key={label} className="animate-card-in relative rounded-xl border border-slate-200/80 bg-white px-5 pb-5 pt-12 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md" style={{ animationDelay: `${i * 70}ms` }}>
                  {/* soft blended icon chip overlapping the top border */}
                  <span className={`absolute -top-4 left-5 flex h-11 w-11 items-center justify-center rounded-xl ring-1 ring-inset ${chip}`}>
                    <Icon className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <div className="text-sm font-medium text-slate-500">{label}</div>
                  <div className="mt-1 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">{value.toLocaleString()}</div>
                </div>
              ))}
            </div>

            {/* Coverage + recent activity */}
            <div className="mt-4 grid gap-4 lg:grid-cols-5">
              {/* Coverage card */}
              <div className="animate-card-in rounded-xl bg-slate-50 p-6 ring-1 ring-slate-100 sm:p-7 lg:col-span-3" style={{ animationDelay: '120ms' }}>
                <h3 className="text-base font-semibold text-slate-900">Alt text coverage</h3>
                <p className="mt-0.5 text-sm text-slate-500">How much of your store is described</p>

                {/* water-fill coverage circle with floating stat badges */}
                <div className="relative mx-auto mt-8 mb-2 h-52 w-52">
                  {/* outer progress ring */}
                  <svg viewBox="0 0 120 120" className="absolute inset-0 h-full w-full -rotate-90">
                    <circle cx="60" cy="60" r="56" fill="none" stroke="#e2e8f0" strokeWidth="4" />
                    <circle cx="60" cy="60" r="56" fill="none" stroke="#7c3aed" strokeWidth="4" strokeLinecap="round"
                      strokeDasharray={`${(2 * Math.PI * 56 * animCoverage) / 100} ${2 * Math.PI * 56}`} />
                  </svg>
                  {/* inner water circle */}
                  <div className="absolute inset-[11px] overflow-hidden rounded-full bg-white ring-1 ring-slate-100">
                    <div
                      className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-violet-500 to-indigo-300 transition-[height] duration-700 ease-out"
                      style={{ height: `${animCoverage}%` }}
                    >
                      {/* floating wave surface */}
                      <svg className="animate-wave absolute -top-[7px] left-0 h-3 w-[200%] text-violet-400" viewBox="0 0 1200 20" preserveAspectRatio="none" fill="currentColor">
                        <path d="M0,10 C150,0 150,0 300,10 C450,20 450,20 600,10 C750,0 750,0 900,10 C1050,20 1050,20 1200,10 L1200,20 L0,20 Z" />
                      </svg>
                    </div>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <div className="flex flex-col items-center rounded-2xl bg-white/70 px-5 py-2 shadow-sm backdrop-blur-[2px]">
                        <span className="text-4xl font-bold tracking-tight text-violet-700 tabular-nums">{Math.round(animCoverage)}%</span>
                        <span className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500">covered</span>
                      </div>
                    </div>
                  </div>
                  {/* floating stat badges */}
                  <div className="absolute -right-3 top-4 flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-md ring-1 ring-slate-100">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> {animWithAlt.toLocaleString()} described
                  </div>
                  <div className="absolute -right-3 bottom-4 flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-md ring-1 ring-slate-100">
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-500" /> {animMissing.toLocaleString()} missing
                  </div>
                  <div className="absolute -left-3 bottom-10 flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-md ring-1 ring-slate-100">
                    <ImagesIcon className="h-3.5 w-3.5 text-indigo-500" /> {total.toLocaleString()} images
                  </div>
                </div>

                {/* breakdown — mini cards with icon, count and a progress bar */}
                <div className="mt-7 space-y-3">
                  {[
                    { label: 'Properly described', value: animOptimized, chip: 'bg-emerald-50 text-emerald-600', bar: 'bg-emerald-500', Icon: CheckCircle2 },
                    { label: 'Needs improvement', value: animNeeds, chip: 'bg-amber-50 text-amber-600', bar: 'bg-amber-500', Icon: AlertCircle },
                    { label: 'Missing alt text', value: animMissing, chip: 'bg-rose-50 text-rose-600', bar: 'bg-rose-500', Icon: AlertTriangle },
                  ].map(({ label, value, chip, bar, Icon }) => {
                    const pct = total ? Math.round((value / total) * 100) : 0;
                    return (
                      <div key={label} className="rounded-xl border border-slate-100 bg-white p-3.5 transition-all duration-300 hover:shadow-sm">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-2.5 text-sm font-semibold text-slate-700">
                            <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${chip}`}>
                              <Icon className="h-4 w-4" />
                            </span>
                            {label}
                          </span>
                          <span className="text-sm text-slate-500 tabular-nums">
                            <span className="font-bold text-slate-900">{value.toLocaleString()}</span> {value === 1 ? 'image' : 'images'}
                          </span>
                        </div>
                        <div className="mt-3 flex items-center gap-3">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                            <div className={`h-full rounded-full ${bar} transition-[width] duration-700 ease-out`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="w-9 text-right text-xs font-semibold text-slate-400 tabular-nums">{pct}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Recent activity — timeline */}
              <div className="animate-card-in flex flex-col rounded-xl bg-slate-50 p-6 ring-1 ring-slate-100 lg:col-span-2" style={{ animationDelay: '200ms' }}>
                <div className="mb-1 flex items-center justify-between">
                  <h3 className="text-base font-semibold text-slate-900">Recent activity</h3>
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-slate-400 ring-1 ring-slate-100">
                    <Clock className="h-4 w-4" />
                  </span>
                </div>
                {activity.length ? (
                  <ol className="relative mt-5">
                    {activity.slice(0, 5).map((a, i, arr) => {
                      const meta = ACTIVITY_META[a.type] || ACTIVITY_META.scan;
                      const Icon = meta.icon;
                      const last = i === arr.length - 1;
                      return (
                        <li key={a.ts} className="group relative flex gap-4 rounded-xl px-2 py-2.5 transition-colors duration-200 hover:bg-white">
                          {/* timeline connector */}
                          {!last ? <span className="absolute bottom-1 left-[26px] top-12 w-px bg-gradient-to-b from-slate-200 to-transparent" /> : null}
                          {/* gradient dot */}
                          <span className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br text-white shadow-md ring-4 ring-slate-50 transition-all group-hover:ring-white ${meta.grad}`}>
                            <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-white/20" />
                            <Icon className="relative h-4 w-4" strokeWidth={1.85} />
                          </span>
                          <div className="flex min-w-0 flex-1 items-start justify-between gap-2 pt-0.5">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold leading-snug text-slate-800">{meta.text(a)}</p>
                              <span className={`mt-1 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${meta.chip}`}>{meta.tag}</span>
                            </div>
                            <span className="shrink-0 whitespace-nowrap text-xs font-medium text-slate-400">{relativeTime(a.ts)}</span>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white ring-1 ring-slate-100">
                      <Clock className="h-6 w-6 text-slate-300" />
                    </span>
                    <p className="mt-3 text-sm font-medium text-slate-500">No activity yet</p>
                    <p className="mt-0.5 text-xs text-slate-400">Scan, generate or embed to see it here.</p>
                  </div>
                )}
              </div>
            </div>
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
                View all images
                <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
              </span>
            </a>
            <p className="text-sm text-slate-600">Browse every image in your store and review its alt text.</p>
          </div>
        </>
      ) : null}

      {/* ===== How it works (white card) ===== */}
      <section className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm sm:p-9">
        <div className="mb-7">
          <h2 className="text-lg font-semibold text-slate-900">How it works</h2>
          <p className="mt-1 text-sm text-slate-500">From scan to embed in four simple steps</p>
        </div>
        <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ title, text, icon: Icon, grad }) => (
            <div key={title} className="group">
              {/* 3D gradient icon chip */}
              <span className={`relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br text-white shadow-lg ring-1 ring-inset ring-white/25 transition-transform duration-300 group-hover:-translate-y-1 ${grad}`}>
                <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-white/20" />
                <Icon className="relative h-6 w-6" strokeWidth={1.75} />
              </span>
              <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Why alt text matters tip ===== */}
      <div className="flex items-start gap-4 rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-5 shadow-sm sm:p-6">
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-violet-500/30 ring-1 ring-inset ring-white/25">
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-white/20" />
          <Info className="relative h-5 w-5" strokeWidth={1.75} />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Why alt text matters</h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Good alt text turns your images into search traffic, and your store into a place everyone can shop.
          </p>
        </div>
      </div>

    </div>
  );
}
