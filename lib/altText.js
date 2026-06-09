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

// Ask Shopify's CDN for a smaller copy (much faster to fetch + send than a
// 3000px original, and plenty for the model to describe).
function resizedUrl(url, width = 640) {
  try {
    const u = new URL(url);
    u.searchParams.set('width', String(width));
    return u.toString();
  } catch {
    return url;
  }
}

async function fetchImageAsBase64(url) {
  const res = await fetch(resizedUrl(url));
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status})`);
  const mimeType = res.headers.get('content-type') || 'image/jpeg';
  const buf = Buffer.from(await res.arrayBuffer());
  return { data: buf.toString('base64'), mimeType };
}

// OPTION B (AI): describe the image for a WCAG-compliant alt text, with model fallback.
export async function generateWithGemini(imageUrl, context = '', instructions = '') {
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
