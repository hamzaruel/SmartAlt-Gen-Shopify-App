import { NextResponse } from 'next/server';
import { getShopToken } from '@/lib/serverAuth';
import { getEntitlement } from '@/lib/billing/usage';
import { startJob, runJob } from '@/lib/generationJob';

export const dynamic = 'force-dynamic';

// POST /api/generate/start?shop=...
// Starts a BACKGROUND AI-generation job (runs server-side until complete, even
// if the tab closes). body: { mode, items:[{key,url,title,type,vendor,position}], infoFields, instructions }
export async function POST(request) {
  const shop = new URL(request.url).searchParams.get('shop');
  if (!shop) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const token = await getShopToken(request, shop);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: 'AI generation isn’t available right now. Please use a template instead.' });
  }

  const body = await request.json().catch(() => ({}));
  const mode = body.mode === 'ai_custom' ? 'ai_custom' : 'ai';
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return NextResponse.json({ status: 'idle', total: 0 });
  const infoFields = Array.isArray(body.infoFields) ? body.infoFields : [];
  const instructions = (body.instructions || '').toString().slice(0, 300);

  // Compute entitlement now (we have a valid token) and bake the budget into the
  // job, so the background worker never needs a live Shopify call to know the plan.
  const ent = await getEntitlement(shop, token);
  if (!ent.plan.ai || !ent.active) {
    return NextResponse.json({
      upgradeRequired: true,
      planName: ent.plan.name,
      error: `AI generation isn’t included in your ${ent.plan.name} plan. Upgrade to generate AI alt text.`,
    });
  }
  if (ent.remaining <= 0) {
    return NextResponse.json({
      quotaReached: true,
      planName: ent.plan.name,
      quota: ent.plan.quota,
      error: 'You’ve used all of your AI alt text on this plan. Upgrade to generate more.',
    });
  }

  await startJob(shop, {
    items,
    mode,
    instructions,
    infoFields,
    planId: ent.planId,
    aiBudget: ent.remaining,
    cycleKey: ent.cycleKey,
  });

  // Fire-and-forget — keeps running in the PM2 process after this response.
  runJob(shop);

  // If the request asks for more images than the plan allows, the worker only does
  // `remaining` of them. Tell the client so it can explain + offer an upgrade.
  return NextResponse.json({
    status: 'running',
    total: items.length,
    capped: items.length > ent.remaining,
    allowed: ent.remaining,
    requested: items.length,
    planName: ent.plan.name,
    quota: ent.plan.quota,
  });
}
