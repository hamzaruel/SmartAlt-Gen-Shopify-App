import { NextResponse } from 'next/server';
import { managedPricingUrl } from '@/lib/billing/shopifyBilling';

export const dynamic = 'force-dynamic';

// POST /api/billing/subscribe?shop=...
// Managed Pricing: we don't create the charge (that's blocked). We return the URL
// of Shopify's hosted plan-selection page; the client redirects the top window
// there, the merchant picks/approves a plan, and Shopify handles the billing.
export async function POST(request) {
  const shop = new URL(request.url).searchParams.get('shop');
  if (!shop) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const appHandle = process.env.SHOPIFY_APP_HANDLE;
  if (!appHandle) {
    console.error('SHOPIFY_APP_HANDLE not set — cannot build pricing page URL');
    return NextResponse.json({ error: 'Billing is not configured' }, { status: 500 });
  }

  return NextResponse.json({ confirmationUrl: managedPricingUrl(shop, appHandle) });
}
