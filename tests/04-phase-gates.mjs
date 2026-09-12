// TEST 04 — Garde-fous de phase. On capture le CODE et le MESSAGE exacts.
// Vault dédié à fenêtres courtes pour traverser les 3 phases en ~90 s.
//
// Gates couverts ici (sans machinerie de prêt) :
//   - VaultDeposit dépassant AssetsMaximum (Subscription)   -> rejet
//   - VaultDeposit en Investissement                        -> rejet
//   - VaultWithdraw en Investissement                       -> rejet
// Les deux gates LoanSet (Redemption + dernier paiement > RedemptionDate)
// nécessitent un LoanBroker + signature counterparty : capturés dans le
// lifecycle de la Phase 1 (voir REPORT).
import {
  connect,
  submit,
  trySubmit,
  waitLedgerTime,
} from "../lib/client.mjs";
import { loadWallets, createdNode } from "../lib/wallets.mjs";
import { nowRipple, rippleToISO } from "../lib/epoch.mjs";

const results = [];
function record(name, phase, r, expected) {
  results.push({ name, phase, code: r.code, ok: !r.ok });
  console.log(
    `  [${phase}] ${name}: ${r.code} ${r.ok ? "(⚠ ACCEPTÉ, rejet attendu)" : "(rejeté ✅)"}` +
      (r.engine_result_message ? ` — ${r.engine_result_message}` : "")
  );
}

async function main() {
  const client = await connect();
  const W = loadWallets();
  const owner = W.GERANT_CREDIT;
  const lp = W.LP;

  // Contrainte protocole : RedemptionDate - SubscriptionDate >= 180 s.
  const subscriptionDate = nowRipple() + 20;
  const redemptionDate = subscriptionDate + 185;
  console.log("=== VaultCreate (fenêtres courtes) ===");
  console.log("  SubscriptionDate:", rippleToISO(subscriptionDate), "(T+20s)");
  console.log("  RedemptionDate  :", rippleToISO(redemptionDate), "(T+205s)");
  const created = await submit(client, owner, {
    TransactionType: "VaultCreate",
    Account: owner.classicAddress,
    Asset: { currency: "XRP" },
    VaultKind: 1,
    SubscriptionDate: subscriptionDate,
    RedemptionDate: redemptionDate,
    AssetsMaximum: "5000000", // 5 XRP : plafond volontairement bas
    WithdrawalPolicy: 1,
  });
  if (!created.ok) throw new Error("VaultCreate failed: " + created.code);
  const vaultIndex = createdNode(created.meta, "Vault").index;
  console.log("  VaultID:", vaultIndex);

  // ---- PHASE SUBSCRIPTION -----------------------------------------------
  console.log("\n=== PHASE SUBSCRIPTION ===");
  // dépôt valide (3 XRP, sous le plafond) pour donner des parts au LP
  const okDep = await submit(client, lp, {
    TransactionType: "VaultDeposit",
    Account: lp.classicAddress,
    VaultID: vaultIndex,
    Amount: "3000000",
  }, "VaultDeposit valide 3 XRP");
  if (!okDep.ok) throw new Error("dépôt initial refusé: " + okDep.code);

  // dépôt qui dépasse AssetsMaximum (déjà 3 sur 5, on tente +10)
  const overMax = await trySubmit(client, lp, {
    TransactionType: "VaultDeposit",
    Account: lp.classicAddress,
    VaultID: vaultIndex,
    Amount: "10000000",
  }, "VaultDeposit > AssetsMaximum");
  record("VaultDeposit>AssetsMaximum", "SUBSCRIPTION", overMax);

  // ---- PHASE INVESTISSEMENT ---------------------------------------------
  await waitLedgerTime(client, subscriptionDate, "SubscriptionDate");
  console.log("\n=== PHASE INVESTISSEMENT ===");
  const depInv = await trySubmit(client, lp, {
    TransactionType: "VaultDeposit",
    Account: lp.classicAddress,
    VaultID: vaultIndex,
    Amount: "1000000",
  }, "VaultDeposit en investissement");
  record("VaultDeposit@Investment", "INVESTMENT", depInv);

  const wdInv = await trySubmit(client, lp, {
    TransactionType: "VaultWithdraw",
    Account: lp.classicAddress,
    VaultID: vaultIndex,
    Amount: "1000000",
  }, "VaultWithdraw en investissement");
  record("VaultWithdraw@Investment", "INVESTMENT", wdInv);

  console.log("\n=== TABLE DES CODES DE PHASE ===");
  for (const r of results) {
    console.log(`  ${r.phase.padEnd(13)} ${r.name.padEnd(28)} -> ${r.code}`);
  }
  console.log(
    "  Lisibilité : chaque code pointe-t-il la contrainte ? (voir REPORT)"
  );

  await client.disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e?.data ?? e);
  process.exit(1);
});
