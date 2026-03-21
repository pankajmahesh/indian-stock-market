import { useState, useEffect } from 'react';
import { api } from '../api';

const VERDICT_CFG = {
  'STRONG BUY':   { bg: 'rgba(34,197,94,0.20)',  color: '#22c55e', icon: '▲▲' },
  'PANIC BUY':    { bg: 'rgba(59,130,246,0.20)',  color: '#3b82f6', icon: '▲' },
  'ACCUMULATE':   { bg: 'rgba(74,222,128,0.15)',  color: '#4ade80', icon: '+' },
  'HOLD':         { bg: 'rgba(148,163,184,0.12)', color: '#94a3b8', icon: '=' },
  'WATCH':        { bg: 'rgba(234,179,8,0.15)',   color: '#eab308', icon: '◎' },
  'REDUCE':       { bg: 'rgba(249,115,22,0.18)',  color: '#f97316', icon: '▼' },
  'SELL':         { bg: 'rgba(239,68,68,0.20)',   color: '#ef4444', icon: '▼▼' },
};

const WAR_CFG = {
  'SAFE_HAVEN':   { color: '#22c55e', icon: '🛡' },
  'LOW':          { color: '#4ade80', icon: '✓' },
  'MEDIUM':       { color: '#eab308', icon: '⚠' },
  'HIGH':         { color: '#ef4444', icon: '✕' },
};

const BETA_CFG = {
  'LOW':          { color: '#22c55e' },
  'MEDIUM':       { color: '#eab308' },
  'HIGH':         { color: '#f97316' },
  'VERY_HIGH':    { color: '#ef4444' },
  'UNKNOWN':      { color: '#64748b' },
};

const ALPHA_CFG = {
  'STRONG':   { color: '#22c55e', label: 'STRONG' },
  'MODERATE': { color: '#4ade80', label: 'MODERATE' },
  'WEAK':     { color: '#eab308', label: 'WEAK' },
  'NONE':     { color: '#64748b', label: 'NONE' },
};

function VerdictBadge({ verdict }) {
  const cfg = VERDICT_CFG[verdict] || VERDICT_CFG['HOLD'];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '4px 12px', borderRadius: 20, fontWeight: 700, fontSize: 12,
      background: cfg.bg, color: cfg.color, whiteSpace: 'nowrap',
    }}>
      {cfg.icon} {verdict}
    </span>
  );
}

function MiniBar({ value, max = 100, color = '#3b82f6' }) {
  if (value == null) return <span style={{ color: '#64748b', fontSize: 11 }}>—</span>;
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 50, height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color }}>{Math.round(value)}</span>
    </div>
  );
}

function Pill({ text, color }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 10,
      fontSize: 11, fontWeight: 600, color,
      background: `${color}22`, border: `1px solid ${color}44`,
    }}>
      {text}
    </span>
  );
}

