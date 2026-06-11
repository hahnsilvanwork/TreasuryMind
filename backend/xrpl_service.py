"""XRPL Devnet integration — RLUSD issued-token settlement, wallets, execution proofs.

On startup we provision a full token economy on XRPL Devnet:
  1. Fund an issuer wallet + one wallet per entity via the Devnet faucet
  2. Enable Default Ripple on the issuer (entity↔entity IOU transfers ripple through it)
  3. Open RLUSD trustlines from every entity to the issuer
  4. Distribute the seed balances from data.py on-chain (issuer → entities)

Execution modes form a resilience ladder so the demo never crashes:
  TOKEN_PAYMENT     — real RLUSD IOU transfer, validated on-ledger (primary)
  XRP_PROOF_PAYMENT — small XRP payment with structured audit memo (fallback)
  SIMULATED         — in-process simulation when Devnet is unreachable (last resort)
"""
import asyncio
import logging
import os
import secrets
from datetime import datetime, timedelta

from dotenv import load_dotenv

load_dotenv()  # must run before os.getenv below; main.py loads too late (import order)

from xrpl.asyncio.clients import AsyncWebsocketClient
from xrpl.asyncio.transaction import autofill, sign_and_submit, submit_and_wait
from xrpl.asyncio.wallet import generate_faucet_wallet
from xrpl.models import (
    AccountSet,
    AccountSetAsfFlag,
    EscrowCreate,
    EscrowFinish,
    IssuedCurrency,
    IssuedCurrencyAmount,
    Memo,
    Payment,
    TrustSet,
)
from xrpl.models.requests import AccountLines, LedgerEntry, ServerInfo
from xrpl.models.transactions import VaultCreate, VaultDeposit, VaultWithdraw
from xrpl.models.transactions.vault_create import WithdrawalPolicy
from xrpl.utils import datetime_to_ripple_time, xrp_to_drops
from xrpl.wallet import Wallet

logger = logging.getLogger(__name__)

# Override via .env when the venue network blocks the default port,
# e.g. XRPL_WS_URL=wss://s.altnet.rippletest.net:51233 (Testnet fallback)
XRPL_DEVNET_WS = os.getenv("XRPL_WS_URL", "wss://s.devnet.rippletest.net:51233")
EXPLORER_BASE = os.getenv("XRPL_EXPLORER_BASE", "https://devnet.xrpl.org")

# "RLUSD" has 5 characters — XRPL requires the 160-bit hex form for codes > 3 chars.
# This is the same currency code the official RLUSD uses.
RLUSD_CURRENCY = "524C555344000000000000000000000000000000"
RLUSD_SYMBOL = "RLUSD"
TRUSTLINE_LIMIT = "100000000"

ISSUER_ID = "treasury_issuer"
ENTITY_IDS = ["zurich", "brazil", "singapore", "corporate_vault"]

# Execution mode constants
EXEC_TOKEN_PAYMENT = "TOKEN_PAYMENT"
EXEC_XRP_PROOF = "XRP_PROOF_PAYMENT"
EXEC_SIMULATED = "SIMULATED"
EXEC_VAULT_DEPOSIT = "XLS65_VAULT_DEPOSIT"
EXEC_VAULT_WITHDRAW = "XLS65_VAULT_WITHDRAW"
EXEC_TOKEN_ESCROW = "XLS85_TOKEN_ESCROW"

# Time-lock window for escrowed repayments. In production this would be the loan
# term; for a live demo a short window lets the audience watch the full
# Create → time lock → Finish lifecycle on-chain. Override via .env.
ESCROW_WINDOW_SECONDS = int(os.getenv("ESCROW_WINDOW_SECONDS", "15"))

WALLETS: dict[str, Wallet] = {}
WALLET_ADDRESSES: dict[str, str] = {}
FUNDED: set[str] = set()       # wallets that received Devnet XRP from the faucet
TRUSTLINES: set[str] = set()   # entities with a validated RLUSD trustline
RLUSD_READY: bool = False      # issuer + trustlines + seed distribution all on-chain

