// Meter AI generations and report Compliance overflow to Shopify via App Events.
import { incrementAiUsage, getUsage, setOverflowBlocksCharged } from './usage';
import { postAppEvent } from './shopifyBilling';

// Charge any Compliance overflow blocks owed for the current cycle, given the
// running total of AI images used. Cap-aware ($100 / $4 = 25 blocks max) — we
// enforce the cap ourselves since Shopify doesn't for managed pricing.
// Returns { overflowChargedBlocks, capReached }.
export async function settleOverflow(shop, token, plan, cycleKey, total) {
  if (!plan.overflow || total <= plan.quota) {
    return { overflowChargedBlocks: 0, capReached: false };
  }
  const blocksNeeded = Math.ceil((total - plan.quota) / plan.overflow.blockSize);
  const maxBlocks = Math.floor(plan.overflow.cappedAmount / plan.overflow.blockPrice); // 25
  const targetBlocks = Math.min(blocksNeeded, maxBlocks);
  const capReached = blocksNeeded > maxBlocks;

  const { overflowBlocks: alreadyCharged } = await getUsage(shop, cycleKey);
  if (targetBlocks - alreadyCharged <= 0) return { overflowChargedBlocks: 0, capReached };

  let chargedNow = 0;
  for (let block = alreadyCharged + 1; block <= targetBlocks; block += 1) {
    try {
      await postAppEvent(shop, token, {
        eventHandle: 'ai_overflow_block',
        value: 1,
        idempotencyKey: `${shop}:${cycleKey}:block:${block}`, // dedup → never double-bills
        timestamp: new Date().toISOString(),
      });
      chargedNow += 1;
    } catch (e) {
      console.error('app event post failed:', e.message);
      break;
    }
  }
  if (chargedNow > 0) await setOverflowBlocksCharged(shop, cycleKey, alreadyCharged + chargedNow);
  return { overflowChargedBlocks: chargedNow, capReached };
}

// Record `count` AI generations and settle any overflow. Returns
// { total, overflowChargedBlocks, capReached }.
export async function meterAiUsage(shop, token, entitlement, count) {
  const { plan, cycleKey } = entitlement;
  const total = await incrementAiUsage(shop, cycleKey, count);
  const overflow = await settleOverflow(shop, token, plan, cycleKey, total);
  return { total, ...overflow };
}
