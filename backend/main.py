"""TreasuryMind FastAPI Backend — AI-powered Corporate Liquidity Network on XRPL.

Architecture:
  - RLUSD is issued as a real IOU token on XRPL Devnet (issuer + trustlines)
  - Treasury transfers settle as validated RLUSD token payments for the full amount
  - Resilience ladder: TOKEN_PAYMENT → XRP_PROOF_PAYMENT → SIMULATED
  - Policy Engine validates every action deterministically (9 checks)
  - Risk Engine prices counterparty risk (0–100 score)
  - AI Agent recommends; Policy validates; Human approves; XRPL executes; Audit proves.
"""
import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Literal, Optional

import data as db
from agent import analyze_liquidity, client as ai_client  # client may be None if no GROQ_API_KEY
import xrpl_service
from xrpl_service import (
    execute_payment,
    setup_wallets,
    explorer_account_url,
    get_onchain_rlusd_balances,
    get_vault_onchain_info,
    vault_deposit_onchain,
    vault_credit_draw_onchain,
    vault_repay_via_escrow,
    WALLET_ADDRESSES,
)
from policy_engine import validate_action
from risk_engine import calculate_risk_score, calculate_all_risks
from scenario_service import apply_scenario, get_all_scenarios
import audit_service as audit
import supplier_service as sup_svc

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Audit ID counter ──────────────────────────────────────────────────────────
_audit_counter = 0

def _next_audit_id() -> str:
    global _audit_counter
    _audit_counter += 1
    year = datetime.now().year
    return f"TM-{year}-{_audit_counter:05d}"


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting TreasuryMind — Corporate Liquidity Network on XRPL...")

    # ── Restore persisted state ───────────────────────────────────────────────
    if audit.has_persisted_data():
        state = audit.get_state()
        logger.info(f"Restoring {len(state['transfers'])} transfers, {len(state['credit_lines'])} credit lines from disk")
        db.TRANSFER_HISTORY.clear()
        db.TRANSFER_HISTORY.extend(state["transfers"])
        db.ACTIVE_CREDIT_LINES.clear()
        db.ACTIVE_CREDIT_LINES.extend(state["credit_lines"])
        db.VAULT_DEPOSITS.clear()
        db.VAULT_DEPOSITS.extend(state.get("vault_deposits", []))
        committed = sum(
            cl["amount"] for cl in db.ACTIVE_CREDIT_LINES
            if cl.get("status") in ("active", "active_simulated")
        )
        db.CORPORATE_VAULT["committed"] = committed
        deposited_total = sum(d["amount"] for d in db.VAULT_DEPOSITS)
        db.CORPORATE_VAULT["deposited_total"] = deposited_total
        db.CORPORATE_VAULT["available"] = max(0.0, deposited_total - committed)
        # Sync audit counter
        global _audit_counter
        _audit_counter = len(state["transfers"]) + len(state["credit_lines"]) + len(state.get("vault_deposits", []))
    else:
        logger.info("No persisted data found — starting with clean state.")

    # ── Set up XRPL wallets + RLUSD token economy ─────────────────────────────
    # Seed the on-chain RLUSD distribution from the (possibly restored) app state
    # so ledger and dashboard agree from the first second.
    seed_balances = {sub_id: sub["rlusd_balance"] for sub_id, sub in db.SUBSIDIARIES.items()}
    seed_balances["corporate_vault"] = db.CORPORATE_VAULT["available"]
    addresses = await setup_wallets(initial_balances=seed_balances)
    for sub_id, address in addresses.items():
        if sub_id in db.SUBSIDIARIES:
            db.SUBSIDIARIES[sub_id]["wallet_address"] = address
        elif sub_id == "corporate_vault":
            db.CORPORATE_VAULT["wallet_address"] = address
    logger.info(
        f"XRPL wallets ready: {list(addresses.keys())} — "
        f"RLUSD token economy: {'LIVE' if xrpl_service.RLUSD_READY else 'FALLBACK (XRP proof mode)'}"
    )
    yield
    logger.info("Shutting down TreasuryMind.")


app = FastAPI(
    title="TreasuryMind API",
    description=(
        "AI Treasury Agent for multinational corporate liquidity management on XRPL. "
        "RLUSD issued as a real IOU token on Devnet — trustlines, validated token payments. "
        "Migration path: official RLUSD issuer, native XLS-65 and XLS-66 primitives."
    ),
    version="2.2.0",
    lifespan=lifespan,
)

