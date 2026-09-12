// RIVAL NAV pricing — value a pledged vault position and size the max advance.
// All amounts in drops (integer XRP*1e6) unless noted.

/** Price-per-share in drops, from raw Vault fields. */
export function pps(assetsTotal, sharesTotal) {
  const a = Number(assetsTotal || 0);
  const s = Number(sharesTotal || 0);
  return s === 0 ? 0 : a / s;
}

/**
 * Value a pledged position and size the facility.
 * @param {object} p
 * @param {string|number} p.shares          pledged shares
 * @param {string|number} p.assetsTotal     Vault.AssetsTotal
 * @param {string|number} p.sharesTotal     shares OutstandingAmount
 * @param {string|number} p.lossUnrealized  Vault.LossUnrealized (absent -> 0)
 * @param {number} p.haircut                0..1 discount (e.g. 0.2 = 20%)
 * @param {boolean} p.assetsNetOfLoss       whether AssetsTotal already nets LossUnrealized (see TEST 06)
 */
export function valuePosition({
  shares,
  assetsTotal,
  sharesTotal,
  lossUnrealized = 0,
  haircut = 0.2,
  assetsNetOfLoss = true,
}) {
  const price = pps(assetsTotal, sharesTotal);
  const gross = Number(shares) * price; // drops
  const loss = Number(lossUnrealized || 0);
  // If AssetsTotal already nets the loss, PPS is already net -> don't double-count.
  const lossShare = assetsNetOfLoss
    ? 0
    : (Number(shares) / Number(sharesTotal || 1)) * loss;
  const net = Math.max(0, gross - lossShare);
  const maxAdvance = net * (1 - haircut);
  return {
    ppsDrops: price,
    grossDrops: gross,
    netDrops: net,
    maxAdvanceDrops: maxAdvance,
    ltv: (advanced) => (net === 0 ? 0 : Number(advanced) / net),
  };
}

export const toXrp = (drops) => Number(drops) / 1e6;
export const toDrops = (xrp) => String(Math.round(Number(xrp) * 1e6));
