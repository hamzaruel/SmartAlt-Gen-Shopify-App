'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
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
  CalendarClock,
  RefreshCw,
  ListChecks,
  ArrowRight,
} from 'lucide-react';
import { loadScan, patchImages, hydrateScan } from '@/lib/scanStore';
import { authHeaders } from '@/lib/sessionToken';
import { BASE_PATH } from '@/lib/basePath';
import { sanitizeAlt } from '@/lib/sanitizeAlt';
import { loadSettings } from '@/lib/settings';
import { logActivity } from '@/lib/activity';

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

// Edit options shown in the dropdown, by image type. Blog/Post (and other non-product
// types) don't have product type/vendor, so template / AI-custom don't apply there —
// only AI (recommended) and the item's own title make sense.
function editOptionsFor(type) {
  if (type === 'all') {
    // Mixed types: product-only options (template / vendor) do not apply across
    // collections, posts and files, so we keep the universally safe choices.
    return [
      { value: 'ai', label: 'Generate alt text with AI (recommended)' },
      { value: 'title', label: "Use each item's own title as alt text" },
      { value: 'remove', label: 'Remove alt-text' },
    ];
  }
  if (type === 'article') {
    return [
      { value: 'ai', label: 'Generate alt text with AI (recommended)' },
      { value: 'title', label: 'Use the post title as alt text' },
    ];
  }
  return [
    { value: 'title', label: 'Update alt-text with product title' },
    { value: 'template', label: 'Update alt-text with a custom template' },
    { value: 'ai', label: 'Use AI to generate alt-text' },
    { value: 'ai_custom', label: 'Use AI with custom options' },
    { value: 'remove', label: 'Remove alt-text' },
  ];
}

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
  return sanitizeAlt(filled); // keeps alt clean: no quotes/special chars, concise length cap
}

