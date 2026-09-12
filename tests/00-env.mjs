// TEST 00 — Environnement.
// 1. Connexion WSS, fundWallet x5, soldes.
// 2. server_info -> version de rippled.
// 3. amendments -> statut des amendments qui nous concernent.
import { connect, fund, xrpBalance } from "../lib/client.mjs";

const AMENDMENTS_OF_INTEREST = [
  "LendingProtocol",
  "SingleAssetVault",
  "TokenEscrow",
  "fixTokenEscrowV1",
  "MPTokensV1",
  "PermissionedDomains",
  "Credentials",
  "Batch",
];

async function main() {
  const client = await connect();
  console.log("connected:", client.connection.getUrl());

  // --- 2. server_info -----------------------------------------------------
  const info = await client.request({ command: "server_info" });
  const si = info.result.info;
  console.log("\n=== server_info ===");
  console.log("  build_version :", si.build_version);
  console.log("  network_id    :", si.network_id);
  console.log("  server_state  :", si.server_state);
  console.log(
    "  validated ledger:",
    si.validated_ledger?.seq,
    "hash",
    si.validated_ledger?.hash
  );
  console.log("  amendment_blocked:", si.amendment_blocked ?? false);

  // --- 3. amendments ------------------------------------------------------
  console.log("\n=== amendments ===");
  let featureMap = null;
  try {
    const feat = await client.request({ command: "feature" });
    featureMap = feat.result.features; // { hash: {name, enabled, supported} }
    console.log("  (source: `feature` command)");
  } catch (e) {
    console.log(
      "  `feature` command unavailable:",
      e?.data?.error ?? e.message,
      "-> falling back to Amendments ledger object"
    );
  }

  if (featureMap) {
    const byName = {};
    for (const [hash, f] of Object.entries(featureMap)) {
      byName[f.name] = { hash, enabled: f.enabled, supported: f.supported };
    }
    for (const name of AMENDMENTS_OF_INTEREST) {
      const f = byName[name];
      if (!f) {
        console.log(`  ${name.padEnd(20)} : NOT FOUND on this server`);
      } else {
        console.log(
          `  ${name.padEnd(20)} : enabled=${f.enabled} supported=${f.supported}  ${f.hash}`
        );
      }
    }
  } else {
    // Fallback: read the Amendments singleton (enabled hashes only, no names).
    const AMENDMENTS_INDEX =
      "7DB0788C020F02780A673DC74757F23823FA3014C1866E72CC4CD8B226CD6EF4";
    const le = await client.request({
      command: "ledger_entry",
      index: AMENDMENTS_INDEX,
      ledger_index: "validated",
    });
    const enabled = le.result.node?.Amendments ?? [];
    console.log(`  enabled amendment hashes (${enabled.length}):`);
    for (const h of enabled) console.log("   ", h);
    console.log(
      "  NOTE: no name mapping available without `feature`; see friction log."
    );
  }

  // --- 1. fund 5 wallets --------------------------------------------------
  console.log("\n=== funding 5 wallets ===");
  const labels = [
    "GERANT_CREDIT",
    "LP",
    "EMPRUNTEUR",
    "GERANT_NAV",
    "LP_NAV",
  ];
  const wallets = [];
  for (const label of labels) {
    const { wallet } = await fund(client, label);
    wallets.push({ label, wallet });
  }

  console.log("\n=== balances (validated) ===");
  for (const { label, wallet } of wallets) {
    const bal = await xrpBalance(client, wallet.classicAddress);
    console.log(`  ${label.padEnd(14)} : ${bal} XRP`);
  }

  // Persist seeds so later tests reuse the same funded accounts.
  const dump = Object.fromEntries(
    wallets.map(({ label, wallet }) => [
      label,
      { address: wallet.classicAddress, seed: wallet.seed },
    ])
  );
  const fs = await import("node:fs");
  const url = new URL("../wallets.json", import.meta.url);
  fs.writeFileSync(url, JSON.stringify(dump, null, 2));
  console.log("\n  wallets saved to wallets.json");

  await client.disconnect();
  console.log("\ndone.");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
