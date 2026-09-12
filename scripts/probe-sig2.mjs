// Structural disambiguation of the counterparty signature form, against a REAL
// broker, no long waits (LoanSet preflight temINVALID fires before phase checks).
import { connect, submit } from "../lib/client.mjs";
import { createdNode } from "../lib/wallets.mjs";
import { nowRipple } from "../lib/epoch.mjs";
import { decode, encode } from "xrpl";
import {
  encodeForSigningCounterparty,
  encodeForMultisigningCounterparty,
} from "ripple-binary-codec";
import { sign as kpSign } from "ripple-keypairs";

const xrp = (n) => String(Math.round(n * 1e6));

async function trySubmit(client, blob, label) {
  try {
    const r = await client.request({ command: "submit", tx_blob: blob });
    console.log(`  ${label}: ${r.result.engine_result} — ${r.result.engine_result_message}`);
  } catch (e) {
    console.log(`  ${label}: ${e?.data?.error} — ${e?.data?.error_exception ?? e?.data?.error_message}`);
  }
}

async function main() {
  const client = await connect();
  const { wallet: broker } = await client.fundWallet();
  const { wallet: borrower } = await client.fundWallet();
  console.log("broker", broker.classicAddress, "borrower", borrower.classicAddress);

  const sub = nowRipple() + 600; // reste en subscription
  const vc = await submit(client, broker, {
    TransactionType: "VaultCreate",
    Account: broker.classicAddress,
    Asset: { currency: "XRP" },
    VaultKind: 1,
    SubscriptionDate: sub,
    RedemptionDate: sub + 300,
    AssetsMaximum: xrp(1000),
    WithdrawalPolicy: 1,
  }, "VaultCreate");
  const vaultID = createdNode(vc.meta, "Vault").index;
  const bs = await submit(client, broker, {
    TransactionType: "LoanBrokerSet",
    Account: broker.classicAddress,
    VaultID: vaultID,
    ManagementFeeRate: 1000,
    DebtMaximum: xrp(500),
    CoverRateMinimum: 10000,
    CoverRateLiquidation: 5000,
  }, "LoanBrokerSet");
  const brokerID = createdNode(bs.meta, "LoanBroker").index;
  await submit(client, broker, {
    TransactionType: "LoanBrokerCoverDeposit",
    Account: broker.classicAddress,
    LoanBrokerID: brokerID,
    Amount: xrp(10),
  }, "CoverDeposit");

  const full = {
    TransactionType: "LoanSet",
    Account: broker.classicAddress,
    LoanBrokerID: brokerID,
    PrincipalRequested: xrp(20),
    Counterparty: borrower.classicAddress,
    InterestRate: 20000,
    PaymentInterval: 60,
    PaymentTotal: 2,
    GracePeriod: 30,
  };
  const minimal = {
    TransactionType: "LoanSet",
    Account: broker.classicAddress,
    LoanBrokerID: brokerID,
    PrincipalRequested: xrp(20),
    Counterparty: borrower.classicAddress,
    PaymentInterval: 60,
    PaymentTotal: 2,
  };

  const cosignFlat = (prep) => {
    const s = decode(broker.sign(prep).tx_blob);
    const sig = kpSign(encodeForSigningCounterparty(s), borrower.privateKey);
    s.CounterpartySignature = { SigningPubKey: borrower.publicKey, TxnSignature: sig };
    return encode(s);
  };

  // Control: first-party only, Counterparty field but NO CounterpartySignature
  {
    const prep = await client.autofill(full);
    await trySubmit(client, broker.sign(prep).tx_blob, "CTRL no-cosig");
  }
  const base = { TransactionType: "LoanSet", Account: broker.classicAddress, LoanBrokerID: brokerID, PrincipalRequested: xrp(20), Counterparty: borrower.classicAddress, PaymentInterval: 60, PaymentTotal: 2 };
  await trySubmit(client, cosignFlat(await client.autofill(full)), "FULL         ");
  await trySubmit(client, cosignFlat(await client.autofill({ ...base, InterestRate: 20000 })), "MIN+Interest ");
  await trySubmit(client, cosignFlat(await client.autofill({ ...base, GracePeriod: 30 })), "MIN+Grace    ");
  await trySubmit(client, cosignFlat(await client.autofill({ ...base, InterestRate: 5000 })), "MIN+Int5000  ");

  await client.disconnect();
}
main().catch((e) => console.error("FATAL", e?.data ?? e?.message ?? e));
