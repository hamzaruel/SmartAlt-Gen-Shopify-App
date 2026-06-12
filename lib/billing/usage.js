// Billing entitlement + usage metering.
//
// Plan is read LIVE from Shopify (the merchant selects it on Shopify's hosted
// pricing page, so Shopify is the source of truth for which plan they're on).
// Usage (AI images this cycle) is metered in OUR DB — Shopify can't count your
// AI calls, and Managed Pricing usage caps aren't enforced by Shopify, so the
// quota + the $100 overflow cap are enforced here.
import db from '@/lib/db';
import { getPlan } from './plans';
import { getActiveSubscription } from './shopifyBilling';

let ready;
async function ensureSchema() {
  if (ready) return ready;
  ready = db.execute(`
    CREATE TABLE IF NOT EXISTS usage (
      shop TEXT NOT NULL,
      cycle_start TEXT NOT NULL,
      ai_count INTEGER NOT NULL DEFAULT 0,
      overflow_blocks_charged INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (shop, cycle_start)
    )
  `);
  return ready;
}

// Map the live subscription's plan name → our internal plan id. Names match the
// "Plan name for merchant invoices" we set in the dashboard (Starter/Growth/...).
function planIdFromSub(sub) {
  if (!sub || sub.status !== 'ACTIVE') return 'free';
  const name = (sub.name || '').toLowerCase();
  if (name.includes('compliance')) return 'compliance';
  if (name.includes('growth')) return 'growth';
  if (name.includes('starter')) return 'starter';
  return 'free';
}

// Usage rows key on the cycle start so the counter naturally resets each billing
// period (Shopify's currentPeriodEnd advances → new bucket). Free shares 'free'.
export async function getUsage(shop, cycleKey) {
  await ensureSchema();
  const r = await db.execute({
    sql: 'SELECT ai_count, overflow_blocks_charged FROM usage WHERE shop = ? AND cycle_start = ?',
    args: [shop, cycleKey],
  });
  return {
    aiCount: Number(r.rows[0]?.ai_count || 0),
    overflowBlocks: Number(r.rows[0]?.overflow_blocks_charged || 0),
  };
}

export async function incrementAiUsage(shop, cycleKey, n = 1) {
  await ensureSchema();
  await db.execute({
    sql: `
      INSERT INTO usage (shop, cycle_start, ai_count) VALUES (?, ?, ?)
      ON CONFLICT(shop, cycle_start) DO UPDATE SET ai_count = ai_count + ?
    `,
    args: [shop, cycleKey, n, n],
  });
  const r = await db.execute({
    sql: 'SELECT ai_count FROM usage WHERE shop = ? AND cycle_start = ?',
    args: [shop, cycleKey],
  });
  return Number(r.rows[0]?.ai_count || n);
}

export async function setOverflowBlocksCharged(shop, cycleKey, blocks) {
  await ensureSchema();
  await db.execute({
    sql: `
      INSERT INTO usage (shop, cycle_start, overflow_blocks_charged) VALUES (?, ?, ?)
      ON CONFLICT(shop, cycle_start) DO UPDATE SET overflow_blocks_charged = ?
    `,
    args: [shop, cycleKey, blocks, blocks],
  });
}

// Dev/review allowlist: stores listed in BILLING_BYPASS_SHOPS get full access
// with NO billing, regardless of their Shopify plan. Use for your own test
// stores and the Shopify reviewer's store — never a real paying merchant.
function isBypassShop(shop) {
  const list = (process.env.BILLING_BYPASS_SHOPS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes((shop || '').toLowerCase());
}

// High quota, no overflow → every feature + AI works, and nothing is ever billed.
const BYPASS_PLAN = { id: 'internal', name: 'Internal (test)', ai: true, quota: 1000000, overflow: null };

// One snapshot for the gate + the UI. Reads the plan live; falls back to Free if
// the lookup fails (so generation is never wrongly unblocked on an error).
export async function getEntitlement(shop, token) {
  // Allowlisted test/review stores skip all gating.
  if (isBypassShop(shop)) {
    const cycleKey = 'bypass';
    const { aiCount } = await getUsage(shop, cycleKey);
    return {
      plan: BYPASS_PLAN,
      planId: BYPASS_PLAN.id,
      active: true,
      aiUsed: aiCount,
      quota: BYPASS_PLAN.quota,
      overflowBlocks: 0,
      remaining: Math.max(0, BYPASS_PLAN.quota - aiCount),
      cycleKey,
      currentPeriodEnd: null,
    };
  }

  let liveSub = null;
  if (token) {
    try {
      liveSub = await getActiveSubscription(shop, token);
    } catch (e) {
      console.error('active subscription lookup failed:', e.message);
    }
  }

  const planId = planIdFromSub(liveSub);
  const plan = getPlan(planId);
  const cycleKey = liveSub?.currentPeriodEnd || 'free';
  const { aiCount, overflowBlocks } = await getUsage(shop, cycleKey);

  let remaining;
  if (!plan.ai) remaining = 0;
  else if (plan.overflow) {
    const maxOverflowImages =
      Math.floor(plan.overflow.cappedAmount / plan.overflow.blockPrice) * plan.overflow.blockSize;
    remaining = Math.max(0, plan.quota + maxOverflowImages - aiCount);
  } else {
    remaining = Math.max(0, plan.quota - aiCount);
  }

  return {
    plan,
    planId,
    active: true,
    aiUsed: aiCount,
    quota: plan.quota,
    overflowBlocks,
    remaining,
    cycleKey,
    currentPeriodEnd: liveSub?.currentPeriodEnd || null,
  };
}

// Cleanup on uninstall — drop the shop's usage rows.
export async function clearSubscription(shop) {
  await ensureSchema();
  try {
    await db.execute({ sql: 'DELETE FROM usage WHERE shop = ?', args: [shop] });
  } catch (e) {
    console.error('clearSubscription error:', e.message);
  }
}
