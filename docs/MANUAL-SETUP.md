# 🔧 Manual setup — what YOU do by hand

> Everything in this file needs a human (you). The rest (code, wiring) I handle.
> Work top to bottom. Each step says **what to do**, **where**, and **what to paste where**.
> XRPL Testnet/Devnet are free and need **no API key / no credit card**. There is **no paid API** in this project.

---

## ✅ Quick checklist (tick as you go)

- [ ] 0. Node ≥ 22.5 + pnpm installed
- [ ] 1. `cp .env.example .env`
- [ ] 2. Get the RLUSD **Testnet issuer address** from tryrlusd.com → paste into `.env`
- [ ] 3. Run `pnpm provision` → it creates + funds all wallets and sets RLUSD trust lines, then prints an `.env` block
- [ ] 4. Paste that printed block into `.env`
- [ ] 5. Send yourself test **RLUSD** from tryrlusd.com to the HQ address
- [ ] 6. `pnpm seed` → fills the demo data
- [ ] 7. `pnpm dev` → app runs (backend :3001, frontend :5173)
- [ ] 8. (later, before the demo) capture 2 tx hashes for the D5 proof gate

---

## 0. Tools (one-time)

1. **Node.js ≥ 22.5** — we use Node's built-in SQLite, which needs 22.5+.
   Check: open a terminal and run `node -v`. If it prints < 22.5, install the latest LTS/Current from <https://nodejs.org>.
2. **pnpm** — comes with Node via corepack. Run once:
   ```bash
   corepack enable
   corepack prepare pnpm@9.12.0 --activate
   pnpm -v   # should print 9.x
   ```
3. From the project root, install deps once: `pnpm install`

---

## 1. Create your .env

In the project root:
```bash
cp .env.example .env
```
`.env` is **gitignored** — it holds secrets (wallet seeds). Never commit it, never paste seeds into chat/screenshots.

---

## 2. Get the RLUSD Testnet issuer address

RLUSD is Ripple's stablecoin. On Testnet it is issued by a Ripple-operated test issuer, and you grab test RLUSD from a faucet.

1. Open **<https://tryrlusd.com>** in your browser.
2. The site shows the **RLUSD issuer address** for Testnet (an address starting with `r…`). Copy it.
3. Paste it into `.env`:
   ```
   RLUSD_ISSUER_TESTNET=r................................
   ```
   *(Leave the wallet seed lines empty for now — step 3 fills them.)*

> Why first? The provisioning script in step 3 needs the issuer to set the RLUSD **trust lines** on your wallets (a wallet must trust the issuer before it can hold RLUSD).

---

## 3. Provision wallets (one command)

Run:
```bash
pnpm provision
```
This script (no input needed) will, automatically:
- generate **6 Testnet wallets** — HQ, Brazil, Germany, Singapore, Vault, Agent — and fund them from the Testnet faucet;
- generate the **agent's regular key** and run `SetRegularKey` so the agent signs sweeps with a key separate from its master (institutional custody story);
- set an **RLUSD trust line** on HQ + the 3 subsidiaries (using the issuer from step 2);
- generate + fund **3 Devnet wallets** (HQ, Vault, Broker) for the XLS-65/66 vault + lending leg;
- print a ready-to-paste **`.env` block** with every seed and address at the end.

It takes ~1–2 min (faucets are rate-limited; the script waits). If a faucet hiccups, just run `pnpm provision` again.

---

## 4. Paste the printed .env block

Copy the block the script printed (between the `── paste into .env ──` markers) and paste it into your `.env`, replacing the empty seed/address lines. Save.

You should now have, filled in:
```
RLUSD_ISSUER_TESTNET=r...        # from step 2
HQ_WALLET_SEED=s...
SUB_BRZ_WALLET_SEED=s...
SUB_DEU_WALLET_SEED=s...
SUB_SGP_WALLET_SEED=s...
VAULT_WALLET_SEED=s...
AGENT_WALLET_SEED=s...
AGENT_REGULAR_KEY_SEED=s...
HQ_WALLET_SEED_DEVNET=s...
VAULT_WALLET_SEED_DEVNET=s...
BROKER_WALLET_SEED_DEVNET=s...
# plus the matching r... addresses the script prints
```

---

## 5. Fund HQ with test RLUSD

So the HQ→subsidiary payment has real RLUSD to send:
1. Back on **<https://tryrlusd.com>**, paste your **HQ Testnet address** (the `r…` the script printed for HQ).
2. Request RLUSD. It arrives in a few seconds (the trust line from step 3 lets it land).
3. (Optional) do the same for the 3 subsidiary addresses if you want them to start with a balance.

> Check it worked: open `https://testnet.xrpl.org/accounts/<HQ address>` and you should see an RLUSD balance + a trust line.

---

## 6. Seed + run

```bash
pnpm seed      # loads the demo entities/flows into SQLite (HQ-CH, Brazil, Germany, Singapore)
pnpm dev       # backend on :3001, frontend on :5173 — open http://localhost:5173
```

---

## 6b. (Optional) Real-AI advisor

The **Agent Insights** tab has an "AI Treasury Advisor": you answer a few questions and Claude proposes ranked, executable actions. It's optional — **without a key it falls back to a rule-based plan and the app still works fully.**

To enable real-AI advice:
1. Get an API key at **<https://console.anthropic.com>** → API Keys.
2. Put it in `.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
3. Restart `pnpm dev`. (Default model is `claude-opus-4-8`; override with `CLAUDE_MODEL=` if you want.)

> Note: this calls the paid Anthropic API (a few cents per advice request). Leave the key empty to stay on the free rule-based advisor.

---

## 7. (Before the demo) the D5 on-chain proof gate

Two real Testnet transactions must exist and be validated before any slide claims 🟢 LIVE:
- **(a)** HQ→subsidiary RLUSD `Payment`
- **(b)** the agent autonomous sweep `Payment` (signed by the agent's regular key)

Just run `pnpm prove` (or `scripts/PROVE-ONCHAIN.cmd`): it executes both flows on XRPL Testnet, confirms each `tesSUCCESS`, and writes the validated tx hashes + explorer links to [`../ONCHAIN-PROOF.md`](../ONCHAIN-PROOF.md). Use that file as the proof board.

---

## ❓ FAQ

- **Do I need an API key anywhere?** No. XRPL Testnet/Devnet public servers and the faucets are open. No OpenAI/Anthropic key either — the agents are rule-based, not LLM-based.
- **Is real money involved?** No. Testnet/Devnet XRP and Testnet RLUSD are valueless test tokens.
- **The faucet says rate-limited / failed.** Wait 20–30s and re-run `pnpm provision` (it's idempotent enough — worst case you get fresh wallets; just re-paste the block).
- **Where do the guardrail numbers live?** `apps/backend/src/config.ts` (caps, APR, KPI, pricing) — you don't need to touch these to run, only if you want to tune the demo.
- **Windows + native build errors?** Shouldn't happen — we use Node's built-in `node:sqlite`, no native compile.