# XLS-65 Single Asset Vault — a real Vault ledger object, owned by the
# corporate_vault wallet (treasury center as vault manager).
VAULT_ID: str | None = None
VAULT_ONCHAIN: bool = False
VAULT_ASSETS_MAXIMUM = "10000000"  # mirrors CORPORATE_VAULT total_capacity

# XLS-85 TokenEscrow needs the issuer's Allow Trustline Locking flag
TOKEN_ESCROW_READY: bool = False

SETUP_TX_TIMEOUT = 30   # seconds per validated setup transaction
PAYMENT_TIMEOUT = 20    # seconds for a live settlement payment
CONNECT_TIMEOUT = 6     # seconds to establish the websocket — some networks
                        # black-hole the port instead of refusing, which would
                        # otherwise hang every request that opens a connection


from contextlib import asynccontextmanager


@asynccontextmanager
async def _xrpl_client():
    """AsyncWebsocketClient with a hard timeout on the CONNECT itself."""
    client = AsyncWebsocketClient(XRPL_DEVNET_WS)
    await asyncio.wait_for(client.open(), timeout=CONNECT_TIMEOUT)
    try:
        yield client
    finally:
        await client.close()


def _fmt_iou(amount: float) -> str:
    """XRPL IOU amounts are strings; avoid scientific notation and trailing zeros."""
    s = f"{amount:.6f}".rstrip("0").rstrip(".")
    return s or "0"


def rlusd_amount(amount: float) -> IssuedCurrencyAmount:
    return IssuedCurrencyAmount(
        currency=RLUSD_CURRENCY,
        issuer=WALLET_ADDRESSES[ISSUER_ID],
        value=_fmt_iou(amount),
    )


def issuer_address() -> str | None:
    return WALLET_ADDRESSES.get(ISSUER_ID)


def explorer_tx_url(tx_hash: str) -> str:
    return f"{EXPLORER_BASE}/transactions/{tx_hash}"


def explorer_account_url(address: str) -> str:
    return f"{EXPLORER_BASE}/accounts/{address}"


async def _fund_wallet(client: AsyncWebsocketClient, wallet_id: str) -> None:
    try:
        wallet = await generate_faucet_wallet(client, debug=False)
        WALLETS[wallet_id] = wallet
        WALLET_ADDRESSES[wallet_id] = wallet.address
        FUNDED.add(wallet_id)
        logger.info(f"Wallet funded for {wallet_id}: {wallet.address}")
    except Exception as e:
        logger.warning(f"Faucet failed for {wallet_id}: {e} — creating offline wallet")
        wallet = Wallet.create()
        WALLETS[wallet_id] = wallet
        WALLET_ADDRESSES[wallet_id] = wallet.address


async def _submit_validated(client: AsyncWebsocketClient, tx, wallet: Wallet) -> dict:
    """Autofill, sign, submit and wait until the transaction is in a validated ledger."""
    response = await asyncio.wait_for(
        submit_and_wait(tx, client, wallet), timeout=SETUP_TX_TIMEOUT
    )
    result = response.result
    engine = result.get("meta", {}).get("TransactionResult", result.get("engine_result"))
    if engine != "tesSUCCESS":
        raise RuntimeError(f"Transaction failed: {engine}")
    return result


async def _create_vault(client: AsyncWebsocketClient) -> None:
    """Create the XLS-65 Single Asset Vault ledger object (asset: our RLUSD IOU).

    Owner is the corporate_vault wallet — the treasury center acts as vault
    manager: subsidiaries pay RLUSD in, the manager deposits into the vault
    object; credit lines are funded straight from the vault via VaultWithdraw.
    Degrades gracefully when the amendment is unavailable (VAULT_ONCHAIN stays
    False and vault flows fall back to plain token payments).
    """
    global VAULT_ID, VAULT_ONCHAIN
    owner = WALLETS["corporate_vault"]
    vault_tx = VaultCreate(
        account=owner.address,
        asset=IssuedCurrency(currency=RLUSD_CURRENCY, issuer=WALLET_ADDRESSES[ISSUER_ID]),
        assets_maximum=VAULT_ASSETS_MAXIMUM,
        withdrawal_policy=WithdrawalPolicy.VAULT_STRATEGY_FIRST_COME_FIRST_SERVE,
        data="TreasuryMind Corporate Liquidity Vault (XLS-65)".encode("utf-8").hex().upper(),
    )
    result = await _submit_validated(client, vault_tx, owner)
    for node in result.get("meta", {}).get("AffectedNodes", []):
        created = node.get("CreatedNode", {})
        if created.get("LedgerEntryType") == "Vault":
            VAULT_ID = created.get("LedgerIndex")
            break
    if VAULT_ID:
        VAULT_ONCHAIN = True
        logger.info(f"XLS-65 vault created on-chain: {VAULT_ID} (tx {result.get('hash')})")
    else:
        logger.warning("VaultCreate validated but no Vault node found in metadata")


