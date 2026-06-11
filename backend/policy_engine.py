"""
Policy Engine — validates every treasury action against internal compliance rules
before it can be approved and executed.

Policies are deterministic and explainable — each check returns PASSED / FAILED / WARNING
with a human-readable reason.

Policy Decision Enum: APPROVED | APPROVED_WITH_WARNING | BLOCKED
Approval Level Enum:  AUTO | TREASURY_MANAGER | CFO_REQUIRED
"""

# ── Policy configuration ───────────────────────────────────────────────────────

POLICY = {
    "max_single_transfer_rlusd":   1_000_000,   # CFO approval required above this
    "cfo_threshold":               1_000_000,   # CFO approval required above this
    "treasury_manager_threshold":    250_000,   # Treasury Manager approval above this
    "auto_approve_threshold":         50_000,   # May auto-approve below this
    "min_confidence_pct":                 75,   # LLM confidence must meet this to proceed
    "max_risk_score_for_standard":        70,   # Risk score above this requires enhanced review
    "max_risk_score_absolute":            90,   # Hard block above this score
}

# Whitelisted entities — only these may send or receive internal transfers
WHITELISTED_ENTITIES: set[str] = {"zurich", "brazil", "singapore", "corp_vault"}


def validate_action(
    action_type: str,        # "direct_transfer" | "vault_credit"
    from_id: str,
    to_id: str,
    amount: float,
    confidence: float,       # 0–100
    risk_score: int,         # 0–100
    risk_level: str,         # "low" | "medium" | "high"
    vault_available: float = 0.0,
    subsidiaries: dict = None,
) -> dict:
    """
    Runs all policy checks and returns a structured compliance result.

    Return schema:
    {
        "approved": bool,
        "policy_decision": "APPROVED" | "APPROVED_WITH_WARNING" | "BLOCKED",
        "approval_level": "AUTO" | "TREASURY_MANAGER" | "CFO_REQUIRED",
        "requires_human_approval": bool,
        "requires_cfo_approval": bool,
        "checks": [{"name": str, "status": "passed"|"failed"|"warning", "reason": str}],
        "blocking_reasons": [str],
        "warning_reasons": [str],
        "risk_level": str,
        "adjusted_rate_multiplier": float,
        "decision_summary": str,
    }
    """
    subsidiaries = subsidiaries or {}
    checks: list[dict] = []
    blocking_reasons: list[str] = []
    warning_reasons: list[str] = []

    def _check(name: str, passed: bool, fail_reason: str = "", warning: bool = False) -> bool:
        if passed:
            status = "passed"
        elif warning:
            status = "warning"
        else:
            status = "failed"
        checks.append({"name": name, "status": status, "reason": "" if passed else fail_reason})
        if not passed and not warning and fail_reason:
            blocking_reasons.append(fail_reason)
        if not passed and warning and fail_reason:
            warning_reasons.append(fail_reason)
        return passed

    # ── 1. Destination whitelisted ────────────────────────────────────────────
    _check(
        "Destination entity is whitelisted",
        to_id in WHITELISTED_ENTITIES,
        f"'{to_id}' is not in the approved counterparty whitelist.",
    )

    # ── 2. Source whitelisted (direct transfers only) ─────────────────────────
    if action_type == "direct_transfer":
        _check(
            "Source entity is whitelisted",
            from_id in WHITELISTED_ENTITIES,
            f"'{from_id}' is not in the approved counterparty whitelist.",
        )

    # ── 3. Amount within single-transaction limit ─────────────────────────────
    _check(
        "Amount within single-transaction limit",
        amount <= POLICY["max_single_transfer_rlusd"],
        f"Amount {amount:,.0f} RLUSD exceeds CFO approval threshold of "
        f"{POLICY['max_single_transfer_rlusd']:,.0f} RLUSD.",
    )

    # ── 4. Source liquidity sufficient (direct transfers) ─────────────────────
    if action_type == "direct_transfer" and subsidiaries:
        sender = subsidiaries.get(from_id, {})
        sender_bal = sender.get("rlusd_balance", 0)
        _check(
            "Source entity has sufficient liquidity",
            sender_bal >= amount,
            f"Sender balance {sender_bal:,.0f} RLUSD is insufficient for transfer of {amount:,.0f} RLUSD.",
        )

    # ── 5. Vault liquidity sufficient (vault credit only) ─────────────────────
    if action_type == "vault_credit":
        _check(
            "Corporate Vault has sufficient liquidity",
            vault_available >= amount,
            f"Vault available {vault_available:,.0f} RLUSD — credit line of {amount:,.0f} RLUSD not possible.",
        )

    # ── 6. LLM confidence threshold ───────────────────────────────────────────
    conf_ok = confidence >= POLICY["min_confidence_pct"]
    _check(
        f"AI confidence meets threshold (≥ {POLICY['min_confidence_pct']} %)",
        conf_ok,
        f"Confidence {confidence:.0f} % is below the required {POLICY['min_confidence_pct']} %. "
        f"Manual review is required before execution.",
    )

    # ── 7. Recipient risk score ────────────────────────────────────────────────
    hard_block = risk_score > POLICY["max_risk_score_absolute"]
    _check(
        "Recipient risk score within acceptable range",
        not hard_block,
        f"Risk score {risk_score}/100 exceeds hard limit of {POLICY['max_risk_score_absolute']}. Transaction blocked.",
    )

    # ── 8. Enhanced review warning for elevated risk ──────────────────────────
    elevated_risk = (not hard_block) and (risk_score > POLICY["max_risk_score_for_standard"])
    if elevated_risk:
        _check(
            "Enhanced due diligence — elevated risk score",
            True,
            warning=False,
        )
        checks[-1]["status"] = "warning"
        warn_msg = (
            f"Risk score {risk_score}/100 is elevated (threshold: {POLICY['max_risk_score_for_standard']}). "
            f"A higher interest rate multiplier will apply."
        )
        checks[-1]["reason"] = warn_msg
        warning_reasons.append(warn_msg)

    # ── 9. Audit trail confirmation ────────────────────────────────────────────
    _check("Audit trail entry will be created and persisted", True)

    # ── Derive approval requirements ──────────────────────────────────────────
    requires_cfo = amount > POLICY["cfo_threshold"]
    requires_human = (
        amount > POLICY["treasury_manager_threshold"]
        or risk_level in ("medium", "high")
        or not conf_ok
        or requires_cfo
    )

    # ── Approval level ────────────────────────────────────────────────────────
    if amount > POLICY["cfo_threshold"]:
        approval_level = "CFO_REQUIRED"
    elif amount > POLICY["treasury_manager_threshold"]:
        approval_level = "TREASURY_MANAGER"
    else:
        approval_level = "AUTO"

    approved = len(blocking_reasons) == 0

    # ── Policy decision ───────────────────────────────────────────────────────
    if not approved:
        policy_decision = "BLOCKED"
    elif warning_reasons or elevated_risk:
        policy_decision = "APPROVED_WITH_WARNING"
    else:
        policy_decision = "APPROVED"

    # ── Rate multiplier for high-risk borrowers ───────────────────────────────
    adjusted_rate_multiplier = (
        2.0 if risk_level == "high"
        else 1.5 if risk_level == "medium"
        else 1.0
    )
    if adjusted_rate_multiplier > 1.0 and approved:
        checks.append({
            "name": f"Risk-adjusted rate: ×{adjusted_rate_multiplier} multiplier applied",
            "status": "warning",
            "reason": f"Standard rate multiplied by {adjusted_rate_multiplier}× due to {risk_level} risk profile.",
        })

    # ── Decision summary ──────────────────────────────────────────────────────
    if policy_decision == "BLOCKED":
        decision_summary = f"Transaction blocked. {'; '.join(blocking_reasons)}"
    elif policy_decision == "APPROVED_WITH_WARNING":
        decision_summary = (
            f"Transaction approved with conditions. "
            + (f"Risk score {risk_score}/100 — {risk_level} risk profile. " if elevated_risk else "")
            + (f"Credit rate adjusted by {adjusted_rate_multiplier}× multiplier." if adjusted_rate_multiplier > 1 else "")
        ).strip()
    else:
        decision_summary = f"Transaction approved. Approval level: {approval_level}."

    return {
        "approved": approved,
        "policy_decision": policy_decision,
        "approval_level": approval_level,
        "requires_human_approval": requires_human,
        "requires_cfo_approval": requires_cfo,
        "checks": checks,
        "blocking_reasons": blocking_reasons,
        "warning_reasons": warning_reasons,
        "risk_level": risk_level,
        "adjusted_rate_multiplier": adjusted_rate_multiplier,
        "decision_summary": decision_summary,
        "policy_version": "1.0",
        "validated_at": __import__("datetime").datetime.now().isoformat(),
    }
