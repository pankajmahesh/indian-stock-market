import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';

function parseEntryZone(ez) {
  if (!ez) return null;
  const parts = String(ez).split('-').map(s => parseFloat(s.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return { low: parts[0], high: parts[1] };
  return null;
}
function inEntryZone(cmp, ez) { const p = parseEntryZone(ez); return p && cmp != null && cmp >= p.low && cmp <= p.high; }
function belowEntryZone(cmp, ez) { const p = parseEntryZone(ez); return p && cmp != null && cmp < p.low; }

function ScoreBadge({ value, max = 100, color }) {
  if (value == null || isNaN(value)) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>N/A</span>;
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
      <div style={{ width: 32, height: 5, borderRadius: 3, background: 'rgba(100,116,139,0.2)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: color || '#3b82f6' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color }}>{value.toFixed(1)}</span>
    </div>
  );
}

function MbScoreRing({ score, color, size = 44 }) {
  const pct = Math.min(100, Math.max(0, score));
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(100,116,139,0.15)" strokeWidth={4} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <span style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, color,
      }}>{score.toFixed(0)}</span>
    </div>
  );
}

const fmtP = (n) => (n == null || isNaN(n)) ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function India2030View() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState(null);
  const [activeTheme, setActiveTheme] = useState(0);
  const [sortKey, setSortKey] = useState('composite_score');
  const [sortAsc, setSortAsc] = useState(false);
  const [showOverview, setShowOverview] = useState(true);
  const [viewMode, setViewMode] = useState('picks'); // 'picks' | 'multibagger' | 'portfolio'
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const containerRef = useRef(null);
  const pollRef = useRef(null);
  const refreshRef = useRef(null);

  const loadData = useCallback(async () => {
    try {
      const res = await api.getIndia2030();
      if (res && res.themes) {
        setData(res);
      }
    } catch {
      // No data yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-trigger scan on first load if CMP data is missing
  const autoScanned = useRef(false);
  useEffect(() => {
    if (autoScanned.current || loading || !data?.themes?.length) return;
    const hasCmp = data.themes.some(t => t.stocks?.some(s => s.cmp != null));
    if (!hasCmp) {
      autoScanned.current = true;
      handleScan();
    }
  }, [loading, data]);

  // Poll scan status
  useEffect(() => {
    if (!scanning) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const s = await api.getIndia2030Status();
        setScanStatus(s);
        if (!s.running && s.status !== 'idle') {
          setScanning(false);
          if (s.status === 'done') loadData();
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [scanning, loadData]);

  const handleScan = async () => {
    // Check if a scan is already running before starting
    try {
      const st = await api.getIndia2030Status();
      if (st.running) {
        setScanning(true);
        setScanStatus(st);
        return; // Already running — just attach to polling
      }
    } catch { /* proceed with scan */ }
    try {
      await api.scanIndia2030();
      setScanning(true);
      setScanStatus({ running: true, status: 'scanning', log_lines: ['Starting...'] });
    } catch (e) {
      // 409 = scan already running, just attach to polling
      if (e.message?.includes('409')) {
        setScanning(true);
      }
    }
  };

  // Auto-refresh: reload data every 30 seconds (re-scan only if no scan running)
  useEffect(() => {
    if (refreshRef.current) clearInterval(refreshRef.current);
    if (!autoRefresh || scanning) return;
    refreshRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          loadData(); // Just reload data (picks up saved CMP from CSV)
          return 30;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [autoRefresh, scanning]);

  const handleSort = (key) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const themes = data?.themes || [];
  const theme = themes[activeTheme] || null;

  // Sort stocks in selected theme
  const sortedStocks = theme ? [...theme.stocks].sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return sortAsc ? -1 : 1;
    if (av > bv) return sortAsc ? 1 : -1;
    return 0;
  }) : [];

  // All multibagger picks across themes (for overview mode)
  const allMultibaggers = themes.flatMap(t =>
    (t.multibaggers || []).map(s => ({ ...s, _themeTitle: t.title, _themeColor: t.color }))
  );

  return (
    <div className="predict-view" ref={containerRef}>
      {/* Header */}
      <div className="card" style={{
        background: 'linear-gradient(135deg, var(--bg-card) 0%, rgba(30, 34, 53, 0.95) 100%)',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: -80, right: -80, width: 260, height: 260,
          background: viewMode === 'portfolio'
            ? 'radial-gradient(circle, rgba(34,197,94,0.08) 0%, transparent 70%)'
            : viewMode === 'multibagger'
              ? 'radial-gradient(circle, rgba(245,158,11,0.08) 0%, transparent 70%)'
              : 'radial-gradient(circle, rgba(59,130,246,0.06) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, position: 'relative' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
              India 2030 Strategy
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                background: viewMode === 'portfolio'
                  ? 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(6,182,212,0.15))'
                  : viewMode === 'multibagger'
                    ? 'linear-gradient(135deg, rgba(245,158,11,0.2), rgba(239,68,68,0.15))'
                    : 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.15))',
                color: viewMode === 'portfolio' ? '#22c55e' : viewMode === 'multibagger' ? '#f59e0b' : '#a78bfa',
                letterSpacing: 0.5,
              }}>{viewMode === 'portfolio' ? '2-3 YR PORTFOLIO' : viewMode === 'multibagger' ? 'MULTIBAGGER PICKS' : 'MACRO THEMATIC'}</span>
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: '4px 0 0' }}>
              {viewMode === 'portfolio'
                ? 'Diversified portfolio built from multibagger picks across all 10 themes — tiered by risk for a 2-3 year compounding horizon.'
                : viewMode === 'multibagger'
                  ? '1-5 high-conviction picks per theme — ranked by quarterly growth, momentum & relative strength. High risk, high reward.'
                  : '10 mega-themes shaping India\'s next decade — top stock picks from Midcap 150, LargeMidcap 250 & Smallcap 250.'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="scan-btn" onClick={() => { handleScan(); setCountdown(30); }} disabled={scanning}
              style={{ padding: '8px 16px', fontSize: 12 }}>
              {scanning ? 'Scanning...' : 'Refresh Live Prices'}
            </button>
            <button onClick={() => { setAutoRefresh(a => !a); setCountdown(30); }}
              style={{
                padding: '6px 14px', borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 600,
                background: autoRefresh ? 'rgba(34,197,94,0.15)' : 'var(--bg-secondary)',
                color: autoRefresh ? '#22c55e' : 'var(--text-muted)', cursor: 'pointer',
              }}>
              Auto {autoRefresh ? 'ON' : 'OFF'}
            </button>
            {autoRefresh && !scanning && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {countdown}s
              </span>
            )}
          </div>
        </div>
        {data && (
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-secondary)', marginTop: 8, alignItems: 'center' }}>
            <span>Themes: <strong style={{ color: 'var(--text-primary)' }}>{themes.length}</strong></span>
            <span>Index Universe: <strong style={{ color: 'var(--text-primary)' }}>{data.totalIndexStocks || '~500'}</strong> stocks</span>
            {viewMode === 'portfolio'
              ? <span>Portfolio Stocks: <strong style={{ color: '#22c55e' }}>{data.prospectivePortfolio?.totalStocks || 0}</strong> / {data.prospectivePortfolio?.totalCandidates || 0} candidates</span>
              : viewMode === 'multibagger'
                ? <span>Multibagger Picks: <strong style={{ color: '#f59e0b' }}>{allMultibaggers.length}</strong></span>
                : <span>Total Matches: <strong style={{ color: '#3b82f6' }}>{themes.reduce((s, t) => s + t.matchCount, 0)}</strong></span>
            }
          </div>
        )}
      </div>

      {/* View mode toggle */}
      {themes.length > 0 && (
        <div className="val-tabs" style={{ marginBottom: 0 }}>
          <button className={`val-tab${viewMode === 'picks' ? ' active' : ''}`}
            onClick={() => { setViewMode('picks'); setShowOverview(true); }}
            style={{ padding: '8px 16px', fontSize: 12 }}>
            <span className="tab-dot" style={{ background: '#3b82f6' }} />
            Top Picks
          </button>
          <button className={`val-tab${viewMode === 'multibagger' ? ' active' : ''}`}
            onClick={() => { setViewMode('multibagger'); setShowOverview(true); }}
            style={{ padding: '8px 16px', fontSize: 12 }}>
            <span className="tab-dot" style={{ background: '#f59e0b' }} />
            Multibagger Picks
          </button>
          <button className={`val-tab${viewMode === 'portfolio' ? ' active' : ''}`}
            onClick={() => setViewMode('portfolio')}
            style={{ padding: '8px 16px', fontSize: 12 }}>
            <span className="tab-dot" style={{ background: '#22c55e' }} />
            Prospective Portfolio
          </button>
        </div>
      )}

      {/* Scan progress */}
      {scanning && scanStatus && (
        <div className="card" style={{ borderLeft: '4px solid var(--accent-blue)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            Refreshing live prices... ({scanStatus.status})
          </div>
          <div style={{
            maxHeight: 120, overflowY: 'auto', fontSize: 11, fontFamily: 'monospace',
            background: 'rgba(15,23,42,0.5)', borderRadius: 6, padding: 8,
          }}>
            {(scanStatus.log_lines || []).map((line, i) => (
              <div key={i} style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>{line}</div>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'var(--text-secondary)' }}>Loading India 2030 Strategy data...</p>
        </div>
      )}

      {/* No data */}
      {!loading && !data && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <h3 style={{ fontSize: 16, color: 'var(--text-secondary)', marginBottom: 8 }}>No composite data found</h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Run the main pipeline scan first to generate composite_ranked.csv, then revisit this page.
          </p>
        </div>
      )}

      {/* =============== TOP PICKS MODE =============== */}
      {viewMode === 'picks' && themes.length > 0 && (
        <>
          {/* Theme tabs */}
          <div className="val-tabs" style={{ overflowX: 'auto', flexWrap: 'nowrap' }}>
            {themes.map((t, i) => (
              <button key={t.id} className={`val-tab${!showOverview && activeTheme === i ? ' active' : ''}`}
                onClick={() => { setActiveTheme(i); setShowOverview(false); }}
                style={{ padding: '8px 14px', fontSize: 11, whiteSpace: 'nowrap', minWidth: 'fit-content' }}>
                <span className="tab-dot" style={{ background: t.color }} />
                {t.title.length > 20 ? t.title.split(' ').slice(0, 3).join(' ') : t.title}
              </button>
            ))}
            <button className={`val-tab${showOverview ? ' active' : ''}`}
              onClick={() => setShowOverview(true)}
              style={{ padding: '8px 14px', fontSize: 11, whiteSpace: 'nowrap', minWidth: 'fit-content', marginLeft: 'auto' }}>
              <span className="tab-dot" style={{ background: '#64748b' }} />
              Overview
            </button>
          </div>

          {/* Overview grid */}
          {showOverview && (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12,
              marginTop: 4,
            }}>
              {themes.map((t, i) => (
                <div key={t.id} className="card" onClick={() => { setActiveTheme(i); setShowOverview(false); }}
                  style={{
                    cursor: 'pointer', borderLeft: `4px solid ${t.color}`,
                    transition: 'transform 0.15s, box-shadow 0.15s',
                    padding: '14px 16px',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 6px 20px -4px ${t.color}33`; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%', background: t.color,
                      boxShadow: `0 0 8px ${t.color}66`,
                    }} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{t.title}</span>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '0 0 8px', lineHeight: 1.4 }}>
                    {t.subtitle}
                  </p>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Matches: <strong style={{ color: t.color }}>{t.matchCount}</strong></span>
                    <span style={{ color: 'var(--text-muted)' }}>Top Picks: <strong style={{ color: 'var(--text-primary)' }}>{t.stocks.length}</strong></span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Selected theme detail */}
          {!showOverview && theme && (
            <>
              {/* Research card */}
              <div className="card" style={{
                borderLeft: `4px solid ${theme.color}`,
                position: 'relative', overflow: 'hidden',
              }}>
                <div style={{
                  position: 'absolute', top: -40, right: -40, width: 160, height: 160,
                  background: `radial-gradient(circle, ${theme.color}08 0%, transparent 70%)`,
                  pointerEvents: 'none',
                }} />
                <h3 style={{
                  margin: '0 0 4px', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%', background: theme.color,
                    boxShadow: `0 0 10px ${theme.color}66`,
                  }} />
                  {theme.title}
                </h3>
                <p style={{ fontSize: 12, color: theme.color, margin: '0 0 12px', fontWeight: 500 }}>
                  {theme.subtitle}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {theme.research.map((point, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12, lineHeight: 1.55 }}>
                      <span style={{
                        flex: 'none', width: 22, height: 22, borderRadius: '50%',
                        background: `${theme.color}18`, color: theme.color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, marginTop: 1,
                      }}>{i + 1}</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{point}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stock picks table */}
              {sortedStocks.length > 0 ? (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{
                    padding: '12px 16px', borderBottom: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      Top {sortedStocks.length} Stock Picks
                      <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8, fontSize: 11 }}>
                        ranked by composite score from screener
                      </span>
                    </span>
                    <span style={{
                      fontSize: 10, padding: '3px 10px', borderRadius: 12,
                      background: `${theme.color}15`, color: theme.color, fontWeight: 600,
                    }}>
                      {theme.matchCount} total matches
                    </span>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr>
                          {[
                            { key: 'rank', label: '#', w: 36 },
                            { key: 'symbol', label: 'Symbol / Name', align: 'left' },
                            { key: 'industry', label: 'Industry', align: 'left' },
                            { key: 'entry_zone', label: 'Entry Zone' },
                            { key: 'cmp', label: 'CMP' },
                            { key: 'composite_score', label: 'Composite' },
                            { key: 'fundamental_score', label: 'Fundamental' },
                            { key: 'technical_score', label: 'Technical' },
                            { key: 'roe', label: 'ROE %' },
                            { key: 'pe_ratio', label: 'P/E' },
                            { key: 'debt_to_equity', label: 'D/E' },
                            { key: 'red_flag_status', label: 'Flags' },
                          ].map(col => (
                            <th key={col.key}
                              onClick={() => col.key !== 'rank' && handleSort(col.key)}
                              style={{
                                padding: '10px 8px', textAlign: col.align || 'center',
                                fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
                                background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border)',
                                cursor: col.key !== 'rank' ? 'pointer' : 'default',
                                whiteSpace: 'nowrap', width: col.w, userSelect: 'none',
                              }}>
                              {col.label}
                              {sortKey === col.key && <span style={{ marginLeft: 3, fontSize: 10 }}>{sortAsc ? '▲' : '▼'}</span>}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedStocks.map((row, idx) => {
                          const roe = parseFloat(row.roe);
                          const pe = parseFloat(row.pe_ratio);
                          const de = parseFloat(row.debt_to_equity);
                          const flagOk = row.red_flag_status === 'PASS' || row.red_flag_status === 'Pass';
                          const isIn = inEntryZone(row.cmp, row.entry_zone);
                          const isBelow = belowEntryZone(row.cmp, row.entry_zone);
                          return (
                            <tr key={row.symbol}
                              style={{
                                borderBottom: '1px solid var(--border)', transition: 'background 0.15s',
                                ...(isIn ? { background: 'rgba(34,197,94,0.05)', borderLeft: '3px solid #22c55e' } : isBelow ? { borderLeft: '3px solid #3b82f6' } : {}),
                              }}
                              onMouseEnter={e => e.currentTarget.style.background = isIn ? 'rgba(34,197,94,0.1)' : 'var(--bg-hover)'}
                              onMouseLeave={e => e.currentTarget.style.background = isIn ? 'rgba(34,197,94,0.05)' : 'transparent'}>
                              <td style={{ padding: '8px', textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
                                {idx + 1}
                              </td>
                              <td style={{ padding: '8px', textAlign: 'left' }}>
                                <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                                  {(row.symbol || '').replace('.NS', '')}
                                  {isIn && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#22c55e22', color: '#22c55e' }}>IN ZONE</span>}
                                  {isBelow && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#3b82f622', color: '#3b82f6' }}>BELOW</span>}
                                </div>
                                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>{row.name}</div>
                              </td>
                              <td style={{ padding: '8px', textAlign: 'left', fontSize: 11, color: 'var(--text-secondary)', maxWidth: 140 }}>
                                {row.industry}
                              </td>
                              <td style={{ padding: '8px', textAlign: 'center', fontSize: 11, color: 'var(--accent-cyan)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                                {row.entry_zone || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                              </td>
                              <td style={{ padding: '8px', textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: isIn ? 700 : 400, color: isIn ? '#22c55e' : isBelow ? '#3b82f6' : 'var(--text-primary)' }}>
                                {row.cmp != null ? fmtP(row.cmp) : <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>scan needed</span>}
                              </td>
                              <td style={{ padding: '8px', textAlign: 'center' }}>
                                <ScoreBadge value={row.composite_score} color={theme.color} />
                              </td>
                              <td style={{ padding: '8px', textAlign: 'center' }}>
                                <ScoreBadge value={row.fundamental_score} color="#22c55e" />
                              </td>
                              <td style={{ padding: '8px', textAlign: 'center' }}>
                                <ScoreBadge value={row.technical_score} color="#3b82f6" />
                              </td>
                              <td style={{
                                padding: '8px', textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontSize: 11,
                                color: roe > 15 ? '#22c55e' : roe > 10 ? '#f59e0b' : '#ef4444',
                              }}>
                                {!isNaN(roe) ? `${roe.toFixed(1)}%` : '—'}
                              </td>
                              <td style={{
                                padding: '8px', textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontSize: 11,
                                color: pe > 0 && pe < 25 ? '#22c55e' : pe <= 40 ? '#f59e0b' : '#ef4444',
                              }}>
                                {!isNaN(pe) ? pe.toFixed(1) : '—'}
                              </td>
                              <td style={{
                                padding: '8px', textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontSize: 11,
                                color: de < 0.5 ? '#22c55e' : de < 1 ? '#f59e0b' : '#ef4444',
                              }}>
                                {!isNaN(de) ? de.toFixed(2) : '—'}
                              </td>
                              <td style={{ padding: '8px', textAlign: 'center' }}>
                                <span style={{
                                  fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 12,
                                  background: flagOk ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                                  color: flagOk ? '#22c55e' : '#ef4444',
                                }}>
                                  {flagOk ? 'PASS' : row.red_flag_status || '—'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="card" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
                  No matching stocks found for this theme in the index universe.
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* =============== MULTIBAGGER MODE =============== */}
      {viewMode === 'multibagger' && themes.length > 0 && (
        <>
          {/* Theme tabs for multibagger */}
          <div className="val-tabs" style={{ overflowX: 'auto', flexWrap: 'nowrap' }}>
            <button className={`val-tab${showOverview ? ' active' : ''}`}
              onClick={() => setShowOverview(true)}
              style={{ padding: '8px 14px', fontSize: 11, whiteSpace: 'nowrap' }}>
              <span className="tab-dot" style={{ background: '#f59e0b' }} />
              All Themes
            </button>
            {themes.map((t, i) => (
              <button key={t.id} className={`val-tab${!showOverview && activeTheme === i ? ' active' : ''}`}
                onClick={() => { setActiveTheme(i); setShowOverview(false); }}
                style={{ padding: '8px 14px', fontSize: 11, whiteSpace: 'nowrap', minWidth: 'fit-content' }}>
                <span className="tab-dot" style={{ background: t.color }} />
                {t.title.length > 20 ? t.title.split(' ').slice(0, 3).join(' ') : t.title}
                <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--text-muted)' }}>({(t.multibaggers || []).length})</span>
              </button>
            ))}
          </div>

          {/* All themes multibagger overview */}
          {showOverview && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {themes.map((t, tIdx) => {
                const mbs = t.multibaggers || [];
                if (mbs.length === 0) return null;
                return (
                  <div key={t.id}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer',
                    }}
                      onClick={() => { setActiveTheme(tIdx); setShowOverview(false); }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: t.color, boxShadow: `0 0 8px ${t.color}66` }} />
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{t.title}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>— {mbs.length} pick{mbs.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div style={{
                      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10,
                    }}>
                      {mbs.map((s, idx) => (
                        <MultibaggerCard key={s.symbol} stock={s} rank={idx + 1} color={t.color} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Single theme multibagger detail */}
          {!showOverview && theme && (
            <>
              {/* Research card (compact) */}
              <div className="card" style={{
                borderLeft: `4px solid ${theme.color}`, padding: '12px 16px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: theme.color, boxShadow: `0 0 10px ${theme.color}66` }} />
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{theme.title}</span>
                  <span style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 10,
                    background: 'rgba(245,158,11,0.12)', color: '#f59e0b', fontWeight: 700,
                  }}>MULTIBAGGER FOCUS</span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>{theme.subtitle}</p>
              </div>

              {/* Multibagger cards grid */}
              {(theme.multibaggers || []).length > 0 ? (
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12,
                }}>
                  {(theme.multibaggers || []).map((s, idx) => (
                    <MultibaggerCard key={s.symbol} stock={s} rank={idx + 1} color={theme.color} expanded />
                  ))}
                </div>
              ) : (
                <div className="card" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
                  No multibagger candidates for this theme.
                </div>
              )}

              {/* Scoring methodology */}
              <div className="card" style={{ borderLeft: '4px solid rgba(245,158,11,0.4)', padding: '12px 16px' }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#f59e0b' }}>Multibagger Score Methodology</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
                  <span>Quarterly Growth <strong style={{ color: 'var(--text-primary)' }}>30%</strong></span>
                  <span>Price Momentum <strong style={{ color: 'var(--text-primary)' }}>20%</strong></span>
                  <span>Relative Strength <strong style={{ color: 'var(--text-primary)' }}>20%</strong></span>
                  <span>Trend Strength <strong style={{ color: 'var(--text-primary)' }}>10%</strong></span>
                  <span>Profitability <strong style={{ color: 'var(--text-primary)' }}>10%</strong></span>
                  <span>ROE Efficiency <strong style={{ color: 'var(--text-primary)' }}>10%</strong></span>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* =============== PROSPECTIVE PORTFOLIO MODE =============== */}
      {viewMode === 'portfolio' && themes.length > 0 && data.prospectivePortfolio && (
        <PortfolioView portfolio={data.prospectivePortfolio} />
      )}

      {/* Disclaimer */}
      {themes.length > 0 && (
        <div style={{
          marginTop: 8, padding: '10px 16px', fontSize: 10, color: 'var(--text-muted)',
          lineHeight: 1.5, borderRadius: 8, background: 'rgba(15,23,42,0.3)',
        }}>
          {viewMode === 'portfolio'
            ? 'Portfolio Disclaimer: This is an algorithmically-constructed model portfolio for educational purposes only — NOT investment advice. Allocations are based on screener scores and do not account for your risk tolerance, financial situation, or goals. Consult a SEBI-registered advisor before investing. Past performance does not guarantee future returns.'
            : viewMode === 'multibagger'
              ? 'High Risk Warning: Multibagger picks are based on recent quarterly momentum and growth metrics — these stocks carry higher risk. Past performance does not guarantee future returns. This is not investment advice. Always do your own research.'
              : 'Disclaimer: This thematic research is for educational purposes only. Stock picks are algorithmically matched based on industry classification and ranked by composite screener score — not investment recommendations. Always do your own research before making investment decisions.'}
        </div>
      )}
    </div>
  );
}


function MultibaggerCard({ stock, rank, color, expanded }) {
  const s = stock;
  const mbScore = s.multibagger_score || 0;
  const scoreColor = mbScore >= 70 ? '#22c55e' : mbScore >= 50 ? '#f59e0b' : '#ef4444';
  const growth = parseFloat(s.fund_growth);
  const momentum = parseFloat(s.tech_momentum);
  const relStr = parseFloat(s.tech_relative_strength);
  const roe = parseFloat(s.roe);
  const pe = parseFloat(s.pe_ratio);
  const de = parseFloat(s.debt_to_equity);
  const hasResearch = s.growth_plan || s.peer_moat || s.near_catalyst;

  return (
    <div className="card" style={{
      padding: '14px 16px', position: 'relative', overflow: 'hidden',
      borderLeft: `3px solid ${color}`,
      transition: 'transform 0.15s, box-shadow 0.15s',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 8px 24px -6px ${color}22`; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}>
      {/* Rank badge */}
      <div style={{
        position: 'absolute', top: 10, right: 12, width: 24, height: 24, borderRadius: '50%',
        background: rank === 1 ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'rgba(100,116,139,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, color: rank === 1 ? '#fff' : 'var(--text-muted)',
      }}>#{rank}</div>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <MbScoreRing score={mbScore} color={scoreColor} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{(s.symbol || '').replace('.NS', '')}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{s.industry}</div>
        </div>
      </div>

      {/* Reason badge */}
      <div style={{
        fontSize: 10, padding: '4px 10px', borderRadius: 6,
        background: 'rgba(245,158,11,0.08)', color: '#f59e0b',
        marginBottom: 10, lineHeight: 1.4, fontWeight: 500,
      }}>
        {s.multibagger_reason || 'Growth + momentum profile'}
      </div>

      {/* Forward-looking research */}
      {hasResearch && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10,
          padding: '8px 10px', borderRadius: 8,
          background: 'rgba(15,23,42,0.4)', border: '1px solid rgba(45,51,72,0.3)',
        }}>
          {s.growth_plan && (
            <ResearchLine icon="+" iconColor="#22c55e" label="Growth Plan" text={s.growth_plan} />
          )}
          {s.peer_moat && (
            <ResearchLine icon="*" iconColor="#3b82f6" label="Moat vs Peers" text={s.peer_moat} />
          )}
          {s.near_catalyst && (
            <ResearchLine icon=">" iconColor="#a78bfa" label="Near-term Catalyst" text={s.near_catalyst} />
          )}
          {s.key_risk && (
            <div style={{ display: 'flex', gap: 6, fontSize: 10, lineHeight: 1.4 }}>
              <span style={{ flex: 'none', color: '#ef4444', fontWeight: 700, width: 10, textAlign: 'center' }}>!</span>
              <span style={{ color: '#ef4444', fontWeight: 500 }}>Risk: {s.key_risk}</span>
            </div>
          )}
        </div>
      )}

      {/* Metrics grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px 10px', fontSize: 11 }}>
        <MetricCell label="Growth" value={!isNaN(growth) ? growth.toFixed(0) : '—'} color={growth >= 60 ? '#22c55e' : growth >= 40 ? '#f59e0b' : '#64748b'} />
        <MetricCell label="Momentum" value={!isNaN(momentum) ? momentum.toFixed(0) : '—'} color={momentum >= 60 ? '#22c55e' : momentum >= 40 ? '#f59e0b' : '#64748b'} />
        <MetricCell label="Rel Str" value={!isNaN(relStr) ? relStr.toFixed(0) : '—'} color={relStr >= 60 ? '#22c55e' : relStr >= 40 ? '#f59e0b' : '#64748b'} />
        <MetricCell label="ROE" value={!isNaN(roe) ? `${roe.toFixed(1)}%` : '—'} color={roe > 15 ? '#22c55e' : roe > 10 ? '#f59e0b' : '#ef4444'} />
        <MetricCell label="P/E" value={!isNaN(pe) ? pe.toFixed(1) : '—'} color={pe > 0 && pe < 25 ? '#22c55e' : pe <= 40 ? '#f59e0b' : '#ef4444'} />
        <MetricCell label="D/E" value={!isNaN(de) ? de.toFixed(2) : '—'} color={de < 0.5 ? '#22c55e' : de < 1 ? '#f59e0b' : '#ef4444'} />
      </div>

      {/* CMP + scores row */}
      {expanded && (
        <div style={{
          display: 'flex', gap: 12, marginTop: 10, paddingTop: 8,
          borderTop: '1px solid var(--border)', fontSize: 11, alignItems: 'center',
        }}>
          <span style={{ color: 'var(--text-muted)' }}>CMP: <strong style={{ color: 'var(--text-primary)' }}>{s.cmp != null ? fmtP(s.cmp) : 'scan needed'}</strong></span>
          <span style={{ color: 'var(--text-muted)' }}>Composite: <strong style={{ color }}>{s.composite_score?.toFixed(1) || '—'}</strong></span>
          <span style={{
            marginLeft: 'auto', fontSize: 10, padding: '2px 8px', borderRadius: 10,
            background: s.red_flag_status === 'PASS' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
            color: s.red_flag_status === 'PASS' ? '#22c55e' : '#ef4444', fontWeight: 600,
          }}>{s.red_flag_status || '—'}</span>
        </div>
      )}
    </div>
  );
}


function MetricCell({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 1 }}>{label}</div>
      <div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color }}>{value}</div>
    </div>
  );
}


