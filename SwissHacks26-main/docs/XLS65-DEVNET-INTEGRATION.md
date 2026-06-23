# XLS-65 Devnet Integration

Devnet XRP and mock RLUSD vault flows wired into the application — live on Devnet.

---

## Project structure

```
TreasuryMind/                        ← app root (monorepo)
  .env                               ← loaded by the backend (single source of truth)
  .env.example                       ← template (no real values)
  apps/backend/
    src/
      config.ts                      ← resolveMode() — DEVNET_LIVE flag lives here
      xrpl/
        client.ts                    ← getClient('devnet') → DEVNET_RPC_URL
        wallets.ts                   ← resolveDevnetSigner() — reads *_DEVNET seeds only
        simAdapter.ts                ← fallback when resolveMode() returns 'sim'
        liveAdapter.ts               ← Payment / VaultDeposit / VaultWithdraw
        loanOps.ts                   ← XLS-66 native ops (LoanBrokerSet, LoanSet, LoanPay, ...)
        submit.ts                    ← resolveMode() seam
      services/
        vaultService.ts              ← XLS-65 XRP + RLUSD vault operations
      routes/
        vault.ts                     ← GET /vault, POST /vault/deposit|withdraw,
                                        GET /vault/live-status
        loanBroker.ts                ← POST /loan-broker/setup, GET /loan-broker/status
      scripts/
        provision.ts                 ← pnpm provision — mints + funds Testnet & Devnet wallets
        proveOnchain.ts              ← pnpm prove — the two headline Testnet transactions
```

---

## How the backend loads `.env`

`apps/backend/src/config.ts` calls:

```typescript
dotenvConfig({ path: resolve(__dirname, '../../../.env') })
```

`__dirname` resolves to `apps/backend/src/` at runtime, so `../../../` points to the
single `.env` at the **project root** (`TreasuryMind/.env`). There is one `.env` for the
whole monorepo.

---

## Provisioning Devnet wallets

`pnpm provision` (`apps/backend/src/scripts/provision.ts`) creates and funds the Testnet
**and** Devnet wallets (HQ, Vault, Broker) from the faucets and prints a ready-to-paste
`.env` block with every seed and address. Paste that block into `.env`, then set
`DEVNET_LIVE=true` and `FORCE_SIM=false` to take the vault flows live. The XLS-66 LoanBroker
object is created once via `POST /loan-broker/setup` (store the returned id as
`LOAN_BROKER_ID_DEVNET`).

---

## Environment variables

All XLS-65 vault vars live in the project-root `.env`.

| Variable | Purpose |
|---|---|
| `DEVNET_RPC_URL` | WebSocket endpoint for XRPL Devnet |
| `HQ_WALLET_SEED_DEVNET` | Signs `VaultCreate` (HQ is the vault owner) |
| `VAULT_WALLET_SEED_DEVNET` | Signs `VaultDeposit` / `VaultWithdraw` (depositor wallet) |
| `XRP_VAULT_ID_DEVNET` | LedgerIndex of the XRP vault object on Devnet |
| `VAULT_ID_DEVNET` | Legacy alias for `XRP_VAULT_ID_DEVNET` (backwards compat) |
| `RLUSD_CURRENCY_DEVNET` | 40-char hex currency code: `524C555344000000000000000000000000000000` |
| `RLUSD_ISSUER_DEVNET` | RLUSD issuer address on Devnet |
| `RLUSD_VAULT_ID_DEVNET` | LedgerIndex of the RLUSD vault object on Devnet |
| `LOAN_BROKER_ID_DEVNET` | LedgerIndex of the XLS-66 LoanBroker object on Devnet |
| `DEVNET_LIVE` | `true` → VaultCreate/Deposit/Withdraw + loan ops go to Devnet; `false` → SimAdapter |
| `FORCE_SIM` | `true` → all operations use SimAdapter (overrides DEVNET_LIVE) |

> **RLUSD currency code**: XRPL rejects plain `"RLUSD"` for non-standard (>3-char)
> currencies. Always use the 40-char uppercase hex:
> `524C555344000000000000000000000000000000`

---

## XRP vault flow

```
VaultCreate (HQ_WALLET_SEED_DEVNET)
  Asset: { currency: "XRP" }
  → creates XRP_VAULT_ID_DEVNET

VaultDeposit (VAULT_WALLET_SEED_DEVNET)
  VaultID: XRP_VAULT_ID_DEVNET
  Amount: <drops>  (e.g. xrpToDrops("10") = "10000000")

VaultWithdraw (VAULT_WALLET_SEED_DEVNET)
  VaultID: XRP_VAULT_ID_DEVNET
  Amount: <drops>  (e.g. xrpToDrops("5") = "5000000")

vault_info RPC
  vault_id: XRP_VAULT_ID_DEVNET
  → AssetsTotal, AssetsAvailable, OutstandingAmount (all in drops)
```

**Proven on Devnet:**
- VaultCreate → `tesSUCCESS`, vault `83B8BFC6…`
- VaultDeposit 10 XRP → `tesSUCCESS`, AssetsTotal=10000000
- vault_info confirmed AssetsTotal/Available
- VaultWithdraw 5 XRP → `tesSUCCESS`, AssetsTotal=5000000

---

## RLUSD vault flow

