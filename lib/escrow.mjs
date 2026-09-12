// RIVAL — the pledge: escrow of vault shares as NAV-facility collateral.
import { submit, trySubmit, mptHolding } from "./client.mjs";
import { makeCondition } from "./condition.mjs";

/**
 * Pledge `shares` of `shareMPTID` from `pledger` to `creditor`, unlockable by
 * the creditor's secret preimage until `cancelAfter` (Ripple epoch s).
 * Returns { seq, condition, fulfillment, preimage, hash }.
 */
export async function pledge(client, pledger, creditor, shareMPTID, shares, cancelAfter) {
  const c = makeCondition();
  const r = await submit(client, pledger, {
    TransactionType: "EscrowCreate",
    Account: pledger.classicAddress,
    Destination: creditor.classicAddress,
    Amount: { mpt_issuance_id: shareMPTID, value: String(shares) },
    Condition: c.conditionHex,
    CancelAfter: cancelAfter,
  }, "EscrowCreate (pledge)");
  if (!r.ok) throw new Error("pledge EscrowCreate: " + r.code);
  return { seq: r.seq, ...c, hash: r.hash };
}

/** Repayment path: after cancelAfter, the pledger reclaims the shares. */
export async function release(client, pledger, offerSequence, label = "EscrowCancel (release)") {
  return trySubmit(client, pledger, {
    TransactionType: "EscrowCancel",
    Account: pledger.classicAddress,
    Owner: pledger.classicAddress,
    OfferSequence: offerSequence,
  }, label);
}

/** Default path: the creditor reveals the preimage and seizes the shares. */
export async function seize(client, creditor, pledgerAddress, offerSequence, condition, fulfillment) {
  return submit(client, creditor, {
    TransactionType: "EscrowFinish",
    Account: creditor.classicAddress,
    Owner: pledgerAddress,
    OfferSequence: offerSequence,
    Condition: condition,
    Fulfillment: fulfillment,
  }, "EscrowFinish (seize)");
}

export async function shareBalance(client, account, shareMPTID) {
  const n = await mptHolding(client, account, shareMPTID);
  return { amount: n?.MPTAmount ?? "0", locked: n?.LockedAmount ?? "0" };
}
