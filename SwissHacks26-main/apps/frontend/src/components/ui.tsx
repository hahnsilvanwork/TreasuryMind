import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

// ── motion entrance ──────────────────────────────────────────────
export function FadeUp({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function Stagger({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
    >
      {children}
    </motion.div>
  );
}
export function StaggerItem({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

// ── surfaces ─────────────────────────────────────────────────────
export function Card({ children, className = '', hover = false, onClick }: { children: ReactNode; className?: string; hover?: boolean; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl border border-hairline bg-white shadow-card ${
        hover ? 'transition-shadow hover:shadow-cardhover' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function Section({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-slate-900">{title}</h2>
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="text-[13px] font-medium text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-[13px] text-muted">{sub}</div>}
    </div>
  );
}

// ── buttons ──────────────────────────────────────────────────────
export function Button({
  children, onClick, variant = 'primary', size = 'md', disabled,
}: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger' | 'subtle'; size?: 'sm' | 'md'; disabled?: boolean }) {
  const styles = {
    primary: 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm',
    ghost: 'border border-hairline bg-white text-slate-700 hover:bg-slate-50',
    subtle: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
    danger: 'bg-red-600 text-white hover:bg-red-500',
  }[variant];
  const sz = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm';
  return (
    <button onClick={onClick} disabled={disabled} className={`inline-flex items-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${sz}`}>
      {children}
    </button>
  );
}

// ── status / badges ──────────────────────────────────────────────
// Status tag: a colored dot + plain text — no filled background (kills the "AI pill" look).
export function Pill({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'red' | 'amber' | 'blue' }) {
  const dot = {
    slate: 'bg-slate-400',
    green: 'bg-emerald-500',
    red: 'bg-red-500',
    amber: 'bg-amber-500',
    blue: 'bg-brand-500',
  }[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

export function StatusDot({ tone = 'green', pulse = false }: { tone?: 'green' | 'amber' | 'red' | 'slate'; pulse?: boolean }) {
  const c = { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', slate: 'bg-slate-400' }[tone];
  return (
    <span className="relative inline-flex h-2 w-2">
      {pulse && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${c} opacity-60`} />}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${c}`} />
    </span>
  );
}

// Subtle, text-only mode indicator — a small dot + muted label, no chip/fill.
export function ModeBadge({ source, network }: { source?: string; network?: string | null }) {
  let label = 'Simulated';
  let tone: 'green' | 'amber' | 'slate' = 'amber';
  if (source === 'LIVE' && network === 'testnet') { label = 'Live · Testnet'; tone = 'green'; }
  else if (source === 'LIVE' && network === 'devnet') { label = 'Live · Devnet'; tone = 'slate'; }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
      <StatusDot tone={tone} pulse={tone === 'green'} />
      {label}
    </span>
  );
}

export function ScoreDot({ score }: { score: number }) {
  const color = score >= 4 ? 'bg-red-500' : score >= 3 ? 'bg-orange-500' : score >= 1 ? 'bg-amber-400' : 'bg-emerald-500';
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700">
      <span className="flex gap-0.5">
        {[0, 1, 2, 3].map((i) => <span key={i} className={`h-1.5 w-3 rounded-full ${i < score ? color : 'bg-slate-200'}`} />)}
      </span>
      <span className="tnum text-slate-500">{score}/4</span>
    </span>
  );
}

export function ExplainabilityCard({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-brand-100 bg-gradient-to-br from-brand-50/80 to-cyan-50/40 p-3.5 text-sm leading-relaxed text-slate-700">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-600">
        <span className="text-cyan-500">✦</span> Agent rationale
      </div>
      {text}
    </div>
  );
}

// ── form primitives ──────────────────────────────────────────────
export const fieldCls =
  'w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${fieldCls} ${props.className ?? ''}`} />;
}

export function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return <select {...props} className={`${fieldCls} ${props.className ?? ''}`}>{children}</select>;
}

// ── modal / dialog ───────────────────────────────────────────────
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
          <motion.div className="relative w-full max-w-md rounded-2xl border border-hairline bg-white shadow-cardhover"
            initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
            {title && (
              <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
                <h3 className="text-sm font-semibold text-ink">{title}</h3>
                <button onClick={onClose} className="rounded-lg p-1 text-muted transition hover:bg-slate-50 hover:text-ink"><X size={16} /></button>
              </div>
            )}
            <div className="p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── animated number ──────────────────────────────────────────────
export function CountUp({ value, decimals = 0, prefix = '', suffix = '', duration = 900 }: { value: number; decimals?: number; prefix?: string; suffix?: string; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const startVal = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(startVal + (value - startVal) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span>{prefix}{display.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</span>;
}
