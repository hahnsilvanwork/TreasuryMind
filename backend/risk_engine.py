"""
Risk Engine — calculates entity-level risk scores for treasury decisions.

Factors considered:
  - Country / market risk (static baseline)
  - Deficit severity relative to minimum threshold
  - Number of outstanding credit lines
  - Liquidity buffer depth
"""

# Static country/market risk baseline (0 = lowest, 100 = highest)
COUNTRY_RISK: dict[str, int] = {
    "zurich":     8,   # Switzerland — AAA, very stable regulatory environment
    "singapore": 12,   # Singapore — AA1, leading financial hub in Southeast Asia
    "brazil":    58,   # Brazil — Ba2, emerging market with FX and political volatility
    "corp_vault": 0,   # Internal entity — no external risk
}


def calculate_risk_score(
    entity_id: str,
    subsidiaries: dict,
    active_credit_lines: list[dict],
) -> dict:
    """
    Calculate a 0–100 risk score for a given entity.
    Returns structured result with score, level, and human-readable reasons.
    """
    entity = subsidiaries.get(entity_id)
    if not entity:
        return {
            "entity_id": entity_id,
            "entity_name": entity_id,
            "risk_score": 50,
            "risk_level": "medium",
            "reasons": ["Entity not found in registry"],
        }

    score = 0
    reasons: list[str] = []

    # ── Factor 1: Country / market risk baseline (weight: up to 60 pts) ───────
    country_pts = COUNTRY_RISK.get(entity_id, 40)
    score += country_pts
    if country_pts >= 40:
        reasons.append(f"Elevated country/market risk ({entity.get('location', entity_id)})")

    # ── Factor 2: Deficit severity (weight: up to 20 pts) ─────────────────────
    balance = entity.get("rlusd_balance", 0)
    min_thresh = entity.get("threshold_min", 1)
    if balance < min_thresh:
        deficit_ratio = min((min_thresh - balance) / max(min_thresh, 1), 1.0)
        pts = int(deficit_ratio * 20)
        score += pts
        reasons.append(
            f"Balance {balance:,.0f} RLUSD is {deficit_ratio:.0%} below minimum threshold ({min_thresh:,.0f} RLUSD)"
        )

    # ── Factor 3: Outstanding credit lines (weight: up to 15 pts) ─────────────
    entity_cls = [cl for cl in active_credit_lines if cl.get("borrower") == entity_id]
    if entity_cls:
        pts = min(len(entity_cls) * 5, 15)
        score += pts
        reasons.append(f"{len(entity_cls)} active credit line(s) outstanding against this entity")

    # ── Factor 4: Very low liquidity cushion (weight: 5 pts) ──────────────────
    if balance < min_thresh * 0.5:
        score += 5
        reasons.append("Liquidity cushion below 50 % of minimum threshold — acute pressure")

    score = min(score, 100)

    level = "low" if score <= 30 else "medium" if score <= 70 else "high"

    if not reasons:
        reasons.append("No significant risk factors identified")

    return {
        "entity_id": entity_id,
        "entity_name": entity.get("name", entity_id),
        "risk_score": score,
        "risk_level": level,
        "reasons": reasons,
    }


def calculate_all_risks(
    subsidiaries: dict,
    active_credit_lines: list[dict],
) -> dict[str, dict]:
    """Calculate risk scores for all known entities."""
    return {
        eid: calculate_risk_score(eid, subsidiaries, active_credit_lines)
        for eid in subsidiaries
    }


def get_adjusted_rate(base_rate_pct: float, risk_level: str) -> float:
    """Apply a risk-based multiplier to an interest rate."""
    multiplier = {"low": 1.0, "medium": 1.5, "high": 2.0}.get(risk_level, 1.0)
    return round(base_rate_pct * multiplier, 2)
