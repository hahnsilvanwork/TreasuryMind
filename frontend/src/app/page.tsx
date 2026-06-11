'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api, timeAgo } from '@/lib/api';
import type { BalancesResponse, AnalysisResponse, ApprovalResult, Transfer } from '@/lib/types';
import { Header } from '@/components/Header';
import type { Tab } from '@/lib/types';
import { NetworkGraph } from '@/components/NetworkGraph';

/* ── Types ────────────────────────────────────────────── */
type WizardPhase = 1 | 2 | 3 | 4 | 5;

/** Loose option shape — AI responses, the rule-based fallback and the demo
 *  FALLBACK_OPTIONS use slightly different field names for the same concepts. */
interface WizardOption {
  type?: string;
  action_type?: string;
  from?: string; from_id?: string; from_name?: string;
  to?: string; to_id?: string; to_name?: string;
  amount?: number;
  reasoning?: string;
  confidence?: number;
  term_days?: number;
  rate_pct?: number;
  fx_saving?: number;
  fx_saving_usd?: number;
  fxSaving?: number;
  settlement_time?: string;
  risk_score?: number;
}

/* ── Static data (demo fallbacks) ─────────────────────── */
const FALLBACK_ENTITIES = [
  { id:'zurich',    name:'Corp. Zurich',    loc:'Zurich, CH',    balance: 2100000, min:500000,  status:'NORMAL'  },
  { id:'brazil',    name:'Corp. Brazil',    loc:'São Paulo, BR', balance:-380000,  min:200000,  status:'DEFICIT' },
  { id:'singapore', name:'Corp. Singapore', loc:'Singapore, SG', balance:1470000,  min:400000,  status:'NORMAL'  },
];
const VAULT_DEMO = { balance:1000000, pct:10, apy:4.2 };
const NET_DEMO   = { liquidity:3970000, fxSaved:6900, txFee:0.0001 };

const AI_STEPS = [
  { label:'Loading entity balances…',           ms:500 },
  { label:'Checking minimum thresholds…',       ms:500 },
  { label:'Identifying deficit entities…',      ms:600 },
  { label:'Running AI recommendation engine…',  ms:900 },
  { label:'Evaluating transfer routes…',        ms:600 },
  { label:'Applying policy constraints…',       ms:700 },
];
const EXEC_STEPS = [
  { label:'Validating policy compliance', detail:'9 deterministic checks', ms:900  },
  { label:'Signing transaction',          detail:'XRPL Devnet wallet',     ms:700  },
  { label:'Broadcasting to XRPL network', detail:'Submitting payment',     ms:800  },
  { label:'Awaiting ledger confirmation', detail:'3–5 second finality',    ms:2200 },
];
const FALLBACK_OPTIONS = [
  { id:'A', from_id:'zurich', to_id:'brazil', type:'direct_transfer', aiPick:true,
    from:'zurich', to:'brazil', from_name:'Corp. Zurich', to_name:'Corp. Brazil',
    route:'ZURICH → BRAZIL · XRPL',
    amount:380000, settlement:'3–5 seconds', fxSaving:950, risk:'Low', confidence:94 },
  { id:'B', from_id:'corp_vault', to_id:'brazil', type:'vault_credit', aiPick:false,
    from:'corp_vault', to:'brazil', from_name:'Corp. Vault', to_name:'Corp. Brazil',
    route:'XLS-66 Lending · 7-day term',
    amount:380000, settlement:'3–5 seconds', fxSaving:950, rate:'2.5% / 7d', risk:'Low',
    term_days:7, rate_pct:2.5, confidence:88 },
];
// Maps AI display-name outputs to canonical backend IDs
const ENTITY_NAME_TO_ID: Record<string, string> = {
  'corp. zurich':'zurich', 'corp.zurich':'zurich', 'zurich':'zurich',
  'corp. brazil':'brazil', 'corp.brazil':'brazil', 'brazil':'brazil',
  'corp. singapore':'singapore', 'corp.singapore':'singapore', 'singapore':'singapore',
  'corp_vault':'corp_vault', 'corporate vault':'corp_vault', 'corp. vault':'corp_vault',
  'corp.vault':'corp_vault', 'vault':'corp_vault',
};

/* ── Shared micro-components ─────────────────────────── */
function Badge({ text, color, bg, border }: { text:string; color:string; bg:string; border?:string }) {
  return (
    <span style={{
      display:'inline-block', padding:'2px 8px', borderRadius:2,
      fontSize:11, fontWeight:700, letterSpacing:'0.06em',
      color, background:bg, border:`1px solid ${border ?? bg}`,
    }}>{text}</span>
  );
}
function SectionHeader({ label }: { label:string }) {
  return (
    <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', color:'var(--text-3)',
      textTransform:'uppercase', marginBottom:12 }}>
      {label}
    </div>
  );
}
function StatCard({ label, value, sub, valColor }: { label:string; value:string; sub?:string; valColor?:string }) {
  return (
    <div style={{ background:'var(--card)', border:'1px solid var(--border)',
      borderRadius:'var(--r,3px)', padding:'18px 20px' }}>
      <div style={{ fontSize:11, fontWeight:600, letterSpacing:'0.07em', color:'var(--text-3)',
        textTransform:'uppercase', marginBottom:8 }}>{label}</div>
      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:22, fontWeight:600,
        color:valColor ?? 'var(--text-1)', marginBottom:3 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:'var(--text-3)' }}>{sub}</div>}
    </div>
  );
}
const R = '3px';
const FONT = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

const ENTITY_NAMES: Record<string, string> = {
  zurich: 'Corp. Zurich', brazil: 'Corp. Brazil', singapore: 'Corp. Singapore',
  corp_vault: 'Corp. Vault', corporate_vault: 'Corp. Vault', treasury_issuer: 'RLUSD Issuer',
};
const entityName = (id: string) => ENTITY_NAMES[id] ?? id;

/** "in 7d" / "in 3h" / "overdue" for a future ISO date. */
function dueIn(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'overdue';
  const hours = Math.ceil(diff / 3_600_000);
  return hours < 48 ? `in ${hours}h` : `in ${Math.ceil(hours / 24)}d`;
}

/** Tiny data-fetching hook for the live tabs: load on mount, expose reload. */
function useApi<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await fn()); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); }
    finally { setLoading(false); }
  }, [fn]);
  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

function ExplorerLink({ url, hash, simulated }: { url?: string | null; hash?: string | null; simulated?: boolean }) {
  if (simulated || !url) {
    return <span style={{ fontSize:11, color:'var(--text-3)' }}>{simulated ? 'simulated' : '—'}</span>;
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      style={{ fontSize:12, color:'var(--blue)', textDecoration:'none', fontWeight:500 }}
      title={hash ?? undefined}>
      Explorer ↗
    </a>
  );
}

function TabSkeleton() {
  return (
    <div style={{ padding:'36px 40px' }}>
      <div className="skeleton" style={{ height:28, width:280, marginBottom:12 }} />
      <div className="skeleton" style={{ height:14, width:380, marginBottom:28 }} />
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:24 }}>
        {[0,1,2,3].map(i => <div key={i} className="skeleton" style={{ height:88 }} />)}
      </div>
      <div className="skeleton" style={{ height:260 }} />
    </div>
  );
}

/** Slim on-chain status strip under the header — the system reporting its own
 *  ledger capabilities live. Polls /api/health every 60s. */
function StatusBar() {
  const [health, setHealth] = useState<import('@/lib/types').HealthResponse | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try { const h = await api.getHealth(); if (alive) setHealth(h); }
      catch { /* strip simply stays in checking state */ }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const onchain = health?.rlusd_token_live === true;
  const items: { label: string; ok: boolean | null }[] = health ? [
    { label: health.xrpl_network ?? 'XRPL Devnet', ok: health.checks?.xrpl?.status === 'ok' },
    { label: onchain ? 'RLUSD LIVE' : 'RLUSD SIMULATED', ok: onchain },
    { label: 'XLS-65 VAULT', ok: health.xls65_vault_onchain ?? false },
    { label: 'XLS-85 ESCROW', ok: health.xls85_token_escrow ?? false },
    { label: `WALLETS ${health.checks?.wallets_funded ?? '—'}`, ok: health.checks?.wallets_funded?.startsWith('5') ?? false },
  ] : [{ label: 'CHECKING LEDGER STATUS…', ok: null }];

  return (
    <div style={{ display:'flex', alignItems:'center', height:26, padding:'0 20px',
      background:'var(--card)', borderBottom:'1px solid var(--border)', flexShrink:0,
      fontFamily:MONO, fontSize:10, letterSpacing:'0.05em', color:'var(--text-3)',
      overflow:'hidden', whiteSpace:'nowrap' }}>
      {items.map((it, i) => (
        <span key={it.label} style={{ display:'flex', alignItems:'center', gap:6,
          paddingRight:16, marginRight:16,
          borderRight:i < items.length - 1 ? '1px solid var(--border)' : 'none' }}>
          <span style={{ width:6, height:6, borderRadius:'50%', flexShrink:0,
            background:it.ok === null ? 'var(--text-3)' : it.ok ? 'var(--green)' : 'var(--gold)',
            animation:it.ok === null ? 'dotPulse 1.4s ease-in-out infinite' : 'none' }}/>
          <span style={{ color:it.ok ? 'var(--text-2)' : 'var(--text-3)', fontWeight:600 }}>{it.label}</span>
        </span>
      ))}
      <span style={{ marginLeft:'auto', color:'var(--text-3)' }}>
        {health?.execution_layer === 'RLUSD_TOKEN_PAYMENT' ? 'SETTLEMENT: ON-CHAIN TOKEN' : health ? 'SETTLEMENT: FALLBACK MODE' : ''}
      </span>
    </div>
  );
}

function TabError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ padding:'48px 40px', maxWidth:480 }}>
      <div style={{ background:'var(--red-dim)', border:'1px solid rgba(185,28,28,.2)', borderRadius:R, padding:'18px 20px' }}>
        <div style={{ fontWeight:700, fontSize:14, color:'var(--red)', marginBottom:6 }}>Couldn&apos;t load data</div>
        <div style={{ fontSize:12, color:'var(--text-2)', marginBottom:14 }}>{message}</div>
        <button onClick={onRetry} style={{ padding:'7px 16px', background:'var(--text-1)', color:'white',
          border:'none', borderRadius:R, fontFamily:FONT, fontSize:12, fontWeight:600, cursor:'pointer' }}>
          Retry
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════
   STATIC TABS (reference design)
════════════════════════════════════════════════════ */

