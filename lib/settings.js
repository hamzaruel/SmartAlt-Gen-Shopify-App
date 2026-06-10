// Per-shop app settings, persisted in the browser (localStorage) so they survive
// across sessions. Pure client-side — the server stays token-only. Cross-device
// sync would need a Turso table later.

const ALL_SOURCES = ['product', 'file', 'article', 'collection'];

const DEFAULTS = {
  scanSources: [...ALL_SOURCES], // which image sources the scan covers
  aiLanguage: '',                // '' = automatic; otherwise AI writes alt text in this language
  aiInstructions: '',            // default extra instructions sent to AI generation
  skipExisting: false,           // default for "skip images that already have alt text"
};

const keyFor = (shop) => `smartaltgen:settings:${shop || 'unknown'}`;

export function loadSettings(shop) {
  if (typeof window === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(keyFor(shop));
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULTS,
      ...parsed,
      // never let scanSources be empty/invalid
      scanSources: Array.isArray(parsed.scanSources) && parsed.scanSources.length
        ? parsed.scanSources.filter((s) => ALL_SOURCES.includes(s))
        : [...ALL_SOURCES],
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(shop, settings) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(keyFor(shop), JSON.stringify(settings));
  } catch {
    /* storage disabled — ignore */
  }
}

export { ALL_SOURCES, DEFAULTS };
