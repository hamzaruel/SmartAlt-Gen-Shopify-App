import { NextResponse } from 'next/server';
import { getShopToken } from '@/lib/serverAuth';
import { generateRuleBased, generateWithGemini } from '@/lib/altText';

export const dynamic = 'force-dynamic';

// POST /api/generate?shop=...
// body: { mode: 'ai' | 'title', items: [{ key, source, url, title, type, position }] }
// Returns the same items with `suggestedAlt` filled in. Nothing is persisted.
export async function POST(request) {
  const shop = new URL(request.url).searchParams.get('shop');
  if (!shop) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const token = await getShopToken(request, shop);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const mode = body.mode === 'ai' || body.mode === 'ai_custom' ? body.mode : 'title';
  const isAi = mode === 'ai' || mode === 'ai_custom';
  const infoFields = Array.isArray(body.infoFields) ? body.infoFields : [];
  const instructions = (body.instructions || '').toString().slice(0, 300);
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return NextResponse.json({ results: [], errors: [] });

  // AI not set up yet → one clean message instead of an error per image.
  if (isAi && !process.env.GEMINI_API_KEY) {
    return NextResponse.json({
      results: [],
      errors: ['AI generation isn’t available right now. Please use a template instead.'],
      mode,
    });
  }

  const buildContext = (item) => {
    if (mode !== 'ai_custom') return '';
    const bits = [];
    if (infoFields.includes('title') && item.title) bits.push(`Title: ${item.title}`);
    if (infoFields.includes('type') && item.type) bits.push(`Type: ${item.type}`);
    if (infoFields.includes('vendor') && item.vendor) bits.push(`Vendor: ${item.vendor}`);
    return bits.join('; ');
  };

  const results = [];
  const errors = [];
  let quotaHit = false;

  async function runItem(item) {
    if (quotaHit) return;
    try {
      const alt = isAi
        ? await generateWithGemini(item.url, buildContext(item), instructions)
        : generateRuleBased({ title: item.title, type: item.type, position: item.position });
      results.push({ key: item.key, suggestedAlt: alt });
    } catch (e) {
      const msg = e.message || 'failed';
      if (isAi && /\b429\b|quota|rate.?limit/i.test(msg)) {
        quotaHit = true; // one image hit the cap → stop the rest
        return;
      }
      errors.push(`${item.title || item.key}: ${msg}`);
    }
  }

  // Process several images at once (instead of one-by-one) to cut total time.
  const CONCURRENCY = 4;
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length && !quotaHit) {
        const item = queue.shift();
        if (item) await runItem(item);
      }
    }),
  );

  if (quotaHit) {
    return NextResponse.json({
      results,
      errors: ['AI is busy right now. Please try again in a little while, or use a template.'],
      mode,
    });
  }

  return NextResponse.json({ results, errors, mode });
}