# Local dev origins + optional deployed frontend (e.g. https://treasurymind.vercel.app).
# Note: when the frontend proxies /api/* through Next rewrites, CORS never triggers —
# this matters only for direct browser calls to the API.
_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
if os.getenv("FRONTEND_ORIGIN"):
    _origins.append(os.getenv("FRONTEND_ORIGIN"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Request Models ────────────────────────────────────────────────────────────

class ApprovalRequest(BaseModel):
    from_id: str
    to_id: str
    amount: float
    action_type: Literal["direct_transfer", "vault_credit"] = "direct_transfer"
    reasoning: str = ""
    term_days: int = 7
    rate_pct: float = 2.5
    approved_by: str = "Treasury Manager"
    confidence: float = 85.0


class VaultDepositRequest(BaseModel):
    subsidiary_id: str
    amount: float
    approved_by: str = "Treasury Manager"


class ScenarioRequest(BaseModel):
    scenario_id: str


class CreditLineActionRequest(BaseModel):
    approved_by: str = "Treasury Manager"


class SupplierCreditRequest(BaseModel):
    amount: Optional[float] = None         # override; defaults to requested_liquidity
    term_days: Optional[int] = None        # override; defaults to min(14, max_term)
    approved_by: str = "Treasury Manager"


# ─── Routes ───────────────────────────────────────────────────────────────────

async def _check_ai() -> str:
    """Check AI availability — Groq if key set, else rule-based engine."""
    if ai_client is None:
        return "rule_based (no GROQ_API_KEY — set one at console.groq.com for free)"
    try:
        await asyncio.wait_for(
            asyncio.to_thread(lambda: ai_client.models.list()),
            timeout=6,
        )
        return "ok (Groq AI active)"
    except Exception as e:
        return f"error: {str(e)[:100]} (rule-based fallback active)"


@app.get("/api/health")
async def health():
    """Pre-demo go/no-go: live connectivity checks for XRPL and the AI API."""
    xrpl_check, ai_check = await asyncio.gather(xrpl_service.ping(), _check_ai())
    return {
        "status": "ok",
        "product": "TreasuryMind Corporate Liquidity Network",
        "version": "2.2.0",
        "tagline": "AI recommends. Policy validates. Human approves. XRPL executes. Audit proves.",
        "timestamp": datetime.now().isoformat(),
        "checks": {
            "xrpl": xrpl_check,
            "ai": ai_check,
            "wallets_funded": f"{len(xrpl_service.FUNDED)}/{len(WALLET_ADDRESSES)}",
        },
        "demo_ready": {
            "onchain_settlement": xrpl_service.RLUSD_READY,
            "fallback_only": not xrpl_service.RLUSD_READY,
            "note": (
                "Full on-chain demo available."
                if xrpl_service.RLUSD_READY
                else "Token economy offline — demo runs, but settlements will be simulated. Restart on an open network."
            ),
        },
        "xrpl_wallets": len(WALLET_ADDRESSES),
        "xrpl_network": "XRPL Devnet",
        "rlusd_token_live": xrpl_service.RLUSD_READY,
        "rlusd_issuer": xrpl_service.issuer_address(),
        "rlusd_trustlines": len(xrpl_service.TRUSTLINES),
        "xls65_vault_onchain": xrpl_service.VAULT_ONCHAIN,
        "xls65_vault_id": xrpl_service.VAULT_ID,
        "xls85_token_escrow": xrpl_service.TOKEN_ESCROW_READY,
        "execution_layer": "RLUSD_TOKEN_PAYMENT" if xrpl_service.RLUSD_READY else "XRP_PROOF_PAYMENT",
    }


@app.get("/api/balances")
async def get_balances():
    result = {}
    for sub_id, sub in db.SUBSIDIARIES.items():
        sub["status"] = db.get_subsidiary_status(sub_id)
        result[sub_id] = {
            **sub,
            "shortfall": max(0, sub["threshold_min"] - sub["rlusd_balance"]),
            "excess": max(0, sub["rlusd_balance"] - sub["threshold_min"]),
        }

    total_rlusd = sum(s["rlusd_balance"] for s in db.SUBSIDIARIES.values())
    vault = {**db.CORPORATE_VAULT, "active_credit_lines": len(db.ACTIVE_CREDIT_LINES)}

    return {
        "subsidiaries": result,
        "vault": vault,
        "active_credit_lines": db.ACTIVE_CREDIT_LINES,
        "total_rlusd": total_rlusd,
        "network_rlusd": total_rlusd + db.CORPORATE_VAULT["available"],
        "timestamp": datetime.now().isoformat(),
    }


@app.get("/api/analyze")
async def analyze():
    recommendation = await analyze_liquidity()
    audit_id = _next_audit_id()
    event = {
        "audit_id": audit_id,
        "problem_detected": recommendation.get("problem_detected"),
        "ai_mode": recommendation.get("ai_mode", "claude"),
        "options_count": len(recommendation.get("options", [])),
    }
    audit.add_audit_entry("analysis_run", event)
    db.add_audit_event("analysis_run", event)
    return recommendation


@app.post("/api/approve")
async def approve_transfer(request: ApprovalRequest):
    """
    Execute an approved treasury action.

    Flow:
      1. Risk Engine assesses counterparty risk (0–100 score)
      2. Policy Engine validates 9 deterministic compliance checks
      3. If approved, the FULL amount settles as a validated RLUSD token
         payment on XRPL Devnet (fallback: XRP proof payment → simulation)
      4. Audit trail entry is persisted
    """
    if request.to_id not in db.SUBSIDIARIES:
        raise HTTPException(status_code=400, detail=f"Unknown recipient: {request.to_id}")

    audit_id = _next_audit_id()
    fx_saving = db.calculate_fx_saving(request.amount)

    # ── 1. Risk assessment ────────────────────────────────────────────────────
    risk_result = calculate_risk_score(
        entity_id=request.to_id,
        subsidiaries=db.SUBSIDIARIES,
        active_credit_lines=db.ACTIVE_CREDIT_LINES,
    )
    risk_score = risk_result["risk_score"]
    risk_level = risk_result["risk_level"]

    # ── 2. Policy validation ──────────────────────────────────────────────────
    policy_result = validate_action(
        action_type=request.action_type,
        from_id=request.from_id,
        to_id=request.to_id,
        amount=request.amount,
        confidence=request.confidence,
        risk_score=risk_score,
        risk_level=risk_level,
        vault_available=db.CORPORATE_VAULT["available"],
        subsidiaries=db.SUBSIDIARIES,
    )
    audit.add_policy_check({
        "audit_id": audit_id,
        "timestamp": datetime.now().isoformat(),
        "action_type": request.action_type,
        "from_id": request.from_id,
        "to_id": request.to_id,
        "amount": request.amount,
        "policy_decision": policy_result["policy_decision"],
        "approval_level": policy_result["approval_level"],
        "approved": policy_result["approved"],
        "blocking_reasons": policy_result["blocking_reasons"],
        "risk_score": risk_score,
        "risk_level": risk_level,
    })

    if not policy_result["approved"]:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Transaction blocked by compliance policy.",
                "policy_decision": policy_result["policy_decision"],
                "blocking_reasons": policy_result["blocking_reasons"],
                "decision_summary": policy_result["decision_summary"],
                "policy": policy_result,
            },
        )

    # ── 3A: Direct Internal Transfer ─────────────────────────────────────────
    if request.action_type == "direct_transfer":
        if request.from_id not in db.SUBSIDIARIES:
            raise HTTPException(status_code=400, detail=f"Unknown sender: {request.from_id}")
        sender = db.SUBSIDIARIES[request.from_id]
        if sender["rlusd_balance"] < request.amount:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient balance: {sender['name']} has {sender['rlusd_balance']:,.0f} RLUSD, needs {request.amount:,.0f}",
            )

        xrpl_result = await execute_payment(
            from_id=request.from_id,
            to_id=request.to_id,
            amount_rlusd=request.amount,
            audit_id=audit_id,
            tx_type="direct_transfer",
        )

        db.SUBSIDIARIES[request.from_id]["rlusd_balance"] -= request.amount
        db.SUBSIDIARIES[request.to_id]["rlusd_balance"] += request.amount

        transfer = _build_transfer_record(
            audit_id=audit_id,
            from_id=request.from_id,
            to_id=request.to_id,
            amount=request.amount,
            xrpl_result=xrpl_result,
            fx_saving=fx_saving,
            action_type="direct_transfer",
            reasoning=request.reasoning,
            approved_by=request.approved_by,
            ai_confidence=request.confidence,
            policy_decision=policy_result["policy_decision"],
            approval_level=policy_result["approval_level"],
            risk_score=risk_score,
            risk_level=risk_level,
        )
        db.TRANSFER_HISTORY.append(transfer)
        audit.add_transfer(transfer)
        _update_statuses(request.from_id, request.to_id)

        event = {
            "audit_id": audit_id,
            "transfer_id": transfer["id"],
            "from": request.from_id,
            "to": request.to_id,
            "amount": request.amount,
            "tx_hash": xrpl_result.get("tx_hash"),
            "execution_mode": xrpl_result.get("execution_mode"),
            "execution_status": xrpl_result.get("execution_status"),
            "policy_decision": policy_result["policy_decision"],
            "risk_score": risk_score,
            "fx_saving": fx_saving,
            "approved_by": request.approved_by,
        }
        db.add_audit_event("direct_transfer_executed", event)
        audit.add_audit_entry("direct_transfer_executed", event)

        return {
            "success": True,
            "audit_id": audit_id,
            "action_type": "direct_transfer",
            "transfer": transfer,
            "xrpl": xrpl_result,
            "credit_line": None,
            "fx_saving_usd": fx_saving,
            "policy": policy_result,
            "risk": risk_result,
            "updated_balances": {
                sub_id: db.SUBSIDIARIES[sub_id]["rlusd_balance"]
                for sub_id in [request.from_id, request.to_id]
            },
        }

    # ── 3B: Vault Credit Line (XLS-66-inspired) ───────────────────────────────
    elif request.action_type == "vault_credit":
        if db.CORPORATE_VAULT["available"] < request.amount:
            raise HTTPException(
                status_code=400,
                detail=f"Vault insufficient: {db.CORPORATE_VAULT['available']:,.0f} RLUSD available, {request.amount:,.0f} requested",
            )

        xrpl_result = await vault_credit_draw_onchain(
            to_id=request.to_id,
            amount=request.amount,
            audit_id=audit_id,
        )

        db.CORPORATE_VAULT["available"] -= request.amount
        db.CORPORATE_VAULT["committed"] += request.amount
        db.SUBSIDIARIES[request.to_id]["rlusd_balance"] += request.amount

        # Apply risk-adjusted rate
        adjusted_rate = request.rate_pct * policy_result.get("adjusted_rate_multiplier", 1.0)
        due_date = (datetime.now() + timedelta(days=request.term_days)).isoformat()

        credit_line = {
            "id": f"CL_{request.to_id.upper()}_{len(db.ACTIVE_CREDIT_LINES):03d}",
            "audit_id": audit_id,
            "borrower": request.to_id,
            "lender": "corp_vault",
            "amount": request.amount,
            "currency": "RLUSD",
            "term_days": request.term_days,
            "rate_pct": round(adjusted_rate, 4),
            "base_rate_pct": request.rate_pct,
            "risk_multiplier": policy_result.get("adjusted_rate_multiplier", 1.0),
            "xrpl_instrument": xrpl_result.get(
                "xrpl_instrument", "XLS-66-inspired Credit Line abstraction"
            ),
            "vault_id": xrpl_result.get("vault_id"),
            "status": "active",
            "execution_mode": xrpl_result.get("execution_mode", "SIMULATED"),
            "execution_status": xrpl_result.get("execution_status", "SIMULATED"),
            "simulated": xrpl_result.get("simulated", True),
            "tx_hash": xrpl_result.get("tx_hash"),
            "timestamp": datetime.now().isoformat(),
            "due_date": due_date,
            "approved_by": request.approved_by,
            "risk_score": risk_score,
            "risk_level": risk_level,
            "policy_decision": policy_result["policy_decision"],
        }
        db.ACTIVE_CREDIT_LINES.append(credit_line)
        db.CORPORATE_VAULT["active_credit_lines"] = len(db.ACTIVE_CREDIT_LINES)
        audit.add_credit_line(credit_line)

        transfer = _build_transfer_record(
            audit_id=audit_id,
            from_id="corp_vault",
            to_id=request.to_id,
            amount=request.amount,
            xrpl_result=xrpl_result,
            fx_saving=fx_saving,
            action_type="vault_credit",
            reasoning=request.reasoning,
            approved_by=request.approved_by,
            ai_confidence=request.confidence,
            policy_decision=policy_result["policy_decision"],
            approval_level=policy_result["approval_level"],
            risk_score=risk_score,
            risk_level=risk_level,
            extra={"term_days": request.term_days, "rate_pct": round(adjusted_rate, 4)},
        )
        db.TRANSFER_HISTORY.append(transfer)
        audit.add_transfer(transfer)
        _update_statuses(request.to_id)

        event = {
            "audit_id": audit_id,
            "credit_line_id": credit_line["id"],
            "borrower": request.to_id,
            "amount": request.amount,
            "term_days": request.term_days,
            "rate_pct": round(adjusted_rate, 4),
            "base_rate_pct": request.rate_pct,
            "risk_multiplier": policy_result.get("adjusted_rate_multiplier", 1.0),
            "tx_hash": xrpl_result.get("tx_hash"),
            "execution_mode": xrpl_result.get("execution_mode"),
            "policy_decision": policy_result["policy_decision"],
            "risk_score": risk_score,
            "risk_level": risk_level,
            "approved_by": request.approved_by,
        }
        db.add_audit_event("vault_credit_issued", event)
        audit.add_audit_entry("vault_credit_issued", event)

        return {
            "success": True,
            "audit_id": audit_id,
            "action_type": "vault_credit",
            "transfer": transfer,
            "xrpl": xrpl_result,
            "credit_line": credit_line,
            "fx_saving_usd": fx_saving,
            "policy": policy_result,
            "risk": risk_result,
            "updated_balances": {
                request.to_id: db.SUBSIDIARIES[request.to_id]["rlusd_balance"],
            },
        }

    else:
        raise HTTPException(status_code=400, detail=f"Unknown action_type: {request.action_type}")


