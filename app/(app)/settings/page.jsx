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

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ${
        checked ? 'bg-indigo-600' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const shop = searchParams.get('shop');

  const [scanSources, setScanSources] = useState(['product', 'file', 'article', 'collection']);
  const [aiLanguage, setAiLanguage] = useState('');
  const [aiInstructions, setAiInstructions] = useState('');
  const [skipExisting, setSkipExisting] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const s = loadSettings(shop);
    setScanSources(s.scanSources);
    setAiLanguage(s.aiLanguage || '');
    setAiInstructions(s.aiInstructions);
    setSkipExisting(s.skipExisting);
  }, [shop]);

  const toggleSource = (id) => {
    setSaved(false);
    setScanSources((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const save = () => {
    const sources = scanSources.length ? scanSources : ['product', 'file', 'article', 'collection'];
    saveSettings(shop, { scanSources: sources, aiLanguage, aiInstructions, skipExisting });
    setScanSources(sources);
    setSaved(true);
  };

  return (
    <div className="space-y-8">
      {/* ===== Header ===== */}
      <header className="animate-card-in flex items-center gap-4 rounded-2xl bg-gradient-to-br from-indigo-50 to-white p-6">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
          <SlidersHorizontal className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Preferences</h1>
          <p className="mt-0.5 text-sm text-slate-600">Set your defaults for scanning and generating alt text.</p>
        </div>
      </header>

      {/* ===== What to scan ===== */}
      <section className="animate-fade-in space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">What to scan</h2>
          <p className="mt-0.5 text-sm text-slate-600">Choose which image sources a scan should cover. Turn off the ones you don’t use to scan faster.</p>
        </div>
        <div className="space-y-2.5">
          {SOURCE_TOGGLES.map(({ id, label, icon: Icon }) => (
            <div key={id} className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
              <span className="flex items-center gap-2.5 text-sm font-medium text-slate-700">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-slate-100">
                  <Icon className="h-4 w-4" />
                </span>
                {label}
              </span>
              <Toggle checked={scanSources.includes(id)} onChange={() => toggleSource(id)} />
            </div>
          ))}
        </div>
        {scanSources.length === 0 ? (
          <p className="text-sm font-medium text-rose-600">Select at least one source — otherwise all sources are scanned.</p>
        ) : null}
      </section>

      {/* ===== AI defaults ===== */}
      <section className="animate-fade-in space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Sparkles className="h-4 w-4 text-indigo-500" /> AI defaults
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">Set the language and any extra instructions for AI generation.</p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Alt text language</label>
          <select
            value={aiLanguage}
            onChange={(e) => { setSaved(false); setAiLanguage(e.target.value); }}
            className="w-full max-w-sm rounded-xl border border-slate-300 bg-white py-2.5 pl-3 pr-10 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          >
            <option value="">Automatic (match your store)</option>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-slate-500">AI will write alt text in this language.</p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Extra instructions <span className="font-normal text-slate-500">(optional)</span></label>
          <textarea
            value={aiInstructions}
            onChange={(e) => { setSaved(false); setAiInstructions(e.target.value); }}
            rows={3}
            placeholder="e.g. Mention colour and material when visible. Keep a friendly tone."
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        </div>
      </section>

      {/* ===== Generation defaults ===== */}
      <section className="animate-fade-in space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800">Generation</h2>
        <div className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
          <span className="text-sm font-medium text-slate-700">
            Skip images that already have alt text
            <span className="mt-0.5 block text-xs font-normal text-slate-500">Only generate for images that are missing alt text.</span>
          </span>
          <Toggle checked={skipExisting} onChange={(v) => { setSaved(false); setSkipExisting(v); }} />
        </div>
      </section>

      {/* ===== Save ===== */}
      <div className="flex items-center gap-3">
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
        ) : null}
      </div>
    </div>
  );
}
