// Client-side shared scan cache (sessionStorage).
// The server is token-only and persists no image data, so the scanned image
// list lives here and is shared across the Dashboard / Images / Generate pages
// within a tab session. Keyed by shop.

const keyFor = (shop) => `smartaltgen:scan:${shop || 'unknown'}`;

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
