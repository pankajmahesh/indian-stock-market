import { useState, useEffect, useRef, useCallback } from 'react';
import ScreenshotButton from './ScreenshotButton';

const DIRECTION_CONFIG = {
  'BULLISH':  { bg: 'rgba(34,197,94,0.12)', color: '#22c55e' },
  'BEARISH':  { bg: 'rgba(239,68,68,0.12)', color: '#ef4444' },
  'SIDEWAYS': { bg: 'rgba(100,116,139,0.10)', color: '#94a3b8' },
};

const TREND_CONFIG = {
  'BULLISH': { color: '#22c55e' },
  'BEARISH': { color: '#ef4444' },
};

const MACD_CONFIG = {
  'BULLISH':     { color: '#22c55e', label: 'BULL' },
  'BEARISH':     { color: '#ef4444', label: 'BEAR' },
  'FADING_BULL': { color: '#eab308', label: 'FADE\u2191' },
  'FADING_BEAR': { color: '#eab308', label: 'FADE\u2193' },
  'NEUTRAL':     { color: '#64748b', label: 'FLAT' },
};

const REFRESH_INTERVALS = [
  { label: 'Off', value: 0 },
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
];

/**
 * Reusable index prediction view. Props:
 *   title       — Display title (e.g. "Nifty Midcap 150")
 *   description — Subtitle text
 *   apiGet      — () => Promise  — fetch saved predictions
 *   apiScan     — () => Promise  — start scan
 *   apiStatus   — () => Promise  — poll scan status
 *   apiLive     — () => Promise  — fetch live prices
 */
