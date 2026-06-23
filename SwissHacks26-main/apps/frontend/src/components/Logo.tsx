// Custom logomark — a hub-and-spoke ledger node (HQ funding subsidiaries). Distinctive, on-brand.
export function Logo({ size = 28, withRing = true }: { size?: number; withRing?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-label="TreasuryMind">
      <defs>
        <linearGradient id="lg" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0a6cf5" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      {withRing && <rect x="0.6" y="0.6" width="30.8" height="30.8" rx="9" stroke="url(#lg)" strokeOpacity="0.25" strokeWidth="1.2" />}
      {/* spokes */}
      <path d="M16 11 L9 21 M16 11 L23 21 M16 11 L16 22" stroke="url(#lg)" strokeWidth="1.6" strokeLinecap="round" />
      {/* hub */}
      <circle cx="16" cy="10" r="3.4" fill="url(#lg)" />
      {/* leaves */}
      <circle cx="9" cy="22" r="2.1" fill="#0a6cf5" />
      <circle cx="16" cy="22.5" r="2.1" fill="#138ae6" />
      <circle cx="23" cy="22" r="2.1" fill="#22d3ee" />
    </svg>
  );
}

// country accent — a colored left edge + full name, instead of a 2-letter monogram tile
export const COUNTRY: Record<string, { name: string; bar: string; text: string }> = {
  CH: { name: 'Switzerland', bar: 'bg-red-500', text: 'text-red-600' },
  BR: { name: 'Brazil', bar: 'bg-emerald-500', text: 'text-emerald-600' },
  DE: { name: 'Germany', bar: 'bg-amber-500', text: 'text-amber-600' },
  SG: { name: 'Singapore', bar: 'bg-brand-500', text: 'text-brand-600' },
};

const TONE: Record<string, string> = {
  CH: 'bg-red-50 text-red-600 ring-red-100',
  BR: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  DE: 'bg-amber-50 text-amber-700 ring-amber-100',
  SG: 'bg-brand-50 text-brand-700 ring-brand-100',
};

/** Monogram tile instead of an emoji flag — the Mercury/Brex account-avatar style. */
export function EntityTag({ code, size = 'md' }: { code: string; size?: 'sm' | 'md' }) {
  const cls = TONE[code] ?? 'bg-slate-100 text-slate-600 ring-slate-200';
  const dim = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs';
  return <span className={`inline-flex ${dim} items-center justify-center rounded-lg font-semibold tracking-tight ring-1 ring-inset ${cls}`}>{code}</span>;
}
