// Maps a logical signer to (source account, signing keypair). Seeds come from .env (`pnpm provision`).
//
// AG5 custody story: the autonomous agent never holds the master key. It signs Payments on behalf of
// the HQ treasury account using a scoped REGULAR key. So `signer: 'agent'` => Account = HQ, signed by
// the agent's regular-key wallet. `signer: 'hq'` => the same account signed by HQ's master key
// (human-approved transfers). Both keys are authorised on the HQ account; provisioning runs the
// SetRegularKey that binds the agent key to HQ.
import { Wallet } from 'xrpl';

export type Signer = 'hq' | 'agent' | 'broker' | 'vault';

export interface SignerWallet {
  /** the source account that owns the funds (tx.Account) */
  account: string;
  /** the keypair that signs — may be a regular key, not the account's master key */
  wallet: Wallet;
}

function seed(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(
      `Missing ${name} in .env. Run \`pnpm provision\` and paste the printed seed block ` +
        `(see docs/MANUAL-SETUP.md) before enabling LIVE_TESTNET.`,
    );
  }
  return v;
}

/** Resolve the source account + signing wallet for a logical signer. */
export function resolveSigner(signer: Signer): SignerWallet {
  switch (signer) {
    case 'hq': {
      const w = Wallet.fromSeed(seed('HQ_WALLET_SEED'));
      return { account: w.address, wallet: w };
    }
    case 'agent': {
      // pays from the HQ account, signed by the agent's regular key (never HQ's master)
      const hq = Wallet.fromSeed(seed('HQ_WALLET_SEED'));
      const regular = Wallet.fromSeed(seed('AGENT_REGULAR_KEY_SEED'));
      return { account: hq.address, wallet: regular };
    }
    case 'vault': {
      const w = Wallet.fromSeed(seed('VAULT_WALLET_SEED'));
      return { account: w.address, wallet: w };
    }
    case 'broker': {
      const w = Wallet.fromSeed(seed('BROKER_WALLET_SEED_DEVNET'));
      return { account: w.address, wallet: w };
    }
  }
}

/** Each entity signs its OWN outgoing Payment with its own seed — so any country can be a source
 *  (inter-country transfers), not just HQ. Used by the live adapter when a transfer carries a
 *  sourceEntityId. SIM ignores signing entirely. */
const ENTITY_SEED: Record<string, string> = {
  ent_hq_ch: 'HQ_WALLET_SEED',
  ent_brz: 'SUB_BRZ_WALLET_SEED',
  ent_deu: 'SUB_DEU_WALLET_SEED',
  ent_sgp: 'SUB_SGP_WALLET_SEED',
};

/**
 * Devnet-only signer — reads *_DEVNET seeds exclusively.
 * Never touches mainnet or testnet keys so the agent runtime stays isolated.
 */
export function resolveDevnetSigner(role: 'hq' | 'depositor'): SignerWallet {
  if (role === 'hq') {
    const w = Wallet.fromSeed(seed('HQ_WALLET_SEED_DEVNET'));
    return { account: w.address, wallet: w };
  }
  // depositor = the wallet that holds XRP/RLUSD and submits VaultDeposit/VaultWithdraw
  const w = Wallet.fromSeed(seed('VAULT_WALLET_SEED_DEVNET'));
  return { account: w.address, wallet: w };
}

export function resolveSignerByEntity(entityId: string): SignerWallet {
  const envName = ENTITY_SEED[entityId];
  if (!envName) throw new Error(`No wallet seed mapping for entity ${entityId} (add it to ENTITY_SEED).`);
  const w = Wallet.fromSeed(seed(envName));
  return { account: w.address, wallet: w };
}