async def _open_trustline(client: AsyncWebsocketClient, entity_id: str) -> None:
    trust = TrustSet(
        account=WALLETS[entity_id].address,
        limit_amount=IssuedCurrencyAmount(
            currency=RLUSD_CURRENCY,
            issuer=WALLET_ADDRESSES[ISSUER_ID],
            value=TRUSTLINE_LIMIT,
        ),
    )
    await _submit_validated(client, trust, WALLETS[entity_id])
    TRUSTLINES.add(entity_id)
    logger.info(f"RLUSD trustline open: {entity_id}")


async def setup_wallets(initial_balances: dict[str, float] | None = None) -> dict[str, str]:
    """Provision wallets, issuer, trustlines and seed RLUSD balances on Devnet.

    initial_balances maps entity id → RLUSD amount to issue on-chain at startup,
    mirroring the application-layer seed data so ledger and dashboard agree.
    Every stage degrades gracefully: if anything fails, RLUSD_READY stays False
    and payments fall back to XRP proof mode.
    """
    global RLUSD_READY
    initial_balances = initial_balances or {}

    logger.info("Setting up XRPL Devnet wallets (issuer + 4 entities)...")
    try:
        async with _xrpl_client() as client:
            # 1. Fund issuer first, then entities (sequential — the faucet rate-limits)
            for wallet_id in [ISSUER_ID, *ENTITY_IDS]:
                await _fund_wallet(client, wallet_id)

            if ISSUER_ID not in FUNDED:
                logger.error("Issuer wallet unfunded — RLUSD issuance disabled, using XRP proof mode")
                return WALLET_ADDRESSES

            issuer = WALLETS[ISSUER_ID]

            # 2. Issuer account flags: Default Ripple lets entity↔entity IOU payments
            #    ripple through the issuer. Trustline locking (XLS-85) is enabled when
            #    the installed xrpl-py knows the flag, so TokenEscrow works later.
            await _submit_validated(
                client,
                AccountSet(account=issuer.address, set_flag=AccountSetAsfFlag.ASF_DEFAULT_RIPPLE),
                issuer,
            )
            logger.info("Issuer flag set: Default Ripple")

            lock_flag = getattr(AccountSetAsfFlag, "ASF_ALLOW_TRUSTLINE_LOCKING", None)
            if lock_flag is not None:
                try:
                    await _submit_validated(
                        client, AccountSet(account=issuer.address, set_flag=lock_flag), issuer
                    )
                    global TOKEN_ESCROW_READY
                    TOKEN_ESCROW_READY = True
                    logger.info("Issuer flag set: Allow Trustline Locking (TokenEscrow-ready)")
                except Exception as e:
                    logger.warning(f"Trustline-locking flag failed (non-fatal): {e}")

            # 3. Trustlines — independent accounts, safe to run concurrently
            funded_entities = [e for e in ENTITY_IDS if e in FUNDED]
            results = await asyncio.gather(
                *(_open_trustline(client, e) for e in funded_entities),
                return_exceptions=True,
            )
            for entity_id, res in zip(funded_entities, results):
                if isinstance(res, Exception):
                    logger.warning(f"Trustline failed for {entity_id}: {res}")

            # 4. Seed distribution — sequential (same issuer account = same sequence chain)
            for entity_id in funded_entities:
                amount = initial_balances.get(entity_id, 0)
                if entity_id not in TRUSTLINES or amount <= 0:
                    continue
                payment = Payment(
                    account=issuer.address,
                    destination=WALLET_ADDRESSES[entity_id],
                    amount=rlusd_amount(amount),
                )
                await _submit_validated(client, payment, issuer)
                logger.info(f"Seeded {entity_id} with {amount:,.0f} RLUSD on-chain")

            RLUSD_READY = len(TRUSTLINES) >= 2
            if RLUSD_READY:
                logger.info(
                    f"RLUSD token economy live on Devnet — issuer {issuer.address}, "
                    f"{len(TRUSTLINES)} trustlines"
                )

            # 5. XLS-65 vault object (non-fatal — falls back to token payments)
            if RLUSD_READY and "corporate_vault" in TRUSTLINES:
                try:
                    await _create_vault(client)
                except Exception as e:
                    logger.warning(f"XLS-65 VaultCreate failed (non-fatal, amendment missing?): {e}")
    except Exception as e:
        logger.error(f"XRPL setup failed: {e} — payments will fall back to XRP proof / simulation")
        for wallet_id in [ISSUER_ID, *ENTITY_IDS]:
            if wallet_id not in WALLETS:
                wallet = Wallet.create()
                WALLETS[wallet_id] = wallet
                WALLET_ADDRESSES[wallet_id] = wallet.address

    return WALLET_ADDRESSES


