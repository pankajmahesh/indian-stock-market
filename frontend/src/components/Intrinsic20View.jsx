import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import ScreenshotButton from './ScreenshotButton';

const fmtP = (n) => (n == null || isNaN(n)) ? 'N/A' : `\u20B9${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const MOS_CONFIG = {
  'Strong Buy': { bg: 'rgba(34,197,94,0.15)', color: '#22c55e' },
  'Buy':        { bg: 'rgba(52,211,153,0.15)', color: '#34d399' },
  'Hold':       { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b' },
  'Sell':       { bg: 'rgba(239,68,68,0.15)',  color: '#ef4444' },
};

const VERDICT_COLORS = {
  'Undervalued': '#34d399',
  'Overvalued': '#ef4444',
  'Fairly Valued': '#f59e0b',
};

const ZONE_FILTERS = ['All', 'Strong Buy', 'Buy', 'Hold', 'Sell'];

export default function Intrinsic20View() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState(null);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('marginOfSafety');
  const [sortAsc, setSortAsc] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const containerRef = useRef(null);
  const pollRef = useRef(null);

  const loadData = useCallback(async () => {
    try {
      const res = await api.getIntrinsic20();
      if (Array.isArray(res)) {
        setData(res);
        setLastUpdated(new Date().toLocaleTimeString());
      }
    } catch {
      // No data yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Poll scan status
  useEffect(() => {
    if (!scanning) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const s = await api.getIntrinsic20Status();
        setScanStatus(s);
        if (!s.running && s.status !== 'idle') {
          setScanning(false);
          if (s.status === 'completed') loadData();
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [scanning, loadData]);

  const handleScan = async () => {
    try {
      await api.scanIntrinsic20();
      setScanning(true);
      setScanStatus({ running: true, status: 'scanning', log_lines: ['Starting...'] });
    } catch (e) {
      alert(e.message || 'Failed to start scan');
    }
  };

  const handleLiveRefresh = async () => {
    try {
      const res = await api.getIntrinsic20Live();
      if (res?.data) {
        setData(res.data);
        setLastUpdated(res.updated_at || new Date().toLocaleTimeString());
      }
    } catch { /* ignore */ }
  };

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  // Filter and sort
  const filtered = data.filter(r => {
    if (filter !== 'All' && r.mosZone !== filter) return false;
    if (search) {
      const q = search.toUpperCase();
      return (r.symbol || '').toUpperCase().includes(q)
        || (r.name || '').toUpperCase().includes(q)
        || (r.sector || '').toUpperCase().includes(q);
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return sortAsc ? -1 : 1;
    if (av > bv) return sortAsc ? 1 : -1;
    return 0;
  });

  const top20 = sorted.slice(0, 20);
  const hasMore = sorted.length > 20;

  return (
    <div className="predict-view" ref={containerRef}>
      {/* Header card */}
      <div className="card" style={{
        background: 'linear-gradient(135deg, var(--bg-card) 0%, rgba(30, 34, 53, 0.95) 100%)',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: -60, right: -60, width: 200, height: 200,
          background: 'radial-gradient(circle, rgba(34,197,94,0.06) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, position: 'relative' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16 }}>Intrinsic 20</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: '4px 0 0' }}>
              Top undervalued stocks from Midcap 150 + LargeMidcap 250 + Smallcap 250 via Morgan Stanley-style DCF.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <ScreenshotButton targetRef={containerRef} filename="intrinsic-20" label="Download" />
            <button className="scan-btn" onClick={handleLiveRefresh} disabled={scanning || data.length === 0}
              style={{ padding: '8px 14px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', boxShadow: 'none' }}>
              Refresh CMP
            </button>
            <button className="scan-btn" onClick={handleScan} disabled={scanning}>
              {scanning ? 'Scanning...' : 'Scan All'}
            </button>
          </div>
        </div>

        {/* Stats row */}
        {data.length > 0 && (
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
            <span>Total: <strong style={{ color: 'var(--text-primary)' }}>{data.length}</strong> stocks</span>
            <span>Strong Buy: <strong style={{ color: '#22c55e' }}>{data.filter(r => r.mosZone === 'Strong Buy').length}</strong></span>
            <span>Buy: <strong style={{ color: '#34d399' }}>{data.filter(r => r.mosZone === 'Buy').length}</strong></span>
            <span>Hold: <strong style={{ color: '#f59e0b' }}>{data.filter(r => r.mosZone === 'Hold').length}</strong></span>
            <span>Sell: <strong style={{ color: '#ef4444' }}>{data.filter(r => r.mosZone === 'Sell').length}</strong></span>
            {lastUpdated && <span style={{ marginLeft: 'auto' }}>Updated: {lastUpdated}</span>}
          </div>
        )}
      </div>

      {/* Scan progress */}
      {scanning && scanStatus && (
        <div className="card" style={{ borderLeft: '4px solid var(--accent-blue)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            Scanning... ({scanStatus.status})
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

      {/* Filter bar */}
      {data.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
          <div className="val-tabs" style={{ marginBottom: 0, flex: 'none' }}>
            {ZONE_FILTERS.map(z => (
              <button key={z} className={`val-tab${filter === z ? ' active' : ''}`}
                onClick={() => setFilter(z)}
                style={{ padding: '7px 12px', fontSize: 11 }}>
                {z !== 'All' && (
                  <span className="tab-dot" style={{ background: MOS_CONFIG[z]?.color || '#64748b' }} />
                )}
                {z} {z !== 'All' && `(${data.filter(r => r.mosZone === z).length})`}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search symbol, name, sector..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1, minWidth: 160, padding: '8px 12px', fontSize: 12,
              background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8,
              color: 'var(--text-primary)', outline: 'none',
            }}
          />
        </div>
      )}

      {/* Loading state */}
      {loading && !scanning && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'var(--text-secondary)' }}>Loading saved data...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && data.length === 0 && !scanning && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <h3 style={{ fontSize: 16, color: 'var(--text-secondary)', marginBottom: 8 }}>No data yet</h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
            Click "Scan All" to run DCF valuation on ~600 stocks from all 3 indices.
            This takes 4-6 minutes.
          </p>
          <button className="scan-btn" onClick={handleScan}>Start Scan</button>
        </div>
      )}

      {/* Data table */}
      {sorted.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {[
                    { key: 'rank', label: '#', w: 36 },
                    { key: 'symbol', label: 'Symbol', align: 'left' },
                    { key: 'sector', label: 'Sector', align: 'left' },
                    { key: 'cmp', label: 'CMP' },
                    { key: 'intrinsicValue', label: 'Intrinsic Val' },
                    { key: 'upside', label: 'Upside %' },
                    { key: 'marginOfSafety', label: 'MoS %' },
                    { key: 'mosZone', label: 'Zone' },
                    { key: 'wacc', label: 'WACC' },
                    { key: 'dcfBear', label: 'Bear DCF' },
                    { key: 'dcfBull', label: 'Bull DCF' },
                    { key: 'verdict', label: 'Verdict' },
                  ].map(col => (
                    <th key={col.key}
                      onClick={() => col.key !== 'rank' && handleSort(col.key)}
                      style={{
                        padding: '10px 8px', textAlign: col.align || 'center',
                        fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
                        background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border)',
                        cursor: col.key !== 'rank' ? 'pointer' : 'default',
                        whiteSpace: 'nowrap', width: col.w,
                        userSelect: 'none',
                      }}>
                      {col.label}
                      {sortKey === col.key && <span style={{ marginLeft: 3, fontSize: 10 }}>{sortAsc ? '▲' : '▼'}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(hasMore && filter === 'All' ? top20 : sorted).map((row, idx) => {
                  const mosCfg = MOS_CONFIG[row.mosZone] || { bg: 'rgba(100,116,139,0.12)', color: '#64748b' };
                  const verdictColor = VERDICT_COLORS[row.verdict] || '#64748b';
                  const upside = parseFloat(row.upside);
                  const mos = parseFloat(row.marginOfSafety);

                  return (
                    <tr key={row.symbol} style={{
                      borderBottom: '1px solid var(--border)',
                      transition: 'background 0.15s',
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '8px', textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
                        {idx + 1}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'left', fontWeight: 600 }}>
                        <div>{row.symbol}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>{row.name}</div>
                      </td>
                      <td style={{ padding: '8px', textAlign: 'left', fontSize: 11, color: 'var(--text-secondary)' }}>
                        {row.sector}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtP(row.cmp)}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtP(row.intrinsicValue)}
                      </td>
                      <td style={{
                        padding: '8px', textAlign: 'center', fontWeight: 600,
                        color: upside > 0 ? '#34d399' : upside < 0 ? '#ef4444' : '#f59e0b',
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {!isNaN(upside) ? `${upside > 0 ? '+' : ''}${upside.toFixed(1)}%` : 'N/A'}
                      </td>
                      <td style={{
                        padding: '8px', textAlign: 'center', fontWeight: 700,
                        color: mos > 30 ? '#22c55e' : mos > 15 ? '#34d399' : mos > 0 ? '#f59e0b' : '#ef4444',
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {!isNaN(mos) ? `${mos > 0 ? '+' : ''}${mos.toFixed(1)}%` : 'N/A'}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 12,
                          fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
                          background: mosCfg.bg, color: mosCfg.color,
                        }}>
                          {row.mosZone || 'N/A'}
                        </span>
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                        {row.wacc != null ? `${Number(row.wacc).toFixed(1)}%` : 'N/A'}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center', fontSize: 11, color: '#ef4444', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtP(row.dcfBear)}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center', fontSize: 11, color: '#34d399', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtP(row.dcfBull)}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>
                        <span style={{
                          fontSize: 11, fontWeight: 600, color: verdictColor,
                        }}>
                          {row.verdict || 'N/A'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {hasMore && filter === 'All' && (
            <div style={{
              padding: '10px 16px', fontSize: 12, color: 'var(--text-muted)',
              borderTop: '1px solid var(--border)', textAlign: 'center',
            }}>
              Showing top 20 of {sorted.length}. Use zone filters to see all.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