function ResearchLine({ icon, iconColor, label, text }) {
  return (
    <div style={{ display: 'flex', gap: 6, fontSize: 11, lineHeight: 1.45 }}>
      <span style={{
        flex: 'none', width: 10, textAlign: 'center',
        color: iconColor, fontWeight: 700, fontSize: 12,
      }}>{icon}</span>
      <div>
        <span style={{ color: iconColor, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}: </span>
        <span style={{ color: 'var(--text-secondary)' }}>{text}</span>
      </div>
    </div>
  );
}


/* ═══ PROSPECTIVE PORTFOLIO VIEW ═══ */

const TIER_CONFIG = {
  core: { label: 'Core Holdings', color: '#22c55e', icon: 'C', gradient: 'rgba(34,197,94,0.12)' },
  growth: { label: 'Growth Accelerators', color: '#3b82f6', icon: 'G', gradient: 'rgba(59,130,246,0.12)' },
  tactical: { label: 'Tactical Bets', color: '#f59e0b', icon: 'T', gradient: 'rgba(245,158,11,0.12)' },
};

function AllocationDonut({ tiers }) {
  const size = 140;
  const cx = size / 2, cy = size / 2, r = 52, strokeW = 22;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const tierOrder = ['core', 'growth', 'tactical'];
  const segments = tierOrder.map(k => {
    const t = tiers[k];
    if (!t || !t.targetWeight) return null;
    const pct = t.targetWeight / 100;
    const dashLen = circ * pct;
    const seg = { key: k, dashLen, offset, color: TIER_CONFIG[k].color, pct: t.targetWeight, count: t.count };
    offset += dashLen;
    return seg;
  }).filter(Boolean);

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(100,116,139,0.1)" strokeWidth={strokeW} />
        {segments.map(s => (
          <circle key={s.key} cx={cx} cy={cy} r={r} fill="none"
            stroke={s.color} strokeWidth={strokeW}
            strokeDasharray={`${s.dashLen} ${circ - s.dashLen}`}
            strokeDashoffset={-s.offset} />
        ))}
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>
          {tierOrder.reduce((s, k) => s + (tiers[k]?.count || 0), 0)}
        </span>
        <span style={{ fontSize: 9, color: '#94a3b8' }}>stocks</span>
      </div>
    </div>
  );
}

