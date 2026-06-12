// SmartAltGen billing plans (Shopify Billing API).
//
// Free = the non-AI, rule-based path (alt text built from the product title) —
// available to everyone, no charge, no quota. Paid tiers unlock AI generation
// (Gemini) with a monthly image quota. Compliance adds hybrid usage overflow:
// a recurring base PLUS a metered usage line item billed per block over quota.
//
// Quota = number of AI images generated per 30-day billing cycle. Rule-based
// (title) generation never counts against quota and is always free.

export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    interval: 'EVERY_30_DAYS',
    ai: false, // rule-based (title) generation only
    quota: 0,
    overflow: null,
    blurb: 'Title-based alt text for product images. No AI, no limits.',
  },

  starter: {
    id: 'starter',
    name: 'Starter',
    price: 4.99,
    interval: 'EVERY_30_DAYS',
    ai: true,
    quota: 1000,
    overflow: null, // hard stop at quota (upgrade to continue)
    blurb: 'AI alt text for up to 1,000 images per month.',
  },

  growth: {
    id: 'growth',
    name: 'Growth',
    price: 9.99,
    interval: 'EVERY_30_DAYS',
    ai: true,
    quota: 10000,
    overflow: null,
    blurb: 'AI alt text for up to 10,000 images per month.',
  },

  compliance: {
    id: 'compliance',
    name: 'Compliance',
    price: 19.99,
    interval: 'EVERY_30_DAYS',
    ai: true,
    quota: 50000,
    // Hybrid usage overflow: beyond 50k, bill $4 per additional 10k block,
    // metered in our own DB and charged via appUsageRecordCreate against the
    // subscription's usage line item. cappedAmount is the cycle ceiling Shopify
    // will allow on that line item before fresh merchant approval is required.
    overflow: {
      blockSize: 10000, // images per overflow block
      blockPrice: 4.0, // USD per block
      cappedAmount: 100, // USD max usage billed per cycle (~250k extra images)
    },
    blurb: 'AI alt text for up to 50,000 images per month, then $4 per extra 10,000.',
  },
};

export const PAID_PLAN_IDS = ['starter', 'growth', 'compliance'];
export const DEFAULT_PLAN_ID = 'free';

export function getPlan(planId) {
  return PLANS[planId] || PLANS[DEFAULT_PLAN_ID];
}

// Charge real money only in production; use Shopify's test charges everywhere
// else (dev stores), so nobody is billed while building/QA-ing.
export function isTestBilling() {
  return process.env.SHOPIFY_BILLING_TEST === 'true' || process.env.NODE_ENV !== 'production';
}
