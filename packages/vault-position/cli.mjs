#!/usr/bin/env node
// node cli.mjs --share-mpt <id> --holder <address> --vault <vaultID> --network devnet
// The xrpl client is created here (dev tool); the LIBRARY never imports xrpl.
import { Client } from "xrpl";
import { fetchVaultState } from "./fetch.mjs";
import { computePosition } from "./compute.mjs";

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

const NETWORKS = {
  devnet: "wss://s.devnet.rippletest.net:51233/",
  testnet: "wss://s.altnet.rippletest.net:51233/",
};

async function main() {
  const shareMPTIssuanceID = arg("share-mpt");
  const holder = arg("holder");
  const vaultID = arg("vault");
  const haircutBps = Number(arg("haircut-bps", "2000"));
  const lossHandling = arg("loss-handling", "strict");
  const wss = NETWORKS[arg("network", "devnet")] || arg("network");
  if (!shareMPTIssuanceID) {
    console.error("usage: cli.mjs --share-mpt <id> --holder <addr> --vault <vaultID> [--network devnet] [--haircut-bps 2000] [--loss-handling strict]");
    process.exit(1);
  }

  const client = new Client(wss);
  await client.connect();
  const state = await fetchVaultState(client, { shareMPTIssuanceID, holder, vaultID });
  await client.disconnect();

  const val = computePosition(state, { haircutBps, lossHandling });

  console.log("=== vault-position ===");
  console.log("state:", JSON.stringify(state, null, 2));
  console.log("\nvaluation:");
  console.log("  pps            :", val.pps);
  console.log("  grossValue     :", val.grossValue);
  console.log("  netValue       :", val.netValue);
  console.log("  lossApplied    :", val.lossApplied);
  console.log(`  collateralValue: ${val.collateralValue}  (haircut ${haircutBps / 100}%)`);
  console.log("\nassumptions:");
  for (const a of val.assumptions) console.log("  -", a);
  console.log(`\nRPC calls (MPTID -> value): ${state._meta.rpcCalls}  (no ShareMPTID->Vault shortcut — F-004)`);
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