function VaultTab() {
  const { data, loading, error, reload } = useApi(api.getVault);
  const [depSub, setDepSub] = useState('zurich');
  const [depAmount, setDepAmount] = useState('250000');
  const [depBusy, setDepBusy] = useState(false);
  const [depMsg, setDepMsg] = useState<string | null>(null);
  const [repayBusy, setRepayBusy] = useState<string | null>(null);

  if (loading && !data) return <TabSkeleton />;
  if (error && !data) return <TabError message={error} onRetry={reload} />;
  if (!data) return null;

  const capacityPct = Math.round(((data.deposited_total ?? 0) / (data.total_capacity || 1)) * 100);
  const activeLines = data.active_credit_lines.filter(cl => cl.status === 'active' || cl.status === 'active_simulated');
  const fmtM = (n: number) => n >= 1e6 ? `$${(n/1e6).toFixed(2)}M` : n > 0 ? `$${(n/1e3).toFixed(0)}K` : '—';

  const handleDeposit = async () => {
    const amount = Number(depAmount);
    if (!amount || amount <= 0) { setDepMsg('Enter a valid amount'); return; }
    setDepBusy(true); setDepMsg(null);
    try {
      await api.vaultDeposit({ subsidiary_id: depSub, amount });
      setDepMsg(`✓ ${entityName(depSub)} deposited ${amount.toLocaleString()} RLUSD`);
      reload();
    } catch (e) {
      setDepMsg(e instanceof Error ? e.message.slice(0, 120) : 'Deposit failed');
    } finally { setDepBusy(false); }
  };

  const handleRepay = async (id: string) => {
    setRepayBusy(id);
    try { await api.repayCreditLine(id); reload(); }
    catch (e) { setDepMsg(e instanceof Error ? e.message.slice(0, 120) : 'Repayment failed'); }
    finally { setRepayBusy(null); }
  };

  return (
    <div style={{ padding:'36px 40px', maxWidth:1100, animation:'fadeUp .25s ease-out' }}>
      <div style={{ marginBottom:28, display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
        <div>
          <h2 style={{ fontSize:22, fontWeight:700, margin:'0 0 4px' }}>Vault &amp; Credit Lines</h2>
          <div style={{ fontSize:13, color:'var(--text-3)' }}>{data.xrpl_primitive ?? 'XLS-65 Single Asset Vault'}</div>
        </div>
        {data.vault_onchain && data.onchain?.vault_id && (
          <div style={{ textAlign:'right' }}>
            <Badge text="XLS-65 ON-CHAIN" color="var(--green)" bg="var(--green-dim)" />
            <div style={{ fontFamily:MONO, fontSize:11, color:'var(--text-3)', marginTop:6 }}
              title={data.onchain.vault_id}>
              Vault {data.onchain.vault_id.slice(0, 10)}…{data.onchain.vault_id.slice(-6)}
            </div>
          </div>
        )}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:28 }}>
        <StatCard label="Total Available" value={fmtM(data.available)} sub="RLUSD" valColor="var(--green)" />
        <StatCard label="Committed" value={fmtM(data.committed)} sub={`${activeLines.length} active line${activeLines.length === 1 ? '' : 's'}`} />
        <StatCard label="APY" value={`${(data.apy * 100).toFixed(1)}%`} sub="XLS-65 yield" valColor="var(--gold)" />
        <StatCard label="Capacity" value={`${capacityPct}%`} sub={`${fmtM(data.deposited_total ?? 0)} / ${fmtM(data.total_capacity)} used`} />
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 360px', gap:20 }}>
        {/* Main vault card */}
        <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:R, overflow:'hidden' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'20px 24px', borderBottom:'1px solid var(--border)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:14 }}>
              <div style={{ width:36, height:36, borderRadius:R, background:'var(--blue-dim)',
                border:'1px solid rgba(30,64,175,.2)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="1" y="14" width="14" height="1.5" rx="0.5" fill="#1E40AF"/>
                  <rect x="3.5" y="7" width="1.5" height="7" fill="#1E40AF" opacity="0.7"/>
                  <rect x="7.25" y="7" width="1.5" height="7" fill="#1E40AF" opacity="0.7"/>
                  <rect x="11" y="7" width="1.5" height="7" fill="#1E40AF" opacity="0.7"/>
                  <path d="M1 6.5L8 2l7 4.5H1z" fill="#1E40AF"/>
                </svg>
              </div>
              <div>
                <div style={{ fontWeight:700, fontSize:15 }}>{data.name}</div>
                <div style={{ fontSize:11, color:'var(--text-3)' }}>
                  {data.vault_onchain ? 'XLS-65 Single Asset Vault · live ledger object' : 'XLS-65 Single Asset Vault'}
                </div>
              </div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontFamily:MONO, fontSize:18, fontWeight:600, color:'var(--gold)' }}>{(data.apy * 100).toFixed(1)}%</div>
              <div style={{ fontSize:11, color:'var(--text-3)' }}>APY</div>
            </div>
          </div>
          <div style={{ padding:'20px 24px', borderBottom:'1px solid var(--border)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:10 }}>
              <span style={{ fontSize:13, color:'var(--text-2)' }}>Capacity utilization</span>
              <span style={{ fontSize:12, color:'var(--text-3)', fontFamily:MONO }}>
                {capacityPct}% filled · {Math.round((data.committed / (data.total_capacity || 1)) * 100)}% committed
              </span>
            </div>
            <div style={{ height:8, background:'var(--base)', borderRadius:2, position:'relative', border:'1px solid var(--border)' }}>
              <div style={{ position:'absolute', left:0, top:0, bottom:0, width:`${Math.min(capacityPct, 100)}%`,
                background:'var(--green)', borderRadius:2, animation:'barGrow 0.8s ease-out' }}/>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr' }}>
            <div style={{ padding:'20px 24px', background:'rgba(21,128,61,.04)', borderRight:'1px solid var(--border)' }}>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.08em', color:'var(--green)', marginBottom:8 }}>AVAILABLE</div>
              <div style={{ fontFamily:MONO, fontSize:22, fontWeight:600 }}>{data.available > 0 ? (data.available/1e6).toFixed(2)+'M' : '—'}</div>
              <div style={{ fontSize:11, color:'var(--text-3)' }}>RLUSD</div>
            </div>
            <div style={{ padding:'20px 24px' }}>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.08em', color:'var(--text-3)', marginBottom:8 }}>COMMITTED</div>
              <div style={{ fontFamily:MONO, fontSize:22, fontWeight:600, color:data.committed > 0 ? 'var(--text-1)' : 'var(--text-3)' }}>
                {data.committed > 0 ? (data.committed >= 1e6 ? (data.committed/1e6).toFixed(2)+'M' : (data.committed/1e3).toFixed(0)+'K') : '—'}
              </div>
              <div style={{ fontSize:11, color:'var(--text-3)' }}>RLUSD</div>
            </div>
          </div>
          {/* Deposit form */}
          <div style={{ padding:'16px 24px', borderTop:'1px solid var(--border)' }}>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <select value={depSub} onChange={e => setDepSub(e.target.value)} disabled={depBusy}
                style={{ padding:'8px 10px', border:'1px solid var(--border)', borderRadius:R,
                  background:'var(--card)', fontFamily:FONT, fontSize:12, cursor:'pointer' }}>
                <option value="zurich">Corp. Zurich</option>
                <option value="singapore">Corp. Singapore</option>
                <option value="brazil">Corp. Brazil</option>
              </select>
              <input type="number" value={depAmount} onChange={e => setDepAmount(e.target.value)}
                min={10000} step={10000} disabled={depBusy} aria-label="Deposit amount in RLUSD"
                style={{ flex:1, padding:'8px 10px', border:'1px solid var(--border)', borderRadius:R,
                  fontFamily:MONO, fontSize:12, minWidth:0 }} />
              <button onClick={handleDeposit} disabled={depBusy}
                style={{ padding:'8px 16px', background:'var(--text-1)', color:'white', border:'none',
                  borderRadius:R, fontFamily:FONT, fontSize:12, fontWeight:600,
                  cursor:depBusy ? 'wait' : 'pointer', opacity:depBusy ? 0.6 : 1, whiteSpace:'nowrap' }}>
                {depBusy ? 'Depositing…' : '⊕ Deposit'}
              </button>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', marginTop:8 }}>
              <span style={{ fontSize:11, color:depMsg?.startsWith('✓') ? 'var(--green)' : depMsg ? 'var(--red)' : 'var(--text-3)' }}>
                {depMsg ?? 'Min. 10,000 RLUSD'}
              </span>
              {data.vault_onchain && <span style={{ fontSize:11, color:'var(--text-3)' }}>settles via XLS-65 VaultDeposit</span>}
            </div>
          </div>
        </div>
        {/* Credit lines */}
        <div>
          <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:R, overflow:'hidden' }}>
            <div style={{ padding:'14px 20px', background:'var(--blue-dim)', borderBottom:'1px solid rgba(30,64,175,.2)',
              display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:11, fontWeight:700, letterSpacing:'0.08em', color:'var(--blue)' }}>CREDIT LINES</span>
              <Badge text={`${activeLines.length} ACTIVE`} color={activeLines.length ? 'var(--blue)' : 'var(--text-3)'} bg="var(--base)" />
            </div>
            {data.active_credit_lines.length === 0 && (
              <div style={{ padding:'24px 20px', fontSize:12, color:'var(--text-3)', textAlign:'center' }}>
                No credit lines yet.<br/>Run Analyze → Vault Credit on the Overview tab.
              </div>
            )}
            {data.active_credit_lines.slice().reverse().slice(0, 6).map(cl => {
              const isActive = cl.status === 'active' || cl.status === 'active_simulated';
              const statusClr = isActive ? 'var(--blue)' : cl.status === 'repaid' ? 'var(--green)' : 'var(--red)';
              return (
                <div key={cl.id} style={{ padding:'16px 20px', borderBottom:'1px solid var(--border)' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                    <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                      <Badge text={cl.simulated ? 'SIMULATED' : 'ON-CHAIN'}
                        color={cl.simulated ? 'var(--gold)' : 'var(--green)'}
                        bg={cl.simulated ? 'var(--gold-dim)' : 'var(--green-dim)'} />
                      <span style={{ fontSize:13, fontWeight:500 }}>→ {entityName(cl.borrower)}</span>
                    </div>
                    <Badge text={cl.status.toUpperCase()} color={statusClr}
                      bg={isActive ? 'var(--blue-dim)' : cl.status === 'repaid' ? 'var(--green-dim)' : 'var(--red-dim)'} />
                  </div>
                  <div style={{ fontFamily:MONO, fontSize:13, fontWeight:600, marginBottom:4 }}>
                    {cl.amount.toLocaleString()} RLUSD
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:12, color:'var(--text-3)' }}>
                      {cl.term_days}d @ {cl.rate_pct}% p.a.{cl.due_date ? ` · due ${dueIn(cl.due_date)}` : ''}
                    </span>
                    {isActive && (
                      <button onClick={() => handleRepay(cl.id)} disabled={repayBusy === cl.id}
                        style={{ padding:'4px 12px', border:'1px solid var(--border)', borderRadius:R,
                          background:'var(--card)', fontFamily:FONT, fontSize:11, fontWeight:600,
                          cursor:repayBusy === cl.id ? 'wait' : 'pointer', color:'var(--text-1)' }}>
                        {repayBusy === cl.id ? 'Settling via escrow…' : 'Repay'}
                      </button>
                    )}
                  </div>
                  {cl.status === 'repaid' && cl.repayment_mode === 'XLS85_TOKEN_ESCROW' && (
                    <div style={{ marginTop:8, padding:'8px 10px', background:'var(--base)', borderRadius:2,
                      fontSize:11, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                      <span style={{ color:'var(--text-3)', fontWeight:600 }}>XLS-85 ESCROW SETTLED</span>
                      {cl.repayment_escrow_explorer_url && (
                        <a href={cl.repayment_escrow_explorer_url} target="_blank" rel="noopener noreferrer"
                          style={{ color:'var(--blue)', textDecoration:'none', fontWeight:500 }}>Lock ↗</a>
                      )}
                      {cl.repayment_release_explorer_url && (
                        <a href={cl.repayment_release_explorer_url} target="_blank" rel="noopener noreferrer"
                          style={{ color:'var(--blue)', textDecoration:'none', fontWeight:500 }}>Release ↗</a>
                      )}
                      {cl.repayment_vault_explorer_url && (
                        <a href={cl.repayment_vault_explorer_url} target="_blank" rel="noopener noreferrer"
                          style={{ color:'var(--blue)', textDecoration:'none', fontWeight:500 }}>Vault ↗</a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{ padding:'14px 20px', background:'var(--base)' }}>
              <div style={{ fontSize:11, color:'var(--text-3)' }}>
                Expected interest income: <strong style={{ color:'var(--text-1)', fontFamily:MONO }}>
                  ${data.expected_interest_income.toLocaleString()}</strong>
              </div>
            </div>
          </div>
          <div style={{ marginTop:12, background:'var(--card)', border:'1px solid var(--border)', borderRadius:R, padding:'16px 20px' }}>
            <SectionHeader label="On-Chain Status" />
            {[
              ['Vault primitive', data.vault_onchain ? 'XLS-65 (live)' : 'XLS-65 (abstraction)'],
              ['Lending funding', data.vault_onchain ? 'VaultWithdraw' : 'Token payment'],
              ['Assets in vault', data.onchain?.assets_total ? `${Number(data.onchain.assets_total).toLocaleString()} RLUSD` : '—'],
              ['Assets available', data.onchain?.assets_available ? `${Number(data.onchain.assets_available).toLocaleString()} RLUSD` : '—'],
            ].map(([k, v]) => (
              <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'7px 0',
                borderBottom:'1px solid rgba(17,16,16,.06)', fontSize:12 }}>
                <span style={{ color:'var(--text-3)' }}>{k}</span>
                <span style={{ fontWeight:600, fontFamily:MONO }}>{v}</span>
              </div>
            ))}
            {data.onchain?.explorer_url && (
              <div style={{ marginTop:10 }}>
                <a href={data.onchain.explorer_url} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize:12, color:'var(--blue)', textDecoration:'none', fontWeight:500 }}>
                  Vault owner on Explorer ↗
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function XRPLTab() {
  const { data, loading, error, reload } = useApi(api.getWallets);

  if (loading && !data) return <TabSkeleton />;
  if (error && !data) return <TabError message={error} onRetry={reload} />;
  if (!data) return null;

  const tokenLive = data.rlusd_token_live === true;
  const rows = [
    ...Object.entries(data.subsidiaries).map(([id, w]) => ({
      id, name: w.name, addr: w.address, explorer: w.explorer_url,
      balance: w.balance ?? 0, onchain: w.onchain_rlusd, kind: 'entity' as const,
    })),
    { id: 'vault', name: data.corporate_vault.name, addr: data.corporate_vault.address,
      explorer: data.corporate_vault.explorer_url, balance: data.corporate_vault.available ?? 0,
      onchain: data.corporate_vault.onchain_rlusd, kind: 'vault' as const },
    ...(data.issuer ? [{ id: 'issuer', name: data.issuer.name, addr: data.issuer.address,
      explorer: data.issuer.explorer_url, balance: null as number | null,
      onchain: null, kind: 'issuer' as const }] : []),
  ];
  const netInfo = [
    { label:'Settlement Layer',  value:data.network, sub:tokenLive ? 'Validated token payments, 3-5s finality' : 'Fallback mode — token economy offline', clr:'var(--blue)' },
    { label:'Stablecoin',        value:'RLUSD',      sub:tokenLive ? 'Issued IOU · live trustlines' : 'Accounting layer (issuance unavailable)', clr:tokenLive ? 'var(--green)' : 'var(--gold)' },
    { label:'Vault Primitive',   value:'XLS-65',     sub:'Single Asset Vault protocol',      clr:'var(--blue)' },
    { label:'Lending Funding',   value:'VaultWithdraw', sub:'Credit lines drawn from vault', clr:'var(--blue)' },
    { label:'TX Fee',            value:'~$0.0001',   sub:'vs. 0.25% traditional wire',       clr:'var(--green)' },
    { label:'Wallets',           value:`${rows.length} accounts`, sub:'Funded via Devnet faucet', clr:'var(--text-1)' },
  ];
  return (
    <div style={{ padding:'36px 40px', animation:'fadeUp .25s ease-out' }}>
      <div style={{ marginBottom:28 }}>
        <h2 style={{ fontSize:22, fontWeight:700, margin:'0 0 4px' }}>XRPL Network</h2>
        <div style={{ fontSize:13, color:'var(--text-3)' }}>{data.settlement_asset} · live wallet addresses</div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:28 }}>
        {netInfo.map(info => (
          <div key={info.label} style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:R, padding:'16px 20px' }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.08em', color:'var(--text-3)', marginBottom:8 }}>{info.label.toUpperCase()}</div>
            <div style={{ fontSize:15, fontWeight:700, color:info.clr, marginBottom:3, fontFamily:MONO }}>{info.value}</div>
            <div style={{ fontSize:12, color:'var(--text-3)' }}>{info.sub}</div>
          </div>
        ))}
      </div>
      <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:R, overflow:'hidden', marginBottom:20 }}>
        <div style={{ padding:'14px 24px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:11, fontWeight:700, letterSpacing:'0.08em', color:'var(--text-3)' }}>WALLET ADDRESSES — XRPL DEVNET</span>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <div style={{ width:7, height:7, borderRadius:'50%', background:tokenLive ? 'var(--green)' : 'var(--gold)',
              animation:'dotPulse 2s ease-in-out infinite' }}/>
            <span style={{ fontSize:11, color:tokenLive ? 'var(--green)' : 'var(--gold)', fontWeight:600 }}>
              {tokenLive ? 'RLUSD Live' : 'Fallback'}
            </span>
          </div>
        </div>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'var(--base)' }}>
              {['Entity','Wallet Address','App Balance','On-Chain RLUSD','Role','Explorer'].map(h => (
                <th key={h} style={{ padding:'10px 24px', textAlign:'left', fontSize:11, fontWeight:600,
                  letterSpacing:'0.06em', color:'var(--text-3)', borderBottom:'1px solid var(--border)' }}>{h.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((w, i) => (
              <tr key={w.id} style={{ borderBottom:i < rows.length-1 ? '1px solid rgba(17,16,16,.06)' : 'none' }}>
                <td style={{ padding:'14px 24px', fontWeight:600, fontSize:13 }}>{w.name}</td>
                <td style={{ padding:'14px 24px', fontFamily:MONO, fontSize:12, color:'var(--text-2)', maxWidth:280 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ width:7, height:7, borderRadius:'50%', flexShrink:0,
                      background:w.kind==='vault' ? 'var(--gold)' : w.kind==='issuer' ? 'var(--blue)' : 'var(--green)' }}/>
                    <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{w.addr}</span>
                  </div>
                </td>
                <td style={{ padding:'14px 24px', fontFamily:MONO, fontSize:13, fontWeight:600 }}>
                  {w.balance != null ? `${w.balance.toLocaleString()} RLUSD` : '—'}
                </td>
                <td style={{ padding:'14px 24px', fontFamily:MONO, fontSize:13, fontWeight:600,
                  color:w.onchain != null ? 'var(--green)' : 'var(--text-3)' }}>
                  {w.onchain != null ? `${w.onchain.toLocaleString()} RLUSD` : '—'}
                </td>
                <td style={{ padding:'14px 24px' }}>
                  <Badge text={w.kind.toUpperCase()}
                    color={w.kind==='vault' ? 'var(--gold)' : w.kind==='issuer' ? 'var(--blue)' : 'var(--green)'}
                    bg={w.kind==='vault' ? 'var(--gold-dim)' : w.kind==='issuer' ? 'var(--blue-dim)' : 'var(--green-dim)'} />
                </td>
                <td style={{ padding:'14px 24px' }}>
                  {w.addr && !w.addr.startsWith('Initializing') ? (
                    <a href={w.explorer} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize:12, color:'var(--blue)', textDecoration:'none', fontWeight:500 }}>Explorer ↗</a>
                  ) : <span style={{ fontSize:11, color:'var(--text-3)' }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:R, padding:'20px 24px' }}>
        <SectionHeader label="Cost Comparison — XRPL vs. Traditional Wire" />
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:24 }}>
          {[
            { label:'XRPL Devnet',       fee:'$0.0001',  time:'3–5 seconds',       color:'var(--green)' },
            { label:'Traditional Wire',  fee:'~$25–$45', time:'1–3 business days',  color:'var(--text-3)' },
          ].map(row => (
            <div key={row.label} style={{ padding:16, background:'var(--base)', borderRadius:R }}>
              <div style={{ fontSize:12, fontWeight:600, color:row.color, marginBottom:10 }}>{row.label}</div>
              {[['Fee',row.fee],['Settlement',row.time]].map(([k,v]) => (
                <div key={k} style={{ display:'flex', justifyContent:'space-between', marginBottom:6, fontSize:13 }}>
                  <span style={{ color:'var(--text-3)' }}>{k}</span>
                  <span style={{ fontFamily:MONO, fontWeight:600, color:row.color }}>{v}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RiskTab({ onScenarioApplied }: { onScenarioApplied?: () => void }) {
  const [subtab, setSubtab] = useState<'scores'|'policy'|'scenarios'>('scores');
  const scoresApi = useApi(api.getRiskScores);
  const policyApi = useApi(api.getPolicy);
  const scenariosApi = useApi(api.getScenarios);
  const [applying, setApplying] = useState<string | null>(null);
  const [appliedMsg, setAppliedMsg] = useState<string | null>(null);

  const levelColor = (level: string) =>
    level === 'high' || level === 'critical' ? 'var(--red)' : level === 'medium' ? 'var(--gold)' : 'var(--green)';

  const POLICY_LABELS: Record<string, [string, (v: number | string) => string]> = {
    max_single_transfer_rlusd:   ['Max single transfer',      v => `${Number(v).toLocaleString()} RLUSD`],
    cfo_threshold:               ['CFO approval above',       v => `${Number(v).toLocaleString()} RLUSD`],
    treasury_manager_threshold:  ['Manager approval above',   v => `${Number(v).toLocaleString()} RLUSD`],
    auto_approve_threshold:      ['Auto-approve below',       v => `${Number(v).toLocaleString()} RLUSD`],
    min_confidence_pct:          ['Min AI confidence',        v => `${v}%`],
    max_risk_score_for_standard: ['Enhanced review',          v => `Score > ${v}`],
    max_risk_score_absolute:     ['Hard risk block',          v => `Score > ${v}`],
  };

  const handleApply = async (id: string, name: string) => {
    setApplying(id); setAppliedMsg(null);
    try {
      const result = await api.triggerScenario(id);
      const deficits = result.new_deficits?.length
        ? `New deficits: ${result.new_deficits.map(entityName).join(', ')}.`
        : 'No new deficits.';
      setAppliedMsg(`✓ "${name}" applied. ${deficits} Go to Overview → Analyze with AI.`);
      scoresApi.reload();
      onScenarioApplied?.();
    } catch (e) {
      setAppliedMsg(e instanceof Error ? e.message.slice(0, 140) : 'Scenario failed');
    } finally { setApplying(null); }
  };

  const tabs = [{ id:'scores', label:'Risk Scores' },{ id:'policy', label:'Policy Rules' },{ id:'scenarios', label:'Scenarios' }] as const;
  return (
    <div style={{ padding:'36px 40px', animation:'fadeUp .25s ease-out' }}>
      <div style={{ marginBottom:24 }}>
        <h2 style={{ fontSize:22, fontWeight:700, margin:'0 0 4px' }}>Risk &amp; Compliance</h2>
        <div style={{ fontSize:13, color:'var(--text-3)' }}>Deterministic policy engine · Entity risk scoring</div>
      </div>
      <div style={{ display:'flex', gap:2, marginBottom:24, background:'var(--card)', border:'1px solid var(--border)',
        borderRadius:R, padding:3, width:'fit-content' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setSubtab(t.id)} style={{
            padding:'7px 18px', borderRadius:2,
            background:subtab===t.id ? 'var(--text-1)' : 'transparent',
            color:subtab===t.id ? 'white' : 'var(--text-2)',
            border:'none', cursor:'pointer', fontFamily:FONT, fontSize:13,
            fontWeight:subtab===t.id ? 600 : 400, transition:'background .15s, color .15s',
          }}>{t.label}</button>
        ))}
      </div>
      {subtab === 'scores' && (
        <div style={{ maxWidth:860 }}>
          {scoresApi.loading && !scoresApi.data && <div className="skeleton" style={{ height:280 }} />}
          {scoresApi.error && !scoresApi.data && <TabError message={scoresApi.error} onRetry={scoresApi.reload} />}
          {scoresApi.data && (
            <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:R, overflow:'hidden', marginBottom:20 }}>
              {Object.values(scoresApi.data.scores).map((s, i, arr) => {
                const clr = levelColor(s.risk_level);
                return (
                  <div key={s.entity_id} style={{ padding:'22px 28px', borderBottom:i<arr.length-1?'1px solid var(--border)':'none' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                      <div>
                        <div style={{ fontWeight:700, fontSize:15 }}>{s.entity_name ?? entityName(s.entity_id)}</div>
                        <div style={{ marginTop:4 }}>
                          <Badge text={`${s.risk_level.toUpperCase()} RISK`} color={clr}
                            bg={clr==='var(--red)' ? 'var(--red-dim)' : clr==='var(--gold)' ? 'var(--gold-dim)' : 'var(--green-dim)'} />
                        </div>
                      </div>
                      <div style={{ textAlign:'right' }}>
                        <div style={{ fontFamily:MONO, fontSize:28, fontWeight:700, color:clr }}>{s.risk_score}</div>
                        <div style={{ fontSize:11, color:'var(--text-3)' }}>/100</div>
                      </div>
                    </div>
                    <div style={{ height:6, background:'var(--base)', borderRadius:3, overflow:'hidden', border:'1px solid var(--border)', marginBottom:s.reasons?.length ? 10 : 0 }}>
                      <div style={{ height:'100%', borderRadius:3, width:`${s.risk_score}%`,
                        background:s.risk_score>70?'var(--red)':s.risk_score>40?'var(--gold)':'var(--green)',
                        animation:'barGrow 0.8s ease-out' }}/>
                    </div>
                    {s.reasons?.length > 0 && (
                      <div style={{ fontSize:12, color:'var(--text-2)', lineHeight:1.6 }}>
                        {s.reasons.join(' · ')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {subtab === 'policy' && (
        <div style={{ maxWidth:860 }}>
          {policyApi.loading && !policyApi.data && <div className="skeleton" style={{ height:280 }} />}
          {policyApi.error && !policyApi.data && <TabError message={policyApi.error} onRetry={policyApi.reload} />}
          {policyApi.data && (
            <>
              <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:R, overflow:'hidden', marginBottom:20 }}>
                <div style={{ padding:'10px 24px', background:'var(--base)', borderBottom:'1px solid var(--border)' }}>
                  <span style={{ fontSize:11, fontWeight:700, letterSpacing:'0.08em', color:'var(--text-3)' }}>
                    TREASURY POLICY — V{policyApi.data.version}
                  </span>
                </div>
                {Object.entries(policyApi.data.policy).map(([key, value]) => {
                  const entry = POLICY_LABELS[key];
                  const label = entry?.[0] ?? key.replace(/_/g, ' ');
                  const display = entry ? entry[1](value) : String(value);
                  return (
                    <div key={key} style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline',
                      padding:'13px 24px', borderBottom:'1px solid rgba(17,16,16,.06)', fontSize:13 }}>
                      <span>{label}</span>
                      <span style={{ fontFamily:MONO, fontWeight:600 }}>{display}</span>
                    </div>
                  );
                })}
                {Object.entries(policyApi.data.approval_levels).map(([level, desc]) => (
                  <div key={level} style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline',
                    padding:'13px 24px', borderBottom:'1px solid rgba(17,16,16,.06)', fontSize:13, background:'var(--base)' }}>
                    <span style={{ color:'var(--text-2)' }}>{level.replace(/_/g, ' ')}</span>
                    <span style={{ fontFamily:MONO, fontWeight:600, fontSize:12 }}>{desc}</span>
                  </div>
                ))}
              </div>
              <div style={{ background:'var(--blue-dim)', border:'1px solid rgba(30,64,175,.2)', borderRadius:R, padding:'16px 20px' }}>
                <div style={{ fontSize:12, color:'var(--text-2)', lineHeight:1.6 }}>
                  All treasury actions are validated against <strong>9 deterministic policy checks</strong> before execution. The engine is rule-based — no AI involvement — ensuring auditability and regulatory defensibility.
                </div>
              </div>
            </>
          )}
        </div>
      )}
      {subtab === 'scenarios' && (
        <div style={{ maxWidth:860 }}>
          {appliedMsg && (
            <div style={{ marginBottom:16, padding:'12px 16px', borderRadius:R, fontSize:13, fontWeight:500,
              background:appliedMsg.startsWith('✓') ? 'var(--green-dim)' : 'var(--red-dim)',
              border:`1px solid ${appliedMsg.startsWith('✓') ? 'rgba(21,128,61,.25)' : 'rgba(185,28,28,.25)'}`,
              color:appliedMsg.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}>
              {appliedMsg}
            </div>
          )}
          {scenariosApi.loading && !scenariosApi.data && <div className="skeleton" style={{ height:280 }} />}
          {scenariosApi.error && !scenariosApi.data && <TabError message={scenariosApi.error} onRetry={scenariosApi.reload} />}
          {scenariosApi.data?.scenarios.map(s => {
            const clr = levelColor(s.severity);
            return (
              <div key={s.id} style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:R,
                padding:'20px 24px', marginBottom:8, display:'flex', alignItems:'flex-start', gap:16 }}>
                <div style={{ flex:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
                    <span style={{ fontWeight:700, fontSize:14 }}>{s.name}</span>
                    <Badge text={s.severity.toUpperCase()} color={clr}
                      bg={clr==='var(--green)'?'var(--green-dim)':clr==='var(--gold)'?'var(--gold-dim)':'var(--red-dim)'} />
                  </div>
                  <div style={{ fontSize:12, color:'var(--text-3)', lineHeight:1.6 }}>{s.description}</div>
                </div>
                <button onClick={() => handleApply(s.id, s.name)} disabled={applying !== null}
                  style={{ flexShrink:0, padding:'7px 16px',
                    background:applying === s.id ? 'var(--text-1)' : 'var(--card)',
                    color:applying === s.id ? 'white' : 'var(--text-1)',
                    border:'1px solid var(--border)', borderRadius:R,
                    fontFamily:FONT, fontSize:12, fontWeight:500,
                    cursor:applying ? 'wait' : 'pointer', opacity:applying && applying !== s.id ? 0.5 : 1 }}>
                  {applying === s.id ? 'Applying…' : 'Apply'}
                </button>
              </div>
            );
          })}
          <div style={{ marginTop:16, padding:'12px 16px', background:'var(--gold-dim)',
            border:'1px solid rgba(146,64,14,.2)', borderRadius:R, fontSize:12, color:'var(--gold)' }}>
            ⚠ DEMO MODE — Scenarios modify live in-memory state. Switch to Overview and click Analyze to see resolution options.
          </div>
        </div>
      )}
    </div>
  );
}

function AuditTab() {
  const [filter, setFilter] = useState('All');
  const { data, loading, error, reload } = useApi(api.getAudit);

  if (loading && !data) return <TabSkeleton />;
  if (error && !data) return <TabError message={error} onRetry={reload} />;
  if (!data) return null;

  const txs: Transfer[] = data.transfer_history.filter(t => {
    if (filter === 'On-Chain') return t.execution_status === 'ON_CHAIN' && !t.simulated;
    if (filter === 'Transfers') return t.action_type === 'direct_transfer';
    if (filter === 'Credit Lines') return t.action_type === 'vault_credit';
    return true;
  });

  const typeLabel = (t: Transfer) =>
    t.action_type === 'vault_credit' ? 'VAULT CREDIT'
    : (t.action_type as string) === 'supplier_credit' ? 'SUPPLIER CREDIT'
    : 'TRANSFER';

  const chips = [
    { label:`${data.total_transfers} transactions`, clr:'var(--text-1)' },
    { label:`$${Math.round(data.total_fx_saved).toLocaleString()} FX savings`, clr:'var(--green)' },
    { label:`${data.direct_transfers ?? 0} direct`, clr:'var(--text-2)' },
    { label:`${data.vault_credits ?? 0} credit line${(data.vault_credits ?? 0) === 1 ? '' : 's'}`, clr:'var(--blue)' },
  ];

  return (
    <div style={{ padding:'36px 40px', animation:'fadeUp .25s ease-out' }}>
      <div style={{ marginBottom:24, display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div>
          <h2 style={{ fontSize:22, fontWeight:700, margin:'0 0 4px' }}>Audit Trail</h2>
          <div style={{ fontSize:13, color:'var(--text-3)' }}>Full transaction history · Persistent JSON store · XRPL on-chain proof</div>
        </div>
        <button onClick={reload} style={{ padding:'6px 14px', border:'1px solid var(--border)', borderRadius:R,
          background:'var(--card)', fontFamily:FONT, fontSize:12, fontWeight:500, cursor:'pointer', color:'var(--text-2)' }}>
          ↻ Refresh
        </button>
      </div>
      <div style={{ display:'flex', gap:12, marginBottom:20 }}>
        {chips.map(c => (
          <div key={c.label} style={{ padding:'5px 12px', background:'var(--card)', border:'1px solid var(--border)',
            borderRadius:R, fontSize:12, fontWeight:500, color:c.clr }}>{c.label}</div>
        ))}
      </div>
      <div style={{ display:'flex', gap:4, marginBottom:20 }}>
        {['All','On-Chain','Transfers','Credit Lines'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding:'5px 14px', border:'1px solid var(--border)', borderRadius:R,
            background:filter===f?'var(--text-1)':'var(--card)',
            color:filter===f?'white':'var(--text-2)',
            fontFamily:FONT, fontSize:12, fontWeight:filter===f?600:400, cursor:'pointer',
          }}>{f}</button>
        ))}
      </div>
      <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:R, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'var(--base)' }}>
              {['Type','Route','Amount','Status','Policy','FX Saved','Time','Explorer'].map(h => (
                <th key={h} style={{ padding:'10px 20px', textAlign:'left', fontSize:11, fontWeight:600,
                  letterSpacing:'0.06em', color:'var(--text-3)', borderBottom:'1px solid var(--border)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {txs.length === 0 && (
              <tr><td colSpan={8} style={{ padding:'32px 20px', textAlign:'center', fontSize:13, color:'var(--text-3)' }}>
                No transactions{filter !== 'All' ? ` for "${filter}"` : ' yet'}. Run the demo flow on the Overview tab.
              </td></tr>
            )}
            {txs.map((tx, i) => {
              const isCredit = tx.action_type === 'vault_credit';
              const onChain = tx.execution_status === 'ON_CHAIN' && !tx.simulated;
              return (
                <tr key={tx.id ?? i} style={{ borderBottom:i<txs.length-1?'1px solid rgba(17,16,16,.06)':'none' }}>
                  <td style={{ padding:'13px 20px' }}>
                    <span style={{ fontSize:11, fontWeight:700, letterSpacing:'0.06em', padding:'2px 7px', borderRadius:2,
                      background:isCredit?'var(--blue-dim)':'var(--green-dim)',
                      color:isCredit?'var(--blue)':'var(--green)' }}>
                      {typeLabel(tx)}
                    </span>
                  </td>
                  <td style={{ padding:'13px 20px', fontSize:13, color:'var(--text-2)' }}>
                    {entityName(tx.from)} → {entityName(tx.to)}
                  </td>
                  <td style={{ padding:'13px 20px', fontFamily:MONO, fontSize:13, fontWeight:600 }}>
                    {tx.amount.toLocaleString()} <span style={{ fontSize:11, color:'var(--text-3)' }}>RLUSD</span>
                  </td>
                  <td style={{ padding:'13px 20px' }}>
                    <Badge text={onChain ? 'ON-CHAIN' : 'SIMULATED'}
                      color={onChain ? 'var(--green)' : 'var(--gold)'}
                      bg={onChain ? 'var(--green-dim)' : 'var(--gold-dim)'} />
                  </td>
                  <td style={{ padding:'13px 20px' }}>
                    {tx.policy_decision && <Badge
                      text={tx.policy_decision === 'APPROVED_WITH_WARNING' ? 'WARN' : tx.policy_decision}
                      color={tx.policy_decision === 'APPROVED' ? 'var(--green)' : tx.policy_decision === 'BLOCKED' ? 'var(--red)' : 'var(--gold)'}
                      bg={tx.policy_decision === 'APPROVED' ? 'var(--green-dim)' : tx.policy_decision === 'BLOCKED' ? 'var(--red-dim)' : 'var(--gold-dim)'} />}
                  </td>
                  <td style={{ padding:'13px 20px', fontFamily:MONO, fontSize:12, color:'var(--green)', fontWeight:600 }}>
                    {tx.fx_saving ? `+$${Math.round(tx.fx_saving).toLocaleString()}` : '—'}
                  </td>
                  <td style={{ padding:'13px 20px', fontSize:12, color:'var(--text-3)' }}>{timeAgo(tx.timestamp)}</td>
                  <td style={{ padding:'13px 20px' }}>
                    <ExplorerLink url={tx.explorer_url} hash={tx.tx_hash} simulated={tx.simulated} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SuppliersTab() {
  const suppliers = [
    { code:'BR', name:'Brazil Cocoa Supplier',  type:'Raw Material Provider', loc:'Brazil',
      status:'Verified', statusClr:'var(--green)', risk:72, requested:150000, limit:250000, exposure:0,     term:'Max 30 days', purpose:'Working capital for next cocoa shipment', blocked:false },
    { code:'CH', name:'Swiss Packaging Partner', type:'Packaging Supplier',   loc:'Switzerland',
      status:'Verified', statusClr:'var(--green)', risk:28, requested:80000,  limit:200000, exposure:40000, term:'Max 14 days', purpose:'Short-term production financing',         blocked:false },
    { code:'MX', name:'LATAM Logistics Provider',type:'Logistics Partner',    loc:'Mexico',
      status:'Pending Review', statusClr:'var(--gold)', risk:86, requested:300000, limit:100000, exposure:60000, term:'Max 30 days', purpose:'Transport capacity pre-financing', blocked:true },
  ];
  return (
    <div style={{ padding:'36px 40px', animation:'fadeUp .25s ease-out' }}>
      <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:6 }}>
        <Badge text="FUTURE EXPANSION" color="var(--blue)" bg="var(--blue-dim)" />
        <Badge text="EXPERIMENTAL"     color="var(--gold)" bg="var(--gold-dim)" />
      </div>
      <h2 style={{ fontSize:22, fontWeight:700, margin:'8px 0 4px' }}>Supplier Liquidity Network</h2>
      <div style={{ fontSize:13, color:'var(--text-2)', marginBottom:6, maxWidth:600, lineHeight:1.5 }}>
        Extend corporate excess liquidity to verified suppliers through controlled, policy-based working capital lines.
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10, margin:'24px 0' }}>
        {[{ label:'Verified Partners', val:'2' },{ label:'Pending Review', val:'1' },
          { label:'Total Requested', val:'530K RLUSD', vc:'var(--blue)' },
          { label:'Active Exposure', val:'100K RLUSD' },
          { label:'Active Credit Lines', val:'0' }].map(s => (
          <div key={s.label} style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:R, padding:'14px 16px' }}>
            <div style={{ fontSize:11, fontWeight:600, letterSpacing:'0.07em', color:'var(--text-3)', marginBottom:6 }}>{s.label.toUpperCase()}</div>
            <div style={{ fontFamily:MONO, fontSize:16, fontWeight:700, color:(s as { vc?: string }).vc ?? 'var(--text-1)' }}>{s.val}</div>
          </div>
        ))}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:28 }}>
        {suppliers.map(s => (
          <div key={s.code} style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:R, overflow:'hidden' }}>
            <div style={{ padding:'16px 18px', borderBottom:'1px solid var(--border)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ width:34, height:34, borderRadius:R, background:'var(--base)', border:'1px solid var(--border)',
                    display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, color:'var(--text-2)' }}>{s.code}</div>
                  <div>
                    <div style={{ fontWeight:700, fontSize:13 }}>{s.name}</div>
                    <div style={{ fontSize:11, color:'var(--text-3)' }}>{s.type} · {s.loc}</div>
                  </div>
                </div>
                <Badge text={s.status} color={s.statusClr}
                  bg={s.status==='Verified'?'var(--green-dim)':'var(--gold-dim)'} />
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                <span style={{ fontSize:11, color:'var(--text-3)' }}>Risk {s.risk}/100</span>
              </div>
              <div style={{ height:4, background:'var(--base)', borderRadius:2, border:'1px solid var(--border)' }}>
                <div style={{ height:'100%', borderRadius:2, width:`${s.risk}%`,
                  background:s.risk>70?'var(--red)':'var(--green)' }}/>
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr' }}>
              {[['REQUESTED',`${(s.requested/1000).toFixed(0)}K RLUSD`],['LIMIT',`${(s.limit/1000).toFixed(0)}K RLUSD`],
                ['EXPOSURE',`${s.exposure?`${(s.exposure/1000).toFixed(0)}K`:'0'} RLUSD`],['TERM',s.term]].map(([k,v],idx) => (
                <div key={k} style={{ padding:'10px 14px',
                  borderRight:idx%2===0?'1px solid var(--border)':'none',
                  borderBottom:idx<2?'1px solid var(--border)':'none',
                  background:idx%2===0?'var(--card)':'var(--base)' }}>
                  <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.07em', color:'var(--text-3)', marginBottom:3 }}>{k}</div>
                  <div style={{ fontFamily:MONO, fontSize:12, fontWeight:600 }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ display:'flex', gap:6, padding:'12px 14px', borderTop:'1px solid var(--border)' }}>
              <button style={{ flex:1, padding:'7px 0', border:'1px solid var(--border)', borderRadius:R,
                background:'var(--card)', fontFamily:FONT, fontSize:12, fontWeight:500, cursor:'pointer' }}>ⓘ Analyze</button>
              {s.blocked
                ? <button style={{ flex:1, padding:'7px 0', border:'1px solid rgba(185,28,28,.2)', borderRadius:R,
                    background:'var(--red-dim)', fontFamily:FONT, fontSize:12, fontWeight:600, cursor:'not-allowed', color:'var(--red)' }}>Blocked</button>
                : <button style={{ flex:1, padding:'7px 0', border:'1px solid var(--border)', borderRadius:R,
                    background:'var(--card)', fontFamily:FONT, fontSize:12, fontWeight:500, cursor:'pointer', color:'var(--text-3)' }}>Approve Credit</button>
              }
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════
   WIZARD COMPONENTS
════════════════════════════════════════════════════ */

function WizardBar({ phase, onBack }: { phase: WizardPhase; onBack: () => void }) {
  const steps = ['Situation','AI Analysis','Choose Action','Executing','Done'];
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
      padding:'0 40px', height:40, borderBottom:'1px solid var(--border)',
      background:'var(--card)', fontSize:12, flexShrink:0 }}>
      <button onClick={onBack} style={{ background:'none', border:'none', cursor:'pointer',
        color:'var(--text-2)', fontSize:12, fontFamily:FONT, padding:0,
        display:'flex', alignItems:'center', gap:5 }}>
        ← Overview
      </button>
      <div style={{ display:'flex', gap:4, alignItems:'center' }}>
        {steps.map((s, i) => (
          <span key={s} style={{ padding:'2px 8px', borderRadius:2,
            fontSize:11, fontWeight:i+1===phase ? 600 : 400,
            color:i+1<phase ? 'var(--green)' : i+1===phase ? 'var(--text-1)' : 'var(--text-3)',
            background:i+1===phase ? 'var(--base)' : 'transparent' }}>
            {i+1 < phase ? '✓' : `${i+1}.`} {s}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─── Phase 1: Situation ─────────────────────────── */
function Phase1({ balances, onAnalyze }: {
  balances: BalancesResponse | null;
  onAnalyze: () => void;
}) {
  const subs = balances?.subsidiaries ?? {};
  const entities = Object.keys(subs).length > 0
    ? Object.values(subs).map(s => ({
        id: Object.keys(subs).find(k => subs[k] === s) ?? '',
        name: s.name, loc: '', balance: s.rlusd_balance, min: s.threshold_min ?? 0, status: s.status.toUpperCase(),
      }))
    : FALLBACK_ENTITIES;
  const deficitEntity = entities.find(e => e.status === 'DEFICIT');
  const shortfall = deficitEntity ? Math.max(0, deficitEntity.min - deficitEntity.balance) : 0;
  const vaultPct = balances?.vault ? Math.round(((balances.vault.deposited_total ?? 0) / (balances.vault.total_capacity || 10000000)) * 100) : VAULT_DEMO.pct;
  const networkLiquidity = balances?.network_rlusd ?? NET_DEMO.liquidity;
  const fxSaved = (balances as { total_fx_saved?: number })?.total_fx_saved ?? NET_DEMO.fxSaved;
  const max = Math.max(...entities.map(e => Math.abs(e.balance)));

  const rows = [
    { label:'Network liquidity', value:`$${(networkLiquidity/1e6).toFixed(2)}M`, vc:'var(--text-1)' },
    { label:'Settlement time',   value:'3–5 seconds',      vc:'var(--green)' },
    { label:'vs. bank wire',     value:'1–3 days',         vc:'var(--text-2)' },
    { label:'TX fee (XRPL)',     value:`$${NET_DEMO.txFee}`, vc:'var(--green)' },
    { label:'FX saved today',    value:`$${fxSaved.toLocaleString()}`, vc:'var(--green)' },
  ];

  return (
    <div style={{ display:'flex', minHeight:'100%' }}>
      {/* Left: network + entity list */}
      <div style={{ flex:1, padding:'28px 40px 40px', overflowY:'auto' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:24 }}>
          <span style={{ fontSize:11, fontWeight:500, letterSpacing:'0.07em', color:'var(--text-3)', textTransform:'uppercase' }}>Treasury Network</span>
          <span style={{ color:'var(--border)', fontSize:14 }}>·</span>
          <span style={{ fontSize:11, color:'var(--text-3)' }}>{entities.length} entities</span>
          <span style={{ color:'var(--border)', fontSize:14 }}>·</span>
          <span style={{ fontSize:11, color:'var(--blue)', fontWeight:500 }}>XRPL Devnet</span>
        </div>

        <NetworkGraph subsidiaries={subs} vaultCapacity={vaultPct}
          executingFrom={deficitEntity ? entities.find(e => e.status==='NORMAL')?.id : undefined}
          executingTo={deficitEntity?.id} />

        <div style={{ marginTop:28, borderTop:'1px solid var(--border)', paddingTop:4 }}>
          {entities.map(e => {
            const pct = Math.min(Math.abs(e.balance) / max * 100, 100);
            const deficit = e.balance < 0 || e.status === 'DEFICIT';
            return (
              <div key={e.id} style={{ display:'grid', gridTemplateColumns:'180px 140px 1fr 92px',
                alignItems:'center', gap:16, padding:'14px 0',
                borderBottom:'1px solid rgba(17,16,16,.06)', animation:'fadeUp 0.3s ease-out' }}>
                <div>
                  <div style={{ fontWeight:600, fontSize:14 }}>{e.name}</div>
                  <div style={{ fontSize:11, color:'var(--text-3)', marginTop:1 }}>{e.loc || e.id}</div>
                </div>
                <div style={{ fontFamily:MONO, fontSize:17, fontWeight:600,
                  color:deficit?'var(--red)':'var(--text-1)' }}>
                  {e.balance<0?'-':''}${Math.abs(e.balance)>=1e6?(Math.abs(e.balance)/1e6).toFixed(2)+'M':(Math.abs(e.balance)/1e3).toFixed(0)+'K'}
                </div>
                <div style={{ position:'relative', height:5, background:'var(--border)', borderRadius:3 }}>
                  <div style={{ position:'absolute', left:0, top:0, bottom:0,
                    width:`${pct}%`, background:deficit?'var(--red)':'var(--green)',
                    borderRadius:3, animation:'barGrow 0.8s ease-out' }}/>
                </div>
                <div style={{ textAlign:'right' }}>
                  <Badge text={e.status}
                    color={deficit ? 'var(--red)' : e.status === 'SURPLUS' ? 'var(--green)' : 'var(--text-3)'}
                    bg={deficit ? 'var(--red-dim)' : e.status === 'SURPLUS' ? 'var(--green-dim)' : 'var(--base)'} />
                </div>
              </div>
            );
          })}
          {/* Vault row */}
          <div style={{ display:'grid', gridTemplateColumns:'180px 140px 1fr 92px',
            alignItems:'center', gap:16, padding:'14px 0' }}>
            <div>
              <div style={{ fontWeight:600, fontSize:14 }}>Corp. Vault</div>
              <div style={{ fontSize:11, color:'var(--text-3)', marginTop:1 }}>XLS-65 Single Asset</div>
            </div>
            <div style={{ fontFamily:MONO, fontSize:17, fontWeight:600, color:'var(--gold)' }}>
              ${(((balances?.vault?.deposited_total ?? balances?.vault?.available) ?? VAULT_DEMO.balance)/1e6).toFixed(2)}M
            </div>
            <div style={{ position:'relative', height:5, background:'var(--border)', borderRadius:3 }}>
              <div style={{ position:'absolute', left:0, top:0, bottom:0, width:`${vaultPct}%`,
                background:'var(--gold)', borderRadius:3 }}/>
            </div>
            <div style={{ textAlign:'right' }}>
              <Badge text="VAULT" color="var(--gold)" bg="var(--gold-dim)" />
            </div>
          </div>
        </div>
      </div>

      {/* Right: action panel */}
      <div style={{ width:300, minWidth:300, flexShrink:0, borderLeft:'1px solid var(--border)',
        background:'var(--card)', padding:'28px 24px', display:'flex', flexDirection:'column' }}>
        {deficitEntity ? (
          <>
            <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:14 }}>
              <div style={{ width:7, height:7, borderRadius:'50%', background:'var(--red)',
                animation:'dotPulse 1.6s ease-in-out infinite', flexShrink:0 }}/>
              <span style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', color:'var(--red)' }}>ACTION REQUIRED</span>
            </div>
            <div style={{ background:'var(--red-dim)', border:'1px solid rgba(185,28,28,.2)',
              borderRadius:R, padding:'16px 18px', marginBottom:24, animation:'glow 2.5s ease-in-out infinite' }}>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.08em', color:'var(--red)', marginBottom:6 }}>
                LIQUIDITY SHORTFALL — {deficitEntity.name.toUpperCase()}
              </div>
              <div style={{ fontFamily:MONO, fontSize:32, fontWeight:700, color:'var(--red)',
                letterSpacing:'-0.02em', lineHeight:1.1, marginBottom:8 }}>
                ${shortfall.toLocaleString()}
              </div>
              <div style={{ fontSize:13, color:'var(--text-2)', lineHeight:1.5 }}>
                Below minimum threshold. Fix it in seconds on XRPL — no bank wire, no delays.
              </div>
            </div>
          </>
        ) : (
          <>
            <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:14 }}>
              <div style={{ width:7, height:7, borderRadius:'50%', background:'var(--green)', flexShrink:0 }}/>
              <span style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', color:'var(--green)' }}>ALL SYSTEMS NORMAL</span>
            </div>
            <div style={{ background:'var(--green-dim)', border:'1px solid rgba(21,128,61,.2)',
              borderRadius:R, padding:'16px 18px', marginBottom:24 }}>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.08em', color:'var(--green)', marginBottom:6 }}>
                ALL ENTITIES BALANCED
              </div>
              <div style={{ fontFamily:MONO, fontSize:32, fontWeight:700, color:'var(--green)',
                letterSpacing:'-0.02em', lineHeight:1.1, marginBottom:8 }}>
                $0
              </div>
              <div style={{ fontSize:13, color:'var(--text-2)', lineHeight:1.5 }}>
                All entities are within their minimum thresholds. No action required.
              </div>
            </div>
          </>
        )}

        <div style={{ borderTop:'1px solid var(--border)', paddingTop:18, marginBottom:24, flex:1 }}>
          {rows.map(r => (
            <div key={r.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline',
              padding:'8px 0', borderBottom:'1px solid rgba(17,16,16,.06)' }}>
              <span style={{ fontSize:12, color:'var(--text-3)' }}>{r.label}</span>
              <span style={{ fontSize:13, fontWeight:600, fontFamily:MONO, color:r.vc }}>{r.value}</span>
            </div>
          ))}
        </div>

        <button onClick={onAnalyze} style={{ width:'100%', padding:'15px 0',
          background:'var(--text-1)', color:'white', border:'none', borderRadius:R,
          fontFamily:FONT, fontSize:15, fontWeight:600, cursor:'pointer', letterSpacing:'0.02em',
          boxShadow:'var(--shadow-lift)' }}>
          Analyze with AI →
        </button>
        <div style={{ textAlign:'center', fontSize:11, color:'var(--text-3)', marginTop:8 }}>
          Claude Sonnet · Policy enforced · Human approves
        </div>
      </div>
    </div>
  );
}

/* ─── Phase 2: AI Analysis ───────────────────────── */
function Phase2({ analysis, loadingAnalysis, onContinue }: {
  analysis: AnalysisResponse | null;
  loadingAnalysis: boolean;
  onContinue: () => void;
}) {
  const [done, setDone] = useState<number[]>([]);
  const [current, setCurrent] = useState(0);
  const [animDone, setAnimDone] = useState(false);

  useEffect(() => {
    setDone([]); setCurrent(0); setAnimDone(false);
    let idx = 0;
    function runNext() {
      if (idx >= AI_STEPS.length) { setAnimDone(true); return; }
      const step = AI_STEPS[idx];
      setTimeout(() => {
        setDone(prev => [...prev, idx]);
        setCurrent(idx + 1);
        idx++;
        runNext();
      }, step.ms);
    }
    runNext();
  }, []);

  const showResult = animDone && !loadingAnalysis;

  return (
    <div style={{ maxWidth:680, margin:'0 auto', padding:'48px 40px', animation:'fadeUp .3s ease-out' }}>
      <div style={{ marginBottom:32 }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', color:'var(--blue)', marginBottom:8 }}>
          STEP 2 / 4 — AI ANALYSIS
        </div>
        <h2 style={{ fontSize:22, fontWeight:700, margin:0 }}>Analyzing treasury positions</h2>
        <div style={{ fontSize:13, color:'var(--text-2)', marginTop:6 }}>
          Claude Sonnet · Policy Engine active · 9 deterministic checks
        </div>
      </div>

      <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:R, padding:'20px 24px', marginBottom:28 }}>
        {AI_STEPS.map((step, i) => {
          const isDone = done.includes(i);
          const isActive = current === i && !isDone;
          return (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:12, padding:'9px 0',
              borderBottom:i < AI_STEPS.length-1 ? '1px solid rgba(17,16,16,.06)' : 'none',
              opacity:i > current ? 0.35 : 1,
              animation:isDone ? 'stepIn .25s ease-out' : 'none' }}>
              <div style={{ width:18, height:18, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                {isDone ? (
                  <svg width="16" height="16" viewBox="0 0 16 16">
                    <circle cx="8" cy="8" r="8" fill="#15803D"/>
                    <path d="M4.5 8l2.5 2.5 4.5-5" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : isActive ? (
                  <div style={{ width:14, height:14, borderRadius:'50%', border:'2px solid var(--blue)',
                    borderTopColor:'transparent', animation:'spin 0.7s linear infinite' }}/>
                ) : (
                  <div style={{ width:8, height:8, borderRadius:'50%', background:'var(--border)' }}/>
                )}
              </div>
              <span style={{ fontSize:13, fontWeight:isDone?500:400,
                color:isDone?'var(--text-1)':isActive?'var(--blue)':'var(--text-3)' }}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {showResult && (
        <div style={{ animation:'fadeUp .4s ease-out' }}>
          <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:R, padding:24, marginBottom:24 }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.08em', color:'var(--text-3)', marginBottom:16 }}>
              AI RECOMMENDATION — {analysis?.ai_mode === 'claude' ? 'GROQ AI' : 'RULE ENGINE'}
            </div>
            {analysis ? (
              analysis.problem_detected ? (
                <>
                  <div style={{ display:'flex', gap:10, marginBottom:10, alignItems:'flex-start' }}>
                    <div style={{ width:7, height:7, borderRadius:'50%', marginTop:5, flexShrink:0, background:'var(--red)' }}/>
                    <span style={{ fontSize:13, lineHeight:1.5 }}>{analysis.problem_summary}</span>
                  </div>
                  {analysis.options.map((opt, i) => (
                    <div key={i} style={{ display:'flex', gap:10, marginBottom:10, alignItems:'flex-start' }}>
                      <div style={{ width:7, height:7, borderRadius:'50%', marginTop:5, flexShrink:0, background:'var(--green)' }}/>
                      <span style={{ fontSize:13, lineHeight:1.5 }}>{opt.reasoning}</span>
                    </div>
                  ))}
                </>
              ) : (
                <div style={{ display:'flex', gap:10, marginBottom:10, alignItems:'flex-start' }}>
                  <div style={{ width:7, height:7, borderRadius:'50%', marginTop:5, flexShrink:0, background:'var(--green)' }}/>
                  <span style={{ fontSize:13, lineHeight:1.5 }}>{analysis.problem_summary}</span>
                </div>
              )
            ) : (
              [
                { dot:'red',   text:'Corp. Brazil is $380,000 below minimum threshold ($200,000 min).' },
                { dot:'green', text:'Corp. Zurich holds $1,600,000 surplus above minimum.' },
                { dot:'green', text:'Corp. Singapore holds $1,070,000 surplus above minimum.' },
              ].map((item, i) => (
                <div key={i} style={{ display:'flex', gap:10, marginBottom:10, alignItems:'flex-start' }}>
                  <div style={{ width:7, height:7, borderRadius:'50%', marginTop:5, flexShrink:0,
                    background:item.dot==='red'?'var(--red)':'var(--green)' }}/>
                  <span style={{ fontSize:13, lineHeight:1.5 }}>{item.text}</span>
                </div>
              ))
            )}
            {analysis?.problem_detected === false ? (
              <div style={{ marginTop:20, padding:16, background:'var(--green-dim)', borderRadius:R,
                border:'1px solid rgba(21,128,61,.2)' }}>
                <div style={{ fontSize:12, fontWeight:700, color:'var(--green)', marginBottom:6,
                  letterSpacing:'0.06em' }}>SYSTEM BALANCED</div>
                <div style={{ fontSize:12, color:'var(--text-2)', lineHeight:1.6 }}>
                  All entities are operating within their minimum liquidity thresholds. No treasury action is needed at this time.
                </div>
              </div>
            ) : analysis?.options?.[0] ? (
              <div style={{ marginTop:20, padding:16, background:'var(--base)', borderRadius:R, border:'1px solid var(--border)' }}>
                <div style={{ fontSize:12, fontWeight:600, marginBottom:8 }}>Recommended action</div>
                {[
                  ['Route',           `${entityName((analysis.options[0] as {from?:string}).from ?? 'zurich')} → ${entityName((analysis.options[0] as {to?:string}).to ?? 'brazil')} via XRPL`],
                  ['Amount',          `$${(analysis.options[0].amount as number).toLocaleString()} RLUSD`],
                  ['FX saving vs. bank', `$${Math.round(analysis.options[0].fx_saving_usd as number).toLocaleString()} (0.25% fee waived)`],
                  ['Settlement',      '3–5 seconds vs. 1–3 banking days'],
                  ['Policy compliance','9/9 checks passed'],
                  ['AI Confidence',   `${Math.round(((analysis.options[0] as {confidence?:number})?.confidence ?? 0.94) * 100)}%`],
                ].map(([k,v]) => (
                  <div key={k} style={{ display:'flex', gap:8, marginBottom:4, fontSize:12 }}>
                    <span style={{ color:'var(--text-3)', minWidth:140 }}>{k}</span>
                    <span style={{ fontWeight:500, fontFamily:k==='Amount'||k==='FX saving vs. bank'?MONO:'inherit' }}>{v}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          {analysis?.problem_detected !== false && (
            <button onClick={onContinue} style={{ padding:'13px 32px', background:'var(--text-1)', color:'white',
              border:'none', borderRadius:R, fontFamily:FONT, fontSize:14, fontWeight:600, cursor:'pointer' }}>
              Continue — Choose Action →
            </button>
          )}
        </div>
      )}

      {!showResult && loadingAnalysis && (
        <div style={{ fontSize:12, color:'var(--text-3)', display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:12, height:12, borderRadius:'50%', border:'2px solid var(--blue)',
            borderTopColor:'transparent', animation:'spin 0.7s linear infinite' }}/>
          Waiting for AI response…
        </div>
      )}
    </div>
  );
}

/* ─── Phase 3: Choose Option ─────────────────────── */
function Phase3({ analysis, onSelect }: {
  analysis: AnalysisResponse | null;
  onSelect: (opt: WizardOption) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);

  const rawOptions: WizardOption[] = analysis?.options?.length ? analysis.options : FALLBACK_OPTIONS;
  const options = rawOptions.map((opt, i) => {
    const o = opt;
    const fromId  = o.from   ?? o.from_id   ?? 'corp_vault';
    const toId    = o.to     ?? o.to_id     ?? 'brazil';
    const actType = o.type   ?? o.action_type ?? 'direct_transfer';
    const isVault = actType === 'vault_credit' || fromId === 'corp_vault';
    return {
      id: String.fromCharCode(65 + i),
      fromId, toId,
      from:  o.from_name  ?? (isVault ? 'Corp. Vault' : fromId.charAt(0).toUpperCase() + fromId.slice(1)),
      to:    o.to_name    ?? toId.charAt(0).toUpperCase() + toId.slice(1),
      type:  isVault ? 'VAULT CREDIT' : 'DIRECT TRANSFER',
      route: isVault ? `XLS-66 Lending · ${o.term_days ?? 7}-day term` : `${fromId.toUpperCase()} → ${toId.toUpperCase()} · XRPL`,
      amount:     o.amount ?? 380000,
      settlement: o.settlement_time ?? '3–5 seconds',
      fxSaving:   o.fx_saving ?? 950,
      rate:       o.rate_pct ? `${o.rate_pct}% / ${o.term_days ?? 7}d` : null,
      risk:       o.risk_score != null ? (o.risk_score < 0.3 ? 'Low' : o.risk_score < 0.6 ? 'Medium' : 'High') : 'Low',
      confidence: o.confidence ?? 0.94,
      aiPick: i === 0,
      _raw: opt,
    };
  });

  return (
    <div style={{ padding:40, animation:'fadeUp .3s ease-out' }}>
      <div style={{ marginBottom:28 }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', color:'var(--blue)', marginBottom:8 }}>
          STEP 3 / 4 — CHOOSE ACTION
        </div>
        <h2 style={{ fontSize:22, fontWeight:700, margin:0 }}>
          {options.length} options to resolve Corp. Brazil&apos;s deficit
        </h2>
        <div style={{ fontSize:13, color:'var(--text-2)', marginTop:6 }}>
          AI confidence {Math.round(options[0]?.confidence * 100)}% · Choose one to execute on XRPL
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:`repeat(${options.length},1fr)`, gap:2 }}>
        {options.map(opt => (
          <div key={opt.id}
            onMouseEnter={() => setHover(opt.id)}
            onMouseLeave={() => setHover(null)}
            style={{ background:'var(--card)',
              border:`1px solid ${hover===opt.id ? '#111010' : 'var(--border)'}`,
              borderRadius:R, padding:'28px 28px 0',
              display:'flex', flexDirection:'column',
              transition:'border-color .15s var(--ease-out), transform .18s var(--ease-out), box-shadow .18s var(--ease-out)',
              transform:hover===opt.id ? 'translateY(-3px)' : 'none',
              boxShadow:hover===opt.id ? 'var(--shadow-lift)' : 'var(--shadow-card)',
              minHeight:460, position:'relative' }}>

            {opt.aiPick && (
              <div style={{ position:'absolute', top:16, right:16, background:'var(--text-1)', color:'white',
                fontSize:11, fontWeight:700, letterSpacing:'0.1em', padding:'3px 8px', borderRadius:2 }}>
                AI PICK
              </div>
            )}

            <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', color:'var(--text-3)', marginBottom:16 }}>
              OPTION {opt.id} · {opt.type}
            </div>
            <div style={{ fontSize:20, fontWeight:700, lineHeight:1.2, marginBottom:4 }}>
              {opt.from}<br/><span style={{ color:'var(--text-2)' }}>→ {opt.to}</span>
            </div>
            <div style={{ fontSize:11, color:'var(--text-3)', marginBottom:24 }}>{opt.route}</div>

            <div style={{ fontFamily:MONO, fontSize:32, fontWeight:600, marginBottom:28, letterSpacing:'-0.02em' }}>
              ${opt.amount.toLocaleString()}
            </div>

            <div style={{ flex:1, borderTop:'1px solid var(--border)' }}>
              {[
                ['Settlement', opt.settlement, 'var(--green)'],
                [`FX saving`,  `+$${opt.fxSaving}`, 'var(--green)'],
                ...(opt.rate ? [['Interest rate', opt.rate, 'var(--text-1)']] : []),
                ['Risk level', opt.risk, 'var(--green)'],
              ].map(([k, v, vc]) => (
                <div key={k} style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline',
                  padding:'10px 0', borderBottom:'1px solid rgba(17,16,16,.06)' }}>
                  <span style={{ fontSize:13, color:'var(--text-3)' }}>{k}</span>
                  <span style={{ fontSize:13, fontWeight:600, color:vc, fontFamily:MONO }}>{v}</span>
                </div>
              ))}
            </div>

            <button onClick={() => onSelect(opt._raw)}
              style={{ width:'calc(100% + 56px)', marginLeft:-28, marginTop:24, padding:16,
                background:opt.aiPick ? 'var(--text-1)' : 'var(--card)',
                color:opt.aiPick ? 'white' : 'var(--text-1)',
                border:opt.aiPick ? 'none' : '1px solid var(--border)',
                borderTop:'1px solid var(--border)',
                borderRadius:`0 0 ${R} ${R}`,
                fontFamily:FONT, fontSize:14, fontWeight:600,
                cursor:'pointer', letterSpacing:'0.01em' }}>
              Execute Option {opt.id} →
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Phase 4: Execution ─────────────────────────── */
function Phase4({ option, approvalResult, onDone }: {
  option: WizardOption | null;
  approvalResult: ApprovalResult | null;
  onDone: () => void;
}) {
  const [completed, setCompleted] = useState<number[]>([]);
  const [current, setCurrent]     = useState(0);
  const [animComplete, setAnimComplete] = useState(false);

  useEffect(() => {
    setCompleted([]); setCurrent(0); setAnimComplete(false);
    let idx = 0;
    function next() {
      if (idx >= EXEC_STEPS.length) { setAnimComplete(true); return; }
      setTimeout(() => {
        setCompleted(prev => [...prev, idx]);
        setCurrent(idx + 1);
        idx++;
        next();
      }, EXEC_STEPS[idx].ms);
    }
    next();
  }, []);

  useEffect(() => {
    if (animComplete && approvalResult) onDone();
  }, [animComplete, approvalResult, onDone]);

  const opt = option;
  const totalMs = EXEC_STEPS.reduce((a, s) => a + s.ms, 0);
  const progressPct = EXEC_STEPS.reduce((acc, s, i) => completed.includes(i) ? acc + (s.ms/totalMs*100) : acc, 0);
  const fromLabel = opt?.from_name ?? opt?.from ?? opt?.from_id ?? 'Corp. Zurich';
  const toLabel   = opt?.to_name   ?? opt?.to   ?? opt?.to_id   ?? 'Corp. Brazil';
  const amount    = opt?.amount ?? 380000;

  return (
    <div style={{ maxWidth:600, margin:'0 auto', padding:'48px 40px', animation:'fadeUp .3s ease-out' }}>
      <div style={{ marginBottom:32 }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', color:'var(--blue)', marginBottom:8 }}>
          STEP 4 / 4 — EXECUTING ON XRPL
        </div>
        <h2 style={{ fontSize:22, fontWeight:700, margin:0 }}>
          {opt?.type ?? opt?.action_type === 'vault_credit' ? 'VAULT CREDIT' : 'DIRECT TRANSFER'}
        </h2>
        <div style={{ fontSize:13, color:'var(--text-2)', marginTop:6 }}>
          {fromLabel} → {toLabel} · ${amount.toLocaleString()} RLUSD
        </div>
      </div>

      <div style={{ height:3, background:'var(--border)', borderRadius:2, marginBottom:32, overflow:'hidden' }}>
        <div style={{ height:'100%', background:'var(--green)', borderRadius:2,
          transition:'width 0.4s ease-out', width:`${progressPct}%` }}/>
      </div>

      <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:R, padding:'20px 24px' }}>
        {EXEC_STEPS.map((step, i) => {
          const isDone   = completed.includes(i);
          const isActive = current === i;
          return (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:14, padding:'12px 0',
              borderBottom:i < EXEC_STEPS.length-1 ? '1px solid rgba(17,16,16,.06)' : 'none',
              opacity:i > current ? 0.3 : 1 }}>
              <div style={{ width:20, height:20, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                {isDone ? (
                  <svg width="18" height="18" viewBox="0 0 18 18">
                    <circle cx="9" cy="9" r="9" fill="#15803D"/>
                    <path d="M5 9l3 3 5-5.5" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : isActive ? (
                  <div style={{ width:16, height:16, borderRadius:'50%', border:'2px solid var(--blue)',
                    borderTopColor:'transparent', animation:'spin 0.7s linear infinite' }}/>
                ) : (
                  <div style={{ width:10, height:10, borderRadius:'50%', background:'var(--border)' }}/>
                )}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14, fontWeight:isDone?500:400,
                  color:isDone?'var(--text-1)':isActive?'var(--blue)':'var(--text-3)' }}>
                  {step.label}
                </div>
                <div style={{ fontSize:11, color:'var(--text-3)', marginTop:1 }}>{step.detail}</div>
              </div>
              {isDone && <span style={{ fontSize:11, color:'var(--green)', fontWeight:600 }}>✓</span>}
            </div>
          );
        })}
      </div>

      {animComplete && !approvalResult && (
        <div style={{ marginTop:16, display:'flex', alignItems:'center', gap:8, fontSize:12, color:'var(--text-3)' }}>
          <div style={{ width:12, height:12, borderRadius:'50%', border:'2px solid var(--blue)',
            borderTopColor:'transparent', animation:'spin 0.7s linear infinite' }}/>
          Waiting for XRPL confirmation…
        </div>
      )}
    </div>
  );
}

/* ─── Phase 5: Done ──────────────────────────────── */
function Phase5({ option, approvalResult, onReset }: {
  option: WizardOption | null;
  approvalResult: ApprovalResult | null;
  onReset: () => void;
}) {
  const opt = option;
  const txHash      = approvalResult?.xrpl?.tx_hash ?? '';
  const explorerUrl = approvalResult?.xrpl?.explorer_url ?? null;
  const simulated   = approvalResult?.xrpl?.simulated ?? false;
  const fromLabel = opt?.from_name ?? opt?.from ?? opt?.from_id ?? 'Corp. Zurich';
  const toLabel   = opt?.to_name   ?? opt?.to   ?? opt?.to_id   ?? 'Corp. Brazil';
  const amount    = opt?.amount ?? 380000;
  const fxSaved   = approvalResult?.fx_saving_usd ?? opt?.fx_saving ?? opt?.fxSaving ?? 950;
  const actType   = opt?.type ?? opt?.action_type ?? 'direct_transfer';

  return (
    <div style={{ maxWidth:580, margin:'0 auto', padding:'64px 40px', textAlign:'center', animation:'fadeUp .35s ease-out' }}>
      <div className="success-ring" style={{ width:64, height:64, borderRadius:'50%', background:'var(--green-dim)',
        border:'2px solid rgba(21,128,61,.3)',
        display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 20px' }}>
        <svg width="28" height="28" viewBox="0 0 28 28">
          <path className="success-check" d="M6 14l6 6L22 8" stroke="#15803D" strokeWidth="2.5" fill="none"
            strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      <h2 style={{ fontSize:22, fontWeight:700, margin:'0 0 4px' }}>
        {simulated ? 'Transaction settled (simulated)' : 'Settled on XRPL'}
      </h2>
      <div style={{ fontFamily:MONO, fontSize:40, fontWeight:700, letterSpacing:'-0.02em',
        color:'var(--green)', margin:'10px 0 6px', lineHeight:1.1 }}>
        ${amount.toLocaleString()}
        <span style={{ fontSize:15, fontWeight:600, color:'var(--text-3)', marginLeft:8 }}>RLUSD</span>
      </div>
      <div style={{ fontSize:14, color:'var(--text-2)', marginBottom:28 }}>
        {toLabel}&apos;s deficit resolved in seconds — not days.
      </div>

      <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:R,
        padding:'20px 24px', textAlign:'left', marginBottom:24 }}>
        {[
          ['Type',     actType === 'vault_credit' ? 'VAULT CREDIT' : 'DIRECT TRANSFER'],
          ['Route',    `${fromLabel} → ${toLabel}`],
          ['FX saved vs. bank wire', `$${fxSaved.toLocaleString()}`],
          ['Settlement time', '3–5 seconds'],
          ['Status',   simulated ? 'SIMULATED' : 'ON-CHAIN ✓'],
        ].map(([k,v]) => (
          <div key={k} style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline',
            padding:'9px 0', borderBottom:'1px solid rgba(17,16,16,.06)' }}>
            <span style={{ fontSize:12, color:'var(--text-3)' }}>{k}</span>
            <span style={{ fontSize:13, fontWeight:600, fontFamily:MONO,
              color:k==='Status'||k==='FX saved' ? 'var(--green)' : 'var(--text-1)' }}>{v}</span>
          </div>
        ))}
        <div style={{ marginTop:16, padding:12, background:'var(--base)', borderRadius:2 }}>
          <div style={{ fontSize:11, color:'var(--text-3)', fontWeight:600, letterSpacing:'0.05em', marginBottom:4 }}>
            TX HASH
          </div>
          <div style={{ fontFamily:MONO, fontSize:11, color:'var(--blue)', wordBreak:'break-all', lineHeight:1.6 }}>
            {txHash ? txHash.slice(0, 64) : 'pending…'}
          </div>
        </div>
      </div>

      <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
        {explorerUrl && !simulated && (
          <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
            style={{ display:'inline-block', padding:'12px 24px', background:'var(--text-1)', color:'white',
              borderRadius:R, fontFamily:FONT, fontSize:14, fontWeight:600, textDecoration:'none',
              boxShadow:'var(--shadow-lift)' }}>
            View on XRPL Explorer ↗
          </a>
        )}
        <button onClick={onReset} style={{ padding:'12px 24px', background:'transparent',
          color:'var(--text-1)', border:'1px solid var(--border)', borderRadius:R,
          fontFamily:FONT, fontSize:14, fontWeight:500, cursor:'pointer' }}>
          ← Return to Overview
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════
   OVERVIEW TAB (combines all wizard phases)
════════════════════════════════════════════════════ */
function OverviewTab({ balances, analysis, loadingAnalysis, approvalResult, onAnalyze, onExecute }: {
  balances: BalancesResponse | null;
  analysis: AnalysisResponse | null;
  loadingAnalysis: boolean;
  approvalResult: ApprovalResult | null;
  onAnalyze: () => void;
  onExecute: (opt: WizardOption) => void;
}) {
  const [phase, setPhase] = useState<WizardPhase>(1);
  const [selOption, setSelOption] = useState<WizardOption | null>(null);

  const handleAnalyze = () => { setPhase(2); onAnalyze(); };
  const handleSelect  = (opt: WizardOption) => { setSelOption(opt); setPhase(4); onExecute(opt); };
  const handleReset   = () => { setPhase(1); setSelOption(null); };

  return (
    <div style={{ display:'flex', flexDirection:'column' }}>
      {phase > 1 && <WizardBar phase={phase} onBack={() => setPhase(1)} />}
      {phase === 1 && <Phase1 balances={balances} onAnalyze={handleAnalyze} />}
      {phase === 2 && <Phase2 analysis={analysis} loadingAnalysis={loadingAnalysis} onContinue={() => setPhase(3)} />}
      {phase === 3 && <Phase3 analysis={analysis} onSelect={handleSelect} />}
      {phase === 4 && <Phase4 option={selOption} approvalResult={approvalResult} onDone={() => setPhase(5)} />}
      {phase === 5 && <Phase5 option={selOption} approvalResult={approvalResult} onReset={handleReset} />}
    </div>
  );
}

/* ════════════════════════════════════════════════════
   MAIN APP
════════════════════════════════════════════════════ */
export default function Home() {
  const [tab, setTab] = useState<Tab>('liquidity');
  const [balances,      setBalances]      = useState<BalancesResponse | null>(null);
  const [analysis,      setAnalysis]      = useState<AnalysisResponse | null>(null);
  const [approvalResult,setApprovalResult]= useState<ApprovalResult | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [isApproving,   setIsApproving]   = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  // Holds whatever action last failed, so Retry repeats THAT — not just a balance refresh.
  const retryRef = useRef<(() => void) | null>(null);

  const fetchBalances = useCallback(async () => {
    try { setBalances(await api.getBalances()); setError(null); }
    catch { setError('Backend offline'); retryRef.current = fetchBalances; }
  }, []);

  useEffect(() => { fetchBalances(); }, [fetchBalances]);
  useEffect(() => {
    const t = setInterval(fetchBalances, 20_000);
    return () => clearInterval(t);
  }, [fetchBalances]);

  const handleAnalyze = useCallback(async () => {
    setAnalysis(null); setLoadingAnalysis(true);
    try { setAnalysis(await api.analyze()); setError(null); }
    catch (e) {
      setError(e instanceof Error ? `Analysis failed — ${e.message.slice(0, 80)}` : 'Analysis failed');
      retryRef.current = handleAnalyze;
    }
    finally { setLoadingAnalysis(false); }
  }, []);

  const handleExecute = useCallback(async (opt: WizardOption) => {
    setApprovalResult(null); setIsApproving(true);
    try {
      // Resolve entity name/id → canonical backend ID (handles AI returning display names)
      const resolveEntityId = (val: string | undefined, fallback: string) => {
        if (!val) return fallback;
        return ENTITY_NAME_TO_ID[val.toLowerCase()] ?? (val.includes(' ') ? fallback : val);
      };
      const rawFrom = opt.from_id ?? opt.from;
      const rawTo   = opt.to_id   ?? opt.to;
      const fromId  = resolveEntityId(rawFrom, 'zurich');
      const toId    = resolveEntityId(rawTo, 'brazil');
      // Normalize action_type: accept display names and snake_case
      const rawType = (opt.type ?? opt.action_type ?? '').toLowerCase();
      const actType: 'direct_transfer' | 'vault_credit' =
        rawType.includes('vault') ? 'vault_credit' : 'direct_transfer';
      // confidence: API expects 0–100; analysis may return 0–1 decimal → convert
      const rawConf = opt.confidence ?? 94;
      const confidencePct = rawConf <= 1.0 ? rawConf * 100 : rawConf;
      const result = await api.approveTransfer({
        from_id: fromId, to_id: toId, amount: opt.amount ?? 0,
        action_type: actType, reasoning: opt.reasoning ?? '',
        term_days: opt.term_days, rate_pct: opt.rate_pct,
        confidence: confidencePct, approved_by: 'Treasury Manager',
      });
      setApprovalResult(result);
      setError(null);
      await fetchBalances();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transfer failed');
      retryRef.current = () => handleExecute(opt);
    } finally {
      setIsApproving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchBalances]);

  const subs       = balances?.subsidiaries ?? {};
  const deficitCount = Object.values(subs).filter(s => s.status === 'deficit').length;
  const totalRLUSD   = balances?.network_rlusd ?? 0;

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <Header
        active={tab} onChange={setTab}
        totalRLUSD={totalRLUSD} isLive={!error} deficitCount={deficitCount}
      />
      <StatusBar />

      {error && (
        <div style={{ padding:'8px 24px', background:'var(--red-dim)', borderBottom:'1px solid rgba(185,28,28,.2)',
          fontSize:12, color:'var(--red)', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <span>⚠ {error}</span>
          <button
            onClick={() => { setError(null); (retryRef.current ?? fetchBalances)(); }}
            style={{ background:'none', border:'1px solid rgba(185,28,28,.3)', borderRadius:R, padding:'3px 12px',
              cursor:'pointer', fontSize:11, color:'var(--red)', fontWeight:600, fontFamily:FONT }}>
            ↻ Retry
          </button>
        </div>
      )}

      <main style={{ flex:1, overflowY:'auto', overflowX:'hidden', position:'relative', zIndex:1 }}>
        {tab === 'liquidity' && (
          <OverviewTab
            balances={balances} analysis={analysis}
            loadingAnalysis={loadingAnalysis} approvalResult={approvalResult}
            onAnalyze={handleAnalyze} onExecute={handleExecute}
          />
        )}
        {tab === 'vault'     && <VaultTab />}
        {tab === 'xrpl'      && <XRPLTab />}
        {tab === 'risk'      && <RiskTab onScenarioApplied={fetchBalances} />}
        {tab === 'audit'     && <AuditTab />}
        {tab === 'suppliers' && <SuppliersTab />}
      </main>
    </div>
  );
}
