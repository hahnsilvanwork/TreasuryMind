# TreasuryMind — Umsetzungsplan für die Ripple-Challenge (Stand 11.06.2026)

Judging: Viability/Feasibility 40% · Technical use of XRPL 25%.
Prio 1–2 zahlen auf die 25% ein, Prio 3–4 auf die Demo-Wirkung, Prio 6 auf die 40%.

---

## Prio 1 — RLUSD als echtes Issued Token ✅ ERLEDIGT (11.06.)

> Umgesetzt in `xrpl_service.py` (komplett neu) + `main.py`. Zusätzlich erledigt:
> Devnet-Endpoint-Wechsel + Explorer-URLs (= Prio 2, Schritte 1–3), Issuer-Flag für
> TokenEscrow (Prio-5-Vorarbeit), `.env`-Override `XRPL_WS_URL` / `XRPL_EXPLORER_BASE`,
> Bugfix: `agent.py` las den ANTHROPIC_API_KEY vor `load_dotenv()` → AI lief immer im
> Rule-Based-Fallback. Resilienz-Leiter: TOKEN_PAYMENT → XRP_PROOF → SIMULATED.
> ⚠️ On-Chain-Pfad konnte im Firmennetz nicht getestet werden (XRPL-Ports blockiert,
> Fallback-Pfad end-to-end getestet). Vor dem Hackathon einmal im Hotspot testen:
> `python -c "..."` Test siehe unten, oder einfach Backend starten und im Log auf
> "RLUSD token economy live on Devnet" achten.

### Ursprünglicher Plan (~0,5 Tag)

**Problem:** RLUSD ist nur ein Python-Dict (`data.py`). On-chain wird ein Mini-XRP-Betrag als Proxy gesendet (`xrpl_service.py:90-91`). Judges sehen im Explorer "0.76 XRP" statt "380,000 RLUSD".

**Dateien:** `backend/xrpl_service.py`, `backend/data.py`, `backend/main.py`

**Schritte:**
1. **Issuer-Wallet anlegen:** In `setup_wallets()` ein 5. Wallet `treasury_issuer` per Faucet erzeugen (wie die anderen).
2. **Rippling aktivieren:** Einmalig `AccountSet` auf dem Issuer mit `asf_default_ripple` — sonst können die Entities den IOU nicht untereinander senden:
   ```python
   from xrpl.models import AccountSet, AccountSetAsfFlag
   tx = AccountSet(account=issuer.address, set_flag=AccountSetAsfFlag.ASF_DEFAULT_RIPPLE)
   ```
3. **Currency-Code definieren:** "RLUSD" hat 5 Zeichen → XRPL braucht dafür den 40-stelligen Hex-Code:
   ```python
   RLUSD_HEX = "524C555344000000000000000000000000000000"
   ```
4. **Trustlines setzen:** Für jedes Entity-Wallet (Zurich, Brazil, Singapore, Vault) ein `TrustSet`:
   ```python
   from xrpl.models import TrustSet, IssuedCurrencyAmount
   TrustSet(account=entity.address,
            limit_amount=IssuedCurrencyAmount(currency=RLUSD_HEX, issuer=issuer.address, value="100000000"))
   ```
5. **Startbalances verteilen:** Die Beträge aus `data.py` (Zurich 2,1M / Singapore 1,47M / Vault 1M) per `Payment` vom Issuer an die Entities senden — damit stimmen Ledger und App überein.
6. **`execute_payment()` umbauen:** Die Proxy-Logik (`proxy_xrp = max(0.01, min(amount/500_000, 5.0))` und `xrp_to_drops`) löschen. Stattdessen:
   ```python
   amount=IssuedCurrencyAmount(currency=RLUSD_HEX, issuer=ISSUER_ADDR, value=str(amount_rlusd))
   ```
7. **Optional (stark im Pitch):** Balances per `account_lines`-Request direkt vom Ledger lesen statt aus dem Dict — "die Zahlen im Dashboard SIND der Ledger-Stand".

**Hinweis:** Auf Testnet gibt es offizielles Test-RLUSD per Faucet — aber da ihr für Prio 2 sowieso auf Devnet müsst, ist Self-Issuing der richtige Weg. Im README ehrlich als "RLUSD-equivalent IOU, mainnet path = official RLUSD" beschreiben.

---

## Prio 2 — Echtes Devnet + XLS-65 Vault on-chain ✅ ERLEDIGT (11.06.)

