// Meter AI generations and report Compliance overflow to Shopify via App Events.
import { incrementAiUsage, setOverflowBlocksCharged } from './usage';
import { postAppEvent } from './shopifyBilling';

// Record `count` AI generations. For Compliance, report one App Event per 10k
// block crossed past quota (Shopify bills $4/block). The $100 cap is enforced
// HERE — Shopify does not enforce usage caps for managed pricing.
// Returns { total, overflowChargedBlocks, capReached }.
export async function meterAiUsage(shop, token, entitlement, count) {
  const { plan, cycleKey, overflowBlocks: alreadyCharged } = entitlement;
  const total = await incrementAiUsage(shop, cycleKey, count);

  if (!plan.overflow || total <= plan.quota) {
    return { total, overflowChargedBlocks: 0, capReached: false };
  }

  const blocksNeeded = Math.ceil((total - plan.quota) / plan.overflow.blockSize);
  const maxBlocks = Math.floor(plan.overflow.cappedAmount / plan.overflow.blockPrice); // $100 / $4 = 25
  const targetBlocks = Math.min(blocksNeeded, maxBlocks);
  const capReached = blocksNeeded > maxBlocks;

  let chargedNow = 0;
  for (let block = alreadyCharged + 1; block <= targetBlocks; block += 1) {
    try {
      await postAppEvent(shop, token, {
        eventHandle: 'ai_overflow_block',
        value: 1,
        // Stable per (shop, cycle, block) → Shopify dedupes, never double-bills.
        idempotencyKey: `${shop}:${cycleKey}:block:${block}`,
        timestamp: new Date().toISOString(),
      });
      chargedNow += 1;
    } catch (e) {
      console.error('app event post failed:', e.message);
      break; // stop on first failure; we'll retry the same block next run (idempotent)
    }
  }

  if (chargedNow > 0) {
    await setOverflowBlocksCharged(shop, cycleKey, alreadyCharged + chargedNow);
  }
  return { total, overflowChargedBlocks: chargedNow, capReached };
}
