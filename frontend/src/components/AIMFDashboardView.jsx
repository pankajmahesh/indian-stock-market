/**
 * AI MF Dashboard — Exclusive Mutual Funds
 * Claude AI analyzes 20 exclusive/niche funds by real returns from mfapi.in
 * and surfaces the best picks with investment thesis, risk, and allocation guidance.
 */
import { useState, useEffect } from 'react';
import { api } from '../api';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Cell, ScatterChart, Scatter, ZAxis,
} from 'recharts';

/* ─── Constants ──────────────────────────────────────────────────────────── */
const CAT_COLOR = {
  'Sectoral – Power & Infra': '#f59e0b',
  'Sectoral – Technology':    '#06b6d4',
  'Sectoral – Consumption':   '#22c55e',
  'Sectoral – Pharma':        '#ec4899',
  'Sectoral – MNC':           '#3b82f6',
  'Sectoral – Infra':         '#f97316',
  'Sectoral – Logistics':     '#a78bfa',
  'Sectoral – Healthcare':    '#f472b6',
  'Sectoral – BFSI':          '#60a5fa',
  'Value':                    '#fbbf24',
  'Contra':                   '#fb923c',
  'Multi Asset':              '#8b5cf6',
  'International – US Tech':  '#34d399',
  'Small Cap – Quant':        '#ef4444',
  'Dividend Yield':           '#84cc16',
  'Dividend Yield – MNC':     '#4ade80',
};
const colorFor = (cat) => CAT_COLOR[cat] || '#64748b';

const CONV_COLOR = { HIGH: '#22c55e', MEDIUM: '#f59e0b', LOW: '#ef4444' };

/* ─── Score Ring ─────────────────────────────────────────────────────────── */
function ScoreRing({ score }) {
  const r = 28, c = Math.PI * 2 * r;
  const filled = (score / 100) * c;
  const color = score >= 75 ? '#22c55e' : score >= 55 ? '#f59e0b' : '#ef4444';
  return (
    <svg width={70} height={70} style={{ flexShrink: 0 }}>
      <circle cx={35} cy={35} r={r} fill="none" stroke="#1e293b" strokeWidth={6} />
      <circle cx={35} cy={35} r={r} fill="none" stroke={color} strokeWidth={6}
        strokeDasharray={`${filled} ${c}`} strokeLinecap="round"
        transform="rotate(-90 35 35)" />
      <text x={35} y={39} textAnchor="middle" fontSize={15} fontWeight={800} fill={color}>{score}</text>
    </svg>
  );
}

/* ─── Pick Card ──────────────────────────────────────────────────────────── */
function PickCard({ pick, fund, rank }) {
  const color = colorFor(fund?.category);
  const conv  = pick.conviction || 'MEDIUM';
  return (
    <div style={{
      background: 'var(--bg-card)', borderRadius: 14, padding: '18px 20px',
      border: `1px solid ${color}44`, borderTop: `3px solid ${color}`,
      position: 'relative',
    }}>
      {/* Rank badge */}
      <div style={{
        position: 'absolute', top: -1, right: 16, background: color,
        color: '#000', fontSize: 10, fontWeight: 900,
        padding: '2px 8px', borderRadius: '0 0 6px 6px',
      }}>#{rank} AI Pick</div>

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 12 }}>
        <ScoreRing score={pick.ai_score} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.3 }}>{pick.name}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 4, fontWeight: 700,
              background: `${color}18`, color, border: `1px solid ${color}30` }}>
              {fund?.category || 'Thematic'}
            </span>
            <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 4, fontWeight: 700,
              background: `${CONV_COLOR[conv]}18`, color: CONV_COLOR[conv] }}>
              {conv} Conviction
            </span>
          </div>
        </div>
        {/* Returns */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {fund?.return_1yr != null && (
            <div>
              <div style={{ fontSize: 18, fontWeight: 900, color: fund.return_1yr >= 0 ? '#22c55e' : '#ef4444' }}>
                {fund.return_1yr >= 0 ? '+' : ''}{fund.return_1yr}%
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>1yr return</div>
            </div>
          )}
          {fund?.return_3yr_cagr != null && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#a855f7' }}>
                {fund.return_3yr_cagr >= 0 ? '+' : ''}{fund.return_3yr_cagr}%
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>3yr CAGR</div>
            </div>
          )}
        </div>
      </div>

      {/* AI Thesis */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
          AI Investment Thesis
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{pick.thesis}</div>
      </div>

      {/* Risk + Ideal for */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ background: 'rgba(239,68,68,0.06)', borderRadius: 8, padding: '8px 10px', border: '1px solid rgba(239,68,68,0.15)' }}>
          <div style={{ fontSize: 9, color: '#ef4444', fontWeight: 700, marginBottom: 3 }}>⚠ KEY RISK</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{pick.risk}</div>
        </div>
        <div style={{ background: 'rgba(59,130,246,0.06)', borderRadius: 8, padding: '8px 10px', border: '1px solid rgba(59,130,246,0.15)' }}>
          <div style={{ fontSize: 9, color: '#3b82f6', fontWeight: 700, marginBottom: 3 }}>👤 IDEAL FOR</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{pick.ideal_for}</div>
        </div>
      </div>

      {/* NAV */}
      {fund?.nav && (
        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 10, color: '#475569' }}>Live NAV ₹{fund.nav} · {fund.nav_date}</span>
        </div>
      )}
    </div>
  );
}

