# TreasuryMind

**An AI treasury agent that detects liquidity gaps across a multinational's subsidiaries and settles the fix on XRPL in seconds — RLUSD token payments, an XLS-65 vault for internal credit, and escrowed repayments, all guarded by a deterministic policy engine.**

Built for the Ripple "Future of Finance on XRPL" challenge · Tracks: **AI agents for finance** + **credit & lending** + **cross-border payments**

<!-- TODO: add dashboard screenshot/GIF here -->

**Contents:** [Problem](#the-problem) · [How it works](#what-treasurymind-does) · [Tech stack](#tech-stack) · [Architecture deep dive](#architecture-deep-dive) · [On-chain reality](#what-runs-on-chain-honest-version) · [API](#api-reference) · [Getting started](#getting-started) · [Deployment](#deployment-vercel--render) · [Demo flow](#demo-flow-3-minutes) · [Mainnet path](#path-to-mainnet)

---

## The problem

A corporate treasury moving money between its own subsidiaries today:

| | Traditional wire | XRPL (this project) |
|---|---|---|
| Settlement time | 1–3 business days | **3–5 seconds** |
| Cost per transfer | $25–45 + ~0.25% FX spread | **~$0.0001** |
| Visibility | Opaque correspondent chain | **Public ledger, verifiable hash** |
| Idle liquidity | Trapped per-entity buffers | **Pooled in an on-chain vault, earning yield** |

On a single $380,000 intercompany transfer, the bank route costs ~$950 and a day or more. Multiply by hundreds of transfers a year across dozens of entities, and slow plumbing becomes a CFO-level problem.

## What TreasuryMind does

> **AI recommends. Policy validates. Human approves. XRPL executes. Audit proves.**

1. **Detect** — subsidiary balances are monitored against per-entity thresholds; a deficit (e.g. Corp. Brazil $380K short) raises an alert.
2. **Analyze** — a Claude-powered agent evaluates the network and proposes exactly two resolution options: a direct transfer from a surplus entity, or a credit line drawn from the corporate vault — each with reasoning, confidence, pros/cons.
3. **Validate** — a **deterministic policy engine** (9 rule-based checks: amount limits, approval tiers, risk ceilings, whitelists) validates the action. No AI in the compliance path — that's what makes it auditable and regulator-friendly.
4. **Approve** — a human signs off in the dashboard (amounts below the auto-approve threshold could skip this).
5. **Execute** — the full amount settles on **XRPL Devnet as a validated RLUSD token payment**, vault credits via **XLS-65 VaultWithdraw**, repayments through **XLS-85 TokenEscrow**.
6. **Prove** — every action lands in a persistent audit trail with policy snapshot, risk score, and an explorer link to the on-chain transaction.

## Tech stack

| Layer | Technology | Used for |
|---|---|---|
| Frontend | **Next.js 14** (App Router) + React 18 + TypeScript | Single-page dashboard, 5-step demo wizard, live tabs |
| Styling | CSS custom properties (design tokens), Space Grotesk + JetBrains Mono | WCAG-AA contrast, projector-ready type scale, `prefers-reduced-motion` |
| Backend | **FastAPI** (Python 3.11) + Uvicorn | 25+ REST endpoints, async XRPL orchestration |
| AI | **Anthropic Claude** (`claude-sonnet-4-6`) via the official SDK | Liquidity analysis → strict-JSON recommendations; deterministic rule-based fallback |
| Ledger | **XRPL Devnet** via `xrpl-py` ≥ 4.2 (websocket) | RLUSD IOU issuance & trustlines, Payments with memos, XLS-65 vault, XLS-85 escrow |
| Persistence | JSON file store (`treasury_data.json`), thread-safe, write-through | Audit log, transfers, credit lines, vault deposits — survives restarts |
| Dev/Demo | `start.ps1` launcher, `devnet_smoke_test.py` | One-command local start; one-command on-chain verification |

## Architecture deep dive

```
┌──────────────────────────┐      ┌───────────────────────────────┐      ┌─────────────────────────────┐
│  frontend (Next.js 14)   │      │  backend (FastAPI, Python)    │      │  XRPL Devnet                │
│                          │ HTTP │                               │  WS  │                             │
│  Overview wizard (5-step)│─────▶│  AI Agent (Claude)            │─────▶│  RLUSD issuer + trustlines  │
│  Vault & credit lines    │      │  Policy Engine (9 checks,     │      │  5 faucet-funded wallets    │
│  Risk / scenarios        │      │    deterministic)             │      │  XLS-65 Single Asset Vault  │
│  Audit trail + explorer  │      │  Risk Engine (0–100 score)    │      │  XLS-85 TokenEscrow         │
│  XRPL wallet view        │      │  Audit store (JSON, durable)  │      │  Payments w/ audit memos    │
└──────────────────────────┘      └───────────────────────────────┘      └─────────────────────────────┘
```

### Backend modules

| Module | Role |
|---|---|
| `main.py` | FastAPI app, all routes, startup lifecycle (state restore → wallet/token provisioning) |
| `agent.py` | Claude prompt + call. Returns strict JSON (`problem_detected`, `severity`, exactly 2 `options[]` with reasoning/confidence/pros/cons). On any API/parse error: `_fallback_recommendation()` produces the same schema rule-based and flags `ai_mode: "rule_based"` |
| `policy_engine.py` | 9 deterministic checks: amount caps, CFO/manager/auto approval tiers, minimum AI confidence, risk-score ceilings, entity whitelist, vault coverage. Also computes the risk-adjusted interest multiplier |
| `risk_engine.py` | 0–100 counterparty score per entity: country baseline + deficit severity + credit-line exposure + liquidity pressure, with human-readable reasons |
| `xrpl_service.py` | The whole on-chain layer (see below) |
| `audit_service.py` | Thread-safe write-through JSON store; every transfer, credit line, vault deposit and policy check is persisted immediately |
| `scenario_service.py` | 5 liquidity-shock scenarios (payroll run, sales inflow, multi-region event, vault pressure, full stress test) that mutate live state for demos |
| `supplier_service.py` | Experimental supplier-financing module (marked EXPERIMENTAL in the UI) |

### The on-chain layer (`xrpl_service.py`)

**Startup provisioning** (~1–2 min on first boot): fund issuer + 4 entity wallets via the Devnet faucet → set issuer flags (`Default Ripple` so entity↔entity IOU payments ripple through the issuer; `Allow Trustline Locking` for TokenEscrow) → open RLUSD trustlines (concurrent, validated) → distribute seed balances on-chain → `VaultCreate` the XLS-65 vault and capture its VaultID from transaction metadata.

**Settlement — every flow degrades gracefully (the demo can never crash):**

| Flow | Primary path | Fallback 1 | Fallback 2 |
|---|---|---|---|
| Direct transfer | RLUSD token `Payment`, full amount, validated (+1 retry) | XRP proof payment with audit memo | Simulated record |
| Vault deposit | RLUSD `Payment` → `VaultDeposit` into the vault object | token payment to vault wallet | Simulated |
| Credit line draw | **single `VaultWithdraw` with `destination` = borrower** | token payment from vault wallet | Simulated |
| Repayment | `EscrowCreate` (time-locked) → `EscrowFinish` → `VaultDeposit` | direct token repayment | Simulated |

Every settlement carries a structured memo — `TreasuryMind|audit={id}|type={type}|route={from}-{to}|amount={n}|ccy=RLUSD` — binding the ledger transaction to the audit trail. The UI labels each record honestly (`ON-CHAIN` vs `SIMULATED`).

### Frontend

One dashboard (`frontend/src/app/page.tsx`), five tabs, all fed live from the API with skeleton loading, error+retry and empty states:

- **Overview** — the 5-phase demo wizard: situation → AI analysis (animated check-run) → choose option A/B → execution progress → confirmation with TX hash + explorer link. Network graph shows deficits pulsing and the transfer route animating.
- **Vault** — live XLS-65 stats (incl. `AssetsTotal`/`AssetsAvailable` read from the ledger object), working deposit form, credit lines with repay buttons; settled repayments show their escrow lifecycle links (Lock ↗ Release ↗ Vault ↗).
- **Risk** — live risk scores with reasons, policy rules from the engine, and 5 apply-able stress scenarios.
- **Audit** — full transaction history with filters, policy decisions, FX savings, explorer links.
- **XRPL** — wallet table with app balance **and** on-chain RLUSD balance side by side (read via `account_lines`), issuer row, working explorer links.

## What runs on-chain (honest version)

| Component | Status | Detail |
|---|---|---|
| RLUSD | ✅ **On-chain** | Issued as an IOU on Devnet at startup: issuer wallet, Default Ripple, trustlines for all entities, seed distribution. Transfers move the **full amount** as validated token payments — not proxy markers. |
| XLS-65 Single Asset Vault | ✅ **On-chain** | Real `VaultCreate` at startup; deposits via `VaultDeposit`; credit lines funded by a single `VaultWithdraw` straight to the borrower. The dashboard reads `AssetsTotal`/`AssetsAvailable` live from the ledger object. |
| XLS-85 TokenEscrow | ✅ **On-chain** | Credit-line repayments settle through a three-step lifecycle: `EscrowCreate` (time-locked RLUSD) → `EscrowFinish` by the vault manager → `VaultDeposit` back into the vault. Demo time lock: 15 s (production: the loan term). |
| Payments + memos | ✅ **On-chain** | Every settlement carries a structured audit memo binding the ledger to the audit trail. |
| XLS-66 Lending terms | ⚙️ **App layer** | Interest, term and rate-multiplier logic are tracked off-chain ("XLS-66-ready"); the *funding* of each credit line is on-chain via the vault. Migrates to native Lending Protocol objects when the amendment ships. |
| RLUSD balances in UI | ✅ + ⚙️ | App-layer accounting **plus** a live on-chain column read via `account_lines` — dashboard and ledger shown side by side. |

## Why the AI is trustworthy here

The agent (Claude, `claude-sonnet-4-6`) only **recommends** — structured JSON with two options, confidence, and reasoning. It cannot move money. Every action passes the deterministic policy engine, and anything above the approval threshold requires a human click. If the AI is unreachable, a rule-based fallback produces the same option schema (`ai_mode: "rule_based"` is surfaced in the UI). This separation — probabilistic advice, deterministic enforcement — is the design banks can actually adopt.

## API reference

Interactive docs at `http://localhost:8000/docs`. The endpoints the dashboard uses:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | **Pre-demo go/no-go**: live XRPL ping, AI connectivity check, wallet funding status, capability flags (`rlusd_token_live`, `xls65_vault_onchain`, `xls85_token_escrow`) |
| `/api/balances` | GET | Subsidiary positions, vault state, network totals |
| `/api/analyze` | GET | Run the AI agent → problem + 2 options |
| `/api/approve` | POST | Risk → policy → XRPL settlement → audit (direct transfer or vault credit) |
| `/api/vault` | GET | Vault stats incl. live on-chain ledger object |
| `/api/vault/deposit` | POST | Subsidiary funds the vault (`Payment` + `VaultDeposit`) |
| `/api/credit-lines` · `/{id}/repay` · `/{id}/default` | GET/POST | Credit line lifecycle; repay settles via TokenEscrow |
| `/api/risk-scores` · `/api/policy` · `/api/scenarios` · `/api/scenario/liquidity-shock` | GET/POST | Risk, policy rules, stress scenarios |
| `/api/audit` | GET | Full transaction history with explorer links |
| `/api/wallets` | GET | All wallet addresses, app vs on-chain balances, issuer info |
| `/api/suppliers/*` | GET/POST | Experimental supplier-financing module |

## Getting started

### Prerequisites

- **Python 3.11+** · **Node 18+** · an **Anthropic API key** (the demo also runs without one — rule-based fallback)

### Quick start (Windows)

```powershell
# 1. configure the API key
copy backend\.env.example backend\.env     # then edit: ANTHROPIC_API_KEY=sk-ant-...

# 2. launch everything (auto-detects your Python, opens two terminals)
.\start.ps1
```

### Manual start (any OS)

```bash
# backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# frontend (second terminal)
cd frontend
npm install
npm run dev
```

Dashboard: http://localhost:3000 · API docs: http://localhost:8000/docs

### Environment variables (`backend/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Claude analysis (optional; rule-based fallback without it) |
| `XRPL_WS_URL` | `wss://s.devnet.rippletest.net:51233` | XRPL endpoint override |
| `XRPL_EXPLORER_BASE` | `https://devnet.xrpl.org` | Explorer links |
| `ESCROW_WINDOW_SECONDS` | `15` | Time lock for escrowed repayments |
| `FRONTEND_ORIGIN` | — | Extra CORS origin for a deployed frontend |

Frontend: `BACKEND_URL` (build-time, defaults to `http://localhost:8000`) — points the `/api/*` proxy at a deployed backend.

### Verify the on-chain layer

```bash
cd backend
python devnet_smoke_test.py
```

Runs the full chain — wallets → trustlines → RLUSD seed → vault → token payment → VaultWithdraw → escrow lifecycle — and prints explorer links plus a balance check (~3–4 min).

### Troubleshooting

- **First backend start takes 1–2 minutes** — it provisions the whole token economy on Devnet (faucet, trustlines, vault). Watch for `RLUSD token economy live on Devnet` in the log.
- **Corporate/university networks often block XRPL ports** (websocket 51233). The app still runs — settlements degrade to `SIMULATED` and the health check tells you exactly what's wrong. Use a hotspot for the on-chain demo.
- **Port 3000 busy** → Next.js auto-switches to 3001; check the terminal output.
- **`/api/health`** is the go/no-go: `checks.xrpl = "ok"` and `wallets_funded = "5/5"` → stage-ready.

## Deployment (Vercel + Render)

The repo is deploy-ready. Hosted backend = no corporate firewall = the **full on-chain path works in the cloud**.

> **Why not Supabase?** Supabase is a Postgres/auth platform — it can't run this Python/FastAPI backend, and the demo's JSON audit store doesn't need a database. Postgres (e.g. via Supabase) is the right *production* home for the audit trail — it's on the mainnet path, not needed for the hackathon.

### 1. Push to GitHub

The hackathon expects a fork of the challenge repo — push this project into it.

### 2. Backend → Render (free tier)

Option A — Blueprint: Render Dashboard → **New → Blueprint** → select the repo; [`render.yaml`](render.yaml) configures everything. Set `ANTHROPIC_API_KEY` when prompted.

Option B — manual: **New → Web Service** → repo → Root Directory `backend` → Build `pip install -r requirements.txt` → Start `uvicorn main:app --host 0.0.0.0 --port $PORT` → add env var `ANTHROPIC_API_KEY`.

Note the URL, e.g. `https://treasurymind-api.onrender.com`. First boot takes ~2 min (token provisioning); the free tier sleeps after 15 min idle — open `/api/health` a few minutes before the pitch to wake it.

### 3. Frontend → Vercel

Vercel Dashboard → **Add New → Project** → import the repo → **Root Directory: `frontend`** (Next.js auto-detected) → Environment variable: `BACKEND_URL = https://treasurymind-api.onrender.com` → Deploy.

The frontend proxies all `/api/*` calls server-side to Render — no CORS, no exposed keys.

### 4. Check

Open `https://<your-app>.vercel.app`, then `https://<render-url>/api/health` → `rlusd_token_live: true` means the cloud demo settles real on-chain RLUSD.

## Demo flow (3 minutes)

1. Dashboard loads — Corp. Brazil is flagged **$380K below threshold**, deficit pulsing on the network graph.
2. **Analyze with AI** → the agent walks through the network and proposes Option A (direct transfer Zurich → Brazil) and Option B (vault credit line).
3. Pick an option → policy engine validates 9 checks → **execute on XRPL Devnet**.
4. Confirmation screen shows the TX hash with a working **explorer link** — the RLUSD amount is on the public ledger.
5. Audit tab: the transaction is already there, with policy decision, risk score, FX saving.
6. Vault tab: repay the credit line and watch the **escrow lifecycle settle on-chain** (lock → release → vault).

## Path to mainnet

1. **Swap the issuer address** for the official RLUSD issuer — the settlement code is identical (`Payment` with an `IssuedCurrencyAmount`); only the trust anchor changes.
2. **Custody**: replace faucet wallets with institutional key management (HSM / multisig signer lists, regular-key rotation).
3. **XLS-66**: move interest/term logic onto native Lending Protocol objects when the amendment activates; the vault funding path already matches that model.
4. **Audit store → Postgres** (e.g. Supabase/RDS) with retention policies; the write-through interface in `audit_service.py` is the seam.
5. **Policy engine unchanged** — it is deliberately boring, rule-based Python; compliance teams can read every check.

## Repository

```
backend/    FastAPI · agent.py (Claude) · policy_engine.py · risk_engine.py
            xrpl_service.py (RLUSD issuance, XLS-65 vault, XLS-85 escrow, resilience ladder)
            audit_service.py (durable JSON store) · devnet_smoke_test.py
frontend/   Next.js 14 · src/app/page.tsx (dashboard + 5-step wizard) · src/components/
            src/lib/api.ts (typed client, timeouts) · src/lib/types.ts
render.yaml Render blueprint (backend) · start.ps1  local launcher
SETUP.md    install & run · HACKATHON-TODO.md  work log
```

<!-- Team: add your names here -->
