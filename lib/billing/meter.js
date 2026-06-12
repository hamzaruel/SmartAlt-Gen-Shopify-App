// Meter AI generations and charge Compliance overflow in whole blocks.
// Kept separate from usage.js so the raw counters stay free of Shopify calls.
import { incrementAiUsage, getUsage, setOverflowBlocksCharged } from './usage';
import { getActiveSubscription, createUsageRecord } from './shopifyBilling';

// Record `count` AI generations for the shop. For Compliance, charge $blockPrice
// per 10k block past quota — cap-aware: we read the live remaining balance from
// Shopify and stop before exceeding cappedAmount (we never trust the API to
// reject an over-cap charge). Returns { total, overflowChargedBlocks, capReached }.
export async function meterAiUsage(shop, token, entitlement, count) {
  const { plan, sub } = entitlement;
  const total = await incrementAiUsage(shop, sub, count);

  // No overflow plan, no usage line, or still within quota → nothing to charge.
  if (!plan.overflow || !sub.usage_line_gid || total <= plan.quota) {
    return { total, overflowChargedBlocks: 0, capReached: false };
  }

  const blocksNeeded = Math.ceil((total - plan.quota) / plan.overflow.blockSize);
  const { overflowBlocks: alreadyCharged } = await getUsage(shop, sub);
  let toCharge = blocksNeeded - alreadyCharged;
  if (toCharge <= 0) return { total, overflowChargedBlocks: 0, capReached: false };

  const live = await getActiveSubscription(shop, token);
  const usageLine = live?.usageLine;
  if (!usageLine) return { total, overflowChargedBlocks: 0, capReached: false };

  let remaining = usageLine.cappedAmount - usageLine.balanceUsed;
  let chargedNow = 0;
  let capReached = false;
  while (toCharge > 0) {
    if (remaining + 1e-9 < plan.overflow.blockPrice) {
      capReached = true; // cap hit — caller should pause + prompt to raise it
      break;
    }
    await createUsageRecord(
      shop,
      token,
      usageLine.id,
      plan.overflow.blockPrice,
      `SmartAltGen overflow: ${plan.overflow.blockSize.toLocaleString()} AI images`,
    );
    remaining -= plan.overflow.blockPrice;
    chargedNow += 1;
    toCharge -= 1;
  }
  if (chargedNow > 0) await setOverflowBlocksCharged(shop, sub, alreadyCharged + chargedNow);
  return { total, overflowChargedBlocks: chargedNow, capReached };
}
