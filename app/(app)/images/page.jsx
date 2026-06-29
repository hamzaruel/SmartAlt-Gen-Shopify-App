'use client';

import { useEffect, useState, useRef } from 'react';
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
  ChevronDown,
  Wand2,
  ArrowRight,
  Filter,
  SlidersHorizontal,
  Sparkles,
  LayoutGrid,
  Package,
  Layers,
  BookOpen,
  FileText,
} from 'lucide-react';
import { loadScan, hydrateScan } from '@/lib/scanStore';
import { BASE_PATH } from '@/lib/basePath';
import { relativeTime } from '@/lib/activity';

const PAGE_SIZE = 12;

const TABS = [
  { id: 'ALL', label: 'All' },
  { id: 'MISSING', label: 'Missing' },
  { id: 'NEEDS_IMPROVEMENT', label: 'Needs improvement' },
  { id: 'OPTIMIZED', label: 'Properly described' },
];

const TAB_NOTE = {
  ALL: 'Every image found across your products, files, blog posts and collections.',
  MISSING: 'Images with no alt text. These miss out on image SEO, and screen readers can’t describe them, so they need it most. Start here.',
  NEEDS_IMPROVEMENT:
    'Images whose alt text is weak for SEO: symbols or punctuation, stray dashes, the word “image”, or too generic.',
  OPTIMIZED: 'Images that already have clear, SEO-friendly alt text. Nothing to do here.',
};

const REASON_TEXT = {
  symbols: 'Has special characters or symbols',
  'too-long': 'Longer than search engines show',
  generic: 'Too generic',
  duplicate: 'Duplicate alt text',
};

const SOURCE_LABEL = { product: 'Product', file: 'File', article: 'Blog', collection: 'Collection' };

const SOURCE_FILTERS = [
  { id: 'all', label: 'All sources', Icon: LayoutGrid },
  { id: 'product', label: 'Products', Icon: Package },
  { id: 'collection', label: 'Collections', Icon: Layers },
  { id: 'article', label: 'Blog posts', Icon: BookOpen },
  { id: 'file', label: 'Files', Icon: FileText },
];

