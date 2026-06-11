# TreasuryMind

Corporate treasury management is broken. Moving $380k from Zurich to São Paulo takes 1–3 business days and costs ~$950 in bank fees and FX spread. TreasuryMind does it in 4 seconds for a fraction of a cent, settled on XRPL as a real RLUSD token payment.

Built for the Ripple "Future of Finance on XRPL" hackathon.

---

## What it does

The dashboard monitors RLUSD balances across three subsidiaries (Zurich, Brazil, Singapore) and a corporate vault. When one entity drops below its minimum threshold, an AI agent kicks in and proposes two options: pull from a surplus entity via direct transfer, or draw a short-term credit line from the vault.

A human approves it. XRPL executes it. The audit trail proves it.

The AI only recommends — it can't move money on its own. Every action goes through a deterministic policy engine (amount caps, approval tiers, whitelist checks) before anything touches the ledger. That separation is intentional: a regulator doesn't care what the AI said, they care what the rules say.

---

## Tech

- **Backend**: FastAPI + Python, running on XRPL Devnet via `xrpl-py`
- **Frontend**: Next.js 14, TypeScript
- **AI**: Groq (`llama-3.3-70b-versatile`) — free tier, no credit card. Falls back to a rule-based engine if there's no API key
- **On-chain**: Real RLUSD IOU issuance at startup, XLS-65 vault for the credit facility, XLS-85 TokenEscrow for repayments

The corporate vault is a real `VaultCreate` object on Devnet. Credit line repayments go through an actual three-step escrow lifecycle. The transfers move the full RLUSD amount as validated token payments — not placeholders or simulations.

---

## Getting started

You need Python 3.11+ and Node 18+. A Groq API key is free at [console.groq.com](https://console.groq.com) — without it the app still runs, just with the rule-based fallback instead of AI.

```bash
# 1. set up the env file
copy backend\.env.example backend\.env
# open backend\.env and paste your GROQ_API_KEY

# 2. start everything (Windows)
.\start.ps1
```

The script waits for the backend to be ready before opening the frontend. First start takes 20–30 seconds because it has to fund wallets from the Devnet faucet and set up trustlines.

**Manual start (any OS):**

```bash
# terminal 1
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# terminal 2
cd frontend
npm install
npm run dev
```

Dashboard: http://localhost:3000  
API docs: http://localhost:8000/docs

---

## Running the demo

1. Corp. Brazil shows a $380k deficit on the home screen
2. Click **Analyze** — the AI explains the problem and proposes two options
3. Pick one and approve — the policy engine runs 9 checks
4. You get a TX hash with a working XRPL explorer link
5. Go to the Vault tab and repay the credit line — the escrow lifecycle runs on-chain

If you're on a corporate or university network, the XRPL websocket port (51233) is probably blocked. Use a hotspot for the on-chain path. The app still works without it — settlements fall back to simulated and the health endpoint tells you which mode you're in.

---

## Deploying

Backend to [Render](https://render.com) (free tier), frontend to Vercel. There's a `render.yaml` in the repo. Set `GROQ_API_KEY` as an environment variable on Render, and set `BACKEND_URL` pointing at your Render URL on Vercel.

The backend takes ~2 minutes on first boot to provision the token economy. On the free Render tier it sleeps after 15 minutes idle — ping `/api/health` before the demo to wake it up.

---

## Project structure

```
backend/
  main.py              API routes and startup lifecycle
  agent.py             Groq AI analysis + rule-based fallback
  policy_engine.py     9 deterministic compliance checks
  risk_engine.py       Counterparty risk scoring
  xrpl_service.py      Everything on-chain (RLUSD, vault, escrow)
  audit_service.py     Persisted JSON audit trail

frontend/src/
  app/page.tsx         The whole dashboard (tabs, wizard, state)
  lib/api.ts           Typed API client
  components/          Header, network graph
```

---

## Notes

The XLS-66 lending terms (interest rate, term length, rate multiplier for high-risk borrowers) are tracked at the app layer. The actual funding of each credit line goes through the on-chain vault. When the XLS-66 amendment ships on mainnet, migrating to native lending objects would be a backend change, not a redesign.

To get to mainnet: swap the issuer wallet address for the official RLUSD issuer, replace faucet wallets with proper key management, move the JSON audit store to Postgres. The policy engine stays exactly as-is.
