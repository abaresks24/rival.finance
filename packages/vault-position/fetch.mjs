// @xrpl-nav/vault-position — fetch.mjs
// Network layer. The xrpl client is INJECTED, never imported — so this package
// does not depend on any particular xrpl.js version (we run 5.2.0-beta.0; a lib
// that hard-imports a beta is unusable by anyone else).

/**
 * Fetch the raw state needed to value a vault position, from OUTSIDE the vault.
 *
 * IMPORTANT (Phase-0 finding F-004): there is NO on-chain shortcut from a share
 * `MPTokenIssuanceID` to its `Vault` object. The MPTID yields the issuer (the
 * vault pseudo-account), but the `Vault` object lives in the vault OWNER's
 * directory, which no accessible field links back to; and
 * `account_objects(type:"vault")` returns 0 even on the owner. So `vaultID` must
 * be supplied out-of-band (we carry it in the loan's `Data` field). Passing it is
 * required; omitting it throws with this explanation.
 *
 * @param {object} client  an xrpl.js Client (injected)
 * @param {object} p
 * @param {string} p.shareMPTIssuanceID  the vault shares MPT issuance id
 * @param {string} p.holder              account whose position we value
 * @param {string} p.vaultID             the Vault ledger index (out-of-band, see F-004)
 */
export async function fetchVaultState(client, { shareMPTIssuanceID, holder, vaultID }) {
  let rpcCalls = 0;
  if (!vaultID) {
    throw new Error(
      "vault-position: vaultID is required. There is no ShareMPTID→Vault lookup on-chain " +
        "(F-004: Vault lives in the owner's directory; account_objects type:'vault' returns 0). " +
        "Pass vaultID out-of-band (e.g. from the loan Data field)."
    );
  }

  // 1 RPC — the Vault object.
  rpcCalls++;
  const vres = await client.request({ command: "ledger_entry", index: vaultID, ledger_index: "validated" });
  const vault = vres.result.node;
  const ledgerIndex = vres.result.ledger_index;

  // 1 RPC — the shares issuance (OutstandingAmount = sharesTotal).
  rpcCalls++;
  const ires = await client.request({ command: "ledger_entry", mpt_issuance: shareMPTIssuanceID, ledger_index: "validated" });
  const issuance = ires.result.node;

  // 1 RPC (optional) — the holder's MPToken balance.
  let holderShares = "0";
  if (holder) {
    rpcCalls++;
    try {
      const hres = await client.request({
        command: "ledger_entry",
        mptoken: { mpt_issuance_id: shareMPTIssuanceID, account: holder },
        ledger_index: "validated",
      });
      holderShares = hres.result.node?.MPTAmount ?? "0";
    } catch {
      holderShares = "0"; // holder has no position
    }
  }

  const asset =
    typeof vault.Asset === "object" && vault.Asset.currency === "XRP"
      ? "XRP"
      : vault.Asset?.mpt_issuance_id
        ? "MPT"
        : "IOU";

  return {
    vaultID,
    assetsTotal: vault.AssetsTotal ?? "0",
    assetsAvailable: vault.AssetsAvailable ?? "0",
    lossUnrealized: vault.LossUnrealized ?? "0", // absent when zero (F-005) -> "0"
    sharesTotal: issuance.OutstandingAmount ?? "0",
    assetScale: vault.Scale ?? 0, // Vault.Scale for IOU, 0 otherwise
    holderShares,
    asset,
    _meta: {
      rpcCalls, // deliverable: MPTID→value takes 2 (vault+issuance), 3 with holder balance; NO shortcut (F-004)
      ledgerIndex,
      fetchedAt: new Date().toISOString(),
    },
  };
}