function ThemeBar({ themeAllocation }) {
  const entries = Object.entries(themeAllocation);
  if (!entries.length) return null;
  const max = Math.max(...entries.map(([, v]) => v));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {entries.map(([name, pct]) => (
        <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#94a3b8', width: 140, textAlign: 'right', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name.length > 22 ? name.slice(0, 20) + '...' : name}
          </span>
          <div style={{ flex: 1, height: 14, borderRadius: 4, background: 'rgba(51,65,85,0.3)', overflow: 'hidden' }}>
            <div style={{
              width: `${(pct / max) * 100}%`, height: '100%', borderRadius: 4,
              background: 'linear-gradient(90deg, rgba(34,197,94,0.4), rgba(34,197,94,0.7))',
              transition: 'width 0.3s',
            }} />
          </div>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {pct}%
          </span>
        </div>
      ))}
    </div>
  );
}

function PortfolioStockRow({ s, idx }) {
  const tc = TIER_CONFIG[s.tier] || TIER_CONFIG.tactical;
  const roe = parseFloat(s.roe);
  const pe = parseFloat(s.peRatio);
  const de = parseFloat(s.debtToEquity);
  const flagOk = (s.redFlagStatus || '').toUpperCase() === 'PASS';
  const hasResearch = s.growthPlan || s.peerMoat || s.nearCatalyst;
  const isIn = inEntryZone(s.cmp, s.entryZone);
  const isBelow = belowEntryZone(s.cmp, s.entryZone);
  const borderColor = isIn ? '#22c55e' : isBelow ? '#3b82f6' : tc.color;

  return (
    <div className="card" style={{
      padding: 0, overflow: 'hidden', borderLeft: `3px solid ${borderColor}`,
      transition: 'transform 0.15s, box-shadow 0.15s',
      ...(isIn ? { background: 'rgba(34,197,94,0.03)' } : {}),
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = `0 4px 16px -4px ${borderColor}22`; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, background: tc.gradient }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `${tc.color}22`, color: tc.color, fontSize: 12, fontWeight: 700,
        }}>{idx + 1}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{(s.symbol || '').replace('.NS', '')}</span>
            <span style={{
              fontSize: 9, padding: '1px 6px', borderRadius: 10, fontWeight: 700,
              background: `${tc.color}18`, color: tc.color, letterSpacing: 0.3,
            }}>{tc.label.split(' ')[0].toUpperCase()}</span>
            {isIn && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#22c55e22', color: '#22c55e' }}>IN ZONE</span>}
            {isBelow && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#3b82f622', color: '#3b82f6' }}>BELOW</span>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>{s.weight.toFixed(1)}%</div>
          <div style={{ fontSize: 9, color: '#94a3b8' }}>allocation</div>
        </div>
      </div>

      <div style={{ padding: '10px 14px' }}>
        {/* Theme + industry */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 9, padding: '2px 8px', borderRadius: 10,
            background: `${s.themeColor}15`, color: s.themeColor, fontWeight: 600,
          }}>{s.theme}</span>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{s.industry}</span>
        </div>

        {/* Forward-looking research (compact) */}
        {hasResearch && (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8,
            padding: '6px 8px', borderRadius: 6,
            background: 'rgba(15,23,42,0.4)', border: '1px solid rgba(45,51,72,0.25)',
          }}>
            {s.growthPlan && <ResearchLine icon="+" iconColor="#22c55e" label="Growth" text={s.growthPlan} />}
            {s.peerMoat && <ResearchLine icon="*" iconColor="#3b82f6" label="Moat" text={s.peerMoat} />}
            {s.nearCatalyst && <ResearchLine icon=">" iconColor="#a78bfa" label="Catalyst" text={s.nearCatalyst} />}
            {s.keyRisk && (
              <div style={{ display: 'flex', gap: 6, fontSize: 10, lineHeight: 1.4 }}>
                <span style={{ flex: 'none', color: '#ef4444', fontWeight: 700, width: 10, textAlign: 'center' }}>!</span>
                <span style={{ color: '#ef4444', fontWeight: 500 }}>Risk: {s.keyRisk}</span>
              </div>
            )}
          </div>
        )}

        {/* Scores row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, fontSize: 11 }}>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Composite</div>
            <div style={{ fontWeight: 600, color: '#3b82f6', fontVariantNumeric: 'tabular-nums' }}>{s.compositeScore?.toFixed(1) || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>MB Score</div>
            <div style={{ fontWeight: 600, color: '#f59e0b', fontVariantNumeric: 'tabular-nums' }}>{s.multibaggerScore?.toFixed(0) || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>ROE</div>
            <div style={{
              fontWeight: 600, fontVariantNumeric: 'tabular-nums',
              color: roe > 15 ? '#22c55e' : roe > 10 ? '#f59e0b' : '#ef4444',
            }}>{!isNaN(roe) ? `${roe.toFixed(1)}%` : '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>D/E</div>
            <div style={{
              fontWeight: 600, fontVariantNumeric: 'tabular-nums',
              color: de < 0.5 ? '#22c55e' : de < 1 ? '#f59e0b' : '#ef4444',
            }}>{!isNaN(de) ? de.toFixed(2) : '—'}</div>
          </div>
        </div>

        {/* Footer: CMP + Entry Zone + P/E + flag */}
        <div style={{
          display: 'flex', gap: 12, marginTop: 8, paddingTop: 6,
          borderTop: '1px solid var(--border)', fontSize: 11, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <span style={{ color: 'var(--text-muted)' }}>CMP: <strong style={{ color: isIn ? '#22c55e' : isBelow ? '#3b82f6' : 'var(--text-primary)' }}>{s.cmp != null ? fmtP(s.cmp) : 'scan needed'}</strong></span>
          {s.entryZone && <span style={{ color: 'var(--text-muted)' }}>Zone: <strong style={{ color: 'var(--accent-cyan)', whiteSpace: 'nowrap' }}>₹{s.entryZone}</strong></span>}
          {!isNaN(pe) && <span style={{ color: 'var(--text-muted)' }}>P/E: <strong>{pe.toFixed(1)}</strong></span>}
          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{s.multibaggerReason}</span>
          <span style={{
            marginLeft: 'auto', fontSize: 10, padding: '2px 8px', borderRadius: 10,
            background: flagOk ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
            color: flagOk ? '#22c55e' : '#ef4444', fontWeight: 600,
          }}>{s.redFlagStatus || '—'}</span>
        </div>
      </div>
    </div>
  );
}

