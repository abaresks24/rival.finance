# @xrpl-nav/closed-vault-schedule

Immutable-date arithmetic for **closed-ended XRPL vault loops** (XLS-65 / 66 / 85).
Pure function, **zero network, zero dependencies**. Everything in Ripple epoch.

Anyone building on a closed-ended Single-Asset Vault hits the same problem: the
`SubscriptionDate` / `RedemptionDate` are immutable, the loan and escrow dates must
nest inside them, and nothing in the protocol helps you get it right. Get one date
wrong and you must recreate the vaults. This package computes the dates and **checks
the four invariants**, so you size the loop once, before creating anything.

## Install

```bash
npm i @xrpl-nav/closed-vault-schedule   # or copy index.mjs — it's dependency-free
```

## Epoch helpers — use these everywhere

```js
import { toRippleEpoch, fromRippleEpoch, RIPPLE_EPOCH_OFFSET } from "@xrpl-nav/closed-vault-schedule";
// RIPPLE_EPOCH_OFFSET === 946684800. Never hand-roll this conversion — the
// Unix/Ripple mix-up is THE classic XRPL bug and it costs hours.
```

## API

```js
planNavFacility({
  t0,                  // Ripple epoch seconds or a Date
  subscriptionMinutes,
  investmentMinutes,
  loanPayments,        // installments of the real loan
  facilityMinutes,     // NAV-facility tenor
  graceMinutes,
  tranches = 1,        // escrow partitioning
}) → {
  vaultCredit:  { subscriptionDate, redemptionDate },
  vaultFunding: { subscriptionDate, redemptionDate },
  loan:         { paymentDates[], finalPaymentDate, paymentInterval },
  facility:     { paymentDates[], maturityDate, paymentInterval },
  escrow:       { tranches: [{ index, shareFraction, cancelAfter, seizureWindow }], lastTranche },
  valid:        boolean,
  violations:   [{ rule, expected, actual, humanMessage }],
  humanTimeline: [{ minute, actor, action, txType }],
}
```

It **computes from your parameters and reports violations** — it does not silently
"fix" bad inputs. Tweak params until `valid` is `true`.

## The four invariants (named, never a bare boolean)

```
R1  loan.finalPaymentDate          <  vaultCredit.redemptionDate
R2  facility.maturityDate          <  vaultFunding.redemptionDate
R3  facility.maturityDate          <  escrow.lastTranche.cancelAfter
R4  escrow.lastTranche.cancelAfter <  vaultCredit.redemptionDate
```

**R4 is the subtle one.** If an escrow still lives when redemption opens, the pledged
shares are *outside* the lender's account and nobody can withdraw. Every violation
returns `rule`, `expected`, `actual` and a human message — the caller learns *which*
constraint broke and by how much.

## Tranches, and their trade-off

For `tranches > 1`, one escrow tranche is generated per facility payment:

```
cancelAfter[i]   = facility.paymentDates[i] + graceMinutes
seizureWindow[i] = [ facility.paymentDates[i], cancelAfter[i] ]
```

**`CancelAfter` is purely temporal.** A tranche releases at its date *even if the
matching payment was missed*. The creditor must therefore seize inside
`seizureWindow[i]` or forfeit that tranche's claim. This is a trade-off, not a free
win: tranches reduce over-seizure risk for the borrower and add a **liveness
requirement** for the creditor. `tranches = 1` is the degenerate case of the same
code — no separate path.

## CLI

```
$ node cli.mjs --investment 35 --facility 24 --grace 6 --tranches 3
=== closed-vault-schedule ===
  credit subscriptionDate     800000120  2025-05-08T06:15:20.000Z
  credit redemptionDate       800002220  2025-05-08T06:50:20.000Z
  loan finalPaymentDate       800001620  2025-05-08T06:40:20.000Z
  facility maturityDate       800001590  2025-05-08T06:39:50.000Z
  escrow tranche 0 cancelAfter  800000990  2025-05-08T06:29:50.000Z
  escrow tranche 1 cancelAfter  800001470  2025-05-08T06:37:50.000Z
  escrow tranche 2 cancelAfter  800001950  2025-05-08T06:45:50.000Z

=== invariants ===
  ✓ R1 ok   ✓ R2 ok   ✓ R3 ok   ✓ R4 ok   ✓ FLOOR_WINDOW ok
  valid: true
```

(The `humanTimeline` also prints — it drives the UI timeline view, the README, and
`scripts/lifecycle.mjs`, which iterates over it instead of hard-coding the sequence.)

## Tests

`node test.mjs` — 8 passing: epoch round-trip, valid plan, R4 violation surfacing,
`tranches=1` degeneracy, `tranches=3` partition (fractions sum to 1, cancelAfters
strictly increasing), seizure windows, sorted timeline.

## Verified against

- **rippled 3.4.0-rc5** on the public XRPL Devnet (network_id 2)
- Protocol floors baked in: `RedemptionDate − SubscriptionDate ≥ 180 s`,
  `PaymentInterval ≥ 60 s` — both observed empirically (xrpl.js validates the first
  client-side; the second is a `LoanSet` validator constant).
- Used in production by `scripts/lifecycle.mjs`, which ran both the repay and default
  branches end-to-end on Devnet (all transactions `tesSUCCESS`).

MIT.
