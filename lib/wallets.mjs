// Load the funded wallets saved by TEST 00.
import { readFileSync } from "node:fs";
import { Wallet } from "xrpl";

export function loadWallets() {
  const url = new URL("../wallets.json", import.meta.url);
  const raw = JSON.parse(readFileSync(url, "utf8"));
  const out = {};
  for (const [label, { seed }] of Object.entries(raw)) {
    out[label] = Wallet.fromSeed(seed);
  }
  return out;
}

/** Find the first CreatedNode of a given LedgerEntryType in tx metadata. */
export function createdNode(meta, ledgerEntryType) {
  for (const n of meta?.AffectedNodes ?? []) {
    if (n.CreatedNode?.LedgerEntryType === ledgerEntryType) {
      return {
        index: n.CreatedNode.LedgerIndex,
        fields: n.CreatedNode.NewFields,
      };
    }
  }
  return null;
}
