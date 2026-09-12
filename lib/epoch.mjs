// Ripple epoch helpers.
// XRPL timestamps are seconds since 2000-01-01T00:00:00Z.
// Unix epoch is seconds since 1970-01-01T00:00:00Z.
// Offset between the two = 946684800 seconds.

export const RIPPLE_EPOCH_OFFSET = 946684800;

/** Unix seconds (or a Date) -> Ripple epoch seconds. */
export function toRippleEpoch(unixSecondsOrDate) {
  const unix =
    unixSecondsOrDate instanceof Date
      ? Math.floor(unixSecondsOrDate.getTime() / 1000)
      : Math.floor(unixSecondsOrDate);
  return unix - RIPPLE_EPOCH_OFFSET;
}

/** Ripple epoch seconds -> Unix seconds. */
export function fromRippleEpoch(rippleSeconds) {
  return rippleSeconds + RIPPLE_EPOCH_OFFSET;
}

/** Ripple epoch seconds -> ISO string, for readable logs. */
export function rippleToISO(rippleSeconds) {
  return new Date(fromRippleEpoch(rippleSeconds) * 1000).toISOString();
}

/** Current time in Ripple epoch seconds. */
export function nowRipple() {
  return toRippleEpoch(Date.now() / 1000);
}

/** Ripple epoch seconds N minutes from now. */
export function rippleInMinutes(minutes) {
  return nowRipple() + Math.round(minutes * 60);
}
