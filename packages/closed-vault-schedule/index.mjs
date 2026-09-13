// @xrpl-nav/closed-vault-schedule
// Immutable-date arithmetic for closed-ended XRPL vault loops (XLS-65/66/85).
// Pure. Zero network. Zero dependencies. Ripple epoch throughout.

export const RIPPLE_EPOCH_OFFSET = 946684800; // seconds between 1970 and 2000

/** Unix seconds | Date -> Ripple epoch seconds. */
export function toRippleEpoch(dateOrUnix) {
  const unix =
    dateOrUnix instanceof Date
      ? Math.floor(dateOrUnix.getTime() / 1000)
      : Math.floor(Number(dateOrUnix));
  return unix - RIPPLE_EPOCH_OFFSET;
}

/** Ripple epoch seconds -> Unix seconds. */
export function fromRippleEpoch(ripple) {
  return Number(ripple) + RIPPLE_EPOCH_OFFSET;
}

/** Ripple epoch seconds -> ISO string (readable logs, UI, README). */
export function rippleToISO(ripple) {
  return new Date(fromRippleEpoch(ripple) * 1000).toISOString();
}

// Protocol floors observed on rippled 3.4.0-rc5 (see README "Verified against").
export const MIN_VAULT_WINDOW_SEC = 180; // RedemptionDate - SubscriptionDate
export const MIN_PAYMENT_INTERVAL_SEC = 60; // LoanSet PaymentInterval

const mins = (m) => Math.round(m * 60);

/**
 * Plan every date of a NAV-facility loop over two closed-ended vaults, and
 * verify the four invariants. Computes from parameters and REPORTS violations —
 * it does not silently "fix" your inputs. Tweak params until `valid` is true.
 *
 * @param {object} p
 * @param {number|Date} p.t0                 start (Ripple epoch s or Date). default: 0 (caller stamps).
 * @param {number} p.subscriptionMinutes     subscription window.
 * @param {number} p.investmentMinutes       investment window (loans live here).
 * @param {number} p.loanPayments            installments of the real loan.
 * @param {number} p.facilityMinutes         NAV-facility tenor.
 * @param {number} p.graceMinutes            grace added after each facility payment before its escrow tranche can cancel.
 * @param {number} p.tranches                escrow partitioning (1 = single escrow). default 1.
 */