/* ─── Performance Table ──────────────────────────────────────────────────── */
function PerformanceTable({ funds, aiPicks, aiAvoids }) {
  const [sort, setSort] = useState('return_1yr');
  const [asc, setAsc]   = useState(false);

  const pickCodes  = new Set((aiPicks  || []).map(p => p.code));
  const avoidCodes = new Set((aiAvoids || []).map(p => p.code));

  const sorted = [...funds].sort((a, b) => {
    const av = a[sort] ?? -999, bv = b[sort] ?? -999;
    return asc ? av - bv : bv - av;
  });

  const Th = ({ col, label }) => (
    <th onClick={() => sort === col ? setAsc(!asc) : setSort(col)} style={{
      padding: '9px 12px', cursor: 'pointer', whiteSpace: 'nowrap',
      color: sort === col ? 'var(--accent-blue)' : 'var(--text-muted)',
      fontWeight: 600, fontSize: 11, textAlign: 'right', userSelect: 'none',
    }}>{label}{sort === col ? (asc ? ' ▲' : ' ▼') : ''}</th>
  );

  return (
    <div className="table-container" style={{ borderRadius: 12 }}>
      <table style={{ fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ padding: '9px 12px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 11 }}>Fund</th>
            <th style={{ padding: '9px 12px', color: 'var(--text-muted)', fontWeight: 600, fontSize: 11 }}>Category</th>
            <Th col="nav" label="NAV ₹" />
            <Th col="return_1yr" label="1yr %" />
            <Th col="return_3yr_cagr" label="3yr CAGR" />
            <th style={{ padding: '9px 12px', color: 'var(--text-muted)', fontWeight: 600, fontSize: 11 }}>AI Signal</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((f, i) => {
            const isPick  = pickCodes.has(f.code);
            const isAvoid = avoidCodes.has(f.code);
            const c = colorFor(f.category);
            return (
              <tr key={f.code} style={{
                borderBottom: '1px solid var(--border-light)',
                background: isPick ? 'rgba(34,197,94,0.04)' : isAvoid ? 'rgba(239,68,68,0.04)' : '',
              }}>
                <td style={{ padding: '10px 12px' }}>
                  <div style={{ fontWeight: 700 }}>{f.name}</div>
                  <div style={{ fontSize: 10, color: '#475569' }}>{f.theme?.substring(0, 55)}</div>
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: `${c}18`, color: c, fontWeight: 700 }}>
                    {f.category}
                  </span>
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                  {f.nav ? `₹${f.nav}` : '—'}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700,
                  color: (f.return_1yr ?? 0) >= 20 ? '#22c55e' : (f.return_1yr ?? 0) >= 0 ? '#f59e0b' : '#ef4444' }}>
                  {f.return_1yr != null ? `${f.return_1yr >= 0 ? '+' : ''}${f.return_1yr}%` : '—'}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#a855f7' }}>
                  {f.return_3yr_cagr != null ? `${f.return_3yr_cagr >= 0 ? '+' : ''}${f.return_3yr_cagr}%` : '—'}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  {isPick
                    ? <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 5, background: '#22c55e18', color: '#22c55e', fontWeight: 700 }}>✓ AI Pick</span>
                    : isAvoid
                    ? <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 5, background: '#ef444418', color: '#ef4444', fontWeight: 700 }}>✗ Avoid</span>
                    : <span style={{ fontSize: 10, color: '#475569' }}>—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Returns Chart ──────────────────────────────────────────────────────── */
