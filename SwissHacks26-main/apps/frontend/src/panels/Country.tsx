import { useState } from 'react';
import { Send, HandCoins, ExternalLink, ArrowRight } from 'lucide-react';
import { api } from '../lib/api.js';
import type { CountryPrefill as _Prefill } from '../App.js';
import { useAsync } from '../lib/useAsync.js';
import { money, codeOf, explorerLink, shortDate } from '../lib/format.js';
import { emitSettlement } from '../lib/settlement.js';
import { Card, Section, Button, Pill, CountUp, Field, TextInput, Select, ModeBadge } from '../components/ui.js';
import { COUNTRY } from '../components/Logo.js';

export function Country({
  entityId, prefill, refreshKey, onChange,
}: {
  entityId: string;
  prefill?: _Prefill;
  refreshKey: number;
  onChange: () => void;
}) {
  const { data: entities } = useAsync(() => api.entities(), [refreshKey]);
  const { data: forecast } = useAsync(() => api.forecast(), [refreshKey]);
  const { data: audit } = useAsync(() => api.audit(), [refreshKey]);

  const me = entities?.find((e) => e.id === entityId);
  const others = (entities ?? []).filter((e) => e.id !== entityId);
  const f = forecast?.find((x) => x.entity_id === entityId);
  const c = me ? COUNTRY[me.country] ?? { name: me.country, bar: 'bg-slate-400', text: 'text-slate-600' } : null;

  // send form (this entity is the SOURCE)
  const [to, setTo] = useState(prefill?.toEntityId ?? '');
  const [sendAmt, setSendAmt] = useState(prefill?.amount ?? '');
  const [sendMsg, setSendMsg] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // request form (this entity is the REQUESTER / destination)
  const [from, setFrom] = useState('');
  const [reqAmt, setReqAmt] = useState('');
  const [reqMsg, setReqMsg] = useState<string | null>(null);

  if (!me || !c) return <p className="text-muted">Loading…</p>;

  const myActivity = (audit ?? []).filter(
    (e) => e.entity_id === entityId || (e.detail?.from as string) === entityId || (e.detail?.to as string) === entityId,
  ).slice(0, 8);

  const send = async () => {
    if (!to || !sendAmt) return;
    setSending(true); setSendMsg(null);
    try {
      const r = await api.transfer(entityId, to, sendAmt, 'Inter-company transfer');
      emitSettlement({ fromCode: codeOf(entityId), toCode: codeOf(to), amount: sendAmt, txHash: r.result.txHash, source: r.result.source, network: r.result.network, kind: 'transfer' });
      setSendMsg(`Sent ${money(sendAmt)} to ${codeOf(to)}.`);
      setSendAmt('');
      onChange();
    } catch (e) {
      setSendMsg((e as Error & { body?: { error?: string } }).body?.error ?? (e as Error).message);
    } finally { setSending(false); }
  };

  const request = async () => {
    if (!reqAmt) return;
    setReqMsg(null);
    try {
      await api.requestFunding({ requester_entity_id: entityId, source_entity_id: from || null, amount: reqAmt, purpose: 'Funding request', urgency: 'High' });
      setReqMsg(`Request for ${money(reqAmt)} created${from ? ` (suggested source ${codeOf(from)})` : ''}. Approve it in the Funding tab.`);
      setReqAmt('');
      onChange();
    } catch (e) {
      setReqMsg((e as Error).message);
    }
  };

  const below = f?.belowBuffer;
  const headroom = f && Number(f.surplus) > 0;

  return (
    <>
      {/* header */}
      <Card className="mb-6 overflow-hidden p-0">
        <div className="flex">
          <div className={`w-1.5 shrink-0 ${c.bar}`} />
          <div className="flex-1 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className={`fi fi-${me.country.toLowerCase()} rounded-[3px] shadow-sm`} style={{ fontSize: '26px' }} />
                <div>
                  <div className="text-lg font-semibold text-ink">{c.name} <span className="text-sm font-normal text-muted">· {me.role}</span></div>
                  <div className="text-[13px] text-muted">{me.legal_name}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold tracking-tight text-ink"><CountUp value={Number(me.balance)} /> <span className="text-sm font-normal text-muted">RLUSD</span></div>
                <div className="text-[13px] text-muted">buffer {money(me.operating_buffer)}</div>
                <div className="mt-1">
                  {below ? <Pill tone="red">Funding gap {money(f!.shortfall)}</Pill> : headroom ? <Pill tone="green">Headroom {money(f!.surplus)}</Pill> : <Pill tone="slate">On buffer</Pill>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* send funds — this entity is the source */}
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink"><Send size={16} className="text-brand-600" /> Send funds from {codeOf(entityId)}</div>
          <div className="space-y-3">
            <Field label="To">
              <Select value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Select destination…</option>
                {others.map((e) => <option key={e.id} value={e.id}>{COUNTRY[e.country]?.name ?? e.country} ({e.country})</option>)}
              </Select>
            </Field>
            <Field label="Amount (RLUSD)">
              <TextInput inputMode="decimal" placeholder="50000.00" value={sendAmt} onChange={(e) => setSendAmt(e.target.value)} />
            </Field>
            <Button onClick={send} disabled={sending || !to || !sendAmt}>{sending ? 'Sending…' : <>Send <ArrowRight size={14} /></>}</Button>
            {sendMsg && <p className="text-[13px] text-muted">{sendMsg}</p>}
          </div>
        </Card>

        {/* request funds — this entity needs cash */}
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink"><HandCoins size={16} className="text-brand-600" /> Request funds for {codeOf(entityId)}</div>
          <div className="space-y-3">
            <Field label="Suggested source (optional)" hint="Leave empty to let the treasurer / AI pick the best source.">
              <Select value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="">Any (default HQ)</option>
                {others.map((e) => <option key={e.id} value={e.id}>{COUNTRY[e.country]?.name ?? e.country} ({e.country})</option>)}
              </Select>
            </Field>
            <Field label="Amount (RLUSD)">
              <TextInput inputMode="decimal" placeholder="120000.00" value={reqAmt} onChange={(e) => setReqAmt(e.target.value)} />
            </Field>
            <Button variant="ghost" onClick={request} disabled={!reqAmt}>Create request</Button>
            {reqMsg && <p className="text-[13px] text-muted">{reqMsg}</p>}
          </div>
        </Card>
      </div>

      {/* on-chain activity */}
      <Section title="On-chain activity" subtitle="Settlements involving this entity — click to view on the ledger explorer">
        <Card className="divide-y divide-hairline">
          {myActivity.length === 0 && <div className="p-5 text-[13px] text-muted">No activity yet for {c.name}.</div>}
          {myActivity.map((e) => {
            const link = explorerLink(e.network, e.tx_hash) ?? (e.detail?.explorerUrl as string | undefined) ?? null;
            const amt = e.detail?.amount as string | undefined;
            return (
              <div key={e.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-ink">
                    {e.action_type}
                    {amt && <span className="text-muted">· {money(amt)}</span>}
                  </div>
                  <div className="text-[12px] text-muted">
                    {(e.detail?.from as string) ? `${codeOf(e.detail.from as string)} → ${codeOf((e.detail?.to as string) ?? entityId)} · ` : ''}{shortDate(e.created_at)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <ModeBadge source={e.source} network={e.network} />
                  {link ? (
                    <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-600 hover:underline">
                      Explorer <ExternalLink size={12} />
                    </a>
                  ) : (
                    <span className="text-[12px] text-muted">simulated</span>
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      </Section>
    </>
  );
}
