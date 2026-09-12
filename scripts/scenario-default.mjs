// Default scenario: LP does not repay the facility; creditor seizes the pledge.
// Run: node scripts/scenario-default.mjs   (forces --scenario default)
if (!process.argv.includes("--scenario")) process.argv.push("--scenario", "default");
import("./lifecycle.mjs");
