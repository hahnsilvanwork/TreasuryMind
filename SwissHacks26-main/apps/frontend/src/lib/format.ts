// Display helpers — money as grouped RLUSD, dates short. Domain values stay decimal strings.
export function money(v: string | number, code = 'RLUSD'): string {
  const n = Number(v);
  const s = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${s} ${code}`;
}

export function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

const CODE: Record<string, string> = { ent_hq_ch: 'HQ', ent_brz: 'BR', ent_deu: 'DE', ent_sgp: 'SG' };
export function codeOf(entityId: string): string {
  return CODE[entityId] ?? entityId.replace('ent_', '').toUpperCase().slice(0, 3);
}

export function explorerLink(network: string | null, txHash: string | null): string | null {
  if (!txHash || !network) return null;
  if (txHash.startsWith('SIM')) return null;
  const host = network === 'devnet' ? 'devnet.xrpl.org' : 'testnet.xrpl.org';
  return `https://${host}/transactions/${txHash}`;
}
