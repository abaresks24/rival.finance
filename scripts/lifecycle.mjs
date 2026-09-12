// RIVAL — full NAV-facility lifecycle on two closed-ended XRPL vaults.
// One command, repeatable (funds fresh wallets each run), emits app/state.json.
//
//   node scripts/lifecycle.mjs                 # repay scenario (default)
//   node scripts/lifecycle.mjs --scenario default
//
// Two vaults (credit + funding), two brokers, a real loan that lifts the credit
// vault PPS, a share-escrow pledge, and a NAV facility drawn against it.
import { connect, fund, waitLedgerTime, EXPLORER_TX } from "../lib/client.mjs";
import { rippleToISO } from "../lib/epoch.mjs";
import { planNavLoop } from "../lib/scheduler.mjs";
import { createVault, deposit, readVault, sharesOutstanding, withdrawShares } from "../lib/vault.mjs";
import { setBroker, coverDeposit, originateLoan, payLoan, readLoan } from "../lib/loan.mjs";
import { pledge, release, seize, shareBalance } from "../lib/escrow.mjs";
import { valuePosition, toXrp, pps } from "../lib/pricing.mjs";
import { writeFileSync } from "node:fs";

const SCENARIO = process.argv.includes("--scenario")
  ? process.argv[process.argv.indexOf("--scenario") + 1]
  : "repay";

// Modelled real-world tenor (chain runs in minutes; UI shows "day X of 365").
const MODELLED_TENOR_DAYS = 365;
const HAIRCUT = 0.2;

const STATE = {
  brand: "RIVAL",
  scenario: SCENARIO,
  network: "XRPL Devnet",
  explorerTx: EXPLORER_TX,
  accounts: {},
  vaults: {},
  facility: {},
  escrow: {},
  timeline: [],
  dates: {},
  inequalities: {},
  updatedAt: null,
};
const state = () => {
  STATE.updatedAt = new Date().toISOString();
  writeFileSync(new URL("../app/state.json", import.meta.url), JSON.stringify(STATE, null, 2));
};
const step = (id, label, hash) => {
  STATE.timeline.push({ id, label, hash: hash ?? null, at: new Date().toISOString() });
  console.log(`\n▶ ${label}${hash ? "  " + EXPLORER_TX + hash : ""}`);
  state();
};

