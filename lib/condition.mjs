// PREIMAGE-SHA-256 crypto-condition (the only type XRPL escrows support).
// Manual DER-ish encoding per the crypto-conditions spec — no external dep.
//
// Fulfillment (32-byte preimage): A0 22 80 20 <preimage>
// Condition:                      A0 25 80 20 <sha256(preimage)> 81 01 20
//   0x20 = 32 = both the fingerprint length and the cost (preimage length).
import { createHash, randomBytes } from "node:crypto";

/** Generate a fresh { preimageHex, conditionHex, fulfillmentHex }. */
export function makeCondition() {
  const preimage = randomBytes(32);
  const hash = createHash("sha256").update(preimage).digest();
  const conditionHex = (
    "A0258020" + hash.toString("hex") + "810120"
  ).toUpperCase();
  const fulfillmentHex = (
    "A0228020" + preimage.toString("hex")
  ).toUpperCase();
  return {
    preimageHex: preimage.toString("hex").toUpperCase(),
    conditionHex,
    fulfillmentHex,
  };
}
