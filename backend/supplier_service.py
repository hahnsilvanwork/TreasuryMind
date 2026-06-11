"""
Supplier Liquidity Network — Experimental Extension Module

Demonstrates how TreasuryMind's controlled infrastructure can extend
to verified suppliers and strategic partners for B2B working capital.

This is a prototype / proof-of-concept, not a production lending system.
All supplier balances and credit lines are simulated.
"""
import secrets
from datetime import datetime, timedelta
from copy import deepcopy

# ── Static Supplier Catalog ───────────────────────────────────────────────────

SUPPLIERS: dict[str, dict] = {
    "brazil_cocoa_supplier": {
        "id": "brazil_cocoa_supplier",
        "name": "Brazil Cocoa Supplier",
        "short_name": "BCS",
        "type": "Raw Material Provider",
        "location": "Brazil",
        "flag": "🇧🇷",
        "wallet_address": None,
        "requested_liquidity": 150_000.0,
        "purpose": "Working capital for next cocoa shipment",
        "trust_status": "VERIFIED",
        "credential_status": "ACTIVE",
        "risk_score": 72,
        "risk_level": "high",
        "credit_limit": 250_000.0,
        "current_exposure": 0.0,
        "allowed_currencies": ["RLUSD"],
        "max_term_days": 30,
        "last_review_date": "2026-05-15",
        "strategic_importance": "Critical cocoa supply chain — 40% of raw material volume",
        "approval_status": "NOT_REQUESTED",
    },
    "swiss_packaging_partner": {
        "id": "swiss_packaging_partner",
        "name": "Swiss Packaging Partner",
        "short_name": "SPP",
        "type": "Packaging Supplier",
        "location": "Switzerland",
        "flag": "🇨🇭",
        "wallet_address": None,
        "requested_liquidity": 80_000.0,
        "purpose": "Short-term production financing",
        "trust_status": "VERIFIED",
        "credential_status": "ACTIVE",
        "risk_score": 28,
        "risk_level": "low",
        "credit_limit": 200_000.0,
        "current_exposure": 40_000.0,
        "allowed_currencies": ["RLUSD"],
        "max_term_days": 14,
        "last_review_date": "2026-06-01",
        "strategic_importance": "Primary packaging provider for European operations",
        "approval_status": "NOT_REQUESTED",
    },
    "latam_logistics_provider": {
        "id": "latam_logistics_provider",
        "name": "LATAM Logistics Provider",
        "short_name": "LLP",
        "type": "Logistics Partner",
        "location": "Mexico",
        "flag": "🇲🇽",
        "wallet_address": None,
        "requested_liquidity": 300_000.0,
        "purpose": "Transport capacity pre-financing",
        "trust_status": "PENDING_REVIEW",
        "credential_status": "MISSING",
        "risk_score": 86,
        "risk_level": "high",
        "credit_limit": 100_000.0,
        "current_exposure": 60_000.0,
        "allowed_currencies": ["RLUSD"],
        "max_term_days": 30,
        "last_review_date": "2026-04-20",
        "strategic_importance": "LATAM distribution network — pending compliance review",
        "approval_status": "NOT_REQUESTED",
    },
}

# Active supplier credit lines
SUPPLIER_CREDIT_LINES: list[dict] = []

# Supplier audit entries
SUPPLIER_AUDIT_LOG: list[dict] = []

# ── Supplier Policy Engine ────────────────────────────────────────────────────

SUPPLIER_POLICY = {
    "max_risk_score_absolute": 85,
    "max_risk_score_warning": 70,
    "base_rate_pct": 3.0,
    "risk_multiplier_low": 1.0,
    "risk_multiplier_medium": 1.5,
    "risk_multiplier_high": 2.0,
    "min_term_days": 1,
    "max_term_days_default": 30,
}


