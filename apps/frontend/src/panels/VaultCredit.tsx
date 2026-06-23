import { useState } from 'react';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import { useAsync } from '../lib/useAsync.js';
import { Card, Section, Button, Stat, Pill, ModeBadge, FadeUp, CountUp } from '../components/ui.js';
import { XLS65OnChainProof, type OnChainProof } from '../components/XLS65OnChainProof.js';
import { Plus } from 'lucide-react';

const LINE_TONE: Record<string, 'slate' | 'green' | 'red' | 'amber' | 'blue'> = {
  Active: 'blue', Repaid: 'green', Closed: 'green', Overdue: 'red', Impaired: 'red',
};

export function VaultCredit({ refreshKey, onChange }: { refreshKey: number; onChange: () => void }) {
  const [localKey, setLocalKey] = useState(0);
  const reload = () => { setLocalKey((k) => k + 1); onChange(); };
  const { data: vault } = useAsync(() => api.vault(), [refreshKey, localKey]);
  const { data: lines } = useAsync(() => api.creditLines(), [refreshKey, localKey]);
  const { data: cfg } = useAsync(() => api.config(), [refreshKey]);
  const vaultLive = cfg?.vaultDevnet === 'live';
  const loanLive = cfg?.loanDevnet === 'live';
  const [busy, setBusy] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [lastProof, setLastProof] = useState<OnChainProof | null>(null);
  const [depAmount, setDepAmount] = useState('100000.00');
  const [principal, setPrincipal] = useState('80000.00');

  // vaultAct: runs a vault deposit/withdraw — wires the on-chain proof + animation
  const vaultAct = async (fn: () => Promise<unknown>, action: OnChainProof['action'], asset?: string, amount?: string) => {
    setBusy(true);
    setAnimating(true);
    try {
      const res = await fn() as { result?: OnChainProof };
      const r: Partial<OnChainProof> = res?.result ?? {};
      setLastProof({
        txHash: r.txHash ?? null,
        explorerUrl: r.explorerUrl ?? null,
        source: r.source ?? 'SIMULATED',
        network: r.network ?? null,
        action,
        asset,
        amount,
      });
      reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
      setTimeout(() => setAnimating(false), 2200);
    }
  };

  // lineAct: credit line actions — no proof panel update
  const lineAct = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); reload(); } catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  };

  const field = 'rounded-lg border border-hairline bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100';

  return (
    <>
      <Section title="Pooled liquidity vault (XLS-65)" subtitle="One pool, two views — shared by credit lines and the allocator" action={<ModeBadge source={vaultLive ? 'LIVE' : 'SIMULATED'} network={vaultLive ? 'devnet' : null} />}>
        <FadeUp>
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="p-5"><Stat label="Available" value={<><CountUp value={vault ? Number(vault.available) : 0} /></>} sub="liquid" /></Card>
            <Card className="p-5"><Stat label="Locked" value={<CountUp value={vault ? Number(vault.locked) : 0} />} sub="lent / invested" /></Card>
            <Card className="p-5"><Stat label="Total deposited" value={<CountUp value={vault ? Number(vault.deposited) : 0} />} /></Card>
            <Card className="p-5"><Stat label="Share price" value={vault?.sharePrice ?? '—'} sub="assets / shares" /></Card>
          </div>
          <Card className="mt-4 p-5">
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-sm">
                <div className="mb-1.5 text-xs font-medium text-slate-500">Germany deposits surplus (RLUSD)</div>
                <input value={depAmount} onChange={(e) => setDepAmount(e.target.value)} className={`${field} tnum w-44`} />
              </label>
              <Button variant="subtle" disabled={busy} onClick={() => vaultAct(() => api.vaultDeposit('ent_deu', depAmount), 'VaultDeposit', 'RLUSD', depAmount)}>
                <Plus size={15} /> Deposit to vault
              </Button>
            </div>

            {/* XLS-65 on-chain proof + animation */}
            <XLS65OnChainProof proof={lastProof} animating={animating} />
          </Card>
        </FadeUp>
      </Section>

      <Section title="Internal liquidity lines (XLS-66)" subtitle="7-day lines · HQ first-loss cover · early-close payoff = principal" action={<ModeBadge source={loanLive ? 'LIVE' : 'SIMULATED'} network={loanLive ? 'devnet' : null} />}>
        <Card className="mb-4 flex flex-wrap items-end gap-4 p-5">
          <label className="text-sm">
            <div className="mb-1.5 text-xs font-medium text-slate-500">7-day line for Brazil — principal</div>
            <input value={principal} onChange={(e) => setPrincipal(e.target.value)} className={`${field} tnum w-44`} />
          </label>
          <Button disabled={busy} onClick={() => lineAct(() => api.createLine('ent_brz', principal))}><Plus size={15} /> Originate line</Button>
        </Card>
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3 font-medium">ID</th><th className="font-medium">Borrower</th><th className="font-medium">Principal</th><th className="font-medium">Cover</th><th className="font-medium">Maturity</th><th className="font-medium">Status</th><th className="font-medium">Mode</th><th></th>
              </tr>
            </thead>
            <tbody>
              {(lines ?? []).map((l) => (
                <tr key={l.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50/50">
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">{l.id}</td>
                  <td className="text-slate-700">{l.borrower_entity_id}</td>
                  <td className="tnum font-medium text-slate-900">{money(l.principal)}</td>
                  <td className="tnum text-slate-600">{money(l.cover_available)}</td>
                  <td className="text-xs text-slate-500">{l.maturity_date.slice(0, 10)}</td>
                  <td><Pill tone={LINE_TONE[l.status] ?? 'slate'}>{l.status}</Pill></td>
                  <td><ModeBadge source={l.source} network={l.network} /></td>
                  <td className="space-x-1 py-3 pr-5 text-right">
                    {(l.status === 'Active' || l.status === 'Overdue') && <Button size="sm" variant="ghost" disabled={busy} onClick={() => lineAct(() => api.impairLine(l.id))}>Impair</Button>}
                    {l.status === 'Impaired' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => lineAct(() => api.clearImpair(l.id))}>Clear</Button>}
                    {(l.status === 'Active' || l.status === 'Overdue') && <Button size="sm" disabled={busy} onClick={() => lineAct(() => api.repayLine(l.id))}>Repay</Button>}
                  </td>
                </tr>
              ))}
              {(lines ?? []).length === 0 && <tr><td colSpan={8} className="px-5 py-8 text-center text-slate-400">No credit lines yet.</td></tr>}
            </tbody>
          </table>
        </Card>
      </Section>
    </>
  );
}
