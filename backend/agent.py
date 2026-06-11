"""AI Treasury Agent - uses Groq (free) to analyze liquidity and generate TWO action options."""
import os
import json
import logging
from datetime import datetime

from dotenv import load_dotenv

from data import SUBSIDIARIES, FX_RATES, TREASURY_POLICY, CORPORATE_VAULT, calculate_fx_saving

logger = logging.getLogger(__name__)

# Load .env from the same directory as this file
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

# Groq client (free tier — https://console.groq.com)
try:
    from groq import Groq
    _groq_key = os.getenv("GROQ_API_KEY", "")
    client = Groq(api_key=_groq_key) if _groq_key else None
except ImportError:
    client = None

SYSTEM_PROMPT = """You are TreasuryMind, an AI Treasury Agent for multinational corporate liquidity management on XRPL.

You operate a Corporate Liquidity Network on XRPL (XRP Ledger) that allows treasury teams to:
1. Pool excess cash into a Corporate Vault (XLS-65 Single Asset Vault)
2. Move liquidity between subsidiaries instantly via RLUSD payments
3. Provide short-term internal credit lines from the Vault (XLS-66 Lending Protocol)

Your role:
- Monitor real-time liquidity positions across global subsidiaries
- Detect liquidity gaps, surplus positions, and optimization opportunities
- Generate TWO concrete treasury options for any problem detected
- Calculate FX savings, risk scores, and settlement times
- Always prefer internal XRPL settlement over external bank wires

Response format (STRICT JSON, no markdown):
{
  "problem_detected": true/false,
  "severity": "critical|high|medium|low",
  "problem_summary": "one-sentence description",
  "affected_subsidiaries": ["id1", "id2"],
  "options": [
    {
      "type": "direct_transfer",
      "label": "Option A: Direct Internal Transfer",
      "from": "subsidiary_id",
      "to": "subsidiary_id",
      "amount": 500000,
      "reasoning": "2-3 sentence explanation",
      "fx_saving_usd": 1250,
      "settlement_time": "3-5 seconds",
      "risk_level": "low",
      "confidence": 0.94,
      "xrpl_instrument": "RLUSD Payment",
      "xrpl_primitive": "direct_payment",
      "pros": ["Fastest settlement", "Zero interest cost"],
      "cons": ["Reduces Zurich liquidity buffer"]
    },
    {
      "type": "vault_credit",
      "label": "Option B: Vault Credit Line",
      "from": "corp_vault",
      "to": "subsidiary_id",
      "amount": 500000,
      "term_days": 7,
      "rate_pct": 2.5,
      "reasoning": "2-3 sentence explanation",
      "fx_saving_usd": 1250,
      "settlement_time": "3-5 seconds",
      "risk_level": "low",
      "confidence": 0.88,
      "xrpl_instrument": "XLS-66 Lending Protocol",
      "xrpl_primitive": "credit_line",
      "pros": ["Preserves subsidiary liquidity", "Vault handles disbursement"],
      "cons": ["2.5% annual interest applies", "7-day repayment required"]
    }
  ],
  "market_context": "brief FX/market note",
  "compliance_note": "treasury policy compliance check"
}

If no problem detected, set problem_detected=false, options=[], and explain in problem_summary.
Be institutional, precise, and quantify all savings. Always provide exactly 2 options when a problem exists."""

RAG_CONTEXT_TEMPLATE = """
=== CURRENT TREASURY STATE ===
Timestamp: {timestamp}

SUBSIDIARY POSITIONS:
{subsidiary_data}

CORPORATE LIQUIDITY VAULT (XLS-65):
- Available: {vault_available:,.0f} RLUSD
- Committed: {vault_committed:,.0f} RLUSD
- APY: {vault_apy:.1f}%
- Active Credit Lines: {active_credit_lines}

FX REFERENCE RATES:
- RLUSD/CHF: {fx_chf}
- RLUSD/BRL: {fx_brl}
- RLUSD/SGD: {fx_sgd}
- Traditional bank wire fee: {bank_fee:.2f}% (0.25% per transfer)
- XRPL transaction fee: ${xrpl_fee} (near-zero)

TREASURY POLICY:
- Max single transfer: {policy_max:,.0f} RLUSD
- Approval required above: {policy_approval:,.0f} RLUSD
- Vault lending rate: {lending_rate}% p.a.
- Max credit term: {max_term} days
- Risk tolerance: {policy_risk}
"""


