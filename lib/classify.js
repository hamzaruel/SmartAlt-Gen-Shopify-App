// Classify an image's alt text quality.

const GENERIC_ALTS = new Set([
  '', 'image', 'images', 'img', 'photo', 'picture', 'pic', 'product',
  'product image', 'product photo', 'untitled', 'default', 'thumbnail', 'logo',
]);

export function normalizeAlt(alt) {
  return (alt ?? '').trim().toLowerCase();
}

function isGeneric(normalized) {
  if (normalized.length < 5) return true;
  if (GENERIC_ALTS.has(normalized)) return true;
  if (/^(image|picture|photo) of\b/.test(normalized)) return true;
  if (/^(img|dsc|image|photo)[-_ ]?\d+/.test(normalized)) return true;
  if (/\.(jpg|jpeg|png|gif|webp)$/.test(normalized)) return true;
  return false;
}

// Returns { status, reason } where status is MISSING | NEEDS_IMPROVEMENT | OPTIMIZED.
// (No duplicate detection — only empty alts are MISSING and generic alts NEEDS_IMPROVEMENT.)
export function classify(alt) {
  const normalized = normalizeAlt(alt);
  if (normalized === '') return { status: 'MISSING', reason: null };
  if (isGeneric(normalized)) return { status: 'NEEDS_IMPROVEMENT', reason: 'generic' };
  return { status: 'OPTIMIZED', reason: null };
}
