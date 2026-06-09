// Clean alt text to a WCAG-friendly form. Shared by template mode (client)
// and AI mode (server) so both produce the same tidy output:
//  - no quotes (straight or curly), no stray special characters / commas / periods
//  - no "image of" lead-in
//  - collapsed spaces, no dangling/duplicate hyphens
//  - hard cap at 120 chars cut on a word boundary (never a half word)
const MAX_LEN = 120;

export function sanitizeAlt(raw) {
  let s = (raw ?? '').toString().trim();

  // strip quotes / backticks (straight + curly)
  s = s.replace(/['"`‘’“”]/g, '');

  // drop a leading "image/photo/picture of"
  s = s.replace(/^(image|images|picture|photo|photograph)s?\s+of\s+/i, '');

  // keep letters, numbers, spaces and hyphens; everything else becomes a space
  s = s.replace(/[^\p{L}\p{N}\s-]/gu, ' ');

  // tidy hyphens + spaces
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/\s*-\s*/g, '-').replace(/-{2,}/g, '-');
  s = s.replace(/^[-\s]+|[-\s]+$/g, '').trim();

  // hard cap at 120 on a word boundary (no half words)
  if (s.length > MAX_LEN) {
    s = s.slice(0, MAX_LEN);
    const cut = Math.max(s.lastIndexOf(' '), s.lastIndexOf('-'));
    if (cut > 0) s = s.slice(0, cut);
    s = s.replace(/[-\s]+$/g, '').trim();
  }

  return s;
}
