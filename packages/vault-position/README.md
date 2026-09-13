# @xrpl-nav/vault-position

Value a **Single-Asset-Vault position from outside the vault** (XLS-65). Used by a
NAV creditor to price pledged collateral, and by any settlement-account signer who
must independently verify a number before signing.

**Zero production dependencies.** The xrpl client is *injected*, never imported.

## The one rule: separate fetch from compute

```
fetch.mjs    → network. returns raw state.        (client injected)
compute.mjs  → PURE. raw state → valuation.        (BigInt, unit-testable)
```

Why it matters: the calculation is testable to the base unit without a network, and
it stays independently verifiable by a third party who already holds the state —
exactly what a `REGLEMENT` (settlement) signer needs before signing a waterfall.

## Inject the client, don't import it

```js
// YES — survives any xrpl.js version (we run 5.2.0-beta.0)
export async function fetchVaultState(client, { shareMPTIssuanceID, holder, vaultID })
// NO — import { Client } from 'xrpl'   ← ties the lib to a beta, unusable by others
```

## API

```js
fetchVaultState(client, { shareMPTIssuanceID, holder, vaultID }) → {
  vaultID, assetsTotal, assetsAvailable, lossUnrealized,
  sharesTotal, assetScale, holderShares, asset,   // XRP | IOU | MPT
  _meta: { rpcCalls, ledgerIndex, fetchedAt }
}

computePosition(state, { haircutBps = 0, lossHandling = 'strict' }) → {
  pps,             // AssetsNet / sharesTotal
  grossValue, netValue, collateralValue,
  lossApplied,     // what was actually subtracted
  assumptions: [] // human-readable list of what was assumed
}
```

## `lossHandling` — not hard-coded, because the answer isn't verified yet

Does `AssetsTotal` already net `LossUnrealized`, or must you subtract it yourself?
That is **the open question of Phase-0 TEST 03/06.** Until it's settled empirically,
this package refuses to choose for you:

| value | behaviour |
|---|---|
| `already-netted` | `AssetsTotal` is taken as already net; nothing subtracted |
| `subtract` | `LossUnrealized` subtracted (verified relationship) |
| `strict` *(default)* | subtracts **and** flags the assumption as unverified |

The `assumptions` array always states, in plain English, what was assumed. Once
TEST 06 runs, change the default and record the proof (impairment tx hash) here.

> **Verification status:** we could not force a non-zero `LossUnrealized` during
> Phase 0 (the vault reported no loss and omits the field when zero — F-005), so the
> relationship is **still unverified** and the default stays `strict`. Treat
> `collateralValue` as a lower bound.

## `_meta.rpcCalls` is a deliverable

From a share `MPTokenIssuanceID` to a position value: **2 RPC** (Vault + issuance),
**3** including the holder's balance. There is **no shortcut from `ShareMPTID` to the
`Vault`** — the MPTID yields the issuer (pseudo-account) whose directory holds only
the `MPTokenIssuance`; the `Vault` lives in the *owner's* directory, unlinked, and
`account_objects(type:"vault")` returns 0. So `vaultID` must be carried out-of-band.
This is friction item **F-004**, filed as an API request (add a `VaultID` backref on
the shares issuance, or a `vault_info` lookup by `ShareMPTID`).

## Arithmetic

Base units only (drops for XRP), **`BigInt`**, never floats on amounts. Every value
is a **floor** division — conservative, and since the creditor is paid first, the
rounding leans slightly **toward the creditor**. Named here, not left implicit.
Handles `assetScale` (`Vault.Scale` for IOU vaults, 0 otherwise).

## CLI — real output (XRPL Devnet, live)

```
$ node cli.mjs --share-mpt 000000014C450AFBC2E460DCCEEED3403D284E2A8E133C9C \
    --holder rLP… --vault 3B730273…C911B1 --network devnet --haircut-bps 2000

state: { assetsTotal: "50000000", sharesTotal: "50000000", holderShares: "50000000",
         lossUnrealized: "0", asset: "XRP", _meta: { rpcCalls: 3, ledgerIndex: 5275506 } }
valuation:
  pps             : 1
  grossValue      : 50000000
  netValue        : 50000000
  collateralValue : 40000000   (haircut 20%)
assumptions:
  - lossHandling='strict': LossUnrealized subtracted, BUT the AssetsTotal↔LossUnrealized
    relationship is NOT yet empirically verified (TEST 06 pending). Lower bound.
  - haircut of 20% applied to netValue.
RPC calls (MPTID -> value): 3  (no ShareMPTID->Vault shortcut — F-004)
```

## Tests

`node test.mjs` — 9 passing: PPS=1, PPS after interest, non-zero loss (pro-rata),
the three `lossHandling` modes on one state, haircut on netValue, `sharesTotal=0`
(division-by-zero guard), null position, `uint64`-max amounts (no overflow), and the
floor-rounding bias.

## Verified against

- **rippled 3.4.0-rc5**, public XRPL Devnet (network_id 2), `xrpl.js@5.2.0-beta.0`.
- Amendments active: SingleAssetVault, MPTokensV1, LendingProtocol, TokenEscrow.
- Consumed by `lib/pricing.mjs` (thin shim) and the RIVAL creditor view.

MIT.