@app.get("/api/audit")
async def get_audit():
    transfers = list(reversed(db.TRANSFER_HISTORY))
    return {
        "audit_log": list(reversed(db.AUDIT_LOG)),
        "transfer_history": transfers,
        "total_transfers": len(db.TRANSFER_HISTORY),
        "total_fx_saved": sum(t.get("fx_saving", 0) for t in db.TRANSFER_HISTORY),
        "direct_transfers": sum(1 for t in db.TRANSFER_HISTORY if t.get("action_type") == "direct_transfer"),
        "vault_credits": sum(1 for t in db.TRANSFER_HISTORY if t.get("action_type") == "vault_credit"),
        "active_credit_lines": db.ACTIVE_CREDIT_LINES,
    }


@app.get("/api/vault")
async def get_vault():
    active = [cl for cl in db.ACTIVE_CREDIT_LINES if cl.get("status") in ("active", "active_simulated")]
    expected_interest = sum(
        cl["amount"] * cl["rate_pct"] / 100 * cl["term_days"] / 365
        for cl in active
    )
    onchain = await get_vault_onchain_info()
    return {
        **db.CORPORATE_VAULT,
        "active_credit_lines_count": len(active),
        "active_credit_lines": db.ACTIVE_CREDIT_LINES,
        "expected_interest_income": round(expected_interest, 2),
        "vault_onchain": xrpl_service.VAULT_ONCHAIN,
        "onchain": onchain,
        "xrpl_primitive": (
            "XLS-65 Single Asset Vault (live on-chain object)"
            if xrpl_service.VAULT_ONCHAIN
            else "XLS-65-inspired Vault abstraction (on-chain vault unavailable)"
        ),
        "lending_primitive": (
            "Credit lines funded via on-chain XLS-65 VaultWithdraw; "
            "terms/interest tracked as XLS-66-ready abstraction"
            if xrpl_service.VAULT_ONCHAIN
            else "XLS-66-inspired Credit Line abstraction"
        ),
        "accounting_note": (
            "Deposits and credit draws are validated XLS-65 vault transactions on Devnet."
            if xrpl_service.VAULT_ONCHAIN
            else "Vault flows settle as validated RLUSD token payments. Migration-ready for native XLS-65 vault objects."
        ),
    }


