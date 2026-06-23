// One-shot provisioning for the human: generates + funds all wallets, sets the agent's regular key,
// sets RLUSD trust lines on Testnet, then prints a ready-to-paste .env block.
// Run: pnpm provision   (see docs/MANUAL-SETUP.md)
import 'dotenv/config';
import { Client, Wallet } from 'xrpl';
import { toCurrencyHex } from '../xrpl/currency.js';

const TESTNET = process.env.TESTNET_RPC_URL ?? 'wss://s.altnet.rippletest.net:51233';
const DEVNET = process.env.DEVNET_RPC_URL ?? 'wss://s.devnet.rippletest.net:51233';
const RLUSD_ISSUER = process.env.RLUSD_ISSUER_TESTNET?.trim();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fund(client: Client, label: string): Promise<Wallet> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const { wallet } = await client.fundWallet();
      console.log(`  funded ${label}: ${wallet.address}`);
      return wallet;
    } catch (e) {
      console.warn(`  faucet retry ${attempt}/4 for ${label} (${(e as Error).message})`);
      await sleep(4000);
    }
  }
  throw new Error(`could not fund ${label} after retries`);
}

async function setTrustLine(client: Client, w: Wallet, issuer: string): Promise<void> {
  const tx = {
    TransactionType: 'TrustSet' as const,
    Account: w.address,
    LimitAmount: { currency: toCurrencyHex('RLUSD'), issuer, value: '1000000000' },
  };
  const res = await client.submitAndWait(tx, { wallet: w });
  const code = (res.result.meta as { TransactionResult?: string })?.TransactionResult;
  console.log(`  trustline ${w.address} -> RLUSD: ${code}`);
}

async function main() {
  // ── Testnet ────────────────────────────────────────────────────
  console.log(`\nTestnet (${TESTNET})`);
  const tc = new Client(TESTNET, {
    connectionTimeout: 20000,
  });
  await tc.connect();

  const hq = await fund(tc, 'HQ');
  const brz = await fund(tc, 'Brazil');
  const deu = await fund(tc, 'Germany');
  const sgp = await fund(tc, 'Singapore');
  const vault = await fund(tc, 'Vault');
  const agent = await fund(tc, 'Agent');
  const agentRegular = Wallet.generate(); // signer only — no funded account needed

  // The agent signs autonomous sweeps on behalf of HQ with a scoped REGULAR key, never HQ's master
  // (AG5 custody story). Bind that regular key to the HQ account so agent-signed Payments pay out of
  // HQ's RLUSD balance — matching the funding leg and the UI balance mirror.
  console.log('  binding agent regular key to HQ (SetRegularKey)…');
  const rk = await tc.submitAndWait(
    { TransactionType: 'SetRegularKey', Account: hq.address, RegularKey: agentRegular.address },
    { wallet: hq },
  );
  console.log(`  SetRegularKey: ${(rk.result.meta as { TransactionResult?: string })?.TransactionResult}`);

  if (RLUSD_ISSUER) {
    console.log('  setting RLUSD trust lines…');
    for (const w of [hq, brz, deu, sgp]) await setTrustLine(tc, w, RLUSD_ISSUER);
  } else {
    console.warn('  ⚠ RLUSD_ISSUER_TESTNET not set — skipping trust lines. Add it (step 2) and re-run.');
  }
  await tc.disconnect();

  // ── Devnet (XLS-65/66 vault + lending) ─────────────────────────
  console.log(`\nDevnet (${DEVNET})`);
  const dc = new Client(DEVNET);
  await dc.connect();
  const hqD = await fund(dc, 'HQ-devnet');
  const vaultD = await fund(dc, 'Vault-devnet');
  const brokerD = await fund(dc, 'Broker-devnet');
  await dc.disconnect();

  // ── print .env block ───────────────────────────────────────────
  console.log('\n──────── paste into .env ────────');
  console.log(`HQ_WALLET_SEED=${hq.seed}`);
  console.log(`SUB_BRZ_WALLET_SEED=${brz.seed}`);
  console.log(`SUB_DEU_WALLET_SEED=${deu.seed}`);
  console.log(`SUB_SGP_WALLET_SEED=${sgp.seed}`);
  console.log(`VAULT_WALLET_SEED=${vault.seed}`);
  console.log(`AGENT_WALLET_SEED=${agent.seed}`);
  console.log(`AGENT_REGULAR_KEY_SEED=${agentRegular.seed}`);
  console.log(`HQ_WALLET_SEED_DEVNET=${hqD.seed}`);
  console.log(`VAULT_WALLET_SEED_DEVNET=${vaultD.seed}`);
  console.log(`BROKER_WALLET_SEED_DEVNET=${brokerD.seed}`);
  console.log('# addresses (for reference / faucets / seed.json wallet_address):');
  console.log(`# HQ=${hq.address}  BRZ=${brz.address}  DEU=${deu.address}  SGP=${sgp.address}`);
  console.log(`# VAULT=${vault.address}  AGENT=${agent.address}  AGENT_REGULAR=${agentRegular.address}`);
  console.log(`# HQ_DEVNET=${hqD.address}  VAULT_DEVNET=${vaultD.address}  BROKER_DEVNET=${brokerD.address}`);
  console.log('─────────────────────────────────');
  console.log('\nNext: paste the block, then send RLUSD to the HQ address at https://tryrlusd.com (step 5).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
