// Behaviourally-accurate mock. Deterministic fake hash; identical SubmitResult shape as live.
import type { SubmitRequest, SubmitResult } from './submit.js';

let counter = 0;

export async function simSubmit(req: SubmitRequest): Promise<SubmitResult> {
  counter += 1;
  const txHash = `SIM${req.method.toUpperCase()}${counter.toString().padStart(6, '0')}`;
  return {
    source: 'SIMULATED',
    network: req.network,
    txHash,
    explorerUrl: null,
    validated: true,
    raw: { simulated: true, fields: req.fields },
  };
}
