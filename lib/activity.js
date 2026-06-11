// Per-shop activity log, stored in the browser (localStorage). Records what the
// merchant did and when (scan / generate / embed / clear). Pure client-side —
// server stays token-only. Newest first, capped at MAX entries.

const keyFor = (shop) => `smartaltgen:activity:${shop || 'unknown'}`;
const MAX = 50;

export function loadActivity(shop) {
  if (typeof window === 'undefined' || !shop) return [];
  try {
    const raw = localStorage.getItem(keyFor(shop));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// event: { type: 'scan'|'generate'|'embed'|'clear', count: number, method?: string }
export function logActivity(shop, event) {
  if (typeof window === 'undefined' || !shop || !event?.type) return;
  try {
    const list = loadActivity(shop);
    list.unshift({ ...event, ts: Date.now() });
    localStorage.setItem(keyFor(shop), JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* storage disabled — ignore */
  }
}

// "just now" / "5 min ago" / "3 hours ago" / "2 days ago"
export function relativeTime(ts) {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w} week${w === 1 ? '' : 's'} ago`;
  return new Date(ts).toLocaleDateString();
}