export function planNavFacility({
  t0 = 0,
  subscriptionMinutes = 2,
  investmentMinutes = 6,
  loanPayments = 1,
  facilityMinutes = 4,
  graceMinutes = 1,
  tranches = 1,
} = {}) {
  const start = t0 instanceof Date ? toRippleEpoch(t0) : Number(t0);
  const subscriptionDate = start + mins(subscriptionMinutes);
  const redemptionDate = subscriptionDate + mins(investmentMinutes);

  // Loans originate just after investment opens.
  const originate = subscriptionDate + mins(0.5);

  // --- Real loan schedule (spread across the investment window) ----------
  const loanInterval = Math.max(
    MIN_PAYMENT_INTERVAL_SEC,
    Math.floor(mins(investmentMinutes * 0.7) / Math.max(1, loanPayments))
  );
  const loanPaymentDates = [];
  for (let i = 1; i <= loanPayments; i++) loanPaymentDates.push(originate + i * loanInterval);
  const loanFinalPaymentDate = loanPaymentDates[loanPaymentDates.length - 1];

  // --- Facility schedule: one payment per tranche ------------------------
  const facPayments = Math.max(1, tranches);
  const facInterval = Math.max(
    MIN_PAYMENT_INTERVAL_SEC,
    Math.floor(mins(facilityMinutes) / facPayments)
  );
  const facilityPaymentDates = [];
  for (let i = 1; i <= facPayments; i++) facilityPaymentDates.push(originate + i * facInterval);
  const facilityMaturityDate = facilityPaymentDates[facilityPaymentDates.length - 1];

  // --- Escrow tranches. CancelAfter is PURELY TEMPORAL: a tranche releases
  //     at its date even if the matching payment was missed, so the creditor
  //     must seize inside seizureWindow[i] or forfeit that tranche's claim. ---
  const escrowTranches = facilityPaymentDates.map((d, i) => {
    const cancelAfter = d + mins(graceMinutes);
    return {
      index: i,
      shareFraction: 1 / facPayments,
      cancelAfter,
      seizureWindow: [d, cancelAfter],
    };
  });
  const lastTranche = escrowTranches[escrowTranches.length - 1];

  // --- The four invariants ----------------------------------------------
  const violations = [];
  const check = (rule, ok, expected, actual, humanMessage) => {
    if (!ok) violations.push({ rule, expected, actual, humanMessage });
  };
  // R1: the real loan must finish paying before the credit vault redeems.
  check("R1", loanFinalPaymentDate < redemptionDate,
    `loan.finalPaymentDate < vaultCredit.redemptionDate`,
    `${loanFinalPaymentDate} < ${redemptionDate}`,
    "The real loan's last payment falls at or after the credit vault redemption.");
  // R2: the facility must mature before the funding vault redeems.
  check("R2", facilityMaturityDate < redemptionDate,
    `facility.maturityDate < vaultFunding.redemptionDate`,
    `${facilityMaturityDate} < ${redemptionDate}`,
    "The NAV facility matures at or after the funding vault redemption.");
  // R3: the facility must mature before the last escrow tranche can cancel.
  check("R3", facilityMaturityDate < lastTranche.cancelAfter,
    `facility.maturityDate < escrow.lastTranche.cancelAfter`,
    `${facilityMaturityDate} < ${lastTranche.cancelAfter}`,
    "The last escrow tranche can cancel before the facility matures.");
  // R4 (subtle): if an escrow still lives when redemption opens, the pledged
  //     shares are OUT of the lender's account and nobody can withdraw.
  check("R4", lastTranche.cancelAfter < redemptionDate,
    `escrow.lastTranche.cancelAfter < vaultCredit.redemptionDate`,
    `${lastTranche.cancelAfter} < ${redemptionDate}`,
    "An escrow tranche outlives the credit-vault redemption; the pledged shares are locked out of the lender's account at withdrawal time.");
  // Protocol floors.
  check("FLOOR_WINDOW", redemptionDate - subscriptionDate >= MIN_VAULT_WINDOW_SEC,
    `RedemptionDate - SubscriptionDate >= ${MIN_VAULT_WINDOW_SEC}`,
    `${redemptionDate - subscriptionDate}`,
    "Investment window is under the 180s protocol floor.");

  const humanTimeline = buildTimeline({
    start, subscriptionDate, redemptionDate, originate,
    loanPaymentDates, facilityPaymentDates, escrowTranches,
  });

  return {
    vaultCredit: { subscriptionDate, redemptionDate },
    vaultFunding: { subscriptionDate, redemptionDate },
    loan: { paymentDates: loanPaymentDates, finalPaymentDate: loanFinalPaymentDate, paymentInterval: loanInterval },
    facility: { paymentDates: facilityPaymentDates, maturityDate: facilityMaturityDate, paymentInterval: facInterval },
    escrow: { tranches: escrowTranches, lastTranche },
    valid: violations.length === 0,
    violations,
    humanTimeline,
  };
}

function rel(base, t) {
  return Math.round((t - base) / 60);
}

function buildTimeline(d) {
  const rows = [];
  const at = (t) => rel(d.start, t);
  rows.push({ minute: 0, actor: "GERANT_CREDIT/GERANT_NAV", action: "Create 2 closed vaults + brokers + first-loss cover", txType: "VaultCreate/LoanBrokerSet" });
  rows.push({ minute: 0, actor: "LP / LP_NAV", action: "Deposit into credit / funding vault", txType: "VaultDeposit" });
  rows.push({ minute: at(d.subscriptionDate), actor: "—", action: "SubscriptionDate — investment phase opens", txType: "—" });
  rows.push({ minute: at(d.originate), actor: "GERANT_CREDIT", action: "Originate real loan to EMPRUNTEUR", txType: "LoanSet" });
  rows.push({ minute: at(d.originate), actor: "LP", action: "Pledge credit-vault shares via escrow", txType: "EscrowCreate" });
  rows.push({ minute: at(d.originate), actor: "GERANT_NAV", action: "Draw NAV facility against the pledge", txType: "LoanSet" });
  d.loanPaymentDates.forEach((t, i) => rows.push({ minute: at(t), actor: "EMPRUNTEUR", action: `Real loan payment ${i + 1} — credit PPS rises`, txType: "LoanPay" }));
  d.facilityPaymentDates.forEach((t, i) => rows.push({ minute: at(t), actor: "LP", action: `Facility payment ${i + 1}`, txType: "LoanPay" }));
  d.escrowTranches.forEach((tr) => rows.push({ minute: at(tr.cancelAfter), actor: "LP/GERANT_NAV", action: `Escrow tranche ${tr.index} cancels (repay) or was seized (default)`, txType: "EscrowCancel/EscrowFinish" }));
  rows.push({ minute: at(d.redemptionDate), actor: "LP", action: "RedemptionDate — withdraw capital + yield", txType: "VaultWithdraw" });
  return rows.sort((a, b) => a.minute - b.minute);
}
