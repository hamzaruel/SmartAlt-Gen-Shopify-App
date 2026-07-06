'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  SlidersHorizontal,
  Package,
  FileText,
  BookOpen,
  Layers,
  Sparkles,
  Check,
  CheckCircle2,
  ScanLine,
  ListChecks,
} from 'lucide-react';
import { loadSettings, saveSettings } from '@/lib/settings';

const SOURCE_TOGGLES = [
  { id: 'product', label: 'Product images', icon: Package },
  { id: 'file', label: 'Content file images', icon: FileText },
  { id: 'article', label: 'Blog / post images', icon: BookOpen },
  { id: 'collection', label: 'Collection cover images', icon: Layers },
];

const LANGUAGES = [
  'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese',
  'Dutch', 'Arabic', 'Hindi', 'Chinese (Simplified)', 'Japanese',
];

// Which alt-text states the studio pre-ticks under "Apply to which images".
const STATUS_TOGGLES = [
  { id: 'MISSING', label: 'Missing alt text', dot: 'bg-rose-500' },
  { id: 'NEEDS_IMPROVEMENT', label: 'Needs improvement', dot: 'bg-amber-500' },
  { id: 'OPTIMIZED', label: 'Properly described', dot: 'bg-emerald-500' },
];

// Presentational switch (a span, not a button) so it can sit inside the clickable
// row <button> without nesting buttons. The row owns the click + aria-pressed.
function ToggleVisual({ checked }) {
  return (
    <span
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ${
        checked ? 'bg-indigo-600' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </span>
  );
}

// Section header with a soft tinted icon badge (matches the rest of the app).
function SectionHead({ icon: Icon, title, desc, chip }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${chip}`}>
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <div className="pt-0.5">
        <h2 className="text-base font-bold tracking-tight text-slate-900">{title}</h2>
        <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{desc}</p>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const shop = searchParams.get('shop');

  const [scanSources, setScanSources] = useState(['product', 'file', 'article', 'collection']);
  const [aiLanguage, setAiLanguage] = useState('');
  const [aiInstructions, setAiInstructions] = useState('');
  const [defaultApplyTo, setDefaultApplyTo] = useState(['MISSING', 'NEEDS_IMPROVEMENT']);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const s = loadSettings(shop);
    setScanSources(s.scanSources);
    setAiLanguage(s.aiLanguage || '');
    setAiInstructions(s.aiInstructions);
    setDefaultApplyTo(s.defaultApplyTo);
  }, [shop]);

  const toggleSource = (id) => {
    setSaved(false);
    setScanSources((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const toggleStatus = (id) => {
    setSaved(false);
    setDefaultApplyTo((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const save = () => {
    const sources = scanSources.length ? scanSources : ['product', 'file', 'article', 'collection'];
    saveSettings(shop, { scanSources: sources, aiLanguage, aiInstructions, defaultApplyTo });
    setScanSources(sources);
    setSaved(true);
  };

  return (
    <div className="space-y-6">
      {/* ===== Premium header ===== */}
      <header className="animate-card-in relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-violet-50 via-white to-indigo-50/60 p-6 shadow-sm sm:p-7">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-violet-200/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/4 h-52 w-52 rounded-full bg-fuchsia-200/25 blur-3xl" />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-violet-600 shadow-sm ring-1 ring-violet-100">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Scan &amp; AI defaults
          </span>
          <div className="mt-3 flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-50 to-violet-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
              <SlidersHorizontal className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              Your{' '}
              <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">preferences</span>
            </h1>
          </div>
          <p className="mt-2.5 max-w-xl text-base leading-relaxed text-slate-600">
            Set your defaults for{' '}
            <span className="font-semibold text-violet-600">scanning</span> and{' '}
            <span className="font-semibold text-indigo-600">AI generation</span>, so every run starts the way you like.
          </p>
        </div>
      </header>

      {/* ===== What to scan ===== */}
      <section className="animate-fade-in space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <SectionHead
          icon={ScanLine}
          chip="bg-indigo-50 text-indigo-600 ring-indigo-100"
          title="What to scan"
          desc="Choose which image sources a scan should cover. Turn off the ones you don’t use to scan faster."
        />
        <div className="grid gap-2.5 sm:grid-cols-2">
          {SOURCE_TOGGLES.map(({ id, label, icon: Icon }) => {
            const on = scanSources.includes(id);
            return (
              <button
                key={id}
                type="button"
                role="switch"
                aria-checked={on}
                onClick={() => toggleSource(id)}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                  on ? 'border-indigo-200 bg-indigo-50/40 ring-1 ring-indigo-100' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span className="flex items-center gap-2.5 text-sm font-medium text-slate-700">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-inset ${on ? 'bg-white text-indigo-600 ring-indigo-100' : 'bg-slate-50 text-slate-600 ring-slate-100'}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  {label}
                </span>
                <ToggleVisual checked={on} />
              </button>
            );
          })}
        </div>
        {scanSources.length === 0 ? (
          <p className="text-sm font-medium text-rose-600">Select at least one source, otherwise all sources are scanned.</p>
        ) : null}
      </section>

      {/* ===== AI defaults ===== */}
      <section className="animate-fade-in space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <SectionHead
          icon={Sparkles}
          chip="bg-violet-50 text-violet-600 ring-violet-100"
          title="AI defaults"
          desc="Set the language and any extra instructions for AI generation."
        />
        <div className="grid gap-4 sm:max-w-lg">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Alt text language</label>
            <select
              value={aiLanguage}
              onChange={(e) => { setSaved(false); setAiLanguage(e.target.value); }}
              className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-3 pr-10 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            >
              <option value="">Automatic (match your store)</option>
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-slate-600">AI will write alt text in this language.</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Extra instructions <span className="font-normal text-slate-600">(optional)</span></label>
            <textarea
              value={aiInstructions}
              onChange={(e) => { setSaved(false); setAiInstructions(e.target.value); }}
              rows={3}
              placeholder="e.g. Mention color and material when visible. Keep a friendly tone."
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        </div>
      </section>

      {/* ===== Default selection ===== */}
      <section className="animate-fade-in space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <SectionHead
          icon={ListChecks}
          chip="bg-emerald-50 text-emerald-600 ring-emerald-100"
          title="Default selection"
          desc="When you open Generate & embed, these alt text states are ticked automatically under “Apply to which images.” You can still change it each time."
        />
        <div className="grid gap-2.5 sm:grid-cols-3">
          {STATUS_TOGGLES.map(({ id, label, dot }) => {
            const on = defaultApplyTo.includes(id);
            return (
              <button
                key={id}
                type="button"
                role="switch"
                aria-checked={on}
                onClick={() => toggleStatus(id)}
                className={`flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left transition ${
                  on ? 'border-indigo-200 bg-indigo-50/40 ring-1 ring-indigo-100' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span className="flex items-center gap-2.5 text-sm font-medium text-slate-700">
                  <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
                  {label}
                </span>
                <ToggleVisual checked={on} />
              </button>
            );
          })}
        </div>
      </section>

      {/* ===== Save bar ===== */}
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <button
          onClick={save}
          className="group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/40 active:translate-y-0 active:scale-[0.98]"
        >
          <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full" />
          <span className="relative flex items-center gap-2">
            <Check className="h-4 w-4" /> Save settings
          </span>
        </button>
        {saved ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Saved
          </span>
        ) : (
          <span className="text-sm text-slate-600">Changes apply to your next scan and generation.</span>
        )}
      </div>
    </div>
  );
}
