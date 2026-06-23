import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { Section, Card, ModeBadge } from '../components/ui.js';
import { explorerLink, money } from '../lib/format.js';
import { ArrowLeftRight, Check, FilePlus2, Zap, Landmark, Banknote, TrendingUp, ShieldAlert, ExternalLink, Activity } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

function meta(action: string): { icon: LucideIcon; bg: string; fg: string } {
  if (/Settled|Transfer/.test(action)) return { icon: ArrowLeftRight, bg: 'bg-emerald-50', fg: 'text-emerald-600' };
  if (/Sweep/.test(action)) return { icon: Zap, bg: 'bg-brand-50', fg: 'text-brand-600' };
  if (/Approved/.test(action)) return { icon: Check, bg: 'bg-brand-50', fg: 'text-brand-600' };
  if (/Created|Requested/.test(action)) return { icon: FilePlus2, bg: 'bg-slate-100', fg: 'text-slate-500' };
  if (/Vault/.test(action)) return { icon: Landmark, bg: 'bg-amber-50', fg: 'text-amber-600' };
  if (/CreditLine/.test(action)) return { icon: action.includes('Impair') ? Banknote : Banknote, bg: 'bg-amber-50', fg: 'text-amber-600' };
  if (/Investment/.test(action)) return { icon: TrendingUp, bg: 'bg-emerald-50', fg: 'text-emerald-600' };
  if (/Blocked|Failed|Impair/.test(action)) return { icon: ShieldAlert, bg: 'bg-red-50', fg: 'text-red-600' };
  return { icon: Activity, bg: 'bg-slate-100', fg: 'text-slate-500' };
}

const humanize = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2');

export function AuditLog({ refreshKey }: { refreshKey: number }) {
  const { data } = useAsync(() => api.audit(), [refreshKey]);
  const events = data ?? [];

  return (
    <Section title="Audit trail" subtitle="Every action — identical shape whether live or simulated">
      <Card className="overflow-hidden p-0">
        {events.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-muted">No events yet — run a flow to populate the trail.</p>
        ) : (
          <div className="divide-y divide-hairline">
            {events.map((e) => {
              const m = meta(e.action_type);
              const link = explorerLink(e.network, e.tx_hash);
              const amount = (e.detail as { amount?: string })?.amount;
              const Icon = m.icon;
              return (
                <div key={e.id} className="flex gap-3 px-5 py-3.5 transition hover:bg-slate-50/40">
                  <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${m.bg} ${m.fg}`}><Icon size={15} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-ink">{humanize(e.action_type)}</span>
                      <span className="shrink-0 text-xs text-muted">{e.created_at.slice(0, 16).replace('T', ' ')}</span>
                    </div>
                    <div className="mt-0.5 text-[13px] text-muted">
                      {e.entity_id && <span>{e.entity_id} · </span>}{e.actor}{amount && <> · <span className="text-ink">{money(amount)}</span></>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      {e.policy_decision && (
                        <span className="inline-flex items-center gap-1.5 text-muted">
                          <span className={`h-1.5 w-1.5 rounded-full ${e.policy_decision.outcome === 'BLOCK' ? 'bg-red-500' : e.policy_decision.outcome === 'ALLOW' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                          policy {e.policy_decision.outcome.toLowerCase()}
                        </span>
                      )}
                      {e.tx_hash && (
                        <span className="inline-flex items-center gap-2">
                          {link ? <a className="inline-flex items-center gap-1 font-mono text-brand-600 hover:underline" href={link} target="_blank" rel="noreferrer">{e.tx_hash.slice(0, 12)}… <ExternalLink size={10} /></a> : <span className="font-mono text-muted">{e.tx_hash.slice(0, 14)}…</span>}
                          <ModeBadge source={e.source} network={e.network} />
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </Section>
  );
}
