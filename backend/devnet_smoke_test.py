"""One-shot Devnet smoke test — run this on an OPEN network (hotspot/home WiFi).

Verifies the full on-chain chain end to end and prints explorer links:
  1. Wallet setup: issuer + 4 entities, trustlines, RLUSD seed distribution
  2. XLS-65 VaultCreate
  3. RLUSD token payment (zurich → brazil, 380K)
  4. Vault deposit (zurich → vault, 500K)
  5. Credit draw via VaultWithdraw (vault → brazil, 200K)
  6. XLS-85 TokenEscrow repayment (EscrowCreate → time lock → EscrowFinish → VaultDeposit)
  7. On-chain balances + vault ledger object

Usage:  python devnet_smoke_test.py
Note:   corporate networks often block XRPL ports — if setup fails instantly,
        switch to a hotspot. Takes ~3-4 minutes on a good connection.
"""
import asyncio
import logging

logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(message)s")

import xrpl_service as x


def section(title: str) -> None:
    print(f"\n{'═' * 60}\n  {title}\n{'═' * 60}")


async def main() -> None:
    section("1+2. Setup: wallets, trustlines, RLUSD seed, XLS-65 vault")
    await x.setup_wallets(initial_balances={
        "zurich": 2_000_000, "brazil": 120_000, "singapore": 850_000, "corporate_vault": 0,
    })
    print(f"\n  RLUSD ready:    {x.RLUSD_READY}")
    print(f"  Trustlines:     {sorted(x.TRUSTLINES)}")
    print(f"  Vault on-chain: {x.VAULT_ONCHAIN}  (ID: {x.VAULT_ID})")
    print(f"  Issuer:         {x.explorer_account_url(x.issuer_address() or '')}")
    if not x.RLUSD_READY:
        print("\n  ✗ ABORT — token economy not live (network blocked?). Try a hotspot.")
        return

    section("3. RLUSD token payment: zurich → brazil, 380,000")
    r = await x.execute_payment("zurich", "brazil", 380_000,
                                audit_id="SMOKE-0001", tx_type="direct_transfer")
    print(f"  mode={r['execution_mode']}  status={r['execution_status']}  validated={r.get('validated')}")
    print(f"  → {r.get('explorer_url')}")

    section("4. XLS-65 vault deposit: zurich → vault, 500,000")
    r = await x.vault_deposit_onchain("zurich", 500_000, audit_id="SMOKE-0002")
    print(f"  mode={r['execution_mode']}  status={r['execution_status']}")
    print(f"  payment   → {r.get('explorer_url')}")
    print(f"  VaultDep. → {r.get('vault_explorer_url', '(fallback — no vault tx)')}")

    section("5. Credit draw via VaultWithdraw: vault → brazil, 200,000")
    r = await x.vault_credit_draw_onchain("brazil", 200_000, audit_id="SMOKE-0003")
    print(f"  mode={r['execution_mode']}  status={r['execution_status']}")
    print(f"  → {r.get('explorer_url')}")

    section(f"6. XLS-85 TokenEscrow repayment: brazil → vault, 200,000 ({x.ESCROW_WINDOW_SECONDS}s lock)")
    r = await x.vault_repay_via_escrow("brazil", 200_000, audit_id="SMOKE-0004")
    print(f"  mode={r['execution_mode']}  status={r['execution_status']}")
    print(f"  EscrowCreate → {r.get('escrow_create_explorer_url', '(fallback — no escrow)')}")
    print(f"  EscrowFinish → {r.get('escrow_finish_explorer_url', '—')}")
    print(f"  VaultDeposit → {r.get('vault_explorer_url', '—')}")

    section("7. On-chain state")
    balances = await x.get_onchain_rlusd_balances()
    for k, v in sorted(balances.items()):
        print(f"  {k:18s} {v:>14,.0f} RLUSD")
    vault = await x.get_vault_onchain_info()
    print(f"\n  Vault assets total/available: {vault.get('assets_total')} / {vault.get('assets_available')}")
    print(f"  Vault owner page: {vault.get('explorer_url')}")

    # zurich: 2.0M - 380K transfer - 500K deposit; brazil: 120K + 380K + 200K draw - 200K repaid;
    # corporate_vault wallet: 0 (deposits sit inside the vault object: 500K - 200K + 200K = 500K)
    expected = {"zurich": 1_120_000, "brazil": 500_000, "singapore": 850_000, "corporate_vault": 0}
    ok = all(abs(balances.get(k, -1) - v) < 1 for k, v in expected.items())
    print(f"\n  {'✓ ALL CHECKS PASSED' if ok else '✗ BALANCE MISMATCH — check explorer links above'}")
    print(f"  expected: {expected}")


if __name__ == "__main__":
    asyncio.run(main())