def _build_memo(audit_id: str, tx_type: str, from_id: str, to_id: str, amount: float) -> tuple[str, str]:
    """
    Build a structured XRPL memo reference.
    Format: TreasuryMind|audit={id}|type={type}|route={from}-{to}|amount={amount}|ccy=RLUSD
    """
    memo_text = (
        f"TreasuryMind|audit={audit_id}|type={tx_type}"
        f"|route={from_id}-{to_id}|amount={int(amount)}|ccy=RLUSD"
    )
    memo_data = memo_text[:100].encode("utf-8").hex().upper()
    memo_type = "TreasuryMind/v2".encode("utf-8").hex().upper()
    return memo_data, memo_type


def _result_base(from_id: str, to_id: str, amount_rlusd: float, audit_id: str, memo_text: str) -> dict:
    return {
        "success": True,
        "from_address": WALLET_ADDRESSES.get(from_id),
        "to_address": WALLET_ADDRESSES.get(to_id),
        "amount_rlusd": amount_rlusd,
        "settlement_asset": RLUSD_SYMBOL,
        "issuer_address": issuer_address(),
        "timestamp": datetime.now().isoformat(),
        "memo_reference": audit_id or memo_text[:40],
    }


async def execute_payment(
    from_id: str,
    to_id: str,
    amount_rlusd: float,
    memo_text: str = "",
    audit_id: str = "",
    tx_type: str = "transfer",
) -> dict:
    """
    Settle a treasury action on XRPL Devnet.

    Primary path is a real RLUSD issued-token Payment for the FULL amount,
    validated on-ledger. If the token economy is not available (faucet outage,
    missing trustline), we fall back to a small XRP proof payment, and as a
    last resort to a fully simulated record — the demo never crashes.
    """
    if from_id not in WALLETS or to_id not in WALLETS:
        raise ValueError(f"Unknown wallet: {from_id} or {to_id}")

    sender = WALLETS[from_id]
    receiver_address = WALLET_ADDRESSES[to_id]

    if audit_id:
        memo_data, memo_type = _build_memo(audit_id, tx_type, from_id, to_id, amount_rlusd)
    else:
        memo_data = memo_text[:100].encode("utf-8").hex().upper()
        memo_type = "TreasuryMind/v2".encode("utf-8").hex().upper()
    memos = [Memo(memo_data=memo_data, memo_type=memo_type)]
    base = _result_base(from_id, to_id, amount_rlusd, audit_id, memo_text)

    # ── Rung 1: real RLUSD token transfer (one retry for transient errors) ───
    if RLUSD_READY and from_id in TRUSTLINES and to_id in TRUSTLINES:
        for attempt in (1, 2):
            try:
                payment = Payment(
                    account=sender.address,
                    destination=receiver_address,
                    amount=rlusd_amount(amount_rlusd),
                    memos=memos,
                )
                async with _xrpl_client() as client:
                    response = await asyncio.wait_for(
                        submit_and_wait(payment, client, sender), timeout=PAYMENT_TIMEOUT
                    )
                result = response.result
                engine = result.get("meta", {}).get("TransactionResult", result.get("engine_result"))
                if engine != "tesSUCCESS":
                    raise RuntimeError(f"engine result: {engine}")
                tx_hash = result.get("hash", "")
                logger.info(f"RLUSD token payment validated: {from_id}→{to_id} {amount_rlusd:,.0f} RLUSD ({tx_hash})")
                return {
                    **base,
                    "execution_mode": EXEC_TOKEN_PAYMENT,
                    "simulated": False,
                    "execution_status": "ON_CHAIN",
                    "validated": True,
                    "tx_hash": tx_hash,
                    "engine_result": engine,
                    "explorer_url": explorer_tx_url(tx_hash),
                    "network": "XRPL Devnet",
                }
            except Exception as e:
                if attempt == 1:
                    logger.warning(f"RLUSD token payment attempt 1 failed ({from_id}→{to_id}): {e} — retrying once")
                    await asyncio.sleep(2)
                else:
                    logger.warning(f"RLUSD token payment failed ({from_id}→{to_id}): {e} — trying XRP proof")

    # ── Rung 2: XRP proof payment with audit memo ────────────────────────────
    proxy_xrp = max(0.01, min(amount_rlusd / 500_000, 5.0))
    try:
        payment = Payment(
            account=sender.address,
            destination=receiver_address,
            amount=xrp_to_drops(proxy_xrp),
            memos=memos,
        )
        async with _xrpl_client() as client:
            filled = await asyncio.wait_for(autofill(payment, client), timeout=PAYMENT_TIMEOUT)
            response = await asyncio.wait_for(
                sign_and_submit(filled, client, sender), timeout=PAYMENT_TIMEOUT
            )
        engine = response.result.get("engine_result")
        logger.info(f"XRPL proof payment result: {engine}")
        if engine in ("tesSUCCESS", "terQUEUED"):
            tx_hash = response.result.get("tx_json", {}).get("hash") or response.result.get("hash", "")
            return {
                **base,
                "execution_mode": EXEC_XRP_PROOF,
                "simulated": False,
                "execution_status": "ON_CHAIN",
                "validated": False,
                "tx_hash": tx_hash,
                "amount_xrp": proxy_xrp,
                "engine_result": engine,
                "explorer_url": explorer_tx_url(tx_hash),
                "network": "XRPL Devnet",
            }
        raise RuntimeError(
            f"XRPL engine result: {engine} — {response.result.get('engine_result_message')}"
        )
    except Exception as e:
        logger.error(f"XRPL payment failed ({from_id}→{to_id}): {e} — falling back to SIMULATED")

    # ── Rung 3: full simulation ──────────────────────────────────────────────
    fake_hash = secrets.token_hex(32).upper()
    return {
        **base,
        "execution_mode": EXEC_SIMULATED,
        "simulated": True,
        "execution_status": "SIMULATED",
        "validated": False,
        "tx_hash": fake_hash,
        "explorer_url": None,
        "network": "XRPL Devnet (simulated)",
    }


