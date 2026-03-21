import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import ScreenshotButton from './ScreenshotButton';

const RISK_CONFIG = {
  'LOW':     { bg: 'rgba(34,197,94,0.15)', color: '#22c55e' },
  'MEDIUM':  { bg: 'rgba(234,179,8,0.15)',  color: '#eab308' },
  'HIGH':    { bg: 'rgba(239,68,68,0.15)',   color: '#ef4444' },
  'UNKNOWN': { bg: 'rgba(100,116,139,0.12)', color: '#64748b' },
};

const CAP_COLORS = {
  'Large Cap': '#3b82f6',
  'Mid Cap':   '#8b5cf6',
  'Small Cap': '#f97316',
};

export default function MultibaggerView() {
  const [data, setData] = useState(null);
  const [rebalance, setRebalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState(null);
  const [activeTab, setActiveTab] = useState('candidates');
  const [rebalPf, setRebalPf] = useState('main');
  const [sortCol, setSortCol] = useState('mb_rank');
  const [sortAsc, setSortAsc] = useState(true);
  const [search, setSearch] = useState('');
  const [capFilter, setCapFilter] = useState('ALL');
  const [expandedRow, setExpandedRow] = useState(null);
  const pollRef = useRef(null);
  const containerRef = useRef(null);

  const loadData = () => {
    setLoading(true);
    api.getMultibaggers()
      .then(d => setData(Array.isArray(d) ? d : []))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  const loadRebalance = (name) => {
    api.getRebalance(name)
      .then(setRebalance)
      .catch(() => setRebalance(null));
  };

  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (activeTab === 'rebalance') loadRebalance(rebalPf); }, [activeTab, rebalPf]);

  useEffect(() => {
    if (!scanning) return;
    pollRef.current = setInterval(() => {
      api.getMultibaggerStatus().then(s => {
        setScanStatus(s);
        if (!s.running && s.status !== 'idle') {
          setScanning(false);
          clearInterval(pollRef.current);
          if (s.status === 'completed') loadData();
        }
      }).catch(() => {});
    }, 3000);
    return () => clearInterval(pollRef.current);
  }, [scanning]);

  const startScan = (skipCache = false) => {
    setScanning(true);
    setScanStatus({ running: true, status: 'starting', log_lines: [] });
    api.scanMultibaggers(skipCache).catch(() => setScanning(false));
  };

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(col === 'mb_rank'); }
  };

  // Filter & sort candidates
  let rows = data || [];
  if (capFilter !== 'ALL') rows = rows.filter(r => r.cap_category === capFilter);
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(r =>
      (r.symbol || '').toLowerCase().includes(q) ||
      (r.name || '').toLowerCase().includes(q) ||
      (r.sector || '').toLowerCase().includes(q)
    );
  }
  rows = [...rows].sort((a, b) => {
    let va = a[sortCol], vb = b[sortCol];
    if (va == null) va = sortAsc ? Infinity : -Infinity;
    if (vb == null) vb = sortAsc ? Infinity : -Infinity;
    if (typeof va === 'string') return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    return sortAsc ? va - vb : vb - va;
  });

  // Stats
  const capCounts = { 'Large Cap': 0, 'Mid Cap': 0, 'Small Cap': 0 };
  const inPortfolioCount = (data || []).filter(r => r.in_portfolio).length;
  (data || []).forEach(r => { if (r.cap_category in capCounts) capCounts[r.cap_category]++; });

  return (
    <div ref={containerRef}>
      {/* Header */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, flex: 1 }}>
            Multibagger Screener
            {data && <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 400 }}> ({data.length} candidates)</span>}
          </h2>
          <button
            onClick={() => startScan(false)}
            disabled={scanning}
            style={{
              padding: '8px 20px', borderRadius: 8, border: 'none',
              background: scanning ? '#334155' : '#8b5cf6',
              color: 'white', fontWeight: 600, cursor: scanning ? 'wait' : 'pointer', fontSize: 13,
            }}
          >
            {scanning ? 'Screening...' : 'Screen Multibaggers'}
          </button>
          <button
            onClick={() => startScan(true)}
            disabled={scanning}
            style={{
              padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text-secondary)',
              cursor: scanning ? 'wait' : 'pointer', fontSize: 12,
            }}
          >
            Fresh Scan
          </button>
          <ScreenshotButton targetRef={containerRef} filename="multibagger-screener" />
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
          Screens the full NSE universe for high-growth, high-quality stocks with multibagger potential.
          Requires screener pipeline data — run the main pipeline first.
        </div>

        {scanning && scanStatus && (
          <div style={{ marginTop: 14, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 12 }}>
            <div style={{ marginBottom: 8, fontWeight: 600, color: '#8b5cf6' }}>
              Status: {scanStatus.status}
            </div>
            <div style={{ maxHeight: 120, overflow: 'auto', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {(scanStatus.log_lines || []).map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>
        )}
      </div>

      {/* Sub-tabs: Candidates | Rebalance */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        {[
          { id: 'candidates', label: 'Multibagger Candidates' },
          { id: 'rebalance', label: 'Portfolio Rebalance' },
        ].map(t => (
          <button key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '8px 20px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600,
              background: activeTab === t.id ? '#8b5cf6' : 'var(--bg-card)',
              color: activeTab === t.id ? 'white' : 'var(--text-secondary)',
              cursor: 'pointer',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Candidates Tab */}
      {activeTab === 'candidates' && (
        <>
          {loading && <div className="loading"><div className="spinner" /> Loading multibagger data...</div>}

          {!loading && !data && (
            <div className="empty-state">
              <h3>No Multibagger Data</h3>
              <p>Click "Screen Multibaggers" to scan the NSE universe for high-potential stocks.</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Make sure you've run the main screener pipeline first (Dashboard tab).
              </p>
            </div>
          )}

          {!loading && data && data.length > 0 && (
            <>
              {/* Summary cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
                {/* Cap category cards */}
                {Object.entries(capCounts).map(([cap, count]) => {
                  const active = capFilter === cap;
                  const color = CAP_COLORS[cap] || '#64748b';
                  return (
                    <div key={cap} onClick={() => setCapFilter(active ? 'ALL' : cap)}
                      style={{
                        background: active ? `${color}22` : 'var(--bg-card)',
                        border: `1px solid ${active ? color : 'var(--border)'}`,
                        borderRadius: 10, padding: '12px 14px', cursor: 'pointer', textAlign: 'center',
                      }}>
                      <div style={{ fontSize: 10, color, fontWeight: 600, marginBottom: 2 }}>{cap}</div>
                      <div style={{ fontSize: 22, fontWeight: 700 }}>{count}</div>
                    </div>
                  );
                })}
                <div style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 10, padding: '12px 14px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 10, color: '#22c55e', fontWeight: 600, marginBottom: 2 }}>ALREADY OWNED</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{inPortfolioCount}</div>
                </div>
              </div>

              {/* Search */}
              <div className="filter-bar">
                <input
                  placeholder="Search symbol, name, sector..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ flex: 1, maxWidth: 300 }}
                />
                {capFilter !== 'ALL' && (
                  <button onClick={() => setCapFilter('ALL')}
                    style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)',
                      background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12 }}>
                    Clear filter
                  </button>
                )}
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Showing {rows.length} of {data.length}
                </span>
              </div>

              {/* Table */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        {[
                          ['mb_rank', '#'],
                          ['symbol', 'Symbol'],
                          ['mb_score', 'MB Score'],
                          ['cmp', 'CMP'],
                          ['change_pct', 'Chg %'],
                          ['market_cap_cr', 'MCap Cr'],
                          ['promoter_holding_pct', 'Promoter %'],
                          ['cap_category', 'Cap'],
                          ['revenue_growth_pct', 'Rev Grw'],
                          ['earnings_growth_pct', 'Earn Grw'],
                          ['roe_pct', 'ROE'],
                          ['pe_ratio', 'P/E'],
                          ['risk_level', 'Risk'],
                          ['analyst_upside_pct', 'Upside'],
                          ['in_portfolio', 'Owned'],
                        ].map(([col, label]) => (
                          <th key={col} onClick={() => handleSort(col)}>
                            {label} {sortCol === col ? (sortAsc ? '\u2191' : '\u2193') : ''}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => {
                        const isExpanded = expandedRow === r.symbol;
                        return [
                          <tr key={r.symbol} className="clickable"
                            onClick={() => setExpandedRow(isExpanded ? null : r.symbol)}
                            style={{ borderBottom: isExpanded ? 'none' : undefined }}>
                            <td style={{ fontWeight: 700, color: '#8b5cf6' }}>{r.mb_rank}</td>
                            <td>
                              <div style={{ fontWeight: 600 }}>{r.symbol?.replace('.NS', '')}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.sector}</div>
                            </td>
                            <td>
                              <MBScoreBadge score={r.mb_score} />
                            </td>
                            <td style={{ fontWeight: 500 }}>
                              {r.cmp != null ? `\u20B9${Number(r.cmp).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : 'N/A'}
                            </td>
                            <td style={{ fontSize: 12, fontWeight: 600, color: (r.change_pct || 0) >= 0 ? '#22c55e' : '#ef4444' }}>
                              {r.change_pct != null ? `${r.change_pct >= 0 ? '+' : ''}${r.change_pct}%` : '--'}
                            </td>
                            <td style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                              {r.market_cap_cr != null ? `${(r.market_cap_cr / 1000).toFixed(0)}K` : '--'}
                            </td>
                            <td style={{ fontSize: 11 }}>
                              {r.promoter_holding_pct != null ? `${r.promoter_holding_pct}%` : '--'}
                            </td>
                            <td>
                              <span style={{
                                padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700,
                                color: CAP_COLORS[r.cap_category] || '#64748b',
                                background: `${CAP_COLORS[r.cap_category] || '#64748b'}18`,
                              }}>
                                {r.cap_category}
                              </span>
                            </td>
                            <td>
                              <GrowthCell val={r.revenue_growth_pct} />
                            </td>
                            <td>
                              <GrowthCell val={r.earnings_growth_pct} />
                            </td>
                            <td>
                              {r.roe_pct != null ? (
                                <span style={{ fontWeight: 600, fontSize: 12, color: r.roe_pct >= 15 ? '#22c55e' : r.roe_pct >= 8 ? '#eab308' : '#ef4444' }}>
                                  {r.roe_pct}%
                                </span>
                              ) : <span style={{ color: '#64748b', fontSize: 11 }}>--</span>}
                            </td>
                            <td style={{ fontSize: 12 }}>
                              {r.pe_ratio != null ? r.pe_ratio.toFixed(1) : '--'}
                            </td>
                            <td>
                              <span style={{
                                padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                                background: (RISK_CONFIG[r.risk_level] || RISK_CONFIG.UNKNOWN).bg,
                                color: (RISK_CONFIG[r.risk_level] || RISK_CONFIG.UNKNOWN).color,
                              }}>
                                {r.risk_level || '?'}
                              </span>
                            </td>
                            <td>
                              {r.analyst_upside_pct != null ? (
                                <span style={{
                                  fontWeight: 600, fontSize: 12,
                                  color: r.analyst_upside_pct >= 10 ? '#22c55e' : r.analyst_upside_pct >= 0 ? '#eab308' : '#ef4444',
                                }}>
                                  {r.analyst_upside_pct >= 0 ? '+' : ''}{r.analyst_upside_pct}%
                                </span>
                              ) : <span style={{ color: '#64748b', fontSize: 11 }}>--</span>}
                            </td>
                            <td>
                              {r.in_portfolio ? (
                                <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700, background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
                                  YES
                                </span>
                              ) : null}
                            </td>
                          </tr>,
                          isExpanded && (
                            <tr key={`${r.symbol}-detail`}>
                              <td colSpan={12} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
                                <CandidateDetail stock={r} />
                              </td>
                            </tr>
                          ),
                        ];
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* Rebalance Tab */}
      {activeTab === 'rebalance' && (
        <RebalanceView rebalance={rebalance} rebalPf={rebalPf} setRebalPf={setRebalPf} />
      )}
    </div>
  );
}

function MBScoreBadge({ score }) {
  if (score == null) return <span style={{ color: '#64748b', fontSize: 11 }}>--</span>;
  const color = score >= 70 ? '#22c55e' : score >= 50 ? '#eab308' : score >= 30 ? '#f97316' : '#ef4444';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 40, height: 6, background: 'var(--bg-secondary)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, score)}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color }}>{score.toFixed(0)}</span>
    </div>
  );
}

function GrowthCell({ val }) {
  if (val == null) return <span style={{ color: '#64748b', fontSize: 11 }}>--</span>;
  const color = val > 20 ? '#22c55e' : val > 0 ? '#eab308' : '#ef4444';
  return (
    <span style={{ fontWeight: 600, fontSize: 12, color }}>
      {val > 0 ? '+' : ''}{val}%
    </span>
  );
}

function CandidateDetail({ stock }) {
  const s = stock;
  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>{s.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.industry} | {s.sector} | {s.cap_category}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <MBScoreBadge score={s.mb_score} />
          {s.in_portfolio && (
            <div style={{ marginTop: 4, fontSize: 10, color: '#22c55e', fontWeight: 600 }}>ALREADY IN PORTFOLIO</div>
          )}
        </div>
      </div>

      {/* Buy rationale */}
      <div style={{
        background: 'var(--bg-card)', borderLeft: '3px solid #8b5cf6',
        borderRadius: '0 8px 8px 0', padding: '12px 16px', marginBottom: 16, fontSize: 13, lineHeight: 1.6,
      }}>
        <strong>Why Buy: </strong>{s.buy_rationale}
      </div>

      {/* Metrics grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
        {[
          ['P/E', s.pe_ratio, v => v?.toFixed(1)],
          ['P/B', s.pb_ratio, v => v?.toFixed(2)],
          ['PEG', s.peg_ratio, v => v?.toFixed(2)],
          ['EV/EBITDA', s.ev_to_ebitda, v => v?.toFixed(1)],
          ['ROE', s.roe_pct, v => `${v}%`],
          ['ROA', s.roa_pct, v => `${v}%`],
          ['Op Margin', s.operating_margin_pct, v => `${v}%`],
          ['D/E', s.debt_to_equity, v => v?.toFixed(1)],
          ['Cur Ratio', s.current_ratio, v => v?.toFixed(2)],
          ['Rev Growth', s.revenue_growth_pct, v => `${v > 0 ? '+' : ''}${v}%`],
          ['Earn Growth', s.earnings_growth_pct, v => `${v > 0 ? '+' : ''}${v}%`],
          ['FCF Cr', s.fcf_cr, v => v?.toLocaleString('en-IN')],
          ['MCap Cr', s.market_cap_cr, v => `${(v / 1000).toFixed(0)}K`],
          ['Risk Score', s.risk_score, v => `${v}/100`],
          ['Volatility', s.volatility_ann, v => `${v}%`],
          ['Max DD', s.max_drawdown_pct, v => `${v}%`],
          ['Target', s.target_price, v => `\u20B9${v?.toFixed(0)}`],
          ['From 52W High', s.pct_from_52w_high, v => `${v}%`],
        ].map(([label, val, fmt]) => (
          <div key={label} style={{ background: 'var(--bg-card)', borderRadius: 6, padding: '6px 8px' }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {val != null ? (fmt ? fmt(val) : val) : <span style={{ color: '#475569' }}>--</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RebalanceView({ rebalance, rebalPf, setRebalPf }) {
  if (!rebalance) {
    return (
      <div className="empty-state">
        <h3>Loading Rebalance Data...</h3>
        <p>Requires both screener pipeline and portfolio scan data.</p>
      </div>
    );
  }

  if (rebalance.error) {
    return (
      <div className="empty-state">
        <h3>Cannot Generate Suggestions</h3>
        <p>{rebalance.error}</p>
      </div>
    );
  }

  const { add, trim, keep } = rebalance;

  return (
    <div>
      {/* Portfolio selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['main', 'sharekhan'].map(pf => (
          <button key={pf} onClick={() => setRebalPf(pf)}
            style={{
              padding: '6px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: rebalPf === pf ? 'var(--accent-blue)' : 'var(--bg-card)',
              color: rebalPf === pf ? 'white' : 'var(--text-secondary)',
              border: 'none', cursor: 'pointer',
            }}>
            {pf === 'main' ? 'My Portfolio' : 'Sharekhan'}
          </button>
        ))}
        <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center', marginLeft: 8 }}>
          {rebalance.total_holdings} holdings
        </span>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 700, marginBottom: 4 }}>TRIM / EXIT</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{trim.length}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Weak holdings to reduce</div>
        </div>
        <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 700, marginBottom: 4 }}>ADD / BUY</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{add.length}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>New stocks to consider</div>
        </div>
        <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, color: '#3b82f6', fontWeight: 700, marginBottom: 4 }}>KEEP / ADD MORE</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{keep.length}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Strong holdings to maintain</div>
        </div>
      </div>

      {/* TRIM section */}
      {trim.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#ef4444' }}>
            Trim / Exit ({trim.length})
          </h3>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>CMP</th>
                  <th>Action</th>
                  <th>Risk</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {trim.map(s => (
                  <tr key={s.symbol}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{s.symbol}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{s.name}</div>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {s.cmp != null ? `\u20B9${Number(s.cmp).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '--'}
                    </td>
                    <td>
                      <span style={{
                        padding: '3px 10px', borderRadius: 12, fontWeight: 700, fontSize: 11,
                        background: s.action === 'EXIT' ? 'rgba(239,68,68,0.2)' : s.action === 'WATCH' ? 'rgba(234,179,8,0.15)' : 'rgba(249,115,22,0.15)',
                        color: s.action === 'EXIT' ? '#ef4444' : s.action === 'WATCH' ? '#eab308' : '#f97316',
                      }}>
                        {s.action}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                        background: (RISK_CONFIG[s.risk_level] || RISK_CONFIG.UNKNOWN).bg,
                        color: (RISK_CONFIG[s.risk_level] || RISK_CONFIG.UNKNOWN).color,
                      }}>
                        {s.risk_level} {s.risk_score != null ? s.risk_score : ''}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 350 }}>
                      {s.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ADD section */}
      {add.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#22c55e' }}>
            New Stocks to Buy ({add.length})
          </h3>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Sector</th>
                  <th>CMP</th>
                  <th>Score</th>
                  <th>Risk</th>
                  <th>Why Buy</th>
                </tr>
              </thead>
              <tbody>
                {add.map(s => (
                  <tr key={s.symbol}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{s.symbol}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{s.name}</div>
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.sector}</td>
                    <td style={{ fontSize: 12 }}>
                      {s.cmp != null ? `\u20B9${Number(s.cmp).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '--'}
                    </td>
                    <td>
                      <span style={{
                        padding: '2px 8px', borderRadius: 4, fontWeight: 700, fontSize: 12,
                        background: s.score >= 60 ? 'rgba(34,197,94,0.15)' : 'rgba(234,179,8,0.15)',
                        color: s.score >= 60 ? '#22c55e' : '#eab308',
                      }}>
                        {s.score}
                      </span>
                    </td>
                    <td>
                      {s.risk_level && (
                        <span style={{
                          padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                          background: (RISK_CONFIG[s.risk_level] || RISK_CONFIG.UNKNOWN).bg,
                          color: (RISK_CONFIG[s.risk_level] || RISK_CONFIG.UNKNOWN).color,
                        }}>
                          {s.risk_level}
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 350 }}>
                      {s.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* KEEP section */}
      {keep.length > 0 && (
        <div className="card">
          <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#3b82f6' }}>
            Strong Holdings ({keep.length})
          </h3>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>CMP</th>
                  <th>Action</th>
                  <th>Risk</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {keep.map(s => (
                  <tr key={s.symbol}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{s.symbol}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{s.name}</div>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {s.cmp != null ? `\u20B9${Number(s.cmp).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '--'}
                    </td>
                    <td>
                      <span style={{
                        padding: '3px 10px', borderRadius: 12, fontWeight: 700, fontSize: 11,
                        background: s.action === 'ADD MORE' ? 'rgba(34,197,94,0.2)' : 'rgba(59,130,246,0.15)',
                        color: s.action === 'ADD MORE' ? '#22c55e' : '#3b82f6',
                      }}>
                        {s.action}
                      </span>
                    </td>
                    <td>
                      {s.risk_level && (
                        <span style={{
                          padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                          background: (RISK_CONFIG[s.risk_level] || RISK_CONFIG.UNKNOWN).bg,
                          color: (RISK_CONFIG[s.risk_level] || RISK_CONFIG.UNKNOWN).color,
                        }}>
                          {s.risk_level}
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 350 }}>
                      {s.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