@app.post("/api/vault/deposit")
async def vault_deposit(request: VaultDepositRequest):
    if request.subsidiary_id not in db.SUBSIDIARIES:
        raise HTTPException(status_code=400, detail="Unknown subsidiary")
    sub = db.SUBSIDIARIES[request.subsidiary_id]
    if sub["rlusd_balance"] < request.amount:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient balance: {sub['name']} has {sub['rlusd_balance']:,.0f} RLUSD",
        )
    if db.CORPORATE_VAULT["available"] + request.amount > db.CORPORATE_VAULT["total_capacity"]:
        raise HTTPException(status_code=400, detail="Vault capacity exceeded")

    audit_id = _next_audit_id()
    xrpl_result = await vault_deposit_onchain(
        subsidiary_id=request.subsidiary_id,
        amount=request.amount,
        audit_id=audit_id,
    )

    db.SUBSIDIARIES[request.subsidiary_id]["rlusd_balance"] -= request.amount
    db.SUBSIDIARIES[request.subsidiary_id]["status"] = db.get_subsidiary_status(request.subsidiary_id)
    db.CORPORATE_VAULT["available"] += request.amount
    db.CORPORATE_VAULT["deposited_total"] = db.CORPORATE_VAULT.get("deposited_total", 0) + request.amount

    deposit = {
        "id": f"dep_{len(db.VAULT_DEPOSITS):03d}",
        "audit_id": audit_id,
        "subsidiary_id": request.subsidiary_id,
        "subsidiary_name": sub["name"],
        "amount": request.amount,
        "currency": "RLUSD",
        "timestamp": datetime.now().isoformat(),
        "tx_hash": xrpl_result.get("tx_hash"),
        "execution_mode": xrpl_result.get("execution_mode", "SIMULATED"),
        "execution_status": xrpl_result.get("execution_status", "SIMULATED"),
        "simulated": xrpl_result.get("simulated", False),
        "explorer_url": xrpl_result.get("explorer_url"),
        "vault_tx_hash": xrpl_result.get("vault_tx_hash"),
        "vault_explorer_url": xrpl_result.get("vault_explorer_url"),
        "approved_by": request.approved_by,
    }
    db.VAULT_DEPOSITS.append(deposit)
    audit.add_vault_deposit(deposit)

    event = {
        "audit_id": audit_id,
        "deposit_id": deposit["id"],
        "subsidiary": request.subsidiary_id,
        "amount": request.amount,
        "tx_hash": xrpl_result.get("tx_hash"),
        "execution_mode": xrpl_result.get("execution_mode"),
        "execution_status": xrpl_result.get("execution_status"),
    }
    db.add_audit_event("vault_deposit", event)
    audit.add_audit_entry("vault_deposit", event)

    return {
        "success": True,
        "audit_id": audit_id,
        "deposit": deposit,
        "xrpl": xrpl_result,
        "vault": {**db.CORPORATE_VAULT, "active_credit_lines_count": len(db.ACTIVE_CREDIT_LINES)},
        "subsidiary_balance": db.SUBSIDIARIES[request.subsidiary_id]["rlusd_balance"],
    }


