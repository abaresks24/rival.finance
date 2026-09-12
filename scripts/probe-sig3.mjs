// Which role submits LoanSet? Test both, IN investment phase (tecNO_PERMISSION
// only surfaces past the phase gate). Short subscription to iterate fast.
import { connect, submit, fund, waitLedgerTime } from "../lib/client.mjs";
import { createdNode } from "../lib/wallets.mjs";
import { nowRipple } from "../lib/epoch.mjs";
import { decode, encode } from "xrpl";
import { encodeForSigningCounterparty } from "ripple-binary-codec";
import { sign as kpSign } from "ripple-keypairs";

const xrp = (n) => String(Math.round(n * 1e6));

async function trySubmit(client, blob, label) {
  try {
    const r = await client.request({ command: "submit", tx_blob: blob });
    console.log(`  ${label}: ${r.result.engine_result} — ${r.result.engine_result_message}`);
    return r.result.engine_result;
  } catch (e) {
    console.log(`  ${label}: ${e?.data?.error} — ${e?.data?.error_exception ?? e?.data?.error_message}`);
  }
}
function cosign(prep, firstWallet, counterWallet) {
  const s = decode(firstWallet.sign(prep).tx_blob);
  s.CounterpartySignature = { SigningPubKey: counterWallet.publicKey, TxnSignature: kpSign(encodeForSigningCounterparty(s), counterWallet.privateKey) };
  return encode(s);
}

async function main() {
  const client = await connect();
  const { wallet: broker } = await fund(client, "broker");
  const { wallet: borrower } = await fund(client, "borrower");
  const { wallet: lp } = await fund(client, "lp");

  const sub = nowRipple() + 30;
  const vc = await submit(client, broker, { TransactionType: "VaultCreate", Account: broker.classicAddress, Asset: { currency: "XRP" }, VaultKind: 1, SubscriptionDate: sub, RedemptionDate: sub + 240, AssetsMaximum: xrp(1000), WithdrawalPolicy: 1 }, "VaultCreate");
  const vaultID = createdNode(vc.meta, "Vault").index;
  await submit(client, lp, { TransactionType: "VaultDeposit", Account: lp.classicAddress, VaultID: vaultID, Amount: xrp(50) }, "Deposit 50");
  const bs = await submit(client, broker, { TransactionType: "LoanBrokerSet", Account: broker.classicAddress, VaultID: vaultID, ManagementFeeRate: 1000, DebtMaximum: xrp(500), CoverRateMinimum: 10000, CoverRateLiquidation: 5000 }, "BrokerSet");
  const brokerID = createdNode(bs.meta, "LoanBroker").index;
  await submit(client, broker, { TransactionType: "LoanBrokerCoverDeposit", Account: broker.classicAddress, LoanBrokerID: brokerID, Amount: xrp(10) }, "Cover 10");

  await waitLedgerTime(client, sub, "investment");

  const terms = (account) => ({ TransactionType: "LoanSet", Account: account, LoanBrokerID: brokerID, PrincipalRequested: xrp(20), InterestRate: 20000, PaymentInterval: 60, PaymentTotal: 2 });

  // X: first=broker, counter=borrower
  {
    const t = { ...terms(broker.classicAddress), Counterparty: borrower.classicAddress };
    await trySubmit(client, cosign(await client.autofill(t), broker, borrower), "X broker-first ");
  }
  // Y: first=borrower, counter=broker
  {
    const t = { ...terms(borrower.classicAddress), Counterparty: broker.classicAddress };
    await trySubmit(client, cosign(await client.autofill(t), borrower, broker), "Y borrower-first");
  }
  await client.disconnect();
}
main().catch((e) => console.error("FATAL", e?.data ?? e?.message ?? e));
