'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Wand2,
  UploadCloud,
  Loader2,
  X,
  Package,
  Layers,
  BookOpen,
  FileText,
  Eye,
  EyeOff,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Info,
  CheckCircle2,
  AlertCircle,
  Trash2,
} from 'lucide-react';
import { loadScan, patchImages } from '@/lib/scanStore';
import { authHeaders } from '@/lib/sessionToken';
import { sanitizeAlt } from '@/lib/sanitizeAlt';

const TYPES = [
  { id: 'product', label: 'Product Images', icon: Package },
  { id: 'collection', label: 'Collection Cover Images', icon: Layers },
  { id: 'article', label: 'Blog / Post Images', icon: BookOpen },
  { id: 'file', label: 'Content File Images', icon: FileText },
];

const OWNER_LABEL = { product: 'Product', collection: 'Collection', article: 'Article', file: 'File' };
const PAGE_SIZE = 10;

const TEMPLATES = [
  '[product_title]',
  '[product_title]-[product_type]',
  '[product_title]-[product_vendor]',
  '[product_title]-[product_type]-[product_vendor]',
];

// What context the merchant can feed the AI (only fields we actually have).
const AI_INFO = [
  { id: 'image', label: 'Image', always: true },
  { id: 'title', label: 'Product title' },
  { id: 'type', label: 'Product type' },
  { id: 'vendor', label: 'Product vendor' },
];

function fileNameFromUrl(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || 'image';
  } catch {
    return 'image';
  }
}

function resolveAdminUrl(img, shop) {
  if (img.adminUrl) return img.adminUrl;
  if (!shop) return null;
  const num = (img.id || '').split('/').pop();
  if (img.source === 'collection') return `https://${shop}/admin/collections/${num}`;
  if (img.source === 'article') return `https://${shop}/admin/articles/${num}`;
  if (img.source === 'file') return `https://${shop}/admin/content/files`;
  return null;
}

function applyTemplate(tpl, img) {
  const filled = (tpl || '')
    .replace(/\[product_title\]/g, img.title || '')
    .replace(/\[product_type\]/g, img.type || '')
    .replace(/\[product_vendor\]/g, img.vendor || '')
    .replace(/\[option[123]\]/g, '');
  return sanitizeAlt(filled); // WCAG-clean: no quotes/special chars, word-boundary 120 cap
}

function SectionTitle({ icon: Icon, children }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
        <Icon className="h-4 w-4" />
      </span>
      <h2 className="text-sm font-semibold text-slate-800">{children}</h2>
    </div>
  );
}

function Divider() {
  return <div className="h-px w-full bg-gradient-to-r from-transparent via-slate-200 to-transparent" />;
}

function Row({ label, value }) {
  return (
    <div className="flex gap-2">
      <span className="w-24 shrink-0 text-slate-400">{label}</span>
      <span className="min-w-0 flex-1 break-words text-slate-700">{value}</span>
    </div>
  );
}

