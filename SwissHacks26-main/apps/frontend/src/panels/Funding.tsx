import { useState } from 'react';
import { api } from '../lib/api.js';
import { money, explorerLink, codeOf } from '../lib/format.js';
import { useAsync } from '../lib/useAsync.js';
import { Card, Section, Button, Pill, ModeBadge, FadeUp } from '../components/ui.js';
import { emitSettlement } from '../lib/settlement.js';
import { ExternalLink, Plus } from 'lucide-react';

const STATUS_TONE: Record<string, 'slate' | 'green' | 'red' | 'amber' | 'blue'> = {
  Settled: 'green', Approved: 'blue', PendingApproval: 'amber', Submitted: 'amber', Failed: 'red', Draft: 'slate',
};

export function Funding({ refreshKey, onChange }: { refreshKey: number; onChange: () => void }) {
  const [localKey, setLocalKey] = useState(0);
  const reload = () => { setLocalKey((k) => k + 1); onChange(); };
  const { data: requests } = useAsync(() => api.fundingRequests(), [refreshKey, localKey]);
  const { data: entities } = useAsync(() => api.entities(), [refreshKey]);
  const [amount, setAmount] = useState('120000.00');
  const [requester, setRequester] = useState('ent_brz');
  const [busy, setBusy] = useState(false);

  const subs = (entities ?? []).filter((e) => e.role === 'Subsidiary');
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); reload(); } catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  };
  const execute = async (id: string, requester: string, amount: string) => {
    setBusy(true);
    try {
      const res = await api.execute(id);
      emitSettlement({ fromCode: 'HQ', toCode: codeOf(requester), amount, txHash: res.result.txHash, source: res.result.source, network: res.result.network, kind: 'transfer' });
      reload();
    } catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  };

  const field = 'rounded-lg border border-hairline bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100';

  return (
    <>
      <Section title="New funding request" subtitle="A subsidiary requests working capital — HQ approves & settles in RLUSD">
        <FadeUp>
          <Card className="flex flex-wrap items-end gap-4 p-5">
            <label className="text-sm">
              <div className="mb-1.5 text-xs font-medium text-slate-500">Subsidiary</div>
              <select value={requester} onChange={(e) => setRequester(e.target.value)} className={field}>
                {subs.map((s) => <option key={s.id} value={s.id}>{s.legal_name}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <div className="mb-1.5 text-xs font-medium text-slate-500">Amount (RLUSD)</div>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} className={`${field} tnum w-40`} />
            </label>
            <Button disabled={busy} onClick={() => act(() => api.requestFunding({ requester_entity_id: requester, amount, purpose: 'Working-capital gap', urgency: 'High' }))}>
              <Plus size={15} /> Create request
            </Button>
          </Card>
        </FadeUp>
      </Section>

      <Section title="Requests">
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3 font-medium">ID</th><th className="font-medium">Subsidiary</th><th className="font-medium">Amount</th><th className="font-medium">Status</th><th className="font-medium">Transaction</th><th></th>
              </tr>
            </thead>
            <tbody>
              {(requests ?? []).map((r) => {
                const link = explorerLink(r.network, r.tx_hash);
                return (
                  <tr key={r.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50/50">
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{r.id}</td>
                    <td className="text-slate-700">{r.requester_entity_id}</td>
                    <td className="tnum font-medium text-slate-900">{money(r.amount)}</td>
                    <td><Pill tone={STATUS_TONE[r.status] ?? 'slate'}>{r.status}</Pill></td>
                    <td>
                      {r.tx_hash ? (
                        <span className="flex items-center gap-2">
                          {link ? (
                            <a className="inline-flex items-center gap-1 font-mono text-xs text-brand-600 hover:underline" href={link} target="_blank" rel="noreferrer">{r.tx_hash.slice(0, 10)}… <ExternalLink size={11} /></a>
                          ) : <span className="font-mono text-xs text-slate-400">{r.tx_hash.slice(0, 12)}…</span>}
                          <ModeBadge source={r.source} network={r.network} />
                        </span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="py-3 pr-5 text-right">
                      {r.status === 'PendingApproval' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => api.approve(r.id, 'group_treasurer'))}>Approve</Button>}
                      {r.status === 'Approved' && <Button size="sm" disabled={busy} onClick={() => execute(r.id, r.requester_entity_id, r.amount)}>Execute transfer</Button>}
                    </td>
                  </tr>
                );
              })}
              {(requests ?? []).length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400">No requests yet.</td></tr>}
            </tbody>
          </table>
        </Card>
      </Section>
    </>
  );
}
