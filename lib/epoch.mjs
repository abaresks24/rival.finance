// Ripple epoch helpers.
// Canonical implementation lives in the reusable package
// @xrpl-nav/closed-vault-schedule — re-exported here so the app never duplicates
// the Unix/Ripple conversion (the classic XRPL foot-gun). See packages/.
export {
  RIPPLE_EPOCH_OFFSET,
  toRippleEpoch,
  fromRippleEpoch,
  rippleToISO,
} from "../packages/closed-vault-schedule/index.mjs";

import { toRippleEpoch } from "../packages/closed-vault-schedule/index.mjs";

/** Current time in Ripple epoch seconds. */
export function nowRipple() {
  return toRippleEpoch(Date.now() / 1000);
}

/** Ripple epoch seconds N minutes from now. */
export function rippleInMinutes(minutes) {
  return nowRipple() + Math.round(minutes * 60);
}
