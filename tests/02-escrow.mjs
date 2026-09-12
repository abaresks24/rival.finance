// TEST 02 — Escrow d'une part de vault. HYPOTHÈSE CLÉ.
// 02a : branche remboursement -> EscrowCreate + EscrowCancel (les parts reviennent).
// 02b : branche saisie        -> EscrowCreate + EscrowFinish (le créancier reçoit).
import {
  connect,
  submit,
  trySubmit,
  mptHolding,
  waitLedgerTime,
  EXPLORER_TX,
} from "../lib/client.mjs";
import { loadWallets } from "../lib/wallets.mjs";
import { makeCondition } from "../lib/condition.mjs";
import { nowRipple } from "../lib/epoch.mjs";
import { readFileSync } from "node:fs";

const ESCROW_SHARES = "1000000"; // 1M parts sur les 10M détenues par LP

function shareBal(node) {
  if (!node) return { amt: "0", locked: "0" };
  return { amt: node.MPTAmount ?? "0", locked: node.LockedAmount ?? "0" };
}

async function main() {
  const client = await connect();
  const W = loadWallets();
  const lp = W.LP; // détenteur des parts = source de l'escrow
  const creditor = W.GERANT_NAV; // créancier = destination
  const { shareMPTID } = JSON.parse(
    readFileSync(new URL("../vault-credit.json", import.meta.url))
  );
  console.log("shareMPTID:", shareMPTID);

  const before = shareBal(await mptHolding(client, lp.classicAddress, shareMPTID));
  console.log("LP parts avant:", before);

  // ======================= 02a — REMBOURSEMENT / CANCEL ==================
  console.log("\n================ 02a — branche remboursement =============");
  const condA = makeCondition();
  const cancelAfterA = nowRipple() + 18; // court, pour tester le cancel vite
  const createA = {
    TransactionType: "EscrowCreate",
    Account: lp.classicAddress,
    Destination: creditor.classicAddress,
    Amount: { mpt_issuance_id: shareMPTID, value: ESCROW_SHARES },
    Condition: condA.conditionHex,
    CancelAfter: cancelAfterA,
  };
  const escA = await submit(client, lp, createA, "EscrowCreate(02a)");
  if (!escA.ok) throw new Error("02a EscrowCreate failed: " + escA.code);
  const seqA = escA.seq;
  console.log("  OfferSequence(02a):", seqA);

  const lockedAfterCreate = shareBal(
    await mptHolding(client, lp.classicAddress, shareMPTID)
  );
  console.log("  LP parts après create:", lockedAfterCreate,
    "(les parts doivent être verrouillées, pas quitter le solde MPT)");

  await waitLedgerTime(client, cancelAfterA, "CancelAfter(02a)");
  const cancelA = await submit(
    client,
    lp,
    {
      TransactionType: "EscrowCancel",
      Account: lp.classicAddress,
      Owner: lp.classicAddress,
      OfferSequence: seqA,
    },
    "EscrowCancel(02a)"
  );
  if (!cancelA.ok) throw new Error("02a EscrowCancel failed: " + cancelA.code);
  const afterCancel = shareBal(
    await mptHolding(client, lp.classicAddress, shareMPTID)
  );
  console.log("  LP parts après cancel:", afterCancel,
    afterCancel.locked === "0" ? "-> déverrouillées ✅" : "-> ENCORE VERROUILLÉES ❌");

  // ======================= 02b — SAISIE / FINISH =========================
  console.log("\n================ 02b — branche saisie ====================");
  const condB = makeCondition();
  const cancelAfterB = nowRipple() + 3600; // long : ne doit pas expirer
  const createB = {
    TransactionType: "EscrowCreate",
    Account: lp.classicAddress,
    Destination: creditor.classicAddress,
    Amount: { mpt_issuance_id: shareMPTID, value: ESCROW_SHARES },
    Condition: condB.conditionHex,
    CancelAfter: cancelAfterB,
  };
  const escB = await submit(client, lp, createB, "EscrowCreate(02b)");
  if (!escB.ok) throw new Error("02b EscrowCreate failed: " + escB.code);
  const seqB = escB.seq;
  console.log("  OfferSequence(02b):", seqB);

  // (i) tentative de FINISH SANS autorisation préalable du destinataire
  console.log("\n  (i) EscrowFinish SANS MPTokenAuthorize préalable :");
  const finishNoAuth = await trySubmit(
    client,
    creditor,
    {
      TransactionType: "EscrowFinish",
      Account: creditor.classicAddress,
      Owner: lp.classicAddress,
      OfferSequence: seqB,
      Condition: condB.conditionHex,
      Fulfillment: condB.fulfillmentHex,
    },
    "EscrowFinish(no-auth)"
  );

  // (ii) le destinataire crée son holding MPT
  console.log("\n  (ii) MPTokenAuthorize par le créancier :");
  const auth = await trySubmit(
    client,
    creditor,
    {
      TransactionType: "MPTokenAuthorize",
      Account: creditor.classicAddress,
      MPTokenIssuanceID: shareMPTID,
    },
    "MPTokenAuthorize"
  );

  // (iii) FINISH après autorisation
  console.log("\n  (iii) EscrowFinish APRÈS autorisation :");
  const finish = await submit(
    client,
    creditor,
    {
      TransactionType: "EscrowFinish",
      Account: creditor.classicAddress,
      Owner: lp.classicAddress,
      OfferSequence: seqB,
      Condition: condB.conditionHex,
      Fulfillment: condB.fulfillmentHex,
    },
    "EscrowFinish(02b)"
  );

  const creditorBal = shareBal(
    await mptHolding(client, creditor.classicAddress, shareMPTID)
  );
  console.log("\n  parts du créancier après saisie:", creditorBal,
    creditorBal.amt === ESCROW_SHARES ? "✅ reçues" : "❌");

  // (iv) le créancier tente un VaultWithdraw AVANT RedemptionDate -> rejet attendu
  console.log("\n  (iv) VaultWithdraw par le créancier avant RedemptionDate :");
  const { vaultIndex } = JSON.parse(
    readFileSync(new URL("../vault-credit.json", import.meta.url))
  );
  const wd = await trySubmit(
    client,
    creditor,
    {
      TransactionType: "VaultWithdraw",
      Account: creditor.classicAddress,
      VaultID: vaultIndex,
      Amount: { mpt_issuance_id: shareMPTID, value: ESCROW_SHARES },
    },
    "VaultWithdraw(avant redemption)"
  );

  console.log("\n=== RÉSUMÉ TEST 02 ===");
  console.log("  02a create :", EXPLORER_TX + escA.hash);
  console.log("  02a cancel :", EXPLORER_TX + cancelA.hash);
  console.log("  02b create :", EXPLORER_TX + escB.hash);
  console.log("  02b finish :", EXPLORER_TX + finish.hash);
  console.log("  finish sans auth ->", finishNoAuth.code,
    "| authorize ->", auth.code,
    "| withdraw pré-redemption ->", wd.code);

  await client.disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e?.data ?? e);
  process.exit(1);
});
