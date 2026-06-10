'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Images as ImagesIcon,
  ImageOff,
  EyeOff,
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Info,
  ChevronLeft,
  ChevronRight,
  Wand2,
  ArrowRight,
} from 'lucide-react';
import { loadScan } from '@/lib/scanStore';

const PAGE_SIZE = 12;

const TABS = [
  { id: 'ALL', label: 'All' },
  { id: 'MISSING', label: 'Missing' },
  { id: 'NEEDS_IMPROVEMENT', label: 'Needs improvement' },
  { id: 'OPTIMIZED', label: 'Optimized' },
];

const TAB_NOTE = {
  ALL: 'Every image found across your products, files, blog posts and collections.',
  MISSING: 'Images with no alt text. Screen readers can’t describe these, so they need it most — start here.',
  NEEDS_IMPROVEMENT:
    'Images whose alt text isn’t WCAG-clean — it has symbols or punctuation, stray dashes, the word “image”, or is too generic.',
  OPTIMIZED: 'Images that already have clear, WCAG-friendly alt text. Nothing to do here.',
};

const REASON_TEXT = {
  symbols: 'Has special characters or symbols',
  'too-long': 'Longer than 120 characters',
  generic: 'Too generic',
  duplicate: 'Duplicate alt text',
};

const SOURCE_LABEL = { product: 'Product', file: 'File', article: 'Blog', collection: 'Collection' };

