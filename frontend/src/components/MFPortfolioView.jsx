/**
 * MF Portfolio Dashboard
 * Data sourced from user's Tickertape portfolio (mf.pdf)
 * Live NAV fetched from mfapi.in on load
 */
import { useState, useEffect, useMemo } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from 'recharts';

/* ─── Portfolio snapshot from Tickertape export ─────────────────────────── */
const PORTFOLIO_SUMMARY = {
  current_value:  5120098.66,
  invested:       3836000,
  total_pnl:      1284098,
  total_pnl_pct:  33.48,
  xirr:           9.77,
  day_pnl:        5534.46,
  day_pnl_pct:    0.02,
};

const HOLDINGS = [
  { code: '122639', name: 'Parag Parikh Flexi Cap Fund', short: 'PPFCF', plan: 'Direct · Growth',
    weight: 19.03, invested: 758000, units: 10984, pnl_pct: 28.5,  xirr: 11.67,
    category: 'Equity – Flexi Cap', color: '#22c55e', red_flags: 0 },

  { code: '148507', name: 'Sundaram Large Cap Fund', short: 'Sundaram LC', plan: 'Regular · Growth',
    weight: 14.86, invested: 620000, units: 38543, pnl_pct: 22.7,  xirr: 10.37,
    category: 'Equity – Large Cap', color: '#3b82f6', red_flags: 0 },

  { code: '146007', name: 'Tata Balanced Advantage Fund', short: 'Tata BAF', plan: 'Regular · Growth',
    weight: 7.94,  invested: 345000, units: 16283, pnl_pct: 17.6,  xirr: 9.55,
    category: 'Hybrid – Balanced Advantage', color: '#8b5cf6', red_flags: 2 },

  { code: '105758', name: 'HDFC Mid Cap Opportunities Fund', short: 'HDFC Midcap', plan: 'Regular · Growth',
    weight: 11.2,  invested: 490000, units: 22000, pnl_pct: 17.2,  xirr: 12.70,
    category: 'Equity – Mid Cap', color: '#f59e0b', red_flags: 0 },

  { code: '101762', name: 'HDFC Flexi Cap Fund', short: 'HDFC Flexi', plan: 'Regular · Growth',
    weight: 10.5,  invested: 460000, units: 31000, pnl_pct: 16.8,  xirr: 11.4,
    category: 'Equity – Flexi Cap', color: '#06b6d4', red_flags: 0 },

  { code: '114564', name: 'Axis Midcap Fund', short: 'Axis Midcap', plan: 'Regular · Growth',
    weight: 8.3,   invested: 380000, units: 9500,  pnl_pct: 11.8,  xirr: 13.80,
    category: 'Equity – Mid Cap', color: '#ec4899', red_flags: 6 },

  { code: '101065', name: 'Quant Mid Cap Fund', short: 'Quant Midcap', plan: 'Regular · Growth',
    weight: 6.5,   invested: 300000, units: 7200,  pnl_pct: -8.4,  xirr: -10.11,
    category: 'Equity – Mid Cap', color: '#ef4444', red_flags: 0 },

  { code: '127039', name: 'Motilal Oswal Midcap Fund', short: 'MOSL Midcap', plan: 'Regular · Growth',
    weight: 5.8,   invested: 265000, units: 6800,  pnl_pct: 9.4,   xirr: -11.34,
    category: 'Equity – Mid Cap', color: '#f97316', red_flags: 1 },

  { code: null, name: 'Others', short: 'Others', plan: '—',
    weight: 15.89, invested: 618000, units: null,  pnl_pct: 14.2,  xirr: 8.9,
    category: 'Mixed', color: '#64748b', red_flags: 0 },
];

/* Category & Sector breakdown from PDF */
const CAT_DATA = [
  { name: 'Equity',    value: 62.3,  color: '#22c55e' },
  { name: 'Hybrid',    value: 10.97, color: '#8b5cf6' },
  { name: 'Commodity', value: 7.74,  color: '#f59e0b' },
  { name: 'Debt',      value: 2.46,  color: '#3b82f6' },
  { name: 'Others',    value: 16.53, color: '#64748b' },
];

