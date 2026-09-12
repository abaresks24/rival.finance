# RIVAL — Developer Experience Report
### NAV facility on XRPL closed-ended vaults · Rival-finance

**Stack under test:** public XRPL **Devnet**, **rippled 3.4.0-rc5**, **xrpl.js 5.2.0-beta.0**, Node 20.
**Amendments (all enabled):** LendingProtocol, SingleAssetVault, TokenEscrow, fixTokenEscrowV1, MPTokensV1, PermissionedDomains, Credentials. (`Batch` absent — see F-001.)

---

## 1. What we built, and why it stresses the protocol

A **NAV facility**: a lender locked inside a closed-ended vault during its investment phase
**pledges its vault shares** and **borrows against them** from a second closed-ended vault.
It exercises three primitives *together* and at their seams — exactly where friction lives:

- **XLS-65 single-asset vaults** — two closed-ended vaults, phase-gated, transferable shares.
- **XLS-66 lending** — a real loan that lifts the credit vault's PPS, and the NAV facility itself.
- **XLS-85 token escrow** — vault **shares** escrowed as collateral, with a preimage condition.

Everything is composed from **native transactions, no smart contracts.** The full cycle runs
end-to-end on Devnet from a single command (`scripts/lifecycle.mjs`), in both the **repay**
and **default** branches. This report is the primary deliverable; every claim below was
observed on-chain and logged in `friction.md` at the moment it happened.

## 2. Go / No-Go on the core thesis: **GO**

Native pledging works. Proven in Phase 0 (`PHASE0_REPORT.md`) and exercised live:

- Vault shares of a **public, closed** vault carry `lsfMPTCanEscrow | lsfMPTCanTrade | lsfMPTCanTransfer` (Flags = 56), exactly as XLS-65 predicts.
- `EscrowCreate` by the (non-issuer) lender **locks** shares on its holding; `EscrowCancel` **returns** them; `EscrowFinish` **seizes** them for the creditor.
- The abandon plan (multisig custody) was **not needed**.

**Resulting architecture.** Collateral = a native **share escrow**, source = LP, destination =
`GERANT_NAV` (a creditor account, *not* a vault — a vault pseudo-account cannot submit
`EscrowFinish`). Condition = PREIMAGE-SHA-256 held by the creditor. Repay ⇒ no reveal ⇒
`EscrowCancel`. Default ⇒ reveal ⇒ `EscrowFinish`. The four scheduling inequalities are
enforced by a reusable planner (`lib/scheduler.mjs`, §5).

## 3. Top developer-experience findings

Nine entries in `friction.md`. The four that cost real time or would silently break a build:

### F-007 — `signLoanSetByCounterparty` signs with the wrong prefix · **BLOCKING** · client library
The official helper for co-signing a `LoanSet` produces a signature rippled rejects with
`Counterparty: Invalid signature`, in **all four** combinations (either party first × flat/multisign).
Root cause: `ripple-binary-codec` (same release) ships **dedicated counterparty prefixes**
`counterpartyTransactionSig = 0x43505400` / `...MultiSig = 0x43504D00` (commented
`fixCleanup3_4_0`) exposed as `encodeForSigningCounterparty`, but the wallet helper still signs
with the ordinary first-party prefix. Codec and wallet are out of sync in the beta.
**Fix (validated on-chain), now in `lib/loan.mjs`:**
```js
import { encodeForSigningCounterparty } from 'ripple-binary-codec';
import { sign } from 'ripple-keypairs';
const s = decode(firstPartySignedBlob);
s.CounterpartySignature = { SigningPubKey: cp.publicKey,
  TxnSignature: sign(encodeForSigningCounterparty(s), cp.privateKey) };
submit(encode(s));
```
Without this, **no XLS-66 loan can be originated** from JS. This single fix unblocks the entire product.

### F-008 — `GracePeriod` on `LoanSet`: accepted locally, `temINVALID` at the node · **major**
`validateLoanSet` (xrpl.js) only checks `GracePeriod <= PaymentInterval` and lets it through;
rippled 3.4.0-rc5 rejects **any** `LoanSet` carrying `GracePeriod` as `temINVALID`. Bisected:
identical loan minus `GracePeriod` → well-formed; `InterestRate` alone → fine; `GracePeriod`
alone → `temINVALID`. A field that passes client validation then dies at the node is the worst
foot-gun class. Fix: align `validateLoanSet` with rippled (reject/drop it, or document that
grace lives on `LoanBrokerSet`).

