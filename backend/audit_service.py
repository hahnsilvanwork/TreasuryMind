"""
Audit Service — persistent storage for all treasury events via JSON file.
Survives server restarts. All writes are immediately flushed to disk.
"""
import json
import logging
from datetime import datetime
from pathlib import Path
from threading import Lock

logger = logging.getLogger(__name__)

DATA_FILE = Path(__file__).parent / "treasury_data.json"
_lock = Lock()

_SCHEMA = {
    "audit_log": [],
    "transfers": [],
    "vault_deposits": [],
    "credit_lines": [],
    "policy_checks": [],
    "risk_snapshots": [],
}


# ── Internal helpers ───────────────────────────────────────────────────────────

def _load() -> dict:
    if DATA_FILE.exists():
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            for key in _SCHEMA:
                data.setdefault(key, [])
            logger.info(f"Loaded persisted state: {len(data['transfers'])} transfers, {len(data['credit_lines'])} credit lines")
            return data
        except Exception as e:
            logger.warning(f"Could not read {DATA_FILE}: {e}. Starting fresh.")
    return {k: list(v) for k, v in _SCHEMA.items()}


def _save(state: dict) -> None:
    with _lock:
        try:
            with open(DATA_FILE, "w", encoding="utf-8") as f:
                json.dump(state, f, indent=2, default=str)
        except Exception as e:
            logger.error(f"Failed to persist audit data: {e}")


# ── State ──────────────────────────────────────────────────────────────────────

_state: dict = _load()


def get_state() -> dict:
    return _state


def has_persisted_data() -> bool:
    """Returns True if the JSON file already exists with real data."""
    return DATA_FILE.exists() and bool(_state.get("transfers"))


# ── Writers ────────────────────────────────────────────────────────────────────

def add_audit_entry(event_type: str, details: dict) -> dict:
    entry = {
        "id": f"audit_{len(_state['audit_log']):04d}",
        "type": event_type,
        "timestamp": datetime.now().isoformat(),
        "details": details,
    }
    _state["audit_log"].append(entry)
    _save(_state)
    return entry


def add_transfer(transfer: dict) -> None:
    _state["transfers"].append(transfer)
    _save(_state)


def add_vault_deposit(deposit: dict) -> None:
    _state["vault_deposits"].append(deposit)
    _save(_state)


def add_credit_line(credit_line: dict) -> None:
    _state["credit_lines"].append(credit_line)
    _save(_state)


def update_credit_line(credit_line_id: str, updates: dict) -> dict | None:
    for i, cl in enumerate(_state["credit_lines"]):
        if cl["id"] == credit_line_id:
            _state["credit_lines"][i].update(updates)
            _save(_state)
            return _state["credit_lines"][i]
    return None


def add_policy_check(check: dict) -> None:
    _state["policy_checks"].append(check)
    _save(_state)


def add_risk_snapshot(snapshot: dict) -> None:
    _state["risk_snapshots"].append(snapshot)
    _save(_state)


# ── Readers ────────────────────────────────────────────────────────────────────

def get_transfers() -> list[dict]:
    return list(reversed(_state["transfers"]))


def get_audit_log() -> list[dict]:
    return list(reversed(_state["audit_log"]))


def get_vault_deposits() -> list[dict]:
    return list(reversed(_state["vault_deposits"]))


def get_credit_lines() -> list[dict]:
    return _state["credit_lines"]


def get_active_credit_lines() -> list[dict]:
    return [cl for cl in _state["credit_lines"] if cl.get("status") == "active"]


def get_credit_line(credit_line_id: str) -> dict | None:
    return next((cl for cl in _state["credit_lines"] if cl["id"] == credit_line_id), None)


def get_last_policy_checks(n: int = 5) -> list[dict]:
    return list(reversed(_state["policy_checks"]))[:n]