> Umgesetzt: `VaultCreate` beim Setup (Owner = corporate_vault-Wallet, Asset = RLUSD-IOU,
> VaultID aus TX-Metadata), `/api/vault/deposit` → Payment + echtes `VaultDeposit`,
> Credit-Draw → **ein einziger `VaultWithdraw` mit destination=Borrower**, Repay →
> Payment + Re-`VaultDeposit`. `/api/vault` liest das Vault-Ledger-Objekt live
> (`assets_total`/`assets_available`), Health zeigt `xls65_vault_onchain` + `vault_id`.
> Alle Labels dynamisch-ehrlich (on-chain vs. abstraction). Jeder Vault-Flow fällt bei
> Fehlern auf die Token-Payment-Leiter zurück.
> XLS-66: Lending-Terms bleiben App-Layer ("XLS-66-ready"), Funding ist on-chain XLS-65.
> ⚠️ On-Chain-Pfad im Firmennetz nicht testbar — kompletter Lifecycle (Deposit→Draw→
> Repay) via API im Fallback-Modus getestet. Im Hotspot ausführen:
> `cd backend && python devnet_smoke_test.py` (testet alles + druckt Explorer-Links).

### Ursprünglicher Plan (~1 Tag)

**Problem:** `xrpl_service.py:25` verbindet zu `wss://s.altnet.rippletest.net:51233` — das ist **Testnet**, obwohl Code und UI überall "Devnet" sagen. Die XLS-65/66-Amendments laufen aber auf **Devnet**. Der Vault ist aktuell nur ein Dict; `simulate_vault_deposit()`/`simulate_credit_line()` werden importiert, aber nie aufgerufen.

**Dateien:** `backend/xrpl_service.py`, `backend/main.py`, `backend/requirements.txt`

**Schritte:**
1. **Endpoint wechseln:**
   ```python
   XRPL_DEVNET_WS = "wss://s.devnet.rippletest.net:51233"
   ```
2. **Explorer-URLs anpassen:** `https://testnet.xrpl.org/...` → `https://devnet.xrpl.org/transactions/{tx_hash}` (Zeile 127).
3. **xrpl-py aktualisieren:** In `requirements.txt` auf die neueste Version (≥ 4.2) — erst ab da sind die Vault-Transaktionen (XLS-65) enthalten. Nach dem Update prüfen: `from xrpl.models import VaultCreate, VaultDeposit` muss importierbar sein.
4. **Vault beim Setup on-chain anlegen:** `VaultCreate` vom Vault-Wallet mit eurem RLUSD-IOU als Asset. Die **VaultID** aus den Transaktions-Metadaten (CreatedNode, LedgerEntryType "Vault") ziehen und speichern.
5. **`POST /api/vault/deposit` → echtes `VaultDeposit`** (Account = einzahlendes Entity, VaultID, Amount = RLUSD-IOU). Die toten `simulate_*`-Funktionen dabei ersetzen oder löschen.
6. **Credit-Line-Auszahlung → `VaultWithdraw`** an das Deficit-Entity.
7. **XLS-66 (Lending Protocol):** Per `feature`-Request prüfen, ob das LendingProtocol-Amendment auf Devnet schon aktiv ist. Wenn ja: echte Loan-Objekte nutzen. Wenn nein: Simulation behalten, aber im UI/README ehrlich als "XLS-66-ready abstraction" labeln — und im Pitch sagen, dass XLS-65 schon echt läuft.
8. **Konsistenz:** Nach dem Wechsel stimmen alle "Devnet"-Labels endlich; in `page.tsx` (XRPLTab) die hartcodierten Wallet-Adressen durch `GET /api/wallets` ersetzen (siehe Prio 3).

---

## Prio 3 — Statische Tabs an die Live-API anschließen ✅ ERLEDIGT (11.06.)

