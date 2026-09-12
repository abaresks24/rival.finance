<div align="center">

# RIVAL — NAV Facility on XRPL

**rival.finance**

*Finance an illiquid closed-vault position without breaking the vault.*

</div>

---

A lender locked inside a **closed-ended vault** during its investment phase **pledges its
vault shares** and **borrows against them** from a second vault. This is a **NAV facility** —
the instrument NAV lenders run against private-equity fund shares — rebuilt from native
XRPL primitives: **no smart contracts**, only vaults (XLS-65), loans (XLS-66) and share
escrows (XLS-85).

The closed vault brings discipline (no redemption run, clean asset/liability matching) at
the cost of illiquidity. The NAV facility makes the position financeable without a redemption.

## The mechanism

```
Credit vault (closed) ──deposit──▶ LP holds transferable shares (lsfMPTCanEscrow)
        │                                   │
   real loan → EMPRUNTEUR              pledge shares via EscrowCreate
   (lifts PPS, yield)                  (Condition = creditor's secret)
                                            │
Funding vault (closed) ──NAV facility──▶ LP draws XRP against the pledge
                                            │
   repay ─▶ escrow expires ─▶ EscrowCancel ─▶ shares returned ─▶ redeem
   default ─▶ reveal preimage ─▶ EscrowFinish ─▶ creditor seizes ─▶ recover
```

The pledge is a native **share escrow**: repayment ⇒ the creditor reveals nothing ⇒ the
escrow expires ⇒ `EscrowCancel` returns the shares; default ⇒ the creditor reveals the
preimage ⇒ `EscrowFinish` seizes them.

## Run it

```bash
npm install                              # xrpl@5.2.0-beta.0
node tests/00-env.mjs                     # Phase 0: env + 5 funded wallets
node scripts/lifecycle.mjs                # full repay cycle (one command, on-chain)
node scripts/lifecycle.mjs --scenario default   # seizure cycle
node app/serve.mjs                        # RIVAL UI → http://localhost:5173
```

`scripts/lifecycle.mjs` is idempotent: it funds fresh wallets, plans dates that satisfy the
four NAV inequalities (`lib/scheduler.mjs`), builds both vaults, both brokers, both loans,
the pledge and the unwind — emitting `app/state.json` at every step.

## Layout

```
lib/        epoch · client · condition · wallets · vault · loan · escrow · pricing · scheduler
scripts/    lifecycle.mjs · scenario-repay · scenario-default · probe-* (Phase 0 de-risking)
tests/      00–04 Phase 0 blocking tests
app/        RIVAL UI (Prêteur · Créancier · Chronologie) + serve.mjs
PHASE0_REPORT.md   GO/NO-GO on native pledging
friction.md        real-time developer-friction log (9 entries)
docs/REPORT.md     3-page graded report
```

## Key findings (developer feedback)

The 40%-graded deliverable is `friction.md` + `docs/REPORT.md`. Headlines:

- **F-007 (blocking)** — `xrpl.js` `signLoanSetByCounterparty` signs with the wrong prefix;
  rippled rejects every loan. Root cause + on-chain-validated fix (`encodeForSigningCounterparty`).
- **F-008 (major)** — `GracePeriod` on `LoanSet` passes client validation, dies `temINVALID` at the node.
- **F-004 (major)** — a creditor holding only a `ShareMPTID` cannot reach the `Vault` object.
- **F-002** — `EscrowFinish` auto-provisions the recipient's MPToken holding (contra XLS-85 note).

Built against **rippled 3.4.0-rc5** on public Devnet, `xrpl.js@5.2.0-beta.0`.