export default function IndexPredictionView({ title, description, apiGet, apiScan, apiStatus, apiLive }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState(null);
  const [sortCol, setSortCol] = useState('upside_30d_pct');
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch] = useState('');
  const [dirFilter, setDirFilter] = useState('ALL');
  const [expandedRow, setExpandedRow] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(60);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef(null);
  const refreshRef = useRef(null);
  const containerRef = useRef(null);

  const loadData = useCallback(() => {
    setLoading(true);
    apiGet()
      .then(d => {
        setData(Array.isArray(d) ? d : []);
        setLastUpdated(new Date().toLocaleTimeString());
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [apiGet]);

  const refreshLive = useCallback(() => {
    if (refreshing || scanning) return;
    setRefreshing(true);
    apiLive()
      .then(res => {
        if (res.data && Array.isArray(res.data)) {
          setData(res.data);
          setLastUpdated(res.updated_at || new Date().toLocaleTimeString());
        }
      })
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [refreshing, scanning, apiLive]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (refreshRef.current) clearInterval(refreshRef.current);
    if (autoRefresh > 0 && data && !scanning) {
      refreshRef.current = setInterval(refreshLive, autoRefresh * 1000);
    }
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [autoRefresh, data, scanning, refreshLive]);

  useEffect(() => {
    if (!scanning) return;
    pollRef.current = setInterval(() => {
      apiStatus().then(s => {
        setScanStatus(s);
        if (!s.running && s.status !== 'idle') {
          setScanning(false);
          clearInterval(pollRef.current);
          if (s.status === 'completed') loadData();
        }
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(pollRef.current);
  }, [scanning, apiStatus, loadData]);

  const startScan = () => {
    setScanning(true);
    setScanStatus({ running: true, status: 'starting', log_lines: [] });
    apiScan().catch(() => setScanning(false));
  };

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(col === 'symbol'); }
  };

  let rows = data || [];
  if (dirFilter !== 'ALL') rows = rows.filter(r => r.direction === dirFilter);
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

  const dirCounts = { BULLISH: 0, BEARISH: 0, SIDEWAYS: 0 };
  const inPortfolioCount = (data || []).filter(r => r.in_portfolio).length;
  const avgUpside30 = data && data.length > 0
    ? (data.reduce((s, r) => s + (r.upside_30d_pct || 0), 0) / data.length).toFixed(1)
    : '0';
  (data || []).forEach(r => {
    if (r.direction in dirCounts) dirCounts[r.direction]++;
  });

  return (
    <div ref={containerRef}>
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, flex: 1 }}>
            {title}
            {data && <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 400 }}> ({data.length} stocks)</span>}
          </h2>
          <button onClick={startScan} disabled={scanning}
            style={{
              padding: '8px 20px', borderRadius: 8, border: 'none',
              background: scanning ? '#334155' : '#3b82f6',
              color: 'white', fontWeight: 600, cursor: scanning ? 'wait' : 'pointer', fontSize: 13,
            }}>
            {scanning ? 'Scanning...' : `Scan ${title}`}
          </button>
          <ScreenshotButton targetRef={containerRef} filename={title.toLowerCase().replace(/\s+/g, '-')} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
          {description || `Scans all ${title} stocks with real-time CMP and price predictions (7/30/90 day targets).`}
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, marginTop: 12,
          padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 8,
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>Auto Refresh:</span>
          {REFRESH_INTERVALS.map(opt => (
            <button key={opt.value} onClick={() => setAutoRefresh(opt.value)}
              style={{
                padding: '3px 10px', borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 600,
                background: autoRefresh === opt.value ? '#3b82f6' : 'var(--bg-card)',
                color: autoRefresh === opt.value ? 'white' : 'var(--text-muted)',
                cursor: 'pointer',
              }}>
              {opt.label}
            </button>
          ))}
          <button onClick={refreshLive} disabled={refreshing || scanning || !data}
            style={{
              padding: '3px 12px', borderRadius: 6, border: '1px solid var(--border)',
              background: 'transparent', color: refreshing ? '#3b82f6' : 'var(--text-secondary)',
              cursor: refreshing ? 'wait' : 'pointer', fontSize: 11, fontWeight: 600, marginLeft: 4,
            }}>
            {refreshing ? 'Refreshing...' : 'Refresh Now'}
          </button>
          {lastUpdated && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {refreshing && <span style={{
                display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                background: '#3b82f6', marginRight: 6, animation: 'pulse 1s infinite',
              }} />}
              Last updated: {lastUpdated}
              {autoRefresh > 0 && ` (every ${autoRefresh}s)`}
            </span>
          )}
        </div>

        {scanning && scanStatus && (
          <div style={{ marginTop: 14, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 12 }}>
            <div style={{ marginBottom: 8, fontWeight: 600, color: '#3b82f6' }}>
              Status: {scanStatus.status}
            </div>
            <div style={{ maxHeight: 100, overflow: 'auto', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {(scanStatus.log_lines || []).map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>
        )}
      </div>

      {loading && <div className="loading"><div className="spinner" /> Loading {title} data...</div>}

      {!loading && !data && (
        <div className="empty-state">
          <h3>No {title} Data</h3>
          <p>Click "Scan {title}" to analyze all stocks with price predictions.</p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Requires cached price data from the screener pipeline.
          </p>
        </div>
      )}

      {!loading && data && data.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
            {Object.entries(dirCounts).map(([dir, count]) => {
              const cfg = DIRECTION_CONFIG[dir];
              const active = dirFilter === dir;
              return (
                <div key={dir} onClick={() => setDirFilter(active ? 'ALL' : dir)}
                  style={{
                    background: active ? cfg.bg : 'var(--bg-card)',
                    border: `1px solid ${active ? cfg.color : 'var(--border)'}`,
                    borderRadius: 10, padding: '12px 14px', cursor: 'pointer', textAlign: 'center',
                  }}>
                  <div style={{ fontSize: 10, color: cfg.color, fontWeight: 600, marginBottom: 2 }}>{dir}</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{count}</div>
                </div>
              );
            })}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#3b82f6', fontWeight: 600, marginBottom: 2 }}>AVG 30D UPSIDE</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: Number(avgUpside30) >= 0 ? '#22c55e' : '#ef4444' }}>{avgUpside30}%</div>
            </div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#22c55e', fontWeight: 600, marginBottom: 2 }}>IN PORTFOLIO</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{inPortfolioCount}</div>
            </div>
          </div>

          <div className="filter-bar">
            <input placeholder="Search symbol, name, sector..." value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, maxWidth: 300 }} />
            {dirFilter !== 'ALL' && (
              <button onClick={() => setDirFilter('ALL')}
                style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12 }}>
                Clear filter
              </button>
            )}
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Showing {rows.length} of {data.length}</span>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    {[
                      ['symbol', 'Symbol'], ['cmp', 'CMP (Live)'], ['change_pct', 'Chg %'],
                      ['market_cap_cr', 'MCap Cr'], ['promoter_holding_pct', 'Promoter %'],
                      ['target_7d', '7D Target'], ['upside_7d_pct', '7D %'],
                      ['target_30d', '30D Target'], ['upside_30d_pct', '30D %'],
                      ['target_90d', '90D Target'], ['upside_90d_pct', '90D %'],
                      ['direction', 'Direction'], ['confidence', 'Confidence'],
                      ['rsi', 'RSI'], ['adx', 'ADX'],
                      ['supertrend_signal', 'ST'],
                      ['ema_trend', 'EMA'],
                      ['macd_trend', 'MACD'], ['composite_score', 'Score'],
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
                        <td style={{ fontWeight: 600 }}>
                          {r.cmp != null ? `\u20B9${Number(r.cmp).toLocaleString('en-IN', { maximumFractionDigits: 1 })}` : 'N/A'}
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
                        <td style={{ fontSize: 12, fontFamily: 'monospace' }}>
                          {r.target_7d != null ? `\u20B9${Number(r.target_7d).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '--'}
                        </td>
                        <td><UpsideBadge val={r.upside_7d_pct} /></td>
                        <td style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600 }}>
                          {r.target_30d != null ? `\u20B9${Number(r.target_30d).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '--'}
                        </td>
                        <td><UpsideBadge val={r.upside_30d_pct} bold /></td>
                        <td style={{ fontSize: 12, fontFamily: 'monospace' }}>
                          {r.target_90d != null ? `\u20B9${Number(r.target_90d).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '--'}
                        </td>
                        <td><UpsideBadge val={r.upside_90d_pct} /></td>
                        <td><DirectionBadge dir={r.direction} /></td>
                        <td><ConfidenceMeter score={r.confidence} /></td>
                        <td><RSIBadge rsi={r.rsi} /></td>
                        <td>
                          {r.adx != null ? (
                            <span style={{ fontSize: 11, fontWeight: 600, color: r.adx > 25 ? '#22c55e' : r.adx > 20 ? '#eab308' : '#64748b' }}>
                              {r.adx.toFixed(0)}
                            </span>
                          ) : '--'}
                        </td>
                        <td>
                          {r.supertrend_signal ? (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: r.supertrend_signal === 'BUY' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', color: r.supertrend_signal === 'BUY' ? '#22c55e' : '#ef4444' }}>
                              {r.supertrend_signal}
                            </span>
                          ) : '--'}
                        </td>
                        <td>
                          {r.ema_trend && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: (TREND_CONFIG[r.ema_trend] || {}).color || '#94a3b8' }}>
                              {r.ema_trend}
                            </span>
                          )}
                        </td>
                        <td>
                          {r.macd_trend && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: (MACD_CONFIG[r.macd_trend] || {}).color || '#64748b' }}>
                              {(MACD_CONFIG[r.macd_trend] || {}).label || r.macd_trend}
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {r.composite_score != null ? r.composite_score.toFixed(1) : '--'}
                        </td>
                        <td>
                          {r.in_portfolio ? (
                            <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700, background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>YES</span>
                          ) : null}
                        </td>
                      </tr>,
                      isExpanded && (
                        <tr key={`${r.symbol}-detail`}>
                          <td colSpan={17} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
                            <PredictionDetail stock={r} />
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

function UpsideBadge({ val, bold }) {
  if (val == null) return <span style={{ color: '#64748b', fontSize: 11 }}>--</span>;
  const color = val > 3 ? '#22c55e' : val > 0 ? '#86efac' : val > -3 ? '#fbbf24' : '#ef4444';
  return (
    <span style={{ fontWeight: bold ? 700 : 600, fontSize: bold ? 13 : 12, color }}>
      {val > 0 ? '+' : ''}{val.toFixed(1)}%
    </span>
  );
}

function DirectionBadge({ dir }) {
  const cfg = DIRECTION_CONFIG[dir] || DIRECTION_CONFIG.SIDEWAYS;
  return (
    <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700, background: cfg.bg, color: cfg.color }}>
      {dir}
    </span>
  );
}

function ConfidenceMeter({ score }) {
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

function RSIBadge({ rsi }) {
  if (rsi == null) return <span style={{ color: '#64748b', fontSize: 11 }}>--</span>;
  let color = '#94a3b8';
  let label = '';
  if (rsi >= 70) { color = '#ef4444'; label = 'OB'; }
  else if (rsi <= 30) { color = '#22c55e'; label = 'OS'; }
  else if (rsi >= 60) { color = '#eab308'; }
  else if (rsi <= 40) { color = '#86efac'; }
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color }}>
      {rsi.toFixed(0)}{label && <span style={{ fontSize: 9, marginLeft: 2 }}>{label}</span>}
    </span>
  );
}

function PredictionDetail({ stock }) {
  const s = stock;
  const fmtPrice = v => v != null ? `\u20B9${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '--';
  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>
            {s.name}
            {s.algo_version && (
              <span style={{ fontSize: 9, marginLeft: 8, padding: '1px 6px', borderRadius: 4, background: 'rgba(59,130,246,0.15)', color: '#3b82f6', fontWeight: 600 }}>
                {s.algo_version}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.industry} | {s.sector}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <DirectionBadge dir={s.direction} />
          <ConfidenceMeter score={s.confidence} />
        </div>
      </div>

      <div style={{
        background: 'var(--bg-card)', borderRadius: 12, padding: 16, marginBottom: 16,
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>CMP (LIVE)</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtPrice(s.cmp)}</div>
          {s.volatility_ann != null && (
            <div style={{ fontSize: 9, color: '#64748b', marginTop: 4 }}>Vol: {s.volatility_ann}% ann.</div>
          )}
        </div>
        <TargetCard label="7-DAY TARGET" price={s.target_7d} upside={s.upside_7d_pct} low={s.target_7d_low} high={s.target_7d_high} />
        <TargetCard label="30-DAY TARGET" price={s.target_30d} upside={s.upside_30d_pct} low={s.target_30d_low} high={s.target_30d_high} highlight />
        <TargetCard label="90-DAY TARGET" price={s.target_90d} upside={s.upside_90d_pct} low={s.target_90d_low} high={s.target_90d_high} />
      </div>

      <div style={{
        background: 'var(--bg-card)', borderLeft: '3px solid #3b82f6',
        borderRadius: '0 8px 8px 0', padding: '12px 16px', marginBottom: 16, fontSize: 13,
      }}>
        <strong>Support: </strong>{fmtPrice(s.support)}
        <span style={{ margin: '0 16px', color: 'var(--text-muted)' }}>|</span>
        <strong>Resistance: </strong>{fmtPrice(s.resistance)}
        <span style={{ margin: '0 16px', color: 'var(--text-muted)' }}>|</span>
        <strong>BB Range: </strong>{fmtPrice(s.bb_lower)} - {fmtPrice(s.bb_upper)}
        <span style={{ margin: '0 16px', color: 'var(--text-muted)' }}>|</span>
        <strong>VWAP: </strong>{fmtPrice(s.vwap)}
        <span style={{ margin: '0 16px', color: 'var(--text-muted)' }}>|</span>
        <strong>Supertrend: </strong>{fmtPrice(s.supertrend)}
        {s.supertrend_signal && (
          <span style={{ marginLeft: 4, padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 700, background: s.supertrend_signal === 'BUY' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: s.supertrend_signal === 'BUY' ? '#22c55e' : '#ef4444' }}>
            {s.supertrend_signal}
          </span>
        )}
        {s.in_portfolio && <span style={{ marginLeft: 16, color: '#22c55e', fontWeight: 700 }}>[IN YOUR PORTFOLIO]</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
        {[
          ['EMA 20', s.ema_20, v => `\u20B9${v?.toLocaleString('en-IN')}`],
          ['EMA 50', s.ema_50, v => `\u20B9${v?.toLocaleString('en-IN')}`],
          ['EMA 200', s.ema_200, v => `\u20B9${v?.toLocaleString('en-IN')}`],
          ['EMA Trend', s.ema_trend, v => v],
          ['MACD', s.macd_trend, v => v],
          ['ADX', s.adx, v => `${v?.toFixed(0)} ${v > 25 ? '(Strong)' : v > 20 ? '(Mod)' : '(Weak)'}`],
          ['RSI (14)', s.rsi, v => v?.toFixed(1)],
          ['VWAP', s.vwap, v => `\u20B9${v?.toLocaleString('en-IN')}`],
          ['Supertrend', s.supertrend, v => `\u20B9${v?.toLocaleString('en-IN')}`],
          ['ST Signal', s.supertrend_signal, v => v],
          ['Volatility', s.volatility_ann, v => `${v?.toFixed(1)}% ann`],
          ['BB Width', s.bb_width_pct, v => `${v}%`],
          ['R\u00B2 (Fit)', s.r_squared, v => v?.toFixed(3)],
          ['Slope/Day', s.slope_pct_per_day, v => `${v > 0 ? '+' : ''}${v?.toFixed(3)}%`],
          ['Trend Str', s.trend_strength, v => `${v}/100`],
          ['Confidence', s.confidence, v => `${v}/100`],
          ['Composite', s.composite_score, v => v?.toFixed(1)],
          ['Fundamental', s.fundamental_score, v => v?.toFixed(1)],
          ['Technical', s.technical_score, v => v?.toFixed(1)],
          ['Comp Rank', s.composite_rank, v => `#${v}`],
          ['Algorithm', s.algo_version, v => v || 'v1'],
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

function TargetCard({ label, price, upside, highlight, low, high }) {
  const color = upside > 3 ? '#22c55e' : upside > 0 ? '#86efac' : upside > -3 ? '#fbbf24' : '#ef4444';
  const fmtP = v => v != null ? `\u20B9${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '--';
  return (
    <div style={{
      textAlign: 'center',
      background: highlight ? `${color}10` : 'transparent',
      borderRadius: 8, padding: '4px 0',
      border: highlight ? `1px solid ${color}40` : 'none',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: highlight ? 20 : 16, fontWeight: 700 }}>{fmtP(price)}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color, marginTop: 2 }}>
        {upside != null ? `${upside > 0 ? '+' : ''}${upside.toFixed(1)}%` : '--'}
      </div>
      {(low != null || high != null) && (
        <div style={{ fontSize: 9, color: '#64748b', marginTop: 3 }}>{fmtP(low)} — {fmtP(high)}</div>
      )}
    </div>
  );
}
