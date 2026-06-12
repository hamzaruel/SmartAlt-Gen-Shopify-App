import { NextResponse } from 'next/server';
import { getShopToken } from '@/lib/serverAuth';
import { resolveAppUrl } from '@/lib/appUrl';
import { BASE_PATH } from '@/lib/basePath';
import { getPlan, PAID_PLAN_IDS } from '@/lib/billing/plans';
import { createSubscription } from '@/lib/billing/shopifyBilling';

export const dynamic = 'force-dynamic';

// POST /api/billing/subscribe?shop=...   body: { plan: 'starter'|'growth'|'compliance' }
// Creates a (pending) Shopify subscription and returns the confirmationUrl for
// the merchant to approve. The client redirects the top window there.
export async function POST(request) {
  const shop = new URL(request.url).searchParams.get('shop');
  if (!shop) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const token = await getShopToken(request, shop);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const planId = body.plan;
  if (!PAID_PLAN_IDS.includes(planId)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
  }
  const plan = getPlan(planId);

  const returnUrl = `${resolveAppUrl(request)}${BASE_PATH}/api/billing/callback?shop=${encodeURIComponent(shop)}&plan=${planId}`;

  try {
    const { confirmationUrl } = await createSubscription(shop, token, plan, returnUrl);
    return NextResponse.json({ confirmationUrl });
  } catch (e) {
    console.error('billing subscribe error:', e);
    return NextResponse.json({ error: 'Could not start checkout' }, { status: 500 });
  }
}
