// Per-shop app settings, persisted in the browser (localStorage) so they survive
// across sessions. Pure client-side — the server stays token-only. Cross-device
// sync would need a Turso table later.

const ALL_SOURCES = ['product', 'file', 'article', 'collection'];
const ALL_STATUSES = ['MISSING', 'NEEDS_IMPROVEMENT', 'OPTIMIZED'];

const DEFAULTS = {
  scanSources: [...ALL_SOURCES],                    // which image sources the scan covers
  aiLanguage: '',                                   // '' = automatic; otherwise AI writes alt text in this language
  aiInstructions: '',                               // default extra instructions sent to AI generation
  defaultApplyTo: ['MISSING', 'NEEDS_IMPROVEMENT'], // which alt-text states the studio pre-selects to generate for
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
      // defaultApplyTo may be empty (pre-select nothing); just keep valid statuses
      defaultApplyTo: Array.isArray(parsed.defaultApplyTo)
        ? parsed.defaultApplyTo.filter((s) => ALL_STATUSES.includes(s))
        : [...DEFAULTS.defaultApplyTo],
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

export { ALL_SOURCES, ALL_STATUSES, DEFAULTS };
