// Fast iteration on the LoanSet counterparty-signature scheme.
// The signature is a LOCAL check (fires before phase/broker validation),
// so we can probe it instantly without a vault or subscription wait.
import { connect } from "../lib/client.mjs";
import { loadWallets } from "../lib/wallets.mjs";
import { signLoanSetByCounterparty } from "xrpl";

const DUMMY_BROKER =
  "0000000000000000000000000000000000000000000000000000000000000001";
const xrp = (n) => String(Math.round(n * 1e6));

async function trySubmitBlob(client, blob, label) {
  try {
    const r = await client.request({ command: "submit", tx_blob: blob });
    const res = r.result.engine_result ?? r.result.error;
    console.log(`  ${label}: ${res} — ${r.result.engine_result_message ?? ""}`);
    return res;
  } catch (e) {
    console.log(
      `  ${label}: ERROR ${e?.data?.error} — ${e?.data?.error_exception ?? e?.data?.error_message ?? e.message}`
    );
    return e?.data?.error_exception ?? "err";
  }
}

async function buildLoan(client, first, counter) {
  const terms = {
    TransactionType: "LoanSet",
    Account: first.classicAddress,
    LoanBrokerID: DUMMY_BROKER,
    PrincipalRequested: xrp(20),
    Counterparty: counter.classicAddress,
    InterestRate: 20000,
    PaymentInterval: 60,
    PaymentTotal: 2,
    GracePeriod: 30,
  };
  return client.autofill(terms);
}

async function main() {
  const client = await connect();
  const W = loadWallets();
  const broker = W.GERANT_CREDIT;
  const borrower = W.EMPRUNTEUR;

  console.log("A) first=broker, counter=borrower, multisign");
  {
    const prep = await buildLoan(client, broker, borrower);
    const s = broker.sign(prep);
    const c = signLoanSetByCounterparty(borrower, s.tx_blob, { multisign: true });
    await trySubmitBlob(client, c.tx_blob, "A");
  }

  console.log("B) first=broker, counter=borrower, single-sig");
  {
    const prep = await buildLoan(client, broker, borrower);
    const s = broker.sign(prep);
    const c = signLoanSetByCounterparty(borrower, s.tx_blob);
    await trySubmitBlob(client, c.tx_blob, "B");
  }

  console.log("C) first=borrower, counter=broker, multisign");
  {
    const prep = await buildLoan(client, borrower, broker);
    const s = borrower.sign(prep);
    const c = signLoanSetByCounterparty(broker, s.tx_blob, { multisign: true });
    await trySubmitBlob(client, c.tx_blob, "C");
  }

  console.log("D) first=borrower, counter=broker, single-sig");
  {
    const prep = await buildLoan(client, borrower, broker);
    const s = borrower.sign(prep);
    const c = signLoanSetByCounterparty(broker, s.tx_blob);
    await trySubmitBlob(client, c.tx_blob, "D");
  }

  await client.disconnect();
}

main().catch((e) => console.error("FATAL", e?.data ?? e));
