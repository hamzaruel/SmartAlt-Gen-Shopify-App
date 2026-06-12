import { NextResponse } from 'next/server';
import { getShopToken } from '@/lib/serverAuth';
import { generateRuleBased, generateWithGemini } from '@/lib/altText';
import { getEntitlement } from '@/lib/billing/usage';
import { meterAiUsage } from '@/lib/billing/meter';

export const dynamic = 'force-dynamic';

// POST /api/generate?shop=...
// body: { mode: 'ai' | 'ai_custom' | 'title', items: [...] }
// Rule-based modes (title/template) are FREE. AI modes require a paid plan and
// are metered against the plan's monthly quota (Compliance bills overflow).
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

  // ---- Billing gate (AI modes only; rule-based/title is always free) ----
  let entitlement = null;
  let aiBudget = Infinity;
  if (isAi) {
    entitlement = await getEntitlement(shop, token);
    if (!entitlement.plan.ai || !entitlement.active) {
      return NextResponse.json({
        results: [],
        errors: [`AI generation isn’t included in your ${entitlement.plan.name} plan. Upgrade to generate AI alt text.`],
        upgradeRequired: true,
        plan: entitlement.plan.id,
        mode,
      });
    }
    aiBudget = entitlement.remaining;
    if (aiBudget <= 0) {
      return NextResponse.json({
        results: [],
        errors: ['You’ve reached your monthly AI image limit. Upgrade your plan or wait for the next billing cycle.'],
        quotaReached: true,
        plan: entitlement.plan.id,
        mode,
      });
    }
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
  let quotaHit = false; // Gemini-side rate limit (429)
  let aiGenerated = 0; // images generated in THIS request (for metering)

  async function runItem(item) {
    if (quotaHit) return;
    if (isAi && aiGenerated >= aiBudget) return; // plan budget reached
    try {
      const alt = isAi
        ? await generateWithGemini(item.url, buildContext(item), instructions)
        : generateRuleBased({ title: item.title, type: item.type, position: item.position });
      if (isAi) aiGenerated += 1;
      results.push({ key: item.key, suggestedAlt: alt });
    } catch (e) {
      const msg = e.message || 'failed';
      if (isAi && /\b429\b|quota|rate.?limit/i.test(msg)) {
        quotaHit = true; // one image hit the Gemini cap → stop the rest
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
      while (queue.length && !quotaHit && !(isAi && aiGenerated >= aiBudget)) {
        const item = queue.shift();
        if (item) await runItem(item);
      }
    }),
  );

  // Record AI usage + charge Compliance overflow (whole blocks, cap-aware).
  let billing = null;
  if (isAi && aiGenerated > 0) {
    try {
      billing = await meterAiUsage(shop, token, entitlement, aiGenerated);
    } catch (e) {
      console.error('metering error:', e);
    }
  }

  if (quotaHit) {
    return NextResponse.json({
      results,
      errors: ['AI is busy right now. Please try again in a little while, or use a template.'],
      mode,
    });
  }

  const extra = [];
  if (isAi && aiGenerated >= aiBudget && items.length > aiGenerated) {
    extra.push('You’ve reached your monthly AI image limit — some images weren’t generated. Upgrade to continue.');
  }
  if (billing?.capReached) {
    extra.push('Your usage cap was reached. Approve a higher cap to keep generating.');
  }

  return NextResponse.json({
    results,
    errors: [...errors, ...extra],
    mode,
    ...(billing ? { used: billing.total, overflowChargedBlocks: billing.overflowChargedBlocks } : {}),
  });
}