function Pager({ page, totalPages, onPrev, onNext }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <button onClick={onPrev} disabled={page === 0} aria-label="Previous page"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="text-slate-500">Page {page + 1} of {totalPages}</span>
      <button onClick={onNext} disabled={page >= totalPages - 1} aria-label="Next page"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function GeneratePage() {
  const searchParams = useSearchParams();
  const shop = searchParams.get('shop');

  const [allImages, setAllImages] = useState([]);
  const [selected, setSelected] = useState(null); // no type pre-selected
  const [showPreview, setShowPreview] = useState(false);
  const [page, setPage] = useState(0);
  const [genPage, setGenPage] = useState(0);

  const [editMode, setEditMode] = useState(''); // '' until the merchant chooses
  const [templateChoice, setTemplateChoice] = useState(0);
  const [customTemplate, setCustomTemplate] = useState('');
  const [skipExisting, setSkipExisting] = useState(false);
  const [infoFields, setInfoFields] = useState(['title']); // AI custom: what to feed the model
  const [instructions, setInstructions] = useState('');

  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    setAllImages(loadScan(shop)?.images || []);
  }, [shop]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Reset preview/page each time the merchant switches type.
  useEffect(() => {
    setPage(0);
    setGenPage(0);
    setShowPreview(false);
  }, [selected]);

  const noScan = !loadScan(shop);
  const countBySource = (src) => allImages.filter((i) => i.source === src).length;

  const matching = selected ? allImages.filter((i) => i.source === selected) : [];
  const totalPages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages - 1);
  const pageItems = matching.slice(pageSafe * PAGE_SIZE, pageSafe * PAGE_SIZE + PAGE_SIZE);
  const selectedLabel = TYPES.find((t) => t.id === selected)?.label || '';
  const selMissing = matching.filter((i) => i.status === 'MISSING').length;
  const selOptimized = matching.filter((i) => i.status === 'OPTIMIZED').length;

  const activeTemplate = templateChoice === 'custom' ? customTemplate : TEMPLATES[templateChoice];
  const hasAlt = (i) => i.currentAlt && i.currentAlt.trim() !== '';
  const editTargets = skipExisting ? matching.filter((i) => !hasAlt(i)) : matching;
  const removeTargets = matching.filter(hasAlt); // for "Remove alt-text"
  const hasSuggestions = allImages.some((i) => i.suggestedAlt && i.source === selected);

  // Generated results (selected type, now carrying a suggestedAlt) — paginated.
  const generated = matching.filter((i) => i.suggestedAlt);
  const genTotalPages = Math.max(1, Math.ceil(generated.length / PAGE_SIZE));
  const genPageSafe = Math.min(genPage, genTotalPages - 1);
  const genItems = generated.slice(genPageSafe * PAGE_SIZE, genPageSafe * PAGE_SIZE + PAGE_SIZE);

  async function generate() {
    setBusy('generate');
    setError(null);
    setMessage(null);
    try {
      if (editTargets.length === 0) {
        setMessage('No images to edit with the current settings.');
        return;
      }
      if (editMode === 'template' || editMode === 'title') {
        const tpl = editMode === 'title' ? '[product_title]' : activeTemplate;
        if (editMode === 'template' && !activeTemplate.trim()) throw new Error('Please choose or enter a template.');
        const patch = {};
        for (const img of editTargets) patch[img.key] = { suggestedAlt: applyTemplate(tpl, img) };
        patchImages(shop, patch);
        refresh();
        setMessage('Alt text generated. Click “Embed all” to apply.');
      } else if (editMode === 'ai' || editMode === 'ai_custom') {
        const items = editTargets.map((i) => ({
          key: i.key, source: i.source, url: i.url, title: i.title, type: i.type, vendor: i.vendor, position: i.position,
        }));
        const res = await fetch(`/api/generate?shop=${encodeURIComponent(shop)}`, {
          method: 'POST',
          headers: await authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ mode: editMode, items, infoFields, instructions }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const patch = {};
        for (const r of data.results || []) patch[r.key] = { suggestedAlt: r.suggestedAlt };
        patchImages(shop, patch);
        refresh();
        if (data.results?.length) setMessage('Alt text generated. Click “Embed all” to apply.');
        if (data.errors?.length) setError(data.errors.slice(0, 2).join(' | '));
      }
    } catch (e) {
      setError(e.message || 'Generate failed');
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    setBusy('apply');
    setError(null);
    setMessage(null);
    try {
      const items = allImages
        .filter((i) => i.suggestedAlt && i.source === selected)
        .map((i) => ({ key: i.key, source: i.source, id: i.id, url: i.url, alt: i.suggestedAlt }));
      const res = await fetch(`/api/apply?shop=${encodeURIComponent(shop)}`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (!data.errors?.length) {
        const patch = {};
        for (const t of items) patch[t.key] = { currentAlt: t.alt, suggestedAlt: null, status: 'OPTIMIZED', reason: null };
        patchImages(shop, patch);
      }
      refresh();
      setMessage(`Alt text added to ${data.applied} image${data.applied === 1 ? '' : 's'} in Shopify.`);
      if (data.errors?.length) setError(data.errors.slice(0, 2).join(' | '));
    } catch (e) {
      setError(e.message || 'Apply failed');
    } finally {
      setBusy(null);
    }
  }

  // Remove / clear alt text directly (no generate step).
  async function clearAlt() {
    setBusy('generate');
    setError(null);
    setMessage(null);
    try {
      const items = removeTargets.map((i) => ({ key: i.key, source: i.source, id: i.id, url: i.url, alt: '' }));
      if (!items.length) {
        setMessage('No alt text to remove here.');
        return;
      }
      const res = await fetch(`/api/apply?shop=${encodeURIComponent(shop)}`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ items, allowEmpty: true }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (!data.errors?.length) {
        const patch = {};
        for (const t of items) patch[t.key] = { currentAlt: '', suggestedAlt: null, status: 'MISSING', reason: null };
        patchImages(shop, patch);
      }
      refresh();
      setMessage(`Cleared alt text from ${data.applied} image${data.applied === 1 ? '' : 's'}.`);
      if (data.errors?.length) setError(data.errors.slice(0, 2).join(' | '));
    } catch (e) {
      setError(e.message || 'Remove failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      <header className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-indigo-50 to-white p-6">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
          <Wand2 className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Generate alt text</h1>
          <p className="mt-0.5 text-sm text-slate-500">Pick an image type, choose how to edit, then generate &amp; embed.</p>
        </div>
      </header>

      {/* ===== 1 · Select type ===== */}
      <section>
        <SectionTitle icon={Layers} step="1">Select which type of images to edit</SectionTitle>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap gap-2.5">
            {TYPES.map(({ id, label, icon: Icon }) => {
              const active = selected === id;
              const count = countBySource(id);
              return (
                <button
                  key={id}
                  onClick={() => setSelected(active ? null : id)}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition ${
                    active
                      ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md'
                      : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                  <span className={`rounded-full px-1.5 py-0.5 text-xs ${active ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {selected ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
            <span className="font-medium text-slate-700">{matching.length} {selectedLabel.toLowerCase()}</span>
            <span className="inline-flex items-center gap-1.5 text-rose-600">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />{selMissing} missing alt
            </span>
            <span className="inline-flex items-center gap-1.5 text-emerald-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{selOptimized} optimized
            </span>
          </div>
        ) : null}
      </section>

      {!selected ? (
        <div className="flex items-start gap-3 rounded-xl bg-indigo-50 px-4 py-3 text-sm text-slate-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
          <p>Pick an image type above to preview and edit its images.</p>
        </div>
      ) : null}

      <Divider />

      {/* ===== 2 · Preview ===== */}
          <section>
            <SectionTitle icon={LayoutGrid} step="2">Preview matching images</SectionTitle>
            <button
              onClick={() => setShowPreview((v) => !v)}
              disabled={!selected}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              {showPreview ? <EyeOff className="h-4 w-4 text-indigo-500" /> : <Eye className="h-4 w-4 text-indigo-500" />}
              {showPreview ? 'Hide preview' : 'Show preview'}
              <span className="text-slate-400">({matching.length})</span>
            </button>

            {showPreview ? (
              matching.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">No {selectedLabel.toLowerCase()} found.</p>
              ) : (
                <div className="mt-4 space-y-4">
                  <div className="flex items-center justify-end">
                    <Pager page={pageSafe} totalPages={totalPages}
                      onPrev={() => setPage((p) => Math.max(0, p - 1))}
                      onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))} />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    {pageItems.map((img) => (
                      <article key={img.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <div className="flex h-44 items-center justify-center bg-slate-50 p-2">
                          <img src={img.url} alt={img.currentAlt || img.title} className="max-h-40 max-w-full object-contain" />
                        </div>
                        <div className="space-y-1.5 p-4 text-sm">
                          <Row label={OWNER_LABEL[img.source] || 'Title'} value={`${img.title}${img.source === 'product' ? ` (Position: ${img.position})` : ''}`} />
                          <Row label="Media type" value="Image" />
                          <Row label="File name" value={fileNameFromUrl(img.url)} />
                          <Row label="Alt text" value={img.currentAlt || 'None'} />
                        </div>
                        <div className="flex flex-wrap gap-2 border-t border-slate-100 p-3">
                          {resolveAdminUrl(img, shop) ? (
                            <a href={resolveAdminUrl(img, shop)} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800">
                              <ExternalLink className="h-3.5 w-3.5" /> Go to Shopify Admin
                            </a>
                          ) : null}
                          {img.onlineUrl ? (
                            <a href={img.onlineUrl} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
                              <ExternalLink className="h-3.5 w-3.5" /> Go to Online Store
                            </a>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>

                  <div className="flex justify-center pt-1">
                    <Pager page={pageSafe} totalPages={totalPages}
                      onPrev={() => setPage((p) => Math.max(0, p - 1))}
                      onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))} />
                  </div>
                </div>
              )
            ) : null}
          </section>

          <Divider />

          {/* ===== 3 · Edit ===== */}
          <section>
            <SectionTitle icon={Wand2} step="3">Edit matching images</SectionTitle>
            <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Choose how you want to edit</label>
                <select
                  value={editMode}
                  onChange={(e) => setEditMode(e.target.value)}
                  className="w-full max-w-sm rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-10 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                >
                  <option value="" disabled>Choose how you want to edit…</option>
                  <option value="title">Update alt-text with product title</option>
                  <option value="template">Update alt-text with a custom template</option>
                  <option value="ai">Use AI to generate alt-text</option>
                  <option value="ai_custom">Use AI with custom options</option>
                  <option value="remove">Remove alt-text</option>
                </select>
              </div>

              {editMode === 'template' ? (
                <div className="space-y-2.5">
                  <p className="text-sm text-slate-500">Choose a template or write your own:</p>
                  {TEMPLATES.map((t, i) => {
                    const active = templateChoice === i;
                    return (
                      <button key={t} onClick={() => setTemplateChoice(i)}
                        className={`flex w-full items-center gap-3 rounded-xl border px-4 py-2.5 text-left transition ${
                          active ? 'border-indigo-300 bg-indigo-50/60 ring-1 ring-indigo-200' : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}>
                        <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${active ? 'border-indigo-600' : 'border-slate-300'}`}>
                          {active ? <span className="h-2 w-2 rounded-full bg-indigo-600" /> : null}
                        </span>
                        <code className="text-sm text-slate-700">{t}</code>
                      </button>
                    );
                  })}

                  <button onClick={() => setTemplateChoice('custom')}
                    className={`flex w-full items-center gap-3 rounded-xl border px-4 py-2.5 text-left transition ${
                      templateChoice === 'custom' ? 'border-indigo-300 bg-indigo-50/60 ring-1 ring-indigo-200' : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}>
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${templateChoice === 'custom' ? 'border-indigo-600' : 'border-slate-300'}`}>
                      {templateChoice === 'custom' ? <span className="h-2 w-2 rounded-full bg-indigo-600" /> : null}
                    </span>
                    <span className="text-sm font-medium text-slate-700">Customize my own template</span>
                  </button>

                  {templateChoice === 'custom' ? (
                    <input type="text" value={customTemplate} onChange={(e) => setCustomTemplate(e.target.value)}
                      placeholder="e.g. [product_title] [product_type]"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
                  ) : null}

                  <p className="text-xs text-slate-400">
                    Placeholders: <code>[product_title]</code> <code>[product_type]</code> <code>[product_vendor]</code>. Empty ones are skipped.
                  </p>
                </div>
              ) : editMode === 'title' ? (
                <p className="text-sm text-slate-500">Each image will use its product title (or item name) as the alt text.</p>
              ) : editMode === 'ai' ? (
                <p className="text-sm text-slate-500">AI looks at each image and writes the alt text automatically.</p>
              ) : editMode === 'ai_custom' ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-slate-700">Choose the information for AI generation</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {AI_INFO.map(({ id, label, always }) => {
                      const checked = always || infoFields.includes(id);
                      return (
                        <label key={id}
                          className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm ${
                            checked ? 'border-indigo-200 bg-indigo-50/60' : 'border-slate-200'
                          } ${always ? '' : 'cursor-pointer'}`}>
                          <input type="checkbox" checked={checked} disabled={always}
                            onChange={(e) => setInfoFields((f) => (e.target.checked ? [...f, id] : f.filter((x) => x !== id)))}
                            className="h-4 w-4 rounded border-slate-300 accent-indigo-600" />
                          <span className="text-slate-700">{label}</span>
                          {always ? <span className="ml-auto text-xs text-slate-400">always</span> : null}
                        </label>
                      );
                    })}
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">
                      Special instructions <span className="font-normal text-slate-400">(optional)</span>
                    </label>
                    <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2}
                      placeholder="e.g. Write in English. Mention colour and material"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
                  </div>
                </div>
              ) : editMode === 'remove' ? (
                <p className="text-sm text-slate-500">This clears the existing alt-text from the selected images in Shopify.</p>
              ) : (
                <p className="text-sm text-slate-400">Select an option above to continue.</p>
              )}

              {editMode && editMode !== 'remove' ? (
                <label className="flex cursor-pointer items-center gap-2.5 border-t border-slate-100 pt-4 text-sm text-slate-700">
                  <input type="checkbox" checked={skipExisting} onChange={(e) => setSkipExisting(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-indigo-600" />
                  Skip images that already have alt-text
                </label>
              ) : null}
            </div>
          </section>

      <Divider />

      {/* ===== Generate / Remove ===== */}
      <div>
        {editMode === 'remove' ? (
          <button
            onClick={clearAlt}
            disabled={busy !== null || removeTargets.length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'generate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Clear alt-text{removeTargets.length ? ` (${removeTargets.length})` : ''}
          </button>
        ) : (
          <button
            onClick={generate}
            disabled={busy !== null || !editMode || editTargets.length === 0 || (editMode === 'template' && !activeTemplate.trim())}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'generate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            Generate{editTargets.length ? ` (${editTargets.length})` : ''}
          </button>
        )}

        {/* messages appear here — below the action, not at the top */}
        {message ? (
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
            </span>
            <span className="flex-1 text-sm font-medium text-emerald-800">{message}</span>
            <button onClick={() => setMessage(null)} className="shrink-0 text-emerald-400 hover:text-emerald-600" aria-label="Dismiss"><X className="h-4 w-4" /></button>
          </div>
        ) : null}
        {error ? (
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 shadow-sm">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600">
              <AlertCircle className="h-4 w-4" />
            </span>
            <span className="flex-1 text-sm font-medium text-rose-800">{error}</span>
            <button onClick={() => setError(null)} className="shrink-0 text-rose-400 hover:text-rose-600" aria-label="Dismiss"><X className="h-4 w-4" /></button>
          </div>
        ) : null}
      </div>

      {/* ===== Generated results ===== */}
      {generated.length > 0 ? (
        <section>
          <SectionTitle icon={CheckCircle2}>Generated alt text</SectionTitle>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">
              {generated.length} ready to embed
            </h3>
            <Pager page={genPageSafe} totalPages={genTotalPages}
              onPrev={() => setGenPage((p) => Math.max(0, p - 1))}
              onNext={() => setGenPage((p) => Math.min(genTotalPages - 1, p + 1))} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {genItems.map((img) => (
              <article key={img.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex h-40 items-center justify-center bg-slate-50 p-2">
                  <img src={img.url} alt={img.suggestedAlt || img.title} className="max-h-36 max-w-full object-contain" />
                </div>
                <div className="space-y-1.5 p-4 text-sm">
                  <Row label={OWNER_LABEL[img.source] || 'Title'} value={img.title} />
                  <div className="flex gap-2">
                    <span className="w-24 shrink-0 text-slate-400">New alt</span>
                    <span className="min-w-0 flex-1 break-words font-medium text-indigo-700">{img.suggestedAlt}</span>
                  </div>
                  <p className="text-right text-xs text-slate-400">{(img.suggestedAlt || '').length}/120</p>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
            <Pager page={genPageSafe} totalPages={genTotalPages}
              onPrev={() => setGenPage((p) => Math.max(0, p - 1))}
              onNext={() => setGenPage((p) => Math.min(genTotalPages - 1, p + 1))} />
            <button
              onClick={apply}
              disabled={busy !== null || !hasSuggestions}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'apply' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              Embed all ({generated.length})
            </button>
          </div>
        </section>
      ) : null}

      <Divider />

      {/* ===== Note ===== */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Info className="h-4 w-4 text-indigo-500" /> Good to know
        </div>
        <ul className="ml-1 list-inside list-disc space-y-1.5 text-sm text-slate-600">
          <li>Alt text describes each image for screen readers and image SEO.</li>
          <li>Every alt is kept under 120 characters, with no quotes or odd symbols.</li>
          <li>Templates apply instantly; AI describes the actual image.</li>
          <li>You can re-run generation or clear alt text anytime.</li>
        </ul>
      </div>
    </div>
  );
}
