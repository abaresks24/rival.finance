// @xrpl-nav/vault-position — compute.mjs
// PURE. No network. Integer arithmetic (BigInt). Unit-testable to the base unit.
//
// Rounding rule: every value is a FLOOR division (`bdiv`). Flooring the position
// value is conservative — the creditor is paid first from it, so the floored
// residual to the borrower is at most one base unit low. The bias therefore leans
// (very slightly) TOWARD THE CREDITOR. Named here rather than left implicit.

const b = (x) => BigInt(x ?? 0);
/** floor division for non-negative BigInts */
const bdiv = (num, den) => (den === 0n ? 0n : num / den);

/**
 * @param {object} state  raw vault state (from fetch.mjs or supplied by a third party)
 * @param {object} opts
 * @param {number} opts.haircutBps   discount in basis points (2000 = 20%). default 0.
 * @param {'already-netted'|'subtract'|'strict'} opts.lossHandling
 *        How AssetsTotal relates to LossUnrealized. THE open question of Phase-0
 *        TEST 03/06 — not hard-coded. default 'strict'.
 * @returns {{ pps, grossValue, netValue, collateralValue, lossApplied, assumptions:string[] }}
 *          values are strings (base units, e.g. drops); pps is a float for display.
 */
export function computePosition(state, { haircutBps = 0, lossHandling = "strict" } = {}) {
  const assetsTotal = b(state.assetsTotal);
  const sharesTotal = b(state.sharesTotal);
  const holderShares = b(state.holderShares);
  const lossUnrealized = b(state.lossUnrealized);
  const assumptions = [];

  if (sharesTotal === 0n) {
    assumptions.push("sharesTotal is 0 — vault holds no shares; every value is 0 (avoided division by zero).");
    return zero(assumptions);
  }
  if (holderShares === 0n) {
    assumptions.push("holderShares is 0 — the holder owns no shares; position value is 0.");
    return zero(assumptions);
  }

  // How much loss to net out of the assets backing this position.
  let assetsNet;
  if (lossHandling === "already-netted") {
    assetsNet = assetsTotal;
    assumptions.push("lossHandling='already-netted': AssetsTotal is assumed to already reflect LossUnrealized; nothing subtracted.");
  } else if (lossHandling === "subtract") {
    assetsNet = assetsTotal - lossUnrealized;
    assumptions.push("lossHandling='subtract': LossUnrealized subtracted from AssetsTotal (verified relationship).");
  } else {
    // strict
    assetsNet = assetsTotal - lossUnrealized;
    assumptions.push("lossHandling='strict': LossUnrealized subtracted, BUT the AssetsTotal↔LossUnrealized relationship is NOT yet empirically verified (Phase-0 TEST 06 pending). Treat collateralValue as a lower bound.");
  }
  if (assetsNet < 0n) assetsNet = 0n;

  const grossValue = bdiv(holderShares * assetsTotal, sharesTotal);
  const netValue = bdiv(holderShares * assetsNet, sharesTotal);
  const lossApplied = grossValue - netValue;

  const bps = BigInt(Math.max(0, Math.min(10000, Math.round(haircutBps))));
  const collateralValue = bdiv(netValue * (10000n - bps), 10000n);
  if (bps > 0n) assumptions.push(`haircut of ${Number(bps) / 100}% applied to netValue.`);

  const ppsFloat = Number(assetsNet) / Number(sharesTotal);
  if (state.assetScale) assumptions.push(`assetScale=${state.assetScale} (IOU vault); amounts are in scaled base units.`);

  return {
    pps: ppsFloat,
    grossValue: grossValue.toString(),
    netValue: netValue.toString(),
    collateralValue: collateralValue.toString(),
    lossApplied: lossApplied.toString(),
    assumptions,
  };
}

function zero(assumptions) {
  return { pps: 0, grossValue: "0", netValue: "0", collateralValue: "0", lossApplied: "0", assumptions };
}
