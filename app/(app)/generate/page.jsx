'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
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
  Zap,
  CalendarClock,
  Clock,
  Play,
  RefreshCw,
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
  return sanitizeAlt(filled); // WCAG-clean: no quotes/special chars, word-boundary 120 cap
}

function SectionTitle({ icon: Icon, children, desc }) {
  return (
    <div className="mb-3 flex items-start gap-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <h2 className="text-sm font-semibold text-slate-800">{children}</h2>
        {desc ? <p className="mt-0.5 text-sm text-slate-500">{desc}</p> : null}
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
      <span className="w-24 shrink-0 text-slate-500">{label}</span>
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
      <p className="mt-0.5 text-right text-xs text-slate-500">{val.length}/120</p>
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
  const host = searchParams.get('host');
  const billingQs = `?shop=${encodeURIComponent(shop || '')}&host=${encodeURIComponent(host || '')}`;

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
  const [aiLanguage, setAiLanguage] = useState(''); // from Settings — language for AI alt text

  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [genProgress, setGenProgress] = useState(null); // { done, total } while AI generating
  const [upgrade, setUpgrade] = useState(false); // show "upgrade your plan" when AI quota is hit

  // ---- Bulk edit (auto-apply) + scheduling ----
  const [bulkScope, setBulkScope] = useState('missing'); // 'missing' | 'all'
  const [bulkRun, setBulkRun] = useState(null);           // live progress of an immediate bulk run
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [recurrence, setRecurrence] = useState('once');   // 'once' | 'daily' | 'weekly'
  const [schedDate, setSchedDate] = useState('');         // 'YYYY-MM-DD' (Run Once)
  const [schedTime, setSchedTime] = useState('09:00');    // 'HH:MM' local time
  const [schedWeekday, setSchedWeekday] = useState(1);    // 0=Sun … 6=Sat (Run Weekly)
  const [tasks, setTasks] = useState([]);                 // scheduled tasks for this shop
  const bulkPollRef = useRef(null);

  const refresh = useCallback(() => {
    setAllImages(loadScan(shop)?.images || []);
  }, [shop]);

  // Save a manual edit to a generated alt (before embedding).
  const commitEdit = useCallback((key, text) => {
    patchImages(shop, { [key]: { suggestedAlt: text } });
    refresh();
  }, [shop, refresh]);

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
      if (data.status === 'done' || data.status === 'error' || data.status === 'cancelled') {
        stopPolling();
        setBusy(null);
        setGenProgress(null);
        if (data.status === 'error') {
          setError(data.error || 'Generation stopped.');
          if (/limit|upgrade/i.test(data.error || '')) setUpgrade(true);
        } else if (data.status === 'cancelled') {
          setMessage('Generation stopped. Already-generated alt text is saved.');
        } else {
          if (data.done) logActivity(shop, { type: 'generate', count: data.done, method: 'ai' });
          setMessage('Alt text generated. Click “Embed all” to apply.');
        }
      }
    } catch {
      /* transient — keep polling */
    }
  }, [shop, refresh, stopPolling]);

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
        if (alive && data.status === 'running') {
          seqRef.current = 0;
          startBackgroundPolling();
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

  // Seed defaults from saved Settings (AI language + instructions + skip-existing).
  useEffect(() => {
    const s = loadSettings(shop);
    setAiLanguage(s.aiLanguage || '');
    setInstructions(s.aiInstructions || '');
    setSkipExisting(!!s.skipExisting);
  }, [shop]);

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

  const matching = selected ? allImages.filter((i) => i.source === selected) : [];
  const totalPages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages - 1);
  const pageItems = matching.slice(pageSafe * PAGE_SIZE, pageSafe * PAGE_SIZE + PAGE_SIZE);
  const selectedLabel = TYPES.find((t) => t.id === selected)?.label || '';
  const selMissing = matching.filter((i) => i.status === 'MISSING').length;
  const selNeeds = matching.filter((i) => i.status === 'NEEDS_IMPROVEMENT').length;
  const selOptimized = matching.filter((i) => i.status === 'OPTIMIZED').length;
  // jump into Image audit at a status tab, pre-filtered to the selected source
  const auditHref = (statusTab) =>
    `${BASE_PATH}/images?shop=${encodeURIComponent(shop || '')}&host=${encodeURIComponent(host || '')}&tab=${statusTab}&source=${selected || 'all'}`;

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
    setError(null);
    setMessage(null);
    setUpgrade(false);
    if (editTargets.length === 0) {
      setMessage('No images to edit with the current settings.');
      return;
    }

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
        if (data.upgradeRequired || data.quotaReached) {
          setUpgrade(true);
          setError(data.error || 'You’ve reached your plan’s AI limit. Upgrade to continue.');
          setBusy(null);
          return;
        }
        if (data.error || data.status !== 'running') {
          setError(data.error || 'Could not start generation.');
          setBusy(null);
          return;
        }
        seqRef.current = 0;
        setMessage('Generating in the background — you can leave this page or close the tab; it’ll keep going.');
        startBackgroundPolling(); // owns busy + progress from here
      } catch (e) {
        setError(e.message || 'Could not start generation.');
        setBusy(null);
      }
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
      const res = await fetch(`${BASE_PATH}/api/apply?shop=${encodeURIComponent(shop)}`, {
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
      if (data.applied) logActivity(shop, { type: 'embed', count: data.applied });
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
      if (data.status === 'done' || data.status === 'error') {
        stopBulkPolling();
        setBulkBusy(false);
        // Reflect the applied changes locally so the audit/preview update.
        await hydrateScan(shop);
        refresh();
        if (data.applied) logActivity(shop, { type: 'embed', count: data.applied });
        if (data.status === 'error') setError(data.note || 'Bulk edit stopped.');
        else setMessage(data.note || 'Bulk edit complete.');
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
      setMessage('Bulk edit started — it runs in the background and writes back automatically. You can close this tab.');
      startBulkPolling();
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

  const loadTasks = useCallback(async () => {
    if (!shop) return;
    try {
      const res = await fetch(`${BASE_PATH}/api/schedule?shop=${encodeURIComponent(shop)}`, { headers: await authHeaders() });
      const data = await res.json();
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
    } catch { /* ignore */ }
  }, [shop]);

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
      setMessage('Scheduled. It will run automatically at the time you set.');
      setShowSchedule(false);
      loadTasks();
    } catch (e) {
      setError(e.message || 'Could not schedule the task.');
    }
  }

  async function removeTask(id) {
    try {
      await fetch(`${BASE_PATH}/api/schedule?shop=${encodeURIComponent(shop)}&id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      loadTasks();
    } catch { /* ignore */ }
  }

  async function runTaskNow(task) {
    setError(null); setMessage(null);
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
      setMessage('Running this task now in the background.');
      startBulkPolling();
    } catch (e) {
      setError(e.message || 'Could not run the task.');
    }
  }

  // Load scheduled tasks + reconnect to a running bulk job on mount.
  useEffect(() => {
    if (!shop) return;
    loadTasks();
    (async () => {
      try {
        const res = await fetch(`${BASE_PATH}/api/bulk/status?shop=${encodeURIComponent(shop)}`, { headers: await authHeaders() });
        const data = await res.json();
        if (data.status === 'running') { setBulkRun(data); startBulkPolling(); }
      } catch { /* ignore */ }
    })();
    return () => stopBulkPolling();
  }, [shop, loadTasks, startBulkPolling, stopBulkPolling]);

  const REC_LABEL = { once: 'Once', daily: 'Daily', weekly: 'Weekly' };
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const TYPE_LABEL = { product: 'Products', collection: 'Collections', article: 'Blog posts', file: 'Files' };
  const MODE_LABEL = { ai: 'AI', ai_custom: 'AI (custom)', title: 'Title', template: 'Template', remove: 'Remove alt' };
  const bulkPct = bulkRun?.total ? Math.round((bulkRun.done / bulkRun.total) * 100) : 0;

  return (
    <div className="space-y-10">
      <header className="animate-card-in flex items-center gap-4 rounded-2xl bg-gradient-to-br from-indigo-50 to-white p-6">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
          <Wand2 className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Alt text studio</h1>
          <p className="mt-0.5 text-sm text-slate-600">Pick an image type, choose how to edit, then generate &amp; embed.</p>
        </div>
      </header>

      {/* ===== 1 · Select type ===== */}
      <section className="animate-fade-in">
        <SectionTitle icon={Layers} desc="Choose which kind of images you want to work on. The number shows how many of each are in your store.">Select which type of images to edit</SectionTitle>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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
                  <span className={`rounded-full px-1.5 py-0.5 text-xs ${active ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {selected ? (
          <div className="mt-3">
            <p className="text-sm text-slate-500">Alt text status for this type. Click any number to view those images in the audit.</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
            <span className="font-medium text-slate-700">{matching.length} {selectedLabel.toLowerCase()}</span>
            <a href={auditHref('MISSING')} className="inline-flex items-center gap-1.5 text-rose-600 underline-offset-2 hover:underline">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />{selMissing} missing alt
            </a>
            <a href={auditHref('NEEDS_IMPROVEMENT')} className="inline-flex items-center gap-1.5 text-amber-600 underline-offset-2 hover:underline">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{selNeeds} need work
            </a>
            <a href={auditHref('OPTIMIZED')} className="inline-flex items-center gap-1.5 text-emerald-600 underline-offset-2 hover:underline">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{selOptimized} optimized
            </a>
            </div>
          </div>
        ) : null}
      </section>

      {!selected ? (
        <div className="animate-fade-in flex items-start gap-3 rounded-2xl bg-indigo-50 px-4 py-3 text-sm text-slate-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
          <p>Pick an image type above to preview and edit its images.</p>
        </div>
      ) : null}

      <Divider />

      {/* ===== 2 · Preview ===== */}
          <section className="animate-fade-in">
            <SectionTitle icon={LayoutGrid} desc="See the images in this type and their current alt text before you make any changes.">Preview matching images</SectionTitle>
            <button
              onClick={() => setShowPreview((v) => !v)}
              disabled={!selected}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              {showPreview ? <EyeOff className="h-4 w-4 text-indigo-500" /> : <Eye className="h-4 w-4 text-indigo-500" />}
              {showPreview ? 'Hide preview' : 'Show preview'}
              <span className="text-slate-500">({matching.length})</span>
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
                      <article key={img.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md">
                        <div className="flex h-44 items-center justify-center bg-slate-50 p-2">
                          <img src={img.url} alt={img.currentAlt || img.title} className="max-h-40 max-w-full object-contain" />
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
          <section className="animate-fade-in">
            <SectionTitle icon={Wand2} desc="Choose how to create the alt text: a template, the item title, or AI.">Edit matching images</SectionTitle>
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

                  <p className="text-xs text-slate-500">
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
                          {always ? <span className="ml-auto text-xs text-slate-500">always</span> : null}
                        </label>
                      );
                    })}
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">
                      Special instructions <span className="font-normal text-slate-500">(optional)</span>
                    </label>
                    <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2}
                      placeholder="e.g. Write in English. Mention color and material"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
                  </div>
                </div>
              ) : editMode === 'remove' ? (
                <p className="text-sm text-slate-500">This clears the existing alt-text from the selected images in Shopify.</p>
              ) : (
                <p className="text-sm text-slate-500">Select an option above to continue.</p>
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

        {/* messages appear here — below the action, not at the top */}
        {message ? (
          <div className="mt-3 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm">
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

      <Divider />

      {/* ===== Bulk edit (auto write-back) + scheduling ===== */}
      <section className="animate-fade-in">
        <SectionTitle icon={Zap} desc="Generate AND save alt text to Shopify in one go — run it now in the background, or schedule it to run automatically.">
          Bulk edit &amp; schedule
        </SectionTitle>

        {!selected || !editMode ? (
          <div className="flex items-start gap-3 rounded-2xl bg-indigo-50 px-4 py-3 text-sm text-slate-600">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
            <p>Choose an image type and how to edit (above) to enable bulk editing.</p>
          </div>
        ) : (
          <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            {/* Scope choice */}
            {editMode !== 'remove' ? (
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">Apply to</p>
                <div className="flex flex-wrap gap-2.5">
                  {[
                    { id: 'missing', label: 'Only images missing alt text' },
                    { id: 'all', label: `All ${selectedLabel.toLowerCase()}` },
                  ].map((o) => {
                    const active = bulkScope === o.id;
                    return (
                      <button
                        key={o.id}
                        onClick={() => setBulkScope(o.id)}
                        className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition ${
                          active ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/25' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${active ? 'border-white' : 'border-slate-300'}`}>
                          {active ? <span className="h-2 w-2 rounded-full bg-white" /> : null}
                        </span>
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">This will remove alt text from {bulkTargets} {selectedLabel.toLowerCase()} that currently have it.</p>
            )}

            <p className="text-sm text-slate-600">
              About <span className="font-semibold text-slate-800 tabular-nums">{bulkTargets}</span> {selectedLabel.toLowerCase()} will be processed
              {' '}using <span className="font-semibold text-slate-800">{MODE_LABEL[editMode] || editMode}</span>, then written back to Shopify automatically.
            </p>

            {/* live bulk progress */}
            {bulkRun && (bulkRun.status === 'running' || bulkBusy) ? (
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="inline-flex items-center gap-2 font-medium text-slate-700">
                    <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                    {bulkRun.phase === 'scanning' ? 'Scanning your store…' : bulkRun.phase === 'applying' ? 'Saving to Shopify…' : 'Generating alt text…'}
                  </span>
                  <span className="font-semibold text-indigo-700 tabular-nums">{bulkRun.done} / {bulkRun.total || '—'}</span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-indigo-100">
                  <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 transition-all duration-300" style={{ width: `${bulkPct}%` }} />
                </div>
              </div>
            ) : null}

            {/* actions */}
            <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-4">
              <button
                onClick={startBulk}
                disabled={bulkBusy || bulkTargets === 0 || (editMode === 'template' && !activeTemplate.trim())}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/40 active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
              >
                {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Start Bulk Editing
              </button>
              <button
                onClick={() => setShowSchedule((v) => !v)}
                disabled={bulkTargets === 0 && editMode !== 'remove'}
                className="inline-flex items-center gap-2 rounded-xl border border-indigo-300 bg-white px-5 py-2.5 text-sm font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CalendarClock className="h-4 w-4" />
                Schedule Bulk Editing
              </button>
            </div>

            {/* schedule sub-form */}
            {showSchedule ? (
              <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
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
                    Step 2: Time of day to run <span className="font-normal text-slate-500">(your local time)</span>
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
          </div>
        )}
      </section>

      {/* ===== Scheduled tasks manager ===== */}
      {tasks.length ? (
        <section className="animate-fade-in">
          <SectionTitle icon={Clock} desc="Your automated bulk-edit tasks. They run on the server even if this tab is closed.">
            Scheduled bulk edits
          </SectionTitle>
          <div className="space-y-3">
            {tasks.map((t) => (
              <div key={t.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                      <RefreshCw className="h-3 w-3" /> {REC_LABEL[t.recurrence]}
                    </span>
                    <span>{(t.sources || []).map((s) => TYPE_LABEL[s] || s).join(', ')}</span>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-600">{MODE_LABEL[t.mode] || t.mode}</span>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-600">{t.scope === 'all' ? 'all images' : 'missing alt'}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {t.status === 'running' ? 'Running now…'
                      : t.status === 'done' ? 'Completed'
                      : t.status === 'error' ? 'Last run had an issue'
                      : `Next run: ${new Date(t.nextRunAt).toLocaleString()}`}
                    {t.lastSummary?.note ? ` · ${t.lastSummary.note}` : ''}
                    {t.lastSummary?.error ? ` · ${t.lastSummary.error}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => runTaskNow(t)} disabled={bulkBusy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
                    <Play className="h-3.5 w-3.5 text-indigo-500" /> Run now
                  </button>
                  <button onClick={() => removeTask(t.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50">
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ===== Generated results ===== */}
      {generated.length > 0 ? (
        <section className="animate-fade-in">
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
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">New alt (edit if needed)</label>
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
          <li>Alt text describes each image for screen readers and image SEO.</li>
          <li>Every alt is kept under 120 characters, with no quotes or odd symbols.</li>
          <li>Templates apply instantly; AI describes the actual image.</li>
          <li>You can re-run generation or clear alt text anytime.</li>
        </ul>
      </div>
    </div>
  );
}
