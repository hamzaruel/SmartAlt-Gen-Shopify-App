'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ImageOff } from 'lucide-react';
import { loadScan } from '@/lib/scanStore';

const TABS = [
  { id: 'ALL', label: 'All' },
  { id: 'MISSING', label: 'Missing' },
  { id: 'NEEDS_IMPROVEMENT', label: 'Needs improvement' },
  { id: 'OPTIMIZED', label: 'Optimized' },
];

const SOURCE_LABEL = { product: 'Product', file: 'File', article: 'Blog' };

function StatusBadge({ status, reason }) {
  const map = {
    MISSING: { text: 'Missing', cls: 'bg-red-100 text-red-700' },
    NEEDS_IMPROVEMENT: {
      text: reason === 'duplicate' ? 'Duplicate' : 'Generic',
      cls: 'bg-amber-100 text-amber-700',
    },
    OPTIMIZED: { text: 'Optimized', cls: 'bg-emerald-100 text-emerald-700' },
  };
  const s = map[status] || map.OPTIMIZED;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.text}</span>;
}

export default function ImagesPage() {
  const searchParams = useSearchParams();
  const shop = searchParams.get('shop');

  const [tab, setTab] = useState('ALL');
  const [allImages, setAllImages] = useState([]);

  useEffect(() => {
    const cached = loadScan(shop);
    setAllImages(cached?.images || []);
  }, [shop]);

  const images = tab === 'ALL' ? allImages : allImages.filter((i) => i.status === tab);
  const counts = (id) =>
    id === 'ALL' ? allImages.length : allImages.filter((i) => i.status === id).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Images</h1>
        <p className="mt-0.5 text-sm text-slate-500">{images.length} shown</p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
              tab === t.id
                ? 'bg-violet-600 text-white shadow-sm'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {t.label}
            <span className={`ml-1.5 ${tab === t.id ? 'text-white/70' : 'text-slate-400'}`}>
              {counts(t.id)}
            </span>
          </button>
        ))}
      </div>

      {allImages.length === 0 ? (
        <EmptyState />
      ) : images.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Nothing in this category.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <ul className="divide-y divide-slate-100">
            {images.map((img) => (
              <li key={img.key} className="flex items-center gap-4 p-4">
                <img
                  src={img.url}
                  alt={img.currentAlt || img.title}
                  className="h-14 w-14 shrink-0 rounded-lg object-cover ring-1 ring-slate-200"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-slate-800">{img.title}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
                      {SOURCE_LABEL[img.source] || img.source}
                    </span>
                    <StatusBadge status={img.status} reason={img.reason} />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {img.currentAlt ? `Current: ${img.currentAlt}` : 'No alt text'}
                  </p>
                  {img.suggestedAlt ? (
                    <p className="mt-0.5 truncate text-xs text-violet-600">
                      Suggested: {img.suggestedAlt}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <ImageOff className="h-6 w-6" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-slate-800">No images yet</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
        Run a scan from the Dashboard to detect your store’s images.
      </p>
    </div>
  );
}
