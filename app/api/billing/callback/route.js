import { NextResponse } from 'next/server';
import { BASE_PATH } from '@/lib/basePath';

export const dynamic = 'force-dynamic';

// GET /api/billing/callback?shop=...
// With Managed Pricing, Shopify redirects the merchant to the plan's configured
// Redirect URL after selection (we use "/"), so this route isn't normally in the
// flow. Kept as a safe fallback that sends them into the embedded billing page.
export async function GET(request) {
  const shop = new URL(request.url).searchParams.get('shop');
  if (!shop) return NextResponse.redirect('https://admin.shopify.com');

  const shopSlug = shop.replace('.myshopify.com', '');
  const handle = process.env.SHOPIFY_APP_HANDLE;
  const back = handle
    ? `https://admin.shopify.com/store/${shopSlug}/apps/${handle}${BASE_PATH}/billing`
    : `https://admin.shopify.com/store/${shopSlug}/apps`;
  return NextResponse.redirect(back);
}
