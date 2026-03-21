import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import ScreenshotButton from './ScreenshotButton';

const STRENGTH_CONFIG = {
  'EXTREME': { bg: 'rgba(239,68,68,0.15)', color: '#ef4444', label: 'EXTREME' },
  'STRONG':  { bg: 'rgba(249,115,22,0.15)', color: '#f97316', label: 'STRONG' },
  'MODERATE':{ bg: 'rgba(234,179,8,0.12)',  color: '#eab308', label: 'MODERATE' },
};

const TYPE_CONFIG = {
  'BULLISH': { bg: 'rgba(34,197,94,0.12)', color: '#22c55e' },
  'BEARISH': { bg: 'rgba(239,68,68,0.12)', color: '#ef4444' },
  'NEUTRAL': { bg: 'rgba(100,116,139,0.10)', color: '#94a3b8' },
};

const VOL_REFRESH_INTERVALS = [
  { label: 'Off', value: 0 },
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
];

export default function VolumeBreakoutView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState(null);
  const [sortCol, setSortCol] = useState('volume_ratio');
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [strengthFilter, setStrengthFilter] = useState('ALL');
  const [expandedRow, setExpandedRow] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);
  const pollRef = useRef(null);
  const refreshRef = useRef(null);
  const containerRef = useRef(null);

  const loadData = () => {
    setLoading(true);
    api.getVolumeBreakouts()
      .then(d => {
        setData(Array.isArray(d) ? d : []);
        setLastUpdated(new Date().toLocaleTimeString());
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  const silentRefresh = () => {
    if (scanning) return;
    api.getVolumeBreakouts()
      .then(d => {
        if (Array.isArray(d)) { setData(d); setLastUpdated(new Date().toLocaleTimeString()); }
      })
      .catch(() => {});
  };

  useEffect(() => { loadData(); }, []);

  // Auto-refresh timer
  useEffect(() => {
    if (refreshRef.current) clearInterval(refreshRef.current);
    if (autoRefresh > 0 && data && !scanning) {
      refreshRef.current = setInterval(silentRefresh, autoRefresh * 1000);
    }
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [autoRefresh, data, scanning]);

  useEffect(() => {
    if (!scanning) return;
    pollRef.current = setInterval(() => {
      api.getVolumeBreakoutsStatus().then(s => {
        setScanStatus(s);
        if (!s.running && s.status !== 'idle') {
          setScanning(false);
          clearInterval(pollRef.current);
          if (s.status === 'completed') loadData();
        }
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(pollRef.current);
  }, [scanning]);

  const startScan = () => {
    setScanning(true);
    setScanStatus({ running: true, status: 'starting', log_lines: [] });
    api.scanVolumeBreakouts().catch(() => setScanning(false));
  };

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(col === 'symbol'); }
  };

  // Filter and sort
  let rows = data || [];
  if (typeFilter !== 'ALL') rows = rows.filter(r => r.breakout_type === typeFilter);
  if (strengthFilter !== 'ALL') rows = rows.filter(r => r.breakout_strength === strengthFilter);
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(r =>
      (r.symbol || '').toLowerCase().includes(q) ||
      (r.name || '').toLowerCase().includes(q) ||
      (r.sector || '').toLowerCase().includes(q) ||
      (r.pattern || '').toLowerCase().includes(q)
    );
  }
  rows = [...rows].sort((a, b) => {
    let va = a[sortCol], vb = b[sortCol];
    if (va == null) va = sortAsc ? Infinity : -Infinity;
    if (vb == null) vb = sortAsc ? Infinity : -Infinity;
    if (typeof va === 'string') return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    return sortAsc ? va - vb : vb - va;
  });

  // Summary counts
  const typeCounts = { BULLISH: 0, BEARISH: 0, NEUTRAL: 0 };
  const strengthCounts = { EXTREME: 0, STRONG: 0, MODERATE: 0 };
  const inPortfolioCount = (data || []).filter(r => r.in_portfolio).length;
  (data || []).forEach(r => {
    if (r.breakout_type in typeCounts) typeCounts[r.breakout_type]++;
    if (r.breakout_strength in strengthCounts) strengthCounts[r.breakout_strength]++;
  });

  return (
    <div ref={containerRef}>
      {/* Header */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, flex: 1 }}>
            Volume Breakouts
            {data && <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 400 }}> ({data.length} stocks)</span>}
          </h2>
          <button
            onClick={startScan}
            disabled={scanning}
            style={{
              padding: '8px 20px', borderRadius: 8, border: 'none',
              background: scanning ? '#334155' : '#f97316',
              color: 'white', fontWeight: 600, cursor: scanning ? 'wait' : 'pointer', fontSize: 13,
            }}
          >
            {scanning ? 'Scanning...' : 'Scan Breakouts'}
          </button>
          <ScreenshotButton targetRef={containerRef} filename="volume-breakouts" />
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
          Detects stocks with unusual volume spikes (1.5x+ avg) from cached price data. Fast scan, no API calls.
        </div>

        {/* Auto-refresh controls */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, marginTop: 12,
          padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 8,
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>Auto Refresh:</span>
          {VOL_REFRESH_INTERVALS.map(opt => (
            <button key={opt.value} onClick={() => setAutoRefresh(opt.value)}
              style={{
                padding: '3px 10px', borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 600,
                background: autoRefresh === opt.value ? '#f97316' : 'var(--bg-card)',
                color: autoRefresh === opt.value ? 'white' : 'var(--text-muted)',
                cursor: 'pointer',
              }}>
              {opt.label}
            </button>
          ))}
          <button onClick={silentRefresh} disabled={scanning || !data}
            style={{
              padding: '3px 12px', borderRadius: 6, border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text-secondary)',
              cursor: 'pointer', fontSize: 11, fontWeight: 600, marginLeft: 4,
            }}>
            Refresh Now
          </button>
          {lastUpdated && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              Updated: {lastUpdated}
              {autoRefresh > 0 && ` (every ${autoRefresh}s)`}
            </span>
          )}
        </div>

        {scanning && scanStatus && (
          <div style={{ marginTop: 14, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 12 }}>
            <div style={{ marginBottom: 8, fontWeight: 600, color: '#f97316' }}>
              Status: {scanStatus.status}
            </div>
            <div style={{ maxHeight: 100, overflow: 'auto', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {(scanStatus.log_lines || []).map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>
        )}
      </div>

      {loading && <div className="loading"><div className="spinner" /> Loading volume data...</div>}

      {!loading && !data && (
        <div className="empty-state">
          <h3>No Volume Breakout Data</h3>
          <p>Click "Scan Breakouts" to detect unusual volume activity across all stocks.</p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Requires cached price data from the screener pipeline.
          </p>
        </div>
      )}

      {!loading && data && data.length > 0 && (
        <>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            {/* Type cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, gridColumn: 'span 3' }}>
              {Object.entries(typeCounts).map(([type, count]) => {
                const cfg = TYPE_CONFIG[type];
                const active = typeFilter === type;
                return (
                  <div key={type} onClick={() => setTypeFilter(active ? 'ALL' : type)}
                    style={{
                      background: active ? cfg.bg : 'var(--bg-card)',
                      border: `1px solid ${active ? cfg.color : 'var(--border)'}`,
                      borderRadius: 10, padding: '12px 14px', cursor: 'pointer', textAlign: 'center',
                    }}>
                    <div style={{ fontSize: 10, color: cfg.color, fontWeight: 600, marginBottom: 2 }}>
                      {type}
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>{count}</div>
                  </div>
                );
              })}
            </div>
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '12px 14px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 10, color: '#22c55e', fontWeight: 600, marginBottom: 2 }}>IN PORTFOLIO</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{inPortfolioCount}</div>
            </div>
          </div>

          {/* Strength filter */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {['ALL', 'EXTREME', 'STRONG', 'MODERATE'].map(s => {
              const active = strengthFilter === s;
              const cfg = STRENGTH_CONFIG[s] || {};
              return (
                <button key={s} onClick={() => setStrengthFilter(s)}
                  style={{
                    padding: '5px 14px', borderRadius: 8, border: 'none', fontSize: 11, fontWeight: 600,
                    background: active ? (cfg.bg || 'var(--accent-blue)') : 'var(--bg-card)',
                    color: active ? (cfg.color || 'white') : 'var(--text-muted)',
                    cursor: 'pointer',
                  }}>
                  {s === 'ALL' ? `ALL (${data.length})` : `${s} (${strengthCounts[s] || 0})`}
                </button>
              );
            })}
          </div>

          {/* Search */}
          <div className="filter-bar">
            <input
              placeholder="Search symbol, name, sector, pattern..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, maxWidth: 300 }}
            />
            {(typeFilter !== 'ALL' || strengthFilter !== 'ALL') && (
              <button onClick={() => { setTypeFilter('ALL'); setStrengthFilter('ALL'); }}
                style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12 }}>
                Clear filters
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
                      ['symbol', 'Symbol'],
                      ['cmp', 'CMP'],
                      ['price_change_pct', 'Chg %'],
                      ['market_cap_cr', 'MCap Cr'],
                      ['promoter_holding_pct', 'Promoter %'],
                      ['volume_ratio', 'Vol Ratio'],
                      ['volume_today', 'Volume'],
                      ['breakout_type', 'Type'],
                      ['breakout_strength', 'Strength'],
                      ['pattern', 'Pattern'],
                      ['conviction', 'Conviction'],
                      ['price_change_5d_pct', '5D %'],
                      ['pct_from_52w_high', 'From High'],
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
                        <td>
                          <div style={{ fontWeight: 600 }}>{r.symbol?.replace('.NS', '')}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.sector}</div>
                        </td>
                        <td style={{ fontWeight: 500 }}>
                          {r.cmp != null ? `\u20B9${Number(r.cmp).toLocaleString('en-IN', { maximumFractionDigits: 1 })}` : 'N/A'}
                        </td>
                        <td>
                          <PriceChangeBadge val={r.price_change_pct} />
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          {r.market_cap_cr != null ? `${(r.market_cap_cr / 1000).toFixed(0)}K` : '--'}
                        </td>
                        <td style={{ fontSize: 11 }}>
                          {r.promoter_holding_pct != null ? `${r.promoter_holding_pct}%` : '--'}
                        </td>
                        <td>
                          <VolRatioBadge ratio={r.volume_ratio} />
                        </td>
                        <td style={{ fontSize: 11, fontFamily: 'monospace' }}>
                          {r.volume_today != null ? Number(r.volume_today).toLocaleString('en-IN') : '--'}
                        </td>
                        <td>
                          <TypeBadge type={r.breakout_type} />
                        </td>
                        <td>
                          <StrengthBadge strength={r.breakout_strength} />
                        </td>
                        <td style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
                          {r.pattern}
                        </td>
                        <td>
                          <ConvictionMeter score={r.conviction} />
                        </td>
                        <td>
                          <PriceChangeBadge val={r.price_change_5d_pct} />
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {r.pct_from_52w_high != null ? `${r.pct_from_52w_high}%` : '--'}
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
                            <BreakoutDetail stock={r} />
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
    </div>
  );
}

function VolRatioBadge({ ratio }) {
  if (ratio == null) return <span style={{ color: '#64748b' }}>--</span>;
  const color = ratio >= 4 ? '#ef4444' : ratio >= 2.5 ? '#f97316' : ratio >= 1.5 ? '#eab308' : '#64748b';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', borderRadius: 6, fontWeight: 700, fontSize: 13,
      background: `${color}1a`, color,
    }}>
      {ratio.toFixed(1)}x
    </span>
  );
}

function PriceChangeBadge({ val }) {
  if (val == null) return <span style={{ color: '#64748b', fontSize: 11 }}>--</span>;
  const color = val > 0 ? '#22c55e' : val < 0 ? '#ef4444' : '#94a3b8';
  return (
    <span style={{ fontWeight: 600, fontSize: 12, color }}>
      {val > 0 ? '+' : ''}{val.toFixed(1)}%
    </span>
  );
}

function TypeBadge({ type }) {
  const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.NEUTRAL;
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700,
      background: cfg.bg, color: cfg.color,
    }}>
      {type}
    </span>
  );
}

