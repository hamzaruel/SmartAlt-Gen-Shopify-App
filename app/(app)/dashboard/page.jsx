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
  AlertTriangle,
  CheckCircle2,
  Package,
  Layers,
  BookOpen,
  FileText,
} from 'lucide-react';

const SOURCES = [
  { id: 'product', label: 'Products', icon: Package },
  { id: 'collection', label: 'Collections', icon: Layers },
  { id: 'article', label: 'Blog posts', icon: BookOpen },
  { id: 'file', label: 'Files', icon: FileText },
];
import { loadScan, saveScan } from '@/lib/scanStore';
import { authHeaders } from '@/lib/sessionToken';

const STEPS = [
  { title: 'Scan', text: 'Find every image across products, collections, blogs and files, and see which need alt text.', icon: Search, ring: 'bg-sky-100 text-sky-600' },
  { title: 'Choose', text: 'Pick an image type and how to edit: a custom template or AI.', icon: MousePointerClick, ring: 'bg-indigo-100 text-indigo-600' },
  { title: 'Generate', text: 'Get clean, accessible alt text under 120 characters.', icon: Wand2, ring: 'bg-violet-100 text-violet-600' },
  { title: 'Embed', text: 'Save the alt text straight back into Shopify in one click.', icon: UploadCloud, ring: 'bg-emerald-100 text-emerald-600' },
];

function Divider() {
  return <div className="h-px w-full bg-gradient-to-r from-transparent via-slate-200 to-transparent" />;
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
  const [error, setError] = useState(null);

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
    try {
      const res = await fetch(`/api/scan?shop=${encodeURIComponent(shop)}`, {
        method: 'POST',
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const saved = saveScan(shop, data.images || []);
      setStats(saved.stats);
      setImages(data.images || []);
      setScannedAt(saved.scannedAt);
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
  const sourceStats = SOURCES.map((s) => {
    const imgs = images.filter((i) => i.source === s.id);
    const miss = imgs.filter((i) => i.status === 'MISSING').length;
    return { ...s, total: imgs.length, withAlt: imgs.length - miss };
  }).filter((s) => s.total > 0);

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

      {/* ===== HERO ===== */}
      <section className="rounded-3xl bg-gradient-to-b from-indigo-50 to-white px-6 py-12 text-center sm:py-14">
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
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-7 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {scanning ? <Search className="h-5 w-5 animate-scan" /> : <ScanLine className="h-5 w-5" />}
            {scanning ? 'Scanning…' : 'Scan now'}
          </button>
        </div>

        {scannedAt ? (
          <p className="mt-3 text-xs text-slate-500">Last scanned {new Date(scannedAt).toLocaleString()}</p>
        ) : (
          <p className="mt-3 text-xs text-slate-400">Scans your products, files &amp; blog images in one click.</p>
        )}
      </section>

      {/* ===== Store overview ===== */}
      {scanned ? (
        <>
          <Divider />
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Store overview</h2>
              <span className="text-xs text-slate-400">across your whole store</span>
            </div>

            {/* Headline tiles */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-100">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><ImagesIcon className="h-4 w-4" /></div>
                <div className="mt-2 text-2xl font-bold text-slate-900">{total.toLocaleString()}</div>
                <div className="text-sm text-slate-500">Total images</div>
              </div>
              <div className="rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-100">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600"><CheckCircle2 className="h-4 w-4" /></div>
                <div className="mt-2 text-2xl font-bold text-slate-900">{withAlt.toLocaleString()}</div>
                <div className="text-sm text-slate-500">With alt text</div>
              </div>
              <div className="rounded-xl bg-rose-50 p-4 ring-1 ring-rose-100">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-600"><AlertTriangle className="h-4 w-4" /></div>
                <div className="mt-2 text-2xl font-bold text-slate-900">{missing.toLocaleString()}</div>
                <div className="text-sm text-slate-500">Missing alt</div>
              </div>
            </div>

            {/* Overall coverage */}
            <div className="mt-6">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-600">Alt text coverage</span>
                <span className="font-semibold text-emerald-600">{coverage}%</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all" style={{ width: `${coverage}%` }} />
              </div>
            </div>

            {/* Coverage by source */}
            {sourceStats.length ? (
              <div className="mt-6 space-y-3 border-t border-slate-100 pt-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Coverage by source</p>
                {sourceStats.map(({ id, label, icon: Icon, total: t, withAlt: w }) => {
                  const pct = t > 0 ? Math.round((w / t) * 100) : 0;
                  return (
                    <div key={id} className="flex items-center gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><Icon className="h-4 w-4" /></span>
                      <span className="w-24 shrink-0 text-sm text-slate-600">{label}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-indigo-400" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-14 shrink-0 text-right text-xs text-slate-400">{w}/{t}</span>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="mt-6 flex justify-end border-t border-slate-100 pt-5">
              <a href={`/generate${qs}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:text-indigo-700">
                Generate &amp; embed <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </section>
        </>
      ) : null}

      <Divider />

      {/* ===== How it works ===== */}
      <section>
        <h2 className="mb-5 text-center text-sm font-semibold uppercase tracking-wide text-slate-400">How it works</h2>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ title, text, icon: Icon, ring }, i) => (
            <div key={title} className="text-center">
              <div className={`mx-auto flex h-11 w-11 items-center justify-center rounded-full shadow-sm ${ring}`}>
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-3 text-base font-semibold text-slate-800">{i + 1}. {title}</h3>
              <p className="mx-auto mt-1 max-w-[15rem] text-sm text-slate-500">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <Divider />

      {/* ===== WCAG tip (slim soft callout) ===== */}
      <div className="flex items-start gap-3 rounded-xl bg-sky-50 px-4 py-3 text-sm text-slate-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
        <p>
          Alt text lets screen readers describe images and boosts image SEO. WCAG recommends concise,
          meaningful text, so SmartAltGen keeps every alt under 120 characters.
        </p>
      </div>

    </div>
  );
}
