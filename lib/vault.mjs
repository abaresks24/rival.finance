// RIVAL — vault primitives (closed-ended, public, transferable shares).
import { submit, ledgerEntry } from "./client.mjs";
import { createdNode } from "./wallets.mjs";
import { toDrops } from "./pricing.mjs";

const VAULT_KIND_CLOSED = 1;
const POLICY_FCFS = 1; // vaultStrategyFirstComeFirstServe

/** Create a closed-ended, public, transferable-share vault (XRP asset). */
export async function createVault(client, owner, { subscriptionDate, redemptionDate, assetsMaxXrp = 100000, data }) {
  const tx = {
    TransactionType: "VaultCreate",
    Account: owner.classicAddress,
    Asset: { currency: "XRP" },
    VaultKind: VAULT_KIND_CLOSED,
    SubscriptionDate: subscriptionDate,
    RedemptionDate: redemptionDate,
    AssetsMaximum: toDrops(assetsMaxXrp),
    WithdrawalPolicy: POLICY_FCFS,
  };
  if (data) tx.Data = Buffer.from(data, "utf8").toString("hex").toUpperCase();
  const r = await submit(client, owner, tx, "VaultCreate");
  if (!r.ok) throw new Error("VaultCreate: " + r.code);
  const node = createdNode(r.meta, "Vault");
  const vault = await ledgerEntry(client, node.index);
  return { vaultID: node.index, shareMPTID: vault.ShareMPTID, hash: r.hash };
}

export async function deposit(client, who, vaultID, xrp, label = "VaultDeposit") {
  return submit(client, who, {
    TransactionType: "VaultDeposit",
    Account: who.classicAddress,
    VaultID: vaultID,
    Amount: toDrops(xrp),
  }, `${label} ${xrp} XRP`);
}

export async function withdrawShares(client, who, vaultID, shareMPTID, shares, label = "VaultWithdraw") {
  return submit(client, who, {
    TransactionType: "VaultWithdraw",
    Account: who.classicAddress,
    VaultID: vaultID,
    Amount: { mpt_issuance_id: shareMPTID, value: String(shares) },
  }, label);
}

export async function readVault(client, vaultID) {
  const v = await ledgerEntry(client, vaultID);
  return {
    vaultID,
    assetsTotal: v.AssetsTotal ?? "0",
    assetsAvailable: v.AssetsAvailable ?? "0",
    lossUnrealized: v.LossUnrealized ?? "0",
    assetsMaximum: v.AssetsMaximum ?? "0",
    shareMPTID: v.ShareMPTID,
    subscriptionDate: v.SubscriptionDate,
    redemptionDate: v.RedemptionDate,
  };
}

export async function sharesOutstanding(client, shareMPTID) {
  const res = await client.request({
    command: "ledger_entry",
    mpt_issuance: shareMPTID,
    ledger_index: "validated",
  });
  return res.result.node.OutstandingAmount ?? "0";
}