function ReturnsChart({ funds }) {
  const data = funds
    .filter(f => f.return_1yr != null)
    .sort((a, b) => (b.return_1yr ?? 0) - (a.return_1yr ?? 0))
    .slice(0, 12)
    .map(f => ({
      name: f.name.split(' ').slice(-2).join(' '),
      '1yr': f.return_1yr,
      '3yr CAGR': f.return_3yr_cagr,
      color: colorFor(f.category),
    }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 5, right: 10, bottom: 60, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
        <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `${v}%`} />
        <Tooltip
          formatter={(v, name) => [`${v}%`, name]}
          contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
        />
        <Bar dataKey="1yr" name="1yr Return" radius={[3, 3, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={d['1yr'] >= 20 ? '#22c55e' : d['1yr'] >= 0 ? '#f59e0b' : '#ef4444'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ─── Allocation Suggestion ──────────────────────────────────────────────── */
function AllocationCard({ title, text, icon }) {
  return (
    <div style={{ flex: 1, background: 'var(--bg-secondary)', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>{icon} {title}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>{text}</div>
    </div>
  );
}

/* ─── Main View ──────────────────────────────────────────────────────────── */
export default function AIMFDashboardView() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [tab, setTab]         = useState('picks');
  const [refreshing, setRefreshing] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    api.getAIMfPicks()
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  };

  const forceRefresh = async () => {
    setRefreshing(true);
    try {
      await api.refreshAIMfPicks();
      load();
    } catch {}
    setRefreshing(false);
  };

  useEffect(() => { load(); }, []);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: 400, gap: 16, color: 'var(--text-muted)' }}>
      <div className="spinner" style={{ width: 40, height: 40 }} />
      <div style={{ fontSize: 14 }}>AI analyzing 20 exclusive funds…</div>
      <div style={{ fontSize: 11 }}>Fetching live NAV from mfapi.in</div>
    </div>
  );

  if (error) return (
    <div style={{ textAlign: 'center', padding: 60, color: 'var(--accent-red)' }}>
      <div style={{ fontSize: 18, fontWeight: 700 }}>Failed to load</div>
      <div style={{ fontSize: 12, marginTop: 6 }}>{error}</div>
      <button onClick={load} style={{ marginTop: 16, padding: '8px 20px', borderRadius: 8, background: 'var(--accent-blue)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 700 }}>Retry</button>
    </div>
  );

  const { funds = [], ai_analysis = {}, fetched_at, ai_powered, total_scanned } = data || {};
  const picks   = ai_analysis?.top_picks  || [];
  const avoids  = ai_analysis?.avoid      || [];
  const alloc   = ai_analysis?.portfolio_allocation || {};

  // Map pick codes back to fund data
  const fundByCode = Object.fromEntries(funds.map(f => [f.code, f]));

  const TABS = [
    { id: 'picks',    label: `AI Top Picks (${picks.length})` },
    { id: 'all',      label: `All Funds (${funds.length})` },
    { id: 'returns',  label: 'Returns Chart' },
    { id: 'strategy', label: 'Strategy' },
  ];

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1400, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>AI MF Dashboard</h2>
            <span style={{ fontSize: 10, padding: '3px 9px', borderRadius: 12, fontWeight: 700,
              background: ai_powered ? 'rgba(168,85,247,0.15)' : 'rgba(245,158,11,0.15)',
              color: ai_powered ? '#a855f7' : '#f59e0b',
              border: `1px solid ${ai_powered ? '#a855f744' : '#f59e0b44'}` }}>
              {ai_powered ? '✦ Claude AI Powered' : '⚡ Rule-Based Analysis'}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {total_scanned} exclusive funds scanned · Live NAV from mfapi.in · Updated {fetched_at}
          </div>
        </div>
        <button onClick={forceRefresh} disabled={refreshing} style={{
          padding: '9px 18px', borderRadius: 9, border: 'none',
          background: refreshing ? 'var(--bg-secondary)' : '#a855f7',
          color: refreshing ? 'var(--text-muted)' : '#fff',
          cursor: refreshing ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 12,
        }}>
          {refreshing ? '↻ Refreshing…' : '↻ Refresh AI Analysis'}
        </button>
      </div>

      {/* ── Macro View ── */}
      {ai_analysis?.macro_view && (
        <div style={{ background: 'linear-gradient(135deg, rgba(168,85,247,0.08), rgba(59,130,246,0.08))',
          border: '1px solid rgba(168,85,247,0.25)', borderRadius: 12, padding: '14px 18px', marginBottom: 20 }}>
          <div style={{ fontSize: 10, color: '#a855f7', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            ✦ AI Market Context
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            {ai_analysis.macro_view}
          </div>
          {ai_analysis.rebalance_trigger && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#64748b' }}>
              <strong style={{ color: '#f59e0b' }}>Rebalance trigger:</strong> {ai_analysis.rebalance_trigger}
            </div>
          )}
        </div>
      )}

      {/* ── Summary Stats ── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        {[
          { label: 'Funds Analyzed', value: funds.length, color: '#3b82f6' },
          { label: 'AI Top Picks', value: picks.length, color: '#22c55e' },
          { label: 'Avoid List', value: avoids.length, color: '#ef4444' },
          { label: 'Avg 1yr Return', value: `${(funds.filter(f=>f.return_1yr!=null).reduce((s,f)=>s+(f.return_1yr||0),0)/Math.max(1,funds.filter(f=>f.return_1yr!=null).length)).toFixed(1)}%`, color: '#f59e0b' },
          { label: 'Best Fund Return', value: `+${Math.max(...funds.filter(f=>f.return_1yr!=null).map(f=>f.return_1yr||0)).toFixed(1)}%`, color: '#22c55e' },
        ].map(s => (
          <div key={s.label} style={{ flex: '1 1 120px', background: 'var(--bg-card)',
            borderRadius: 10, padding: '12px 16px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 5 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 16px', border: 'none', cursor: 'pointer',
            background: 'transparent', fontWeight: 700, fontSize: 12,
            color: tab === t.id ? '#a855f7' : 'var(--text-muted)',
            borderBottom: tab === t.id ? '2px solid #a855f7' : '2px solid transparent',
            marginBottom: -1,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── AI Top Picks Tab ── */}
      {tab === 'picks' && (
        <div>
          {picks.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 18, marginBottom: 24 }}>
              {picks.map((pick, i) => (
                <PickCard key={pick.code} pick={pick} fund={fundByCode[pick.code]} rank={i + 1} />
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              No AI picks generated yet.
            </div>
          )}

          {/* Avoid section */}
          {avoids.length > 0 && (
            <div style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 12, padding: '16px 20px' }}>
              <div style={{ fontWeight: 800, fontSize: 13, color: '#ef4444', marginBottom: 12 }}>
                ✗ AI Caution List — Avoid Currently
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                {avoids.map((a, i) => (
                  <div key={i} style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.06)',
                    border: '1px solid rgba(239,68,68,0.15)' }}>
                    <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>{a.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.reason}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── All Funds Tab ── */}
      {tab === 'all' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>All Exclusive Funds — Ranked by Return</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Sorted by 1yr return · Click columns to re-sort
            </div>
          </div>
          <PerformanceTable funds={funds} aiPicks={picks} aiAvoids={avoids} />
        </div>
      )}

      {/* ── Returns Chart Tab ── */}
      {tab === 'returns' && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 24px' }}>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 16 }}>1-Year Returns — Top 12 Exclusive Funds</div>
          <ReturnsChart funds={funds} />
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
            Green: &gt;20% · Yellow: 0-20% · Red: negative · Data from mfapi.in
          </div>
        </div>
      )}

      {/* ── Strategy Tab ── */}
      {tab === 'strategy' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Allocation suggestions */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 24px' }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 14 }}>AI Portfolio Allocation Guidance</div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <AllocationCard title="Aggressive Investor" icon="🚀" text={alloc.aggressive || '—'} />
              <AllocationCard title="Moderate Investor" icon="🎯" text={alloc.moderate || '—'} />
            </div>
          </div>

          {/* Fund themes map */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 24px' }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 14 }}>Theme Coverage Map</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
              {funds.map((f, i) => {
                const c = colorFor(f.category);
                const ret1 = f.return_1yr;
                return (
                  <div key={i} style={{ padding: '10px 14px', borderRadius: 9, background: 'var(--bg-secondary)',
                    borderLeft: `3px solid ${c}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 11, color: 'var(--text-primary)' }}>{f.name}</div>
                        <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: `${c}18`, color: c, fontWeight: 700 }}>
                          {f.category}
                        </span>
                      </div>
                      {ret1 != null && (
                        <span style={{ fontWeight: 800, fontSize: 13,
                          color: ret1 >= 20 ? '#22c55e' : ret1 >= 0 ? '#f59e0b' : '#ef4444', flexShrink: 0 }}>
                          {ret1 >= 0 ? '+' : ''}{ret1}%
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 9, color: '#475569', marginTop: 4, lineHeight: 1.4 }}>{f.theme}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Risk note */}
          <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)',
            borderRadius: 12, padding: '14px 18px', fontSize: 11, color: '#94a3b8', lineHeight: 1.7 }}>
            <strong style={{ color: '#f59e0b' }}>⚠ Important:</strong> Sectoral/thematic funds carry concentrated risk.
            They can outperform by 2-3x but also underperform significantly during sector downturns.
            Limit thematic exposure to 20-30% of equity portfolio. AI analysis is for research purposes only — not financial advice.
            {!ai_powered && (
              <div style={{ marginTop: 8, color: '#64748b' }}>
                Set <code style={{ background: '#0f172a', padding: '1px 5px', borderRadius: 3 }}>ANTHROPIC_API_KEY</code> environment variable to enable full Claude AI analysis.
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ fontSize: 10, color: '#334155', textAlign: 'center', marginTop: 24, lineHeight: 1.6 }}>
        NAV data: mfapi.in · Analysis: {ai_powered ? 'Claude claude-opus-4-6' : 'Rule-based scoring'} · Not financial advice · {fetched_at}
      </div>
    </div>
  );
}
