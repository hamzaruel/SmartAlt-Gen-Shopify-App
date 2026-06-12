import { NextResponse } from 'next/server';
import { getEntitlement } from '@/lib/billing/usage';

export const dynamic = 'force-dynamic';

// GET /api/billing/status?shop=...
// Current plan + usage, read from our own meter (the source of truth).
export async function GET(request) {
  const shop = new URL(request.url).searchParams.get('shop');
  if (!shop) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  try {
    const ent = await getEntitlement(shop);
    return NextResponse.json({
      plan: ent.plan.id,
      planName: ent.plan.name,
      ai: ent.plan.ai,
      quota: ent.quota,
      used: ent.aiUsed,
      remaining: ent.remaining,
      status: ent.status,
      active: ent.active,
      overflow: ent.plan.overflow || null,
      overflowBlocks: ent.overflowBlocks,
    });
  } catch (e) {
    console.error('billing status error:', e);
    return NextResponse.json({ error: 'Could not load billing status' }, { status: 500 });
  }
}
