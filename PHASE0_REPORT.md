# PHASE 0 — Rapport de faisabilité · facilité NAV sur vaults XRPL

**Projet** : NAV lending sur vault closed-ended (Lending Protocol V1.1)
**Date/heure** : 2026-09-12, ~15h40 CEST
**Réseau** : XRPL Public Devnet (`network_id` 2)
**rippled** : **`3.4.0-rc5`** — postérieur à v3.0.0, donc `fixTokenEscrowV1` inclus **et activé**. On ne rapporte aucun bug déjà corrigé sur la comptabilité des escrows MPT.
**xrpl.js** : `5.2.0-beta.0`

## 1. Environnement & amendments (TEST 00)

Tous les amendments critiques sont **activés** (`enabled=true supported=true`), sauf `Batch` :

| Amendment | Statut |
|---|---|
| LendingProtocol | ✅ enabled |
| SingleAssetVault | ✅ enabled |
| TokenEscrow | ✅ enabled |
| fixTokenEscrowV1 | ✅ enabled |
| MPTokensV1 | ✅ enabled |
| PermissionedDomains | ✅ enabled |
| Credentials | ✅ enabled |
| **Batch** | ❌ inconnu du nœud → **F-001** |

Bonne surprise transverse : les champs V1.1 (`VaultKind`, `SubscriptionDate`, `RedemptionDate`) **sont présents** dans les types TypeScript de `xrpl.js@5.2.0-beta.0`. Pas besoin de JSON brut pour `VaultCreate`.

## 2. Tableau de résultats

