# TreasuryMind Setup

## Quick Start

### 1. API Key
Edit `backend/.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
```

### 2. Backend (Python 3.11+)
```powershell
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 3. Frontend (Node 18+)
```powershell
cd frontend
npm install
npm run dev
```

### 4. Open
- Dashboard: http://localhost:3000
- API Docs: http://localhost:8000/docs

## Or use the launcher
```powershell
.\start.ps1
```

## Demo Flow
1. Dashboard loads with 3 subsidiaries (Zurich surplus, Brazil deficit, Singapore normal)
2. Click **Analyze** → AI detects the liquidity gap
3. Review the recommendation (FX savings, risk level, reasoning)
4. Click **Approve & Execute on XRPL** → live XRPL Devnet transaction
5. Modal shows TX hash + XRPL explorer link
6. Audit trail updates automatically

## Architecture
```
frontend (Next.js 14)     →    backend (FastAPI)     →    XRPL Devnet
  - Dashboard                    - AI Agent (Claude)        - 4 wallets
  - AI Recommendation            - xrpl-py                  - Payments
  - Approval flow                - RLUSD simulation         - Vault sim
  - Audit trail                  - Audit log                - Credit line
```
