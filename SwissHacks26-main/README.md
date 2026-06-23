# TreasuryMind

**A governed corporate-treasury operating layer on the XRPL.**

Built for **SwissHacks Zurich 2026** — Ripple's *"Future of Finance on XRPL: Payments,
Credit & Agent Financial Infrastructure"* challenge.

A corporate group (a Swiss HQ + subsidiaries in Brazil, Germany, and Singapore) runs its
internal liquidity on-chain: HQ funds subsidiaries instantly in RLUSD instead of waiting on
a 72-hour bank corridor, idle cash is pooled in a Single Asset Vault (XLS-65), short-term
internal credit lines (XLS-66) are extended against that pool, and a **governed, explainable
AI agent layer** forecasts, sweeps, and routes liquidity — every action gated by a policy
engine and written to an audit trail.

> The app runs **fully in simulation out of the box** (no wallets, no keys, no setup), and
> flips to **real on-chain Testnet transactions** with one command.

---

## Table of contents

- [The three challenge pillars](#the-three-challenge-pillars)
- [Quick start (Windows, double-click)](#quick-start-windows-double-click)
- [Quick start (manual / any OS)](#quick-start-manual--any-os)
- [Real AI (optional)](#real-ai-optional)
- [On-chain proof (required for the competition)](#on-chain-proof-required-for-the-competition)
- [What is LIVE vs SIMULATED](#what-is-live-vs-simulated)
- [Features](#features)
- [Architecture](#architecture)
- [Project layout](#project-layout)
- [Scripts](#scripts)
- [Configuration](#configuration)
- [Testing](#testing)
- [Hosting](#hosting)
- [Documentation](#documentation)
- [Security](#security)

---

## The three challenge pillars

ReduitTreasuries covers all three pillars of Ripple's Institutional DeFi strategy:

| Pillar | How it shows up here |
|--------|----------------------|
| **Payments & FX** | Instant intercompany funding (HQ → subsidiary and any country → any country) settled on XRPL in seconds, in RLUSD (XRP fallback). |
| **Credit & Lending** | 7-day internal working-capital credit lines modeled on **XLS-66**, sourced from a pooled **XLS-65** Single Asset Vault with HQ as the first-loss tranche. |
| **Agent Financial Infrastructure** | A governed agent layer (forecast / sweep / funding-router / credit-radar / allocator) acting under a policy engine, spending caps, and a full audit trail. The autonomous sweep is signed by a **scoped agent regular key** — a real on-chain transaction executed by an agent within institutional guardrails. |

Judging weights: Viability 40 · Technical 30 · Creativity 15 · Presentation 10 · Design 5.

---

## Quick start (Windows, double-click)

The launchers live in the **`scripts/`** folder. Requirements: Windows 10/11 with internet.
Node.js is installed automatically if missing.

1. **Double-click `scripts/START.cmd`.**
   - On the very first run it may install Node.js. If the window says *"please restart"*,
     close it and double-click `scripts/START.cmd` again.
   - It installs everything, loads the demo data, and **opens the browser** at
     <http://localhost:5173>.

That is the **complete app** — fully usable, running entirely in simulation. Click on
countries, send/request money, watch the animations, both AIs in rule-based mode, the audit
log. Nothing needs to be configured.

> To stop: close the script window. For a guided demo (install → on-chain proof → run) use
> `scripts/DEMO.cmd`.

For real on-chain transactions, see [On-chain proof](#on-chain-proof-required-for-the-competition).

---

## Quick start (manual / any OS)

Requirements: **Node.js ≥ 22.5** (uses the built-in `node:sqlite`) and **pnpm**.

```bash
cp .env.example .env      # optional — the app runs in SIM without any values
pnpm install
pnpm seed                 # reset + load the deterministic demo seed into SQLite
pnpm dev                  # backend :3001 + frontend :5173 (parallel)
```

Open <http://localhost:5173>. The frontend talks to the backend through a Vite `/api` proxy.

---

## Real AI (optional)

Without a key, both AI engines (the Treasury Advisor and the Liquidity Analyzer) run on a
deterministic **rule-based fallback** — the app is fully functional. To enable real AI
reasoning:

1. Get a free API key at **[Groq](https://console.groq.com)** → *API Keys* (starts with `gsk_…`).
2. In `.env`, set:
   ```
   AI_API_KEY=gsk_your_key_here
   ```
   (Provider and model are pre-set to Groq's `llama-3.3-70b-versatile`.)
3. Restart the app. The Advisor and Analyzer tabs now show **"Real-AI"**.

**Other providers** — no code change, just `.env`:

- Any OpenAI-compatible endpoint (xAI Grok, OpenAI, Gemini, a local server): set
  `AI_API_BASE` + `AI_MODEL`.
- **Anthropic / Claude**: set `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` (default model
  `claude-opus-4-8`).

---

## On-chain proof (required for the competition)

Driving real on-chain activity is a mandatory requirement, including *at least one on-chain
transaction executed autonomously by an agent*. One command produces it:

1. Switch to an **unblocked network** (home wifi / phone hotspot). A corporate LAN typically
   blocks the XRPL submit endpoints (WebSocket :51233 / JSON-RPC :51234) while letting only
   the faucet through.
2. *(Optional, for real RLUSD instead of XRP:* send some RLUSD to the HQ address at
   [tryrlusd.com](https://tryrlusd.com) first.)
3. **Double-click `scripts/PROVE-ONCHAIN.cmd`** (or run `pnpm prove`). It:
   - creates and funds the wallets from the free Testnet faucet,
   - binds a scoped agent regular key to HQ (`SetRegularKey`),
   - submits **two real transactions** — HQ → subsidiary `Payment` + the autonomous agent
     sweep `Payment` (signed by the agent regular key),
   - writes the validated `tesSUCCESS` hashes + explorer links to
     [`docs/ONCHAIN-PROOF.md`](docs/ONCHAIN-PROOF.md),
   - writes the wallet seeds into `.env` and sets `LIVE_TESTNET=true`.
4. **Restart the app.** Every transfer in the UI is now a real Testnet transaction with an
   explorer link.

A captured proof from a previous run lives in [`docs/ONCHAIN-PROOF.md`](docs/ONCHAIN-PROOF.md).

---

## What is LIVE vs SIMULATED

LIVE ↔ SIM is resolved **per network, per method** — never a global flip (see
`resolveMode()` in `apps/backend/src/config.ts`). Each UI panel shows its own mode badge.

| Leg | Network | Status |
|-----|---------|--------|
| HQ → subsidiary `Payment` | Testnet |  **LIVE** (with seeds + `LIVE_TESTNET=true`) |
| Autonomous agent sweep `Payment` | Testnet |  **LIVE** (agent regular key) |
| XLS-65 vault create / deposit / withdraw | Devnet |  **LIVE on Devnet** (with `DEVNET_LIVE=true`) |
| XLS-66 credit lines (LoanBroker / LoanSet / LoanPay) | Devnet |  **LIVE on Devnet** (with `DEVNET_LIVE=true`) |
| Investment allocator | internal |  SIM (no ledger primitive) |

The XLS-65 vault and XLS-66 lending flows submit **real transactions to Devnet** via xrpl.js
(see `apps/backend/src/services/vaultService.ts` and `apps/backend/src/xrpl/loanOps.ts`). They
fall back to simulation only when `DEVNET_LIVE` is unset or `FORCE_SIM=true` (offline / CI /
restricted networks). Every chain action flows through a single seam —
`apps/backend/src/xrpl/submit.ts` — which dispatches to the **SimAdapter** or the
**LiveAdapter**, both returning the same result shape. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`docs/XLS65-DEVNET-INTEGRATION.md`](docs/XLS65-DEVNET-INTEGRATION.md) for the details.

---

## Features

- **Landing** — a cinematic hero (framer-motion, count-up) into the dashboard.
- **Dashboard** — all entity liquidity positions at a glance, with sparklines and KPIs.
- **Country view** — click any country to send funds to / request funds from any other
  country, with on-chain visibility (explorer links) per transfer.
- **Funding** — request → approve → execute, ending in an RLUSD payment + a settlement toast.
- **Vault & Credit** — XLS-65 deposit/withdraw with share math; XLS-66 credit-line
  create/repay/impair with first-loss cover.
- **Agent Insights** — autonomous sweep, forecast, and credit radar, plus the **AI Treasury
  Advisor** (answer 4 questions → ranked, editable, executable options).
- **Liquidity Analyzer** — an AI narrative over the group position that proposes smart
  redistributions (cover a deficit from a surplus entity before tapping HQ).
- **Allocator** — invests vault surplus while a hard liquidity floor blocks over-allocation.
- **Audit Log** — every action with its policy decision and sim/live source.

---

## Architecture

```
Frontend (React) ──/api proxy──▶ Express routes
                                    │
                                    ▼
                            Policy Engine ──▶ Audit Trail (SQLite)
                                    │
                                    ▼
                                submit() seam
                                 ╱        ╲
                          simAdapter    liveAdapter (xrpl.js)
```

**Stack:**

- **Monorepo:** pnpm workspaces — `apps/backend`, `apps/frontend`, `packages/shared`.
- **Backend:** Node.js ≥ 22.5 + TypeScript, Express, `xrpl.js`, SQLite via the built-in
  `node:sqlite` behind a repository interface with a deterministic JSON seed.
- **Frontend:** React + Vite + TypeScript, Tailwind, framer-motion, recharts, lucide-react,
  Geist fonts.
- **Shared:** `@reduit/shared` — the type contract (`AuditEvent`, etc.) + money helpers
  (money is always a decimal **string**, never a JS `number`).
- **AI:** Groq (default, free) or Anthropic, with a deterministic rule-based fallback.
- **Tests:** Vitest (critical money/policy invariants).

Full write-up: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Project layout

```
TreasuryMind/
├── scripts/                Windows launchers
│   ├── START.cmd           One-click setup + run (SIM)
│   ├── PROVE-ONCHAIN.cmd   One-click real on-chain proof (Testnet)
│   └── DEMO.cmd            Guided demo (install → proof → run)
├── apps/
│   ├── backend/            Express API, submit() seam, policy engine, agents, SQLite repo
│   └── frontend/           React dashboard, shares @reduit/shared types
├── packages/
│   └── shared/             The contract: types (AuditEvent etc.) + money helpers
└── docs/                   Architecture, XLS-65/66 integration, setup, hosting,
                            on-chain proof, challenge brief
```

---

## Scripts

Run from the project root:

```bash
pnpm install     # install dependencies
pnpm seed        # reset + load the demo seed into SQLite
pnpm dev         # backend :3001 + frontend :5173 (parallel)
pnpm test        # critical-invariant tests (38, Vitest)
pnpm typecheck   # TypeScript across all packages
pnpm build       # build all packages
pnpm provision   # mint + fund wallets and trust lines, print the .env block (for LIVE)
pnpm prove       # the on-chain proof (= scripts/PROVE-ONCHAIN.cmd)
pnpm share       # expose :5173 publicly via localtunnel (demo sharing)
```

---

## Configuration

Copy `.env.example` to `.env`. **Every value is optional** — the app runs fully in
simulation with an empty `.env`. Key groups:

| Group | Variables | Notes |
|-------|-----------|-------|
| XRPL networks | `TESTNET_RPC_URL`, `DEVNET_RPC_URL` | Pre-filled with the public endpoints. |
| Wallet seeds (Testnet) | `HQ_WALLET_SEED`, `SUB_*_WALLET_SEED`, `VAULT_WALLET_SEED`, `AGENT_REGULAR_KEY_SEED` | Filled automatically by `pnpm provision` / `pnpm prove`. |
| Devnet (XLS-65/66) | `*_DEVNET`, `*_VAULT_ID_DEVNET` | See [`docs/XLS65-DEVNET-INTEGRATION.md`](docs/XLS65-DEVNET-INTEGRATION.md). |
| Live/Sim flags | `LIVE_TESTNET`, `DEVNET_LIVE`, `FORCE_SIM` | `FORCE_SIM=true` forces SIM everywhere (offline/CI). |
| AI | `AI_PROVIDER`, `AI_API_BASE`, `AI_API_KEY`, `AI_MODEL`, `ANTHROPIC_API_KEY` | Empty → rule-based fallback. |
| App | `BACKEND_PORT` | Defaults to 3001. |

The detailed manual setup walkthrough (RLUSD issuer, provisioning, funding HQ) is in
[`docs/MANUAL-SETUP.md`](docs/MANUAL-SETUP.md).

---

## Testing

```bash
pnpm test        # 38 tests across 7 files
pnpm typecheck   # TypeScript, no emit
```

Coverage focuses on the invariants that matter: money rounding/comparators, the policy
engine's hard liquidity floor and caps, XLS-65 share math, XLS-66 first-loss cover, and the
allocator's floor block + money flow. Pure math is isolated in `apps/backend/src/lib/` so it
can be unit-tested without the network or the database.

---

## Hosting

The whole app can run from your machine and be shared via a tunnel (`pnpm share`), or
deployed permanently:

- **Frontend → Vercel** (uses `vercel.json`): set `VITE_API_URL` to the backend URL.
- **Backend → Render** (uses `render.yaml`, Blueprint deploy): set `FRONTEND_ORIGIN` and,
  optionally, `AI_API_KEY`.

Step-by-step (tunnels + permanent deploy): [`docs/HOSTING.md`](docs/HOSTING.md).

---

## Documentation

| Doc | What's in it |
|-----|--------------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design, the submit() seam, what runs where, AI components. |
| [`docs/XLS65-DEVNET-INTEGRATION.md`](docs/XLS65-DEVNET-INTEGRATION.md) | The live XLS-65 vault + XLS-66 lending flows on Devnet (XRP + RLUSD). |
| [`docs/MANUAL-SETUP.md`](docs/MANUAL-SETUP.md) | Hands-on setup for the live path (wallets, RLUSD, provisioning). |
| [`docs/HOSTING.md`](docs/HOSTING.md) | Sharing via a tunnel and permanent Vercel + Render deploy. |
| [`docs/ONCHAIN-PROOF.md`](docs/ONCHAIN-PROOF.md) | Captured Testnet tx hashes + explorer links (generated by `pnpm prove`). |
| [`docs/PRODUCT-DESIGN.md`](docs/PRODUCT-DESIGN.md) | The original MVP product design document. |
| [`docs/challenge/RIPPLE-CHALLENGE.md`](docs/challenge/RIPPLE-CHALLENGE.md) | The full Ripple challenge brief. |

---

## Security

- `.env` holds wallet seeds and API keys — it is **gitignored**; never commit it and never
  paste seeds into chat or screenshots.
- All wallets used here are **Testnet/Devnet** — valueless test tokens, no real money.
- Rotate seeds and AI keys before any public submission. `pnpm provision` mints fresh ones.
