import { NextResponse } from 'next/server';
import { getShopToken } from '@/lib/serverAuth';
import { BASE_PATH } from '@/lib/basePath';
import { getActiveSubscription } from '@/lib/billing/shopifyBilling';
import { saveSubscription } from '@/lib/billing/usage';
import { getPlan } from '@/lib/billing/plans';

export const dynamic = 'force-dynamic';

// GET /api/billing/callback?shop=...&plan=...
// Shopify sends the merchant here (top-level) after they approve the charge.
// We verify the subscription is active, cache it, then send them back into the
// embedded app's billing page.
export async function GET(request) {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const planId = url.searchParams.get('plan');
  if (!shop) return NextResponse.redirect('https://admin.shopify.com');

  try {
    const token = await getShopToken(request, shop);
    const sub = await getActiveSubscription(shop, token);
    if (sub && sub.status === 'ACTIVE') {
      const plan = getPlan(planId);
      await saveSubscription(shop, {
        planId: plan.id,
        subscriptionGid: sub.id,
        usageLineGid: sub.usageLine?.id || null,
        status: sub.status,
        cappedAmount: sub.usageLine?.cappedAmount || 0,
        // New cycle anchor at approval; refined when the period rolls over.
        cycleStart: sub.currentPeriodEnd || null,
        currentPeriodEnd: sub.currentPeriodEnd || null,
      });
    }
  } catch (e) {
    console.error('billing callback error:', e);
  }

  // Back into the embedded app (billing page). Shopify injects shop/host when it
  // loads the app via this admin deep link.
  const shopSlug = shop.replace('.myshopify.com', '');
  const handle = process.env.SHOPIFY_APP_HANDLE;
  const back = handle
    ? `https://admin.shopify.com/store/${shopSlug}/apps/${handle}${BASE_PATH}/billing`
    : `https://admin.shopify.com/store/${shopSlug}/apps`;
  return NextResponse.redirect(back);
}