// A specific, helpful explanation of WHY an alt needs work (what's wrong + the fix).
function reasonDetail(img) {
  const alt = img.currentAlt || '';
  switch (img.reason) {
    case 'too-long':
      return `This alt is ${alt.length} characters. Keep it under 120 so screen readers stay concise.`;
    case 'symbols': {
      const bad = [...new Set((alt.match(/[^\p{L}\p{N}\s.,'’!?:;&()\-]/gu) || []))];
      return bad.length
        ? `Remove these characters: ${bad.join('  ')}`
        : 'Contains special characters or symbols that don’t belong in alt text.';
    }
    case 'generic':
      return 'Too generic — it doesn’t actually describe what’s in the image.';
    case 'duplicate':
      return 'The same alt text is used on other images. Make each one unique.';
    default:
      return 'This alt text could be clearer.';
  }
}

function StatusBadge({ status }) {
  const map = {
    MISSING: { text: 'Missing', cls: 'bg-rose-100 text-rose-700' },
    NEEDS_IMPROVEMENT: { text: 'Needs work', cls: 'bg-amber-100 text-amber-700' },
    OPTIMIZED: { text: 'Optimized', cls: 'bg-emerald-100 text-emerald-700' },
  };
  const s = map[status] || map.OPTIMIZED;
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}>{s.text}</span>;
}

// Alt-text display, styled by the image's status (used in every tab).
function AltDisplay({ img }) {
  if (img.status === 'MISSING') {
    return (
      <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1 text-sm font-medium text-rose-700 ring-1 ring-rose-100">
        <EyeOff className="h-3.5 w-3.5" /> No alt text yet
      </div>
    );
  }
  if (img.status === 'NEEDS_IMPROVEMENT') {
    return (
      <div className="mt-2 space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current alt</p>
        <p className="rounded-lg bg-slate-50 px-3 py-1.5 text-sm text-slate-700 ring-1 ring-slate-100">
          {img.currentAlt}
        </p>
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-semibold text-amber-800">{REASON_TEXT[img.reason] || 'Needs improvement'}</p>
            <p className="mt-0.5 text-sm text-amber-700/90">{reasonDetail(img)}</p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current alt</p>
      <div className="mt-1 flex items-start gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm text-emerald-800 ring-1 ring-emerald-100">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <span>{img.currentAlt}</span>
      </div>
    </div>
  );
}

export default function ImagesPage() {
  const searchParams = useSearchParams();
  const shop = searchParams.get('shop');
  const host = searchParams.get('host');
  const qs = `?shop=${encodeURIComponent(shop || '')}&host=${encodeURIComponent(host || '')}`;

  const [tab, setTab] = useState('ALL');
  const [page, setPage] = useState(0);
  const [allImages, setAllImages] = useState([]);

  useEffect(() => {
    const cached = loadScan(shop);
    setAllImages(cached?.images || []);
  }, [shop]);

  // back to first page whenever the tab changes
  useEffect(() => {
    setPage(0);
  }, [tab]);

  const counts = (id) =>
    id === 'ALL' ? allImages.length : allImages.filter((i) => i.status === id).length;

  const filtered = tab === 'ALL' ? allImages : allImages.filter((i) => i.status === tab);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="space-y-6">
      {/* ===== Header ===== */}
      <div className="animate-card-in rounded-2xl bg-gradient-to-br from-indigo-50 to-white p-6 ring-1 ring-slate-100">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
            <ImagesIcon className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Image audit</h1>
            <p className="text-sm text-slate-600">Review every image in your store and its alt text status.</p>
          </div>
        </div>
      </div>

      {allImages.length === 0 ? (
        <EmptyState shop={shop} />
      ) : (
        <>
          {/* ===== Tabs ===== */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TABS.map((t, i) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  style={{ animationDelay: `${i * 60}ms` }}
                  className={`animate-fade-in flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 ease-out hover:-translate-y-0.5 active:scale-[0.97] ${
                    active
                      ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/25'
                      : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-slate-800 hover:shadow-sm'
                  }`}
                >
                  {t.label}
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums ${
                      active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {counts(t.id)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ===== Tab note ===== */}
          <div className="animate-fade-in flex items-start gap-2.5 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-100">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
            <p>{TAB_NOTE[tab]}</p>
          </div>

          {/* ===== List ===== */}
          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <Inbox className="h-5 w-5" />
              </div>
              <p className="mt-3 text-sm font-medium text-slate-700">Nothing in this category.</p>
              <p className="mt-1 text-sm text-slate-500">
                {tab === 'MISSING' || tab === 'NEEDS_IMPROVEMENT'
                  ? 'Great — no images need attention here.'
                  : 'No images to show.'}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <ul className="divide-y divide-slate-100">
                  {pageItems.map((img, i) => (
                    <li
                      key={img.key}
                      style={{ animationDelay: `${i * 40}ms` }}
                      className="animate-fade-in flex items-start gap-4 p-4 transition-colors hover:bg-slate-50/60"
                    >
                      <img
                        src={img.url}
                        alt={img.currentAlt || img.title}
                        className="h-16 w-16 shrink-0 rounded-xl object-cover ring-1 ring-slate-200"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-slate-800">{img.title || 'Untitled'}</span>
                          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                            {SOURCE_LABEL[img.source] || img.source}
                          </span>
                          <StatusBadge status={img.status} />
                        </div>
                        <AltDisplay img={img} />
                        {img.suggestedAlt ? (
                          <p className="mt-1.5 truncate text-sm text-violet-600">
                            <span className="font-medium">Suggested:</span> {img.suggestedAlt}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              {/* ===== Pager ===== */}
              {pageCount > 1 ? (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-600">
                    Showing{' '}
                    <span className="font-semibold text-slate-800 tabular-nums">
                      {safePage * PAGE_SIZE + 1}–{Math.min(filtered.length, safePage * PAGE_SIZE + PAGE_SIZE)}
                    </span>{' '}
                    of <span className="font-semibold text-slate-800 tabular-nums">{filtered.length}</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={safePage === 0}
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronLeft className="h-4 w-4" /> Prev
                    </button>
                    <span className="text-sm font-medium text-slate-600 tabular-nums">
                      Page {safePage + 1} of {pageCount}
                    </span>
                    <button
                      onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                      disabled={safePage >= pageCount - 1}
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Next <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}

          {/* ===== Generate CTA ===== */}
          <div className="animate-card-in flex flex-col items-center gap-2.5 border-t border-slate-100 pt-8 text-center">
            <a
              href={`/generate${qs}`}
              className="group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-7 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/40 active:translate-y-0 active:scale-[0.98]"
            >
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full" />
              <span className="relative flex items-center gap-2">
                <Wand2 className="h-4 w-4" />
                Generate alt text
                <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
              </span>
            </a>
            <p className="text-sm text-slate-600">Create alt text for images that need it and apply it to your store.</p>
          </div>
        </>
      )}
    </div>
  );
}

function EmptyState({ shop }) {
  const qs = shop ? `?shop=${encodeURIComponent(shop)}` : '';
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <ImageOff className="h-6 w-6" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-slate-800">No images yet</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-slate-600">
        Run a scan from the Dashboard to detect your store’s images.
      </p>
      <a
        href={`/dashboard${qs}`}
        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
      >
        Go to Dashboard
      </a>
    </div>
  );
}
