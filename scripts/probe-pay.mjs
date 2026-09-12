// Validate: originate a 1-payment loan, pay PeriodicPayment inside the window,
// confirm tesSUCCESS and the loan closes (vault repaid).
import { connect, submit, fund, waitLedgerTime, ledgerEntry } from "../lib/client.mjs";
import { createdNode } from "../lib/wallets.mjs";
import { nowRipple, rippleToISO } from "../lib/epoch.mjs";
import { setBroker, coverDeposit, originateLoan, payLoan, readLoan } from "../lib/loan.mjs";
import { createVault, deposit } from "../lib/vault.mjs";

async function main() {
  const client = await connect();
  const { wallet: broker } = await fund(client, "broker");
  const { wallet: borrower } = await fund(client, "borrower");
  const { wallet: lp } = await fund(client, "lp");

  const sub = nowRipple() + 30;
  const v = await createVault(client, broker, { subscriptionDate: sub, redemptionDate: sub + 260, assetsMaxXrp: 1000 });
  await deposit(client, lp, v.vaultID, 50, "LP deposit");
  const b = await setBroker(client, broker, v.vaultID, { debtMaxXrp: 500 });
  await coverDeposit(client, broker, b.loanBrokerID, 10);

  await waitLedgerTime(client, sub, "investment");
  const loan = await originateLoan(client, broker, borrower, b.loanBrokerID, { principalXrp: 20, interestRate: 20000, paymentInterval: 60, paymentTotal: 1 });
  console.log("loanID", loan.loanID);

  const l = await readLoan(client, loan.loanID);
  console.log("StartDate", rippleToISO(l.StartDate), "| NextDue", rippleToISO(l.NextPaymentDueDate), "| PeriodicPayment", l.PeriodicPayment, "| TotalOut", l.TotalValueOutstanding);

  await waitLedgerTime(client, l.NextPaymentDueDate - 18, "payment window");
  const pay = await payLoan(client, borrower, loan.loanID, Number(l.PeriodicPayment) / 1e6, {});
  console.log("pay ->", pay.code);

  const after = await ledgerEntry(client, v.vaultID);
  console.log("vault AssetsTotal", after.AssetsTotal, "AssetsAvailable", after.AssetsAvailable, "-> PPS", Number(after.AssetsTotal) / 50e6);
  try { const l2 = await readLoan(client, loan.loanID); console.log("loan still open, outstanding", l2.PrincipalOutstanding); }
  catch (e) { console.log("loan closed (deleted) ✅"); }
  await client.disconnect();
}
main().catch((e) => console.error("FATAL", e?.data ?? e?.message ?? e));