def _memo_list(audit_id: str, tx_type: str, from_id: str, to_id: str, amount: float) -> list[Memo]:
    memo_data, memo_type = _build_memo(audit_id, tx_type, from_id, to_id, amount)
    return [Memo(memo_data=memo_data, memo_type=memo_type)]


async def vault_deposit_onchain(subsidiary_id: str, amount: float, audit_id: str = "") -> dict:
    """Subsidiary funds the XLS-65 vault: RLUSD payment to the vault manager,
    then a VaultDeposit moves the assets into the on-chain vault object.

    Falls back to a plain token/proof payment when the vault isn't live.
    """
    if VAULT_ONCHAIN and subsidiary_id in TRUSTLINES:
        try:
            manager = WALLETS["corporate_vault"]
            async with _xrpl_client() as client:
                payment = Payment(
                    account=WALLETS[subsidiary_id].address,
                    destination=manager.address,
                    amount=rlusd_amount(amount),
                    memos=_memo_list(audit_id, "vault_deposit", subsidiary_id, "corporate_vault", amount),
                )
                pay_result = await _submit_validated(client, payment, WALLETS[subsidiary_id])

                deposit = VaultDeposit(
                    account=manager.address,
                    vault_id=VAULT_ID,
                    amount=rlusd_amount(amount),
                    memos=_memo_list(audit_id, "xls65_deposit", "corporate_vault", "vault_object", amount),
                )
                dep_result = await _submit_validated(client, deposit, manager)

            pay_hash = pay_result.get("hash", "")
            dep_hash = dep_result.get("hash", "")
            logger.info(f"XLS-65 deposit: {subsidiary_id} → vault {amount:,.0f} RLUSD (deposit tx {dep_hash})")
            return {
                **_result_base(subsidiary_id, "corporate_vault", amount, audit_id, ""),
                "execution_mode": EXEC_VAULT_DEPOSIT,
                "simulated": False,
                "execution_status": "ON_CHAIN",
                "validated": True,
                "tx_hash": pay_hash,
                "explorer_url": explorer_tx_url(pay_hash),
                "vault_id": VAULT_ID,
                "vault_tx_hash": dep_hash,
                "vault_explorer_url": explorer_tx_url(dep_hash),
                "xrpl_instrument": "XLS-65 Single Asset Vault (on-chain)",
                "network": "XRPL Devnet",
            }
        except Exception as e:
            logger.warning(f"XLS-65 deposit failed ({subsidiary_id}): {e} — falling back to token payment")

    return await execute_payment(
        from_id=subsidiary_id, to_id="corporate_vault", amount_rlusd=amount,
        audit_id=audit_id, tx_type="vault_deposit",
    )