def validate_supplier_request(supplier_id: str, vault_available: float) -> dict:
    """
    Run all supplier-specific policy checks.
    Returns structured compliance result with APPROVED / APPROVED_WITH_WARNING / BLOCKED.
    """
    if supplier_id not in SUPPLIERS:
        return _blocked_result([f"Supplier '{supplier_id}' not found."])

    s = SUPPLIERS[supplier_id]
    checks = []
    blocking_reasons = []
    warning_reasons = []

    def _check(name: str, passed: bool, reason: str = "", warning: bool = False):
        if passed:
            checks.append({"name": name, "status": "passed", "reason": ""})
        elif warning:
            checks.append({"name": name, "status": "warning", "reason": reason})
            if reason:
                warning_reasons.append(reason)
        else:
            checks.append({"name": name, "status": "failed", "reason": reason})
            if reason:
                blocking_reasons.append(reason)
        return passed

    amt = s["requested_liquidity"]
    exposure_after = s["current_exposure"] + amt

    # 1. Trust status
    _check("Partner identity is verified",
           s["trust_status"] == "VERIFIED",
           f"Trust status is '{s['trust_status']}'. Partner must be VERIFIED before receiving liquidity.")

    # 2. Credential status
    _check("Active credential on file",
           s["credential_status"] == "ACTIVE",
           f"Credential status is '{s['credential_status']}'. An active credential is required.")

    # 3. Credit limit — requested amount alone
    _check("Requested amount within credit limit",
           amt <= s["credit_limit"],
           f"Requested {amt:,.0f} RLUSD exceeds credit limit of {s['credit_limit']:,.0f} RLUSD.")

    # 4. Total exposure check
    _check("Total exposure within credit limit",
           exposure_after <= s["credit_limit"],
           f"Total exposure after issuance would be {exposure_after:,.0f} RLUSD, exceeding limit of {s['credit_limit']:,.0f} RLUSD.")

    # 5. Hard risk block
    hard_block = s["risk_score"] > SUPPLIER_POLICY["max_risk_score_absolute"]
    _check("Risk score within hard block threshold",
           not hard_block,
           f"Risk score {s['risk_score']}/100 exceeds absolute limit of {SUPPLIER_POLICY['max_risk_score_absolute']}. Request blocked.")

    # 6. Elevated risk warning
    if not hard_block and s["risk_score"] > SUPPLIER_POLICY["max_risk_score_warning"]:
        _check("Elevated risk — enhanced due diligence",
               True,
               warning=False)
        checks[-1]["status"] = "warning"
        warn = f"Risk score {s['risk_score']}/100 is elevated (threshold: {SUPPLIER_POLICY['max_risk_score_warning']}). Higher rate multiplier will apply."
        checks[-1]["reason"] = warn
        warning_reasons.append(warn)

    # 7. Vault liquidity
    _check("Corporate Vault has sufficient liquidity",
           vault_available >= amt,
           f"Vault available {vault_available:,.0f} RLUSD — requested {amt:,.0f} RLUSD not possible.")

    # 8. Purpose validation
    _check("Purpose is business-related", True)  # always passes in prototype

    # 9. Human approval required
    checks.append({"name": "Human approval required for all external partner funding", "status": "passed", "reason": ""})

    # 10. Audit trail
    checks.append({"name": "Audit trail entry will be created and persisted", "status": "passed", "reason": ""})

    approved = len(blocking_reasons) == 0

    # Risk-adjusted rate
    multiplier = {
        "low": SUPPLIER_POLICY["risk_multiplier_low"],
        "medium": SUPPLIER_POLICY["risk_multiplier_medium"],
        "high": SUPPLIER_POLICY["risk_multiplier_high"],
    }.get(s["risk_level"], 1.0)
    final_rate = SUPPLIER_POLICY["base_rate_pct"] * multiplier

    if not approved:
        policy_decision = "BLOCKED"
    elif warning_reasons:
        policy_decision = "APPROVED_WITH_WARNING"
    else:
        policy_decision = "APPROVED"

    approval_level = "CFO_REQUIRED" if amt > 200_000 else "TREASURY_MANAGER"

    if policy_decision == "BLOCKED":
        decision_summary = f"Request blocked. {'; '.join(blocking_reasons)}"
    elif policy_decision == "APPROVED_WITH_WARNING":
        decision_summary = (
            f"Approved with conditions. Risk score {s['risk_score']}/100 — {s['risk_level']} risk profile. "
            f"Rate adjusted to {final_rate:.1f}% p.a. ({multiplier}× multiplier). Treasury Manager approval required."
        )
    else:
        decision_summary = f"Approved. Rate: {final_rate:.1f}% p.a. Approval level: {approval_level}."

    return {
        "approved": approved,
        "policy_decision": policy_decision,
        "approval_level": approval_level,
        "checks": checks,
        "blocking_reasons": blocking_reasons,
        "warning_reasons": warning_reasons,
        "risk_level": s["risk_level"],
        "risk_score": s["risk_score"],
        "adjusted_rate_pct": round(final_rate, 2),
        "rate_multiplier": multiplier,
        "base_rate_pct": SUPPLIER_POLICY["base_rate_pct"],
        "decision_summary": decision_summary,
        "requires_human_approval": True,
        "policy_version": "supplier-1.0",
        "validated_at": datetime.now().isoformat(),
    }


