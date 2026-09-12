// Client + funding helpers for XRPL Devnet.
import { Client, Wallet } from "xrpl";

export const DEVNET_WSS = "wss://s.devnet.rippletest.net:51233/";
export const EXPLORER_TX = "https://devnet.xrpl.org/transactions/";
export const EXPLORER_ACCT = "https://devnet.xrpl.org/accounts/";

/** Connect a client to Devnet. Caller is responsible for disconnect(). */
export async function connect() {
  const client = new Client(DEVNET_WSS);
  await client.connect();
  return client;
}

/**
 * Fund a fresh wallet from the Devnet faucet.
 * Returns { wallet, balance } where balance is in XRP (string).
 */
export async function fund(client, label = "wallet") {
  const { wallet, balance } = await client.fundWallet();
  console.log(
    `  funded ${label}: ${wallet.classicAddress}  (${balance} XRP)  ${EXPLORER_ACCT}${wallet.classicAddress}`
  );
  return { wallet, balance };
}

/** XRP balance of an account, in XRP (number), or null if not found. */
export async function xrpBalance(client, address) {
  try {
    const res = await client.request({
      command: "account_info",
      account: address,
      ledger_index: "validated",
    });
    return Number(res.result.account_data.Balance) / 1_000_000;
  } catch (e) {
    if (e?.data?.error === "actNotFound") return null;
    throw e;
  }
}

/** Log a link to a validated tx. */
export function logTx(label, hash) {
  console.log(`  ${label}: ${EXPLORER_TX}${hash}`);
}

/** Pretty-print the meta result code of a submitted tx. */
export function txResult(submitResult) {
  const meta = submitResult?.result?.meta;
  const code =
    typeof meta === "object" ? meta.TransactionResult : meta ?? "unknown";
  const hash = submitResult?.result?.hash ?? submitResult?.result?.tx_json?.hash;
  return { code, hash };
}

/**
 * Autofill + sign + submit + wait for validation.
 * Returns { code, hash, meta, tx }. Throws only on transport errors.
 */
export async function submit(client, wallet, tx, label = tx.TransactionType) {
  const res = await client.submitAndWait(tx, {
    autofill: true,
    wallet,
  });
  const meta = res.result.meta;
  const code =
    typeof meta === "object" ? meta.TransactionResult : String(meta);
  const hash = res.result.hash;
  const seq = res.result.tx_json?.Sequence ?? res.result.Sequence;
  const ok = code === "tesSUCCESS";
  console.log(
    `  ${ok ? "✓" : "✗"} ${label}: ${code}  ${EXPLORER_TX}${hash}`
  );
  return { code, hash, seq, meta, tx: res.result, ok };
}

/**
 * Like submit(), but never throws: captures tem/tef/tel rejections that
 * submitAndWait would otherwise raise. Use for expected-failure tests.
 * Returns { code, hash, seq, meta, ok, engine_result_message }.
 */
export async function trySubmit(client, wallet, tx, label = tx.TransactionType) {
  try {
    const r = await submit(client, wallet, tx, label);
    return r;
  } catch (e) {
    // xrpl.js throws with the engine result for non-tec rejections.
    const code =
      e?.data?.engine_result ??
      e?.data?.error ??
      e?.message?.match(/tem\w+|tef\w+|tel\w+|tec\w+/)?.[0] ??
      "UNKNOWN";
    const msg =
      e?.data?.engine_result_message ?? e?.data?.error_message ?? e?.message;
    console.log(`  ✗ ${label}: ${code}  (${msg})`);
    return { code, ok: false, engine_result_message: msg, error: e };
  }
}

/** Submit an already-signed tx blob (e.g. counterparty-co-signed LoanSet). */
export async function submitSigned(client, txBlob, label = "signed tx") {
  const res = await client.submitAndWait(txBlob);
  const meta = res.result.meta;
  const code =
    typeof meta === "object" ? meta.TransactionResult : String(meta);
  const hash = res.result.hash;
  const ok = code === "tesSUCCESS";
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${code}  ${EXPLORER_TX}${hash}`);
  return { code, hash, meta, tx: res.result, ok };
}

// MPTokenIssuance Flags (lsf*) bit values — XLS-33 / XLS-65.
export const MPT_FLAGS = {
  lsfMPTLocked: 0x0001,
  lsfMPTCanLock: 0x0002,
  lsfMPTRequireAuth: 0x0004,
  lsfMPTCanEscrow: 0x0008,
  lsfMPTCanTrade: 0x0010,
  lsfMPTCanTransfer: 0x0020,
  lsfMPTCanClawback: 0x0040,
};

/** Decode an MPTokenIssuance Flags integer into the list of set flag names. */
export function decodeMptFlags(flags) {
  const n = Number(flags) || 0;
  const set = [];
  for (const [name, bit] of Object.entries(MPT_FLAGS)) {
    if (n & bit) set.push(name);
  }
  return { value: n, set };
}

/** Read a ledger entry by its object index (hash). */
export async function ledgerEntry(client, index) {
  const res = await client.request({
    command: "ledger_entry",
    index,
    ledger_index: "validated",
  });
  return res.result.node;
}

/** Read an account's MPToken holding for an issuance, or null. */
export async function mptHolding(client, account, mptIssuanceId) {
  try {
    const res = await client.request({
      command: "ledger_entry",
      mptoken: { mpt_issuance_id: mptIssuanceId, account },
      ledger_index: "validated",
    });
    return res.result.node; // has MPTAmount, LockedAmount, Flags
  } catch (e) {
    if (e?.data?.error === "entryNotFound") return null;
    throw e;
  }
}

/** Current ledger close time in Ripple epoch seconds. */
export async function ledgerCloseTime(client) {
  const res = await client.request({
    command: "ledger",
    ledger_index: "validated",
  });
  return res.result.ledger.close_time;
}

/** Poll until the validated ledger close time passes targetRipple. */
export async function waitLedgerTime(client, targetRipple, label = "") {
  for (;;) {
    const t = await ledgerCloseTime(client);
    if (t > targetRipple) return t;
    const remaining = targetRipple - t;
    console.log(`  …waiting ${remaining}s for ${label || "target"} (ledger close)`);
    await new Promise((r) => setTimeout(r, 4000));
  }
}

export { Wallet };
