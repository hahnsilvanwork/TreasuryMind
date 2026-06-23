import { Area, AreaChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const BRAND = '#0a6cf5';
const CYAN = '#22d3ee';

export function Sparkline({ data, tone = 'brand' }: { data: number[]; tone?: 'brand' | 'red' | 'green' }) {
  const color = tone === 'red' ? '#ef4444' : tone === 'green' ? '#10b981' : BRAND;
  const series = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={36}>
      <LineChart data={series} margin={{ top: 4, bottom: 4, left: 0, right: 0 }}>
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} isAnimationActive />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ForecastChart({ data, buffer }: { data: { date: string; balance: string }[]; buffer: string }) {
  const series = data.map((d) => ({ date: d.date.slice(5), balance: Number(d.balance) }));
  const bufferNum = Number(buffer);
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={series} margin={{ top: 10, right: 12, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="fc" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BRAND} stopOpacity={0.25} />
            <stop offset="100%" stopColor={CYAN} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => `${(v / 1000).toLocaleString()}k`} />
        <Tooltip
          formatter={(v: number) => [`${v.toLocaleString()} RLUSD`, 'balance']}
          contentStyle={{ borderRadius: 12, border: '1px solid #e7ecf3', fontSize: 12, boxShadow: '0 4px 12px rgba(16,24,40,0.08)' }}
        />
        <ReferenceLine y={bufferNum} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'buffer', position: 'insideTopRight', fontSize: 10, fill: '#f59e0b' }} />
        <Area type="monotone" dataKey="balance" stroke={BRAND} strokeWidth={2.5} fill="url(#fc)" isAnimationActive />
      </AreaChart>
    </ResponsiveContainer>
  );
}
