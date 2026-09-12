// PROBE (jetable) — dé-risque la machinerie de prêt V1.1 avant le lifecycle.
// vault -> broker -> cover -> deposit -> LoanSet co-signé -> LoanPay -> PPS bouge.
import {
  connect,
  submit,
  submitSigned,
  ledgerEntry,
  waitLedgerTime,
  EXPLORER_TX,
} from "../lib/client.mjs";
import { loadWallets, createdNode } from "../lib/wallets.mjs";
import { nowRipple, rippleToISO } from "../lib/epoch.mjs";
import { decode, encode } from "xrpl";
import { encodeForSigningCounterparty } from "ripple-binary-codec";
import { sign as kpSign } from "ripple-keypairs";

const xrp = (n) => String(Math.round(n * 1e6)); // XRP -> drops

async function readVault(client, idx) {
  const v = await ledgerEntry(client, idx);
  return {
    AssetsTotal: v.AssetsTotal,
    AssetsAvailable: v.AssetsAvailable,
    LossUnrealized: v.LossUnrealized ?? "0",
    ShareMPTID: v.ShareMPTID,
  };
}

async function main() {
  const client = await connect();
  const W = loadWallets();
  const broker = W.GERANT_CREDIT; // propriétaire + broker
  const lp = W.LP;
  const borrower = W.EMPRUNTEUR;

  const subscriptionDate = nowRipple() + 45;
  const redemptionDate = subscriptionDate + 240;
  console.log("Subscription:", rippleToISO(subscriptionDate), "| Redemption:", rippleToISO(redemptionDate));

  // 1. Vault closed-ended public
  const vc = await submit(client, broker, {
    TransactionType: "VaultCreate",
    Account: broker.classicAddress,
    Asset: { currency: "XRP" },
    VaultKind: 1,
    SubscriptionDate: subscriptionDate,
    RedemptionDate: redemptionDate,
    AssetsMaximum: xrp(1000),
    WithdrawalPolicy: 1,
  }, "VaultCreate");
  const vaultID = createdNode(vc.meta, "Vault").index;
  console.log("  vaultID:", vaultID);

  // 2. LoanBroker (rates : hypothèse denominateur 100000 => 20000 = 20%)
  const bs = await submit(client, broker, {
    TransactionType: "LoanBrokerSet",
    Account: broker.classicAddress,
    VaultID: vaultID,
    ManagementFeeRate: 1000, // 10% (denominateur 10000)
    DebtMaximum: xrp(500),
    CoverRateMinimum: 10000, // 10%
    CoverRateLiquidation: 5000, // 5%
  }, "LoanBrokerSet");
  const brokerID = createdNode(bs.meta, "LoanBroker")?.index;
  console.log("  brokerID:", brokerID);

  // 3. First-loss capital
  await submit(client, broker, {
    TransactionType: "LoanBrokerCoverDeposit",
    Account: broker.classicAddress,
    LoanBrokerID: brokerID,
    Amount: xrp(10),
  }, "LoanBrokerCoverDeposit 10 XRP");

  // 4. LP dépose (phase subscription)
  await submit(client, lp, {
    TransactionType: "VaultDeposit",
    Account: lp.classicAddress,
    VaultID: vaultID,
    Amount: xrp(50),
  }, "VaultDeposit LP 50 XRP");

  const before = await readVault(client, vaultID);
  console.log("  Vault avant prêt:", before);

  // 5. Attendre la phase investissement
  await waitLedgerTime(client, subscriptionDate, "SubscriptionDate");

  // 6. LoanSet co-signé. Le prêteur (broker) signe d'abord, l'emprunteur co-signe.
  const loanTerms = {
    TransactionType: "LoanSet",
    Account: broker.classicAddress,
    LoanBrokerID: brokerID,
    PrincipalRequested: xrp(20),
    Counterparty: borrower.classicAddress,
    InterestRate: 20000, // hypothèse 20%
    PaymentInterval: 60,
    PaymentTotal: 2,
    GracePeriod: 30,
    // PAS de tfLoanOverpayment (structuration : anti-remboursement anticipé)
  };
  const prepared = await client.autofill(loanTerms);
  const lenderSigned = broker.sign(prepared);
  const signedTx = decode(lenderSigned.tx_blob);
  // Co-signature emprunteur via le PRÉFIXE COUNTERPARTY dédié (fixCleanup3_4_0).
  // Le helper xrpl.js signLoanSetByCounterparty utilise le mauvais préfixe (cf. F-007).
  const counterSig = kpSign(encodeForSigningCounterparty(signedTx), borrower.privateKey);
  signedTx.CounterpartySignature = {
    SigningPubKey: borrower.publicKey,
    TxnSignature: counterSig,
  };
  const blob = encode(signedTx);
  console.log("\n  LoanSet co-signé (préfixe counterparty), soumission…");
  const loan = await submitSigned(client, blob, "LoanSet");
  if (!loan.ok) throw new Error("LoanSet failed: " + loan.code);
  const loanID = createdNode(loan.meta, "Loan")?.index;
  console.log("  loanID:", loanID);

  const afterLoan = await readVault(client, vaultID);
  console.log("  Vault après prêt:", afterLoan,
    "(AssetsAvailable doit baisser: 20 XRP partis en prêt)");

  // 7. Premier remboursement -> PPS doit monter (intérêts au vault)
  await new Promise((r) => setTimeout(r, 3000));
  const pay = await submit(client, borrower, {
    TransactionType: "LoanPay",
    Account: borrower.classicAddress,
    LoanID: loanID,
    Amount: xrp(11), // principal/2 + intérêts approx
  }, "LoanPay #1");

  const afterPay = await readVault(client, vaultID);
  console.log("\n  Vault après paiement:", afterPay);
  const ppsBefore = Number(before.AssetsTotal) / 50e6; // 50 XRP déposés = 50M parts
  const ppsAfter = Number(afterPay.AssetsTotal) / 50e6;
  console.log(`  PPS: ${ppsBefore} -> ${ppsAfter}`, ppsAfter > ppsBefore ? "✅ monte" : "(inchangé)");

  console.log("\n  loan tx:", EXPLORER_TX + loan.hash);
  await client.disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e?.data ?? e?.message ?? e);
  process.exit(1);
});
