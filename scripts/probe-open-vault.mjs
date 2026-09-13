// Empirical probe of OPEN-ended vaults (VaultKind=0) and vault edge cases, to
// surface real friction beyond the closed-ended path. Verbose, captures codes.
import { connect, submit, trySubmit, ledgerEntry, decodeMptFlags, fund } from "../lib/client.mjs";
import { createdNode } from "../lib/wallets.mjs";
import { nowRipple } from "../lib/epoch.mjs";
import { decode, encode } from "xrpl";
import { encodeForSigningCounterparty } from "ripple-binary-codec";
import { sign as kpSign } from "ripple-keypairs";

const xrp = (n) => String(Math.round(n * 1e6));
const F = []; // findings

async function main() {
  const client = await connect();
  const { wallet: owner } = await fund(client, "owner");
  const { wallet: lp } = await fund(client, "lp");
  const { wallet: borrower } = await fund(client, "borrower");

  // 1. Open vault WITH subscription/redemption dates — should these be rejected?
  console.log("\n[1] VaultCreate open (VaultKind=0) WITH dates set:");
  const withDates = await trySubmit(client, owner, {
    TransactionType: "VaultCreate", Account: owner.classicAddress, Asset: { currency: "XRP" },
    VaultKind: 0, SubscriptionDate: nowRipple() + 60, RedemptionDate: nowRipple() + 300,
    AssetsMaximum: xrp(1000), WithdrawalPolicy: 1,
  }, "open+dates");
  F.push(["open vault with SubscriptionDate/RedemptionDate", withDates.code, withDates.code === "tesSUCCESS" ? "ACCEPTED (dates meaningless on open vault?)" : "rejected"]);

  // 2. Clean open vault.
  console.log("\n[2] VaultCreate open (no dates):");
  const oc = await submit(client, owner, {
    TransactionType: "VaultCreate", Account: owner.classicAddress, Asset: { currency: "XRP" },
    VaultKind: 0, AssetsMaximum: xrp(1000), WithdrawalPolicy: 1,
  }, "open vault");
  if (!oc.ok) { console.log("open vault create failed, aborting:", oc.code); F.push(["open vault create", oc.code, "unexpected"]); return finish(client); }
  const vaultID = createdNode(oc.meta, "Vault").index;
  const vault = await ledgerEntry(client, vaultID);
  const shareMPTID = vault.ShareMPTID;
  console.log("  open vault:", vaultID, "kind:", vault.VaultKind, "subDate:", vault.SubscriptionDate, "redDate:", vault.RedemptionDate);

  // 3. Deposit then IMMEDIATE withdraw (open vaults should allow anytime).
  console.log("\n[3] deposit then immediate withdraw (open = continuous):");
  const dep = await submit(client, lp, { TransactionType: "VaultDeposit", Account: lp.classicAddress, VaultID: vaultID, Amount: xrp(30) }, "deposit 30");
  const wd = await trySubmit(client, lp, { TransactionType: "VaultWithdraw", Account: lp.classicAddress, VaultID: vaultID, Amount: xrp(10) }, "immediate withdraw 10");
  F.push(["open vault immediate withdraw", wd.code, wd.code === "tesSUCCESS" ? "OK (continuous liquidity)" : "unexpected reject"]);

  // 4. Share MPT flags on an OPEN vault — same as closed?
  console.log("\n[4] share MPT flags (open vault):");
  const iss = await client.request({ command: "ledger_entry", mpt_issuance: shareMPTID, ledger_index: "validated" });
  const flags = decodeMptFlags(iss.result.node.Flags);
  console.log("  flags:", flags.set.join(", "), "(value", flags.value, ")");
  F.push(["open vault share flags", flags.set.join("+"), "compare to closed (CanEscrow+CanTrade+CanTransfer=56)"]);

  // 5. Loans from an OPEN vault must be rejected (loans only from closed). Which code?
  console.log("\n[5] LoanBrokerSet + LoanSet on an OPEN vault (should be rejected):");
  const bs = await trySubmit(client, owner, {
    TransactionType: "LoanBrokerSet", Account: owner.classicAddress, VaultID: vaultID,
    ManagementFeeRate: 1000, DebtMaximum: xrp(500), CoverRateMinimum: 10000, CoverRateLiquidation: 5000,
  }, "LoanBrokerSet on open vault");
  F.push(["LoanBrokerSet on open vault", bs.code, bs.code === "tesSUCCESS" ? "ACCEPTED (broker on open vault?!)" : "rejected"]);
  if (bs.ok) {
    const brokerID = createdNode(bs.meta, "LoanBroker")?.index;
    await submit(client, owner, { TransactionType: "LoanBrokerCoverDeposit", Account: owner.classicAddress, LoanBrokerID: brokerID, Amount: xrp(10) }, "cover");
    const terms = await client.autofill({ TransactionType: "LoanSet", Account: owner.classicAddress, LoanBrokerID: brokerID, PrincipalRequested: xrp(10), Counterparty: borrower.classicAddress, InterestRate: 20000, PaymentInterval: 60, PaymentTotal: 1 });
    const s = decode(owner.sign(terms).tx_blob);
    s.CounterpartySignature = { SigningPubKey: borrower.publicKey, TxnSignature: kpSign(encodeForSigningCounterparty(s), borrower.privateKey) };
    const loan = await (async () => { try { const r = await client.request({ command: "submit", tx_blob: encode(s) }); return r.result.engine_result; } catch (e) { return e?.data?.error_exception ?? e?.data?.error; } })();
    console.log("  LoanSet on open vault ->", loan);
    F.push(["LoanSet on open vault", loan, "loans should only come from closed vaults"]);
  }

  // 6. VaultSet — can we change AssetsMaximum after creation?
  console.log("\n[6] VaultSet change AssetsMaximum:");
  const vs = await trySubmit(client, owner, { TransactionType: "VaultSet", Account: owner.classicAddress, VaultID: vaultID, AssetsMaximum: xrp(2000) }, "VaultSet AssetsMaximum");
  F.push(["VaultSet AssetsMaximum", vs.code, vs.code === "tesSUCCESS" ? "mutable" : "rejected"]);

  // 7. VaultDelete on a NON-EMPTY vault (should fail), then note.
  console.log("\n[7] VaultDelete while non-empty:");
  const vdFull = await trySubmit(client, owner, { TransactionType: "VaultDelete", Account: owner.classicAddress, VaultID: vaultID }, "VaultDelete (non-empty)");
  F.push(["VaultDelete non-empty", vdFull.code, "expect rejection while assets/shares outstanding"]);

  finish(client);
}

function finish(client) {
  console.log("\n=== FINDINGS ===");
  for (const [what, code, note] of F) console.log(`  ${String(code).padEnd(22)} ${what}  — ${note}`);
  return client.disconnect();
}

main().catch((e) => console.error("FATAL", e?.data ?? e?.message ?? e));