@app.get("/api/vault/deposits")
async def get_vault_deposits():
    return {
        "deposits": list(reversed(db.VAULT_DEPOSITS)),
        "total_deposited": sum(d["amount"] for d in db.VAULT_DEPOSITS),
        "count": len(db.VAULT_DEPOSITS),
    }


@app.get("/api/credit-lines")
async def get_credit_lines():
    return {
        "active": db.ACTIVE_CREDIT_LINES,
        "count": len(db.ACTIVE_CREDIT_LINES),
        "total_committed": sum(
            cl["amount"] for cl in db.ACTIVE_CREDIT_LINES
            if cl.get("status") in ("active", "active_simulated")
        ),
    }


@app.post("/api/credit-lines/{credit_line_id}/repay")
async def repay_credit_line(credit_line_id: str, request: CreditLineActionRequest):
    cl = next((c for c in db.ACTIVE_CREDIT_LINES if c["id"] == credit_line_id), None)
    if not cl:
        raise HTTPException(status_code=404, detail=f"Credit line not found: {credit_line_id}")
    if cl["status"] not in ("active", "active_simulated"):
        raise HTTPException(status_code=400, detail=f"Credit line is not active (status: {cl['status']})")

    borrower_id = cl["borrower"]
    amount = cl["amount"]
    if db.SUBSIDIARIES[borrower_id]["rlusd_balance"] < amount:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient balance for repayment: {db.SUBSIDIARIES[borrower_id]['name']} has {db.SUBSIDIARIES[borrower_id]['rlusd_balance']:,.0f} RLUSD",
        )

    audit_id = _next_audit_id()
    xrpl_result = await vault_repay_via_escrow(
        from_id=borrower_id,
        amount=amount,
        audit_id=audit_id,
    )

    db.SUBSIDIARIES[borrower_id]["rlusd_balance"] -= amount
    db.SUBSIDIARIES[borrower_id]["status"] = db.get_subsidiary_status(borrower_id)
    db.CORPORATE_VAULT["available"] += amount
    db.CORPORATE_VAULT["committed"] = max(0.0, db.CORPORATE_VAULT["committed"] - amount)

    cl["status"] = "repaid"
    cl["repaid_at"] = datetime.now().isoformat()
    cl["repayment_tx_hash"] = xrpl_result.get("tx_hash")
    cl["repayment_audit_id"] = audit_id
    cl["repayment_mode"] = xrpl_result.get("execution_mode")
    cl["repayment_escrow_explorer_url"] = xrpl_result.get("escrow_create_explorer_url")
    cl["repayment_release_explorer_url"] = xrpl_result.get("escrow_finish_explorer_url")
    cl["repayment_vault_explorer_url"] = xrpl_result.get("vault_explorer_url")
    audit.update_credit_line(credit_line_id, {
        "status": "repaid",
        "repaid_at": cl["repaid_at"],
        "repayment_mode": cl["repayment_mode"],
        "repayment_escrow_explorer_url": cl["repayment_escrow_explorer_url"],
        "repayment_release_explorer_url": cl["repayment_release_explorer_url"],
    })

    event = {
        "audit_id": audit_id,
        "credit_line_id": credit_line_id,
        "borrower": borrower_id,
        "amount": amount,
        "tx_hash": xrpl_result.get("tx_hash"),
        "execution_mode": xrpl_result.get("execution_mode"),
        "approved_by": request.approved_by,
    }
    db.add_audit_event("credit_line_repaid", event)
    audit.add_audit_entry("credit_line_repaid", event)

    return {"success": True, "credit_line": cl, "xrpl": xrpl_result, "vault_available": db.CORPORATE_VAULT["available"]}