async def vault_credit_draw_onchain(to_id: str, amount: float, audit_id: str = "") -> dict:
    """Fund a credit line straight from the XLS-65 vault: a single VaultWithdraw
    with the borrower as destination — assets leave the vault object and arrive
    at the borrower in one validated transaction.
    """
    if VAULT_ONCHAIN and to_id in TRUSTLINES:
        try:
            manager = WALLETS["corporate_vault"]
            withdraw = VaultWithdraw(
                account=manager.address,
                vault_id=VAULT_ID,
                amount=rlusd_amount(amount),
                destination=WALLET_ADDRESSES[to_id],
                memos=_memo_list(audit_id, "vault_credit", "corporate_vault", to_id, amount),
            )
            async with _xrpl_client() as client:
                result = await _submit_validated(client, withdraw, manager)
            tx_hash = result.get("hash", "")
            logger.info(f"XLS-65 credit draw: vault → {to_id} {amount:,.0f} RLUSD ({tx_hash})")
            return {
                **_result_base("corporate_vault", to_id, amount, audit_id, ""),
                "execution_mode": EXEC_VAULT_WITHDRAW,
                "simulated": False,
                "execution_status": "ON_CHAIN",
                "validated": True,
                "tx_hash": tx_hash,
                "explorer_url": explorer_tx_url(tx_hash),
                "vault_id": VAULT_ID,
                "xrpl_instrument": "XLS-65 VaultWithdraw → borrower (on-chain)",
                "network": "XRPL Devnet",
            }
        except Exception as e:
            logger.warning(f"XLS-65 credit draw failed (→{to_id}): {e} — falling back to token payment")

    return await execute_payment(
        from_id="corporate_vault", to_id=to_id, amount_rlusd=amount,
        audit_id=audit_id, tx_type="vault_credit",
    )