async function main() {
  const client = await connect();
  console.log(`=== RIVAL NAV lifecycle — scenario: ${SCENARIO} ===`);

  // --- Accounts ----------------------------------------------------------
  const roles = ["GERANT_CREDIT", "LP", "EMPRUNTEUR", "GERANT_NAV", "LP_NAV"];
  const W = {};
  for (const r of roles) {
    const { wallet } = await fund(client, r);
    W[r] = wallet;
    STATE.accounts[r] = wallet.classicAddress;
  }
  state();

  // --- Schedule (guarantees the four inequalities) -----------------------
  const plan = planNavLoop({ subscription: 110, paymentInterval: 60, realPayments: 1, facilityPayments: 1, grace: 25 });
  STATE.dates = Object.fromEntries(Object.entries(plan.dates).map(([k, v]) => [k, typeof v === "number" && v > 1e8 ? { epoch: v, iso: rippleToISO(v) } : v]));
  STATE.inequalities = plan.checks;
  console.log("Schedule valid:", plan.valid, plan.checks);
  const D = plan.dates;

  // --- Two closed-ended public vaults ------------------------------------
  const credit = await createVault(client, W.GERANT_CREDIT, { subscriptionDate: D.subscriptionDate, redemptionDate: D.creditRedemptionDate, assetsMaxXrp: 1000, data: "RIVAL:credit" });
  STATE.vaults.credit = { kind: "credit", vaultID: credit.vaultID, shareMPTID: credit.shareMPTID, owner: W.GERANT_CREDIT.classicAddress };
  step("credit_vault", "Credit vault created (closed-ended, public)", credit.hash);

  const funding = await createVault(client, W.GERANT_NAV, { subscriptionDate: D.subscriptionDate, redemptionDate: D.fundingRedemptionDate, assetsMaxXrp: 1000, data: "RIVAL:funding" });
  STATE.vaults.funding = { kind: "funding", vaultID: funding.vaultID, shareMPTID: funding.shareMPTID, owner: W.GERANT_NAV.classicAddress };
  step("funding_vault", "Funding vault created (closed-ended, public)", funding.hash);

  // --- Deposits FIRST (subscription phase is time-critical) --------------
  const dLP = await deposit(client, W.LP, credit.vaultID, 40, "LP -> credit");
  if (!dLP.ok) throw new Error("LP deposit: " + dLP.code);
  step("lp_deposit", "LP deposits 40 XRP into credit vault", dLP.hash);
  const dLPNAV = await deposit(client, W.LP_NAV, funding.vaultID, 30, "LP_NAV -> funding");
  if (!dLPNAV.ok) throw new Error("LP_NAV deposit: " + dLPNAV.code);
  step("lpnav_deposit", "LP_NAV deposits 30 XRP into funding vault", dLPNAV.hash);

  // --- Brokers + first-loss capital (not phase-sensitive) ----------------
  const creditBroker = await setBroker(client, W.GERANT_CREDIT, credit.vaultID, { debtMaxXrp: 500 });
  await coverDeposit(client, W.GERANT_CREDIT, creditBroker.loanBrokerID, 8);
  STATE.vaults.credit.loanBrokerID = creditBroker.loanBrokerID;
  step("credit_broker", "Credit broker + 8 XRP first-loss cover", creditBroker.hash);

  const fundingBroker = await setBroker(client, W.GERANT_NAV, funding.vaultID, { debtMaxXrp: 500 });
  await coverDeposit(client, W.GERANT_NAV, fundingBroker.loanBrokerID, 6);
  STATE.vaults.funding.loanBrokerID = fundingBroker.loanBrokerID;
  step("funding_broker", "Funding broker + 6 XRP first-loss cover", fundingBroker.hash);

  await snapshotVaults(client, "after deposits");

  // --- Enter investment phase --------------------------------------------
  console.log("\n… waiting for investment phase (SubscriptionDate)");
  await waitLedgerTime(client, D.subscriptionDate, "SubscriptionDate");
  STATE.phase = "investment";
  step("investment", "Investment phase open — deposits/withdrawals locked");

  // --- Real loan: credit broker -> EMPRUNTEUR (lifts credit PPS) ----------
  const realLoan = await originateLoan(client, W.GERANT_CREDIT, W.EMPRUNTEUR, creditBroker.loanBrokerID, { principalXrp: 20, interestRate: 20000, paymentInterval: 60, paymentTotal: 1 });
  STATE.vaults.credit.realLoanID = realLoan.loanID;
  step("real_loan", "Real loan 20 XRP originated to EMPRUNTEUR (co-signed)", realLoan.hash);

  // --- Pledge: LP escrows credit-vault shares to GERANT_NAV ---------------
  const lpShares = await shareBalance(client, W.LP.classicAddress, credit.shareMPTID);
  const pledgeAmount = lpShares.amount; // pledge the whole position
  const pl = await pledge(client, W.LP, W.GERANT_NAV, credit.shareMPTID, pledgeAmount, D.escrowCancelAfter);
  STATE.escrow = { seq: pl.seq, condition: pl.conditionHex, cancelAfter: { epoch: D.escrowCancelAfter, iso: rippleToISO(D.escrowCancelAfter) }, shares: pledgeAmount, pledger: W.LP.classicAddress, creditor: W.GERANT_NAV.classicAddress, hash: pl.hash, status: "active" };
  step("pledge", `LP pledges ${toXrp(pledgeAmount)}M shares via escrow`, pl.hash);

  // --- Value the pledge, size + draw the facility ------------------------
  const cv = await readVault(client, credit.vaultID);
  const cShares = await sharesOutstanding(client, credit.shareMPTID);
  const valuation = valuePosition({ shares: pledgeAmount, assetsTotal: cv.assetsTotal, sharesTotal: cShares, lossUnrealized: cv.lossUnrealized, haircut: HAIRCUT });
  const advanceXrp = Math.min(14, Math.floor(toXrp(valuation.maxAdvanceDrops)));
  STATE.facility = { haircut: HAIRCUT, ppsDrops: valuation.ppsDrops, grossXrp: toXrp(valuation.grossDrops), netXrp: toXrp(valuation.netDrops), maxAdvanceXrp: toXrp(valuation.maxAdvanceDrops), advancedXrp: advanceXrp, borrower: W.LP.classicAddress };
  console.log("  Valuation:", STATE.facility);

  const facility = await originateLoan(client, W.GERANT_NAV, W.LP, fundingBroker.loanBrokerID, { principalXrp: advanceXrp, interestRate: 20000, paymentInterval: 60, paymentTotal: 1, dataHex: Buffer.from("RIVAL:vault=" + credit.vaultID).toString("hex").toUpperCase().slice(0, 512) });
  STATE.facility.loanID = facility.loanID;
  step("facility", `NAV facility ${advanceXrp} XRP drawn by LP against pledge`, facility.hash);

  await snapshotVaults(client, "after facility drawn");

  if (SCENARIO === "repay") {
    await repayScenario(client, W, D, realLoan, facility, credit, pl);
  } else {
    await defaultScenario(client, W, D, realLoan, credit, pl);
  }

  await snapshotVaults(client, "final");
  STATE.done = true;
  state();
  console.log("\n=== lifecycle complete — state written to app/state.json ===");
  await client.disconnect();
}

