# ReduitTreasuries — Architecture

## What the app does

ReduitTreasuries is a **governed corporate-treasury operating layer on the XRPL** for a
fictional corporate group of four entities:

| Entity | Country | Role |
|--------|---------|------|
| ReduitTreasuries Group AG | CH | Headquarters (HQ) |
| ReduitTreasuries Brasil Ltda | BR | Subsidiary |
| ReduitTreasuries Deutschland GmbH | DE | Subsidiary |
| ReduitTreasuries Singapore Pte | SG | Subsidiary |

The app demonstrates how a corporate group solves the following with the XRPL:

- Move money between entities (intercompany funding)
- A liquidity overview across all entities
- Autonomous transfers driven by an AI agent
- Pooling idle liquidity in a vault
- Internal credit lines between entities

---

## The `submit()` seam — LIVE vs SIM

Every chain action runs through a **single seam**: `apps/backend/src/xrpl/submit.ts`.
Depending on `(network, method)` it calls either the **SimAdapter** or the **LiveAdapter** —
both return the same `SubmitResult` shape. LIVE ↔ SIM is therefore a flag flip per method,
never a rebuild and never a global switch (resolved in `config.ts → resolveMode()`).

```
Frontend (React)  ──/api proxy──▶  Express routes
                                      │
                                      ▼
                              Policy Engine  ──▶  Audit Trail (SQLite)
                                      │
                                      ▼
                                  submit() seam
                                   ╱        ╲
                            simAdapter    liveAdapter
                            (fallback)    (xrpl.js)
```

---

## Protocols and where they run

### XRPL Testnet — payments

**Network:** `wss://s.altnet.rippletest.net:51233`

| Feature | Protocol | Status | Description |
|---------|----------|--------|-------------|
| Intercompany payment | XRPL `Payment` | LIVE | HQ transfers to a subsidiary |
| Agent sweep | XRPL `Payment` | LIVE | Autonomous agent transfers using its own regular key |
| SetRegularKey | XRPL `SetRegularKey` | LIVE | Binds the agent key to the HQ account (during setup) |

**Why XRP instead of RLUSD by default?**
RLUSD needs trust lines between wallets. Freshly created Testnet wallets have none, so the
app automatically falls back to XRP. For real RLUSD, fund the HQ wallet address with RLUSD
at [tryrlusd.com](https://tryrlusd.com) before running the on-chain proof.

### XRPL Devnet — XLS-65 vault & XLS-66 lending (live)

**Network:** `wss://s.devnet.rippletest.net:51233`

| Feature | Protocol | Status | Notes |
|---------|----------|--------|-------|
| Vault create / deposit / withdraw | **XLS-65** (`VaultCreate`, `VaultDeposit`, `VaultWithdraw`) | LIVE on Devnet | Real transactions via xrpl.js; XRP + mock-RLUSD vaults provisioned |
| Credit lines | **XLS-66** (`LoanBrokerSet`, `LoanSet`, `LoanPay`, `LoanManage`) | LIVE on Devnet | Native xrpl.js v4.6 tx types; LoanSet uses dual signing |

These are **real on-chain Devnet transactions** (see `apps/backend/src/services/vaultService.ts`
and `apps/backend/src/xrpl/loanOps.ts`). They fall back to the SimAdapter only when
`DEVNET_LIVE` is unset or `FORCE_SIM=true` (e.g. offline, CI, or a restricted network).

### Why XLS-65 / XLS-66 are Devnet-only

XLS-65 (Single Asset Vault) and XLS-66 (Lending Protocol) are XRPL amendments that are only
enabled on Devnet. Testnet and Mainnet do not yet support these transaction types.

> **xrpl.js v4.6** (used here) has native support for the vault and lending transactions. The
> only ledger that accepts them today is Devnet.

See [`XLS65-DEVNET-INTEGRATION.md`](XLS65-DEVNET-INTEGRATION.md) for the provisioning details,
env vars, and the proven Devnet transaction results.

---

## Overview — what runs where

```
┌─────────────────────────────────────────────────────────┐
│                    XRPL TESTNET                          │
│  LIVE  Intercompany payments (HQ → subsidiary)          │
│  LIVE  Agent sweep (signed by the agent regular key)    │
│  LIVE  SetRegularKey (agent setup)                      │
│  Asset: XRP (RLUSD needs trust lines first)             │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    XRPL DEVNET                           │
│  LIVE  XLS-65 vault (VaultCreate/Deposit/Withdraw)      │
│  LIVE  XLS-66 credit lines (LoanBrokerSet/LoanSet/...)  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    INTERNAL (no ledger)                  │
│  SIM   Investment allocator                             │
│  AI analysis (Groq / Anthropic, rule-based fallback)    │
│  Forecast, radar, advisor (rules + AI)                  │
└─────────────────────────────────────────────────────────┘
```

---

## AI components

| Component | Where | What it does |
|-----------|-------|--------------|
| Treasury Advisor | "Agent Insights" tab | Answers 4 questions → ranked, executable options (fund/sweep/invest/credit_line/hold) |
| Investment Allocator | "Allocator" tab | Asks for horizon/risk, proposes investments above a hard liquidity floor |
| Liquidity Analyzer | Backend `/analyzer` | AI narrative over the group position + redistribution suggestions |
| Agent layer | "Agent Insights" tab | Autonomous sweep, forecast, credit radar |

Every AI feature degrades to a **deterministic rule-based path** when no API key is set, so
the app always works. Default provider: **Groq** (free, OpenAI-compatible,
`llama-3.3-70b-versatile`). Switch to **Anthropic** (`claude-opus-4-8`) or any
OpenAI-compatible endpoint purely via `.env` — no code change. See the
[README](../README.md#real-ai-optional) for configuration.

---

## Technical stack

```
Frontend:  React + Vite + Tailwind CSS        → port 5173
Backend:   Express + SQLite (node:sqlite)     → port 3001
XRPL:      xrpl.js v4.6
AI:        Groq (OpenAI-compatible) or Anthropic, rule-based fallback
```

Money is always represented as a **decimal string**, never a JS `number` (see
`packages/shared/src/money.ts`). Pure money/vault/credit math lives in `apps/backend/src/lib/`
so it can be unit-tested in isolation.

---
