# Product

## Register

product

## Users

Primary: hackathon judges watching a 3–5 minute live pitch + demo. They evaluate fast, on a big screen, and reward clarity, polish, and a legible story about what the AI agent does and why XRPL matters.

Secondary persona the UI role-plays for: a corporate treasury operator (CFO office) monitoring multi-entity liquidity, reviewing AI recommendations, and approving on-chain transfers. The interface must read as *their* daily tool, even though judges are the real audience.

Job to be done: follow the demo arc — spot the Brazil liquidity deficit, run AI analysis, choose a resolution, approve, watch it settle on XRPL Devnet in seconds, and verify it in the audit trail — without anyone having to explain the screen.

## Product Purpose

TreasuryMind is an AI-powered corporate treasury command center. A Claude agent analyzes subsidiary balances, detects liquidity gaps, and recommends transfers (direct or vault credit lines) that execute on XRPL Devnet with RLUSD — seconds-fast, near-zero fees, policy-engine guarded, fully audited.

Success: the demo flow lands flawlessly AND the product looks shippable — a tool a bank would credibly pilot, not a hackathon mock-up. Pitch-grade polish on production-grade bones.

## Brand Personality

Institutional precision. Calm, exact, trustworthy — terminal-meets-private-bank. Three words: **precise, calm, authoritative**.

Emotional goals: judges should feel "this is real" within the first five seconds; the operator persona should feel in control, never marketed at. Drama comes from the *content* (a deficit pulsing red, a ledger confirming in 4 seconds), not from decorative effects.

## Anti-references

- **Crypto-dashboard neon**: no dark-mode neon gradients, glassmorphism, coin-tracker aesthetics. This is corporate treasury, not a DEX.
- **Generic SaaS admin**: no assembled-from-defaults Bootstrap/shadcn look. Every surface should feel deliberately designed.
- **Legacy banking software**: no dated enterprise-portal density, beveled chrome, or early-2010s bank-portal UX.

## Design Principles

1. **The numbers are the interface.** Monospaced figures, exact amounts, real wallet addresses, live TX hashes. Precision is the brand; never round away credibility.
2. **Motion conveys state, never decoration.** Animations exist to show money moving, analysis progressing, ledgers confirming. 150–250ms transitions; the demo's drama comes from real state changes.
3. **Trust through evidence.** Every claim on screen is backed by something inspectable — policy checks enumerated, risk scores explained, explorer links to the actual chain. Show the receipt, not the slogan.
4. **Demo-legible at distance.** Key moments (deficit alert, AI recommendation, settlement confirmation) must read from the back of a room. Hierarchy carries the pitch even with the sound off.
5. **Calm surface, urgent signals.** The paper-quiet base palette stays restrained so the semantic colors (deficit red, settled green, vault gold) land with full force when it matters.

## Accessibility & Inclusion

WCAG AA basics: ≥4.5:1 contrast for body text, keyboard-reachable interactive controls, `prefers-reduced-motion` alternatives for all animations. Status is never conveyed by color alone (badges carry text labels). Big-screen legibility doubles as a low-vision accommodation.
