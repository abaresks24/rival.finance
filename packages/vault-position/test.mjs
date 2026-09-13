// Unit tests for the pure computePosition — run: node test.mjs
import assert from "node:assert/strict";
import { computePosition } from "./compute.mjs";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("  ok -", name); };

// PPS exactly 1: 50 XRP assets, 50M shares, hold 40M -> 40 XRP.
t("PPS = 1 exactly", () => {
  const r = computePosition(
    { assetsTotal: "50000000", sharesTotal: "50000000", holderShares: "40000000", lossUnrealized: "0" },
    { lossHandling: "already-netted" }
  );
  assert.equal(r.pps, 1);
  assert.equal(r.grossValue, "40000000");
  assert.equal(r.netValue, "40000000");
});

// PPS after interest: assets grew to 50.5M on 50M shares.
t("PPS after interest > 1", () => {
  const r = computePosition(
    { assetsTotal: "50500000", sharesTotal: "50000000", holderShares: "40000000", lossUnrealized: "0" },
    { lossHandling: "already-netted" }
  );
  assert.ok(r.pps > 1);
  assert.equal(r.grossValue, "40400000"); // 40M * 50.5/50
});

// lossUnrealized non-zero, subtract mode.
t("lossUnrealized subtracts pro-rata", () => {
  const r = computePosition(
    { assetsTotal: "50000000", sharesTotal: "50000000", holderShares: "40000000", lossUnrealized: "5000000" },
    { lossHandling: "subtract" }
  );
  // net assets 45M -> holder 40M*45/50 = 36M
  assert.equal(r.netValue, "36000000");
  assert.equal(r.lossApplied, "4000000"); // gross 40M - net 36M
});

// the three lossHandling modes on the SAME state differ as expected.
t("three lossHandling modes diverge", () => {
  const s = { assetsTotal: "50000000", sharesTotal: "50000000", holderShares: "40000000", lossUnrealized: "5000000" };
  const netted = computePosition(s, { lossHandling: "already-netted" });
  const sub = computePosition(s, { lossHandling: "subtract" });
  const strict = computePosition(s, { lossHandling: "strict" });
  assert.equal(netted.netValue, "40000000");
  assert.equal(sub.netValue, "36000000");
  assert.equal(strict.netValue, "36000000");
  assert.ok(strict.assumptions.some((a) => a.includes("NOT yet empirically verified")));
});

// haircut applies to netValue.
t("haircut 2000bps (20%) on netValue", () => {
  const r = computePosition(
    { assetsTotal: "50000000", sharesTotal: "50000000", holderShares: "40000000", lossUnrealized: "0" },
    { lossHandling: "already-netted", haircutBps: 2000 }
  );
  assert.equal(r.collateralValue, "32000000"); // 40M * 0.8
});

// division by zero: sharesTotal 0.
t("sharesTotal 0 -> all zero, no throw", () => {
  const r = computePosition({ assetsTotal: "1000", sharesTotal: "0", holderShares: "10" });
  assert.equal(r.grossValue, "0");
  assert.ok(r.assumptions[0].includes("division by zero"));
});

// null position: holderShares 0.
t("holderShares 0 -> zero position", () => {
  const r = computePosition({ assetsTotal: "50000000", sharesTotal: "50000000", holderShares: "0" });
  assert.equal(r.grossValue, "0");
});

// uint64 max amounts don't overflow (BigInt).
t("uint64-max amounts, no float overflow", () => {
  const MAX = (2n ** 64n - 1n).toString();
  const r = computePosition(
    { assetsTotal: MAX, sharesTotal: MAX, holderShares: MAX, lossUnrealized: "0" },
    { lossHandling: "already-netted" }
  );
  assert.equal(r.grossValue, MAX); // holder owns everything -> whole asset
});

// floor rounding leans to creditor: value that doesn't divide evenly floors down.
t("floor rounding (bias named in README)", () => {
  const r = computePosition(
    { assetsTotal: "100", sharesTotal: "3", holderShares: "1", lossUnrealized: "0" },
    { lossHandling: "already-netted" }
  );
  assert.equal(r.grossValue, "33"); // floor(100/3), not 34
});

console.log(`\n${n} tests passed.`);
