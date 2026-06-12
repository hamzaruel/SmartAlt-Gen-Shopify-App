// Billing persistence + metering (Turso/libsql).
//
// Two tables:
//   subscriptions — the merchant's current plan + Shopify subscription GIDs.
//   usage         — AI images generated per billing cycle (OUR source of truth
//                   for quota + overflow; we never trust Shopify to enforce it).
import db from '@/lib/db';
import { getPlan } from './plans';

let ready;
async function ensureSchema() {
  if (ready) return ready;
  ready = (async () => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        shop TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL DEFAULT 'free',
        subscription_gid TEXT,
        usage_line_gid TEXT,
        status TEXT DEFAULT 'ACTIVE',
        capped_amount REAL DEFAULT 0,
        cycle_start TEXT,
        current_period_end TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS usage (
        shop TEXT NOT NULL,
        cycle_start TEXT NOT NULL,
        ai_count INTEGER NOT NULL DEFAULT 0,
        overflow_blocks_charged INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (shop, cycle_start)
      )
    `);
  })();
  return ready;
}

const FREE_ROW = (shop) => ({
  shop,
  plan_id: 'free',
  subscription_gid: null,
  usage_line_gid: null,
  status: 'ACTIVE',
  capped_amount: 0,
  cycle_start: null,
  current_period_end: null,
});

// Usage rows are keyed by the cycle start; free plans share a single 'free' bucket.
const cycleKey = (sub) => sub.cycle_start || 'free';

export async function getSubscription(shop) {
  await ensureSchema();
  const r = await db.execute({ sql: 'SELECT * FROM subscriptions WHERE shop = ?', args: [shop] });
  return r.rows[0] || FREE_ROW(shop);
}

export async function saveSubscription(shop, sub) {
  await ensureSchema();
  await db.execute({
    sql: `
      INSERT INTO subscriptions
        (shop, plan_id, subscription_gid, usage_line_gid, status, capped_amount, cycle_start, current_period_end, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(shop) DO UPDATE SET
        plan_id = excluded.plan_id,
        subscription_gid = excluded.subscription_gid,
        usage_line_gid = excluded.usage_line_gid,
        status = excluded.status,
        capped_amount = excluded.capped_amount,
        cycle_start = excluded.cycle_start,
        current_period_end = excluded.current_period_end,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [
      shop,
      sub.planId,
      sub.subscriptionGid || null,
      sub.usageLineGid || null,
      sub.status || 'ACTIVE',
      sub.cappedAmount || 0,
      sub.cycleStart || null,
      sub.currentPeriodEnd || null,
    ],
  });
}

// Drop back to Free (cancel / uninstall). Usage rows are left for audit.
export async function clearSubscription(shop) {
  await ensureSchema();
  await db.execute({
    sql: `
      INSERT INTO subscriptions (shop, plan_id, status, updated_at)
      VALUES (?, 'free', 'CANCELLED', CURRENT_TIMESTAMP)
      ON CONFLICT(shop) DO UPDATE SET
        plan_id = 'free', subscription_gid = NULL, usage_line_gid = NULL,
        status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
    `,
    args: [shop],
  });
}

export async function getUsage(shop, sub) {
  await ensureSchema();
  sub = sub || (await getSubscription(shop));
  const r = await db.execute({
    sql: 'SELECT ai_count, overflow_blocks_charged FROM usage WHERE shop = ? AND cycle_start = ?',
    args: [shop, cycleKey(sub)],
  });
  return {
    aiCount: Number(r.rows[0]?.ai_count || 0),
    overflowBlocks: Number(r.rows[0]?.overflow_blocks_charged || 0),
  };
}

// One snapshot used by both the gate and the UI.
export async function getEntitlement(shop) {
  const sub = await getSubscription(shop);
  const plan = getPlan(sub.plan_id);
  const { aiCount, overflowBlocks } = await getUsage(shop, sub);

  const active = plan.id === 'free' ? true : sub.status === 'ACTIVE';
  // How many AI images can still be generated right now.
  let remaining;
  if (!plan.ai) remaining = 0;
  else if (plan.overflow) {
    const maxOverflowImages =
      Math.floor(plan.overflow.cappedAmount / plan.overflow.blockPrice) * plan.overflow.blockSize;
    remaining = Math.max(0, plan.quota + maxOverflowImages - aiCount);
  } else remaining = Math.max(0, plan.quota - aiCount);

  return { plan, status: sub.status, active, aiUsed: aiCount, quota: plan.quota, overflowBlocks, remaining, sub };
}

// Atomically add `n` to this cycle's AI counter; returns the new total.
export async function incrementAiUsage(shop, sub, n = 1) {
  await ensureSchema();
  const key = cycleKey(sub);
  await db.execute({
    sql: `
      INSERT INTO usage (shop, cycle_start, ai_count) VALUES (?, ?, ?)
      ON CONFLICT(shop, cycle_start) DO UPDATE SET ai_count = ai_count + ?
    `,
    args: [shop, key, n, n],
  });
  const r = await db.execute({
    sql: 'SELECT ai_count FROM usage WHERE shop = ? AND cycle_start = ?',
    args: [shop, key],
  });
  return Number(r.rows[0]?.ai_count || n);
}

export async function setOverflowBlocksCharged(shop, sub, blocks) {
  await ensureSchema();
  await db.execute({
    sql: `
      INSERT INTO usage (shop, cycle_start, overflow_blocks_charged) VALUES (?, ?, ?)
      ON CONFLICT(shop, cycle_start) DO UPDATE SET overflow_blocks_charged = ?
    `,
    args: [shop, cycleKey(sub), blocks, blocks],
  });
}