| Test | Objet | Verdict | Preuve (tx / observation) |
|---|---|---|---|
| 00 | Env, amendments, 5 comptes financés | ✅ | rippled 3.4.0-rc5 ; 5×100 XRP |
| 01 | Flags MPT des parts (**hypothèse clé**) | ✅ **GO** | VaultCreate [`471C5B…1DE5`](https://devnet.xrpl.org/transactions/471C5B1FD8B0B3F80D3AB605289A4A9DF3EEE5F0E8CB65EAE211612015AA1DE5) · Deposit [`70FAD9…C5C4`](https://devnet.xrpl.org/transactions/70FAD9E4618495076424CDB993380CA9D8F86D60691E1D73AEFCEB052F98C5C4) |
| 02a | Escrow parts → Cancel (remboursement) | ✅ | Create [`E2B926…3D82`](https://devnet.xrpl.org/transactions/E2B9260DEA57FE8261E2C8053F4C93A9E2FF661326E8DD481ADE533DDA423D82) · Cancel [`C68632…9D24`](https://devnet.xrpl.org/transactions/C68632089E476906DF617D3867C8C34FD1F913595666CC3BFB9BA105FB1B9D24) |
| 02b | Escrow parts → Finish (saisie) | ✅ | Create [`D39067…07BC`](https://devnet.xrpl.org/transactions/D39067A474E6354986090A415537C715438A585995109FDD82E3C00BD40C07BC) · Finish [`61E949…3833`](https://devnet.xrpl.org/transactions/61E949CCF95304172AED35A880363C788238A304F28B49C016AD3EFD2EBF3833) |
| 03 | Lecture d'état externe (créancier) | ⚠️ | MPTID→Vault **cassé** (F-004) ; VaultID→valeur = 2 RPC |
| 04 | Garde-fous de phase | ✅ | VaultCreate [`AA6C00…CBEF`](https://devnet.xrpl.org/transactions/AA6C00E352AA20FE6F4AB342F122D384416D317BFC4E2F8DEC2C7A98BAAACBEF) + rejets ci-dessous |
| 05 | Batch multi-comptes | ⛔ hors scope | amendment `Batch` absent (F-001) |
| 06 | Comptabilité impairment | ⏭️ différé | à capturer dans le lifecycle Phase 1 |

### Codes de rejet observés (TEST 04)

| Tentative | Phase | Code | Lisible ? |
|---|---|---|---|
| VaultDeposit > AssetsMaximum | Subscription | `tecLIMIT_EXCEEDED` | ✅ direct |
| VaultDeposit | Investissement | `tecEXPIRED` | ✅ (souscription close, cf. F-006) |
| VaultWithdraw | Investissement | `tecTOO_SOON` | ✅ (redemption pas ouverte) |
| VaultWithdraw (créancier) avant RedemptionDate | Subscription | `tecTOO_SOON` | ✅ (TEST 02b-iv, [`CD4302…5496`](https://devnet.xrpl.org/transactions/CD4302D6CDFD7B9CE85F2EC379C307EE39CB2027391CC8145A049AAB8D245496)) |

Les deux gates `LoanSet` (Redemption + dernier paiement > RedemptionDate) nécessitent un `LoanBroker` + signature counterparty : **capturés dans le lifecycle Phase 1**.

## 3. Table de flags décodée (TEST 01)

`MPTokenIssuance.Flags` des parts d'un vault **closed-ended, public, transférable** = **56** (`0x38`) :

| Flag | Bit | Présent |
|---|---|---|
| lsfMPTLocked | 0x01 | — |
| lsfMPTCanLock | 0x02 | — |
| lsfMPTRequireAuth | 0x04 | — |
| **lsfMPTCanEscrow** | **0x08** | ✅ |
| **lsfMPTCanTrade** | **0x10** | ✅ |
| **lsfMPTCanTransfer** | **0x20** | ✅ |
| lsfMPTCanClawback | 0x40 | — |

`TransferFee = 0`. **Conforme mot pour mot à la prédiction XLS-65.** `lsfMPTCanEscrow` présent ⇒ le nantissement natif est autorisé au niveau de l'émission.

## 4. VERDICT : **GO** sur le nantissement natif

Les deux hypothèses clés sont **validées empiriquement** :

1. **Les parts sont escrow-ables** (`lsfMPTCanEscrow` posé — TEST 01).
2. **L'escrow fonctionne de bout en bout** (TEST 02) :
   - `EscrowCreate` par le LP (non-émetteur) **verrouille** les parts sur son holding (`amt` baisse, `LockedAmount` monte) sans les faire quitter le compte — confirme la clause XLS-85 « l'émetteur ne peut pas être source, un tiers oui ».
   - `EscrowCancel` après `CancelAfter` **déverrouille** intégralement → branche remboursement OK.
   - `EscrowFinish` avec `Condition`+`Fulfillment` **transfère** les parts au créancier → branche saisie OK, et **auto-provisionne le holding** du créancier (pas de `MPTokenAuthorize` préalable requis sur un vault public — cf. F-002, plus simple que prévu).

### Architecture retenue (confirme le plan du brief)

- **Gage = escrow natif MPT** des parts, source `LP`, destination `GERANT_NAV` (le créancier, pas un vault — un pseudo-compte ne peut pas soumettre d'`EscrowFinish`).
- **Condition PREIMAGE-SHA-256** générée côté créancier ; remboursement ⇒ pas de révélation ⇒ `EscrowCancel` ; défaut ⇒ révélation ⇒ `EscrowFinish`.
- **Pas besoin** du plan d'abandon « compte de garde multisig » : le nantissement natif est vert.

### Contraintes de calendrier découvertes (structurantes pour le lifecycle)

- `RedemptionDate − SubscriptionDate ≥ 180 s` (validé côté client par xrpl.js). Le lifecycle doit dimensionner ses fenêtres au-dessus de ce plancher.
- `CancelAfter(escrow) < RedemptionDate(vault crédit)` reste la 4ᵉ inégalité critique : sinon les parts sont hors du compte du LP quand la redemption ouvre.

### Réserve à corriger côté produit

- **F-004 (majeur)** : un créancier partant du seul `ShareMPTID` **ne peut pas** atteindre l'objet `Vault` (le Vault vit dans le répertoire du *propriétaire*, pas du pseudo-compte ; `account_objects type:"vault"` renvoie 0). Le **VaultID doit être transmis hors-bande** — on l'inscrira dans les termes de la facilité (champ `Data` du prêt). N'empêche pas le build, mais c'est le principal item de feedback DX.

## 5. Frictions

Voir [`friction.md`](./friction.md) — 6 entrées loggées en temps réel :
`F-001` Batch absent · `F-002` auto-provision du holding au Finish (vs XLS-85) · `F-003` `tecTOO_SOON` lisible (positif) · `F-004` MPTID→Vault non résoluble (majeur) · `F-005` `LossUnrealized` absent quand nul · `F-006` sémantique `tecEXPIRED` + validation 180 s côté client (positif).

---

**Conclusion : GO.** On construit la Phase 1 sur l'escrow natif, sans plan d'abandon. Item de feedback n°1 = F-004 (parcours de découverte créancier).