function SectionTitle({ icon: Icon, children, desc, step }) {
  return (
    <div className="mb-4 flex items-start gap-3.5">
      {/* Premium gradient badge: shows the step number for the main flow,
          or the section icon for the advanced/results sections. */}
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-violet-500/25 ring-1 ring-inset ring-white/25">
        <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-white/20" />
        {step != null ? (
          <span className="relative text-base font-bold tabular-nums">{step}</span>
        ) : (
          <Icon className="relative h-5 w-5" strokeWidth={1.75} />
        )}
      </span>
      <div className="pt-0.5">
        {step != null ? (
          <span className="flex items-center gap-1.5 text-base font-bold uppercase tracking-wider text-violet-500">
            <Icon className="h-4 w-4" /> Step {step}
          </span>
        ) : null}
        <h2 className="text-base font-bold tracking-tight text-slate-900">{children}</h2>
        {desc ? <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{desc}</p> : null}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="h-px w-full bg-gradient-to-r from-transparent via-slate-200 to-transparent" />;
}

function Row({ label, value }) {
  return (
    <div className="flex gap-2">
      <span className="w-24 shrink-0 text-slate-600">{label}</span>
      <span className="min-w-0 flex-1 break-words text-slate-700">{value}</span>
    </div>
  );
}

// Editable alt-text box used in the generated results — lets the merchant fix the
// generated alt before embedding. Local state while typing; commits on blur.
function EditableAlt({ img, onCommit }) {
  const [val, setVal] = useState(img.suggestedAlt || '');
  useEffect(() => {
    setVal(img.suggestedAlt || '');
  }, [img.suggestedAlt, img.key]);
  return (
    <div>
      <textarea
        value={val}
        maxLength={120}
        rows={2}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => {
          if (val !== (img.suggestedAlt || '')) onCommit(img.key, val);
        }}
        className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-indigo-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
      />
      <p className="mt-0.5 text-right text-xs text-slate-600">{val.length}/120</p>
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
      <span className="text-slate-600">Page {page + 1} of {totalPages}</span>
      <button onClick={onNext} disabled={page >= totalPages - 1} aria-label="Next page"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function GeneratePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const shop = searchParams.get('shop');
  const host = searchParams.get('host');
  const billingQs = `?shop=${encodeURIComponent(shop || '')}&host=${encodeURIComponent(host || '')}`;
  // After starting/scheduling a bulk edit we send the merchant to the Tasks page,
  // where the run shows live status (pending → running → finished).
  //  - tasksHref: for raw <a> tags — must include BASE_PATH.
  //  - tasksPath: for router.push() — Next prepends BASE_PATH itself, so DON'T
  //    include it here or the path doubles up (/smart-alt-gen/smart-alt-gen/…).
  const tasksHref = `${BASE_PATH}/tasks${billingQs}`;
  const tasksPath = `/tasks${billingQs}`;

  const [allImages, setAllImages] = useState([]);
  const [selected, setSelected] = useState(null); // no type pre-selected
  const [showPreview, setShowPreview] = useState(true); // preview open by default
  // Per-image opt-out: keys the merchant unchecked in the preview. Empty = every
  // image is selected (the default). Unchecked images are skipped when generating
  // / removing alt text, whatever the chosen method (AI, template, title, remove).
  const [deselected, setDeselected] = useState(() => new Set());
  const [collectionFilter, setCollectionFilter] = useState(''); // preview: filter products by Shopify collection ('' = all)
  const [page, setPage] = useState(0);
  const [genPage, setGenPage] = useState(0);

  const [editMode, setEditMode] = useState(''); // '' until the merchant chooses
  const [templateChoice, setTemplateChoice] = useState(0);
  const [customTemplate, setCustomTemplate] = useState('');
  const [applyTo, setApplyTo] = useState(['MISSING', 'NEEDS_IMPROVEMENT']); // which status groups to generate for
  const [defaultApplyTo, setDefaultApplyTo] = useState(['MISSING', 'NEEDS_IMPROVEMENT']); // from Preferences — pre-ticked states
  const [infoFields, setInfoFields] = useState(['title']); // AI custom: what to feed the model
  const [instructions, setInstructions] = useState('');
  const [aiLanguage, setAiLanguage] = useState(''); // from Settings — language for AI alt text

  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [genProgress, setGenProgress] = useState(null); // { done, total } while AI generating
  const [genFailed, setGenFailed] = useState(0); // permanently-failed images (after 3 tries)
  const [retrying, setRetrying] = useState(false);
  const [upgrade, setUpgrade] = useState(false); // show "upgrade your plan" when AI quota is hit
  const [entitlement, setEntitlement] = useState(null); // { planName, quota, used, remaining, ai } for the inline AI quota meter

  // ---- Bulk edit (auto-apply) + scheduling ----
  const bulkScope = 'missing'; // bulk always targets images missing alt text (choice removed)
  const [bulkRun, setBulkRun] = useState(null);           // live progress of an immediate bulk run
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [recurrence, setRecurrence] = useState('once');   // 'once' | 'daily' | 'weekly'
  const [schedDate, setSchedDate] = useState('');         // 'YYYY-MM-DD' (Run Once)
  const [schedTime, setSchedTime] = useState('09:00');    // 'HH:MM' local time
  const [schedWeekday, setSchedWeekday] = useState(1);    // 0=Sun … 6=Sat (Run Weekly)
  const bulkPollRef = useRef(null);

  const refresh = useCallback(() => {
    setAllImages(loadScan(shop)?.images || []);
  }, [shop]);

  // Pull the live plan + AI usage so we can show an inline quota meter on the AI option.
  const fetchEntitlement = useCallback(async () => {
    if (!shop) return;
    try {
      const res = await fetch(`${BASE_PATH}/api/billing/status?shop=${encodeURIComponent(shop)}`, { headers: await authHeaders() });
      const data = await res.json();
      if (!data.error) setEntitlement(data);
    } catch { /* ignore */ }
  }, [shop]);

  // Save a manual edit to a generated alt (before embedding).
  const commitEdit = useCallback((key, text) => {
    patchImages(shop, { [key]: { suggestedAlt: text } });
    refresh();
  }, [shop, refresh]);

  // Auto-scroll targets: jump to the generated results when generation produces them,
  // and to the success message after an embed completes.
  const resultsRef = useRef(null);
  const messageRef = useRef(null);
  const wantScrollRef = useRef(false);   // set when a generate run starts
  const wantMsgScrollRef = useRef(false); // set when an embed succeeds

  // ---- Background AI generation: poll the server job + reconnect on load ----
  const pollRef = useRef(null);
  const seqRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const pollStatusOnce = useCallback(async () => {
    if (!shop) return;
    try {
      const res = await fetch(
        `${BASE_PATH}/api/generate/status?shop=${encodeURIComponent(shop)}&since=${seqRef.current}`,
        { headers: await authHeaders() },
      );
      const data = await res.json();
      if (data.status === 'idle') {
        stopPolling();
        setBusy(null);
        setGenProgress(null);
        return;
      }
      if (Array.isArray(data.results) && data.results.length) {
        const patch = {};
        for (const r of data.results) {
          patch[r.key] = { suggestedAlt: r.alt };
          if (r.seq > seqRef.current) seqRef.current = r.seq;
        }
        patchImages(shop, patch);
        refresh();
      }
      setGenProgress({ done: data.done || 0, total: data.total || 0 });
      setGenFailed(data.failed || 0);
      const paused = data.status === 'paused_quota' || data.status === 'paused_service';
      if (data.status === 'done' || data.status === 'error' || data.status === 'cancelled' || paused) {
        stopPolling();
        setBusy(null);
        setGenProgress(null);
        fetchEntitlement(); // refresh the AI quota meter with the authoritative count
        if (paused) {
          // Job is parked server-side; the scheduler auto-resumes it (no tab needed).
          if (data.status === 'paused_quota' && /upgrade/i.test(data.error || '')) setUpgrade(true);
          setMessage(data.error || 'Generation paused. It will resume automatically.');
        } else if (data.status === 'error') {
          setError(data.error || 'Generation stopped.');
          if (/limit|upgrade/i.test(data.error || '')) setUpgrade(true);
        } else if (data.status === 'cancelled') {
          setMessage('Generation stopped. Already-generated alt text is saved.');
        } else {
          if (data.done) logActivity(shop, { type: 'generate', count: data.done, method: 'ai' });
          setMessage(
            data.failed
              ? `Alt text generated. ${data.failed} image${data.failed === 1 ? '' : 's'} couldn’t be generated. Use “Retry failed”, then click “Embed all” to apply the rest.`
              : 'Alt text generated. Click “Embed all” to apply.',
          );
        }
      }
    } catch {
      /* transient — keep polling */
    }
  }, [shop, refresh, stopPolling, fetchEntitlement]);

  const startBackgroundPolling = useCallback(() => {
    setBusy('generate');
    stopPolling();
    pollRef.current = setInterval(pollStatusOnce, 3000);
    pollStatusOnce();
  }, [pollStatusOnce, stopPolling]);

  // Reconnect to a still-running background job after a refresh / tab close.
  useEffect(() => {
    if (!shop) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(
          `${BASE_PATH}/api/generate/status?shop=${encodeURIComponent(shop)}&since=0`,
          { headers: await authHeaders() },
        );
        const data = await res.json();
        if (!alive) return;
        if (data.status === 'running') {
          seqRef.current = 0;
          startBackgroundPolling();
        } else {
          // Not running: surface a lingering failed count / paused state on return.
          if (data.failed) setGenFailed(data.failed);
          if ((data.status === 'paused_quota' || data.status === 'paused_service') && data.error) {
            setMessage(data.error);
          }
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      alive = false;
      stopPolling();
    };
  }, [shop, startBackgroundPolling, stopPolling]);

  useEffect(() => {
    let alive = true;
    // Restore from server if this tab/device has no local cache, then render.
    hydrateScan(shop).then(() => {
      if (alive) refresh();
    });
    return () => {
      alive = false;
    };
  }, [shop, refresh]);

  // Seed defaults from saved Settings (AI language, instructions, default selection).
  useEffect(() => {
    const s = loadSettings(shop);
    setAiLanguage(s.aiLanguage || '');
    setInstructions(s.aiInstructions || '');
    setDefaultApplyTo(s.defaultApplyTo);
  }, [shop]);

  // Load the AI quota meter on mount.
  useEffect(() => { fetchEntitlement(); }, [fetchEntitlement]);

  // Pre-tick the status groups the merchant chose in Preferences (defaultApplyTo),
  // but only the ones that are actually present in the chosen type. Re-runs when the
  // type changes, the scan loads, or the saved default changes; a status-only change
  // (generate/embed keep the image count the same) won't override a manual choice.
  useEffect(() => {
    if (!selected) return;
    const m = selected === 'all' ? allImages : allImages.filter((i) => i.source === selected);
    const present = new Set(m.map((i) => i.status));
    setApplyTo(defaultApplyTo.filter((s) => present.has(s)));
  }, [selected, allImages.length, defaultApplyTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore the chosen type + edit mode on mount, so navigating away and coming
  // back keeps your selection and the generated results (instead of clearing it).
  // The per-type resets now live in the type-pill onClick (a manual switch), so
  // restoring here does NOT wipe the restored state.
  useEffect(() => {
    if (!shop) return;
    const savedType = sessionStorage.getItem(`smartaltgen:gentype:${shop}`);
    const savedMode = sessionStorage.getItem(`smartaltgen:genmode:${shop}`);
    if (savedType) {
      setSelected(savedType);
      const validModes = editOptionsFor(savedType).map((o) => o.value);
      if (savedMode && validModes.includes(savedMode)) setEditMode(savedMode);
    }
  }, [shop]);

  const editOptions = editOptionsFor(selected);

  const noScan = !loadScan(shop);
  const countBySource = (src) => allImages.filter((i) => i.source === src).length;

  const matching = selected ? (selected === 'all' ? allImages : allImages.filter((i) => i.source === selected)) : [];
  // Products can belong to Shopify collections — let the merchant narrow the PREVIEW
  // to one collection (a viewing filter only; generation still uses the full `matching`
  // set). A product may be in several collections, so counts can overlap.
  const productCollections = selected === 'product'
    ? Array.from(new Set(matching.flatMap((i) => i.collections || []))).sort((a, b) => a.localeCompare(b))
    : [];
  const previewMatching = selected === 'product' && collectionFilter
    ? matching.filter((i) => (i.collections || []).includes(collectionFilter))
    : matching;
  const totalPages = Math.max(1, Math.ceil(previewMatching.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages - 1);
  const pageItems = previewMatching.slice(pageSafe * PAGE_SIZE, pageSafe * PAGE_SIZE + PAGE_SIZE);
  const selectedLabel = selected === 'all' ? 'images' : TYPES.find((t) => t.id === selected)?.label || '';
  const selMissing = matching.filter((i) => i.status === 'MISSING').length;
  const selNeeds = matching.filter((i) => i.status === 'NEEDS_IMPROVEMENT').length;
  const selOptimized = matching.filter((i) => i.status === 'OPTIMIZED').length;

  // "Apply to" status groups (checkboxes), with live counts + a dynamic status line.
  const APPLY_GROUPS = [
    { id: 'MISSING', label: 'Missing', count: selMissing, dot: 'bg-rose-500', text: 'text-rose-600' },
    { id: 'NEEDS_IMPROVEMENT', label: 'Needs work', count: selNeeds, dot: 'bg-amber-500', text: 'text-amber-600' },
    { id: 'OPTIMIZED', label: 'Properly described', count: selOptimized, dot: 'bg-emerald-500', text: 'text-emerald-600' },
  ];
  const availableGroups = APPLY_GROUPS.filter((g) => g.count > 0);
  const allAvailableChecked = availableGroups.length > 0 && availableGroups.every((g) => applyTo.includes(g.id));
  let applyStatusNode;
  if (selMissing === 0 && selNeeds === 0) {
    applyStatusNode = `Great, all ${selectedLabel.toLowerCase()} already have clean alt text. Nothing to generate here.`;
  } else {
    const segs = [];
    if (selMissing > 0) segs.push(<span><span className="text-base font-bold text-slate-800">{selMissing}</span> <span className="font-semibold text-rose-600">missing alt text</span></span>);
    if (selNeeds > 0) segs.push(<span><span className="text-base font-bold text-slate-800">{selNeeds}</span> <span className="font-semibold text-amber-600">need improvement</span></span>);
    if (selOptimized > 0) segs.push(<span><span className="text-base font-bold text-slate-800">{selOptimized}</span> <span className="font-semibold text-emerald-600">properly described</span></span>);
    applyStatusNode = (
      <>
        {segs.map((s, i) => (
          <span key={i}>{i > 0 ? ', ' : ''}{s}</span>
        ))}
        . Tick the groups you want to generate for.
      </>
    );
  }
  // jump into Image audit at a status tab, pre-filtered to the selected source
  const auditHref = (statusTab) =>
    `${BASE_PATH}/images?shop=${encodeURIComponent(shop || '')}&host=${encodeURIComponent(host || '')}&tab=${statusTab}&source=${selected || 'all'}`;

  const activeTemplate = templateChoice === 'custom' ? customTemplate : TEMPLATES[templateChoice];
  // Real images from the current selection, used as live "reference" thumbnails next
  // to each template option (each option shows a different one + its example result).
  const sampleItems = matching.filter((i) => i.url);
  const hasAlt = (i) => i.currentAlt && i.currentAlt.trim() !== '';
  // A preview image counts as selected unless the merchant unchecked it.
  const isSelected = (i) => !deselected.has(i.key);
  const toggleImage = (key) =>
    setDeselected((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const selectedCount = previewMatching.filter(isSelected).length; // selected within the previewed (type-filtered) set
  const editTargets = matching.filter((i) => applyTo.includes(i.status) && isSelected(i)); // chosen status groups, minus unchecked
  const removeTargets = matching.filter((i) => hasAlt(i) && isSelected(i)); // for "Remove alt-text"
  const hasSuggestions = allImages.some((i) => i.suggestedAlt && (selected === 'all' || i.source === selected));

  // Generated results (selected type, now carrying a suggestedAlt) — paginated.
  const generated = matching.filter((i) => i.suggestedAlt);
  const genTotalPages = Math.max(1, Math.ceil(generated.length / PAGE_SIZE));
  const genPageSafe = Math.min(genPage, genTotalPages - 1);
  const genItems = generated.slice(genPageSafe * PAGE_SIZE, genPageSafe * PAGE_SIZE + PAGE_SIZE);

  // When a generate run first produces results, scroll the results panel into view.
  useEffect(() => {
    if (wantScrollRef.current && generated.length > 0) {
      wantScrollRef.current = false;
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }, [generated.length]);

  // After an embed succeeds, scroll to the success message so it's not missed.
  useEffect(() => {
    if (wantMsgScrollRef.current && message) {
      wantMsgScrollRef.current = false;
      requestAnimationFrame(() => messageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
  }, [message]);

  // Auto-dismiss any status message (success or error) after 30s so it doesn't linger.
  useEffect(() => {
    if (!message) return undefined;
    const id = setTimeout(() => setMessage(null), 30000);
    return () => clearTimeout(id);
  }, [message]);
  useEffect(() => {
    if (!error) return undefined;
    const id = setTimeout(() => setError(null), 30000);
    return () => clearTimeout(id);
  }, [error]);

  async function generate() {
    setError(null);
    setMessage(null);
    setUpgrade(false);
    if (editTargets.length === 0) {
      setMessage('No images to edit with the current settings.');
      return;
    }
    wantScrollRef.current = true; // jump to results once they appear

    // Template / title — instant, client-side.
    if (editMode === 'template' || editMode === 'title') {
      setBusy('generate');
      try {
        const tpl = editMode === 'title' ? '[product_title]' : activeTemplate;
        if (editMode === 'template' && !activeTemplate.trim()) throw new Error('Please choose or enter a template.');
        const patch = {};
        for (const img of editTargets) patch[img.key] = { suggestedAlt: applyTemplate(tpl, img) };
        patchImages(shop, patch);
        refresh();
        logActivity(shop, { type: 'generate', count: editTargets.length, method: editMode });
        setMessage('Alt text generated. Click “Embed all” to apply.');
      } catch (e) {
        setError(e.message || 'Generate failed');
      } finally {
        setBusy(null);
      }
      return;
    }

    // AI — runs as a BACKGROUND job on the server. It keeps going if you leave the
    // page or close the tab; this page reconnects by polling. Already-generated
    // images are skipped, so a re-run/resume continues the rest.
    if (editMode === 'ai' || editMode === 'ai_custom') {
      const pending = editTargets.filter((i) => !(i.suggestedAlt && i.suggestedAlt.trim()));
      if (pending.length === 0) {
        setMessage('All selected images already have generated alt text. Click “Embed all” to apply.');
        return;
      }
      const items = pending.map((i) => ({
        key: i.key, source: i.source, url: i.url, title: i.title, type: i.type, vendor: i.vendor, position: i.position,
      }));
      const langPrefix = aiLanguage ? `Write the alt text in ${aiLanguage}. ` : '';
      const finalInstructions = `${langPrefix}${instructions || ''}`.trim();

      setBusy('generate');
      try {
        const res = await fetch(`${BASE_PATH}/api/generate/start?shop=${encodeURIComponent(shop)}`, {
          method: 'POST',
          headers: await authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ mode: editMode, items, infoFields, instructions: finalInstructions }),
        });
        const data = await res.json();
        // AI quota used up (or plan has no AI) → inline notice, generate nothing.
        if (data.quotaReached || data.upgradeRequired) {
          setBusy(null);
          setUpgrade(true);
          setError(data.error || 'You’ve used all of your AI alt text on this plan. Upgrade to generate more.');
          fetchEntitlement();
          return;
        }
        if (data.error || data.status !== 'running') {
          setError(data.error || 'Could not start generation.');
          setBusy(null);
          return;
        }
        seqRef.current = 0;
        // Plan capped this run to the remaining quota → say so up front.
        if (data.capped) {
          setMessage(`Your ${data.planName || 'plan'} includes ${data.quota} AI alt texts. Generating the first ${data.allowed} of ${data.requested} now. Upgrade to do the rest.`);
          setUpgrade(true);
        } else {
          setMessage('Generating in the background. You can leave this page or close the tab and it’ll keep going.');
        }
        startBackgroundPolling(); // owns busy + progress from here
      } catch (e) {
        setError(e.message || 'Could not start generation.');
        setBusy(null);
      }
    }
  }

  // Re-queue every permanently-failed image for another pass (server-side).
  async function retryFailedImages() {
    setRetrying(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/generate/retry?shop=${encodeURIComponent(shop)}`, {
        method: 'POST',
        headers: await authHeaders(),
      });
      const data = await res.json();
      if (data.error || data.status !== 'running') {
        setError(data.error || 'Could not retry failed images.');
        return;
      }
      seqRef.current = 0;
      setGenFailed(0);
      setMessage('Retrying the images that failed. This runs in the background.');
      startBackgroundPolling();
    } catch (e) {
      setError(e.message || 'Could not retry failed images.');
    } finally {
      setRetrying(false);
    }
  }

  async function apply() {
    setBusy('apply');
    setError(null);
    setMessage(null);
    try {
      const items = allImages
        .filter((i) => i.suggestedAlt && (selected === 'all' || i.source === selected))
        .map((i) => ({ key: i.key, source: i.source, id: i.id, url: i.url, alt: i.suggestedAlt }));
      if (!items.length) {
        setMessage('No generated alt text to embed yet.');
        setBusy(null);
        return;
      }
      const res = await fetch(`${BASE_PATH}/api/apply?shop=${encodeURIComponent(shop)}`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error('apply failed', res.status, body);
        throw new Error(`Embed failed (HTTP ${res.status})${body ? `: ${body.slice(0, 300)}` : ''}`);
      }
      const data = await res.json();
      if (!data.errors?.length) {
        const patch = {};
        for (const t of items) patch[t.key] = { currentAlt: t.alt, suggestedAlt: null, status: 'OPTIMIZED', reason: null };
        patchImages(shop, patch);
      }
      refresh();
      if (data.applied) logActivity(shop, { type: 'embed', count: data.applied });
      wantMsgScrollRef.current = true; // scroll to the success message
      setMessage(`Alt text added to ${data.applied} image${data.applied === 1 ? '' : 's'} in Shopify.`);
      if (data.errors?.length) setError(data.errors.slice(0, 2).join(' | '));
    } catch (e) {
      console.error('apply error', e);
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
      const res = await fetch(`${BASE_PATH}/api/apply?shop=${encodeURIComponent(shop)}`, {
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
      if (data.applied) logActivity(shop, { type: 'clear', count: data.applied });
      setMessage(`Cleared alt text from ${data.applied} image${data.applied === 1 ? '' : 's'}.`);
      if (data.errors?.length) setError(data.errors.slice(0, 2).join(' | '));
    } catch (e) {
      setError(e.message || 'Remove failed');
    } finally {
      setBusy(null);
    }
  }

  // ---- Bulk edit (auto write-back) ----------------------------------------
  // Final AI instructions (language prefix + custom), shared by immediate + scheduled.
  const finalInstructions = `${aiLanguage ? `Write the alt text in ${aiLanguage}. ` : ''}${instructions || ''}`.trim();

  // Only touch images that don't already have alt text when the scope is "missing".
  // (Derived from bulkScope; replaces the old standalone skipExisting checkbox.)
  const skipExisting = bulkScope === 'missing';

  // Build the config sent to the server for a bulk run / schedule. The bulk run
  // operates on the SELECTED image type (sources:[selected]) using the chosen mode.
  const buildBulkConfig = useCallback(() => ({
    sources: selected ? [selected] : [],
    mode: editMode,
    template: activeTemplate,
    scope: bulkScope,
    skipExisting,
    infoFields,
    instructions: finalInstructions,
  }), [selected, editMode, activeTemplate, bulkScope, skipExisting, infoFields, finalInstructions]);

  // Client-side estimate of how many images this bulk run will touch (from the
  // last scan), so the buttons can show a count. The server re-scans authoritatively.
  const bulkTargets = (() => {
    if (!selected) return 0;
    let base = matching;
    if (editMode === 'remove') return matching.filter(hasAlt).length;
    if (bulkScope === 'missing') base = base.filter((i) => !hasAlt(i));
    if (skipExisting) base = base.filter((i) => !hasAlt(i));
    return base.length;
  })();

  const stopBulkPolling = useCallback(() => {
    if (bulkPollRef.current) clearInterval(bulkPollRef.current);
    bulkPollRef.current = null;
  }, []);

  const pollBulkOnce = useCallback(async () => {
    if (!shop) return;
    try {
      const res = await fetch(`${BASE_PATH}/api/bulk/status?shop=${encodeURIComponent(shop)}`, { headers: await authHeaders() });
      const data = await res.json();
      if (data.status === 'idle') { stopBulkPolling(); setBulkBusy(false); setBulkRun(null); return; }
      setBulkRun(data);
      const paused = data.status === 'paused_quota' || data.status === 'paused_service';
      if (data.status === 'done' || data.status === 'error' || paused) {
        stopBulkPolling();
        setBulkBusy(false);
        // Reflect any applied changes locally so the audit/preview update.
        await hydrateScan(shop);
        refresh();
        if (data.applied) logActivity(shop, { type: 'embed', count: data.applied });
        if (paused) {
          // Parked server-side; the scheduler auto-resumes (no tab needed).
          if (data.status === 'paused_quota' && /upgrade/i.test(data.note || '')) setUpgrade(true);
          setMessage(data.note || 'Bulk edit paused. It will resume automatically.');
        } else if (data.status === 'error') {
          setError(data.note || 'Bulk edit stopped.');
        } else {
          setMessage(data.note || 'Bulk edit complete.');
        }
      }
    } catch { /* transient — keep polling */ }
  }, [shop, stopBulkPolling, refresh]);

  const startBulkPolling = useCallback(() => {
    setBulkBusy(true);
    stopBulkPolling();
    bulkPollRef.current = setInterval(pollBulkOnce, 3000);
    pollBulkOnce();
  }, [pollBulkOnce, stopBulkPolling]);

  async function startBulk() {
    setError(null); setMessage(null); setUpgrade(false);
    if (!selected || !editMode) { setError('Pick an image type and how to edit first.'); return; }
    try {
      const res = await fetch(`${BASE_PATH}/api/bulk/start?shop=${encodeURIComponent(shop)}`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(buildBulkConfig()),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); if (/limit|upgrade|plan/i.test(data.error)) setUpgrade(true); return; }
      // Hand off to the Tasks page — the run shows there with live status.
      router.push(tasksPath);
    } catch (e) {
      setError(e.message || 'Could not start the bulk edit.');
    }
  }

  // Compute the absolute next-run time (epoch ms) from the merchant's LOCAL choices.
  function computeNextRunAt() {
    const [hh, mm] = (schedTime || '09:00').split(':').map((n) => parseInt(n, 10));
    if (recurrence === 'once') {
      if (!schedDate) return null;
      const d = new Date(`${schedDate}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`);
      return d.getTime();
    }
    const d = new Date();
    d.setSeconds(0, 0);
    d.setHours(hh, mm, 0, 0);
    if (recurrence === 'daily') {
      if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
    // weekly — advance to the chosen weekday
    const delta = (schedWeekday - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + delta);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 7);
    return d.getTime();
  }

  async function createSchedule() {
    setError(null); setMessage(null);
    if (!selected || !editMode) { setError('Pick an image type and how to edit first.'); return; }
    const nextRunAt = computeNextRunAt();
    if (!nextRunAt) { setError('Please choose a date and time.'); return; }
    try {
      const res = await fetch(`${BASE_PATH}/api/schedule?shop=${encodeURIComponent(shop)}`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ ...buildBulkConfig(), recurrence, timeLabel: schedTime, nextRunAt }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setShowSchedule(false);
      // Show the new scheduled task (and its future runs) on the Tasks page.
      router.push(tasksPath);
    } catch (e) {
      setError(e.message || 'Could not schedule the task.');
    }
  }

  // Reconnect to a bulk job that's still running (e.g. the merchant navigated
  // back here) so the inline progress near the button reflects it.
  useEffect(() => {
    if (!shop) return;
    (async () => {
      try {
        const res = await fetch(`${BASE_PATH}/api/bulk/status?shop=${encodeURIComponent(shop)}`, { headers: await authHeaders() });
        const data = await res.json();
        if (data.status === 'running') { setBulkRun(data); startBulkPolling(); }
      } catch { /* ignore */ }
    })();
    return () => stopBulkPolling();
  }, [shop, startBulkPolling, stopBulkPolling]);

  const REC_LABEL = { once: 'Once', daily: 'Daily', weekly: 'Weekly' };
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const bulkPct = bulkRun?.total ? Math.round((bulkRun.done / bulkRun.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <header className="animate-card-in flex items-center gap-3">
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-violet-500/30 ring-1 ring-inset ring-white/25">
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-white/20" />
          <Wand2 className="relative h-5 w-5" strokeWidth={1.75} />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Generate &amp; embed{' '}
            <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">alt text</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Write alt text with <span className="font-semibold text-violet-600">AI</span> or a{' '}
            <span className="font-semibold text-violet-600">template</span>, then save it straight to Shopify.
          </p>
        </div>
      </header>

      {/* ===== 1 · Select type ===== */}
      <section className="animate-fade-in">
        <SectionTitle step={1} icon={Layers} desc="Choose which kind of images you want to work on. The number shows how many of each are in your store.">Select which type of images to edit</SectionTitle>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {/* Apply-to-all checkbox, top right. Ticking it selects every type at once;
              the counts below + in "Apply to which images" update automatically. */}
          <div className="mb-3 flex items-center justify-end gap-3">
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={selected === 'all'}
                onChange={(e) => {
                  const next = e.target.checked ? 'all' : null;
                  setSelected(next);
                  setDeselected(new Set());
                  setCollectionFilter('');
                  setPage(0);
                  setGenPage(0);
                  setShowPreview(false);
                  setEditMode('');
                  sessionStorage.removeItem(`smartaltgen:genmode:${shop}`);
                  if (next) sessionStorage.setItem(`smartaltgen:gentype:${shop}`, next);
                  else sessionStorage.removeItem(`smartaltgen:gentype:${shop}`);
                }}
                className="h-4 w-4 rounded border-slate-300 accent-indigo-600"
              />
              Apply to all
            </label>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {TYPES.map(({ id, label, icon: Icon }) => {
              const active = selected === id;
              const count = countBySource(id);
              return (
                <button
                  key={id}
                  onClick={() => {
                    const next = active ? null : id;
                    setSelected(next);
                    // manual type switch starts fresh
                    setDeselected(new Set());
                    setCollectionFilter('');
                    setPage(0);
                    setGenPage(0);
                    setShowPreview(false);
                    setEditMode('');
                    sessionStorage.removeItem(`smartaltgen:genmode:${shop}`);
                    if (next) sessionStorage.setItem(`smartaltgen:gentype:${shop}`, next);
                    else sessionStorage.removeItem(`smartaltgen:gentype:${shop}`);
                  }}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 ease-out hover:-translate-y-0.5 active:scale-[0.97] ${
                    active
                      ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/25'
                      : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 hover:shadow-sm'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                  <span className={`rounded-full px-1.5 py-0.5 text-xs ${active ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-600'}`}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {selected ? (
          <div className="mt-3">
            <p className="text-sm text-slate-600">{selected === 'all' ? 'Alt text status across all image types' : 'Alt text status for this type'}. Click any number to view those images in the audit.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2.5 text-sm">
            <span className="inline-flex items-center px-1 py-1.5 font-semibold text-slate-700">{matching.length} {selectedLabel.toLowerCase()}</span>
            <a href={auditHref('MISSING')} className="inline-flex items-center gap-2 px-1 py-1.5 font-medium text-rose-700 transition hover:text-rose-800">
              <span className="h-2 w-2 rounded-full bg-rose-500" /><span className="underline underline-offset-2">{selMissing} missing alt</span>
            </a>
            <a href={auditHref('NEEDS_IMPROVEMENT')} className="inline-flex items-center gap-2 px-1 py-1.5 font-medium text-amber-700 transition hover:text-amber-800">
              <span className="h-2 w-2 rounded-full bg-amber-500" /><span className="underline underline-offset-2">{selNeeds} need work</span>
            </a>
            <a href={auditHref('OPTIMIZED')} className="inline-flex items-center gap-2 px-1 py-1.5 font-medium text-emerald-700 transition hover:text-emerald-800">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /><span className="underline underline-offset-2">{selOptimized} properly described</span>
            </a>
            </div>
          </div>
        ) : null}
      </section>

      <Divider />

      {/* ===== 2 · Preview ===== */}
          <section className="animate-fade-in">
            <SectionTitle step={2} icon={LayoutGrid} desc="See the images in this type and their current alt text before you make any changes.">Preview matching images</SectionTitle>
            <button
              onClick={() => setShowPreview((v) => !v)}
              disabled={!selected}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              {showPreview ? <EyeOff className="h-4 w-4 text-indigo-500" /> : <Eye className="h-4 w-4 text-indigo-500" />}
              {showPreview ? 'Hide preview' : 'Show preview'}
              <span className="text-slate-600">({matching.length})</span>
            </button>

            {showPreview ? (
              matching.length === 0 ? (
                <p className="mt-4 text-sm text-slate-600">No {selectedLabel.toLowerCase()} found.</p>
              ) : (
                <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  {/* Toolbar: selection summary (left) + product-type filter (right) */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200">
                        <span className="tabular-nums text-indigo-700">{selectedCount}</span>
                        <span className="text-slate-400">/</span>
                        <span className="tabular-nums">{previewMatching.length}</span>
                        <span className="font-medium text-slate-500">selected{collectionFilter ? ` in ${collectionFilter}` : ''}</span>
                      </span>
                      <button
                        onClick={() =>
                          setDeselected((cur) => {
                            const next = new Set(cur);
                            const allOn = previewMatching.every((i) => !next.has(i.key));
                            for (const i of previewMatching) {
                              if (allOn) next.add(i.key);
                              else next.delete(i.key);
                            }
                            return next;
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
                      >
                        {selectedCount === previewMatching.length ? <EyeOff className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        {selectedCount === previewMatching.length ? 'Deselect all' : 'Select all'}
                      </button>
                    </div>

                    {selected === 'product' && productCollections.length > 1 ? (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium text-slate-500">Filter by collection</span>
                        <select
                          value={collectionFilter}
                          onChange={(e) => { setCollectionFilter(e.target.value); setPage(0); }}
                          className="rounded-lg border border-slate-300 bg-white py-1.5 pl-3 pr-8 text-sm font-medium text-slate-800 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                        >
                          <option value="">All collections ({matching.length})</option>
                          {productCollections.map((c) => (
                            <option key={c} value={c}>
                              {c} ({matching.filter((i) => (i.collections || []).includes(c)).length})
                            </option>
                          ))}
                        </select>
                        {collectionFilter ? (
                          <button
                            onClick={() => { setCollectionFilter(''); setPage(0); }}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
                          >
                            <X className="h-3.5 w-3.5" /> Clear
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {/* Hint strip */}
                  <div className="flex items-center gap-2 border-b border-slate-100 bg-indigo-50/40 px-4 py-2.5 text-sm font-medium text-slate-600">
                    <Info className="h-4 w-4 shrink-0 text-indigo-400" />
                    All images are selected by default. Uncheck any image you want to skip. AI or the template won't apply alt text to it.
                  </div>

                  <div className="grid gap-4 p-4 sm:grid-cols-2">
                    {pageItems.map((img) => {
                      const sel = isSelected(img);
                      return (
                      <article key={img.key} className={`group/card overflow-hidden rounded-xl border bg-white shadow-sm transition-all duration-300 ${
                        sel ? 'border-indigo-200 ring-1 ring-indigo-100 hover:-translate-y-0.5 hover:shadow-md' : 'border-slate-200 opacity-60 hover:opacity-90'
                      }`}>
                        <div className="relative">
                          {/* Per-image select toggle. Clicking the image (or the badge) flips it. */}
                          <label className={`absolute left-2.5 top-2.5 z-10 flex cursor-pointer items-center gap-1.5 rounded-full py-1 pl-1.5 pr-2.5 text-xs font-semibold shadow-sm ring-1 backdrop-blur transition ${
                            sel ? 'bg-white/95 text-indigo-700 ring-indigo-200' : 'bg-white/95 text-slate-500 ring-slate-200'
                          }`}>
                            <input
                              type="checkbox"
                              checked={sel}
                              onChange={() => toggleImage(img.key)}
                              className="h-4 w-4 rounded border-slate-300 accent-indigo-600"
                            />
                            {sel ? 'Selected' : 'Skipped'}
                          </label>
                          <div
                            onClick={() => toggleImage(img.key)}
                            className="flex h-44 cursor-pointer items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100/60 p-3"
                          >
                            <img src={img.url} alt={img.currentAlt || img.title} className="max-h-40 max-w-full object-contain transition-transform duration-300 group-hover/card:scale-[1.03]" />
                          </div>
                        </div>
                        <div className="space-y-1.5 p-4 text-sm">
                          <Row label={OWNER_LABEL[img.source] || 'Title'} value={`${img.title}${img.source === 'product' ? ` (Position: ${img.position})` : ''}`} />
                          <Row label="Media type" value="Image" />
                          <Row label="File name" value={fileNameFromUrl(img.url)} />
                          <Row
                            label="Alt text"
                            value={
                              img.status === 'NEEDS_IMPROVEMENT' ? (
                                <span className="inline-flex flex-wrap items-center gap-2">
                                  <span className="break-words">{img.currentAlt || 'None'}</span>
                                  <a
                                    href={auditHref('NEEDS_IMPROVEMENT')}
                                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 transition hover:bg-amber-200"
                                  >
                                    Needs improvement
                                  </a>
                                </span>
                              ) : img.status === 'MISSING' ? (
                                <span className="text-rose-600">None</span>
                              ) : (
                                img.currentAlt || 'None'
                              )
                            }
                          />
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
                      );
                    })}
                  </div>

                  {totalPages > 1 ? (
                    <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-4 py-3 text-sm text-slate-500">
                      <span>Showing {pageSafe * PAGE_SIZE + 1}–{Math.min((pageSafe + 1) * PAGE_SIZE, previewMatching.length)} of {previewMatching.length}</span>
                      <Pager page={pageSafe} totalPages={totalPages}
                        onPrev={() => setPage((p) => Math.max(0, p - 1))}
                        onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))} />
                    </div>
                  ) : null}
                </div>
              )
            ) : null}
          </section>

          <Divider />

          {/* ===== 3 · Apply to ===== */}
          <section className="animate-fade-in">
            <SectionTitle step={3} icon={ListChecks} desc="Pick which images to generate alt text for. We tick the ones that need it; you can change this.">Apply to which images</SectionTitle>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              {selected ? (
                <>
                  {availableGroups.length > 1 ? (
                    <div className="mb-3 flex justify-end">
                      <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
                        <input
                          type="checkbox"
                          checked={allAvailableChecked}
                          onChange={(e) => setApplyTo(e.target.checked ? availableGroups.map((g) => g.id) : [])}
                          className="h-3.5 w-3.5 rounded border-slate-300 accent-indigo-600"
                        />
                        Select all
                      </label>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-3">
                    {APPLY_GROUPS.map(({ id, label, count, dot, text }) => {
                      const on = applyTo.includes(id);
                      const disabled = count === 0;
                      return (
                        <label
                          key={id}
                          className={`inline-flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm transition ${
                            disabled
                              ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
                              : on
                                ? 'cursor-pointer border-indigo-300 bg-indigo-50 text-slate-800 ring-1 ring-indigo-200'
                                : 'cursor-pointer border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={disabled}
                            onChange={() =>
                              setApplyTo((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
                            }
                            className="h-4 w-4 rounded border-slate-300 accent-indigo-600"
                          />
                          <span className={`h-2 w-2 rounded-full ${disabled ? 'bg-slate-200' : dot}`} />
                          <span className={`font-semibold ${disabled ? '' : text}`}>{label}</span>
                          <span className="text-xs text-slate-600">({count})</span>
                        </label>
                      );
                    })}
                  </div>

                  <p className="mt-3 text-sm text-slate-600">{applyStatusNode}</p>
                </>
              ) : (
                <p className="text-sm text-slate-600">Select an image type first.</p>
              )}
            </div>
          </section>

          <Divider />

          {/* ===== 4 · Edit ===== */}
          <section className="animate-fade-in">
            <SectionTitle step={4} icon={Wand2} desc="Choose how to create the alt text: a template, the item title, or AI.">Edit matching images</SectionTitle>
            <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Choose how you want to edit</label>
                <select
                  value={editMode}
                  onChange={(e) => {
                    setEditMode(e.target.value);
                    if (e.target.value) sessionStorage.setItem(`smartaltgen:genmode:${shop}`, e.target.value);
                    else sessionStorage.removeItem(`smartaltgen:genmode:${shop}`);
                  }}
                  className="w-full max-w-sm rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-10 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                >
                  <option value="" disabled>Choose how you want to edit…</option>
                  {editOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* AI quota meter: shows the plan's AI image allowance and counts down live. */}
              {(editMode === 'ai' || editMode === 'ai_custom') && entitlement ? (() => {
                const unlimited = (entitlement.quota || 0) >= 100000; // internal/test bypass
                const inRun = busy === 'generate' && genProgress;
                const used = (entitlement.used || 0) + (inRun ? genProgress.done : 0);
                const remaining = Math.max(0, (entitlement.remaining || 0) - (inRun ? genProgress.done : 0));
                const quota = entitlement.quota || 0;
                const pct = quota ? Math.min(100, Math.round((used / quota) * 100)) : 0;
                const out = !unlimited && remaining <= 0;
                if (unlimited) {
                  return (
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="text-xs font-bold uppercase tracking-wider">
                        <span className="text-indigo-600">{entitlement.planName} plan</span>
                        <span className="text-slate-400"> · AI alt text</span>
                      </p>
                      <p className="mt-1.5 text-sm font-semibold text-slate-800">Unlimited AI alt text on this plan.</p>
                    </div>
                  );
                }
                return (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-end justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-wider">
                          <span className="text-indigo-600">{entitlement.planName} plan</span>
                          <span className="text-slate-400"> · AI alt text</span>
                        </p>
                        <p className="mt-1.5 text-sm font-medium text-slate-700">
                          <span className="text-xl font-extrabold tabular-nums text-slate-900">{used.toLocaleString()}</span>
                          <span className="text-slate-500"> / {quota.toLocaleString()}</span> AI images used this cycle
                        </p>
                      </div>
                      <a href={`${BASE_PATH}/billing${billingQs}`} className="shrink-0 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 transition hover:bg-indigo-100">
                        {out ? 'Upgrade' : 'See plans'} &rarr;
                      </a>
                    </div>
                    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-2 text-xs font-medium text-slate-600">
                      {out
                        ? 'You’ve used all your AI alt text for this cycle. Upgrade for more, or use a free title-based template.'
                        : 'Title-based alt text is always free and unlimited.'}
                    </p>
                  </div>
                );
              })() : null}

              {editMode === 'template' ? (
                <div className="space-y-2.5">
                  <p className="text-sm text-slate-600">Choose a template or write your own. The image on the right shows a real example from your store.</p>
                  {TEMPLATES.map((t, i) => {
                    const active = templateChoice === i;
                    const sample = sampleItems.length ? sampleItems[i % sampleItems.length] : null;
                    const example = sample ? applyTemplate(t, sample) : '';
                    return (
                      <button key={t} onClick={() => setTemplateChoice(i)}
                        className={`flex w-full items-center gap-3 overflow-hidden rounded-lg border text-left transition ${
                          active ? 'border-indigo-300 bg-indigo-50/60 ring-1 ring-indigo-200' : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}>
                        <span className={`ml-4 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${active ? 'border-indigo-600' : 'border-slate-300'}`}>
                          {active ? <span className="h-2 w-2 rounded-full bg-indigo-600" /> : null}
                        </span>
                        <div className="min-w-0 flex-1 py-2.5">
                          <code className="block text-sm text-slate-700">{t}</code>
                          {example ? (
                            <p className="mt-1 truncate text-xs text-slate-500">
                              e.g. <span className="font-medium text-indigo-600">“{example}”</span>
                            </p>
                          ) : null}
                        </div>
                        {sample ? (
                          <span className="h-16 w-20 shrink-0 self-stretch overflow-hidden border-l border-slate-100 bg-slate-50">
                            <img src={sample.url} alt="" aria-hidden="true" className="h-full w-full object-contain p-1.5" />
                          </span>
                        ) : null}
                      </button>
                    );
                  })}

                  <button onClick={() => setTemplateChoice('custom')}
                    className={`flex w-full items-center gap-3 rounded-lg border px-4 py-2.5 text-left transition ${
                      templateChoice === 'custom' ? 'border-indigo-300 bg-indigo-50/60 ring-1 ring-indigo-200' : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}>
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${templateChoice === 'custom' ? 'border-indigo-600' : 'border-slate-300'}`}>
                      {templateChoice === 'custom' ? <span className="h-2 w-2 rounded-full bg-indigo-600" /> : null}
                    </span>
                    <span className="text-sm font-medium text-slate-700">Customize my own template</span>
                  </button>

                  {templateChoice === 'custom' ? (
                    <div className="space-y-2">
                      <input type="text" value={customTemplate} onChange={(e) => setCustomTemplate(e.target.value)}
                        placeholder="e.g. [product_title] [product_type]"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
                      {customTemplate.trim() && sampleItems.length ? (
                        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2">
                          <span className="h-12 w-14 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white">
                            <img src={sampleItems[0].url} alt="" aria-hidden="true" className="h-full w-full object-contain p-1" />
                          </span>
                          <p className="min-w-0 flex-1 truncate text-xs text-slate-500">
                            e.g. <span className="font-medium text-indigo-600">“{applyTemplate(customTemplate, sampleItems[0])}”</span>
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <p className="text-xs text-slate-600">
                    Placeholders: <code>[product_title]</code> <code>[product_type]</code> <code>[product_vendor]</code>. Empty ones are skipped.
                  </p>
                </div>
              ) : editMode === 'title' ? (
                <p className="text-sm text-slate-600">Each image will use its product title (or item name) as the alt text.</p>
              ) : editMode === 'ai' ? (
                <p className="text-sm text-slate-600">AI looks at each image and writes the alt text automatically.</p>
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
                          {always ? <span className="ml-auto text-xs text-slate-600">always</span> : null}
                        </label>
                      );
                    })}
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">
                      Special instructions <span className="font-normal text-slate-600">(optional)</span>
                    </label>
                    <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2}
                      placeholder="e.g. Write in English. Mention color and material"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
                  </div>
                </div>
              ) : editMode === 'remove' ? (
                <p className="text-sm text-slate-600">This clears the existing alt-text from the selected images in Shopify.</p>
              ) : (
                <p className="text-sm text-slate-600">Select an option above to continue.</p>
              )}
            </div>
          </section>

      <Divider />

      {/* ===== Generate / Schedule / Remove ===== */}
      <div>
        <div className="flex flex-wrap items-center gap-3">
          {editMode === 'remove' ? (
            <button
              onClick={clearAlt}
              disabled={busy !== null || removeTargets.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-rose-500/20 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-rose-700 hover:shadow-lg hover:shadow-rose-500/40 active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              {busy === 'generate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Clear alt-text{removeTargets.length ? ` (${removeTargets.length})` : ''}
            </button>
          ) : (
            <button
              onClick={generate}
              disabled={busy !== null || !editMode || editTargets.length === 0 || (editMode === 'template' && !activeTemplate.trim())}
              className="group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/40 active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-md"
            >
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full" />
              <span className="relative flex items-center gap-2">
                {busy === 'generate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                Generate{editTargets.length ? ` (${editTargets.length})` : ''}
              </span>
            </button>
          )}

          {/* Schedule bulk editing — generates AND saves alt text to Shopify automatically */}
          <button
            onClick={() => setShowSchedule((v) => !v)}
            disabled={bulkTargets === 0 && editMode !== 'remove'}
            className="inline-flex items-center gap-2 rounded-xl border border-indigo-300 bg-white px-5 py-2.5 text-sm font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CalendarClock className="h-4 w-4" />
            Schedule Bulk Editing
          </button>
        </div>

        {/* View all bulk edit tasks & their status */}
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <a href={tasksHref} className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 transition hover:text-indigo-700">
            <ListChecks className="h-4 w-4" /> View all bulk edit tasks &amp; their status
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>

        {/* live bulk progress (scheduled / background run) */}
        {bulkRun && (bulkRun.status === 'running' || bulkBusy) ? (
          <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
            <div className="flex items-center justify-between text-sm">
              <span className="inline-flex items-center gap-2 font-medium text-slate-700">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                {bulkRun.phase === 'scanning' ? 'Scanning your store…' : bulkRun.phase === 'applying' ? 'Saving to Shopify…' : 'Generating alt text…'}
              </span>
              <span className="font-semibold text-indigo-700 tabular-nums">{bulkRun.done} / {bulkRun.total || '…'}</span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-indigo-100">
              <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 transition-all duration-300" style={{ width: `${bulkPct}%` }} />
            </div>
          </div>
        ) : null}

        {/* schedule sub-form */}
        {showSchedule ? (
          <div className="mt-4 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">
                Step 1: Run <span className="font-semibold">once</span> on a future date, or repeat <span className="font-semibold">daily</span> / <span className="font-semibold">weekly</span>?
              </p>
              <div className="flex flex-wrap gap-2">
                {['once', 'daily', 'weekly'].map((r) => (
                  <button
                    key={r}
                    onClick={() => setRecurrence(r)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                      recurrence === r ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Run {REC_LABEL[r]}
                  </button>
                ))}
              </div>
            </div>

            {recurrence === 'once' ? (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Date</label>
                <input type="date" value={schedDate} onChange={(e) => setSchedDate(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
              </div>
            ) : null}

            {recurrence === 'weekly' ? (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Day of week</label>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((d, i) => (
                    <button key={d} onClick={() => setSchedWeekday(i)}
                      className={`h-9 w-12 rounded-lg text-sm font-medium transition ${schedWeekday === i ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100'}`}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Step 2: Time of day to run <span className="font-normal text-slate-600">(your local time)</span>
              </label>
              <input type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
            </div>

            <button
              onClick={createSchedule}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition hover:-translate-y-0.5 hover:bg-indigo-700 hover:shadow-lg active:translate-y-0"
            >
              <CalendarClock className="h-4 w-4" />
              Schedule Bulk Edit Task
            </button>
          </div>
        ) : null}

        {/* live AI progress (chunked generation) */}
        {genProgress ? (
          <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
            <div className="flex items-center justify-between text-sm">
              <span className="inline-flex items-center gap-2 font-medium text-slate-700">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-600" /> Generating alt text…
              </span>
              <span className="font-semibold text-indigo-700 tabular-nums">{genProgress.done} / {genProgress.total}</span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-indigo-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 transition-all duration-300"
                style={{ width: `${genProgress.total ? Math.round((genProgress.done / genProgress.total) * 100) : 0}%` }}
              />
            </div>
          </div>
        ) : null}

        {/* permanently-failed images (after 3 tries) — offer a re-queue */}
        {genFailed > 0 && !genProgress ? (
          <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm sm:flex-row sm:items-center">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
              <AlertCircle className="h-4 w-4" />
            </span>
            <span className="flex-1 text-sm font-medium text-amber-900">
              {genFailed} image{genFailed === 1 ? '' : 's'} couldn’t be generated after {3} tries.
            </span>
            <button
              onClick={retryFailedImages}
              disabled={retrying || busy !== null}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-amber-700 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
            >
              {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Retry failed
            </button>
          </div>
        ) : null}

        {/* messages appear here — below the action, not at the top */}
        {message ? (
          <div ref={messageRef} className="mt-3 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
            </span>
            <span className="flex-1 text-sm font-medium text-emerald-800">{message}</span>
            <button onClick={() => setMessage(null)} className="shrink-0 text-emerald-400 hover:text-emerald-600" aria-label="Dismiss"><X className="h-4 w-4" /></button>
          </div>
        ) : null}
        {error ? (
          <div className="mt-3 flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 shadow-sm">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600">
              <AlertCircle className="h-4 w-4" />
            </span>
            <span className="flex-1 text-sm font-medium text-rose-800">{error}</span>
            <button onClick={() => setError(null)} className="shrink-0 text-rose-400 hover:text-rose-600" aria-label="Dismiss"><X className="h-4 w-4" /></button>
          </div>
        ) : null}
        {upgrade ? (
          <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 shadow-sm sm:flex-row sm:items-center">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
              <Wand2 className="h-4 w-4" />
            </span>
            <span className="flex-1 text-sm font-medium text-indigo-900">
              You’ve reached your plan’s AI limit. Upgrade for more AI alt text.
            </span>
            <a
              href={`${BASE_PATH}/billing${billingQs}`}
              className="inline-flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-md"
            >
              Upgrade your plan
            </a>
          </div>
        ) : null}
      </div>

      {/* ===== Generated results ===== */}
      {generated.length > 0 ? (
        <section ref={resultsRef} className="animate-fade-in scroll-mt-6">
          <SectionTitle icon={CheckCircle2} desc="Review and tweak the alt text, then embed it into Shopify.">Generated alt text</SectionTitle>
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
              <article key={img.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md">
                <div className="flex h-40 items-center justify-center bg-slate-50 p-2">
                  <img src={img.url} alt={img.suggestedAlt || img.title} className="max-h-36 max-w-full object-contain" />
                </div>
                <div className="space-y-2 p-4 text-sm">
                  <Row label={OWNER_LABEL[img.source] || 'Title'} value={img.title} />
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">New alt (edit if needed)</label>
                    <EditableAlt img={img} onCommit={commitEdit} />
                  </div>
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
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-emerald-700 hover:shadow-lg hover:shadow-emerald-500/40 active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              {busy === 'apply' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              Embed all ({generated.length})
            </button>
          </div>
        </section>
      ) : null}

      <Divider />

      {/* ===== Note ===== */}
      <div className="animate-fade-in rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Info className="h-4 w-4 text-indigo-500" /> Good to know
        </div>
        <ul className="ml-1 list-inside list-disc space-y-1.5 text-sm text-slate-600">
          <li>Clear alt text is a <span className="font-semibold text-indigo-600">strong SEO signal</span> that helps your images <span className="font-semibold text-violet-600">rank in Google</span> and image search.</li>
          <li>It also makes your store more <span className="font-semibold text-violet-600">accessible</span>, describing each image for shoppers who use <span className="font-semibold text-indigo-600">screen readers</span>.</li>
          <li>Every alt is kept <span className="font-semibold text-indigo-600">clean and concise</span>, with no quotes or odd symbols.</li>
          <li><span className="font-semibold text-indigo-600">Templates</span> apply instantly; <span className="font-semibold text-violet-600">AI</span> describes the actual image.</li>
          <li>You can <span className="font-semibold text-indigo-600">re-run</span> generation or <span className="font-semibold text-indigo-600">clear alt text</span> anytime.</li>
        </ul>
      </div>

    </div>
  );
}