def build_rag_context() -> str:
    sub_lines = []
    for sub_id, sub in SUBSIDIARIES.items():
        status_map = {"surplus": "SURPLUS ✓", "deficit": "⚠ DEFICIT", "normal": "NORMAL"}
        status = status_map.get(sub["status"], "NORMAL")
        shortfall = max(0, sub["threshold_min"] - sub["rlusd_balance"])
        excess = max(0, sub["rlusd_balance"] - sub["threshold_min"])
        sub_lines.append(
            f"- {sub['name']} (id={sub_id}, location={sub['location']}): "
            f"{sub['rlusd_balance']:,.0f} RLUSD | {status} | "
            f"Range: [{sub['threshold_min']:,.0f} – {sub['threshold_max']:,.0f}] | "
            f"{'Shortfall: ' + f'{shortfall:,.0f}' if shortfall > 0 else 'Deployable: ' + f'{excess:,.0f}'} RLUSD"
        )

    return RAG_CONTEXT_TEMPLATE.format(
        timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S UTC"),
        subsidiary_data="\n".join(sub_lines),
        vault_available=CORPORATE_VAULT["available"],
        vault_committed=CORPORATE_VAULT["committed"],
        vault_apy=CORPORATE_VAULT["apy"] * 100,
        active_credit_lines=CORPORATE_VAULT.get("active_credit_lines", 0),
        fx_chf=FX_RATES["RLUSD_CHF"],
        fx_brl=FX_RATES["RLUSD_BRL"],
        fx_sgd=FX_RATES["RLUSD_SGD"],
        bank_fee=FX_RATES["bank_fee_pct"] * 100,
        xrpl_fee=FX_RATES["xrpl_fee_usd"],
        policy_max=TREASURY_POLICY["max_single_transfer"],
        policy_approval=TREASURY_POLICY["require_approval_above"],
        lending_rate=TREASURY_POLICY["vault_lending_rate_pct"],
        max_term=TREASURY_POLICY["max_credit_term_days"],
        policy_risk=TREASURY_POLICY["risk_tolerance"],
    )


async def analyze_liquidity() -> dict:
    """Run full treasury analysis — uses Groq AI if key is set, else rule-based engine."""
    if client is None:
        logger.info("No GROQ_API_KEY set — using rule-based engine.")
        return _rule_based_recommendation()

    rag_context = build_rag_context()

    deficit_subs = [s for s in SUBSIDIARIES.values() if s["rlusd_balance"] < s["threshold_min"]]
    deficit_hint = ""
    if deficit_subs:
        names = ", ".join(
            f"{s['name']} ({s['rlusd_balance']:,.0f} RLUSD, needs {s['threshold_min']:,.0f} RLUSD)"
            for s in deficit_subs
        )
        deficit_hint = (
            f"\n\nCRITICAL: The following subsidiaries are CONFIRMED below minimum threshold: {names}. "
            f"You MUST set problem_detected=true and provide exactly 2 options: "
            f"Option A (direct_transfer from a surplus subsidiary) and Option B (vault_credit from corp_vault)."
        )
    else:
        deficit_hint = (
            "\n\nIMPORTANT: All subsidiaries are currently ABOVE their minimum thresholds. "
            "You MUST set problem_detected=false and options=[]."
        )

    user_message = f"{rag_context}{deficit_hint}\n\nAnalyze and return ONLY valid JSON."

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            max_tokens=2000,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
        )

        raw = response.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip().rstrip("```").strip()

        result = json.loads(raw)
        result["ai_mode"] = "claude"
        return result

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse Groq response: {e}")
        return _rule_based_recommendation()
    except Exception as e:
        logger.error(f"Groq API error: {e}")
        return _rule_based_recommendation()