// A specific, helpful explanation of WHY an alt needs work (what's wrong + the fix).
function reasonDetail(img) {
  const alt = img.currentAlt || '';
  switch (img.reason) {
    case 'too-long':
      return `This alt is ${alt.length} characters. Keep it concise so search engines and screen readers use the whole thing.`;
    case 'symbols': {
      const bad = [...new Set((alt.match(/[^\p{L}\p{N}\s.,'’!?:;&()\-]/gu) || []))];
      return bad.length
        ? `Remove these characters: ${bad.join('  ')}`
        : 'Contains special characters or symbols that don’t belong in alt text.';
    }
    case 'generic':
      return 'Too generic. It doesn’t actually describe what’s in the image.';
    case 'duplicate':
      return 'The same alt text is used on other images. Make each one unique.';
    default:
      return 'This alt text could be clearer.';
  }
}

function StatusBadge({ status }) {
  const map = {
    MISSING: { text: 'Missing alt text', cls: 'bg-rose-100 text-rose-700' },
    NEEDS_IMPROVEMENT: { text: 'Needs improvement', cls: 'bg-amber-100 text-amber-700' },
    OPTIMIZED: { text: 'Properly described', cls: 'bg-emerald-600 text-white' },
  };
  const s = map[status] || map.OPTIMIZED;
  return (
    <span className={`inline-block shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${s.cls}`}>
      {s.text}
    </span>
  );
}

// Extract a readable filename from a Shopify CDN image URL.
function fileName(url) {
  try {
    const last = new URL(url).pathname.split('/').pop() || '';
    return decodeURIComponent(last.split('?')[0]) || 'image';
  } catch {
    return 'image';
  }
}

// Compact dropdown filter (like a collection-page filter). Closes on outside click.
function FilterDropdown({ icon: TriggerIcon, label, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const current = options.find((o) => o.id === value) || options[0];
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm shadow-sm transition hover:border-slate-300 hover:shadow"
      >
        {TriggerIcon ? <TriggerIcon className="h-4 w-4 text-slate-400" /> : null}
        <span className="text-slate-500">{label}:</span>
        <span className="font-semibold text-slate-800">{current?.label}</span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-56 origin-top-right rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
          {options.map((o) => {
            const active = o.id === value;
            return (
              <button
                key={o.id}
                onClick={() => { onChange(o.id); setOpen(false); }}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  active ? 'bg-indigo-50 font-semibold text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="flex items-center gap-2">
                  {o.Icon ? <o.Icon className="h-4 w-4" /> : null}
                  {o.label}
                </span>
                {o.count != null ? <span className="text-xs tabular-nums text-slate-400">{o.count}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
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

  const [tab, setTab] = useState(() => {
    const t = searchParams.get('tab');
    return ['ALL', 'MISSING', 'NEEDS_IMPROVEMENT', 'OPTIMIZED'].includes(t) ? t : 'ALL';
  });
  const [source, setSource] = useState(() => {
    const s = searchParams.get('source');
    return ['product', 'collection', 'article', 'file'].includes(s) ? s : 'all';
  }); // filter by image source
  const [page, setPage] = useState(0);
  const [allImages, setAllImages] = useState([]);

  useEffect(() => {
    let alive = true;
    hydrateScan(shop).then((cached) => {
      if (alive) setAllImages(cached?.images || []);
    });
    return () => {
      alive = false;
    };
  }, [shop]);

  // back to first page whenever the tab or source filter changes
  useEffect(() => {
    setPage(0);
  }, [tab, source]);

  const presentSources = [...new Set(allImages.map((i) => i.source))];
  const sourceImages = source === 'all' ? allImages : allImages.filter((i) => i.source === source);

  const counts = (id) =>
    id === 'ALL' ? sourceImages.length : sourceImages.filter((i) => i.status === id).length;

  const filtered = tab === 'ALL' ? sourceImages : sourceImages.filter((i) => i.status === tab);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="space-y-8">
      {/* ===== Header ===== */}
      <div className="animate-card-in relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-indigo-50 via-white to-violet-50/50 p-6 shadow-sm sm:p-7">
        {/* decorative glow */}
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-indigo-200/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 right-1/3 h-48 w-48 rounded-full bg-violet-200/25 blur-3xl" />

        <div className="relative flex items-center justify-between gap-8">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-indigo-600 shadow-sm ring-1 ring-indigo-100">
              <Sparkles className="h-3.5 w-3.5" /> Accessibility &amp; image SEO
            </span>
            <div className="mt-3 flex items-center gap-3">
              <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/30 ring-1 ring-inset ring-white/25">
                <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-white/20" />
                <ImagesIcon className="relative h-5 w-5" strokeWidth={1.75} />
              </span>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">All store images</h1>
            </div>
            <p className="mt-2.5 max-w-xl text-base leading-relaxed text-slate-600">
              Browse <span className="font-semibold text-violet-600">every image</span> in your store and check its{' '}
              <span className="font-semibold text-indigo-600">alt text status</span>. Use the{' '}
              <span className="font-semibold text-violet-600">filters</span> to find exactly{' '}
              <span className="font-semibold text-indigo-600">what needs fixing</span>.
            </p>
          </div>

          {/* section illustration (soft float, like the dashboard hero) */}
          <img
            src={`${BASE_PATH}/audit-illustration-v2.png`}
            alt=""
            aria-hidden="true"
            className="animate-float hidden w-80 shrink-0 lg:block xl:w-96"
          />
        </div>
      </div>

      {allImages.length === 0 ? (
        <EmptyState shop={shop} />
      ) : (
        <>
          {/* ===== Source tabs ===== */}
          <div className="flex flex-wrap items-center gap-2">
            {SOURCE_FILTERS.filter((s) => s.id === 'all' || presentSources.includes(s.id)).map(({ id, label, Icon }) => {
              const active = source === id;
              const count = id === 'all' ? allImages.length : allImages.filter((i) => i.source === id).length;
              return (
                <button
                  key={id}
                  onClick={() => setSource(id)}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 ease-out active:scale-[0.97] ${
                    active
                      ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/25'
                      : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-slate-800 hover:shadow-sm'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                  <span className={`rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums ${active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ===== Toolbar: result count + status dropdown ===== */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">
              <span className="font-semibold text-slate-900 tabular-nums">{filtered.length.toLocaleString()}</span>{' '}
              {filtered.length === 1 ? 'image' : 'images'}
              {tab !== 'ALL' || source !== 'all' ? ' match your filters' : ' in your store'}
            </p>
            <div className="flex items-center gap-2">
              <span className="hidden text-sm text-slate-500 sm:inline">Show by alt text status</span>
              <FilterDropdown
                icon={SlidersHorizontal}
                label="Status"
                value={tab}
                onChange={setTab}
                options={TABS.map((t) => ({ id: t.id, label: t.label, count: counts(t.id) }))}
              />
            </div>
          </div>

          {/* ===== Context note for the active status ===== */}
          <div key={`${source}-${tab}`} className="animate-fade-in flex items-start gap-2.5 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-100">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
            <p>{TAB_NOTE[tab]}</p>
          </div>

          {/* ===== List ===== */}
          {filtered.length === 0 ? (
            <div key={`empty-${source}-${tab}`} className="animate-fade-in rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-sm">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-500">
                <Inbox className="h-6 w-6" />
              </div>
              <p className="mt-4 text-base font-semibold text-slate-800">
                No {tab !== 'ALL' ? (TABS.find((t) => t.id === tab)?.label.toLowerCase() + ' ') : ''}images
                {source !== 'all' ? ` in ${SOURCE_FILTERS.find((s) => s.id === source)?.label}` : ''}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
                {tab === 'MISSING' || tab === 'NEEDS_IMPROVEMENT'
                  ? 'Nothing needs attention here. Try another source or status filter.'
                  : 'Nothing matches the current filters. Try a different source or status.'}
              </p>
            </div>
          ) : (
            <>
              <div key={`list-${source}-${tab}`} className="animate-fade-in overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-indigo-100 bg-gradient-to-r from-indigo-50 to-violet-50 text-xs font-bold uppercase tracking-wide text-indigo-600/80">
                        <th className="px-5 py-4">Preview</th>
                        <th className="px-5 py-4">Name / Filename</th>
                        <th className="px-5 py-4">Source</th>
                        <th className="px-5 py-4">Current alt text</th>
                        <th className="px-5 py-4">Status</th>
                        <th className="px-5 py-4">Updated</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pageItems.map((img, i) => (
                        <tr
                          key={img.key}
                          style={{ animationDelay: `${i * 30}ms` }}
                          className="animate-fade-in align-middle transition-colors hover:bg-indigo-50/40"
                        >
                          {/* Preview */}
                          <td className="px-5 py-5">
                            <img
                              src={img.url}
                              alt={img.currentAlt || img.title}
                              className="h-16 w-16 shrink-0 rounded-xl object-cover ring-1 ring-slate-200"
                            />
                          </td>
                          {/* Name / Filename */}
                          <td className="px-5 py-5">
                            <p className="text-sm font-semibold text-slate-800">{img.title || 'Untitled'}</p>
                            <p className="mt-1 max-w-[200px] truncate text-xs text-slate-400">{fileName(img.url)}</p>
                          </td>
                          {/* Source */}
                          <td className="px-5 py-5">
                            <span className="inline-block whitespace-nowrap rounded-md bg-indigo-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-indigo-700 ring-1 ring-indigo-100">
                              {SOURCE_LABEL[img.source] || img.source}
                            </span>
                          </td>
                          {/* Current alt text */}
                          <td className="max-w-[380px] px-5 py-5">
                            {img.status === 'MISSING' ? (
                              <span className="text-sm font-medium italic text-rose-500">No alt text provided.</span>
                            ) : (
                              <p className="text-sm leading-relaxed text-slate-600">{img.currentAlt}</p>
                            )}
                          </td>
                          {/* Status */}
                          <td className="px-5 py-5"><StatusBadge status={img.status} /></td>
                          {/* Updated */}
                          <td className="whitespace-nowrap px-5 py-5 text-sm font-medium text-slate-500">
                            {img.updatedAt ? relativeTime(new Date(img.updatedAt).getTime()) : 'Unknown'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
              href={`${BASE_PATH}/generate${qs}`}
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
        href={`${BASE_PATH}/dashboard${qs}`}
        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
      >
        Go to Dashboard
      </a>
    </div>
  );
}