@app.post("/api/credit-lines/{credit_line_id}/default")
async def default_credit_line(credit_line_id: str, request: CreditLineActionRequest):
    cl = next((c for c in db.ACTIVE_CREDIT_LINES if c["id"] == credit_line_id), None)
    if not cl:
        raise HTTPException(status_code=404, detail=f"Credit line not found: {credit_line_id}")
    if cl["status"] not in ("active", "active_simulated", "overdue"):
        raise HTTPException(status_code=400, detail=f"Cannot default (status: {cl['status']})")

    audit_id = _next_audit_id()
    amount = cl["amount"]
    db.CORPORATE_VAULT["committed"] = max(0.0, db.CORPORATE_VAULT["committed"] - amount)

    cl["status"] = "defaulted"
    cl["defaulted_at"] = datetime.now().isoformat()
    cl["default_audit_id"] = audit_id
    audit.update_credit_line(credit_line_id, {"status": "defaulted", "defaulted_at": cl["defaulted_at"]})

    event = {
        "audit_id": audit_id,
        "credit_line_id": credit_line_id,
        "borrower": cl["borrower"],
        "amount": amount,
        "loss_recognized": amount,
        "approved_by": request.approved_by,
    }
    db.add_audit_event("credit_line_defaulted", event)
    audit.add_audit_entry("credit_line_defaulted", event)

    return {"success": True, "credit_line": cl, "vault_available": db.CORPORATE_VAULT["available"], "loss_recognized": amount}


@app.get("/api/risk-scores")
async def get_risk_scores():
    scores = calculate_all_risks(db.SUBSIDIARIES, db.ACTIVE_CREDIT_LINES)
    return {
        "scores": scores,
        "timestamp": datetime.now().isoformat(),
        "methodology": "Country risk baseline + deficit severity + credit line exposure + liquidity pressure",
        "scale": "0 (lowest risk) — 100 (highest risk)",
        "levels": {"low": "0–30", "medium": "31–70", "high": "71–100"},
    }


@app.get("/api/policy")
async def get_policy():
    from policy_engine import POLICY, WHITELISTED_ENTITIES
    return {
        "policy": POLICY,
        "whitelisted_entities": list(WHITELISTED_ENTITIES),
        "approval_levels": {
            "AUTO": f"Amount < {POLICY['treasury_manager_threshold']:,} RLUSD",
            "TREASURY_MANAGER": f"{POLICY['treasury_manager_threshold']:,} – {POLICY['cfo_threshold']:,} RLUSD",
            "CFO_REQUIRED": f"> {POLICY['cfo_threshold']:,} RLUSD",
        },
        "version": "1.0",
    }


@app.get("/api/scenarios")
async def list_scenarios():
    return {"scenarios": get_all_scenarios()}