function SummaryCard({ label, value, color, sub }) {
  return (
    <div style={{
      background: 'var(--bg-secondary)', borderRadius: 12, padding: '16px 20px',
      border: '1px solid var(--border)', minWidth: 120,
    }}>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const SORT_COLS = [
  { key: 'verdict', label: 'Verdict' },
  { key: 'alpha_score', label: 'Alpha' },
  { key: 'panic_score', label: 'Panic' },
  { key: 'beta', label: 'Beta' },
  { key: 'fundamental_score', label: 'F.Score' },
];

const FILTER_OPTS = [
  { key: 'ALL', label: 'All' },
  { key: 'BUY', label: 'Buy' },
  { key: 'ACCUMULATE', label: 'Accumulate' },
  { key: 'HOLD', label: 'Hold' },
  { key: 'REDUCE', label: 'Reduce' },
  { key: 'SELL', label: 'Sell' },
];

const SOURCE_OPTS = [
  { key: 'portfolio:main',      label: 'Nuwama' },
  { key: 'portfolio:sharekhan', label: 'Sharekhan' },
  { key: 'top50',               label: 'Top 50 Screened' },
];

export default function DefenseModeView({ initialSource = 'portfolio:main', onSelectStock }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [source, setSource] = useState(initialSource);
  const [filter, setFilter] = useState('ALL');
  const [sortCol, setSortCol] = useState('verdict');
  const [sortAsc, setSortAsc] = useState(true);
  const [expandedRow, setExpandedRow] = useState(null);
  const [search, setSearch] = useState('');

  const load = (src) => {
    setLoading(true);
    setError(null);
    let params = {};
    if (src.startsWith('portfolio:')) {
      params.portfolio = src.split(':')[1];
    }
    // top50 = no params → backend uses composite_ranked top 50
    api.getDefenseMode(params)
      .then(d => setData(Array.isArray(d) ? d : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(source); }, [source]);

  // Summary stats
  const buys = data.filter(r => r.verdict === 'STRONG BUY' || r.verdict === 'PANIC BUY' || r.verdict === 'ACCUMULATE').length;
  const sells = data.filter(r => r.verdict === 'SELL' || r.verdict === 'REDUCE').length;
  const safeHavens = data.filter(r => r.is_safe_haven).length;
  const strongAlpha = data.filter(r => r.alpha_tier === 'STRONG').length;

  // Filter + sort
  const verdictGroup = (v) => {
    if (v === 'STRONG BUY' || v === 'PANIC BUY' || v === 'ACCUMULATE') return 'BUY';
    if (v === 'REDUCE' || v === 'SELL') return 'SELL';
    return v;
  };

  const VERDICT_SORT = { 'STRONG BUY': 0, 'PANIC BUY': 1, 'ACCUMULATE': 2, 'HOLD': 3, 'WATCH': 4, 'REDUCE': 5, 'SELL': 6 };

  let rows = [...data];
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(r =>
      (r.symbol || '').toLowerCase().includes(q) ||
      (r.name || '').toLowerCase().includes(q) ||
      (r.sector || '').toLowerCase().includes(q)
    );
  }
  if (filter !== 'ALL') {
    rows = rows.filter(r => verdictGroup(r.verdict) === filter || r.verdict === filter);
  }
  rows.sort((a, b) => {
    let va, vb;
    if (sortCol === 'verdict') {
      va = VERDICT_SORT[a.verdict] ?? 99;
      vb = VERDICT_SORT[b.verdict] ?? 99;
    } else {
      va = a[sortCol] ?? (sortAsc ? Infinity : -Infinity);
      vb = b[sortCol] ?? (sortAsc ? Infinity : -Infinity);
    }
    if (typeof va === 'string') return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    return sortAsc ? va - vb : vb - va;
  });

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  };

  const th = (label, col) => (
    <th
      onClick={() => handleSort(col)}
      style={{ cursor: 'pointer', whiteSpace: 'nowrap', padding: '10px 12px',
        color: sortCol === col ? '#60a5fa' : 'var(--text-secondary)',
        fontSize: 12, fontWeight: 700, textAlign: 'left', borderBottom: '1px solid var(--border)',
      }}
    >
      {label} {sortCol === col ? (sortAsc ? '▲' : '▼') : ''}
    </th>
  );

  return (
    <div className="card">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>🛡 Defense Mode & Alpha Discovery</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
            Beta risk · War/geo flags · Panic opportunities · 2–3Y alpha hunt
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SOURCE_OPTS.map(o => (
            <button
              key={o.key}
              onClick={() => setSource(o.key)}
              style={{
                padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)',
                background: source === o.key ? 'var(--accent-blue)' : 'transparent',
                color: source === o.key ? '#fff' : 'var(--text-secondary)',
                cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}
            >
              {o.label}
            </button>
          ))}
          <button
            onClick={() => load(source)}
            disabled={loading}
            style={{
              padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text-secondary)',
              cursor: loading ? 'wait' : 'pointer', fontSize: 12,
            }}
          >
            {loading ? '⟳ Scanning...' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {data.length > 0 && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <SummaryCard label="Buy / Accumulate" value={buys} color="#22c55e" sub="action items" />
          <SummaryCard label="Reduce / Sell" value={sells} color="#ef4444" sub="exit flags" />
          <SummaryCard label="Safe Havens" value={safeHavens} color="#3b82f6" sub="low geo-risk" />
          <SummaryCard label="Alpha Candidates" value={strongAlpha} color="#a855f7" sub="2-3Y compounders" />
        </div>
      )}

      {/* Rule legend */}
      <div style={{
        background: 'rgba(59,130,246,0.07)', borderRadius: 10, padding: '12px 16px',
        marginBottom: 20, display: 'flex', gap: 24, flexWrap: 'wrap',
        fontSize: 12, color: 'var(--text-secondary)',
        border: '1px solid rgba(59,130,246,0.2)',
      }}>
        <span><b style={{ color: '#60a5fa' }}>Rule 1 — Beta:</b> Avoid beta &gt;1.2 in uncertainty</span>
        <span><b style={{ color: '#22c55e' }}>Rule 2 — Panic:</b> Quality stocks, RSI &lt;35, oversold</span>
        <span><b style={{ color: '#f97316' }}>Rule 3 — War:</b> Flag oil/supply-chain exposed sectors</span>
        <span><b style={{ color: '#a855f7' }}>Rule 4 — Alpha:</b> ROE &gt;18%, FCF+, growth &gt;18%</span>
      </div>

      {/* Filters + search */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {FILTER_OPTS.map(o => (
          <button
            key={o.key}
            onClick={() => setFilter(o.key)}
            style={{
              padding: '5px 14px', borderRadius: 20, border: '1px solid var(--border)',
              background: filter === o.key ? 'var(--accent-blue)' : 'transparent',
              color: filter === o.key ? '#fff' : 'var(--text-secondary)',
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}
          >
            {o.label}
          </button>
        ))}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search symbol / sector..."
          style={{
            marginLeft: 'auto', padding: '6px 12px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--bg-secondary)',
            color: 'var(--text-primary)', fontSize: 13, minWidth: 200,
          }}
        />
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '12px 16px', color: '#fca5a5', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⟳</div>
          Fetching live data for each stock... this takes ~30 seconds
        </div>
      )}

      {/* Table */}
      {!loading && rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)' }}>
                {th('Stock', 'symbol')}
                {th('Sector', 'sector')}
                {th('Beta', 'beta')}
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700, textAlign: 'left', borderBottom: '1px solid var(--border)' }}>War Risk</th>
                {th('Panic Opp', 'panic_score')}
                {th('Alpha', 'alpha_score')}
                {th('F.Score', 'fundamental_score')}
                {th('Verdict', 'verdict')}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isExpanded = expandedRow === r.symbol;
                const betaCfg = BETA_CFG[r.beta_risk_level] || BETA_CFG['UNKNOWN'];
                const warCfg = WAR_CFG[r.war_risk_level] || WAR_CFG['LOW'];
                const alphaCfg = ALPHA_CFG[r.alpha_tier] || ALPHA_CFG['NONE'];
                return (
                  <>
                    <tr
                      key={r.symbol}
                      onClick={() => setExpandedRow(isExpanded ? null : r.symbol)}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                        cursor: 'pointer',
                      }}
                    >
                      {/* Stock */}
                      <td style={{ padding: '10px 12px' }}>
                        <div
                          style={{ fontWeight: 700, color: 'var(--accent-blue)', cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); onSelectStock && onSelectStock(r.symbol); }}
                        >
                          {r.symbol}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.name}
                        </div>
                        {r.cmp && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>₹{r.cmp.toLocaleString('en-IN')}</div>}
                      </td>
                      {/* Sector */}
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontSize: 12, maxWidth: 120 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sector}</div>
                      </td>
                      {/* Beta */}
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ color: betaCfg.color, fontWeight: 700, fontSize: 13 }}>
                          {r.beta != null ? r.beta.toFixed(2) : '—'}
                        </span>
                        <div style={{ fontSize: 10, color: betaCfg.color, marginTop: 2 }}>{r.beta_risk_level}</div>
                      </td>
                      {/* War Risk */}
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ color: warCfg.color, fontWeight: 600, fontSize: 13 }}>
                          {warCfg.icon} {r.war_risk_level}
                        </span>
                      </td>
                      {/* Panic Opportunity */}
                      <td style={{ padding: '10px 12px' }}>
                        {r.panic_opportunity
                          ? <span style={{ color: '#3b82f6', fontWeight: 700, fontSize: 12 }}>◉ YES ({r.panic_score})</span>
                          : <span style={{ color: '#64748b', fontSize: 12 }}>{r.panic_score ?? '—'}</span>
                        }
                      </td>
                      {/* Alpha */}
                      <td style={{ padding: '10px 12px' }}>
                        <MiniBar value={r.alpha_score} max={100} color={alphaCfg.color} />
                        <div style={{ fontSize: 10, color: alphaCfg.color, marginTop: 2 }}>{r.alpha_tier}</div>
                      </td>
                      {/* F.Score */}
                      <td style={{ padding: '10px 12px' }}>
                        <MiniBar value={r.fundamental_score} max={100} color="#60a5fa" />
                      </td>
                      {/* Verdict */}
                      <td style={{ padding: '10px 12px' }}>
                        <VerdictBadge verdict={r.verdict} />
                        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>{r.action}</div>
                      </td>
                    </tr>
                    {/* Expanded detail row */}
                    {isExpanded && (
                      <tr key={`${r.symbol}-detail`} style={{ background: 'rgba(59,130,246,0.04)' }}>
                        <td colSpan={8} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                            <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 12 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#60a5fa', marginBottom: 6 }}>RULE 1 — BETA RISK</div>
                              <Pill text={r.beta_risk_level} color={betaCfg.color} />
                              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>{r.beta_risk_reason}</p>
                            </div>
                            <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 12 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#f97316', marginBottom: 6 }}>RULE 3 — WAR / GEO RISK</div>
                              <Pill text={r.war_risk_level} color={warCfg.color} />
                              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>{r.war_risk_reason}</p>
                            </div>
                            <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 12 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#3b82f6', marginBottom: 6 }}>RULE 2 — PANIC OPPORTUNITY</div>
                              <Pill text={r.panic_opportunity ? `YES — Score ${r.panic_score}` : `NO — Score ${r.panic_score ?? 0}`} color={r.panic_opportunity ? '#3b82f6' : '#64748b'} />
                              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>{r.panic_reason}</p>
                            </div>
                            <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 12 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#a855f7', marginBottom: 6 }}>RULE 4 — ALPHA HUNT (2-3Y)</div>
                              <Pill text={`${r.alpha_tier} — Score ${r.alpha_score}`} color={alphaCfg.color} />
                              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>{r.alpha_reason}</p>
                            </div>
                            {(r.roe != null || r.trailing_pe != null || r.revenue_growth != null) && (
                              <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 12 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>FUNDAMENTALS</div>
                                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
                                  {r.roe != null && <span>ROE: <b style={{ color: '#4ade80' }}>{r.roe}%</b></span>}
                                  {r.trailing_pe != null && <span>P/E: <b>{r.trailing_pe}</b></span>}
                                  {r.revenue_growth != null && <span>Rev Growth: <b>{r.revenue_growth}%</b></span>}
                                  {r.rsi != null && <span>RSI: <b>{r.rsi}</b></span>}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && data.length > 0 && rows.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
          No stocks match the current filter.
        </div>
      )}

      {!loading && data.length === 0 && !error && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
          Select a source above to begin the defense mode scan.
        </div>
      )}
    </div>
  );
}
