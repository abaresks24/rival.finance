// RIVAL NAV scheduler — the reusable contribution.
// Given an investment duration, a facility duration and a grace delay, emit the
// Ripple-epoch dates that GUARANTEE the four NAV-facility inequalities:
//
//   (1) last real-loan payment      <  RedemptionDate(credit vault)
//   (2) last facility payment       <  RedemptionDate(funding vault)
//   (3) facility maturity           <  escrow CancelAfter
//   (4) escrow CancelAfter          <  RedemptionDate(credit vault)
//
// Protocol floors respected: RedemptionDate - SubscriptionDate >= 180 s,
// PaymentInterval >= 60 s. Pure function, no I/O. Drop-in for any XLS-66 loop.
import { nowRipple } from "./epoch.mjs";

export const MIN_VAULT_WINDOW = 180; // s, rippled floor
export const MIN_PAYMENT_INTERVAL = 60; // s, rippled floor

/**
 * @param {object} p
 * @param {number} p.t0                base time (Ripple epoch s). Default: now.
 * @param {number} p.subscription      subscription window length (s).
 * @param {number} p.paymentInterval   loan payment interval (s), >= 60.
 * @param {number} p.realPayments      number of payments on the real loan.
 * @param {number} p.facilityPayments  number of payments on the NAV facility.
 * @param {number} p.grace             grace added after facility maturity before escrow can cancel (s).
 * @returns dates + a validation of the four inequalities.
 */
export function planNavLoop({
  t0 = nowRipple(),
  subscription = 60,
  paymentInterval = 60,
  realPayments = 2,
  facilityPayments = 2,
  grace = 30,
} = {}) {
  const interval = Math.max(paymentInterval, MIN_PAYMENT_INTERVAL);
  const subEnd = t0 + subscription; // SubscriptionDate (investment begins)

  // Loans originate a bit after investment opens; `drift` absorbs the wall-clock
  // gap between the planned time and the actual origination ledger (several
  // confirmations). rippled anchors the payment schedule to the ACTUAL
  // origination, and rejects a LoanSet whose schedule ends too close to
  // RedemptionDate (tecNO_PERMISSION), so we keep a full-interval buffer.
  const originate = subEnd + 20;
  const lastRealPayment = originate + realPayments * interval;
  const lastFacilityPayment = originate + facilityPayments * interval;
  const facilityMaturity = lastFacilityPayment; // last scheduled facility payment
  const escrowCancelAfter = facilityMaturity + grace; // (3)
  const paymentBuffer = interval + 40; // margin after the last scheduled payment

  // Credit-vault redemption must clear the escrow AND the last real payment.
  const creditRedemption = Math.max(
    escrowCancelAfter + 20, // (4): escrow must be gone before redemption
    lastRealPayment + paymentBuffer, // (1) with schedule-end margin
    subEnd + MIN_VAULT_WINDOW // protocol floor
  );
  // Funding-vault redemption must clear its own last facility payment.
  const fundingRedemption = Math.max(
    lastFacilityPayment + paymentBuffer, // (2)
    subEnd + MIN_VAULT_WINDOW
  );

  const dates = {
    t0,
    subscriptionDate: subEnd,
    originate,
    paymentInterval: interval,
    lastRealPayment,
    lastFacilityPayment,
    facilityMaturity,
    escrowCancelAfter,
    creditRedemptionDate: creditRedemption,
    fundingRedemptionDate: fundingRedemption,
  };

  const checks = {
    "(1) lastRealPayment < creditRedemption": lastRealPayment < creditRedemption,
    "(2) lastFacilityPayment < fundingRedemption":
      lastFacilityPayment < fundingRedemption,
    "(3) facilityMaturity < escrowCancelAfter":
      facilityMaturity < escrowCancelAfter,
    "(4) escrowCancelAfter < creditRedemption":
      escrowCancelAfter < creditRedemption,
    "floor credit window >= 180": creditRedemption - subEnd >= MIN_VAULT_WINDOW,
    "floor funding window >= 180":
      fundingRedemption - subEnd >= MIN_VAULT_WINDOW,
  };
  const valid = Object.values(checks).every(Boolean);
  return { dates, checks, valid };
}
