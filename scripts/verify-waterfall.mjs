#!/usr/bin/env node
// verify-waterfall — independent recompute of the settlement cascade from ledger
// state, for a REGLEMENT signer to run BEFORE signing. Composes the two reusable
// packages (vault-position for the PPS) with lib/waterfall.mjs (the split).
//
//   node scripts/verify-waterfall.mjs --vault <id> --share-mpt <id> \
//        --reglement <addr> --debt <drops> [--fees <drops>] [--haircut-bps 2000]
import { connect } from "../lib/client.mjs";
import { fetchVaultState, computePosition } from "../packages/vault-position/index.mjs";
import { waterfall } from "../lib/waterfall.mjs";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

async function main() {
  const vaultID = arg("vault");
  const shareMPTIssuanceID = arg("share-mpt");
  const reglement = arg("reglement"); // holds the seized shares
  const debtOutstanding = Number(arg("debt", "0"));
  const accruedFees = Number(arg("fees", "0"));
  const haircutBps = Number(arg("haircut-bps", "0"));
  const lossHandling = arg("loss-handling", "strict");
  if (!vaultID || !shareMPTIssuanceID || !reglement) {
    console.error("usage: --vault <id> --share-mpt <id> --reglement <addr> --debt <drops> [--fees <drops>] [--haircut-bps N]");
    process.exit(1);
  }

  const client = await connect();
  const state = await fetchVaultState(client, { shareMPTIssuanceID, holder: reglement, vaultID });
  await client.disconnect();

  const pos = computePosition(state, { haircutBps, lossHandling });
  const sharesSeized = Number(state.holderShares);
  const split = waterfall({ sharesSeized, pps: pos.pps, debtOutstanding, accruedFees });

  console.log("=== verify-waterfall (recompute before signing) ===");
  console.log("  shares held by REGLEMENT :", sharesSeized);
  console.log("  pps (net)                :", pos.pps);
  console.log("  grossValue (drops)       :", split.grossValue);
  console.log("  debt + fees (drops)      :", debtOutstanding + accruedFees);
  console.log("  -> to creditor           :", split.toCreditor);
  console.log("  -> to borrower (surplus) :", split.toBorrower);
  console.log("  -> shortfall (vault loss):", split.shortfall);
  console.log("\n  assumptions:");
  for (const a of pos.assumptions) console.log("   -", a);
  console.log("\n  Sign only if these numbers match what the other signers computed independently.");
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
