import { NextResponse } from 'next/server';
import { getShopToken } from '@/lib/serverAuth';
import { getEntitlement } from '@/lib/billing/usage';

export const dynamic = 'force-dynamic';

// GET /api/billing/status?shop=...
// Current plan (read live from Shopify) + usage (from our meter).
export async function GET(request) {
  const shop = new URL(request.url).searchParams.get('shop');
  if (!shop) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  try {
    const token = await getShopToken(request, shop);
    const ent = await getEntitlement(shop, token);
    return NextResponse.json({
      plan: ent.planId,
      planName: ent.plan.name,
      ai: ent.plan.ai,
      quota: ent.quota,
      used: ent.aiUsed,
      remaining: ent.remaining,
      overflow: ent.plan.overflow || null,
      overflowBlocks: ent.overflowBlocks,
      currentPeriodEnd: ent.currentPeriodEnd,
    });
  } catch (e) {
    console.error('billing status error:', e);
    return NextResponse.json({ error: 'Could not load billing status' }, { status: 500 });
  }
}
