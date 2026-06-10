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
// Normal sentence punctuation (. , ' ! ? : ; & ( ) -) is fine — good descriptive alt
// text uses it. We only flag alt that is genuinely poor: weird symbols / quotes /
// brackets / emoji, longer than 120 chars (WCAG concise), or generic / placeholder /
// filename / "image of …" lead-in. reason ∈ 'symbols' | 'too-long' | 'generic'.
export function classify(alt) {
  const raw = (alt ?? '').toString().trim();
  if (raw === '') return { status: 'MISSING', reason: null };
  const normalized = raw.toLowerCase();

  // anything beyond letters/numbers/spaces and normal punctuation → quotes, brackets,
  // @ # $ % ^ * _ = + | \ / < > ~ `, emoji, etc.
  if (/[^\p{L}\p{N}\s.,'’!?:;&()\-]/u.test(raw)) return { status: 'NEEDS_IMPROVEMENT', reason: 'symbols' };
  // WCAG asks for concise alt text
  if (raw.length > 120) return { status: 'NEEDS_IMPROVEMENT', reason: 'too-long' };
  // generic / non-descriptive placeholder, filename, or "image of …" lead-in
  if (isGeneric(normalized)) return { status: 'NEEDS_IMPROVEMENT', reason: 'generic' };

  return { status: 'OPTIMIZED', reason: null };
}
