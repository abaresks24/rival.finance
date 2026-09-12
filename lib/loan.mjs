// RIVAL — XLS-66 loan primitives (broker + counterparty-cosigned origination).
//
// NOTE (F-007): xrpl.js@5.2.0-beta.0 `signLoanSetByCounterparty` signs with the
// wrong prefix and rippled rejects it. We sign the counterparty leg manually
// with `encodeForSigningCounterparty` (the fixCleanup3_4_0 prefix). Validated.
// NOTE (F-008): never send `GracePeriod` on LoanSet — rippled returns temINVALID.
import { submit, submitSigned, ledgerEntry } from "./client.mjs";
import { createdNode } from "./wallets.mjs";
import { toDrops } from "./pricing.mjs";
import { decode, encode } from "xrpl";
import { encodeForSigningCounterparty } from "ripple-binary-codec";
import { sign as kpSign } from "ripple-keypairs";

/** Create a LoanBroker on `vaultID`, owned by `broker` (must own the vault). */
export async function setBroker(client, broker, vaultID, { debtMaxXrp = 500, managementFeeRate = 1000, coverRateMinimum = 10000, coverRateLiquidation = 5000 } = {}) {
  const r = await submit(client, broker, {
    TransactionType: "LoanBrokerSet",
    Account: broker.classicAddress,
    VaultID: vaultID,
    ManagementFeeRate: managementFeeRate,
    DebtMaximum: toDrops(debtMaxXrp),
    CoverRateMinimum: coverRateMinimum,
    CoverRateLiquidation: coverRateLiquidation,
  }, "LoanBrokerSet");
  if (!r.ok) throw new Error("LoanBrokerSet: " + r.code);
  return { loanBrokerID: createdNode(r.meta, "LoanBroker").index, hash: r.hash };
}

/** Deposit first-loss cover capital into the broker. */
export async function coverDeposit(client, broker, loanBrokerID, xrp) {
  return submit(client, broker, {
    TransactionType: "LoanBrokerCoverDeposit",
    Account: broker.classicAddress,
    LoanBrokerID: loanBrokerID,
    Amount: toDrops(xrp),
  }, `LoanBrokerCoverDeposit ${xrp} XRP`);
}

/**
 * Originate a loan: `broker` lends `principalXrp` to `borrower`, co-signed by
 * the borrower. Must be called in the vault's Investment phase.
 */
export async function originateLoan(client, broker, borrower, loanBrokerID, { principalXrp, interestRate = 20000, paymentInterval = 60, paymentTotal = 2, overpayment = false, dataHex }) {
  const terms = {
    TransactionType: "LoanSet",
    Account: broker.classicAddress,
    LoanBrokerID: loanBrokerID,
    PrincipalRequested: toDrops(principalXrp),
    Counterparty: borrower.classicAddress,
    InterestRate: interestRate,
    PaymentInterval: paymentInterval,
    PaymentTotal: paymentTotal,
  };
  if (overpayment) terms.Flags = 0x00010000; // tfLoanOverpayment (kept OFF by design)
  if (dataHex) terms.Data = dataHex;

  const prepared = await client.autofill(terms);
  const firstParty = decode(broker.sign(prepared).tx_blob);
  const counterSig = kpSign(encodeForSigningCounterparty(firstParty), borrower.privateKey);
  firstParty.CounterpartySignature = {
    SigningPubKey: borrower.publicKey,
    TxnSignature: counterSig,
  };
  const r = await submitSigned(client, encode(firstParty), "LoanSet (co-signed)");
  if (!r.ok) throw new Error("LoanSet: " + r.code);
  return { loanID: createdNode(r.meta, "Loan").index, hash: r.hash };
}

/** Make a scheduled payment on a loan. */
export async function payLoan(client, borrower, loanID, xrp, { fullPayment = false } = {}) {
  const tx = {
    TransactionType: "LoanPay",
    Account: borrower.classicAddress,
    LoanID: loanID,
    Amount: toDrops(xrp),
  };
  if (fullPayment) tx.Flags = 0x00020000; // tfLoanFullPayment
  return submit(client, borrower, tx, `LoanPay ${xrp} XRP`);
}

/** Impair / unimpair / default a loan (broker discretionary). */
export async function manageLoan(client, broker, loanID, action) {
  const flags = { impair: 0x00020000, unimpair: 0x00040000, default: 0x00010000 };
  return submit(client, broker, {
    TransactionType: "LoanManage",
    Account: broker.classicAddress,
    LoanID: loanID,
    Flags: flags[action],
  }, `LoanManage(${action})`);
}

export async function readLoan(client, loanID) {
  return ledgerEntry(client, loanID);
}
