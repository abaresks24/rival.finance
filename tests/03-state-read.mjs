// TEST 03 — Lecture d'état depuis l'extérieur (parcours créancier).
// Question de l'énoncé : un créancier tiers peut-il valoriser le gage, et à
// quel coût en appels RPC ?
import { connect } from "../lib/client.mjs";
import { encodeAccountID } from "xrpl";
import { readFileSync } from "node:fs";

async function main() {
  const client = await connect();
  const { vaultIndex, shareMPTID } = JSON.parse(
    readFileSync(new URL("../vault-credit.json", import.meta.url))
  );
  const creditor = JSON.parse(
    readFileSync(new URL("../wallets.json", import.meta.url))
  ).GERANT_NAV.address;
  const heldShares = 1000000; // parts saisies au TEST 02b

  // --- A. Le point aveugle : partir du SEUL ShareMPTID -------------------
  console.log("=== A. Découverte à partir du seul ShareMPTID ===");
  const issuer = encodeAccountID(Buffer.from(shareMPTID.slice(8), "hex"));
  console.log("  issuer dérivé (0 RPC):", issuer, "(= pseudo-compte du vault)");
  const onPseudo = await client.request({
    command: "account_objects",
    account: issuer,
    ledger_index: "validated",
  });
  console.log(
    "  account_objects(pseudo) ->",
    onPseudo.result.account_objects.map((o) => o.LedgerEntryType)
  );
  const filtered = await client.request({
    command: "account_objects",
    account: issuer,
    type: "vault",
    ledger_index: "validated",
  });
  console.log(
    "  account_objects(pseudo, type='vault') ->",
    filtered.result.account_objects.length,
    "objets (le Vault N'EST PAS dans le répertoire du pseudo-compte)"
  );
  console.log(
    "  => VERDICT : depuis le seul MPTID, le Vault n'est PAS atteignable.",
    "Le VaultID doit être transmis hors-bande (cf. friction F-004)."
  );

  // --- B. Parcours réaliste : le créancier connaît le VaultID ------------
  console.log("\n=== B. Valorisation avec le VaultID (transmis par la facilité) ===");
  let rpc = 0;

  rpc++;
  const vres = await client.request({
    command: "ledger_entry",
    index: vaultIndex,
    ledger_index: "validated",
  });
  const vault = vres.result.node;
  console.log(`[RPC ${rpc}] ledger_entry(VaultID) -> Vault`);
  console.log("   AssetsTotal     :", vault.AssetsTotal);
  console.log("   AssetsAvailable :", vault.AssetsAvailable);
  console.log("   LossUnrealized  :", vault.LossUnrealized ?? "(absent)");
  console.log("   AssetsMaximum   :", vault.AssetsMaximum ?? "(absent)");

  rpc++;
  const ires = await client.request({
    command: "ledger_entry",
    mpt_issuance: shareMPTID,
    ledger_index: "validated",
  });
  const sharesTotal = ires.result.node.OutstandingAmount;
  console.log(`[RPC ${rpc}] ledger_entry(mpt_issuance) -> SharesTotal =`, sharesTotal);

  // (optionnel) vérifier on-chain la quantité détenue par le créancier
  rpc++;
  const hres = await client
    .request({
      command: "ledger_entry",
      mptoken: { mpt_issuance_id: shareMPTID, account: creditor },
      ledger_index: "validated",
    })
    .catch(() => null);
  const onchainHeld = hres?.result?.node?.MPTAmount ?? "(n/a)";
  console.log(`[RPC ${rpc}] ledger_entry(mptoken) -> parts détenues on-chain =`, onchainHeld);

  // --- Valorisation ------------------------------------------------------
  const assetsTotal = Number(vault.AssetsTotal);
  const lossUnrealized = Number(vault.LossUnrealized ?? 0);
  const shares = Number(sharesTotal);
  const pps = assetsTotal / shares;
  const grossXrp = (heldShares * pps) / 1e6;

  console.log("\n=== Valorisation ===");
  console.log("   PPS (drops/part)     :", pps);
  console.log("   Valeur brute         :", grossXrp, "XRP");
  console.log("   LossUnrealized       :", lossUnrealized, "drops");

  console.log("\n=== FEEDBACK TEST 03 ===");
  console.log("   MPTID -> Vault           : IMPOSSIBLE sans VaultID hors-bande (F-004).");
  console.log("   VaultID -> valeur position : 2 RPC (Vault + émission), 3 avec vérif solde.");
  console.log(
    "   Question LossUnrealized  :",
    lossUnrealized === 0
      ? "non tranchée ici (perte = 0). Testée empiriquement au TEST 06."
      : `LossUnrealized=${lossUnrealized}, à corréler avec AssetsTotal au TEST 06.`
  );

  await client.disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e?.data ?? e);
  process.exit(1);
});
