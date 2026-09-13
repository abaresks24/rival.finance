// @xrpl-nav/vault-position
// Value a Single-Asset-Vault position from OUTSIDE the vault.
// fetch (network, client injected) is separate from compute (pure, integer).
export { fetchVaultState } from "./fetch.mjs";
export { computePosition } from "./compute.mjs";
