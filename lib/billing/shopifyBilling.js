// Shopify App Pricing (Managed Pricing) integration.
//
// This app is a Managed Pricing app, so it CANNOT use the Billing API to create
// charges (appSubscriptionCreate / appUsageRecordCreate are blocked). Instead:
//   - plan selection happens on Shopify's hosted pricing page (we just redirect)
//   - we READ the active plan via the Admin API (reading is allowed)
//   - usage overflow is reported via the App Events API (the managed-pricing path)
import { adminGraphQL } from '@/lib/shopifyAdmin';

// Shopify's hosted plan-selection page. The merchant picks/upgrades a plan here
// and Shopify handles the charge. {handle} is the app handle (SHOPIFY_APP_HANDLE).
export function managedPricingUrl(shop, appHandle) {
  const slug = shop.replace('.myshopify.com', '');
  return `https://admin.shopify.com/store/${slug}/charges/${appHandle}/pricing_plans`;
}

const ACTIVE_SUBS_QUERY = `
  query ActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions { id name status test currentPeriodEnd }
    }
  }
`;

// The merchant's current plan (or null on Free / none). Reading subscriptions is
// allowed for Managed Pricing apps — only creating charges is blocked.
export async function getActiveSubscription(shop, token) {
  const data = await adminGraphQL(shop, token, ACTIVE_SUBS_QUERY);
  const sub = data.currentAppInstallation?.activeSubscriptions?.[0];
  if (!sub) return null;
  return {
    id: sub.id,
    name: sub.name,
    status: sub.status,
    test: sub.test,
    currentPeriodEnd: sub.currentPeriodEnd,
  };
}

const SHOP_GID_QUERY = `query ShopId { shop { id } }`;

export async function getShopGid(shop, token) {
  const data = await adminGraphQL(shop, token, SHOP_GID_QUERY);
  return data.shop?.id || null;
}

// Report one usage/billing event to Shopify for a Managed-Pricing usage charge.
// event_handle must match the meter handle configured in the Partner Dashboard
// (ai_overflow_block). Shopify aggregates + bills automatically.
// Docs: https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/setup-usage-charges
export async function postAppEvent(shop, token, { eventHandle, value, idempotencyKey, timestamp }) {
  const shopGid = await getShopGid(shop, token);
  if (!shopGid) throw new Error('Could not resolve shop GID for app event');

  const res = await fetch('https://api.shopify.com/app/unstable/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      shop_id: shopGid,
      event_handle: eventHandle,
      timestamp,
      idempotency_key: idempotencyKey,
      attributes: { value },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`App Events ${res.status}: ${text.slice(0, 200)}`);
  }
  return true;
}