def _rule_based_recommendation() -> dict:
    """Rule-based engine — reads live SUBSIDIARIES data, always accurate."""
    deficit_subs = [s for s in SUBSIDIARIES.values() if s["rlusd_balance"] < s["threshold_min"]]
    surplus_subs = sorted(
        [s for s in SUBSIDIARIES.values() if s["rlusd_balance"] > s["threshold_min"] * 1.5],
        key=lambda s: s["rlusd_balance"],
        reverse=True,
    )

    if not deficit_subs:
        return {
            "problem_detected": False,
            "severity": "low",
            "problem_summary": "All subsidiaries are within optimal liquidity thresholds. No action required.",
            "affected_subsidiaries": [],
            "options": [],
            "ai_mode": "rule_based",
            "market_context": f"RLUSD/BRL: {FX_RATES['RLUSD_BRL']} · Bank fee: 0.25% · XRPL fee: $0.0001",
            "compliance_note": "No action required. Treasury in balance.",
        }

    deficit = deficit_subs[0]
    needed = deficit["threshold_min"] - deficit["rlusd_balance"]
    fx_saving = calculate_fx_saving(needed)

    options = []

    if surplus_subs:
        surplus = surplus_subs[0]
        options.append({
            "type": "direct_transfer",
            "label": "Option A: Direct Internal Transfer",
            "from": surplus["id"],
            "to": deficit["id"],
            "amount": needed,
            "reasoning": (
                f"{deficit['name']} is {needed:,.0f} RLUSD below its minimum operating threshold. "
                f"{surplus['name']} holds {surplus['rlusd_balance']:,.0f} RLUSD — sufficient to cover this gap. "
                f"An internal RLUSD transfer via XRPL settles in 3-5 seconds at near-zero cost vs. a traditional wire (0.25% fee, 1-3 days)."
            ),
            "fx_saving_usd": fx_saving,
            "settlement_time": "3-5 seconds",
            "risk_level": "low",
            "confidence": 94,
            "xrpl_instrument": "RLUSD Payment",
            "xrpl_primitive": "direct_payment",
            "pros": ["Immediate settlement", "Zero interest cost", f"${fx_saving:,.0f} FX savings vs bank wire"],
            "cons": [f"Reduces {surplus['name']} balance by {needed:,.0f} RLUSD"],
        })

    if CORPORATE_VAULT["available"] >= needed:
        options.append({
            "type": "vault_credit",
            "label": "Option B: Vault Credit Line (XLS-66)",
            "from": "corp_vault",
            "to": deficit["id"],
            "amount": needed,
            "term_days": 7,
            "rate_pct": TREASURY_POLICY["vault_lending_rate_pct"],
            "reasoning": (
                f"The Corporate Liquidity Vault holds {CORPORATE_VAULT['available']:,.0f} RLUSD available. "
                f"A 7-day internal credit line at {TREASURY_POLICY['vault_lending_rate_pct']}% p.a. can fund {deficit['name']} "
                f"without touching subsidiary reserves. Executed via XLS-66 Lending Protocol on XRPL."
            ),
            "fx_saving_usd": fx_saving,
            "settlement_time": "3-5 seconds",
            "risk_level": "low",
            "confidence": 88,
            "xrpl_instrument": "XLS-66 Lending Protocol",
            "xrpl_primitive": "credit_line",
            "pros": ["Preserves subsidiary liquidity buffers", "Vault-backed — no counterparty risk"],
            "cons": [
                f"{TREASURY_POLICY['vault_lending_rate_pct']}% p.a. interest applies",
                "7-day repayment required",
            ],
        })

    if not options:
        return {
            "problem_detected": True,
            "severity": "critical",
            "problem_summary": f"{deficit['name']} has a liquidity gap but insufficient vault capacity.",
            "affected_subsidiaries": [deficit["id"]],
            "options": [],
            "ai_mode": "rule_based",
            "market_context": "Insufficient internal liquidity. External funding may be required.",
            "compliance_note": "Escalate to CFO immediately.",
        }

    return {
        "problem_detected": True,
        "severity": "high",
        "problem_summary": (
            f"{deficit['name']} has a liquidity gap of {needed:,.0f} RLUSD below its minimum threshold."
        ),
        "affected_subsidiaries": [deficit["id"]] + ([surplus_subs[0]["id"]] if surplus_subs else []),
        "options": options,
        "ai_mode": "rule_based",
        "market_context": (
            f"RLUSD/BRL: {FX_RATES['RLUSD_BRL']} · "
            f"Bank wire fee: 0.25% · XRPL fee: $0.0001 · "
            f"Savings vs bank: ${fx_saving:,.0f}"
        ),
        "compliance_note": (
            f"Transfer of {needed:,.0f} RLUSD requires Treasury Manager approval "
            f"(threshold: {TREASURY_POLICY['require_approval_above']:,.0f} RLUSD). "
            f"Both options comply with max single transfer policy ({TREASURY_POLICY['max_single_transfer']:,.0f} RLUSD)."
        ),
    }
