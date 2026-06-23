# 🌍 Show the app to someone else

The Vite dev server already proxies `/api` to the backend, so you only need to expose **one port (5173)** publicly. The whole app (frontend + backend, in SIM mode) is then reachable from anywhere.

> **Your PC must stay on and running `pnpm dev`** for the link to work — a tunnel just forwards traffic to your machine. For a link that works without your PC, see "Permanent deploy" at the bottom.

---

## Option A — localtunnel (zero install, instant)

**Terminal 1** — run the app:
```bash
pnpm dev
```
Wait for `Local: http://localhost:5173/`.

**Terminal 2** — open the tunnel:
```bash
pnpm share
```
It prints a public URL like `https://tiny-cats-smile.loca.lt`. Share that link.

> ⚠️ **First-visit password page:** localtunnel shows a one-time "Click to Continue" page that asks for a *Tunnel Password*. That password is **your public IP address**. Get it by running:
> ```bash
> curl https://loca.lt/mytunnelpassword
> ```
> Tell your viewer to paste that value once. (This is a localtunnel quirk, not our app.)

---

## Option B — Cloudflare Tunnel (nicer: no password page, faster)

One-time install of `cloudflared`:
```bash
winget install --id Cloudflare.cloudflared    # Windows
# or download from https://github.com/cloudflare/cloudflared/releases
```

**Terminal 1:** `pnpm dev`
**Terminal 2:**
```bash
cloudflared tunnel --url http://localhost:5173
```
It prints a `https://something.trycloudflare.com` URL — share it. No account, no password page.

---

## Notes

- **SIM mode:** viewers see the full app (all 3 demo paths, agents, allocator, audit) without any wallet setup — everything runs simulated.
- **AI advisor:** if `ANTHROPIC_API_KEY` is set in your `.env`, the real-AI advisor works over the tunnel too; otherwise it falls back to the rule-based plan.
- **Performance:** the tunnel adds some latency, but it's fine for a demo.
- **Stop sharing:** close the tunnel terminal (Ctrl+C). The URL dies immediately.

---

## Permanent deploy (works without your PC)

If you want a link that stays up, deploy the two apps:

- **Frontend** → Vercel or Netlify (build `apps/frontend`, output `dist`). Set an env/proxy so `/api` points at the backend URL.
- **Backend** → Render / Railway / Fly.io (Node 22+ for `node:sqlite`). Set the `.env` vars there. Note SQLite is a local file — use a persistent disk or switch the repository layer to a hosted DB for multi-instance.

This is more setup (accounts, env, CORS). Say the word and I'll wire it up — Vercel (frontend) + Render (backend) is the quickest combo.