function StrengthBadge({ strength }) {
  const cfg = STRENGTH_CONFIG[strength] || STRENGTH_CONFIG.MODERATE;
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
      background: cfg.bg, color: cfg.color,
    }}>
      {cfg.label}
    </span>
  );
}

function ConvictionMeter({ score }) {
  if (score == null) return <span style={{ color: '#64748b', fontSize: 11 }}>--</span>;
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 70 ? '#22c55e' : pct >= 45 ? '#eab308' : '#64748b';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 40, height: 6, background: 'var(--bg-secondary)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color }}>{score}</span>
    </div>
  );
}

function BreakoutDetail({ stock }) {
  const s = stock;
  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>{s.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.industry} | {s.sector}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <VolRatioBadge ratio={s.volume_ratio} />
          <TypeBadge type={s.breakout_type} />
          <StrengthBadge strength={s.breakout_strength} />
        </div>
      </div>

      {/* Pattern callout */}
      <div style={{
        background: 'var(--bg-card)', borderLeft: '3px solid #f97316',
        borderRadius: '0 8px 8px 0', padding: '12px 16px', marginBottom: 16, fontSize: 13,
      }}>
        <strong>Pattern: </strong>{s.pattern}
        {s.in_portfolio && <span style={{ marginLeft: 12, color: '#22c55e', fontWeight: 700 }}>[IN YOUR PORTFOLIO]</span>}
      </div>

      {/* Volume metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
        {[
          ['Volume Today', s.volume_today, v => Number(v).toLocaleString('en-IN')],
          ['Avg Vol (20D)', s.avg_volume_20d, v => Number(v).toLocaleString('en-IN')],
          ['Avg Vol (5D)', s.avg_volume_5d, v => Number(v).toLocaleString('en-IN')],
          ['Vol Ratio', s.volume_ratio, v => `${v}x`],
          ['Vol Trend', s.vol_trend_ratio, v => `${v}x`],
          ['Conviction', s.conviction, v => `${v}/100`],
          ['Day Change', s.price_change_pct, v => `${v > 0 ? '+' : ''}${v}%`],
          ['5D Change', s.price_change_5d_pct, v => `${v > 0 ? '+' : ''}${v}%`],
          ['20D Change', s.price_change_20d_pct, v => `${v > 0 ? '+' : ''}${v}%`],
          ['From 52W High', s.pct_from_52w_high, v => `${v}%`],
          ['52W High', s['52w_high'], v => `\u20B9${v?.toFixed(0)}`],
          ['52W Low', s['52w_low'], v => `\u20B9${v?.toFixed(0)}`],
          ['MCap Cr', s.market_cap_cr, v => `${(v / 1000).toFixed(0)}K`],
          ['Composite', s.composite_score, v => v?.toFixed(1)],
          ['Fundamental', s.fundamental_score, v => v?.toFixed(1)],
          ['Comp Rank', s.composite_rank, v => `#${v}`],
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