def analyze_supplier_request(supplier_id: str, vault_available: float) -> dict:
    """
    Deterministic fallback analysis for supplier liquidity requests.
    Returns structured recommendation with summary, pros, cons, policy notes.
    """
    if supplier_id not in SUPPLIERS:
        raise ValueError(f"Supplier not found: {supplier_id}")

    s = SUPPLIERS[supplier_id]
    policy = validate_supplier_request(supplier_id, vault_available)
    pd = policy["policy_decision"]
    rate = policy["adjusted_rate_pct"]

    # Build recommendation
    if pd == "BLOCKED":
        decision = "BLOCK"
        summary = (
            f"{s['name']} cannot receive liquidity at this time. "
            f"Blocking reasons: {'; '.join(policy['blocking_reasons'])}."
        )
        reasoning = "The partner does not meet the minimum requirements for supplier liquidity access."
        pros = []
        cons = policy["blocking_reasons"]
    elif pd == "APPROVED_WITH_WARNING":
        decision = "APPROVE_WITH_WARNING"
        summary = (
            f"{s['name']} requests {s['requested_liquidity']:,.0f} RLUSD for {s['purpose']}. "
            f"The partner is verified and has an active credential, but the risk score "
            f"({s['risk_score']}/100) is elevated due to country and liquidity risk."
        )
        reasoning = (
            f"The supplier is strategically important and verified. "
            f"The requested amount ({s['requested_liquidity']:,.0f} RLUSD) is within the assigned "
            f"credit limit ({s['credit_limit']:,.0f} RLUSD). However, the risk score is elevated, "
            f"so the credit line requires Treasury Manager approval and a higher risk-adjusted rate."
        )
        pros = [
            f"Verified partner with active credentials",
            f"Requested amount within credit limit",
            f"Supports critical supply chain operations",
            f"Short-term commitment ({s['max_term_days']} days max)",
        ]
        cons = [
            f"Risk score {s['risk_score']}/100 — elevated country risk",
            f"Rate multiplier {policy['rate_multiplier']}× applied",
            f"Requires enhanced monitoring during credit term",
        ]
    else:
        decision = "APPROVE"
        summary = (
            f"{s['name']} requests {s['requested_liquidity']:,.0f} RLUSD for {s['purpose']}. "
            f"The partner meets all policy requirements with a low risk profile."
        )
        reasoning = (
            f"The supplier is fully verified, has an active credential, and the risk score "
            f"({s['risk_score']}/100) is well within acceptable limits. "
            f"The requested amount is within the credit limit. Standard terms apply."
        )
        pros = [
            "Verified partner with active credentials",
            "Low risk score — standard rate applies",
            "Requested amount within credit limit",
            "Supports supply chain continuity",
        ]
        cons = [
            "External counterparty — ongoing monitoring required",
            "Human approval required per policy",
        ]

    return {
        "supplier_id": supplier_id,
        "supplier_name": s["name"],
        "ai_mode": "rule_based",
        "summary": summary,
        "recommended_decision": decision,
        "reasoning": reasoning,
        "risk_explanation": f"Risk score {s['risk_score']}/100 based on country risk ({s['location']}), "
                            f"counterparty profile, and current exposure of {s['current_exposure']:,.0f} RLUSD.",
        "suggested_amount": s["requested_liquidity"],
        "suggested_term_days": min(14, s["max_term_days"]),
        "suggested_interest_rate": rate,
        "required_approval_level": policy["approval_level"],
        "pros": pros,
        "cons": cons,
        "policy_notes": policy["decision_summary"],
        "policy": policy,
        "timestamp": datetime.now().isoformat(),
    }