const SECTOR_DATA = [
  { name: 'Financials',             value: 53.08, color: '#3b82f6' },
  { name: 'Consumer Discretionary', value: 11.57, color: '#22c55e' },
  { name: 'Industrials',            value: 8.54,  color: '#f59e0b' },
  { name: 'Health Care',            value: 8.30,  color: '#ec4899' },
  { name: 'Info Technology',        value: 7.96,  color: '#06b6d4' },
  { name: 'Other Sectors',          value: 10.55, color: '#64748b' },
];

const RANKING_COMPARISON = {
  category: 'Equity – Mid Cap Fund',
  your_funds: [
    { name: 'HDFC Mid Cap', return_1y: 12.7,  rank: 9,  total: 34, beating: true  },
    { name: 'Axis Midcap',  return_1y: 13.80, rank: 18, total: 34, beating: false },
    { name: 'Quant Midcap', return_1y: -10.11,rank: 28, total: 34, beating: false },
  ],
  best_in_category: [
    { name: 'ICICI Pru Midcap',  return_1y: 23.11, rank: 1 },
    { name: 'HSBC Midcap',       return_1y: 20.70, rank: 2 },
    { name: 'Mirae Asset Midcap',return_1y: 17.08, rank: 3 },
  ],
};

const CAPITAL_GAINS = {
  stcg_equity: { redeemable: 753000,  gains: -13094,   tax: 0 },
  stcg_others: { redeemable: 527000,  gains: 1220,     tax: 38334 },
  ltcg_equity: { redeemable: 2735000, gains: 1119000,  tax: 150000 },
  ltcg_others: { redeemable: 103000,  gains: 37786,    tax: 5660 },
  total_gains: 1284374,
  total_tax:   194627,
  after_tax:   1083646,
};

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const fmt = (n) => `₹${Math.abs(n) >= 1e7
  ? `${(n / 1e7).toFixed(2)}Cr`
  : Math.abs(n) >= 1e5
    ? `${(n / 1e5).toFixed(2)}L`
    : n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const pct = (n, decimals = 2) => `${n >= 0 ? '+' : ''}${Number(n).toFixed(decimals)}%`;

/* ─── Summary Card ───────────────────────────────────────────────────────── */
function SummaryCard({ label, value, sub, color }) {
  return (
    <div style={{
      flex: '1 1 140px', minWidth: 130, background: 'var(--bg-card)',
      borderRadius: 12, padding: '14px 18px', border: '1px solid var(--border)',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 900, color: color || 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/* ─── Holdings Table ─────────────────────────────────────────────────────── */
function HoldingsTable({ holdings, navs, navLoading }) {
  const [sort, setSort] = useState('weight');
  const [asc, setAsc] = useState(false);

  const sorted = useMemo(() => {
    return [...holdings].sort((a, b) => {
      const av = a[sort] ?? 0, bv = b[sort] ?? 0;
      return asc ? av - bv : bv - av;
    });
  }, [holdings, sort, asc]);

  const Th = ({ col, label, right }) => (
    <th onClick={() => { sort === col ? setAsc(!asc) : setSort(col); }}
      style={{ padding: '10px 12px', textAlign: right ? 'right' : 'left', cursor: 'pointer',
        whiteSpace: 'nowrap', color: sort === col ? 'var(--accent-blue)' : 'var(--text-muted)',
        fontWeight: 600, fontSize: 11, userSelect: 'none' }}>
      {label}{sort === col ? (asc ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <div className="table-container" style={{ borderRadius: 12 }}>
      <table style={{ fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <Th col="name" label="Fund" />
            <Th col="category" label="Category" />
            <th style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600, fontSize: 11 }}>Live NAV</th>
            <Th col="weight" label="Weight %" right />
            <Th col="invested" label="Invested" right />
            <th style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600, fontSize: 11 }}>Curr. Value</th>
            <Th col="pnl_pct" label="P&L %" right />
            <Th col="xirr" label="XIRR" right />
            <th style={{ padding: '10px 12px', color: 'var(--text-muted)', fontWeight: 600, fontSize: 11 }}>Flags</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((h, i) => {
            const liveNav = h.code ? navs[h.code] : null;
            const currValue = (PORTFOLIO_SUMMARY.current_value * h.weight / 100);
            const gain = currValue - h.invested;
            const isGain = h.pnl_pct >= 0;
            const hasFlags = h.red_flags > 0;
            return (
              <tr key={i} style={{ borderBottom: '1px solid var(--border-light)',
                background: hasFlags ? 'rgba(239,68,68,0.03)' : '' }}>
                <td style={{ padding: '10px 12px' }}>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: h.color, display: 'inline-block', flexShrink: 0 }} />
                    {h.name}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, paddingLeft: 16 }}>{h.plan}</div>
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: `${h.color}18`, color: h.color, fontWeight: 600 }}>
                    {h.category}
                  </span>
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>
                  {navLoading ? <span style={{ color: '#475569' }}>…</span>
                    : liveNav ? <span style={{ color: '#22c55e' }}>₹{liveNav}</span>
                    : <span style={{ color: '#475569' }}>—</span>}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: h.color }}>
                  {h.weight}%
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-muted)' }}>
                  {fmt(h.invested)}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>
                  {fmt(currValue)}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: isGain ? '#22c55e' : '#ef4444' }}>
                  {pct(h.pnl_pct)}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: h.xirr >= 12 ? '#22c55e' : h.xirr >= 8 ? '#f59e0b' : '#ef4444' }}>
                  {h.xirr != null ? pct(h.xirr) : '—'}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  {h.red_flags > 0
                    ? <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: '#ef444418', color: '#ef4444', fontWeight: 700 }}>
                        ⚑ {h.red_flags}
                      </span>
                    : <span style={{ color: '#334155', fontSize: 11 }}>—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Allocation Bar ─────────────────────────────────────────────────────── */
function AllocationBar({ data }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div>
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginBottom: 10 }}>
        {data.map((d, i) => (
          <div key={i} style={{ width: `${d.value / total * 100}%`, background: d.color }} title={`${d.name}: ${d.value}%`} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color, display: 'inline-block' }} />
            <span style={{ color: 'var(--text-muted)' }}>{d.name}</span>
            <span style={{ fontWeight: 700, color: d.color }}>{d.value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Rankings ───────────────────────────────────────────────────────────── */
function RankingSection() {
  const { your_funds, best_in_category, category } = RANKING_COMPARISON;
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 24px' }}>
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>Ranking Analysis</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>{category}</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Your funds */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Your Funds</div>
          {your_funds.map((f, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 12px', borderRadius: 8, marginBottom: 6,
              background: f.beating ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
              border: `1px solid ${f.beating ? '#22c55e33' : '#ef444433'}` }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 12 }}>{f.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Rank {f.rank}/{f.total}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: f.return_1y >= 0 ? '#22c55e' : '#ef4444' }}>
                  {pct(f.return_1y)}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>1Y Return</div>
              </div>
            </div>
          ))}
        </div>

        {/* Best in category */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Best in Category</div>
          {best_in_category.map((f, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 12px', borderRadius: 8, marginBottom: 6,
              background: 'rgba(59,130,246,0.06)', border: '1px solid #3b82f633' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 12 }}>{f.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Rank #{f.rank}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: '#22c55e' }}>{pct(f.return_1y)}</div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>1Y Return</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Capital Gains ──────────────────────────────────────────────────────── */
function CapGainsSection() {
  const cg = CAPITAL_GAINS;
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 24px' }}>
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 16 }}>Capital Gains Tax Summary</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {[
          { label: 'Short Term (STCG)', gains: cg.stcg_equity.gains + cg.stcg_others.gains, tax: cg.stcg_equity.tax + cg.stcg_others.tax },
          { label: 'Long Term (LTCG)',  gains: cg.ltcg_equity.gains + cg.ltcg_others.gains, tax: cg.ltcg_equity.tax + cg.ltcg_others.tax },
        ].map((row, i) => (
          <div key={i} style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600 }}>{row.label}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Gains</span>
              <span style={{ fontWeight: 700, fontSize: 12, color: row.gains >= 0 ? '#22c55e' : '#ef4444' }}>
                {row.gains >= 0 ? '+' : ''}{fmt(row.gains)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Tax</span>
              <span style={{ fontWeight: 700, fontSize: 12, color: '#f59e0b' }}>{fmt(row.tax)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Total row */}
      <div style={{ display: 'flex', gap: 12 }}>
        {[
          { label: 'Total Gains', value: fmt(cg.total_gains), color: '#22c55e' },
          { label: 'Total Tax',   value: fmt(cg.total_tax),   color: '#ef4444' },
          { label: 'After-Tax Gains', value: fmt(cg.after_tax), color: '#a855f7' },
        ].map(t => (
          <div key={t.label} style={{ flex: 1, textAlign: 'center', padding: '10px 8px',
            borderRadius: 8, background: `${t.color}10`, border: `1px solid ${t.color}30` }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4 }}>{t.label}</div>
            <div style={{ fontWeight: 800, fontSize: 15, color: t.color }}>{t.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── SIP Calculator ─────────────────────────────────────────────────────── */
function SIPCalc() {
  const [sip, setSip] = useState(10000);
  const YEARS = [3, 5, 7, 10];
  const RATES = [{ r: 12, label: 'Conservative', color: '#94a3b8' }, { r: 18, label: 'Moderate', color: '#22c55e' }, { r: 25, label: 'Aggressive', color: '#a855f7' }];
  const fv = (m, r, y) => { const mr = r / 100 / 12, n = y * 12; return m * ((Math.pow(1 + mr, n) - 1) / mr) * (1 + mr); };

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 24px' }}>
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 16 }}>SIP Growth Projector</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Monthly SIP ₹
          <input type="number" value={sip} min={500} step={500}
            onChange={e => setSip(Math.max(500, +e.target.value))}
            style={{ marginLeft: 8, width: 100, padding: '5px 8px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--bg-secondary)',
              color: 'var(--text-primary)', fontSize: 12 }} />
        </label>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '7px 10px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>CAGR</th>
              {YEARS.map(y => <th key={y} style={{ textAlign: 'right', padding: '7px 10px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>{y}yr</th>)}
            </tr>
          </thead>
          <tbody>
            {RATES.map(({ r, label, color }) => (
              <tr key={r} style={{ borderBottom: '1px solid var(--border-light)' }}>
                <td style={{ padding: '9px 10px' }}>
                  <span style={{ fontWeight: 800, fontSize: 13, color }}>{r}%</span>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 6 }}>{label}</span>
                </td>
                {YEARS.map(y => {
                  const v = fv(sip, r, y);
                  const inv = sip * y * 12;
                  return (
                    <td key={y} style={{ padding: '9px 10px', textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, color }}>{v >= 1e7 ? `₹${(v / 1e7).toFixed(2)}Cr` : `₹${(v / 1e5).toFixed(1)}L`}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{(v / inv).toFixed(1)}x</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Main View ──────────────────────────────────────────────────────────── */
export default function MFPortfolioView() {
  const [navs, setNavs]             = useState({});
  const [navLoading, setNavLoading] = useState(true);
  const [activeTab, setActiveTab]   = useState('holdings');

  const s = PORTFOLIO_SUMMARY;
  const gain = s.total_pnl >= 0;

  useEffect(() => {
    const codes = HOLDINGS.filter(h => h.code).map(h => h.code);
    Promise.allSettled(codes.map(async code => {
      try {
        const res = await fetch(`https://api.mfapi.in/mf/${code}`);
        const json = await res.json();
        const nav = json?.data?.[0]?.nav;
        if (nav) return [code, parseFloat(nav).toFixed(2)];
      } catch {}
      return null;
    })).then(results => {
      const map = {};
      results.forEach(r => { if (r.status === 'fulfilled' && r.value) map[r.value[0]] = r.value[1]; });
      setNavs(map);
      setNavLoading(false);
    });
  }, []);

  const TABS = [
    { id: 'holdings',    label: 'Holdings' },
    { id: 'allocation',  label: 'Allocation' },
    { id: 'rankings',    label: 'Rankings' },
    { id: 'capgains',    label: 'Capital Gains' },
    { id: 'sip',         label: 'SIP Planner' },
  ];

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1400, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>MF Portfolio Dashboard</h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
              Pankaj · Tickertape · {HOLDINGS.filter(h => h.code).length} funds tracked · Live NAV via mfapi.in
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6,
              background: gain ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
              color: gain ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
              Day: {pct(s.day_pnl_pct)} ({gain ? '+' : ''}₹{s.day_pnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })})
            </span>
          </div>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <SummaryCard label="Current Value"   value={fmt(s.current_value)} />
          <SummaryCard label="Total Invested"  value={fmt(s.invested)} />
          <SummaryCard label="Total Gain"      value={`+${fmt(s.total_pnl)}`}
            sub={`+${s.total_pnl_pct}% overall`} color="#22c55e" />
          <SummaryCard label="XIRR"            value={`${s.xirr}%`}
            sub="vs category avg 10.03%" color={s.xirr >= 10 ? '#22c55e' : '#f59e0b'} />
          <SummaryCard label="Funds"           value={HOLDINGS.filter(h => h.code).length + '+'} />
        </div>
      </div>

      {/* ── XIRR vs Category bar ── */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
        padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#f59e0b' }}>{s.xirr}%</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Your XIRR</div>
        </div>
        <div style={{ fontSize: 18, color: '#334155' }}>vs</div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--text-secondary)' }}>10.03%</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Category Avg</div>
        </div>
        <div style={{ flex: 1, maxWidth: 320 }}>
          {[{ label: 'Your XIRR', val: s.xirr, color: '#f59e0b' }, { label: 'Category', val: 10.03, color: '#475569' }].map(b => (
            <div key={b.label} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 3, color: 'var(--text-muted)' }}>
                <span>{b.label}</span><span style={{ color: b.color, fontWeight: 700 }}>{b.val}%</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-secondary)' }}>
                <div style={{ height: '100%', borderRadius: 4, background: b.color, width: `${Math.min(b.val / 15 * 100, 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: '#f59e0b', background: 'rgba(245,158,11,0.1)',
          border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '8px 14px' }}>
          ⚠ Slightly below category average.<br />
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Consider swapping underperforming<br />mid-cap funds.</span>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding: '8px 16px', border: 'none', cursor: 'pointer',
            background: 'transparent', fontWeight: 700, fontSize: 12,
            color: activeTab === t.id ? 'var(--accent-blue)' : 'var(--text-muted)',
            borderBottom: activeTab === t.id ? '2px solid var(--accent-blue)' : '2px solid transparent',
            marginBottom: -1,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── Holdings Tab ── */}
      {activeTab === 'holdings' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>All Holdings</div>
            <span style={{ fontSize: 10, color: navLoading ? '#f59e0b' : '#22c55e' }}>
              {navLoading ? '⏳ Fetching live NAV…' : '● NAV live from mfapi.in'}
            </span>
          </div>
          <HoldingsTable holdings={HOLDINGS} navs={navs} navLoading={navLoading} />
        </div>
      )}

      {/* ── Allocation Tab ── */}
      {activeTab === 'allocation' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Category */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 24px' }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 16 }}>By Asset Class</div>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={CAT_DATA} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={2}>
                  {CAT_DATA.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip formatter={v => [`${v}%`, '']}
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
            <AllocationBar data={CAT_DATA} />
          </div>

          {/* Sector */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 24px' }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 16 }}>Equity – Sector Breakdown</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={SECTOR_DATA} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis type="number" domain={[0, 60]} tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `${v}%`} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <Tooltip formatter={v => [`${v}%`, 'Allocation']}
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {SECTOR_DATA.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Fund weight breakdown */}
          <div style={{ gridColumn: '1 / -1', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 24px' }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 14 }}>Fund Weight Distribution</div>
            <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', marginBottom: 12 }}>
              {HOLDINGS.map((h, i) => (
                <div key={i} style={{ width: `${h.weight}%`, background: h.color }}
                  title={`${h.short}: ${h.weight}%`} />
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
              {HOLDINGS.map((h, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '7px 10px', borderRadius: 7, background: 'var(--bg-secondary)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: h.color, display: 'inline-block' }} />
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{h.short}</span>
                  </div>
                  <span style={{ fontWeight: 700, color: h.color, fontSize: 12 }}>{h.weight}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Rankings Tab ── */}
      {activeTab === 'rankings' && <RankingSection />}

      {/* ── Capital Gains Tab ── */}
      {activeTab === 'capgains' && <CapGainsSection />}

      {/* ── SIP Tab ── */}
      {activeTab === 'sip' && <SIPCalc />}

      {/* Disclaimer */}
      <div style={{ fontSize: 10, color: '#334155', textAlign: 'center', marginTop: 20, lineHeight: 1.6 }}>
        Portfolio data sourced from Tickertape. NAV data from mfapi.in. Past returns ≠ future performance.
        Not financial advice. Invest after consulting your advisor.
      </div>
    </div>
  );
}
