"""
Scenario Simulator — applies predefined liquidity shock scenarios to the
in-memory state for demo and stress-testing purposes.

Each scenario returns the before/after snapshot so the frontend can
visualise the impact immediately.
"""

from datetime import datetime
import data as db

# ── Scenario definitions ───────────────────────────────────────────────────────

SCENARIOS: dict[str, dict] = {
    "brazil_payroll": {
        "id": "brazil_payroll",
        "name": "Brazil Payroll Obligation",
        "description": (
            "Simulates a monthly payroll run for Corp. Brazil. "
            "300,000 RLUSD of operational cash leaves the São Paulo entity, "
            "pushing it further into deficit and triggering an urgent liquidity alert."
        ),
        "severity": "high",
        "deltas": {
            "brazil": -300_000,
        },
    },
    "singapore_sales": {
        "id": "singapore_sales",
        "name": "Singapore Sales Cash Inflow",
        "description": (
            "Seasonal sales revenue in the APAC region is collected. "
            "700,000 RLUSD flows into Singapore, creating a large deployable surplus "
            "that can be routed to the Corporate Vault or deficient subsidiaries."
        ),
        "severity": "low",
        "deltas": {
            "singapore": +700_000,
        },
    },
    "multi_shock": {
        "id": "multi_shock",
        "name": "Multi-Region Liquidity Event",
        "description": (
            "Simultaneous movement across three entities: Brazil payroll (-300K), "
            "Singapore sales inflow (+700K), and a Zurich FX hedge settlement (+500K). "
            "Tests the AI agent's ability to recommend an optimal rebalancing sequence."
        ),
        "severity": "medium",
        "deltas": {
            "brazil": -300_000,
            "singapore": +700_000,
            "zurich": +500_000,
        },
    },
    "vault_pressure": {
        "id": "vault_pressure",
        "name": "Vault Liquidity Pressure Test",
        "description": (
            "Brazil draws an emergency credit line while the vault simultaneously "
            "loses liquidity due to an early redemption from Zurich. "
            "Tests vault resilience under concurrent drawdown pressure."
        ),
        "severity": "high",
        "deltas": {
            "brazil": -200_000,
            "vault_available": -500_000,
        },
    },
    "full_stress": {
        "id": "full_stress",
        "name": "Full Network Stress Test",
        "description": (
            "Worst-case scenario: Brazil (-400K) and Singapore (-200K) face simultaneous "
            "obligations while Zurich receives a moderate inflow (+300K). "
            "Vault is the only viable backstop — stress tests the entire liquidity network."
        ),
        "severity": "critical",
        "deltas": {
            "brazil": -400_000,
            "singapore": -200_000,
            "zurich": +300_000,
        },
    },
}


def get_all_scenarios() -> list[dict]:
    """Return scenario metadata without applying any changes."""
    return [
        {
            "id": s["id"],
            "name": s["name"],
            "description": s["description"],
            "severity": s["severity"],
        }
        for s in SCENARIOS.values()
    ]


def apply_scenario(scenario_id: str) -> dict:
    """
    Apply a liquidity-shock scenario to the live in-memory state.

    Returns a snapshot of before/after positions plus the scenario metadata.
    """
    scenario = SCENARIOS.get(scenario_id)
    if not scenario:
        raise ValueError(f"Unknown scenario: '{scenario_id}'. Available: {list(SCENARIOS.keys())}")

    # ── Capture before state ───────────────────────────────────────────────────
    before: dict[str, float] = {}
    for sub_id in db.SUBSIDIARIES:
        before[sub_id] = db.SUBSIDIARIES[sub_id]["rlusd_balance"]
    before["vault_available"] = db.CORPORATE_VAULT["available"]

    # ── Apply deltas ──────────────────────────────────────────────────────────
    affected: list[str] = []
    for key, delta in scenario["deltas"].items():
        if key == "vault_available":
            db.CORPORATE_VAULT["available"] = max(0.0, db.CORPORATE_VAULT["available"] + delta)
            affected.append("corp_vault")
        elif key in db.SUBSIDIARIES:
            db.SUBSIDIARIES[key]["rlusd_balance"] = max(
                0.0, db.SUBSIDIARIES[key]["rlusd_balance"] + delta
            )
            db.SUBSIDIARIES[key]["status"] = db.get_subsidiary_status(key)
            affected.append(key)

    # ── Capture after state ────────────────────────────────────────────────────
    after: dict[str, float] = {}
    for sub_id in db.SUBSIDIARIES:
        after[sub_id] = db.SUBSIDIARIES[sub_id]["rlusd_balance"]
    after["vault_available"] = db.CORPORATE_VAULT["available"]

    # ── Determine newly deficient subsidiaries ─────────────────────────────────
    new_deficits = [
        sub_id
        for sub_id in db.SUBSIDIARIES
        if (
            db.SUBSIDIARIES[sub_id]["rlusd_balance"] < db.SUBSIDIARIES[sub_id]["threshold_min"]
            and before[sub_id] >= db.SUBSIDIARIES[sub_id]["threshold_min"]
        )
    ]

    return {
        "scenario_id": scenario_id,
        "scenario_name": scenario["name"],
        "description": scenario["description"],
        "severity": scenario["severity"],
        "applied_at": datetime.now().isoformat(),
        "deltas": scenario["deltas"],
        "affected_entities": affected,
        "new_deficits": new_deficits,
        "before": before,
        "after": after,
        "recommendation": (
            "Run /api/analyze to get AI-powered resolution options for the new liquidity state."
        ),
    }