> Umgesetzt in `page.tsx`, `api.ts`, `types.ts`: Audit-, Vault-, Risk- und XRPL-Tab
> laden jetzt live von der API (mit Skeleton-Loading, Error+Retry, Empty-States).
> Neu dazu: Explorer-Links überall echt (Audit-Tabelle, Wallet-Tabelle, Phase-5-Screen
> mit "View on XRPL Explorer"-Button), funktionierendes Vault-Deposit-Formular,
> Repay-Buttons auf aktiven Kreditlinien, Szenario-Apply-Buttons verdrahtet
> (inkl. Balance-Refresh + Erfolgsmeldung), On-Chain-RLUSD-Spalte + Issuer-Zeile in
> der Wallet-Tabelle, XLS-65-On-Chain-Status-Box im Vault-Tab. Nebenbei: Side-Stripe-
> Antipattern im Szenario-Tab entfernt, SIMULATED vs. ON-CHAIN wird ehrlich angezeigt.
> Suppliers-Tab bleibt bewusst statisch (als EXPERIMENTAL/FUTURE markiert).
> Verifiziert: `tsc --noEmit` ✓, `next build` ✓, alle 7 Endpoints durch den
> Next-Proxy getestet ✓.
> ⚠️ Hinweis: Port 3000 war von einer fremden Node/Express-App belegt — vor der Demo
> sicherstellen, dass Port 3000 frei ist (`netstat -ano | findstr :3000`).

### Ursprünglicher Plan (~0,5 Tag)

**Problem:** 5 von 6 Tabs (Vault, XRPL, Risk, Audit, Suppliers) zeigen 100% hartcodierte Daten. Nur 4 von 22 Backend-Endpoints werden genutzt. **Gefährlichster Moment:** Judge führt live eine Transaktion aus, klickt auf "Audit" — und die Transaktion ist dort nicht zu sehen. Alle "Explorer ↗"-Links sind `href="#"`.

**Dateien:** `frontend/src/app/page.tsx`, `frontend/src/lib/api.ts`

**Schritte:**
1. **AuditTab (page.tsx:407-481):** Das hartcodierte `txs`-Array durch `api.getAudit()` ersetzen (Endpoint existiert, `api.ts` hat die Funktion schon). Felder mappen: type, from/to, amount, status, policy, fx_saved, timestamp. Eine Spalte "Explorer" mit der `explorer_url` aus dem Audit-Eintrag ergänzen.
2. **VaultTab (page.tsx:84-193):** Stats und Credit Lines aus `GET /api/vault` + `GET /api/credit-lines` laden statt `$1.00M`/`4.2%` hartcodiert.
3. **RiskTab (page.tsx:291-404):** Scores aus `GET /api/risk-scores`, Policy-Regeln aus `GET /api/policy`, Szenarien aus `GET /api/scenarios`. Die "Apply"-Buttons (aktuell ohne onClick!) an `POST /api/scenario/liquidity-shock` hängen; danach Balances refetchen und Hinweis "→ Overview: Analyze" zeigen.
4. **XRPLTab (page.tsx:196-288):** Wallet-Tabelle aus `GET /api/wallets`; Explorer-Links: `https://devnet.xrpl.org/accounts/{address}` statt `href="#"` (page.tsx:261).
5. **Nach erfolgreicher Execution (Phase 5):** `getAudit()` und `getBalances()` refetchen, damit Audit-Tab und Overview sofort den neuen Stand zeigen.
6. **Daten-Loading:** Ein gemeinsamer Fetch beim Tab-Wechsel reicht (useEffect pro Tab); Skeleton-Klasse existiert schon in `globals.css`.

---

## Prio 4 — Kontrast & Schriftgrößen für den Beamer ✅ ERLEDIGT (11.06.)

