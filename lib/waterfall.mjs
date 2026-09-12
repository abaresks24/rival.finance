// RIVAL — settlement waterfall. Pure, deterministic, no network calls.
// Every signer of the REGLEMENT (settlement) account runs this independently
// before signing, so two parties never sign different numbers.
//
// Integer arithmetic only (MPT shares and drops are integers). Rounding rule:
// grossValue = floor(sharesSeized * pps) — floors DOWN. This makes the gross
// collateral value conservative; the creditor is paid first from it, so a
// floor biases the *residual to the borrower* downward by at most sub-drop,
// i.e. the rounding leans slightly toward the creditor. Named bias (see REPORT).
//
// PPS assumption: `pps` passed in must already be NET of LossUnrealized. On this
// Devnet (rippled 3.4.0-rc5) Vault.AssetsTotal already reflects realised state
// and LossUnrealized is a *separate* potential-loss field that is absent when
// zero (Phase 0 TEST 03/F-005); we could not force a non-zero LossUnrealized in
// Phase 0, so callers must compute net PPS explicitly and document their choice.

/**
 * @param {object} p
 * @param {number|bigint} p.sharesSeized     shares held by REGLEMENT (integer)
 * @param {number} p.pps                      net price-per-share (drops/share)
 * @param {number|bigint} p.debtOutstanding  principal still owed (drops, integer)
 * @param {number|bigint} p.accruedFees       fees owed on top (drops, integer)
 * @returns {{grossValue:number, toCreditor:number, toBorrower:number, shortfall:number}}
 */
export function waterfall({ sharesSeized, pps, debtOutstanding, accruedFees = 0 }) {
  const shares = Number(sharesSeized);
  const debt = Number(debtOutstanding) + Number(accruedFees);
  if (shares < 0 || debt < 0 || pps < 0) throw new Error("waterfall: negative input");

  const grossValue = Math.floor(shares * pps); // conservative floor (see header)
  const toCreditor = Math.min(debt, grossValue); // creditor paid first, capped by gross
  const toBorrower = Math.max(0, grossValue - debt); // residual to the LP
  const shortfall = Math.max(0, debt - grossValue); // uncovered debt -> vault B loss

  return { grossValue, toCreditor, toBorrower, shortfall };
}
