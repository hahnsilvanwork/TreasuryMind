// ONE-COMMAND on-chain proof — run on an UNBLOCKED network (phone hotspot / venue wifi), NOT the
// corporate LAN (which blocks the XRPL WebSocket/JSON-RPC submit endpoints; only the faucet HTTPS host
// gets through). Run: `pnpm prove`
//
// What it does, fully automatic:
//   1. Funds wallets from the Testnet faucet (HQ + two destinations).
//   2. Binds a scoped agent REGULAR key to the HQ account (SetRegularKey, AG5).
//   3. Sets RLUSD trust lines (if RLUSD_ISSUER_TESTNET is set) and uses real RLUSD when HQ holds it;
//      otherwise falls back to XRP — still REAL on-chain activity satisfying the agent-pillar requirement.
//   4. Submits the two headline transactions:
//        (a) HQ → subsidiary funding Payment      (signed by HQ master key)
//        (b) autonomous agent sweep Payment       (signed by the agent regular key on HQ)
//   5. Captures the validated tesSUCCESS hashes + explorer links, writes ONCHAIN-PROOF.md, and prints
//      a ready-to-paste .env seed block so the running app can go LIVE too (LIVE_TESTNET=true).
import 'dotenv/config';
import { Client, Wallet, xrpToDrops, type Payment } from 'xrpl';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { toCurrencyHex } from '../xrpl/currency.js';

const TESTNET = process.env.TESTNET_RPC_URL?.trim() || 'wss://s.altnet.rippletest.net:51233';
const RLUSD_ISSUER = process.env.RLUSD_ISSUER_TESTNET?.trim();
const EXPLORER = 'https://testnet.xrpl.org/transactions/';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const codeOf = (res: { result: { meta?: unknown } }): string =>
  (res.result.meta as { TransactionResult?: string })?.TransactionResult ?? 'unknown';

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

async function trustRlusd(client: Client, w: Wallet): Promise<void> {
  if (!RLUSD_ISSUER) return;
  const res = await client.submitAndWait(
    {
      TransactionType: 'TrustSet',
      Account: w.address,
      LimitAmount: { currency: toCurrencyHex('RLUSD'), issuer: RLUSD_ISSUER, value: '1000000000' },
    },
    { wallet: w },
  );
  console.log(`  trustline ${w.address} -> RLUSD: ${codeOf(res)}`);
}

async function hasRlusd(client: Client, address: string): Promise<boolean> {
  if (!RLUSD_ISSUER) return false;
  try {
    const balances = await client.getBalances(address);
    return balances.some((b) => b.issuer === RLUSD_ISSUER && Number(b.value) > 0);
  } catch {
    return false;
  }
}

/** Submit a Payment and return the validated hash (throws on non-tesSUCCESS). */
async function pay(
  client: Client,
  opts: { account: string; signer: Wallet; to: string; useRlusd: boolean; amount: string; memo?: string },
): Promise<string> {
  const tx: Payment = {
    TransactionType: 'Payment',
    Account: opts.account,
    Destination: opts.to,
    Amount: opts.useRlusd
      ? { currency: toCurrencyHex('RLUSD'), issuer: RLUSD_ISSUER!, value: opts.amount }
      : xrpToDrops(opts.amount),
  };
  if (opts.memo) {
    tx.Memos = [{ Memo: { MemoData: Buffer.from(opts.memo, 'utf8').toString('hex').toUpperCase() } }];
  }
  const prepared = await client.autofill(tx);
  const signed = opts.signer.sign(prepared);
  const res = await client.submitAndWait(signed.tx_blob);
  const code = codeOf(res);
  if (code !== 'tesSUCCESS') throw new Error(`Payment failed: ${code} (hash ${res.result.hash})`);
  return res.result.hash!;
}