function PortfolioView({ portfolio }) {
  const p = portfolio;
  const tiers = p.tiers || {};
  const tierOrder = ['core', 'growth', 'tactical'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Summary row: Donut + tier legend + theme allocation */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {/* Donut + legend */}
        <div className="card" style={{
          flex: '1 1 320px', display: 'flex', alignItems: 'center', gap: 20,
          padding: '16px 20px',
        }}>
          <AllocationDonut tiers={tiers} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
            {tierOrder.map(k => {
              const t = tiers[k];
              const cfg = TIER_CONFIG[k];
              if (!t) return null;
              return (
                <div key={k}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: 3, background: cfg.color,
                    }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>
                      {cfg.label}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: cfg.color, marginLeft: 'auto' }}>
                      {t.targetWeight}%
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8', paddingLeft: 16 }}>
                    {t.count} stocks &middot; {t.description}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Theme diversification */}
        <div className="card" style={{ flex: '1 1 320px', padding: '16px 20px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 10 }}>
            Theme Diversification
          </div>
          <ThemeBar themeAllocation={p.themeAllocation || {}} />
        </div>
      </div>

      {/* Methodology card */}
      {p.methodology && (
        <div className="card" style={{
          borderLeft: '4px solid rgba(34,197,94,0.4)', padding: '12px 16px',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#22c55e', marginBottom: 6 }}>
            Portfolio Construction
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 6, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5,
          }}>
            <div><strong style={{ color: 'var(--text-primary)' }}>Scoring:</strong> {p.methodology.scoring}</div>
            <div><strong style={{ color: 'var(--text-primary)' }}>Risk Adj:</strong> {p.methodology.riskAdj}</div>
            <div><strong style={{ color: 'var(--text-primary)' }}>Horizon:</strong> {p.methodology.horizon}</div>
            <div><strong style={{ color: 'var(--text-primary)' }}>Rebalance:</strong> {p.methodology.rebalance}</div>
          </div>
        </div>
      )}

      {/* Tier sections */}
      {tierOrder.map(k => {
        const t = tiers[k];
        const cfg = TIER_CONFIG[k];
        if (!t || !t.stocks || !t.stocks.length) return null;
        return (
          <div key={k}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
              padding: '8px 0',
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: `${cfg.color}18`, color: cfg.color, fontSize: 14, fontWeight: 700,
              }}>{cfg.icon}</div>
              <div>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>{cfg.label}</span>
                <span style={{
                  marginLeft: 8, fontSize: 11, fontWeight: 600, color: cfg.color,
                }}>{t.targetWeight}% allocation &middot; {t.count} stocks</span>
              </div>
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 10,
            }}>
              {t.stocks.map((s, idx) => (
                <PortfolioStockRow key={s.symbol} s={s} idx={idx} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