def issue_supplier_credit(
    supplier_id: str,
    amount: float,
    term_days: int,
    rate_pct: float,
    vault_available: float,
    audit_id: str,
    xrpl_result: dict,
    approved_by: str = "Treasury Manager",
) -> dict:
    """Create a supplier credit line and update exposure."""
    if supplier_id not in SUPPLIERS:
        raise ValueError(f"Supplier not found: {supplier_id}")

    s = SUPPLIERS[supplier_id]
    due_date = (datetime.now() + timedelta(days=term_days)).isoformat()

    credit_line = {
        "id": f"SCL_{supplier_id.upper()[:6]}_{len(SUPPLIER_CREDIT_LINES):03d}",
        "supplier_id": supplier_id,
        "supplier_name": s["name"],
        "supplier_type": s["type"],
        "amount": amount,
        "currency": "RLUSD",
        "term_days": term_days,
        "interest_rate": rate_pct,
        "risk_score_at_issuance": s["risk_score"],
        "risk_level": s["risk_level"],
        "policy_decision": "APPROVED_WITH_WARNING" if s["risk_score"] > 70 else "APPROVED",
        "approval_level": "TREASURY_MANAGER",
        "status": "ACTIVE",
        "xrpl_tx_hash": xrpl_result.get("tx_hash"),
        "execution_mode": xrpl_result.get("execution_mode", "SIMULATED"),
        "execution_status": xrpl_result.get("execution_status", "SIMULATED"),
        "simulated": xrpl_result.get("simulated", True),
        "explorer_url": xrpl_result.get("explorer_url"),
        "audit_id": audit_id,
        "created_at": datetime.now().isoformat(),
        "due_date": due_date,
        "repaid_at": None,
        "approved_by": approved_by,
        "memo": xrpl_result.get("memo_reference", ""),
    }

    SUPPLIER_CREDIT_LINES.append(credit_line)
    s["current_exposure"] += amount
    s["approval_status"] = "EXECUTED"

    SUPPLIER_AUDIT_LOG.append({
        "timestamp": datetime.now().isoformat(),
        "type": "SUPPLIER_CREDIT_EXECUTED",
        "audit_id": audit_id,
        "supplier_id": supplier_id,
        "supplier_name": s["name"],
        "amount": amount,
        "tx_hash": xrpl_result.get("tx_hash"),
        "execution_mode": xrpl_result.get("execution_mode"),
        "approved_by": approved_by,
    })

    return credit_line


def _blocked_result(reasons: list[str]) -> dict:
    return {
        "approved": False,
        "policy_decision": "BLOCKED",
        "approval_level": "N/A",
        "checks": [{"name": r, "status": "failed", "reason": r} for r in reasons],
        "blocking_reasons": reasons,
        "warning_reasons": [],
        "risk_level": "high",
        "risk_score": 100,
        "adjusted_rate_pct": 0,
        "rate_multiplier": 0,
        "base_rate_pct": 0,
        "decision_summary": f"Blocked: {'; '.join(reasons)}",
        "requires_human_approval": True,
        "policy_version": "supplier-1.0",
        "validated_at": datetime.now().isoformat(),
    }
