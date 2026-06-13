// Shared scan cache. sessionStorage is the fast local copy (instant within a
// tab); Turso is the durable source of truth (survives tab close, loads on any
// device). Any local save is mirrored to the server (debounced); on a fresh
// tab/device, hydrateScan() pulls it back from the server. Keyed by shop.
import { authHeaders } from './sessionToken';
import { BASE_PATH } from './basePath';

const keyFor = (shop) => `smartaltgen:scan:${shop || 'unknown'}`;

// ---- Server sync ----------------------------------------------------------
export async function saveScanToServer(shop, payload) {
  if (!shop || !payload?.images) return;
  try {
    await fetch(`${BASE_PATH}/api/scan/state?shop=${encodeURIComponent(shop)}`, {
      method: 'POST',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    /* offline / transient — sessionStorage still holds the copy */
  }
}

async function loadScanFromServer(shop) {
  if (!shop) return null;
  try {
    const res = await fetch(`${BASE_PATH}/api/scan/state?shop=${encodeURIComponent(shop)}`, {
      headers: await authHeaders(),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.scan?.images ? data.scan : null;
  } catch {
    return null;
  }
}

// Coalesce rapid local saves (e.g. per-batch generation patches) into one server
// write ~1.5s after the last change.
let syncTimer = null;
let pending = null;
function scheduleServerSync(shop, payload) {
  pending = { shop, payload };
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const p = pending;
    pending = null;
    syncTimer = null;
    if (p) saveScanToServer(p.shop, p.payload);
  }, 1500);
}

// Local cache first; if empty (fresh tab/device), pull from the server and
// repopulate sessionStorage so later reads are instant.
export async function hydrateScan(shop) {
  const local = loadScan(shop);
  if (local) return local;
  const remote = await loadScanFromServer(shop);
  if (remote?.images && typeof window !== 'undefined') {
    try {
      sessionStorage.setItem(keyFor(shop), JSON.stringify(remote));
    } catch {
      /* ignore */
    }
  }
  return remote;
}

export function statusOf(image) {
  return image.status;
}

export function computeStats(images) {
  const stats = { total: 0, missing: 0, needsImprovement: 0, optimized: 0 };
  for (const img of images) {
    stats.total += 1;
    if (img.status === 'MISSING') stats.missing += 1;
    else if (img.status === 'NEEDS_IMPROVEMENT') stats.needsImprovement += 1;
    else stats.optimized += 1;
  }
  return stats;
}

export function loadScan(shop) {
  if (typeof window === 'undefined' || !shop) return null;
  try {
    const raw = sessionStorage.getItem(keyFor(shop));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveScan(shop, images) {
  if (typeof window === 'undefined' || !shop) return;
  const payload = { images, stats: computeStats(images), scannedAt: Date.now() };
  try {
    sessionStorage.setItem(keyFor(shop), JSON.stringify(payload));
  } catch {
    /* quota / disabled storage — ignore */
  }
  scheduleServerSync(shop, payload); // mirror to Turso (debounced)
  return payload;
}

// Apply `patch` (a function key -> partial image | null) and persist.
export function patchImages(shop, patchByKey) {
  const current = loadScan(shop);
  if (!current) return null;
  const images = current.images.map((img) =>
    patchByKey[img.key] ? { ...img, ...patchByKey[img.key] } : img,
  );
  return saveScan(shop, images);
}