> Umgesetzt: `--text-3` #A0A39B (2,56:1 ❌) → **#62665C (5,4:1 auf Weiß, ≥4,9:1 auf
> allen Flächen)**, `--text-2` → #4A4A48 (8,9:1). Body 13→14px. Alle 9–10px-Schriften
> in page.tsx (19 Stellen), Header und NetworkGraph auf min. 11px. Schlüsselzahlen
> größer: Entity-Balances 15→17px, Shortfall-Alert 15→17px, StatCards 20→22px,
> Graph-Balances 16→18. NetworkGraph-Kontrast gefixt (#C0BAB0/#9B9590 → #62665C),
> Kanten kräftiger (1→1,25px, aktiv 2px). `prefers-reduced-motion`-Block in
> globals.css. Kontraste per WCAG-Formel nachgerechnet, tsc + next build ✓.

### Ursprünglicher Plan (~1 h)

**Problem:** `--text-3: #A0A39B` auf Weiß ≈ 2,6:1 Kontrast (WCAG braucht 4,5:1) und steckt in ~80% der Sekundärtexte. ~40 Stellen mit 9–11px Schrift. Kein `prefers-reduced-motion`.

**Dateien:** `frontend/src/app/globals.css`, `frontend/src/app/page.tsx`

**Schritte:**
1. **globals.css Zeile 19:** `--text-3: #A0A39B` → `#6E7268` (≈ 5:1, bleibt im selben warmen Graugrün).
2. **globals.css Zeile 46:** `font-size: 13px` → `14px` (hebt alles proportional).
3. **page.tsx:** Alle `fontSize:9` und `fontSize:10` → mindestens `11`; Tabellen-Header von 10 auf 11. (Suche nach `fontSize:9` und `fontSize:10`.)
4. **Schlüsselzahlen größer:** Balance-Beträge (15px) → 16–17px; der Shortfall-Alert und die Phase-5-Erfolgszahl dürfen deutlich größer (24px+) — das sind die Momente, die vom Beamer ablesbar sein müssen.
5. **Reduced Motion ans Ende von globals.css:**
   ```css
   @media (prefers-reduced-motion: reduce) {
     *, *::before, *::after {
       animation-duration: 0.01ms !important;
       animation-iteration-count: 1 !important;
       transition-duration: 0.01ms !important;
     }
   }
   ```

---

## Prio 5 — TokenEscrow für Credit-Line-Rückzahlung ✅ ERLEDIGT (11.06.)

> **Design geändert gegenüber dem Plan unten:** Escrow bei Kreditvergabe würde Brazils
> frisches Kapital sofort wieder einsperren (zerstört die Demo-Story). Stattdessen:
> **Rückzahlung als XLS-85-Escrow-Settlement** — beim Klick auf "Repay" laufen drei
> validierte On-Chain-Transaktionen: ① `EscrowCreate` (Borrower lockt RLUSD mit
> Zeitschloss, default 15 s, via `ESCROW_WINDOW_SECONDS` konfigurierbar) →
> ② `EscrowFinish` durch den Vault-Manager nach Ablauf (mit Retry auf
> tecNO_PERMISSION) → ③ `VaultDeposit` zurück in den XLS-65-Vault. Pitch-Satz: "In
> Produktion ist das Zeitschloss die Laufzeit — hier 15 Sekunden, damit Sie den
> kompletten Lifecycle live sehen."
> Issuer setzt `Allow Trustline Locking` schon seit Prio 1; Health zeigt
> `xls85_token_escrow`. VaultTab zeigt auf zurückgezahlten Linien "XLS-85 ESCROW
> SETTLED" mit Lock/Release/Vault-Explorer-Links. Voller Fallback auf direkte
> Rückzahlung. Smoke-Test um Escrow-Schritt erweitert (`devnet_smoke_test.py`).
> ⚠️ Wie immer: On-Chain-Pfad im Hotspot testen; Fallback via API end-to-end getestet.

### Ursprünglicher Plan (~0,5 Tag)

**Ziel:** Drittes XRPL-Primitive zeigen. Story: "Die Rückzahlung der Kreditlinie ist on-chain garantiert — per Escrow mit Zeitschloss."

**Voraussetzungen:** TokenEscrow-Amendment (XLS-85, auf Devnet aktiv). Der **Issuer** muss zusätzlich `AccountSet` mit `asf_allow_trustline_locking` setzen, sonst lässt sich der IOU nicht escrowen.

**Dateien:** `backend/xrpl_service.py`, `backend/main.py`, Frontend Phase-5-Screen + VaultTab

**Schritte:**
1. Beim Issuer-Setup (Prio 1) das Flag `asf_allow_trustline_locking` zusätzlich setzen.
2. **Bei Credit-Line-Approval** (`POST /api/approve` mit type vault_credit): nach der Auszahlung ein `EscrowCreate` vom Borrower-Wallet:
   - `destination` = Vault-Wallet
   - `amount` = Rückzahlungsbetrag als RLUSD-IOU (`IssuedCurrencyAmount`)
   - `finish_after` = `datetime_to_ripple_time(now + term_days)` (Helper aus `xrpl.utils`)
   - optional `cancel_after` = finish_after + 2 Tage
3. `escrow_sequence` (= Sequence der EscrowCreate-TX) in der Credit Line speichern.
4. **`POST /api/credit-lines/{id}/repay`** → `EscrowFinish` (owner = Borrower, offer_sequence = gespeicherte Sequence).
5. **UI:** Im Phase-5-Screen und VaultTab eine Zeile "Repayment escrowed on-ledger · releases in 7d" + Explorer-Link auf die Escrow-TX.

---

## Prio 6 — README neu schreiben ✅ ERLEDIGT (11.06.)

> Komplett neu als UTF-8 (alte Datei war UTF-16-kaputt), auf Englisch für die
> Ripple-Judges. Enthält: Ein-Satz-Pitch, Problem-Tabelle mit Zahlen (Wire vs. XRPL),
> 6-Schritte-Lösung, ASCII-Architekturdiagramm, **ehrliche "What runs on-chain"-
> Tabelle** (RLUSD ✅ / XLS-65 ✅ / XLS-85 ✅ / Memos ✅ / XLS-66 App-Layer ⚙️ mit
> Begründung), Resilienz-Leiter, "Why the AI is trustworthy" (recommend/validate-
> Split → Viability-Argument), 5-Punkte-Mainnet-Pfad, Quick Start + Smoke-Test,
> 3-Minuten-Demo-Drehbuch, Repo-Übersicht.
> 💡 Noch offen für euch: Screenshot/GIF des Dashboards einfügen + Team-Namen ergänzen.

### Ursprünglicher Plan (~2 h)

**Problem:** README ist faktisch leer und als UTF-16 gespeichert (Encoding-Müll: `��# T r e a s u r y M i n d`). Judges lesen das Repo — das README zahlt direkt auf die 40% Viability ein.

**Datei:** `README.md` (komplett neu als UTF-8)

**Struktur:**
1. **Ein-Satz-Pitch** + Screenshot/GIF des Dashboards.
2. **Problem** mit Zahlen: Bank-Wire $25–45 + 1–3 Tage + 0,25% FX vs. XRPL ~$0.0001 + 3–5 s.
3. **Lösung in 3 Sätzen:** Claude-Agent erkennt Liquiditätslücken → deterministische Policy-Engine (9 Checks) validiert → Settlement auf XRPL.
4. **Architekturdiagramm** (das ASCII-Diagramm aus SETUP.md übernehmen und erweitern).
5. **"What's on-chain"-Tabelle — ehrlich:** Payment+Memo ✅ · RLUSD-IOU mit Trustlines ✅ (nach Prio 1) · XLS-65 VaultCreate/Deposit ✅ (nach Prio 2) · TokenEscrow ✅ (nach Prio 5) · XLS-66 simuliert mit Begründung. Ehrlichkeit wirkt bei Judges stärker als Buzzwords.
6. **Mainnet-Pfad** (Viability!): Migration auf offizielles RLUSD, Custody-Integration, Policy-Engine bleibt unverändert, Compliance-Argument (deterministisch = auditierbar).
7. **Demo-Flow** in 6 Schritten (aus SETUP.md übernehmen).
8. Setup-Verweis auf SETUP.md, Team, Lizenz.

---

## Prio 7 — Demo-Robustheit ✅ ERLEDIGT (11.06.)

> Umgesetzt:
> **Backend:** Token-Payments mit 1× Retry (2 s Pause) vor Degradation; alle XRPL-
> Calls hatten schon Timeouts (20 s Payment / 30 s Setup, seit Prio 1). `/api/health`
> ist jetzt der Go/No-Go-Check vor dem Pitch: XRPL-Ping (ServerInfo, 5 s Timeout),
> AI-Check via `models.list()` (kostet keine Tokens, 6 s Timeout), `wallets_funded`,
> plus `demo_ready`-Block mit Klartext-Note. Getestet — diagnostiziert das Firmennetz
> korrekt ("unreachable" / "rule-based fallback active" / 0/5).
> **Frontend:** AbortController-Timeouts in api.ts (GET 30 s, POST 120 s — Escrow-
> Repay braucht bis ~60 s) mit verständlicher Timeout-Meldung statt Endlos-Spinner.
> Retry-Button wiederholt jetzt die **tatsächlich fehlgeschlagene Aktion** (analyze /
> approve / balances) statt nur Balances zu refetchen.
> **Vor dem Pitch:** `curl localhost:8000/api/health` → checks.xrpl = "ok" und
> wallets_funded = "5/5" heißt: Bühne frei.

### Ursprünglicher Plan (~2 h)

**Dateien:** `backend/xrpl_service.py`, `backend/main.py`, `frontend/src/app/page.tsx`

**Schritte:**
1. **XRPL-Timeout + Retry:** Jeden Devnet-Call in `asyncio.wait_for(..., timeout=10)` wrappen; bei Fehler **einmal** retried, erst dann Fallback auf SIMULATED (aktuell: sofortiger Fallback beim ersten Fehler, ohne Timeout — kann auch ewig hängen).
2. **`GET /api/health` erweitern:** XRPL-Ping (`ServerInfo`-Request) + AI-Check (`client.models.list()` — kostet keine Tokens) → `{"xrpl": "ok", "ai": "ok", "wallets_funded": true}`. Vor dem Pitch einmal aufrufen = Go/No-Go.
3. **Frontend Retry-Button:** Im Error-Banner (page.tsx:1228-1235) einen "Retry"-Button; dafür die letzte fehlgeschlagene Aktion (`analyze` | `approve`) im State merken und erneut aufrufen. Aktuell hilft nur Seiten-Reload — tödlich auf der Bühne.
4. **Frontend-Timeout:** Wenn `analyze` > 30 s lädt → Fehlermeldung statt Endlos-Spinner.

---

## Prio 8 — Aufräumen ✅ ERLEDIGT (11.06.) — ALLE 8 PRIOS ABGESCHLOSSEN 🎉

> Umgesetzt: **11 tote Komponenten gelöscht** (~3.500 Zeilen; inkl. Sidebar — der
> `Tab`-Typ lebt jetzt in `lib/types.ts`). Frontend von ~6.000 auf 2.438 Zeilen.
> **Alle `any`-Casts ersetzt** durch ein `WizardOption`-Interface (AI-Response,
> Rule-Based-Fallback und Demo-Daten haben unterschiedliche Feldnamen — jetzt
> typsicher zusammengeführt). Toten `fetchAudit`-Helper entfernt.
> `data.py`: `simulate_balance_fluctuation()` + `import random` raus.
> **Nestlé-Altlasten getilgt** (page.tsx-Entity-Liste + scenario_service.py —
> letztere war seit Prio 3 sogar live im Risk-Tab sichtbar!).
> `grep -ri testnet`: sauber (einzig verbliebene Erwähnung ist der dokumentierte
> .env-Fallback-Kommentar). tsc + next build + Backend-Imports ✓.

### Ursprünglicher Plan (~1 h)

**Dateien:** `frontend/src/components/`, `backend/main.py`, `backend/data.py`, `frontend/src/app/page.tsx`

**Schritte:**
1. **10 tote Komponenten löschen** (3.441 Zeilen, nirgendwo importiert): `VaultPanel`, `SubsidiaryCard`, `RiskCompliancePanel`, `SupplierNetworkPanel`, `AIRecommendation`, `DemoFlow`, `AuditTrail`, `ApprovalModal`, `AnimatedNumber`, `Logo`. (Vorher kurz reinschauen, ob einzelne besser sind als die Inline-Version — sonst weg. Judges, die das Repo lesen, werten tote Parallel-Codebasen negativ.)
2. **`main.py`:** Ungenutzte Imports `simulate_vault_deposit`/`simulate_credit_line` entfernen (erledigt sich mit Prio 2).
3. **`data.py`:** Ungenutzte Funktion `simulate_balance_fluctuation()` löschen.
4. **`page.tsx`:** Die 11 `any`-Casts durch die vorhandenen Typen aus `lib/types.ts` ersetzen (v.a. `TreasuryOption` für die Options-Objekte in Phase 3–5).
5. **Altlast entfernen:** `page.tsx:648` enthält `e.name.replace(/Nestl[eé]\s*/i,'')` — Überbleibsel einer Nestlé-Version. Raus damit, bevor es jemand grept.
6. **Naming:** Nach dem Devnet-Wechsel (Prio 2) prüfen, dass nirgendwo mehr "testnet" steht: `grep -ri testnet backend/ frontend/src/`.

---

## Empfohlene Reihenfolge (bis 19.06.)

| Tag | Aufgaben |
|---|---|
| 1 | Prio 4 (1 h, sofort sichtbar) + Prio 1 (RLUSD-IOU) |
| 2 | Prio 2 (Devnet + XLS-65 Vault) |
| 3 | Prio 3 (Tabs live) + Prio 7 (Robustheit) |
| 4 | Prio 5 (TokenEscrow) |
| 5 | Prio 6 (README) + Prio 8 (Cleanup) + kompletter Demo-Durchlauf inkl. Offline-Test (Devnet aus → Fallback prüfen) |
