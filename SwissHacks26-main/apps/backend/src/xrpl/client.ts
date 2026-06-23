// One lazily-connected, reused xrpl.js Client per network. The live adapter and any future
// live methods share these so we don't open a socket per transaction. Disconnected on shutdown.
import { Client } from 'xrpl';
import type { Network } from '@reduit/shared';

const RPC: Record<Network, string> = {
  testnet: process.env.TESTNET_RPC_URL?.trim() || 'wss://s.altnet.rippletest.net:51233',
  devnet: process.env.DEVNET_RPC_URL?.trim() || 'wss://s.devnet.rippletest.net:51233',
};

const clients: Partial<Record<Network, Client>> = {};

export async function getClient(network: Network): Promise<Client> {
  let client = clients[network];
  if (!client) {
    client = new Client(RPC[network], { connectionTimeout: 20_000 });
    clients[network] = client;
  }
  if (!client.isConnected()) await client.connect();
  return client;
}

/** Close every open socket — call on server shutdown so the process can exit cleanly. */
export async function disconnectAll(): Promise<void> {
  await Promise.all(
    Object.values(clients).map((c) => (c && c.isConnected() ? c.disconnect() : Promise.resolve())),
  );
}