async def vault_repay_via_escrow(from_id: str, amount: float, audit_id: str = "") -> dict:
    """Repay a credit line through XLS-85 TokenEscrow — three validated transactions:

      1. EscrowCreate: borrower locks the RLUSD repayment with a time lock
      2. EscrowFinish: after the lock expires, the vault manager releases it
      3. VaultDeposit: the assets re-enter the XLS-65 vault object

    Requires the issuer's Allow Trustline Locking flag (set during setup).
    Falls back to the plain repayment flow on any failure.
    """
    if not (RLUSD_READY and TOKEN_ESCROW_READY and from_id in TRUSTLINES and "corporate_vault" in TRUSTLINES):
        return await vault_repay_onchain(from_id, amount, audit_id)

    manager = WALLETS["corporate_vault"]
    try:
        now = datetime.now()
        create = EscrowCreate(
            account=WALLETS[from_id].address,
            destination=manager.address,
            amount=rlusd_amount(amount),
            finish_after=datetime_to_ripple_time(now + timedelta(seconds=ESCROW_WINDOW_SECONDS)),
            cancel_after=datetime_to_ripple_time(now + timedelta(days=2)),
            memos=_memo_list(audit_id, "repayment_escrow", from_id, "corporate_vault", amount),
        )
        async with _xrpl_client() as client:
            cre = await _submit_validated(client, create, WALLETS[from_id])
            escrow_seq = cre.get("tx_json", {}).get("Sequence") or cre.get("Sequence")
            create_hash = cre.get("hash", "")
            logger.info(
                f"TokenEscrow created: {from_id} → vault {amount:,.0f} RLUSD, "
                f"time lock {ESCROW_WINDOW_SECONDS}s ({create_hash})"
            )

            # Wait out the time lock; the ledger compares against close time,
            # so retry while the window hasn't passed on-ledger yet.
            await asyncio.sleep(ESCROW_WINDOW_SECONDS)
            fin = None
            for attempt in range(6):
                try:
                    finish = EscrowFinish(
                        account=manager.address,
                        owner=WALLETS[from_id].address,
                        offer_sequence=escrow_seq,
                        memos=_memo_list(audit_id, "escrow_release", "corporate_vault", from_id, amount),
                    )
                    fin = await _submit_validated(client, finish, manager)
                    break
                except Exception as e:
                    if "NO_PERMISSION" in str(e).upper() and attempt < 5:
                        await asyncio.sleep(4)
                        continue
                    raise
            finish_hash = fin.get("hash", "")
            logger.info(f"TokenEscrow released to vault manager ({finish_hash})")

            vault_dep_hash = None
            if VAULT_ONCHAIN:
                deposit = VaultDeposit(
                    account=manager.address,
                    vault_id=VAULT_ID,
                    amount=rlusd_amount(amount),
                    memos=_memo_list(audit_id, "xls65_redeposit", "corporate_vault", "vault_object", amount),
                )
                dep = await _submit_validated(client, deposit, manager)
                vault_dep_hash = dep.get("hash", "")

        return {
            **_result_base(from_id, "corporate_vault", amount, audit_id, ""),
            "execution_mode": EXEC_TOKEN_ESCROW,
            "simulated": False,
            "execution_status": "ON_CHAIN",
            "validated": True,
            "tx_hash": create_hash,
            "explorer_url": explorer_tx_url(create_hash),
            "escrow_create_tx": create_hash,
            "escrow_create_explorer_url": explorer_tx_url(create_hash),
            "escrow_finish_tx": finish_hash,
            "escrow_finish_explorer_url": explorer_tx_url(finish_hash),
            "escrow_window_seconds": ESCROW_WINDOW_SECONDS,
            "vault_id": VAULT_ID,
            "vault_tx_hash": vault_dep_hash,
            "vault_explorer_url": explorer_tx_url(vault_dep_hash) if vault_dep_hash else None,
            "xrpl_instrument": "XLS-85 TokenEscrow settlement → XLS-65 vault (on-chain)",
            "network": "XRPL Devnet",
        }
    except Exception as e:
        logger.warning(f"TokenEscrow repayment failed ({from_id}): {e} — falling back to direct repayment")
        return await vault_repay_onchain(from_id, amount, audit_id)


