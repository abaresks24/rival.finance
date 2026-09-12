// TEST 01 — Flags de l'émission MPT des parts. HYPOTHÈSE CLÉ.
// Crée un vault closed-ended PUBLIC à parts transférables, dépose, puis
// décode bit à bit les Flags de l'émission MPT des parts.
import {
  connect,
  submit,
  ledgerEntry,
  decodeMptFlags,
  EXPLORER_TX,
} from "../lib/client.mjs";
import { loadWallets, createdNode } from "../lib/wallets.mjs";
import { rippleInMinutes, rippleToISO } from "../lib/epoch.mjs";
import { writeFileSync } from "node:fs";

const VaultKindClosed = 1;

async function main() {
  const client = await connect();
  const W = loadWallets();
  const owner = W.GERANT_CREDIT; // propriétaire du vault
  const lp = W.LP; // déposant

  // --- 1. VaultCreate : closed-ended, public, parts transférables --------
  const subscriptionDate = rippleInMinutes(10);
  const redemptionDate = rippleInMinutes(60);
  const create = {
    TransactionType: "VaultCreate",
    Account: owner.classicAddress,
    Asset: { currency: "XRP" },
    VaultKind: VaultKindClosed,
    SubscriptionDate: subscriptionDate,
    RedemptionDate: redemptionDate,
    AssetsMaximum: "1000000000", // 1000 XRP en drops (plafond large)
    WithdrawalPolicy: 1, // vaultStrategyFirstComeFirstServe
    // AUCUN flag : ni tfVaultPrivate ni tfVaultShareNonTransferable.
  };
  console.log("=== VaultCreate (closed, public, transferable) ===");
  console.log("  SubscriptionDate:", rippleToISO(subscriptionDate));
  console.log("  RedemptionDate  :", rippleToISO(redemptionDate));
  const created = await submit(client, owner, create);
  if (!created.ok) throw new Error("VaultCreate failed: " + created.code);

  const vaultNode = createdNode(created.meta, "Vault");
  if (!vaultNode) throw new Error("no Vault CreatedNode in meta");
  const vaultIndex = vaultNode.index;
  console.log("  Vault ledger index:", vaultIndex);

  const vault = await ledgerEntry(client, vaultIndex);
  const shareMPTID = vault.ShareMPTID;
  console.log("  ShareMPTID:", shareMPTID);

  // --- 2. VaultDeposit depuis le LP (phase subscription -> autorisé) ------
  console.log("\n=== VaultDeposit (LP, 10 XRP) ===");
  const deposit = {
    TransactionType: "VaultDeposit",
    Account: lp.classicAddress,
    VaultID: vaultIndex,
    Amount: "10000000", // 10 XRP
  };
  const dep = await submit(client, lp, deposit);
  if (!dep.ok) throw new Error("VaultDeposit failed: " + dep.code);

  // --- 3. Lire l'émission MPT des parts ----------------------------------
  console.log("\n=== MPTokenIssuance des parts ===");
  const issuanceRes = await client.request({
    command: "ledger_entry",
    mpt_issuance: shareMPTID,
    ledger_index: "validated",
  });
  const issuance = issuanceRes.result.node;
  console.log("  Issuer            :", issuance.Issuer);
  console.log("  OutstandingAmount :", issuance.OutstandingAmount);
  console.log("  TransferFee       :", issuance.TransferFee ?? 0);
  console.log("  AssetScale        :", issuance.AssetScale ?? 0);

  // --- 4. Décodage bit à bit des Flags -----------------------------------
  const decoded = decodeMptFlags(issuance.Flags);
  console.log("\n=== Flags décodés (valeur =", decoded.value, ") ===");
  for (const name of [
    "lsfMPTLocked",
    "lsfMPTCanLock",
    "lsfMPTRequireAuth",
    "lsfMPTCanEscrow",
    "lsfMPTCanTrade",
    "lsfMPTCanTransfer",
    "lsfMPTCanClawback",
  ]) {
    const present = decoded.set.includes(name);
    console.log(`  ${present ? "✅" : "  "} ${name}${present ? "" : " (absent)"}`);
  }

  const verdict = decoded.set.includes("lsfMPTCanEscrow")
    ? "GO — lsfMPTCanEscrow présent, nantissement natif possible"
    : "NO-GO — lsfMPTCanEscrow ABSENT, bascule compte de garde multisig";
  console.log("\n  VERDICT TEST 01:", verdict);

  // Persist for later tests.
  writeFileSync(
    new URL("../vault-credit.json", import.meta.url),
    JSON.stringify(
      {
        vaultIndex,
        shareMPTID,
        owner: owner.classicAddress,
        subscriptionDate,
        redemptionDate,
        depositTx: dep.hash,
        shareFlags: decoded,
      },
      null,
      2
    )
  );
  console.log("\n  saved -> vault-credit.json");
  console.log("  create tx:", EXPLORER_TX + created.hash);

  await client.disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e?.data ?? e);
  process.exit(1);
});