```
Setup (one-time, already done):
  1. Issuer wallet created (RLUSD_ISSUER_WALLET_SEED_DEVNET)
  2. AccountSet DefaultRipple=true on issuer
  3. TrustSet from VAULT_WALLET_SEED_DEVNET → RLUSD issuer
  4. Payment from issuer → vault wallet: 1000 RLUSD issued

VaultCreate (HQ_WALLET_SEED_DEVNET)
  Asset: { currency: "524C555344000000000000000000000000000000",
           issuer: RLUSD_ISSUER_DEVNET }
  → creates RLUSD_VAULT_ID_DEVNET

VaultDeposit (VAULT_WALLET_SEED_DEVNET)
  VaultID: RLUSD_VAULT_ID_DEVNET
  Amount: { currency: "524C555344000000000000000000000000000000",
            issuer: RLUSD_ISSUER_DEVNET,
            value: "100" }

VaultWithdraw (VAULT_WALLET_SEED_DEVNET)
  VaultID: RLUSD_VAULT_ID_DEVNET
  Amount: { currency: "524C555344000000000000000000000000000000",
            issuer: RLUSD_ISSUER_DEVNET,
            value: "50" }
```

**Proven on Devnet:**
- Issuer wallet created, DefaultRipple enabled
- TrustSet from vault wallet → RLUSD issuer: `tesSUCCESS`
- 1000 RLUSD issued to vault wallet: `tesSUCCESS`
- VaultCreate (RLUSD) → `tesSUCCESS`, vault `9096E6CF…`
- VaultDeposit 100 RLUSD → `tesSUCCESS`
- vault wallet balance after: 900 RLUSD remaining

---

## XLS-66 lending (native)

`apps/backend/src/xrpl/loanOps.ts` implements the lending protocol with first-class xrpl.js
v4.6 transaction types:

- `LoanBrokerSet` — creates the LoanBroker linked to the XRP vault (run once via
  `POST /loan-broker/setup`).
- `LoanBrokerCoverDeposit` — deposits first-loss capital.
- `LoanSet` — dual-signed: HQ (LoanBroker owner) signs first, the borrower adds a
  `CounterpartySignature` via `signLoanSetByCounterparty()`.
- `LoanPay` — borrower repays.
- `LoanManage` — HQ impairs / clears / defaults a loan.

On-chain amounts are 1 XRP (demo proof); the app tracks CHF values internally.

---

## Files

| File | Role |
|---|---|
| `apps/backend/src/config.ts` | `DEVNET_LIVE` flag; `resolveMode()` returns `'live'` for vault/loan methods on devnet when set |
| `apps/backend/src/xrpl/submit.ts` | `VaultCreate` etc. added to the `SubmitRequest.method` union |
| `apps/backend/src/xrpl/wallets.ts` | `resolveDevnetSigner(role)` — reads `*_DEVNET` seeds exclusively |
| `apps/backend/src/xrpl/loanOps.ts` | XLS-66 native operations |
| `apps/backend/src/services/vaultService.ts` | XLS-65 operations, env validation, convenience methods |
| `apps/backend/src/routes/vault.ts` | `GET /vault/live-status` — queries both vaults from Devnet |
| `.env.example` | All variable names documented (empty values) |

---

## API endpoints

| Endpoint | Description |
|---|---|
| `GET /vault` | In-memory vault position (share math) |
| `POST /vault/deposit` | Deposit into in-memory pool (also calls VaultDeposit on devnet if DEVNET_LIVE) |
| `POST /vault/withdraw` | Withdraw from in-memory pool |
| `GET /vault/live-status` | Live on-chain query for both XRP + RLUSD vault via vault_info |
| `POST /loan-broker/setup` | One-time XLS-66 LoanBroker creation on Devnet |
| `GET /loan-broker/status` | Whether the LoanBroker is configured + current mode |

`GET /vault/live-status` response shape:
```json
{
  "mode": "live",
  "xrp": {
    "vaultId": "83B8BFC6…",
    "assetsTotal": "5000000",
    "assetsAvailable": "5000000",
    "outstandingAmount": "5000000",
    "shareMPTID": "000000014575D21208EA35A09790D2D4D5A7DF5BAD76CC2F"
  },
  "rlusd": {
    "vaultId": "9096E6CF…",
    "assetsTotal": "100",
    "assetsAvailable": "100",
    "outstandingAmount": "100",
    "shareMPTID": "000000011BDEC9F8B2E3DDD92C6145B0FBDDA918F9630A86"
  }
}
```

---

## Verification commands

Run from the project root (`TreasuryMind/`):

```bash
# Start backend (loads the root .env)
pnpm dev

# Check vault live status (both XRP + RLUSD)
curl http://localhost:3001/vault/live-status

# Confirm resolveMode sees devnet as live
curl http://localhost:3001/config
```

---

## FORCE_SIM fallback

Set `FORCE_SIM=true` in `.env` to run all vault operations through SimAdapter
(deterministic fake hashes, no network calls). Useful for CI and offline dev.

---

## Known risks / security notes

1. **Seeds in `.env`**: The root `.env` contains live Devnet seeds. These are Devnet only
   (no real value), but rotate them before any public demo or submission.

2. **AI API key**: `AI_API_KEY` in `.env` is a real key. Rotate before submission.

3. **`.env` is gitignored** — never commit it; verify it never appears in staged files.

4. **RLUSD_ISSUER_WALLET_SEED_DEVNET**: This seed controls who can issue mock RLUSD.
   Do not share it. For production, RLUSD is issued by Ripple — this mock issuer is
   Devnet-only.

---

## Before final submission

- [ ] Rotate all Devnet seeds (`pnpm provision` mints fresh ones)
- [ ] Rotate AI API keys
- [ ] Confirm `.env` is not committed
- [ ] Verify `FORCE_SIM=false` and `DEVNET_LIVE=true` in `.env`
- [ ] Test `GET /vault/live-status` returns real Devnet data
- [ ] Update `XRP_VAULT_ID_DEVNET` and `RLUSD_VAULT_ID_DEVNET` if new vaults were created
