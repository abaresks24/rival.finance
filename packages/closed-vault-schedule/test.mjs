// Unit tests — run: node test.mjs
import assert from "node:assert/strict";
import {
  planNavFacility,
  toRippleEpoch,
  fromRippleEpoch,
  RIPPLE_EPOCH_OFFSET,
} from "./index.mjs";

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log("  ok -", name);
};

// epoch round-trip
t("epoch offset is 946684800", () => assert.equal(RIPPLE_EPOCH_OFFSET, 946684800));
t("toRippleEpoch(Date) round-trips", () => {
  const d = new Date("2026-01-01T00:00:00Z");
  const r = toRippleEpoch(d);
  assert.equal(fromRippleEpoch(r), Math.floor(d.getTime() / 1000));
});

// a comfortable plan is valid
t("generous params are valid", () => {
  const p = planNavFacility({ t0: 800000000, subscriptionMinutes: 2, investmentMinutes: 10, loanPayments: 1, facilityMinutes: 4, graceMinutes: 1, tranches: 1 });
  assert.equal(p.valid, true, JSON.stringify(p.violations));
});

// a too-short investment window violates R4 (escrow outlives redemption)
t("tight window reports R4 violation, not a bare boolean", () => {
  const p = planNavFacility({ t0: 800000000, subscriptionMinutes: 2, investmentMinutes: 3.1, loanPayments: 1, facilityMinutes: 5, graceMinutes: 2, tranches: 1 });
  assert.equal(p.valid, false);
  const r4 = p.violations.find((v) => v.rule === "R4");
  assert.ok(r4, "R4 should be present");
  assert.ok(r4.expected.includes("cancelAfter"));
  assert.ok(typeof r4.humanMessage === "string" && r4.humanMessage.length > 10);
});

// tranches = 1 is the degenerate case of the same code
t("tranches=1 yields exactly one escrow tranche, fraction 1", () => {
  const p = planNavFacility({ tranches: 1 });
  assert.equal(p.escrow.tranches.length, 1);
  assert.equal(p.escrow.tranches[0].shareFraction, 1);
});

// tranches = 3 -> 3 tranches, fractions sum to 1, cancelAfter strictly increasing
t("tranches=3 partitions the escrow correctly", () => {
  const p = planNavFacility({ investmentMinutes: 10, facilityMinutes: 6, tranches: 3 });
  assert.equal(p.escrow.tranches.length, 3);
  const sum = p.escrow.tranches.reduce((s, t) => s + t.shareFraction, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  for (let i = 1; i < 3; i++)
    assert.ok(p.escrow.tranches[i].cancelAfter > p.escrow.tranches[i - 1].cancelAfter);
});

// seizure window is [paymentDate, cancelAfter]
t("each tranche exposes a seizure window", () => {
  const p = planNavFacility({ tranches: 2, facilityMinutes: 6 });
  p.escrow.tranches.forEach((tr, i) => {
    assert.equal(tr.seizureWindow[0], p.facility.paymentDates[i]);
    assert.equal(tr.seizureWindow[1], tr.cancelAfter);
    assert.ok(tr.seizureWindow[1] > tr.seizureWindow[0]);
  });
});

// humanTimeline is sorted and non-empty
t("humanTimeline is sorted by minute", () => {
  const p = planNavFacility({ tranches: 2 });
  const mins = p.humanTimeline.map((r) => r.minute);
  assert.deepEqual(mins, [...mins].sort((a, b) => a - b));
  assert.ok(p.humanTimeline.length > 4);
});

console.log(`\n${n} tests passed.`);
