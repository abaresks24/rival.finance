// De-risk the settlement account (REGLEMENT): SignerListSet -> disable master,
// then a 2-of-3 multisig VaultWithdraw with xrpl.js@5.2.0-beta.0. This is the
// "where it can break" step of Phase 1b.
import { connect, submit, trySubmit, fund, waitLedgerTime } from "../lib/client.mjs";
import { createdNode } from "../lib/wallets.mjs";
import { nowRipple } from "../lib/epoch.mjs";
import { createVault, deposit } from "../lib/vault.mjs";
import { multisign } from "xrpl";

const xrp = (n) => String(Math.round(n * 1e6));

async function main() {
  const client = await connect();
  const { wallet: owner } = await fund(client, "owner");
  const { wallet: reglement } = await fund(client, "REGLEMENT");
  const { wallet: gnav } = await fund(client, "GERANT_NAV");
  const { wallet: lp } = await fund(client, "LP");
  const { wallet: tiers } = await fund(client, "TIERS");

  // Vault with short windows so we can reach redemption fast.
  const sub = nowRipple() + 35;
  const v = await createVault(client, owner, { subscriptionDate: sub, redemptionDate: sub + 185, assetsMaxXrp: 1000 });
  console.log("vault", v.vaultID);

  // REGLEMENT deposits (master key still active, subscription phase) -> holds shares.
  await deposit(client, reglement, v.vaultID, 20, "REGLEMENT deposit");

  // TEST 10 — SignerListSet (quorum 2, three weight-1 entries) BEFORE disabling master.
  const sl = await submit(client, reglement, {
    TransactionType: "SignerListSet",
    Account: reglement.classicAddress,
    SignerQuorum: 2,
    SignerEntries: [
      { SignerEntry: { Account: gnav.classicAddress, SignerWeight: 1 } },
      { SignerEntry: { Account: lp.classicAddress, SignerWeight: 1 } },
      { SignerEntry: { Account: tiers.classicAddress, SignerWeight: 1 } },
    ],
  }, "SignerListSet 2/3");

  // reserve cost of the SignerList
  const oiBefore = await client.request({ command: "account_info", account: reglement.classicAddress, ledger_index: "validated" });
  console.log("  OwnerCount after SignerList:", oiBefore.result.account_data.OwnerCount);

  // Disable the master key.
  await submit(client, reglement, { TransactionType: "AccountSet", Account: reglement.classicAddress, SetFlag: 4 }, "AccountSet asfDisableMaster");
  const ai = await client.request({ command: "account_info", account: reglement.classicAddress, ledger_index: "validated" });
  const flags = ai.result.account_data.Flags;
  const lsfDisableMaster = 0x00100000;
  console.log("  lsfDisableMaster set:", Boolean(flags & lsfDisableMaster), "(Flags=" + flags + ")");

  // Negative: a tx signed by the (now disabled) master key must fail.
  const neg = await trySubmit(client, reglement, { TransactionType: "AccountSet", Account: reglement.classicAddress, Domain: "6578616D706C65" }, "master-key tx (should fail)");
  console.log("  master-key tx ->", neg.code, "(expected tefMASTER_DISABLED)");

  // Wait for redemption, then multisig VaultWithdraw.
  await waitLedgerTime(client, sub + 185, "RedemptionDate");

  // Build + autofill, force multisign shape (SigningPubKey ""), set Fee for 2 sigs.
  const base = await client.autofill({
    TransactionType: "VaultWithdraw",
    Account: reglement.classicAddress,
    VaultID: v.vaultID,
    Amount: xrp(10),
  }, 2); // signersCount hint = 2
  base.SigningPubKey = "";
  console.log("  autofill Fee for 2-signer multisig:", base.Fee, "drops");

  const b1 = gnav.sign(base, true).tx_blob;
  const b2 = lp.sign(base, true).tx_blob;
  const combined = multisign([b1, b2]);
  const w = await trySubmit2(client, combined, "multisig VaultWithdraw (2/3)");

  // Negative: single signature must fail with an unmet-quorum code.
  const b1only = gnav.sign(base, true).tx_blob;
  const solo = multisign([b1only]);
  const wSolo = await trySubmit2(client, solo, "single-sig VaultWithdraw (should fail)");
  console.log("  single-sig ->", wSolo.code, "(expected tefBAD_QUORUM)");

  await client.disconnect();
}

async function trySubmit2(client, blob, label) {
  try {
    const r = await client.submitAndWait(blob);
    const code = r.result.meta?.TransactionResult;
    console.log(`  ${code === "tesSUCCESS" ? "✓" : "✗"} ${label}: ${code}  https://devnet.xrpl.org/transactions/${r.result.hash}`);
    return { code, hash: r.result.hash, ok: code === "tesSUCCESS" };
  } catch (e) {
    const code = e?.data?.engine_result ?? e?.data?.error ?? e.message?.match(/te[cfml]\w+/)?.[0] ?? "ERR";
    console.log(`  ✗ ${label}: ${code} — ${e?.data?.engine_result_message ?? e?.data?.error_exception ?? ""}`);
    return { code, ok: false };
  }
}

main().catch((e) => console.error("FATAL", e?.data ?? e?.message ?? e));
