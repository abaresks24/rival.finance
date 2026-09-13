#!/usr/bin/env node
// node cli.mjs --investment 35 --facility 24 --grace 6 --tranches 3
import { planNavFacility, rippleToISO } from "./index.mjs";

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : def;
};

const plan = planNavFacility({
  t0: arg("t0", 800000000),
  subscriptionMinutes: arg("subscription", 2),
  investmentMinutes: arg("investment", 6),
  loanPayments: arg("loan-payments", 1),
  facilityMinutes: arg("facility", 4),
  graceMinutes: arg("grace", 1),
  tranches: arg("tranches", 1),
});

const line = (label, ripple) =>
  console.log(`  ${label.padEnd(26)} ${String(ripple).padStart(10)}  ${rippleToISO(ripple)}`);

console.log("=== closed-vault-schedule ===");
line("credit subscriptionDate", plan.vaultCredit.subscriptionDate);
line("credit redemptionDate", plan.vaultCredit.redemptionDate);
line("loan finalPaymentDate", plan.loan.finalPaymentDate);
line("facility maturityDate", plan.facility.maturityDate);
plan.escrow.tranches.forEach((t) =>
  line(`escrow tranche ${t.index} cancelAfter`, t.cancelAfter)
);

console.log("\n=== invariants ===");
const rules = ["R1", "R2", "R3", "R4", "FLOOR_WINDOW"];
for (const r of rules) {
  const v = plan.violations.find((x) => x.rule === r);
  console.log(`  ${v ? "✗" : "✓"} ${r.padEnd(13)} ${v ? "VIOLATED — " + v.humanMessage : "ok"}`);
}
console.log(`\n  valid: ${plan.valid}`);

console.log("\n=== humanTimeline ===");
for (const row of plan.humanTimeline) {
  console.log(`  +${String(row.minute).padStart(3)}m  ${row.actor.padEnd(24)} ${row.action}  [${row.txType}]`);
}
