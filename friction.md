# Journal de friction — facilité NAV sur vaults XRPL (Phase 0)

Log en temps réel. Une entrée par friction, ajoutée au moment où elle survient.

Environnement : XRPL Public Devnet · `xrpl.js@5.2.0-beta.0` · rippled = **3.4.0-rc5** (network_id 2)

---

## [F-001] `Batch` (XLS-56) absent du Devnet
- **Catégorie** : missing primitive
- **Sévérité** : mineur (n'impacte que la Vague 2 / TEST 05)
- **Librairie / version** : xrpl.js@5.2.0-beta.0 / rippled 3.4.0-rc5
- **Action tentée** : vérifier le statut de l'amendment `Batch` via la commande `feature` au TEST 00.
- **Résultat attendu** : amendment présent (activé ou au moins supporté), pour tester un swap atomique deux-parties sur la jambe de saisie.
- **Résultat obtenu** : `Batch : NOT FOUND on this server` — l'amendment n'est pas connu du nœud. Tous les autres amendments visés sont `enabled=true supported=true`.
- **Repro** : `node tests/00-env.mjs`
- **Lien tx / code** : n/a (lecture d'amendments)
- **Correctif proposé** : sans `Batch`, la jambe de saisie de l'escrow garde une hypothèse de confiance résiduelle non éliminable atomiquement. À nommer explicitement dans le pitch et à pointer comme cible de `Batch`/Smart Escrow (XLS-100). Le TEST 05 est retiré du scope Devnet (l'amendment n'y est pas déployé).


<!-- Modèle :
## [F-00X] Titre court et factuel
- **Catégorie** : client library | UX | missing primitive | documentation | other
- **Sévérité** : bloquant | majeur | mineur
- **Librairie / version** : xrpl.js@5.2.0-beta.0 / rippled <version>
- **Action tentée** :
- **Résultat attendu** :
- **Résultat obtenu** :
- **Repro** :
- **Lien tx / code** :
- **Correctif proposé** :
-->

## [F-002] `EscrowFinish` sur parts MPT auto-provisionne le holding du destinataire (contredit la note XLS-85)
- **Catégorie** : documentation
- **Sévérité** : mineur (impact favorable : simplifie la saisie)
- **Librairie / version** : xrpl.js@5.2.0-beta.0 / rippled 3.4.0-rc5
- **Action tentée** : `EscrowFinish` d'un escrow de parts MPT vers un créancier qui n'avait **jamais** fait de `MPTokenAuthorize` sur l'émission des parts.
- **Résultat attendu** (selon la note XLS-85 relayée dans le brief) : l'autorisation du destinataire est requise au règlement et **ne peut pas** être octroyée pendant l'`EscrowFinish` → on s'attendait à un rejet forçant un `MPTokenAuthorize` préalable.
- **Résultat obtenu** : `EscrowFinish` → `tesSUCCESS`, le holding MPT du créancier a été créé implicitement et crédité de 1 000 000 parts. Le `MPTokenAuthorize` tenté ensuite → `tecDUPLICATE` (le holding existe déjà). Vault public → pas de `lsfMPTRequireAuth`.
- **Repro** : `node tests/02-escrow.mjs` (branche 02b, étapes i→iii)
- **Lien tx** : finish sans auth `61E949CCF95304172AED35A880363C788238A304F28B49C016AD3EFD2EBF3833`
- **Correctif proposé** : clarifier XLS-85 : sur une émission **sans** `lsfMPTRequireAuth`, `EscrowFinish` crée et crédite le holding du destinataire sans `MPTokenAuthorize` préalable. La contrainte « autorisation non octroyable pendant le finish » ne concerne vraisemblablement que les émissions `RequireAuth`. Documenter les deux cas séparément dans la spec, et un warning côté xrpl.js serait utile.

## [F-003] Codes d'erreur de phase lisibles (note positive)
- **Catégorie** : documentation / DX (positif)
- **Sévérité** : mineur
- **Librairie / version** : rippled 3.4.0-rc5
- **Observation** : `VaultWithdraw` tenté avant la `RedemptionDate` d'un vault closed-ended renvoie `tecTOO_SOON` — code explicite qui pointe directement la contrainte temporelle de phase, sans ambiguïté. Contraste avec un `temINVALID_FLAG` générique qu'on redoutait.
- **Lien tx** : `CD4302D6CDFD7B9CE85F2EC379C307EE39CB2027391CC8145A049AAB8D245496`
- **Correctif proposé** : rien à corriger — à citer comme bon exemple de code d'erreur actionnable dans la doc des vaults closed-ended.

## [F-004] Impossible de remonter du `ShareMPTID` à l'objet `Vault` (parcours créancier cassé)
- **Catégorie** : missing primitive
- **Sévérité** : majeur
- **Librairie / version** : rippled 3.4.0-rc5 / xrpl.js@5.2.0-beta.0
- **Action tentée** : en tant que créancier tiers ne connaissant que le `ShareMPTID` des parts nanties, retrouver l'objet `Vault` pour lire `AssetsTotal`/`LossUnrealized` et valoriser le gage.
- **Résultat attendu** : un chemin de lecture MPTID → Vault (backref sur l'émission, index déterministe, ou filtre `account_objects`).
- **Résultat obtenu** : (1) le MPTID donne l'émetteur = pseudo-compte du vault, mais son répertoire ne contient QUE l'objet `MPTokenIssuance`, pas le `Vault`. (2) Le `Vault` vit dans le répertoire du **propriétaire** (GERANT_CREDIT), qui n'est déductible d'aucun champ accessible depuis le MPTID. (3) `account_objects(type:'vault')` renvoie **0** même sur le compte propriétaire qui détient pourtant un `Vault` — le filtre ne reconnaît pas le type. Résultat : le VaultID doit être transmis hors-bande.
- **Repro** : `node tests/03-state-read.mjs` (section A)
- **Correctif proposé** : (a) faire reconnaître `type: "vault"` par `account_objects` (bug de filtre à corriger en priorité) ; (b) ajouter un backref `VaultID` dans l'objet `MPTokenIssuance` des parts, ou une commande `vault_info` acceptant un `ShareMPTID`. Sans ça, tout consommateur externe (créancier, agrégateur, explorer) doit stocker le VaultID séparément.

## [F-005] `LossUnrealized` et `AssetsAvailable` absents de la réponse quand nuls
- **Catégorie** : documentation / client library
- **Sévérité** : mineur
- **Librairie / version** : rippled 3.4.0-rc5
- **Action tentée** : lire `LossUnrealized` sur un vault sans perte.
- **Résultat obtenu** : le champ est **absent** de l'objet `Vault` (pas `"0"`). Un consommateur naïf qui lit `node.LossUnrealized` obtient `undefined` et, sans garde, propage `NaN` dans le calcul de valeur nette.
- **Repro** : `node tests/03-state-read.mjs` (section B, `LossUnrealized : (absent)`)
- **Correctif proposé** : soit sérialiser explicitement `"0"`, soit documenter clairement l'absence = zéro et fournir un getter typé côté xrpl.js qui défaulte à `"0"`.

## [F-006] Sémantique de `tecEXPIRED` sur un `VaultDeposit` hors souscription
- **Catégorie** : documentation / DX
- **Sévérité** : mineur
- **Librairie / version** : rippled 3.4.0-rc5
- **Observation** : un `VaultDeposit` en phase Investissement est rejeté par `tecEXPIRED`. Le code est actionnable une fois qu'on sait que « la fenêtre de souscription a expiré », mais il se lit d'abord comme « la transaction a expiré » (confusion possible avec `LastLedgerSequence`). La paire `tecEXPIRED` (dépôt fermé) / `tecTOO_SOON` (retrait pas encore ouvert) borne proprement la phase d'investissement — c'est un bon design.
- **Point positif adjacent** : xrpl.js valide **côté client** la contrainte `RedemptionDate - SubscriptionDate ∈ [180, …)` avec un message explicite, avant toute soumission. Bonne DX.
- **Correctif proposé** : documenter dans la page Vault la table {phase → code} : `tecEXPIRED` = souscription close, `tecTOO_SOON` = redemption pas ouverte, `tecLIMIT_EXCEEDED` = AssetsMaximum atteint. Cette table manque et se reconstitue à la main.

## [F-007] `signLoanSetByCounterparty` (xrpl.js) signe avec le mauvais préfixe → `Counterparty: Invalid signature` (BLOQUANT)
- **Catégorie** : client library
- **Sévérité** : bloquant (empêche toute origination de prêt XLS-66)
- **Librairie / version** : xrpl.js@5.2.0-beta.0 / rippled 3.4.0-rc5
- **Action tentée** : co-signer un `LoanSet` par l'emprunteur via le helper officiel `signLoanSetByCounterparty(wallet, blob)` (et sa variante `{multisign:true}`).
- **Résultat attendu** : `CounterpartySignature` valide, acceptée par rippled.
- **Résultat obtenu** : rejet local systématique `fails local checks: Counterparty: Invalid signature`, dans les 4 combinaisons (prêteur/emprunteur en 1re partie × flat/multisign).
- **Cause racine** : `ripple-binary-codec` (même version) définit des **préfixes de hachage dédiés** `counterpartyTransactionSig = 0x43505400` et `counterpartyTransactionMultiSig = 0x43504D00` (commentés `fixCleanup3_4_0`), exposés via `encodeForSigningCounterparty` / `encodeForMultisigningCounterparty`. Mais le helper wallet `signLoanSetByCounterparty` signe encore avec `encodeForSigning` / `encodeForMultisigning` (préfixe `STX`/`SMT` de première partie). Désynchronisation codec ↔ wallet dans la beta.
- **Repro** : `node scripts/probe-sig.mjs` (échec) vs `node scripts/probe-sig2.mjs` (fix).
- **Correctif proposé** (validé on-chain) : signer manuellement la jambe counterparty avec le bon préfixe —
  ```js
  import { encodeForSigningCounterparty, encode, decode } from 'ripple-binary-codec';
  import { sign } from 'ripple-keypairs';
  const s = decode(firstPartySignedBlob);
  s.CounterpartySignature = { SigningPubKey: cp.publicKey, TxnSignature: sign(encodeForSigningCounterparty(s), cp.privateKey) };
  submit(encode(s));
  ```
  Corriger `signLoanSetByCounterparty` pour appeler `encodeForSigningCounterparty` / `encodeForMultisigningCounterparty`.

## [F-008] `GracePeriod` sur `LoanSet` accepté par xrpl.js mais `temINVALID` côté rippled
- **Catégorie** : client library / documentation
- **Sévérité** : majeur (foot-gun silencieux : passe la validation locale, meurt au nœud)
- **Librairie / version** : xrpl.js@5.2.0-beta.0 / rippled 3.4.0-rc5
- **Action tentée** : `LoanSet` avec `GracePeriod: 30` (et `PaymentInterval: 60`, donc `GracePeriod <= PaymentInterval`, seule contrainte vérifiée par `validateLoanSet`).
- **Résultat attendu** : prêt bien formé.
- **Résultat obtenu** : `temINVALID — The transaction is ill-formed`. Bisection : à champs égaux, retirer `GracePeriod` → `tecTOO_SOON` (bien formé) ; `InterestRate` seul → OK ; `GracePeriod` seul → `temINVALID`.
- **Repro** : `node scripts/probe-sig2.mjs` (lignes `MIN+Grace` vs `MIN+Interest`).
- **Correctif proposé** : aligner `validateLoanSet` sur rippled (rejeter/retirer `GracePeriod` si non supporté au niveau prêt, ou documenter qu'il vit sur `LoanBrokerSet`). Un `GracePeriod` accepté localement puis rejeté au nœud est le pire des deux mondes.

## [F-009] Origination de prêt impossible hors phase d'investissement (`tecTOO_SOON`)
- **Catégorie** : documentation (positif : code lisible)
- **Sévérité** : mineur
- **Observation** : un `LoanSet` bien formé soumis en phase Subscription renvoie `tecTOO_SOON` — confirme que les prêts ne peuvent naître qu'en phase Investissement d'un vault closed-ended, avec un code actionnable. À ajouter à la table {phase → code} (cf. F-006).

## [F-010] `LoanPay` : fenêtre de paiement dure (`tecEXPIRED`) aggravée par l'impossibilité de fixer `GracePeriod`
- **Catégorie** : documentation / DX
- **Sévérité** : majeur
- **Librairie / version** : rippled 3.4.0-rc5
- **Action tentée** : rembourser un `LoanPay` planifié. Le prêt expose `StartDate`, `NextPaymentDueDate = StartDate + PaymentInterval`, `GracePeriod = 0`.
- **Résultat obtenu** : un `LoanPay` soumis après `NextPaymentDueDate` renvoie `tecEXPIRED`. Comme `GracePeriod` ne peut pas être posé à l'origination (F-008 → `temINVALID`), la valeur reste 0 : la moindre dérive de quelques secondes passé l'échéance fait échouer le paiement. Il faut lire `NextPaymentDueDate` sur l'objet `Loan` et payer *avant*, avec marge.
- **Repro** : `node scripts/probe-pay.mjs` (paiement dans la fenêtre → `tesSUCCESS`) vs premiers runs de `scripts/lifecycle.mjs` (paiement une période trop tard → `tecEXPIRED`).
- **Correctif proposé** : (a) débloquer `GracePeriod` sur `LoanSet` (cf. F-008) pour absorber la latence ; (b) documenter que le remboursement doit précéder `NextPaymentDueDate` et exposer un helper qui lit l'échéance ; (c) un code distinct « late payment allowed with fee » serait plus utile qu'un `tecEXPIRED` sec.

## [F-011] `LoanSet` : `tecNO_PERMISSION` quand la fin d'échéancier est trop proche de `RedemptionDate`
- **Catégorie** : documentation
- **Sévérité** : majeur (code trompeur)
- **Librairie / version** : rippled 3.4.0-rc5
- **Action tentée** : originer un prêt bien formé en phase Investissement, mais dont `StartDate + PaymentTotal × PaymentInterval` tombe juste avant la `RedemptionDate` du vault.
- **Résultat obtenu** : `tecNO_PERMISSION`. Le code se lit comme un défaut d'autorisation alors que la cause est temporelle : rippled exige une marge (≈ une période de paiement) entre la fin de l'échéancier et la `RedemptionDate`. Reproduit dans le lifecycle avant élargissement des buffers ; corrigé dans `lib/scheduler.mjs` (marge `PaymentInterval + 40 s`).
- **Repro** : `scripts/probe-sig3.mjs` (fenêtre large → `tesSUCCESS`) vs run initial du lifecycle (fenêtre serrée → `tecNO_PERMISSION`).
- **Correctif proposé** : renvoyer un `tecTOO_SOON`/`tecEXPIRED` explicite pour ce cas, et documenter la marge requise entre l'échéancier du prêt et la `RedemptionDate` du vault closed-ended.
