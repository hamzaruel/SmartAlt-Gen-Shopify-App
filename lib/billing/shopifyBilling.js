// Shopify Billing API (GraphQL Admin) — subscription create, active-subscription
// lookup, and usage records for Compliance overflow. Uses the shared adminGraphQL
// client so auth/retries/version stay consistent with the rest of the app.
import { adminGraphQL } from '@/lib/shopifyAdmin';
import { isTestBilling } from './plans';

const CURRENCY = 'USD';

// Build the subscription line items for a plan: one recurring line, plus a usage
// line for plans with overflow (Compliance).
function lineItemsFor(plan) {
  const items = [
    {
      plan: {
        appRecurringPricingDetails: {
          price: { amount: plan.price, currencyCode: CURRENCY },
          interval: plan.interval,
        },
      },
    },
  ];
  if (plan.overflow) {
    items.push({
      plan: {
        appUsagePricingDetails: {
          terms: `$${plan.overflow.blockPrice} per ${plan.overflow.blockSize.toLocaleString()} AI images over ${plan.quota.toLocaleString()}`,
          cappedAmount: { amount: plan.overflow.cappedAmount, currencyCode: CURRENCY },
        },
      },
    });
  }
  return items;
}

const CREATE_MUTATION = `
  mutation AppSubscriptionCreate($name: String!, $returnUrl: URL!, $test: Boolean, $lineItems: [AppSubscriptionLineItemInput!]!) {
    appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, lineItems: $lineItems) {
      userErrors { field message }
      confirmationUrl
      appSubscription { id status }
    }
  }
`;

// Create a (pending) subscription and return Shopify's confirmationUrl — the app
// redirects the merchant there to approve the charge.
export async function createSubscription(shop, token, plan, returnUrl) {
  const data = await adminGraphQL(shop, token, CREATE_MUTATION, {
    name: `SmartAltGen ${plan.name}`,
    returnUrl,
    test: isTestBilling(),
    lineItems: lineItemsFor(plan),
  });
  const res = data.appSubscriptionCreate;
  if (res.userErrors?.length) {
    throw new Error(res.userErrors.map((e) => e.message).join('; '));
  }
  return { confirmationUrl: res.confirmationUrl, subscription: res.appSubscription };
}

const ACTIVE_SUBS_QUERY = `
  query ActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        currentPeriodEnd
        lineItems {
          id
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricing { price { amount currencyCode } interval }
              ... on AppUsagePricing {
                terms
                balanceUsed { amount currencyCode }
                cappedAmount { amount currencyCode }
              }
            }
          }
        }
      }
    }
  }
`;

// The one active subscription (Shopify allows a single active app subscription),
// flattened into the fields we care about.
export async function getActiveSubscription(shop, token) {
  const data = await adminGraphQL(shop, token, ACTIVE_SUBS_QUERY);
  const sub = data.currentAppInstallation?.activeSubscriptions?.[0];
  if (!sub) return null;

  let usageLine = null;
  let recurringPrice = null;
  for (const li of sub.lineItems || []) {
    const pd = li.plan?.pricingDetails;
    if (pd?.__typename === 'AppUsagePricing') {
      usageLine = {
        id: li.id,
        balanceUsed: Number(pd.balanceUsed?.amount || 0),
        cappedAmount: Number(pd.cappedAmount?.amount || 0),
      };
    } else if (pd?.__typename === 'AppRecurringPricing') {
      recurringPrice = Number(pd.price?.amount || 0);
    }
  }
  return {
    id: sub.id,
    name: sub.name,
    status: sub.status,
    test: sub.test,
    currentPeriodEnd: sub.currentPeriodEnd,
    recurringPrice,
    usageLine,
  };
}

const USAGE_RECORD_MUTATION = `
  mutation CreateUsageRecord($subscriptionLineItemId: ID!, $price: MoneyInput!, $description: String!) {
    appUsageRecordCreate(subscriptionLineItemId: $subscriptionLineItemId, price: $price, description: $description) {
      userErrors { field message }
      appUsageRecord { id }
    }
  }
`;

// Charge one usage record against the subscription's usage line item. Caller MUST
// have already checked the remaining balance (cappedAmount - balanceUsed) — we
// never rely on Shopify to reject an over-cap charge.
export async function createUsageRecord(shop, token, usageLineId, amount, description) {
  const data = await adminGraphQL(shop, token, USAGE_RECORD_MUTATION, {
    subscriptionLineItemId: usageLineId,
    price: { amount, currencyCode: CURRENCY },
    description,
  });
  const res = data.appUsageRecordCreate;
  if (res.userErrors?.length) {
    throw new Error(res.userErrors.map((e) => e.message).join('; '));
  }
  return res.appUsageRecord;
}