// Pay a loan's scheduled installment inside its window (before NextPaymentDueDate,
// the hard deadline — GracePeriod 0, past it => tecEXPIRED). With PaymentTotal=1
// the periodic amount settles the loan and is NOT overpayment.
async function fullPay(client, payer, loanID, capXrp, label) {
  const l = await readLoan(client, loanID);
  const due = l.NextPaymentDueDate;
  if (due) await waitLedgerTime(client, due - 18, "payment window");
  // Pay the scheduled installment (PeriodicPayment). It carries sub-drop
  // precision, so round UP (+1 drop margin) or the node returns
  // tecINSUFFICIENT_PAYMENT. With a single scheduled payment this settles the
  // loan without invoking overpayment.
  const owedDrops = Number(l.PeriodicPayment ?? l.TotalValueOutstanding ?? 0);
  const payDrops = owedDrops > 0 ? Math.ceil(owedDrops) : Math.round(capXrp * 1e6);
  const payXrp = Math.min(capXrp, payDrops / 1e6);
  console.log(`  ${label}: paying ${payXrp} XRP (PeriodicPayment=${owedDrops} drops)`);
  return payLoan(client, payer, loanID, payXrp, {});
}

async function repayScenario(client, W, D, realLoan, facility, credit, pl) {
  // Both obligors clear their loans in full within the payment window.
  const p = await fullPay(client, W.EMPRUNTEUR, realLoan.loanID, 24, "real loan");
  step("real_pay2", "EMPRUNTEUR repays real loan in full — credit PPS rises", p.hash);
  const f = await fullPay(client, W.LP, facility.loanID, 18, "facility");
  step("fac_pay2", "LP repays NAV facility in full — obligation cleared", f.hash);
  await snapshotVaults(client, "after full repayment");

  // Release the pledge once the escrow can cancel
  await waitLedgerTime(client, D.escrowCancelAfter, "escrow CancelAfter");
  const rel = await release(client, W.LP, pl.seq);
  STATE.escrow.status = rel.ok ? "released" : "release-failed:" + rel.code;
  step("release", "Escrow expires — LP reclaims pledged shares", rel.hash);

  // Withdraw after redemption
  await waitLedgerTime(client, D.creditRedemptionDate, "credit RedemptionDate");
  STATE.phase = "redemption";
  const back = await shareBalance(client, W.LP.classicAddress, credit.shareMPTID);
  const wd = await withdrawShares(client, W.LP, credit.vaultID, credit.shareMPTID, back.amount, "LP withdraw (capital+yield)");
  step("withdraw", "LP redeems shares for capital + accrued yield", wd.hash);
}

async function defaultScenario(client, W, D, realLoan, credit, pl) {
  // The real loan still performs (keeps the credit vault healthy)...
  const p = await fullPay(client, W.EMPRUNTEUR, realLoan.loanID, 24, "real loan");
  step("real_pay2", "EMPRUNTEUR repays real loan in full — credit PPS rises", p.hash);
  await snapshotVaults(client, "after real repayment");

  // ...but LP does NOT pay the facility. Creditor seizes before escrow expiry.
  const sz = await seize(client, W.GERANT_NAV, W.LP.classicAddress, pl.seq, pl.conditionHex, pl.fulfillmentHex);
  STATE.escrow.status = sz.ok ? "seized" : "seize-failed:" + sz.code;
  step("seize", "LP defaults — GERANT_NAV reveals preimage, seizes shares", sz.hash);
  const bal = await shareBalance(client, W.GERANT_NAV.classicAddress, credit.shareMPTID);
  console.log("  creditor now holds shares:", bal);

  // Creditor redeems the seized shares after redemption opens — recovery.
  await waitLedgerTime(client, D.creditRedemptionDate, "credit RedemptionDate");
  STATE.phase = "redemption";
  const wd = await withdrawShares(client, W.GERANT_NAV, credit.vaultID, credit.shareMPTID, bal.amount, "creditor withdraw (recovery)");
  step("recover", "GERANT_NAV redeems seized shares — recovery", wd.hash);
}

async function snapshotVaults(client, note) {
  for (const key of ["credit", "funding"]) {
    const v = STATE.vaults[key];
    if (!v) continue;
    const rv = await readVault(client, v.vaultID);
    const so = await sharesOutstanding(client, v.shareMPTID);
    v.assetsTotal = rv.assetsTotal;
    v.assetsAvailable = rv.assetsAvailable;
    v.lossUnrealized = rv.lossUnrealized;
    v.sharesTotal = so;
    v.ppsDrops = pps(rv.assetsTotal, so);
    v.assetsTotalXrp = toXrp(rv.assetsTotal);
  }
  console.log(`  [snapshot: ${note}] credit PPS=${STATE.vaults.credit?.ppsDrops} funding PPS=${STATE.vaults.funding?.ppsDrops}`);
  state();
}

main().catch((e) => {
  console.error("FATAL:", e?.data ?? e?.message ?? e);
  process.exit(1);
});
