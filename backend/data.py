"""Simulated company data - balances, FX rates, transfer history, treasury policy."""
from datetime import datetime, timedelta

SUBSIDIARIES = {
    "zurich": {
        "id": "zurich",
        "name": "Corp. Zurich",
        "location": "Zurich, Switzerland",
        "flag": "CH",
        "currency": "CHF",
        "rlusd_balance": 2_000_000.0,
        "threshold_min": 500_000.0,
        "threshold_max": 3_000_000.0,
        "wallet_address": None,
        "status": "surplus",
    },
    "brazil": {
        "id": "brazil",
        "name": "Corp. Brazil",
        "location": "São Paulo, Brazil",
        "flag": "BR",
        "currency": "BRL",
        "rlusd_balance": 120_000.0,
        "threshold_min": 500_000.0,
        "threshold_max": 2_000_000.0,
        "wallet_address": None,
        "status": "deficit",
    },
    "singapore": {
        "id": "singapore",
        "name": "Corp. Singapore",
        "location": "Singapore",
        "flag": "SG",
        "currency": "SGD",
        "rlusd_balance": 850_000.0,
        "threshold_min": 300_000.0,
        "threshold_max": 1_500_000.0,
        "wallet_address": None,
        "status": "normal",
    },
}

FX_RATES = {
    "RLUSD_CHF": 0.892,
    "RLUSD_BRL": 5.12,
    "RLUSD_SGD": 1.34,
    "bank_fee_pct": 0.0025,
    "xrpl_fee_usd": 0.0001,
}

CORPORATE_VAULT = {
    "id": "corp_vault",
    "name": "Corporate Liquidity Vault",
    "total_capacity": 10_000_000.0,
    "available": 0.0,        # Starts empty — subsidiaries must deposit
    "committed": 0.0,        # Grows as credit lines are issued
    "deposited_total": 0.0,  # Total ever deposited (for display)
    "apy": 0.042,
    "wallet_address": None,
    "xrpl_primitive": "XLS-65 Single Asset Vault",
    "active_credit_lines": 0,
}

# Deposit history (vault contributions from subsidiaries)
VAULT_DEPOSITS: list[dict] = []

# Active credit lines (XLS-66 Lending)
ACTIVE_CREDIT_LINES: list[dict] = []

TRANSFER_HISTORY = [
    {
        "id": "tx_001",
        "from": "zurich",
        "to": "singapore",
        "amount": 300_000,
        "currency": "RLUSD",
        "timestamp": (datetime.now() - timedelta(days=3)).isoformat(),
        "tx_hash": "A1B2C3D4E5F6789012345678901234567890ABCDEF1234567890ABCDEF123456",
        "status": "completed",
        "fx_saving": 1_240.0,
        "reason": "Quarterly rebalancing",
        "action_type": "direct_transfer",
        "explorer_url": None,
    },
    {
        "id": "tx_002",
        "from": "singapore",
        "to": "brazil",
        "amount": 150_000,
        "currency": "RLUSD",
        "timestamp": (datetime.now() - timedelta(days=7)).isoformat(),
        "tx_hash": "B2C3D4E5F6789012345678901234567890ABCDEF1234567890ABCDEF1234567",
        "status": "completed",
        "fx_saving": 520.0,
        "reason": "Emergency operating cost",
        "action_type": "direct_transfer",
        "explorer_url": None,
    },
    {
        "id": "tx_003",
        "from": "corp_vault",
        "to": "zurich",
        "amount": 500_000,
        "currency": "RLUSD",
        "timestamp": (datetime.now() - timedelta(days=14)).isoformat(),
        "tx_hash": "C3D4E5F6789012345678901234567890ABCDEF1234567890ABCDEF12345678",
        "status": "completed",
        "fx_saving": 1_850.0,
        "reason": "Month-end liquidity injection",
        "action_type": "vault_credit",
        "explorer_url": None,
    },
]

TREASURY_POLICY = {
    "max_single_transfer": 1_000_000,
    "require_approval_above": 100_000,
    "auto_approve_below": 50_000,
    "max_credit_line_pct": 0.3,
    "max_credit_term_days": 30,
    "rebalance_frequency": "daily",
    "risk_tolerance": "medium",
    "preferred_settlement": "XRPL",
    "vault_lending_rate_pct": 2.5,
}

AUDIT_LOG: list[dict] = []


def get_subsidiary_status(sub_id: str) -> str:
    sub = SUBSIDIARIES[sub_id]
    balance = sub["rlusd_balance"]
    if balance < sub["threshold_min"]:
        return "deficit"
    elif balance > sub["threshold_max"]:
        return "surplus"
    return "normal"


def calculate_fx_saving(amount: float) -> float:
    bank_fee = amount * FX_RATES["bank_fee_pct"]
    xrpl_fee = FX_RATES["xrpl_fee_usd"]
    return round(bank_fee - xrpl_fee, 2)


def add_audit_event(event_type: str, details: dict) -> dict:
    event = {
        "id": f"audit_{len(AUDIT_LOG):04d}",
        "type": event_type,
        "timestamp": datetime.now().isoformat(),
        "details": details,
    }
    AUDIT_LOG.append(event)
    return event