### F-004 — a creditor cannot resolve `ShareMPTID → Vault` · **major** · missing primitive
The whole point of a NAV facility is that a third-party creditor values the collateral. Given
only the pledged `ShareMPTID`, that is **impossible** on-chain: the MPTID yields the issuer
(the vault pseudo-account), whose directory holds only the `MPTokenIssuance`; the `Vault`
object lives in the **owner's** directory, which no accessible field links back to. And
`account_objects(type:"vault")` returns **0** even on the owner that holds a Vault — the type
filter is broken. Consequence: the VaultID must travel out-of-band (we put it in the loan's
`Data` field). Fixes: (a) make `account_objects` recognise `type:"vault"`; (b) add a `VaultID`
backref on the shares `MPTokenIssuance`, or a `vault_info` lookup by `ShareMPTID`.

### F-002 — `EscrowFinish` auto-provisions the recipient's MPToken holding · minor (favourable) · docs
XLS-85 (as relayed) says recipient authorization is required at settlement and cannot be
granted during `EscrowFinish`. In practice, on a **public** (no `RequireAuth`) vault, the finish
**succeeds and creates the creditor's holding implicitly** — simpler than expected. The
constraint likely only applies to `RequireAuth` issuances; the spec should document both cases.

### Error-code legibility — a genuinely good story (F-003, F-006, F-009)
Phase gates return **actionable** codes, no generic `temINVALID_FLAG`:

| Attempt | Phase | Code |
|---|---|---|
| Deposit above `AssetsMaximum` | Subscription | `tecLIMIT_EXCEEDED` |
| Deposit after subscription closed | Investment | `tecEXPIRED` |
| Withdraw before redemption | Investment | `tecTOO_SOON` |
| Loan origination outside investment | Subscription | `tecTOO_SOON` |
| Loan schedule ending too near `RedemptionDate` | Investment | `tecNO_PERMISSION` |

The `tecEXPIRED`/`tecTOO_SOON` pair cleanly brackets the investment phase. The one wrinkle:
`tecNO_PERMISSION` for a schedule-vs-redemption clash reads as an authz error, not a timing one
(F-009) — a dedicated `tecTOO_SOON`/`tecEXPIRED` would be clearer. Overall: publish the
`{phase → code}` table in the docs; it currently has to be reverse-engineered.

## 4. Client-library friction, condensed
- **F-005** — `LossUnrealized` / `AssetsAvailable` are **absent** (not `"0"`) when zero; naïve consumers get `NaN`. A typed getter defaulting to `"0"` would help.
- **Positive** — V1.1 fields (`VaultKind`, `SubscriptionDate`, `RedemptionDate`) are present in the beta TypeScript types; no raw-JSON fallback needed for `VaultCreate`.
- **Positive** — xrpl.js validates `RedemptionDate − SubscriptionDate ∈ [180, …)` client-side with a clear message.

## 5. Contribution back — a reusable NAV scheduler
`lib/scheduler.mjs` (`planNavLoop`) is a pure, drop-in function: given an investment window, a
payment interval, payment counts and a grace delay, it returns Ripple-epoch dates that
**guarantee the four NAV inequalities** and respect the protocol floors
(`Redemption − Subscription ≥ 180 s`, `PaymentInterval ≥ 60 s`, and a full-interval margin
after the last scheduled payment — the constraint behind the `tecNO_PERMISSION` in F-009). It
returns the validated checks alongside the dates, so any XLS-66 loop can reuse it. ~40 lines,
no dependencies.

## 6. How this maps to the brief
- **Developer feedback (40%)** — `friction.md` (9 timestamped entries) + this report; one blocking library bug with an on-chain-validated fix (F-007), two silent foot-guns (F-008, F-005), one missing read-path (F-004).
- **Technical execution (30%)** — two closed vaults, two brokers, two co-signed loans, a share-escrow pledge and both unwind branches, all native, one command, real tx hashes in `app/state.json`.
- **Creativity / use-case (20%)** — NAV lending (a real private-credit instrument) expressed purely in XRPL primitives.
- **Presentation (10%)** — RIVAL UI: lender, creditor, and a timeline that renders the two cycles, the escrow window and the four inequalities as the scheduler made visible.

**Residual trust to name in the pitch:** nothing stops a creditor from finishing the escrow
after the LP has repaid; the exposure is time-boxed and on-chain-visible. The missing
primitive is a ledger-state-conditioned escrow — the target of Smart Escrow (XLS-100).