@app.post("/api/scenario/liquidity-shock")
async def trigger_scenario(request: ScenarioRequest):
    try:
        result = apply_scenario(request.scenario_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    audit.add_audit_entry("scenario_applied", {
        "scenario_id": request.scenario_id,
        "scenario_name": result["scenario_name"],
        "severity": result["severity"],
        "affected_entities": result["affected_entities"],
        "new_deficits": result["new_deficits"],
    })
    db.add_audit_event("scenario_applied", {"scenario_id": request.scenario_id, "scenario_name": result["scenario_name"]})
    return result


@app.get("/api/wallets")
async def get_wallets():
    onchain = await get_onchain_rlusd_balances()
    return {
        "subsidiaries": {
            sub_id: {
                "name": sub["name"],
                "address": sub.get("wallet_address", "Initializing..."),
                "explorer_url": explorer_account_url(sub.get("wallet_address") or ""),
                "balance": sub["rlusd_balance"],
                "onchain_rlusd": onchain.get(sub_id),
                "status": sub["status"],
            }
            for sub_id, sub in db.SUBSIDIARIES.items()
        },
        "corporate_vault": {
            "name": db.CORPORATE_VAULT["name"],
            "address": db.CORPORATE_VAULT.get("wallet_address", "Initializing..."),
            "explorer_url": explorer_account_url(db.CORPORATE_VAULT.get("wallet_address") or ""),
            "available": db.CORPORATE_VAULT["available"],
            "onchain_rlusd": onchain.get("corporate_vault"),
            "committed": db.CORPORATE_VAULT["committed"],
        },
        "issuer": {
            "name": "TreasuryMind RLUSD Issuer",
            "address": xrpl_service.issuer_address() or "Initializing...",
            "explorer_url": explorer_account_url(xrpl_service.issuer_address() or ""),
            "currency_code": xrpl_service.RLUSD_CURRENCY,
            "trustlines": len(xrpl_service.TRUSTLINES),
        },
        "network": "XRPL Devnet",
        "rlusd_token_live": xrpl_service.RLUSD_READY,
        "settlement_asset": "RLUSD (issued IOU on XRPL Devnet)" if xrpl_service.RLUSD_READY else "RLUSD (accounting layer — token issuance unavailable)",
        "note": (
            "RLUSD is issued on-chain at startup: issuer wallet, trustlines per entity, "
            "seed distribution. Transfers settle as validated token payments for the full amount. "
            "Mainnet path: swap issuer address for the official RLUSD issuer."
        ),
    }


@app.get("/api/fx-rates")
async def get_fx_rates():
    return db.FX_RATES


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _build_transfer_record(
    audit_id: str,
    from_id: str,
    to_id: str,
    amount: float,
    xrpl_result: dict,
    fx_saving: float,
    action_type: str,
    reasoning: str,
    approved_by: str,
    ai_confidence: float = 0.0,
    policy_decision: str = "APPROVED",
    approval_level: str = "TREASURY_MANAGER",
    risk_score: int = 0,
    risk_level: str = "low",
    extra: dict = None,
) -> dict:
    record = {
        "id": f"tx_{len(db.TRANSFER_HISTORY):03d}",
        "audit_id": audit_id,
        "from": from_id,
        "to": to_id,
        "amount": amount,
        "currency": "RLUSD",
        "action_type": action_type,
        "timestamp": datetime.now().isoformat(),
        "tx_hash": xrpl_result.get("tx_hash"),
        "execution_mode": xrpl_result.get("execution_mode", "SIMULATED"),
        "execution_status": xrpl_result.get("execution_status", "SIMULATED"),
        "status": "completed",
        "simulated": xrpl_result.get("simulated", False),
        "fx_saving": fx_saving,
        "reason": reasoning,
        "approved_by": approved_by,
        "ai_confidence": ai_confidence,
        "policy_decision": policy_decision,
        "approval_level": approval_level,
        "risk_score": risk_score,
        "risk_level": risk_level,
        "explorer_url": xrpl_result.get("explorer_url"),
        "from_address": xrpl_result.get("from_address"),
        "to_address": xrpl_result.get("to_address"),
        "settlement_asset": xrpl_result.get("settlement_asset", "RLUSD"),
        "validated": xrpl_result.get("validated", False),
        "xrpl_instrument": (
            "XLS-66-inspired Credit Line abstraction"
            if action_type == "vault_credit"
            else "RLUSD Issued-Token Transfer (Devnet IOU)"
        ),
    }
    if extra:
        record.update(extra)
    return record


def _update_statuses(*sub_ids: str):
    for sub_id in sub_ids:
        if sub_id in db.SUBSIDIARIES:
            db.SUBSIDIARIES[sub_id]["status"] = db.get_subsidiary_status(sub_id)


# ─── Supplier Liquidity Network (Experimental) ────────────────────────────────

@app.get("/api/suppliers")
async def list_suppliers():
    """Return all supplier partners with trust and risk data."""
    return {
        "suppliers": list(sup_svc.SUPPLIERS.values()),
        "total": len(sup_svc.SUPPLIERS),
        "verified": sum(1 for s in sup_svc.SUPPLIERS.values() if s["trust_status"] == "VERIFIED"),
        "pending": sum(1 for s in sup_svc.SUPPLIERS.values() if s["trust_status"] == "PENDING_REVIEW"),
        "blocked": sum(1 for s in sup_svc.SUPPLIERS.values() if s["trust_status"] == "BLOCKED"),
        "total_requested": sum(s["requested_liquidity"] for s in sup_svc.SUPPLIERS.values()),
        "approved_exposure": sum(s["current_exposure"] for s in sup_svc.SUPPLIERS.values()),
        "note": "Experimental module — prototype abstraction. Not a production lending system.",
        "timestamp": datetime.now().isoformat(),
    }


@app.get("/api/suppliers/{supplier_id}")
async def get_supplier(supplier_id: str):
    if supplier_id not in sup_svc.SUPPLIERS:
        raise HTTPException(status_code=404, detail=f"Supplier not found: {supplier_id}")
    return sup_svc.SUPPLIERS[supplier_id]


@app.post("/api/suppliers/{supplier_id}/analyze")
async def analyze_supplier(supplier_id: str):
    """
    Run deterministic supplier liquidity analysis.
    Returns AI-style recommendation + policy checks.
    """
    if supplier_id not in sup_svc.SUPPLIERS:
        raise HTTPException(status_code=404, detail=f"Supplier not found: {supplier_id}")
    try:
        result = sup_svc.analyze_supplier_request(
            supplier_id=supplier_id,
            vault_available=db.CORPORATE_VAULT["available"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    audit_id = _next_audit_id()
    sup_svc.SUPPLIER_AUDIT_LOG.append({
        "timestamp": datetime.now().isoformat(),
        "type": "SUPPLIER_CREDIT_ANALYSIS",
        "audit_id": audit_id,
        "supplier_id": supplier_id,
        "supplier_name": sup_svc.SUPPLIERS[supplier_id]["name"],
        "recommended_decision": result["recommended_decision"],
        "risk_score": result["policy"]["risk_score"],
    })
    db.add_audit_event("supplier_analysis", {
        "audit_id": audit_id,
        "supplier_id": supplier_id,
        "recommended_decision": result["recommended_decision"],
    })
    return result


@app.post("/api/suppliers/{supplier_id}/approve-credit")
async def approve_supplier_credit(supplier_id: str, request: SupplierCreditRequest):
    """
    Approve and execute a supplier credit line if policy allows.
    Uses the same XRPL execution proof as internal transfers.
    """
    if supplier_id not in sup_svc.SUPPLIERS:
        raise HTTPException(status_code=404, detail=f"Supplier not found: {supplier_id}")

    s = sup_svc.SUPPLIERS[supplier_id]
    amount = request.amount or s["requested_liquidity"]
    term_days = request.term_days or min(14, s["max_term_days"])

    # Policy check
    policy = sup_svc.validate_supplier_request(supplier_id, db.CORPORATE_VAULT["available"])
    if not policy["approved"]:
        audit_id = _next_audit_id()
        sup_svc.SUPPLIER_AUDIT_LOG.append({
            "timestamp": datetime.now().isoformat(),
            "type": "SUPPLIER_CREDIT_BLOCKED",
            "audit_id": audit_id,
            "supplier_id": supplier_id,
            "supplier_name": s["name"],
            "blocking_reasons": policy["blocking_reasons"],
        })
        db.add_audit_event("supplier_credit_blocked", {
            "audit_id": audit_id,
            "supplier_id": supplier_id,
            "blocking_reasons": policy["blocking_reasons"],
        })
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Supplier credit blocked by compliance policy.",
                "policy_decision": policy["policy_decision"],
                "blocking_reasons": policy["blocking_reasons"],
                "decision_summary": policy["decision_summary"],
                "policy": policy,
            },
        )

    audit_id = _next_audit_id()
    rate = policy["adjusted_rate_pct"]

    # Build memo for XRPL proof
    memo_text = f"TreasuryMind|audit={audit_id}|type=supplier_credit|partner={supplier_id}|amount={int(amount)}|ccy=RLUSD"

    # Suppliers don't have Devnet wallets — use "zurich" as proof destination.
    # The memo encodes the real route (corp_vault → supplier).
    xrpl_result = await execute_payment(
        from_id="corporate_vault",
        to_id="zurich",
        amount_rlusd=amount,
        memo_text=memo_text,
        audit_id=audit_id,
        tx_type="supplier_credit",
    )

    # Deduct vault liquidity
    db.CORPORATE_VAULT["available"] = max(0.0, db.CORPORATE_VAULT["available"] - amount)

    credit_line = sup_svc.issue_supplier_credit(
        supplier_id=supplier_id,
        amount=amount,
        term_days=term_days,
        rate_pct=rate,
        vault_available=db.CORPORATE_VAULT["available"],
        audit_id=audit_id,
        xrpl_result=xrpl_result,
        approved_by=request.approved_by,
    )

    # Build transfer record for audit trail
    transfer = {
        "id": f"sup_{len(db.TRANSFER_HISTORY):03d}",
        "audit_id": audit_id,
        "from": "corp_vault",
        "to": supplier_id,
        "amount": amount,
        "currency": "RLUSD",
        "action_type": "supplier_credit",
        "timestamp": datetime.now().isoformat(),
        "tx_hash": xrpl_result.get("tx_hash"),
        "execution_mode": xrpl_result.get("execution_mode", "SIMULATED"),
        "execution_status": xrpl_result.get("execution_status", "SIMULATED"),
        "status": "completed",
        "simulated": xrpl_result.get("simulated", True),
        "fx_saving": 0,
        "reason": f"Supplier working capital — {s['purpose']}",
        "approved_by": request.approved_by,
        "ai_confidence": 85.0,
        "policy_decision": policy["policy_decision"],
        "approval_level": policy["approval_level"],
        "risk_score": s["risk_score"],
        "risk_level": s["risk_level"],
        "explorer_url": xrpl_result.get("explorer_url"),
        "xrpl_instrument": "Supplier Credit Line",
        "supplier_name": s["name"],
    }
    db.TRANSFER_HISTORY.append(transfer)
    audit.add_transfer(transfer)

    db.add_audit_event("supplier_credit_executed", {
        "audit_id": audit_id,
        "supplier_id": supplier_id,
        "supplier_name": s["name"],
        "amount": amount,
        "tx_hash": xrpl_result.get("tx_hash"),
        "execution_mode": xrpl_result.get("execution_mode"),
        "policy_decision": policy["policy_decision"],
        "approved_by": request.approved_by,
    })

    return {
        "success": True,
        "audit_id": audit_id,
        "action_type": "supplier_credit",
        "credit_line": credit_line,
        "transfer": transfer,
        "xrpl": xrpl_result,
        "policy": policy,
        "vault_available": db.CORPORATE_VAULT["available"],
    }


@app.get("/api/supplier-credit-lines")
async def get_supplier_credit_lines():
    return {
        "credit_lines": list(reversed(sup_svc.SUPPLIER_CREDIT_LINES)),
        "total": len(sup_svc.SUPPLIER_CREDIT_LINES),
        "active": sum(1 for c in sup_svc.SUPPLIER_CREDIT_LINES if c["status"] == "ACTIVE"),
    }


@app.post("/api/supplier-credit-lines/{credit_line_id}/repay")
async def repay_supplier_credit(credit_line_id: str, request: CreditLineActionRequest):
    cl = next((c for c in sup_svc.SUPPLIER_CREDIT_LINES if c["id"] == credit_line_id), None)
    if not cl:
        raise HTTPException(status_code=404, detail=f"Supplier credit line not found: {credit_line_id}")
    if cl["status"] != "ACTIVE":
        raise HTTPException(status_code=400, detail=f"Credit line status is {cl['status']}")

    audit_id = _next_audit_id()
    cl["status"] = "REPAID"
    cl["repaid_at"] = datetime.now().isoformat()

    db.CORPORATE_VAULT["available"] = min(
        db.CORPORATE_VAULT["total_capacity"],
        db.CORPORATE_VAULT["available"] + cl["amount"],
    )

    sup_id = cl["supplier_id"]
    if sup_id in sup_svc.SUPPLIERS:
        sup_svc.SUPPLIERS[sup_id]["current_exposure"] = max(
            0.0, sup_svc.SUPPLIERS[sup_id]["current_exposure"] - cl["amount"]
        )
        sup_svc.SUPPLIERS[sup_id]["approval_status"] = "NOT_REQUESTED"

    sup_svc.SUPPLIER_AUDIT_LOG.append({
        "timestamp": datetime.now().isoformat(),
        "type": "SUPPLIER_CREDIT_REPAID",
        "audit_id": audit_id,
        "credit_line_id": credit_line_id,
        "supplier_id": sup_id,
        "amount": cl["amount"],
        "approved_by": request.approved_by,
    })
    db.add_audit_event("supplier_credit_repaid", {"audit_id": audit_id, "credit_line_id": credit_line_id})

    return {"success": True, "credit_line": cl, "vault_available": db.CORPORATE_VAULT["available"]}


@app.get("/api/supplier-audit")
async def get_supplier_audit():
    return {
        "entries": list(reversed(sup_svc.SUPPLIER_AUDIT_LOG)),
        "total": len(sup_svc.SUPPLIER_AUDIT_LOG),
    }
