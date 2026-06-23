// Tiny pub/sub so any flow can trigger the signature settlement animation without prop-drilling.
export interface SettlementEvent {
  id: string;
  fromCode: string;
  toCode: string;
  amount: string;
  txHash: string | null;
  source: string;
  network: string | null;
  kind: 'transfer' | 'sweep';
}

type Cb = (e: SettlementEvent) => void;
const listeners = new Set<Cb>();
let seq = 0;

export function emitSettlement(e: Omit<SettlementEvent, 'id'>): void {
  seq += 1;
  const full: SettlementEvent = { ...e, id: `st_${seq}` };
  listeners.forEach((l) => l(full));
}

export function onSettlement(cb: Cb): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
