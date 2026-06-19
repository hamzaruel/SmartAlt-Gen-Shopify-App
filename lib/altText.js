import { GoogleGenerativeAI } from '@google/generative-ai';
import { sanitizeAlt } from './sanitizeAlt';

export { sanitizeAlt };

// OPTION A (no AI): build alt text from metadata only (title/type/position).
// Works for products (title+type), files (derived title) and articles (title).
// e.g. "Men Black Cotton T Shirt" + type "T-Shirt" + position 2
//      -> "Men Black Cotton T Shirt T-Shirt view 2"
export function generateRuleBased({ title, type, position }) {
  let alt = (title ?? '').trim();
  const t = (type ?? '').trim();
  if (t && !alt.toLowerCase().includes(t.toLowerCase())) alt = `${alt} ${t}`;
  if (position > 1) alt = `${alt} view ${position}`;
  return sanitizeAlt(alt);
}

const AI_PROMPT = `Generate WCAG compliant alt text for this product image.

Rules:
- Maximum 120 characters
- Describe only visible content
- No keyword stuffing
- Do not start with "image of" or "picture of"
- Focus on product attributes (type, color, material, style)

Return only the alt text, nothing else.`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Models tried in order — if one is busy/unavailable/quota'd we fall straight
// through to the next so generation isn't blocked on a single model.
const MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-2.5-pro',
];

// Width we send to Gemini. 512 is the measured default; only bump to 768 after
// comparing billed promptTokenCount + retry rate via the usageMetadata logging
// below (a tall 768px image can spill into a 2nd tile a 512px one wouldn't).
const TARGET_WIDTH = 512;

// Ask Shopify's CDN for a smaller JPEG copy (much faster to fetch + send than a
// 3000px original, and plenty for the model to describe). For Shopify-hosted
// images the CDN does the resize + format conversion for us; for any other host
// those query params are ignored, so we flag it untrusted and resize locally.
function resizedUrl(url, width = TARGET_WIDTH) {
  try {
    const u = new URL(url);
    const trusted =
      u.hostname.endsWith('.shopify.com') || u.hostname.endsWith('.myshopify.com');
    if (trusted) {
      u.searchParams.set('width', String(width));
      u.searchParams.set('format', 'jpg');
    }
    return { url: u.toString(), trusted };
  } catch {
    return { url, trusted: false };
  }
}

async function fetchImageAsBase64(url, width = TARGET_WIDTH) {
  const { url: fetchUrl, trusted } = resizedUrl(url, width);
  const res = await fetch(fetchUrl);
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status})`);
  let buf = Buffer.from(await res.arrayBuffer());
  let mimeType = res.headers.get('content-type') || 'image/jpeg';

  // Non-Shopify host: the CDN resize/format params were ignored, so we may be
  // holding a full-resolution original. Enforce the size invariant locally so
  // what reaches Gemini is always ~width px JPEG, regardless of host.
  if (!trusted) {
    const { default: sharp } = await import('sharp');
    buf = await sharp(buf)
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    mimeType = 'image/jpeg';
  }

  return { data: buf.toString('base64'), mimeType };
}

// Test seam (Phase-1 queue verification only). Inert unless ALTGEN_TEST_HOOK=1.
// Lets the verifier exercise the retry queue deterministically without real
// Gemini calls: URL markers force image-faults, service-faults, or a flaky image
// that fails its first two attempts then succeeds.
const __testFlaky = new Map();
function __testGenerate(imageUrl) {
  if (imageUrl.includes('__IMG_FAIL__')) throw new Error('test: unsupported image format (400)');
  if (imageUrl.includes('__SVC_FAIL__')) throw new Error('test: model is overloaded (503)');
  if (imageUrl.includes('__FLAKY2__')) {
    const n = (__testFlaky.get(imageUrl) || 0) + 1;
    __testFlaky.set(imageUrl, n);
    if (n <= 2) throw new Error('test: transient image fetch error');
  }
  return sanitizeAlt(`Test alt for ${imageUrl.split('/').pop()}`);
}

// OPTION B (AI): describe the image for a WCAG-compliant alt text, with model fallback.
export async function generateWithGemini(imageUrl, context = '', instructions = '') {
  if (process.env.ALTGEN_TEST_HOOK === '1') return __testGenerate(imageUrl);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('AI is not configured yet');

  const genAI = new GoogleGenerativeAI(apiKey);
  const { data, mimeType } = await fetchImageAsBase64(imageUrl);

  let prompt = AI_PROMPT;
  if (context) prompt += `\n\nUse these product details for accuracy: ${context}`;
  if (instructions) prompt += `\n\nExtra instructions: ${instructions}`;
  const parts = [prompt, { inlineData: { data, mimeType } }];

  let lastErr;
  for (const modelName of MODELS) {
    const model = genAI.getGenerativeModel({ model: modelName });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await model.generateContent(parts);
        // Per-image token cost — this is the number that decides whether 512 vs
        // 768 (or batch vs real-time) is actually cheaper. Measure, don't guess.
        const u = result.response.usageMetadata;
        if (u) {
          console.log(
            `[gemini] ${modelName} tokens — prompt:${u.promptTokenCount} ` +
              `output:${u.candidatesTokenCount} total:${u.totalTokenCount}`,
          );
        }
        return sanitizeAlt(result.response.text());
      } catch (e) {
        lastErr = e;
        const msg = e?.message || '';
        // Busy/overloaded → one quick retry on the same model, else next model.
        if (/\b503\b|overloaded|high demand|UNAVAILABLE/i.test(msg)) {
          if (attempt === 0) { await sleep(700); continue; }
          break;
        }
        // Model missing or quota/rate-limited → jump to the next model right away.
        if (/\b404\b|not found|no longer available|quota|\b429\b|rate.?limit/i.test(msg)) break;
        // Anything else is a real error.
        throw e;
      }
    }
  }
  throw lastErr;
}