async function main() {
  console.log(`\nReduitTreasuries — on-chain proof on ${TESTNET}\n`);
  const client = new Client(TESTNET, { connectionTimeout: 20000 });
  await client.connect();

  // 1. wallets
  console.log('Funding wallets…');
  const hq = await fund(client, 'HQ');
  const brz = await fund(client, 'Brazil (funding dest)');
  const deu = await fund(client, 'Germany (subsidiary)');
  const sgp = await fund(client, 'Singapore (sweep dest)');
  const vault = await fund(client, 'Vault pool (XLS-65 custodian)');
  const agentRegular = Wallet.generate(); // signer only

  // 2. agent regular key bound to HQ (AG5)
  console.log('\nBinding agent regular key to HQ (SetRegularKey)…');
  const rk = await client.submitAndWait(
    { TransactionType: 'SetRegularKey', Account: hq.address, RegularKey: agentRegular.address },
    { wallet: hq },
  );
  console.log(`  SetRegularKey: ${codeOf(rk)}`);

  // 3. trustlines + asset choice
  if (RLUSD_ISSUER) {
    console.log('\nSetting RLUSD trust lines…');
    for (const w of [hq, brz, deu, sgp]) await trustRlusd(client, w);
  } else {
    console.warn('\n⚠ RLUSD_ISSUER_TESTNET not set — using XRP for the proof (still real on-chain).');
  }
  const useRlusd = await hasRlusd(client, hq.address);
  const asset = useRlusd ? 'RLUSD' : 'XRP';
  if (RLUSD_ISSUER && !useRlusd) {
    console.warn(
      '⚠ HQ holds no RLUSD yet — send some to the HQ address at https://tryrlusd.com and re-run for an',
      'RLUSD proof. Proceeding now with XRP (real on-chain, satisfies the agent-pillar requirement).',
    );
  }
  console.log(`\nAsset for the proof: ${asset}`);

  // 4. the two headline transactions
  const amount = useRlusd ? '120.00' : '1'; // 120 RLUSD or 1 XRP
  console.log('\nSubmitting transactions…');
  const fundingHash = await pay(client, { account: hq.address, signer: hq, to: brz.address, useRlusd, amount });
  console.log(`  (1) HQ→Brazil funding Payment (HQ-signed): tesSUCCESS ${fundingHash}`);
  const sweepHash = await pay(client, {
    account: hq.address, signer: agentRegular, to: sgp.address, useRlusd,
    amount: useRlusd ? '15000.00' : '1',
    memo: JSON.stringify({ recommendationId: 'auto-sweep', policyId: 'agent_sweep_auto' }),
  });
  console.log(`  (2) Agent sweep Payment (agent-signed): tesSUCCESS ${sweepHash}`);

  await client.disconnect();

  // 5. write proof + print env block
  const proof = [
    `# On-chain proof — ReduitTreasuries (Testnet, real ${asset})`,
    ``,
    `Captured by \`pnpm prove\`. Both transactions validated \`tesSUCCESS\` on XRPL Testnet.`,
    ``,
    `| # | Item | Signer | Asset | Explorer |`,
    `| --- | --- | --- | --- | --- |`,
    `| 1 | HQ→subsidiary funding \`Payment\` | HQ master key | ${asset} | ${EXPLORER}${fundingHash} |`,
    `| 2 | **Autonomous agent sweep** \`Payment\` | **agent regular key on HQ** (AG5) | ${asset} | ${EXPLORER}${sweepHash} |`,
    ``,
    `Network: \`${TESTNET}\`${RLUSD_ISSUER ? ` · RLUSD issuer: \`${RLUSD_ISSUER}\`` : ''}`,
    ``,
  ].join('\n');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  writeFileSync(resolve(root, 'docs/ONCHAIN-PROOF.md'), proof);

  // Auto-write seeds into .env so the app starts LIVE without manual copy-paste
  const envPath = resolve(root, '.env');
  let envContent = readFileSync(envPath, 'utf8');
  const seedMap: Record<string, string> = {
    HQ_WALLET_SEED: hq.seed!,
    SUB_BRZ_WALLET_SEED: brz.seed!,
    SUB_DEU_WALLET_SEED: deu.seed!,
    SUB_SGP_WALLET_SEED: sgp.seed!,
    VAULT_WALLET_SEED: vault.seed!,
    AGENT_REGULAR_KEY_SEED: agentRegular.seed!,
    LIVE_TESTNET: 'true',
  };
  for (const [key, value] of Object.entries(seedMap)) {
    envContent = envContent.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
  }
  writeFileSync(envPath, envContent);

  // Update seed.json with real XRPL wallet addresses so on-chain payments have valid destinations
  const seedJsonPath = resolve(root, 'apps/backend/src/seed/seed.json');
  const seedJson = JSON.parse(readFileSync(seedJsonPath, 'utf8'));
  const addrMap: Record<string, string> = {
    ent_hq_ch: hq.address,
    ent_brz: brz.address,
    ent_deu: deu.address,
    ent_sgp: sgp.address,
  };
  for (const entity of seedJson.entities as { id: string; wallet_address: string }[]) {
    if (addrMap[entity.id]) entity.wallet_address = addrMap[entity.id];
  }
  writeFileSync(seedJsonPath, JSON.stringify(seedJson, null, 2));

  console.log('\n──────── ✅ ON-CHAIN PROOF CAPTURED ────────');
  console.log(`(1) Funding:     ${EXPLORER}${fundingHash}`);
  console.log(`(2) Agent sweep: ${EXPLORER}${sweepHash}`);
  console.log('Written to docs/ONCHAIN-PROOF.md.');
  console.log('Seeds written to .env automatically — app will start LIVE.');
  console.log('\n──────── seeds written to .env ────────');
  console.log(`HQ_WALLET_SEED=${hq.seed}`);
  console.log(`SUB_BRZ_WALLET_SEED=${brz.seed}`);
  console.log(`SUB_DEU_WALLET_SEED=${deu.seed}`);
  console.log(`SUB_SGP_WALLET_SEED=${sgp.seed}`);
  console.log(`VAULT_WALLET_SEED=${vault.seed}`);
  console.log(`AGENT_REGULAR_KEY_SEED=${agentRegular.seed}`);
  console.log(`LIVE_TESTNET=true`);
  console.log('─────────────────────────────────────────────────');
}

main().catch((e) => {
  console.error('\n❌ on-chain proof failed:', (e as Error).message);
  console.error('If this is a connection/timeout error, you are likely on a network that blocks the XRPL');
  console.error('WebSocket endpoint. Re-run on a phone hotspot or the venue wifi.');
  process.exit(1);
});