async def vault_repay_onchain(from_id: str, amount: float, audit_id: str = "") -> dict:
    """Borrower repays a credit line: RLUSD back to the vault manager, then a
    VaultDeposit returns the assets into the on-chain vault object."""
    if VAULT_ONCHAIN and from_id in TRUSTLINES:
        try:
            manager = WALLETS["corporate_vault"]
            async with _xrpl_client() as client:
                payment = Payment(
                    account=WALLETS[from_id].address,
                    destination=manager.address,
                    amount=rlusd_amount(amount),
                    memos=_memo_list(audit_id, "credit_repayment", from_id, "corporate_vault", amount),
                )
                pay_result = await _submit_validated(client, payment, WALLETS[from_id])

                deposit = VaultDeposit(
                    account=manager.address,
                    vault_id=VAULT_ID,
                    amount=rlusd_amount(amount),
                    memos=_memo_list(audit_id, "xls65_redeposit", "corporate_vault", "vault_object", amount),
                )
                dep_result = await _submit_validated(client, deposit, manager)

            pay_hash = pay_result.get("hash", "")
            logger.info(f"XLS-65 repayment: {from_id} → vault {amount:,.0f} RLUSD")
            return {
                **_result_base(from_id, "corporate_vault", amount, audit_id, ""),
                "execution_mode": EXEC_VAULT_DEPOSIT,
                "simulated": False,
                "execution_status": "ON_CHAIN",
                "validated": True,
                "tx_hash": pay_hash,
                "explorer_url": explorer_tx_url(pay_hash),
                "vault_id": VAULT_ID,
                "vault_tx_hash": dep_result.get("hash", ""),
                "vault_explorer_url": explorer_tx_url(dep_result.get("hash", "")),
                "xrpl_instrument": "XLS-65 Single Asset Vault (on-chain)",
                "network": "XRPL Devnet",
            }
        except Exception as e:
            logger.warning(f"XLS-65 repayment failed ({from_id}): {e} — falling back to token payment")

    return await execute_payment(
        from_id=from_id, to_id="corporate_vault", amount_rlusd=amount,
        audit_id=audit_id, tx_type="credit_repayment",
    )


async def get_vault_onchain_info() -> dict:
    """Read the live XLS-65 vault ledger object — on-chain proof for /api/vault."""
    if not VAULT_ONCHAIN or not VAULT_ID:
        return {}
    try:
        async with _xrpl_client() as client:
            response = await asyncio.wait_for(
                client.request(LedgerEntry(vault=VAULT_ID)), timeout=10
            )
        node = response.result.get("node", {})
        return {
            "vault_id": VAULT_ID,
            "assets_total": node.get("AssetsTotal"),
            "assets_available": node.get("AssetsAvailable"),
            "assets_maximum": node.get("AssetsMaximum"),
            "share_mpt_id": node.get("ShareMPTID"),
            "owner": node.get("Owner"),
            "explorer_url": explorer_account_url(WALLET_ADDRESSES.get("corporate_vault", "")),
        }
    except Exception as e:
        logger.warning(f"Vault ledger lookup failed: {e}")
        return {"vault_id": VAULT_ID}


async def ping() -> dict:
    """Connectivity probe for /api/health — is the XRPL endpoint reachable?"""
    try:
        async with _xrpl_client() as client:
            response = await asyncio.wait_for(client.request(ServerInfo()), timeout=5)
        info = response.result.get("info", {})
        return {
            "status": "ok",
            "endpoint": XRPL_DEVNET_WS,
            "build_version": info.get("build_version"),
            "complete_ledgers": info.get("complete_ledgers"),
        }
    except Exception as e:
        return {"status": "unreachable", "endpoint": XRPL_DEVNET_WS, "error": str(e)[:120]}


async def get_onchain_rlusd_balances() -> dict[str, float]:
    """Read actual RLUSD trustline balances from the ledger — dashboard-vs-ledger proof."""
    if not RLUSD_READY:
        return {}
    balances: dict[str, float] = {}
    try:
        async with _xrpl_client() as client:
            for entity_id in TRUSTLINES:
                response = await asyncio.wait_for(
                    client.request(
                        AccountLines(
                            account=WALLET_ADDRESSES[entity_id],
                            peer=WALLET_ADDRESSES[ISSUER_ID],
                        )
                    ),
                    timeout=10,
                )
                for line in response.result.get("lines", []):
                    if line.get("currency") == RLUSD_CURRENCY:
                        balances[entity_id] = float(line.get("balance", 0))
    except Exception as e:
        logger.warning(f"On-chain balance lookup failed: {e}")
    return balances
