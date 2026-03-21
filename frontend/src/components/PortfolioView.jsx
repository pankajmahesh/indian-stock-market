import { useState, useEffect, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend, PieChart, Pie } from 'recharts';
import { api } from '../api';
import ScreenshotButton from './ScreenshotButton';
import DefenseModeView from './DefenseModeView';

const REC_CONFIG = {
  'STRONG BUY':  { bg: 'rgba(34,197,94,0.25)', color: '#22c55e', icon: '++' },
  'ACCUMULATE':  { bg: 'rgba(34,197,94,0.15)', color: '#22c55e', icon: '+' },
  'HOLD':        { bg: 'rgba(234,179,8,0.15)',  color: '#eab308', icon: '=' },
  'REDUCE':      { bg: 'rgba(249,115,22,0.15)', color: '#f97316', icon: '-' },
  'SELL':        { bg: 'rgba(239,68,68,0.15)',   color: '#ef4444', icon: '--' },
};

const RISK_CONFIG = {
  'LOW':     { bg: 'rgba(34,197,94,0.15)', color: '#22c55e', label: 'LOW' },
  'MEDIUM':  { bg: 'rgba(234,179,8,0.15)',  color: '#eab308', label: 'MED' },
  'HIGH':    { bg: 'rgba(239,68,68,0.15)',   color: '#ef4444', label: 'HIGH' },
  'UNKNOWN': { bg: 'rgba(100,116,139,0.12)', color: '#64748b', label: '?' },
};

const SIGNAL_COLORS = {
  'BUY':     { bg: 'rgba(34,197,94,0.12)', color: '#22c55e' },
  'SELL':    { bg: 'rgba(239,68,68,0.12)', color: '#ef4444' },
  'HOLD':    { bg: 'rgba(234,179,8,0.12)',  color: '#eab308' },
  'NO_DATA': { bg: 'rgba(100,116,139,0.12)', color: '#64748b' },
};

const TREND_COLORS = {
  'BULLISH': '#22c55e', 'NEUTRAL': '#eab308',
  'BEARISH': '#ef4444', 'WEAK': '#f97316', 'UNKNOWN': '#64748b',
};

const ALERT_CONFIG = {
  'STRONG_BUY':      { icon: '^^', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.3)', label: 'STRONG BUY' },
  'BUY_SIGNAL':      { icon: '^',  color: '#3b82f6', bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.3)', label: 'BUY SIGNAL' },
  'SELL_SIGNAL':      { icon: 'v',  color: '#f97316', bg: 'rgba(249,115,22,0.10)', border: 'rgba(249,115,22,0.3)', label: 'SELL SIGNAL' },
  'HIGH_RISK_REDUCE': { icon: '!!', color: '#ef4444', bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.3)', label: 'HIGH RISK' },
  'SELL_EXIT':        { icon: 'vv', color: '#ef4444', bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.4)', label: 'SELL' },
  'DANGER_ZONE':      { icon: '!!', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.35)', label: 'DANGER' },
};

function RecBadge({ rec }) {
  const cfg = REC_CONFIG[rec] || REC_CONFIG['HOLD'];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '4px 12px', borderRadius: 20, fontWeight: 700, fontSize: 12,
      background: cfg.bg, color: cfg.color, whiteSpace: 'nowrap',
    }}>
      {cfg.icon} {rec}
    </span>
  );
}

function RiskBadge({ level, score }) {
  const cfg = RISK_CONFIG[level] || RISK_CONFIG['UNKNOWN'];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', borderRadius: 6, fontWeight: 700, fontSize: 11,
      background: cfg.bg, color: cfg.color, whiteSpace: 'nowrap',
    }}>
      {cfg.label}{score != null ? ` ${score}` : ''}
    </span>
  );
}

function RiskMeter({ score }) {
  if (score == null) return <span style={{ color: '#64748b', fontSize: 11 }}>N/A</span>;
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 65 ? '#ef4444' : pct >= 35 ? '#eab308' : '#22c55e';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        width: 50, height: 6, background: 'var(--bg-secondary)',
        borderRadius: 3, overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%', background: color,
          borderRadius: 3, transition: 'width 0.3s',
        }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color }}>{score}</span>
    </div>
  );
}

const PF_REFRESH_INTERVALS = [
  { label: 'Off', value: 0 },
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
];

export default function PortfolioView({ portfolioName = 'main', title = 'My Portfolio' }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const [riskFilter, setRiskFilter] = useState('ALL');
  const [sortCol, setSortCol] = useState('recommendation_rank');
  const [sortAsc, setSortAsc] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedRow, setExpandedRow] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [alertsDismissed, setAlertsDismissed] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [showManage, setShowManage] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [addSymbol, setAddSymbol] = useState('');
  const [manageBusy, setManageBusy] = useState(false);
  const [activeTab, setActiveTab] = useState('stocks');
  const [growthData, setGrowthData] = useState(null);
  const [growthLoading, setGrowthLoading] = useState(false);
  const [valData, setValData] = useState(null);
  const [valLoading, setValLoading] = useState(false);
  const [calData, setCalData] = useState(null);
  const [calLoading, setCalLoading] = useState(false);
  const [hedgeData, setHedgeData] = useState(null);
  const [hedgeLoading, setHedgeLoading] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [rebalData, setRebalData] = useState(null);
  const [rebalLoading, setRebalLoading] = useState(false);
  const [marketCondition, setMarketCondition] = useState(null);
  const [mcLoading, setMcLoading] = useState(false);
  const pollRef = useRef(null);
  const refreshRef = useRef(null);
  const fileInputRef = useRef(null);
  const containerRef = useRef(null);

  const loadAlerts = () => {
    api.getPortfolioAlerts(portfolioName)
      .then(a => { setAlerts(Array.isArray(a) ? a : []); setAlertsDismissed(false); })
      .catch(() => setAlerts([]));
  };

  const loadData = () => {
    setLoading(true);
    api.getPortfolio(portfolioName)
      .then(d => {
        setData(Array.isArray(d) ? d : []);
        setLastUpdated(new Date().toLocaleTimeString());
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
    loadAlerts();
  };

const silentRefresh = () => {
    if (scanning) return;
    api.getPortfolio(portfolioName)
      .then(d => {
        if (Array.isArray(d)) { setData(d); setLastUpdated(new Date().toLocaleTimeString()); }
      })
      .catch(() => {});
    loadAlerts();
  };

  useEffect(() => { loadData(); }, [portfolioName]);

  // Auto-refresh timer
  useEffect(() => {
    if (refreshRef.current) clearInterval(refreshRef.current);
    if (autoRefresh > 0 && data && !scanning) {
      refreshRef.current = setInterval(silentRefresh, autoRefresh * 1000);
    }
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [autoRefresh, data, scanning, portfolioName]);

  useEffect(() => {
    if (!scanning) return;
    pollRef.current = setInterval(() => {
      api.getPortfolioStatus(portfolioName).then(s => {
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
    api.scanPortfolio(portfolioName, skipCache).catch(err => {
      setScanning(false);
      setScanStatus({ running: false, status: `error: ${err.message || 'Failed to start scan'}`, log_lines: [err.message || 'Failed to start scan'] });
    });
  };

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(col === 'recommendation_rank' || col === 'risk_score'); }
  };

  // Filter and sort
  let rows = data || [];
  if (filter !== 'ALL') rows = rows.filter(r => r.recommendation === filter);
  if (riskFilter !== 'ALL') rows = rows.filter(r => r.risk_level === riskFilter);
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

  // Summary counts
  const recCounts = {};
  const riskCounts = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  (data || []).forEach(r => {
    recCounts[r.recommendation] = (recCounts[r.recommendation] || 0) + 1;
    if (r.risk_level in riskCounts) riskCounts[r.risk_level]++;
  });

  return (
    <div ref={containerRef}>
      {/* Header + scan buttons */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, flex: 1 }}>{title} ({data?.length || 0} holdings)</h2>
          <button
            onClick={() => startScan(false)}
            disabled={scanning}
            style={{
              padding: '8px 20px', borderRadius: 8, border: 'none',
              background: scanning ? '#334155' : 'var(--accent-blue)',
              color: 'white', fontWeight: 600, cursor: scanning ? 'wait' : 'pointer', fontSize: 13,
            }}
          >
            {scanning ? 'Scanning...' : 'Scan Portfolio'}
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
            Fresh Scan (skip cache)
          </button>
          <button
            onClick={() => setShowManage(!showManage)}
            style={{
              padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)',
              background: showManage ? 'var(--bg-hover)' : 'transparent',
              color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12,
            }}
          >
            {showManage ? 'Close Manage' : 'Manage Holdings'}
          </button>
          <ScreenshotButton targetRef={containerRef} filename={portfolioName + '-portfolio'} />
        </div>

        {/* Manage Holdings Panel */}
        {showManage && (
          <div style={{ marginTop: 14, padding: 16, background: 'var(--bg-secondary)', borderRadius: 10, border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {/* CSV Import */}
              <div style={{ flex: '1 1 300px' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  Import from CSV / Excel (Sharekhan / Nuvama / any broker export)
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  style={{ display: 'none' }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setManageBusy(true);
                    setImportResult(null);
                    try {
                      const result = await api.importPortfolioCsv(file, portfolioName);
                      if (result.error) {
                        setImportResult({ error: result.error });
                      } else {
                        setImportResult({ success: true, count: result.count, symbols: result.symbols, column: result.column_used });
                        setShowManage(false);
                        startScan(false);
                      }
                    } catch (err) {
                      setImportResult({ error: err.message });
                    } finally {
                      setManageBusy(false);
                      e.target.value = '';
                    }
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={manageBusy}
                  style={{
                    padding: '8px 16px', borderRadius: 8, border: '1px dashed var(--border)',
                    background: 'var(--bg-card)', color: 'var(--accent-blue)',
                    cursor: 'pointer', fontSize: 13, fontWeight: 600, width: '100%',
                  }}
                >
                  {manageBusy ? 'Importing...' : 'Upload CSV / Excel File'}
                </button>
                {importResult && (
                  <div style={{ marginTop: 8, fontSize: 12, padding: '8px 10px', borderRadius: 6, background: 'var(--bg-card)' }}>
                    {importResult.error ? (
                      <span style={{ color: 'var(--accent-red)' }}>{importResult.error}</span>
                    ) : (
                      <span style={{ color: 'var(--accent-green)' }}>
                        Imported {importResult.count} stocks (column: {importResult.column})
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* MF Holdings — link to dedicated tab */}
              {portfolioName === 'main' && (
                <div style={{ flex: '1 1 260px', background: 'var(--bg-card)', borderRadius: 10, padding: 14, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
                  <div style={{ fontSize: 28 }}>📊</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>MF Holdings</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Manage mutual fund holdings from MF Central in the dedicated MF tab.</div>
                  <a href="#nuwama-mf" style={{ padding: '7px 14px', borderRadius: 7, background: 'var(--accent-blue)', color: '#fff', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}
                    onClick={e => { e.preventDefault(); window.location.hash = 'nuwama-mf'; }}>
                    Go to Nuwama MF →
                  </a>
                </div>
              )}

              {/* Delete Portfolio — non-admin "my" portfolio only */}
              {portfolioName === 'my' && (
                <div style={{ flex: '1 1 300px' }}>
                  <button
                    onClick={() => {
                      if (!window.confirm('Delete your entire portfolio? This will remove all uploaded stocks and scan results. This cannot be undone.')) return;
                      setManageBusy(true);
                      api.deletePortfolio()
                        .then(() => { setData(null); setAlerts([]); setAlertsDismissed(false); setShowManage(false); })
                        .catch(err => alert(err.message || 'Failed to delete portfolio'))
                        .finally(() => setManageBusy(false));
                    }}
                    disabled={manageBusy}
                    style={{
                      padding: '8px 16px', borderRadius: 6, border: '1px solid var(--accent-red)',
                      background: 'rgba(239,68,68,0.08)', color: 'var(--accent-red)',
                      cursor: 'pointer', fontSize: 13, fontWeight: 600, width: '100%',
                    }}
                  >
                    🗑 Delete Portfolio
                  </button>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                    Removes all uploaded stocks and scan data permanently.
                  </div>
                </div>
              )}

              {/* Add Individual Stock */}
              <div style={{ flex: '1 1 300px' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  Add / Remove Individual Stock
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    placeholder="Symbol (e.g., RELIANCE)"
                    value={addSymbol}
                    onChange={e => setAddSymbol(e.target.value.toUpperCase())}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && addSymbol.trim()) {
                        setManageBusy(true);
                        api.addPortfolioStock(portfolioName, addSymbol.trim())
                          .then(() => { setAddSymbol(''); startScan(false); })
                          .catch(() => {})
                          .finally(() => setManageBusy(false));
                      }
                    }}
                    style={{
                      flex: 1, padding: '8px 12px', borderRadius: 6,
                      background: 'var(--bg-card)', border: '1px solid var(--border)',
                      color: 'var(--text-primary)', fontSize: 13, outline: 'none',
                    }}
                  />
                  <button
                    onClick={() => {
                      if (!addSymbol.trim()) return;
                      setManageBusy(true);
                      api.addPortfolioStock(portfolioName, addSymbol.trim())
                        .then(() => { setAddSymbol(''); startScan(false); })
                        .catch(() => {})
                        .finally(() => setManageBusy(false));
                    }}
                    disabled={manageBusy || !addSymbol.trim()}
                    style={{
                      padding: '8px 14px', borderRadius: 6, border: 'none',
                      background: 'var(--accent-green)', color: 'white',
                      cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    }}
                  >
                    Add
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                  Tip: To remove a stock, expand its row in the table and click Remove
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Auto-refresh controls */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, marginTop: 12,
          padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 8,
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>Auto Refresh:</span>
          {PF_REFRESH_INTERVALS.map(opt => (
            <button key={opt.value} onClick={() => setAutoRefresh(opt.value)}
              style={{
                padding: '3px 10px', borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 600,
                background: autoRefresh === opt.value ? 'var(--accent-blue)' : 'var(--bg-card)',
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
            <div style={{ marginBottom: 8, fontWeight: 600, color: 'var(--accent-blue)' }}>
              Status: {scanStatus.status}
            </div>
            <div style={{ maxHeight: 120, overflow: 'auto', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {(scanStatus.log_lines || []).map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>
        )}
      </div>

      {/* Alert Notifications */}
      {!alertsDismissed && alerts.length > 0 && (
        <AlertsPanel alerts={alerts} onDismiss={() => setAlertsDismissed(true)} />
      )}

      {loading && <div className="loading"><div className="spinner" /> Loading portfolio...</div>}

      {!loading && !data && (
        <div className="empty-state">
          <h3>{portfolioName === 'my' ? 'Your Portfolio is Empty' : 'No Portfolio Data'}</h3>
          <p>
            {portfolioName === 'my'
              ? 'Upload a broker CSV/Excel file or add stocks manually using "Manage Holdings" above.'
              : 'Click "Scan Portfolio" to analyze your holdings with real-time risk assessment.'}
          </p>
          {portfolioName === 'my' && (
            <button
              onClick={() => setShowManage(true)}
              style={{
                marginTop: 12, padding: '10px 24px', borderRadius: 8,
                background: 'var(--accent-blue)', color: 'white',
                border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: 14,
              }}
            >
              Upload / Add Stocks
            </button>
          )}
        </div>
      )}

      {!loading && data && data.length > 0 && (
        <>
          {/* Hero Search Bar */}
          <div style={{ marginBottom: 16 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
              background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)',
            }}>
              <input
                placeholder="Search symbol, name, sector..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  flex: 1, padding: '8px 12px', borderRadius: 8,
                  background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                  color: 'var(--text-primary)', fontSize: 14, outline: 'none',
                }}
              />
              {(filter !== 'ALL' || riskFilter !== 'ALL') && (
                <button onClick={() => { setFilter('ALL'); setRiskFilter('ALL'); }}
                  style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)',
                    background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12 }}>
                  Clear filters
                </button>
              )}
              <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {rows.length} of {data.length}
              </span>
            </div>
          </div>

          {/* Tab Bar */}
          <div style={{
            display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--border)',
            overflowX: 'auto', WebkitOverflowScrolling: 'touch',
          }}>
            {[
              { key: 'stocks', label: 'Stock List' },
              { key: 'sector-mix', label: 'Sector Mix' },
              { key: 'ai-analysis', label: '🤖 AI Analysis' },
              { key: 'defense', label: '🛡 Defense Mode' },
              { key: 'val-assess', label: '⚖ Valuation' },
              { key: 'rebalance', label: 'Rebalance' },
              { key: 'growth', label: 'Growth Trend' },
              { key: 'valuation', label: 'Valuation Trend' },
              { key: 'calendar', label: 'Calendar' },
              { key: 'hedge', label: 'Hedge' },
              { key: 'report', label: 'Report' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: '10px 20px', border: 'none', borderBottom: activeTab === tab.key ? '2px solid var(--accent-blue)' : '2px solid transparent',
                  background: 'transparent', color: activeTab === tab.key ? 'var(--accent-blue)' : 'var(--text-muted)',
                  fontWeight: activeTab === tab.key ? 700 : 500, fontSize: 13, cursor: 'pointer',
                  whiteSpace: 'nowrap', marginBottom: -2, transition: 'all 0.15s',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* === STOCKS TAB === */}
          {activeTab === 'stocks' && (
            <>
              {/* Recommendation + Risk summary */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8, fontWeight: 600 }}>Verdict</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                    {['STRONG BUY', 'ACCUMULATE', 'HOLD', 'REDUCE', 'SELL'].map(rec => {
                      const cfg = REC_CONFIG[rec];
                      const count = recCounts[rec] || 0;
                      const active = filter === rec;
                      return (
                        <div key={rec} onClick={() => setFilter(active ? 'ALL' : rec)}
                          style={{
                            background: active ? cfg.bg : 'var(--bg-card)',
                            border: `1px solid ${active ? cfg.color : 'var(--border)'}`,
                            borderRadius: 10, padding: '12px 10px', cursor: 'pointer', textAlign: 'center',
                          }}>
                          <div style={{ fontSize: 10, color: cfg.color, fontWeight: 600, marginBottom: 2 }}>
                            {rec.split(' ').map(w => w[0]).join('')}
                          </div>
                          <div style={{ fontSize: 22, fontWeight: 700 }}>{count}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8, fontWeight: 600 }}>Risk Level</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    {['LOW', 'MEDIUM', 'HIGH'].map(level => {
                      const cfg = RISK_CONFIG[level];
                      const count = riskCounts[level];
                      const active = riskFilter === level;
                      return (
                        <div key={level} onClick={() => setRiskFilter(active ? 'ALL' : level)}
                          style={{
                            background: active ? cfg.bg : 'var(--bg-card)',
                            border: `1px solid ${active ? cfg.color : 'var(--border)'}`,
                            borderRadius: 10, padding: '12px 14px', cursor: 'pointer', textAlign: 'center',
                          }}>
                          <div style={{ fontSize: 10, color: cfg.color, fontWeight: 600, marginBottom: 2 }}>{level} RISK</div>
                          <div style={{ fontSize: 22, fontWeight: 700 }}>{count}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* === GROWTH TREND TAB === */}
          {activeTab === 'growth' && (
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Growth Trend</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Weighted-average revenue & earnings growth across portfolio</div>
              {!growthData && !growthLoading && (
                <button
                  onClick={() => {
                    setGrowthLoading(true);
                    api.getGrowthTrend(portfolioName)
                      .then(d => { if (!d.error) setGrowthData(d); })
                      .catch(() => {})
                      .finally(() => setGrowthLoading(false));
                  }}
                  style={{
                    padding: '10px 24px', borderRadius: 8, border: 'none',
                    background: 'var(--accent-blue)', color: 'white',
                    fontWeight: 600, fontSize: 13, cursor: 'pointer',
                  }}
                >
                  Run Growth Analysis
                </button>
              )}
              {growthLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', fontSize: 13 }}>
                  <div className="spinner" style={{ width: 18, height: 18 }} /> Fetching multi-year financials...
                </div>
              )}
              {growthData && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
                    {[
                      { label: 'Revenue CAGR', value: growthData.portfolio?.weighted_revenue_cagr, suffix: '%' },
                      { label: 'Earnings CAGR', value: growthData.portfolio?.weighted_earnings_cagr, suffix: '%' },
                      { label: 'Stocks Analysed', value: `${growthData.portfolio?.stock_count} / ${growthData.portfolio?.total_count}`, raw: true },
                    ].map(m => (
                      <div key={m.label} style={{
                        background: 'var(--bg-secondary)', borderRadius: 8, padding: 14,
                        border: '1px solid var(--border)',
                      }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>{m.label}</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: m.raw ? 'var(--text-primary)' : (m.value > 0 ? '#22c55e' : m.value < 0 ? '#ef4444' : 'var(--text-primary)') }}>
                          {m.raw ? m.value : (m.value != null ? `${m.value > 0 ? '+' : ''}${m.value}${m.suffix}` : 'N/A')}
                        </div>
                      </div>
                    ))}
                  </div>
                  {growthData.stocks?.length > 0 && (
                    <ResponsiveContainer width="100%" height={Math.max(200, growthData.stocks.length * 28)}>
                      <BarChart data={growthData.stocks} layout="vertical" margin={{ left: 80, right: 20 }}>
                        <XAxis type="number" tickFormatter={v => `${v}%`} stroke="var(--text-muted)" fontSize={11} />
                        <YAxis dataKey="symbol" type="category" width={75} stroke="var(--text-muted)" fontSize={11} />
                        <Tooltip
                          contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                          formatter={(v) => [`${v != null ? v.toFixed(1) : 'N/A'}%`]}
                        />
                        <Bar dataKey="revenue_cagr" name="Revenue CAGR" radius={[0, 4, 4, 0]}>
                          {growthData.stocks.map((s, i) => (
                            <Cell key={i} fill={s.category === 'LEADER' ? '#22c55e' : s.category === 'LAGGARD' ? '#ef4444' : '#eab308'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                  <div className="table-container" style={{ marginTop: 12 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Symbol</th><th>Name</th><th>Weight %</th><th>Revenue CAGR</th><th>Earnings CAGR</th><th>Years</th><th>Category</th>
                        </tr>
                      </thead>
                      <tbody>
                        {growthData.stocks.map(s => (
                          <tr key={s.symbol}>
                            <td style={{ fontWeight: 600 }}>{s.symbol}</td>
                            <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</td>
                            <td style={{ fontSize: 12 }}>{s.weight_pct != null ? `${s.weight_pct}%` : '--'}</td>
                            <td style={{ fontWeight: 600, color: s.revenue_cagr > 0 ? '#22c55e' : s.revenue_cagr < 0 ? '#ef4444' : 'var(--text-primary)' }}>
                              {s.revenue_cagr != null ? `${s.revenue_cagr > 0 ? '+' : ''}${s.revenue_cagr}%` : '--'}
                            </td>
                            <td style={{ fontWeight: 600, color: s.earnings_cagr > 0 ? '#22c55e' : s.earnings_cagr < 0 ? '#ef4444' : 'var(--text-primary)' }}>
                              {s.earnings_cagr != null ? `${s.earnings_cagr > 0 ? '+' : ''}${s.earnings_cagr}%` : '--'}
                            </td>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.years}</td>
                            <td>
                              <span style={{
                                padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700,
                                background: s.category === 'LEADER' ? 'rgba(34,197,94,0.15)' : s.category === 'LAGGARD' ? 'rgba(239,68,68,0.15)' : 'rgba(234,179,8,0.15)',
                                color: s.category === 'LEADER' ? '#22c55e' : s.category === 'LAGGARD' ? '#ef4444' : '#eab308',
                              }}>{s.category}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* === VALUATION TREND TAB === */}
          {activeTab === 'valuation' && (
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Valuation Trend</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Long-term PE using average EPS over multiple years</div>
                {!valData && !valLoading && (
                  <button
                    onClick={() => {
                      setValLoading(true);
                      api.getValuationTrend(portfolioName)
                        .then(d => { if (!d.error) setValData(d); })
                        .catch(() => {})
                        .finally(() => setValLoading(false));
                    }}
                    style={{
                      padding: '10px 24px', borderRadius: 8, border: 'none',
                      background: 'var(--accent-blue)', color: 'white',
                      fontWeight: 600, fontSize: 13, cursor: 'pointer',
                    }}
                  >
                    Run Valuation Analysis
                  </button>
                )}
                {valLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', fontSize: 13 }}>
                    <div className="spinner" style={{ width: 18, height: 18 }} /> Fetching multi-year financials...
                  </div>
                )}
                {valData && (
                  <>
                    {/* Summary */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
                      {[
                        { label: 'Median Current PE', value: valData.portfolio?.median_current_pe },
                        { label: 'Median Long-term PE', value: valData.portfolio?.median_longterm_pe },
                        { label: 'Stocks Analysed', value: `${valData.portfolio?.stock_count} / ${valData.portfolio?.total_count}`, raw: true },
                      ].map(m => (
                        <div key={m.label} style={{
                          background: 'var(--bg-secondary)', borderRadius: 8, padding: 14,
                          border: '1px solid var(--border)',
                        }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>{m.label}</div>
                          <div style={{ fontSize: 20, fontWeight: 700 }}>
                            {m.raw ? m.value : (m.value != null ? m.value.toFixed(1) : 'N/A')}
                          </div>
                        </div>
                      ))}
                    </div>
                    {valData.portfolio?.assessment && (
                      <div style={{
                        padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13,
                        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                        color: 'var(--text-secondary)',
                      }}>
                        {valData.portfolio.assessment}
                      </div>
                    )}
                    {/* Grouped Bar Chart */}
                    {valData.stocks?.length > 0 && (
                      <ResponsiveContainer width="100%" height={Math.max(250, valData.stocks.length * 32)}>
                        <BarChart data={valData.stocks} layout="vertical" margin={{ left: 80, right: 20 }}>
                          <XAxis type="number" stroke="var(--text-muted)" fontSize={11} />
                          <YAxis dataKey="symbol" type="category" width={75} stroke="var(--text-muted)" fontSize={11} />
                          <Tooltip
                            contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                            formatter={(v, name) => [v != null ? v.toFixed(1) : 'N/A', name]}
                          />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                          <Bar dataKey="current_pe" name="Current PE" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={10} />
                          <Bar dataKey="longterm_pe" name="Long-term PE" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={10} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                    {/* Table */}
                    <div className="table-container" style={{ marginTop: 12 }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Symbol</th>
                            <th>Name</th>
                            <th>CMP</th>
                            <th>Current PE</th>
                            <th>Long-term PE</th>
                            <th>Avg EPS</th>
                            <th>Latest EPS</th>
                            <th>Years</th>
                            <th>Assessment</th>
                          </tr>
                        </thead>
                        <tbody>
                          {valData.stocks.map(s => (
                            <tr key={s.symbol}>
                              <td style={{ fontWeight: 600 }}>{s.symbol}</td>
                              <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</td>
                              <td style={{ fontSize: 12 }}>{s.cmp != null ? `\u20B9${Number(s.cmp).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '--'}</td>
                              <td style={{ fontWeight: 600 }}>{s.current_pe != null ? s.current_pe.toFixed(1) : '--'}</td>
                              <td style={{ fontWeight: 600, color: '#f59e0b' }}>{s.longterm_pe != null ? s.longterm_pe.toFixed(1) : '--'}</td>
                              <td style={{ fontSize: 12 }}>{s.avg_eps != null ? `\u20B9${s.avg_eps.toFixed(1)}` : '--'}</td>
                              <td style={{ fontSize: 12 }}>{s.latest_eps != null ? `\u20B9${s.latest_eps.toFixed(1)}` : '--'}</td>
                              <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.eps_years}</td>
                              <td>
                                <span style={{
                                  padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700,
                                  background: s.assessment === 'IMPROVING' ? 'rgba(34,197,94,0.15)' : s.assessment === 'DETERIORATING' ? 'rgba(239,68,68,0.15)' : 'rgba(234,179,8,0.15)',
                                  color: s.assessment === 'IMPROVING' ? '#22c55e' : s.assessment === 'DETERIORATING' ? '#ef4444' : '#eab308',
                                }}>
                                  {s.assessment}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
            </div>
          )}

          {activeTab === 'calendar' && (
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Portfolio Calendar</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Track dividends, splits & corporate actions</div>
                {!calData && !calLoading && (
                  <button
                    onClick={() => {
                      setCalLoading(true);
                      api.getPortfolioCalendar(portfolioName)
                        .then(d => { if (!d.error) setCalData(d); })
                        .catch(() => {})
                        .finally(() => setCalLoading(false));
                    }}
                    style={{
                      padding: '10px 24px', borderRadius: 8, border: 'none',
                      background: 'var(--accent-blue)', color: 'white',
                      fontWeight: 600, fontSize: 13, cursor: 'pointer',
                    }}
                  >
                    Load Calendar Events
                  </button>
                )}
                {calLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', fontSize: 13 }}>
                    <div className="spinner" style={{ width: 18, height: 18 }} /> Fetching dividend & split history...
                  </div>
                )}
                {calData && (
                  <>
                    {/* Summary */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
                      {[
                        { label: 'Dividend Stocks', value: calData.summary?.total_dividend_stocks, raw: true },
                        { label: 'Avg Yield', value: calData.summary?.avg_portfolio_yield, suffix: '%' },
                        { label: 'Upcoming Events', value: calData.summary?.upcoming_count, raw: true },
                        { label: 'Recent Events', value: calData.summary?.recent_count, raw: true },
                      ].map(m => (
                        <div key={m.label} style={{
                          background: 'var(--bg-secondary)', borderRadius: 8, padding: 14,
                          border: '1px solid var(--border)',
                        }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>{m.label}</div>
                          <div style={{ fontSize: 20, fontWeight: 700, color: m.raw ? 'var(--text-primary)' : '#22c55e' }}>
                            {m.raw ? (m.value ?? 'N/A') : (m.value != null ? `${m.value}${m.suffix}` : 'N/A')}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Upcoming Events */}
                    {calData.upcoming?.length > 0 && (
                      <>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--text-secondary)' }}>UPCOMING (Estimated)</div>
                        <div className="table-container" style={{ marginBottom: 16 }}>
                          <table>
                            <thead>
                              <tr>
                                <th>Symbol</th>
                                <th>Event</th>
                                <th>Est. Date</th>
                                <th>Amount</th>
                                <th>Yield</th>
                                <th>CMP</th>
                                <th>Confidence</th>
                              </tr>
                            </thead>
                            <tbody>
                              {calData.upcoming.map((e, i) => (
                                <tr key={i}>
                                  <td style={{ fontWeight: 600 }}>{e.symbol}</td>
                                  <td>
                                    <span style={{
                                      padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700,
                                      background: e.event === 'DIVIDEND' ? 'rgba(34,197,94,0.15)' : 'rgba(59,130,246,0.15)',
                                      color: e.event === 'DIVIDEND' ? '#22c55e' : '#3b82f6',
                                    }}>{e.event}</span>
                                  </td>
                                  <td style={{ fontSize: 12 }}>{e.estimated_date}</td>
                                  <td style={{ fontSize: 12, fontWeight: 600 }}>{e.amount != null ? `\u20B9${e.amount}` : '--'}</td>
                                  <td style={{ fontSize: 12, color: '#22c55e' }}>{e.yield_pct != null ? `${e.yield_pct}%` : '--'}</td>
                                  <td style={{ fontSize: 12 }}>{e.cmp != null ? `\u20B9${Number(e.cmp).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '--'}</td>
                                  <td>
                                    <span style={{
                                      padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700,
                                      background: e.confidence === 'REGULAR' ? 'rgba(34,197,94,0.15)' : 'rgba(234,179,8,0.15)',
                                      color: e.confidence === 'REGULAR' ? '#22c55e' : '#eab308',
                                    }}>{e.confidence}</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}

                    {/* Recent Events */}
                    {calData.recent?.length > 0 && (
                      <>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--text-secondary)' }}>RECENT (Last 6 Months)</div>
                        <div className="table-container">
                          <table>
                            <thead>
                              <tr>
                                <th>Symbol</th>
                                <th>Event</th>
                                <th>Date</th>
                                <th>Amount / Ratio</th>
                                <th>Yield</th>
                              </tr>
                            </thead>
                            <tbody>
                              {calData.recent.map((e, i) => (
                                <tr key={i}>
                                  <td style={{ fontWeight: 600 }}>{e.symbol}</td>
                                  <td>
                                    <span style={{
                                      padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700,
                                      background: e.event === 'DIVIDEND' ? 'rgba(34,197,94,0.15)' : e.event === 'SPLIT' ? 'rgba(59,130,246,0.15)' : 'rgba(234,179,8,0.15)',
                                      color: e.event === 'DIVIDEND' ? '#22c55e' : e.event === 'SPLIT' ? '#3b82f6' : '#eab308',
                                    }}>{e.event}</span>
                                  </td>
                                  <td style={{ fontSize: 12 }}>{e.date}</td>
                                  <td style={{ fontSize: 12, fontWeight: 600 }}>
                                    {e.event === 'SPLIT' ? e.ratio : (e.amount != null ? `\u20B9${e.amount}` : '--')}
                                  </td>
                                  <td style={{ fontSize: 12, color: '#22c55e' }}>{e.yield_pct != null ? `${e.yield_pct}%` : '--'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                    {(!calData.upcoming || calData.upcoming.length === 0) && (!calData.recent || calData.recent.length === 0) && (
                      <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No dividend or split events found in the last 6 months.</div>
                    )}
                  </>
                )}
            </div>
          )}

          {/* === HEDGE TAB === */}
          {activeTab === 'hedge' && (
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Portfolio Hedge</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>De-risk your portfolio with hedging strategies</div>
                {!hedgeData && !hedgeLoading && (
                  <button
                    onClick={() => {
                      setHedgeLoading(true);
                      api.getPortfolioHedge(portfolioName)
                        .then(d => { if (!d.error) setHedgeData(d); })
                        .catch(() => {})
                        .finally(() => setHedgeLoading(false));
                    }}
                    style={{
                      padding: '10px 24px', borderRadius: 8, border: 'none',
                      background: 'var(--accent-blue)', color: 'white',
                      fontWeight: 600, fontSize: 13, cursor: 'pointer',
                    }}
                  >
                    Run Hedge Analysis
                  </button>
                )}
                {hedgeLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', fontSize: 13 }}>
                    <div className="spinner" style={{ width: 18, height: 18 }} /> Computing portfolio beta & hedge levels...
                  </div>
                )}
                {hedgeData && (
                  <>
                    {/* Beta & Risk Summary */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
                      {[
                        { label: 'Portfolio Beta', value: hedgeData.portfolio_beta, color: hedgeData.portfolio_beta > 1.2 ? '#ef4444' : hedgeData.portfolio_beta > 0.8 ? '#eab308' : '#22c55e' },
                        { label: 'Nifty50 Price', value: hedgeData.nifty_price != null ? `\u20B9${Number(hedgeData.nifty_price).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : 'N/A', raw: true },
                        { label: 'Correlation', value: hedgeData.portfolio_correlation },
                        { label: 'Risk Level', value: hedgeData.risk_assessment, raw: true,
                          color: hedgeData.risk_assessment === 'HIGH' ? '#ef4444' : hedgeData.risk_assessment === 'MODERATE' ? '#eab308' : '#22c55e' },
                      ].map(m => (
                        <div key={m.label} style={{
                          background: 'var(--bg-secondary)', borderRadius: 8, padding: 14,
                          border: '1px solid var(--border)',
                        }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>{m.label}</div>
                          <div style={{ fontSize: 20, fontWeight: 700, color: m.color || 'var(--text-primary)' }}>
                            {m.raw ? m.value : (m.value != null ? m.value : 'N/A')}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Protection Levels */}
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--text-secondary)' }}>PROTECTION LEVELS</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 16 }}>
                      {hedgeData.protection_levels?.map(p => {
                        const levelColor = p.level === 'Light' ? '#22c55e' : p.level === 'Moderate' ? '#eab308' : '#ef4444';
                        return (
                          <div key={p.level} style={{
                            background: 'var(--bg-secondary)', borderRadius: 10, padding: 16,
                            border: `1px solid ${levelColor}33`,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                              <span style={{
                                padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                                background: `${levelColor}22`, color: levelColor,
                              }}>{p.level} ({p.hedge_pct}%)</span>
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>{p.description}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                              <div>
                                <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>NIFTY LOTS</div>
                                <div style={{ fontSize: 18, fontWeight: 700 }}>{p.nifty_lots}</div>
                              </div>
                              <div>
                                <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>EST. COST/MO</div>
                                <div style={{ fontSize: 18, fontWeight: 700 }}>{p.estimated_monthly_cost_pct}%</div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Stock Betas Table */}
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--text-secondary)' }}>STOCK-LEVEL BETAS</div>
                    <div className="table-container">
                      <table>
                        <thead>
                          <tr>
                            <th>Symbol</th>
                            <th>Name</th>
                            <th>Beta</th>
                            <th>Correlation</th>
                            <th>Weight %</th>
                            <th>Beta Contribution</th>
                          </tr>
                        </thead>
                        <tbody>
                          {hedgeData.stocks?.map(s => (
                            <tr key={s.symbol}>
                              <td style={{ fontWeight: 600 }}>{s.symbol}</td>
                              <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</td>
                              <td style={{ fontWeight: 700, color: s.beta > 1.2 ? '#ef4444' : s.beta > 0.8 ? '#eab308' : '#22c55e' }}>
                                {s.beta != null ? s.beta.toFixed(2) : '--'}
                              </td>
                              <td style={{ fontSize: 12 }}>{s.correlation != null ? s.correlation.toFixed(2) : '--'}</td>
                              <td style={{ fontSize: 12 }}>{s.weight_pct != null ? `${s.weight_pct}%` : '--'}</td>
                              <td style={{ fontSize: 12 }}>{s.contribution_to_beta != null ? s.contribution_to_beta.toFixed(3) : '--'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
            </div>
          )}

          {/* === REPORT TAB === */}
          {activeTab === 'report' && (
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Portfolio Report</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Performance, diversification, benchmark comparison & risk</div>
                {!reportData && !reportLoading && (
                  <button
                    onClick={() => {
                      setReportLoading(true);
                      api.getPortfolioReport(portfolioName)
                        .then(d => { if (!d.error) setReportData(d); })
                        .catch(() => {})
                        .finally(() => setReportLoading(false));
                    }}
                    style={{
                      padding: '10px 24px', borderRadius: 8, border: 'none',
                      background: 'var(--accent-blue)', color: 'white',
                      fontWeight: 600, fontSize: 13, cursor: 'pointer',
                    }}
                  >
                    Generate Portfolio Report
                  </button>
                )}
                {reportLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', fontSize: 13 }}>
                    <div className="spinner" style={{ width: 18, height: 18 }} /> Generating comprehensive report...
                  </div>
                )}
                {reportData && (
                  <>
                    {/* Performance vs Nifty50 */}
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--text-secondary)' }}>PERFORMANCE vs NIFTY50</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
                      {['1m', '3m', '6m', '1y'].map(period => {
                        const p = reportData.performance?.[period];
                        const alpha = p?.alpha;
                        return (
                          <div key={period} style={{
                            background: 'var(--bg-secondary)', borderRadius: 8, padding: 14,
                            border: `1px solid ${alpha > 0 ? 'rgba(34,197,94,0.3)' : alpha < 0 ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`,
                          }}>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>{period.toUpperCase()} Alpha</div>
                            <div style={{ fontSize: 22, fontWeight: 700, color: alpha > 0 ? '#22c55e' : alpha < 0 ? '#ef4444' : 'var(--text-primary)' }}>
                              {alpha != null ? `${alpha > 0 ? '+' : ''}${alpha}%` : 'N/A'}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                              Portfolio: {p?.portfolio_pct != null ? `${p.portfolio_pct > 0 ? '+' : ''}${p.portfolio_pct}%` : '--'} | Nifty: {p?.nifty_pct != null ? `${p.nifty_pct > 0 ? '+' : ''}${p.nifty_pct}%` : '--'}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Sector Allocation */}
                    {reportData.sector_allocation?.length > 0 && (
                      <>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--text-secondary)' }}>SECTOR ALLOCATION</div>
                        <ResponsiveContainer width="100%" height={Math.max(180, reportData.sector_allocation.length * 28)}>
                          <BarChart data={reportData.sector_allocation} layout="vertical" margin={{ left: 120, right: 20 }}>
                            <XAxis type="number" tickFormatter={v => `${v}%`} stroke="var(--text-muted)" fontSize={11} />
                            <YAxis dataKey="sector" type="category" width={115} stroke="var(--text-muted)" fontSize={10} />
                            <Tooltip
                              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                              formatter={(v, name) => [`${v}%`, name]}
                            />
                            <Bar dataKey="weight_pct" name="Weight" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                        <div className="table-container" style={{ marginTop: 8, marginBottom: 16 }}>
                          <table>
                            <thead>
                              <tr>
                                <th>Sector</th>
                                <th>Stocks</th>
                                <th>Weight %</th>
                                <th>Avg Return</th>
                              </tr>
                            </thead>
                            <tbody>
                              {reportData.sector_allocation.map(s => (
                                <tr key={s.sector}>
                                  <td style={{ fontWeight: 600, fontSize: 12 }}>{s.sector}</td>
                                  <td style={{ fontSize: 12 }}>{s.count}</td>
                                  <td style={{ fontSize: 12, fontWeight: 600 }}>{s.weight_pct}%</td>
                                  <td style={{ fontSize: 12, fontWeight: 600, color: s.avg_return_pct > 0 ? '#22c55e' : s.avg_return_pct < 0 ? '#ef4444' : 'var(--text-primary)' }}>
                                    {s.avg_return_pct != null ? `${s.avg_return_pct > 0 ? '+' : ''}${s.avg_return_pct}%` : '--'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}

                    {/* Risk Summary & Concentration */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                      {/* Risk Summary */}
                      <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: 16, border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10, color: 'var(--text-secondary)' }}>RISK SUMMARY</div>
                        {[
                          { label: 'Avg Volatility', value: reportData.risk_summary?.avg_volatility, suffix: '%' },
                          { label: 'Worst Drawdown', value: reportData.risk_summary?.max_drawdown_worst, suffix: '%' },
                          { label: 'High Vol Stocks', value: reportData.risk_summary?.high_vol_count, raw: true },
                        ].map(m => (
                          <div key={m.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.label}</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: m.raw ? 'var(--text-primary)' : (m.value < 0 ? '#ef4444' : m.value > 30 ? '#eab308' : '#22c55e') }}>
                              {m.value != null ? (m.raw ? m.value : `${m.value}${m.suffix}`) : 'N/A'}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Concentration */}
                      <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: 16, border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10, color: 'var(--text-secondary)' }}>CONCENTRATION</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Top 5 Weight</span>
                          <span style={{ fontSize: 13, fontWeight: 700 }}>{reportData.concentration?.top5_weight_pct}%</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>HHI Index</span>
                          <span style={{ fontSize: 13, fontWeight: 700 }}>{reportData.concentration?.hhi_index}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Assessment</span>
                          <span style={{
                            padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700,
                            background: reportData.concentration?.assessment === 'LOW' ? 'rgba(34,197,94,0.15)' : reportData.concentration?.assessment === 'HIGH' ? 'rgba(239,68,68,0.15)' : 'rgba(234,179,8,0.15)',
                            color: reportData.concentration?.assessment === 'LOW' ? '#22c55e' : reportData.concentration?.assessment === 'HIGH' ? '#ef4444' : '#eab308',
                          }}>{reportData.concentration?.assessment}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Top 5</span>
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{reportData.concentration?.top5_stocks?.join(', ')}</span>
                        </div>
                      </div>
                    </div>

                    {/* Diversification Score */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--text-secondary)' }}>DIVERSIFICATION SCORE</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          flex: 1, height: 12, background: 'var(--bg-secondary)', borderRadius: 6,
                          overflow: 'hidden', border: '1px solid var(--border)',
                        }}>
                          <div style={{
                            width: `${reportData.diversification_score || 0}%`, height: '100%',
                            background: reportData.diversification_score >= 70 ? '#22c55e' : reportData.diversification_score >= 40 ? '#eab308' : '#ef4444',
                            borderRadius: 6, transition: 'width 0.5s',
                          }} />
                        </div>
                        <span style={{ fontSize: 16, fontWeight: 700, minWidth: 40, textAlign: 'right',
                          color: reportData.diversification_score >= 70 ? '#22c55e' : reportData.diversification_score >= 40 ? '#eab308' : '#ef4444',
                        }}>
                          {reportData.diversification_score}/100
                        </span>
                      </div>
                    </div>
                  </>
                )}
            </div>
          )}

          {/* === SECTOR MIX TAB === */}
          {activeTab === 'sector-mix' && <SectorMixTab data={data} />}

          {/* === AI ANALYSIS TAB === */}
          {activeTab === 'ai-analysis' && (
            <PortfolioAITab portfolioName={portfolioName} />
          )}

          {/* === DEFENSE MODE TAB === */}
          {activeTab === 'defense' && (
            <DefenseModeView initialSource={`portfolio:${portfolioName}`} onSelectStock={() => {}} />
          )}

          {/* === VALUATION ASSESSMENT TAB === */}
          {activeTab === 'val-assess' && (
            <PortfolioValuationTab portfolioName={portfolioName} />
          )}

          {/* === REBALANCE TAB === */}
          {activeTab === 'rebalance' && (() => {
            // ── Regime colour map ─────────────────────────────────────────
            const REGIME_COLOR = {
              STRONG_BULL: '#22c55e', BULL: '#86efac',
              NEUTRAL: '#eab308',
              BEAR: '#f97316', STRONG_BEAR: '#ef4444',
            };
            const REGIME_BG = {
              STRONG_BULL: 'rgba(34,197,94,0.12)', BULL: 'rgba(134,239,172,0.10)',
              NEUTRAL: 'rgba(234,179,8,0.10)',
              BEAR: 'rgba(249,115,22,0.10)', STRONG_BEAR: 'rgba(239,68,68,0.12)',
            };
            const mc = rebalData?.market_condition || marketCondition;
            const regime = mc?.regime || null;
            const regimeColor = REGIME_COLOR[regime] || '#64748b';
            const regimeBg   = REGIME_BG[regime]    || 'rgba(100,116,139,0.08)';

            // ── Market Condition Banner ───────────────────────────────────
            const MarketBanner = () => {
              if (!mc) return null;
              const { nifty_price, nifty_change_pct, nifty_vs_50dma_pct, nifty_vs_200dma_pct,
                      vix, roc_20d_pct, trend_direction, regime_score,
                      equity_allocation_min, equity_allocation_max,
                      sector_bias } = mc;
              return (
                <div style={{ background: regimeBg, border: `1px solid ${regimeColor}44`,
                              borderRadius: 12, padding: '14px 18px', marginBottom: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                    <span style={{ fontWeight: 800, fontSize: 18, color: regimeColor }}>
                      {regime?.replace('_', ' ')}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)',
                                   background: 'var(--bg-secondary)', borderRadius: 6, padding: '2px 8px' }}>
                      Score {regime_score > 0 ? '+' : ''}{regime_score ?? '—'}
                    </span>
                    {trend_direction && trend_direction !== 'UNKNOWN' && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: trend_direction === 'UPTREND' ? '#22c55e' : trend_direction === 'DOWNTREND' ? '#ef4444' : '#eab308' }}>
                        {trend_direction}
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                      Equity Allocation: <strong style={{ color: regimeColor }}>{equity_allocation_min}–{equity_allocation_max}%</strong>
                    </span>
                  </div>

                  {/* Nifty stats row */}
                  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 10 }}>
                    {nifty_price && (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Nifty 50</div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>
                          {Number(nifty_price).toLocaleString('en-IN')}
                          {nifty_change_pct != null && (
                            <span style={{ fontSize: 11, marginLeft: 6, color: nifty_change_pct >= 0 ? '#22c55e' : '#ef4444' }}>
                              {nifty_change_pct >= 0 ? '+' : ''}{nifty_change_pct}%
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    {nifty_vs_50dma_pct != null && (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>vs 50 DMA</div>
                        <div style={{ fontWeight: 600, fontSize: 13, color: nifty_vs_50dma_pct >= 0 ? '#22c55e' : '#ef4444' }}>
                          {nifty_vs_50dma_pct >= 0 ? '+' : ''}{nifty_vs_50dma_pct?.toFixed(1)}%
                        </div>
                      </div>
                    )}
                    {nifty_vs_200dma_pct != null && (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>vs 200 DMA</div>
                        <div style={{ fontWeight: 600, fontSize: 13, color: nifty_vs_200dma_pct >= 0 ? '#22c55e' : '#ef4444' }}>
                          {nifty_vs_200dma_pct >= 0 ? '+' : ''}{nifty_vs_200dma_pct?.toFixed(1)}%
                        </div>
                      </div>
                    )}
                    {vix != null && (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>India VIX</div>
                        <div style={{ fontWeight: 600, fontSize: 13, color: vix > 25 ? '#ef4444' : vix > 18 ? '#f97316' : '#22c55e' }}>
                          {vix?.toFixed(1)}
                        </div>
                      </div>
                    )}
                    {roc_20d_pct != null && (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>20d ROC</div>
                        <div style={{ fontWeight: 600, fontSize: 13, color: roc_20d_pct >= 0 ? '#22c55e' : '#ef4444' }}>
                          {roc_20d_pct >= 0 ? '+' : ''}{roc_20d_pct?.toFixed(1)}%
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Sector bias */}
                  {sector_bias && (
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      {sector_bias.favour?.length > 0 && (
                        <div style={{ fontSize: 11 }}>
                          <span style={{ color: '#22c55e', fontWeight: 700 }}>Favour: </span>
                          <span style={{ color: 'var(--text-secondary)' }}>{sector_bias.favour.join(', ')}</span>
                        </div>
                      )}
                      {sector_bias.avoid?.length > 0 && (
                        <div style={{ fontSize: 11 }}>
                          <span style={{ color: '#ef4444', fontWeight: 700 }}>Avoid: </span>
                          <span style={{ color: 'var(--text-secondary)' }}>{sector_bias.avoid.join(', ')}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {sector_bias?.note && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, fontStyle: 'italic' }}>
                      {sector_bias.note}
                    </div>
                  )}
                </div>
              );
            };

            // ── Stock card used in all 3 columns ─────────────────────────
            const Section = ({ title, items, color, bg }) => (
              <div style={{ flex: '1 1 280px' }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ background: color, color: '#fff', borderRadius: 6, padding: '2px 8px', fontSize: 11 }}>{items.length}</span>
                  {title}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {items.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '12px 0' }}>None</div>
                  )}
                  {items.map((s, i) => (
                    <div key={i} style={{ background: bg, borderRadius: 10, padding: '12px 14px', border: `1px solid ${color}33` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                        <div>
                          <span style={{ fontWeight: 800, fontSize: 13 }}>{s.symbol?.replace('.NS', '')}</span>
                          {s.name && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>{s.name}</span>}
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: color + '22', color }}>
                          {s.action}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
                        {s.cmp && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>₹{Number(s.cmp).toLocaleString('en-IN')}</span>}
                        {s.sector && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.sector}</span>}
                        {s.score != null && <span style={{ fontSize: 11, color: 'var(--accent-blue)' }}>Score {s.score?.toFixed(0)}</span>}
                        {s.fundamental_score != null && <span style={{ fontSize: 11, color: 'var(--accent-blue)' }}>F-Score {s.fundamental_score}</span>}
                        {s.risk_level && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8,
                            background: s.risk_level === 'LOW' ? '#22c55e22' : s.risk_level === 'HIGH' ? '#ef444422' : '#eab30822',
                            color: s.risk_level === 'LOW' ? '#22c55e' : s.risk_level === 'HIGH' ? '#ef4444' : '#eab308' }}>
                            {s.risk_level} RISK
                          </span>
                        )}
                        {s.recommendation && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{s.recommendation}</span>}
                      </div>
                      {s.reason && <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>{s.reason}</div>}
                    </div>
                  ))}
                </div>
              </div>
            );

            return (
              <div className="card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>Rebalance Advisor</div>
                  {regime && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20,
                      background: regimeBg, color: regimeColor, border: `1px solid ${regimeColor}44` }}>
                      Market: {regime.replace('_', ' ')}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                  Market-condition-aware rebalancing — suggestions adjust dynamically based on Nifty trend, VIX, and DMA.
                </div>

                {/* Check market condition only */}
                {!mc && !mcLoading && !rebalData && (
                  <button
                    onClick={() => {
                      setMcLoading(true);
                      api.getMarketCondition()
                        .then(d => { if (!d.error) setMarketCondition(d); })
                        .catch(() => {})
                        .finally(() => setMcLoading(false));
                    }}
                    style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent',
                             color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600, fontSize: 12, marginRight: 10 }}
                  >
                    Check Market Condition
                  </button>
                )}

                {!rebalData && !rebalLoading && (
                  <button
                    onClick={() => {
                      setRebalLoading(true);
                      api.getRebalance(portfolioName)
                        .then(d => { if (!d.error) { setRebalData(d); if (d.market_condition) setMarketCondition(d.market_condition); } })
                        .catch(() => {})
                        .finally(() => setRebalLoading(false));
                    }}
                    style={{ padding: '10px 22px', borderRadius: 8, border: 'none', background: 'var(--accent-blue)', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}
                  >
                    Run Rebalance Analysis
                  </button>
                )}

                {(rebalLoading || mcLoading) && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0' }}>
                    {mcLoading ? 'Fetching market condition...' : 'Analysing portfolio vs market conditions...'}
                  </div>
                )}

                {/* Show market banner even before running full rebalance */}
                {mc && !rebalData && <MarketBanner />}

                {rebalData && (
                  <>
                    <MarketBanner />

                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
                      {[
                        { label: 'Total Holdings', value: rebalData.total_holdings },
                        { label: 'Add', value: rebalData.add?.length, color: '#22c55e' },
                        { label: 'Trim / Exit', value: rebalData.trim?.length, color: '#ef4444' },
                        { label: 'Keep / Hold', value: rebalData.keep?.length, color: '#3b82f6' },
                      ].map(c => (
                        <div key={c.label} style={{ flex: '1 1 100px', background: 'var(--bg-secondary)', borderRadius: 10, padding: '10px 14px', minWidth: 90 }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{c.label}</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: c.color || 'var(--text-primary)' }}>{c.value ?? '—'}</div>
                        </div>
                      ))}
                      <button
                        onClick={() => { setRebalData(null); setMarketCondition(null); setRebalLoading(false); }}
                        style={{ alignSelf: 'center', padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11 }}
                      >
                        Refresh
                      </button>
                    </div>

                    {/* ── AUTO-REBALANCE: Score-Proportional Allocation ── */}
                    {rebalData.auto_rebalance?.length > 0 && (() => {
                      const ar = rebalData.auto_rebalance;
                      const increaseCount = ar.filter(r => r.action === 'INCREASE').length;
                      const reduceCount   = ar.filter(r => r.action === 'REDUCE').length;
                      const maxScore = Math.max(...ar.map(r => r.score || 0));
                      return (
                        <div className="card" style={{ marginBottom: 20, padding: '16px 18px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 14, fontWeight: 800 }}>Auto-Rebalance Plan</span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-secondary)', padding: '2px 8px', borderRadius: 5 }}>
                              Score-proportional target weights
                            </span>
                            {increaseCount > 0 && (
                              <span style={{ fontSize: 11, fontWeight: 700, color: '#22c55e' }}>↑ Increase {increaseCount}</span>
                            )}
                            {reduceCount > 0 && (
                              <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444' }}>↓ Reduce {reduceCount}</span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>
                            Target weight = stock's composite score ÷ total portfolio score. Stocks scoring higher deserve a larger allocation.
                          </div>

                          {/* Visual weight bars */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {ar.map((r, i) => {
                              const actionColor = r.action === 'INCREASE' ? '#22c55e' : r.action === 'REDUCE' ? '#ef4444' : '#3b82f6';
                              const barWidth = Math.max(2, (r.target_weight_pct / (100 / ar.length * 2)) * 100);
                              const equalBarWidth = 50; // equal weight is always 50% visual width
                              return (
                                <div key={r.symbol} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 60px 60px 80px', gap: 8, alignItems: 'center' }}>
                                  {/* Symbol */}
                                  <div>
                                    <span style={{ fontWeight: 700, fontSize: 12 }}>{r.symbol}</span>
                                    {r.risk_level && (
                                      <span style={{ fontSize: 9, marginLeft: 5, color: r.risk_level === 'HIGH' ? '#ef4444' : r.risk_level === 'LOW' ? '#22c55e' : '#eab308' }}>
                                        {r.risk_level}
                                      </span>
                                    )}
                                  </div>
                                  {/* Stacked bar: equal-weight grey + target-weight colored */}
                                  <div style={{ position: 'relative', height: 18, background: 'var(--bg-secondary)', borderRadius: 4, overflow: 'hidden' }}>
                                    {/* Equal weight baseline */}
                                    <div style={{
                                      position: 'absolute', left: 0, top: 0, bottom: 0,
                                      width: `${r.equal_weight_pct / 30 * 100}%`,
                                      maxWidth: '100%',
                                      background: '#334155', borderRadius: 4,
                                    }} />
                                    {/* Target weight */}
                                    <div style={{
                                      position: 'absolute', left: 0, top: 0, bottom: 0,
                                      width: `${r.target_weight_pct / 30 * 100}%`,
                                      maxWidth: '100%',
                                      background: actionColor + '55',
                                      borderRight: `2px solid ${actionColor}`,
                                      borderRadius: 4,
                                    }} />
                                  </div>
                                  {/* Score */}
                                  <div style={{ fontSize: 11, textAlign: 'right', color: 'var(--text-muted)' }}>
                                    {r.score?.toFixed(0)}<span style={{ fontSize: 9, color: 'var(--text-muted)' }}>/100</span>
                                  </div>
                                  {/* Target % */}
                                  <div style={{ fontSize: 12, fontWeight: 700, textAlign: 'right', color: actionColor }}>
                                    {r.target_weight_pct?.toFixed(1)}%
                                  </div>
                                  {/* Action badge */}
                                  <div style={{
                                    fontSize: 10, fontWeight: 700, textAlign: 'center',
                                    padding: '2px 8px', borderRadius: 20,
                                    background: actionColor + '18', color: actionColor,
                                    border: `1px solid ${actionColor}44`,
                                  }}>
                                    {r.action === 'INCREASE' ? '↑ INCREASE' : r.action === 'REDUCE' ? '↓ REDUCE' : '= MAINTAIN'}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 10 }}>
                            Grey bar = equal weight ({ar[0]?.equal_weight_pct?.toFixed(1)}%). Colored bar = score-proportional target. Tolerance ±5%.
                          </div>
                        </div>
                      );
                    })()}

                    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                      <Section title="Add to Portfolio" items={rebalData.add || []} color="#22c55e" bg="rgba(34,197,94,0.05)" />
                      <Section title="Trim / Exit" items={rebalData.trim || []} color="#ef4444" bg="rgba(239,68,68,0.05)" />
                      <Section title="Keep / Hold" items={rebalData.keep || []} color="#3b82f6" bg="rgba(59,130,246,0.05)" />
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          {/* === STOCKS TAB: Main table === */}
          {activeTab === 'stocks' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    {[
                      ['symbol', 'Symbol'],
                      ['cmp', 'CMP'],
                      ['change_pct', 'Chg %'],
                      ['market_cap_cr', 'MCap Cr'],
                      ['promoter_holding_pct', 'Promoter %'],
                      ['supertrend_signal', 'ST Signal'],
                      ['risk_level', 'Risk'],
                      ['risk_score', 'Risk Score'],
                      ['volatility_ann', 'Volatility'],
                      ['signal', 'Signal'],
                      ['fundamental_score', 'Fund.'],
                      ['valuation_grade', 'Valuation'],
                      ['recommendation', 'Verdict'],
                      ['trend', 'Trend'],
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
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                            {r.type === 'ETF' ? 'ETF' : r.sector}
                          </div>
                        </td>
                        <td style={{ fontWeight: 500 }}>
                          {r.cmp != null ? `\u20B9${Number(r.cmp).toLocaleString('en-IN', { maximumFractionDigits: 1 })}` : 'N/A'}
                        </td>
                        <td>
                          {r.change_pct != null ? (
                            <span style={{ color: r.change_pct >= 0 ? '#22c55e' : '#ef4444', fontWeight: 600, fontSize: 12 }}>
                              {r.change_pct >= 0 ? '+' : ''}{r.change_pct}%
                            </span>
                          ) : <span style={{ color: '#64748b', fontSize: 11 }}>--</span>}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {r.market_cap_cr != null ? `${(r.market_cap_cr / 1000).toFixed(0)}K` : '--'}
                        </td>
                        <td style={{ fontSize: 12, fontWeight: 500 }}>
                          {r.promoter_holding_pct != null ? `${r.promoter_holding_pct}%` : '--'}
                        </td>
                        <td>
                          {r.supertrend_signal ? (
                            <span style={{
                              padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700,
                              background: r.supertrend_signal === 'BUY' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                              color: r.supertrend_signal === 'BUY' ? '#22c55e' : '#ef4444',
                            }}>
                              {r.supertrend_signal}
                            </span>
                          ) : <span style={{ color: '#64748b', fontSize: 11 }}>--</span>}
                        </td>
                        <td><RiskBadge level={r.risk_level} /></td>
                        <td><RiskMeter score={r.risk_score} /></td>
                        <td style={{ fontSize: 12 }}>
                          {r.volatility_ann != null ? `${r.volatility_ann}%` : 'N/A'}
                        </td>
                        <td>
                          <span style={{
                            padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                            background: (SIGNAL_COLORS[r.signal] || SIGNAL_COLORS.NO_DATA).bg,
                            color: (SIGNAL_COLORS[r.signal] || SIGNAL_COLORS.NO_DATA).color,
                          }}>
                            {r.signal}
                          </span>
                        </td>
                        <td>
                          {r.fundamental_score != null ? (
                            <span style={{
                              padding: '2px 8px', borderRadius: 4, fontWeight: 600, fontSize: 12,
                              background: r.fundamental_score >= 70 ? 'rgba(34,197,94,0.15)' : r.fundamental_score >= 50 ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.15)',
                              color: r.fundamental_score >= 70 ? '#22c55e' : r.fundamental_score >= 50 ? '#eab308' : '#ef4444',
                            }}>
                              {r.fundamental_score.toFixed(0)}
                            </span>
                          ) : <span style={{ color: '#64748b', fontSize: 11 }}>ETF</span>}
                        </td>
                        <td>
                          <span style={{
                            fontSize: 11, fontWeight: 600,
                            color: { CHEAP: '#22c55e', FAIR: '#3b82f6', EXPENSIVE: '#f97316', VERY_EXPENSIVE: '#ef4444' }[r.valuation_grade] || '#64748b',
                          }}>
                            {(r.valuation_grade || '').replace('_', ' ')}
                          </span>
                        </td>
                        <td><RecBadge rec={r.recommendation} /></td>
                        <td style={{ color: TREND_COLORS[r.trend] || '#64748b', fontWeight: 600, fontSize: 12 }}>
                          {r.trend}
                        </td>
                      </tr>,
                      isExpanded && (
                        <tr key={`${r.symbol}-detail`}>
                          <td colSpan={12} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
                            <StockDetail stock={r} portfolioName={portfolioName} onRemoved={() => loadData()} />
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </>
      )}
    </div>
  );
}

const AI_VERDICT_CONFIG = {
  'Strong Buy':  { bg: 'rgba(34,197,94,0.2)',   color: '#22c55e' },
  'Buy':         { bg: 'rgba(34,197,94,0.15)',  color: '#22c55e' },
  'Accumulate':  { bg: 'rgba(59,130,246,0.15)', color: '#3b82f6' },
  'Watch':       { bg: 'rgba(234,179,8,0.15)',  color: '#eab308' },
  'Wait':        { bg: 'rgba(249,115,22,0.15)', color: '#f97316' },
  'Sell':        { bg: 'rgba(239,68,68,0.2)',   color: '#ef4444' },
};

function StockDetail({ stock, portfolioName, onRemoved }) {
  const s = stock;
  const recColor = (REC_CONFIG[s.recommendation] || {}).color || '#64748b';

  const [aiData, setAiData] = useState(null);
  const [aiLoading, setAiLoading] = useState(true);

  useEffect(() => {
    const sym = (s.symbol || '').replace('.NS', '');
    setAiLoading(true);
    api.getAIInsights(sym)
      .then(d => setAiData(d))
      .catch(() => setAiData(null))
      .finally(() => setAiLoading(false));
  }, [s.symbol]);

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>{s.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.industry} | {s.sector}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ textAlign: 'right' }}>
            <RecBadge rec={s.recommendation} />
            <div style={{ marginTop: 6 }}>
              <RiskBadge level={s.risk_level} score={s.risk_score} />
            </div>
          </div>
          {onRemoved && (
            <button
              onClick={() => {
                const sym = (s.symbol || '').replace('.NS', '');
                api.removePortfolioStock(portfolioName, sym)
                  .then(() => onRemoved(sym))
                  .catch(() => {});
              }}
              style={{
                padding: '6px 12px', borderRadius: 6, border: 'none',
                background: 'rgba(239,68,68,0.15)', color: '#ef4444',
                cursor: 'pointer', fontSize: 11, fontWeight: 600,
              }}
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {/* AI Analysis Section */}
      <div style={{ marginBottom: 16, padding: '14px 16px', borderRadius: 10, background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.18)' }}>
        <div style={{ fontSize: 11, color: '#3b82f6', textTransform: 'uppercase', fontWeight: 700, marginBottom: 10, letterSpacing: '0.05em' }}>
          AI Stock Analysis (9-Skill)
        </div>
        {aiLoading ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 0' }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', border: '2px solid var(--accent-blue)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite', marginRight: 6, verticalAlign: 'middle' }} />
            Loading AI insights...
          </div>
        ) : !aiData ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>AI insights not available for this stock.</div>
        ) : (
          <>
            {/* Verdict + Fair Value row */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              {aiData.verdict && (() => {
                const vcfg = AI_VERDICT_CONFIG[aiData.verdict] || { bg: 'rgba(100,116,139,0.15)', color: '#94a3b8' };
                return (
                  <div style={{ background: vcfg.bg, borderRadius: 8, padding: '8px 14px', minWidth: 120 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>AI VERDICT</div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: vcfg.color }}>{aiData.verdict}</div>
                  </div>
                );
              })()}
              {aiData.fairValue?.intrinsicValue != null && (
                <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: '8px 14px', minWidth: 140 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>AI FAIR VALUE</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>₹{Number(aiData.fairValue.intrinsicValue).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                  {aiData.fairValue.upside != null && (
                    <div style={{ fontSize: 11, color: aiData.fairValue.upside >= 0 ? '#22c55e' : '#ef4444', fontWeight: 600, marginTop: 2 }}>
                      {aiData.fairValue.upside >= 0 ? '+' : ''}₹{Number(aiData.fairValue.upside).toLocaleString('en-IN', { maximumFractionDigits: 0 })} upside
                    </div>
                  )}
                  {aiData.fairValue.mosZone && (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{aiData.fairValue.mosZone}</div>
                  )}
                </div>
              )}
              {(aiData.compositeScore != null || aiData.healthScore?.overall != null) && (
                <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: '8px 14px' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>AI SCORE</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{(aiData.compositeScore ?? aiData.healthScore?.overall ?? 0).toFixed(1)}</div>
                  {aiData.fundamentalScore != null && (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                      F:{aiData.fundamentalScore.toFixed(0)} T:{(aiData.technicalScore ?? 0).toFixed(0)}
                    </div>
                  )}
                </div>
              )}
              {aiData.technicals?.target_30d != null && (
                <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: '8px 14px' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>AI PRICE TARGETS</div>
                  <div style={{ display: 'flex', gap: 10, fontSize: 11 }}>
                    {aiData.technicals.target_7d != null && (
                      <span>7d: <strong style={{ color: aiData.technicals.upside_7d_pct >= 0 ? '#22c55e' : '#ef4444' }}>₹{Number(aiData.technicals.target_7d).toFixed(0)}</strong></span>
                    )}
                    <span>30d: <strong style={{ color: aiData.technicals.upside_30d_pct >= 0 ? '#22c55e' : '#ef4444' }}>₹{Number(aiData.technicals.target_30d).toFixed(0)}</strong></span>
                    {aiData.technicals.target_90d != null && (
                      <span>90d: <strong style={{ color: aiData.technicals.upside_90d_pct >= 0 ? '#22c55e' : '#ef4444' }}>₹{Number(aiData.technicals.target_90d).toFixed(0)}</strong></span>
                    )}
                  </div>
                  {aiData.technicals.direction && (
                    <div style={{ fontSize: 10, marginTop: 4, color: aiData.technicals.direction === 'UP' ? '#22c55e' : aiData.technicals.direction === 'DOWN' ? '#ef4444' : '#eab308' }}>
                      {aiData.technicals.direction} trend
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* Pro Tips */}
            {Array.isArray(aiData.proTips) && aiData.proTips.length > 0 && (
              <div style={{ background: 'rgba(59,130,246,0.06)', borderRadius: 8, padding: '10px 14px', borderLeft: '3px solid #3b82f6' }}>
                <div style={{ fontSize: 10, color: '#3b82f6', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pro Tips</div>
                <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
                  {aiData.proTips.map((tip, i) => {
                    const text = typeof tip === 'string' ? tip : (tip?.text || '');
                    const isBull = typeof tip !== 'object' || tip?.type === 'bull';
                    return (
                      <li key={i} style={{ fontSize: 12, color: isBull ? '#86efac' : '#fca5a5', lineHeight: 1.6, marginBottom: 2 }}>{text}</li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      {/* Rationale */}
      <div style={{
        background: 'var(--bg-card)', borderLeft: `3px solid ${recColor}`,
        borderRadius: '0 8px 8px 0', padding: '12px 16px', marginBottom: 16, fontSize: 13, lineHeight: 1.6,
      }}>
        <strong>Rationale: </strong>{s.rationale}
      </div>

      {/* Two columns: Fundamentals + Risk */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Fundamentals */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>
            Fundamentals & Valuation
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            {[
              ['P/E', s.pe_ratio, v => v?.toFixed(1)],
              ['P/B', s.pb_ratio, v => v?.toFixed(2)],
              ['ROE', s.roe_pct, v => `${v}%`],
              ['D/E', s.debt_to_equity, v => v?.toFixed(1)],
              ['Div Yld', s.dividend_yield_pct, v => `${v}%`],
              ['Rev Grw', s.revenue_growth_pct, v => `${v > 0 ? '+' : ''}${v}%`],
              ['Earn Grw', s.earnings_growth_pct, v => `${v > 0 ? '+' : ''}${v}%`],
              ['MCap Cr', s.market_cap_cr, v => `${(v/1000).toFixed(0)}K`],
              ['FCF Cr', s.fcf_cr, v => v?.toLocaleString('en-IN')],
            ].map(([label, val, fmt]) => (
              <MetricCell key={label} label={label} val={val} fmt={fmt} />
            ))}
          </div>
        </div>

        {/* Risk metrics */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>
            Risk Metrics
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            {[
              ['Volatility', s.volatility_ann, v => `${v}%`],
              ['Vol %ile', s.volatility_percentile, v => `${v}%`],
              ['ATR %', s.atr_pct, v => `${v}%`],
              ['BB %B', s.bb_pct_b, v => `${v}%`],
              ['BB Width', s.bb_width_pct, v => `${v}%`],
              ['Day Ret', s.daily_return_pct, v => `${v > 0 ? '+' : ''}${v}%`],
              ['MA50 Dev', s.ma50_deviation_pct, v => `${v > 0 ? '+' : ''}${v}%`],
              ['MA200 Dev', s.ma200_deviation_pct, v => `${v > 0 ? '+' : ''}${v}%`],
              ['Max DD', s.max_drawdown_pct, v => `${v}%`],
              ['Cur DD', s.current_drawdown_pct, v => `${v}%`],
              ['RSI', s.rsi, v => v?.toFixed(1)],
              ['Risk Scr', s.risk_score, v => `${v}/100`],
            ].map(([label, val, fmt]) => (
              <MetricCell key={label} label={label} val={val} fmt={fmt} />
            ))}
          </div>
        </div>
      </div>

      {/* VWAP + Supertrend */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>VWAP (20-PERIOD)</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>
            {s.vwap != null ? `\u20B9${Number(s.vwap).toLocaleString('en-IN', { maximumFractionDigits: 1 })}` : 'N/A'}
          </div>
          {s.vwap != null && s.cmp != null && (
            <div style={{ fontSize: 11, color: s.cmp > s.vwap ? '#22c55e' : '#ef4444', marginTop: 4, fontWeight: 600 }}>
              Price {s.cmp > s.vwap ? 'above' : 'below'} VWAP ({s.cmp > s.vwap ? 'Bullish' : 'Bearish'})
            </div>
          )}
        </div>
        <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>SUPERTREND (10, 3)</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>
            {s.supertrend != null ? `\u20B9${Number(s.supertrend).toLocaleString('en-IN', { maximumFractionDigits: 1 })}` : 'N/A'}
          </div>
          {s.supertrend_signal && (
            <div style={{
              marginTop: 4, display: 'inline-block',
              padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
              background: s.supertrend_signal === 'BUY' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
              color: s.supertrend_signal === 'BUY' ? '#22c55e' : '#ef4444',
            }}>
              Supertrend: {s.supertrend_signal}
            </div>
          )}
        </div>
      </div>

      {/* DCF Intrinsic Value */}
      {s.intrinsic_value != null && (
        <div style={{
          background: 'var(--bg-card)', borderRadius: 8, padding: 12, marginBottom: 16,
          border: `1px solid ${s.dcf_upside_pct > 0 ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
                DCF Intrinsic Value
              </div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>
                {`\u20B9${Number(s.intrinsic_value).toLocaleString('en-IN', { maximumFractionDigits: 1 })}`}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{
                fontSize: 14, fontWeight: 700,
                color: s.dcf_upside_pct > 0 ? '#22c55e' : '#ef4444',
              }}>
                {s.dcf_upside_pct > 0 ? '+' : ''}{s.dcf_upside_pct}%
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {s.dcf_upside_pct > 10 ? 'Undervalued' : s.dcf_upside_pct < -10 ? 'Overvalued' : 'Fairly Valued'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              {s.wacc_used != null && (
                <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>WACC<br /><strong>{s.wacc_used}%</strong></div>
              )}
              {s.fcf_growth_used != null && (
                <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>FCF Growth<br /><strong>{s.fcf_growth_used}%</strong></div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 52W + Analyst + Signal */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>52-WEEK RANGE</div>
          <div style={{ fontSize: 12 }}>
            <span style={{ color: '#ef4444' }}>{s['52w_low'] != null ? `\u20B9${s['52w_low'].toFixed(0)}` : '?'}</span>
            {' \u2014 '}
            <span style={{ color: '#22c55e' }}>{s['52w_high'] != null ? `\u20B9${s['52w_high'].toFixed(0)}` : '?'}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            {s.pct_from_52w_high != null ? `${s.pct_from_52w_high}% from high` : ''}
          </div>
        </div>
        <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>ANALYST TARGET</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {s.target_price != null ? `\u20B9${s.target_price.toFixed(0)}` : 'N/A'}
          </div>
          {s.analyst_upside_pct != null && (
            <div style={{ fontSize: 11, color: s.analyst_upside_pct >= 0 ? '#22c55e' : '#ef4444', marginTop: 4 }}>
              {s.analyst_upside_pct >= 0 ? '+' : ''}{s.analyst_upside_pct}% upside
            </div>
          )}
        </div>
        <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>MOMENTUM SIGNAL</div>
          <div>
            <span style={{
              padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 700,
              background: (SIGNAL_COLORS[s.signal] || SIGNAL_COLORS.NO_DATA).bg,
              color: (SIGNAL_COLORS[s.signal] || SIGNAL_COLORS.NO_DATA).color,
            }}>
              {s.signal} ({s.signal_strength > 0 ? '+' : ''}{s.signal_strength})
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.4 }}>
            {s.signal_details || 'No signal data'}
          </div>
        </div>
      </div>

    </div>
  );
}

function MetricCell({ label, val, fmt }) {
  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: 6, padding: '6px 8px' }}>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>
        {val != null ? (fmt ? fmt(val) : val) : <span style={{ color: '#475569' }}>--</span>}
      </div>
    </div>
  );
}

function AlertsPanel({ alerts, onDismiss }) {
  const [collapsed, setCollapsed] = useState(false);

  // Group by severity
  const critical = alerts.filter(a => a.severity === 'critical');
  const high = alerts.filter(a => a.severity === 'high');
  const medium = alerts.filter(a => a.severity === 'medium');

  return (
    <div style={{
      marginBottom: 20, borderRadius: 12, overflow: 'hidden',
      border: '1px solid rgba(234,179,8,0.3)',
      background: 'var(--bg-card)',
    }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
        background: critical.length > 0 ? 'rgba(239,68,68,0.12)' : 'rgba(234,179,8,0.10)',
        borderBottom: collapsed ? 'none' : '1px solid var(--border)',
        cursor: 'pointer',
      }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28, borderRadius: '50%', fontWeight: 700, fontSize: 14,
          background: critical.length > 0 ? 'rgba(239,68,68,0.2)' : 'rgba(234,179,8,0.2)',
          color: critical.length > 0 ? '#ef4444' : '#eab308',
        }}>
          {alerts.length}
        </span>
        <div style={{ flex: 1 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Portfolio Alerts</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>
            {critical.length > 0 && <span style={{ color: '#ef4444', fontWeight: 600 }}>{critical.length} critical</span>}
            {critical.length > 0 && high.length > 0 && ' / '}
            {high.length > 0 && <span style={{ color: '#f97316', fontWeight: 600 }}>{high.length} important</span>}
            {(critical.length > 0 || high.length > 0) && medium.length > 0 && ' / '}
            {medium.length > 0 && <span style={{ color: '#3b82f6', fontWeight: 600 }}>{medium.length} info</span>}
          </span>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 4 }}>
          {collapsed ? 'Show' : 'Hide'}
        </span>
        <button onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          style={{
            background: 'transparent', border: '1px solid var(--border)', borderRadius: 6,
            color: 'var(--text-muted)', cursor: 'pointer', padding: '4px 10px', fontSize: 11,
          }}>
          Dismiss
        </button>
      </div>

      {/* Alert items */}
      {!collapsed && (
        <div style={{ maxHeight: 320, overflow: 'auto' }}>
          {alerts.map((a, i) => {
            const cfg = ALERT_CONFIG[a.alert_type] || ALERT_CONFIG['SELL_SIGNAL'];
            return (
              <div key={`${a.symbol}-${a.alert_type}-${i}`} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 16px',
                borderBottom: i < alerts.length - 1 ? '1px solid var(--border)' : 'none',
                background: cfg.bg,
              }}>
                {/* Alert type badge */}
                <span style={{
                  display: 'inline-flex', alignItems: 'center', padding: '3px 8px',
                  borderRadius: 6, fontWeight: 700, fontSize: 10,
                  background: cfg.border, color: cfg.color,
                  whiteSpace: 'nowrap', minWidth: 72, justifyContent: 'center',
                }}>
                  {cfg.icon} {cfg.label}
                </span>

                {/* Symbol */}
                <span style={{ fontWeight: 700, fontSize: 13, minWidth: 80 }}>
                  {a.symbol}
                </span>

                {/* CMP */}
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 70 }}>
                  {a.cmp != null ? `\u20B9${Number(a.cmp).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : ''}
                </span>

                {/* Message */}
                <span style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  {a.message}
                </span>

                {/* Right side meta */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  {a.risk_level && a.risk_level !== 'UNKNOWN' && (
                    <RiskBadge level={a.risk_level} />
                  )}
                  <span style={{
                    fontSize: 11, fontWeight: 600,
                    color: TREND_COLORS[a.trend] || '#64748b',
                  }}>
                    {a.trend}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Sector Mix Tab ───────────────────────────────────────────────────────────
const SECTOR_COLORS = [
  '#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6',
  '#a78bfa','#fb923c','#34d399','#60a5fa','#fbbf24',
];

// ── Portfolio AI Analysis Tab ────────────────────────────────────────────────
const VERDICT_COLOR_AI = {
  'ACCUMULATE':          '#22c55e',
  'ACCUMULATE (STAGED)': '#4ade80',
  'WATCH':               '#eab308',
  'WAIT':                '#f97316',
  'Strong Buy':          '#22c55e',
  'Buy':                 '#4ade80',
  'Hold':                '#eab308',
  'Sell':                '#f97316',
  'Strong Sell':         '#ef4444',
};
const VERDICT_ICON_AI = {
  'ACCUMULATE': '✅', 'ACCUMULATE (STAGED)': '✅',
  'WATCH': '👁', 'WAIT': '⏳',
  'Strong Buy': '✅', 'Buy': '✅', 'Hold': '👁', 'Sell': '⏳', 'Strong Sell': '🚫',
};
const DIR_CFG = {
  'UP':      { color: '#22c55e', icon: '▲' },
  'DOWN':    { color: '#ef4444', icon: '▼' },
  'NEUTRAL': { color: '#eab308', icon: '◆' },
};
const WAR_COLOR = { 'high': '#ef4444', 'medium': '#eab308', 'LOW': '#4ade80', 'SAFE_HAVEN': '#22c55e' };

function ScoreBar({ value, color = '#3b82f6', max = 100 }) {
  const pct = Math.min(100, Math.max(0, ((value || 0) / max) * 100));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 44, height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 11, color, fontWeight: 600 }}>{value != null ? Math.round(value) : '—'}</span>
    </div>
  );
}

const ACTION_CFG = {
  'SELL / EXIT':               { color: '#ef4444', bg: 'rgba(239,68,68,0.15)',  icon: '✕✕' },
  'REDUCE':                    { color: '#f97316', bg: 'rgba(249,115,22,0.12)', icon: '▼' },
  'REDUCE (WAR RISK)':         { color: '#f97316', bg: 'rgba(249,115,22,0.12)', icon: '⚠▼' },
  'TRIM (OVERVALUED)':         { color: '#eab308', bg: 'rgba(234,179,8,0.12)',  icon: '✂' },
  'TRIM (INTRINSIC OVERVALUED)':{ color: '#eab308', bg: 'rgba(234,179,8,0.12)', icon: '✂' },
  'HOLD':                      { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', icon: '=' },
  'WATCH (WEAK FUNDAMENTALS)': { color: '#64748b', bg: 'rgba(100,116,139,0.1)', icon: '◎' },
  'ADD / ACCUMULATE':          { color: '#22c55e', bg: 'rgba(34,197,94,0.15)', icon: '▲▲' },
  'ADD (BUY SIGNAL)':          { color: '#4ade80', bg: 'rgba(74,222,128,0.12)', icon: '▲' },
  'ADD (INTRINSIC UNDERVALUED)':{ color: '#4ade80', bg: 'rgba(74,222,128,0.12)', icon: '▲' },
};

function PortfolioAITab({ portfolioName }) {
  const [aiData, setAiData] = useState([]);
  const [rebalData, setRebalData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [rebalLoading, setRebalLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rebalError, setRebalError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [rebalLoaded, setRebalLoaded] = useState(false);
  const [expandedRow, setExpandedRow] = useState(null);
  const [sortCol, setSortCol] = useState('compositeScore');
  const [sortAsc, setSortAsc] = useState(false);
  const [filter, setFilter] = useState('ALL');
  const [subTab, setSubTab] = useState('rebalance');

  const data = aiData;

  const loadRebalance = () => {
    setRebalLoading(true);
    setRebalError(null);
    api.getPortfolioRebalance(portfolioName)
      .then(d => { setRebalData(d); setRebalLoaded(true); })
      .catch(e => setRebalError(e.message))
      .finally(() => setRebalLoading(false));
  };

  const load = () => {
    setLoading(true);
    setError(null);
    api.getPortfolioAIInsights(portfolioName)
      .then(d => { setAiData(Array.isArray(d) ? d : []); setLoaded(true); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(false); }
  };

  // Summary counts
  const verdictCounts = {};
  data.forEach(r => { if (r.verdict) verdictCounts[r.verdict] = (verdictCounts[r.verdict] || 0) + 1; });
  const buyCount = (verdictCounts['ACCUMULATE'] || 0) + (verdictCounts['ACCUMULATE (STAGED)'] || 0) + (verdictCounts['Strong Buy'] || 0) + (verdictCounts['Buy'] || 0);
  const watchCount = (verdictCounts['WATCH'] || 0) + (verdictCounts['Hold'] || 0);
  const exitCount = (verdictCounts['WAIT'] || 0) + (verdictCounts['Sell'] || 0) + (verdictCounts['Strong Sell'] || 0);
  const avgCS = data.length ? Math.round(data.reduce((s, r) => s + (r.compositeScore || 0), 0) / data.length) : 0;

  const FILTER_OPTS = [
    { key: 'ALL', label: 'All' },
    { key: 'BUY', label: 'Accumulate/Buy' },
    { key: 'WATCH', label: 'Watch/Hold' },
    { key: 'EXIT', label: 'Wait/Sell' },
  ];
  const verdictGroup = (v = '') => {
    if (['ACCUMULATE', 'ACCUMULATE (STAGED)', 'Strong Buy', 'Buy'].includes(v)) return 'BUY';
    if (['WATCH', 'Hold'].includes(v)) return 'WATCH';
    if (['WAIT', 'Sell', 'Strong Sell'].includes(v)) return 'EXIT';
    return 'WATCH';
  };

  let rows = [...data];
  if (filter !== 'ALL') rows = rows.filter(r => verdictGroup(r.verdict) === filter);
  rows.sort((a, b) => {
    let va = a[sortCol] ?? (sortAsc ? Infinity : -Infinity);
    let vb = b[sortCol] ?? (sortAsc ? Infinity : -Infinity);
    if (typeof va === 'string') return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    return sortAsc ? va - vb : vb - va;
  });

  const th = (label, col) => (
    <th onClick={() => handleSort(col)} style={{
      cursor: 'pointer', padding: '9px 10px', textAlign: 'left', whiteSpace: 'nowrap',
      color: sortCol === col ? '#60a5fa' : 'var(--text-secondary)',
      fontSize: 11, fontWeight: 700, borderBottom: '1px solid var(--border)',
    }}>
      {label}{sortCol === col ? (sortAsc ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <div className="card" style={{ padding: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>🤖 AI Portfolio Analysis</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Skills 1–13: Rebalance Advice · Fundamentals · Technicals · Valuation · Defense Mode
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={loadRebalance} disabled={rebalLoading} style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: '#22c55e', color: '#fff', fontWeight: 600, cursor: rebalLoading ? 'wait' : 'pointer', fontSize: 13 }}>
            {rebalLoading ? '⟳ Loading...' : rebalLoaded ? '↻ Refresh Rebalance' : '⚖ Rebalance AI'}
          </button>
          <button onClick={load} disabled={loading} style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: 'var(--accent-blue)', color: '#fff', fontWeight: 600, cursor: loading ? 'wait' : 'pointer', fontSize: 13 }}>
            {loading ? '⟳ Analyzing...' : loaded ? '↻ Re-analyze' : '🤖 Deep Analysis'}
          </button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', marginBottom: 20 }}>
        {[{ key: 'rebalance', label: '⚖ Rebalance Advice' }, { key: 'deep', label: '🔬 Deep AI Analysis' }].map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)} style={{
            padding: '9px 20px', border: 'none', marginBottom: -2,
            borderBottom: subTab === t.key ? '2px solid var(--accent-blue)' : '2px solid transparent',
            background: 'transparent', color: subTab === t.key ? 'var(--accent-blue)' : 'var(--text-muted)',
            fontWeight: subTab === t.key ? 700 : 500, fontSize: 13, cursor: 'pointer',
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── REBALANCE TAB ── */}
      {subTab === 'rebalance' && (
        <>
          {rebalError && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: '#fca5a5', marginBottom: 14, fontSize: 13 }}>{rebalError}</div>}
          {rebalLoading && <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}><div style={{ fontSize: 28 }}>⚖</div>Generating AI rebalance recommendations...</div>}

          {!rebalLoading && rebalLoaded && rebalData && (
            <>
              {/* Summary row */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                {[
                  { label: 'Sell / Reduce', val: rebalData.summary?.sell_reduce, color: '#ef4444' },
                  { label: 'Add / Accumulate', val: rebalData.summary?.add_accumulate, color: '#22c55e' },
                  { label: 'Hold', val: rebalData.summary?.hold, color: '#94a3b8' },
                  { label: 'High Risk', val: rebalData.summary?.high_risk_count, color: '#f97316' },
                  { label: 'War Exposed', val: rebalData.summary?.war_exposed_count, color: '#eab308' },
                ].map(c => (
                  <div key={c.label} style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '10px 16px', border: '1px solid var(--border)', flex: '1 1 100px' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: c.color }}>{c.val ?? 0}</div>
                  </div>
                ))}
              </div>

              {/* Rebalance table */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-secondary)' }}>
                      {['Priority', 'Stock', 'Sector', 'CMP', 'F.Score', 'Risk', 'Signal', 'AI Action', 'Rationale'].map(h => (
                        <th key={h} style={{ padding: '9px 10px', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700, textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(rebalData.stocks || []).map((r, i) => {
                      const acfg = ACTION_CFG[r.action] || ACTION_CFG['HOLD'];
                      const pLabel = r.priority === 1 ? 'URGENT' : r.priority === 2 ? 'SOON' : 'MONITOR';
                      const pColor = r.priority === 1 ? '#ef4444' : r.priority === 2 ? '#eab308' : '#64748b';
                      return (
                        <tr key={r.symbol} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                          <td style={{ padding: '9px 10px' }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: pColor, background: `${pColor}22`, padding: '2px 7px', borderRadius: 8 }}>{pLabel}</span>
                          </td>
                          <td style={{ padding: '9px 10px' }}>
                            <div style={{ fontWeight: 700 }}>{r.symbol}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                          </td>
                          <td style={{ padding: '9px 10px', color: 'var(--text-secondary)', fontSize: 12 }}>{r.sector}</td>
                          <td style={{ padding: '9px 10px', fontWeight: 600 }}>
                            {r.cmp ? `₹${Number(r.cmp).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}
                          </td>
                          <td style={{ padding: '9px 10px' }}>
                            <span style={{ color: r.fundamental_score >= 65 ? '#22c55e' : r.fundamental_score >= 45 ? '#eab308' : '#ef4444', fontWeight: 600 }}>
                              {r.fundamental_score != null ? Math.round(r.fundamental_score) : '—'}
                            </span>
                          </td>
                          <td style={{ padding: '9px 10px' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: r.risk_level === 'HIGH' ? '#ef4444' : r.risk_level === 'MEDIUM' ? '#eab308' : '#22c55e' }}>
                              {r.risk_level}
                            </span>
                          </td>
                          <td style={{ padding: '9px 10px' }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: r.signal === 'BUY' ? '#22c55e' : r.signal === 'SELL' ? '#ef4444' : '#eab308' }}>
                              {r.signal}
                            </span>
                          </td>
                          <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
                            <span style={{ padding: '4px 10px', borderRadius: 14, background: acfg.bg, color: acfg.color, fontSize: 12, fontWeight: 700 }}>
                              {acfg.icon} {r.action}
                            </span>
                            {r.weight_change !== 0 && (
                              <div style={{ fontSize: 10, color: r.weight_change > 0 ? '#4ade80' : '#f87171', marginTop: 2 }}>
                                {r.weight_change > 0 ? '+' : ''}{r.weight_change}% weight
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '9px 10px', fontSize: 11, color: 'var(--text-secondary)', maxWidth: 220 }}>
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.rationale}</div>
                            {r.intrinsic_value && r.cmp && (
                              <div style={{ fontSize: 10, color: '#60a5fa', marginTop: 2 }}>
                                IV: ₹{Number(r.intrinsic_value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                {r.dcf_upside != null && ` · DCF upside: ${r.dcf_upside.toFixed(1)}%`}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {!rebalLoading && !rebalLoaded && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)', fontSize: 13 }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>⚖</div>
              Click "Rebalance AI" to get AI-powered rebalance recommendations<br />
              <span style={{ fontSize: 11 }}>Requires portfolio scan to be run first. Uses recommendation, risk, signals, intrinsic value & defense flags.</span>
            </div>
          )}
        </>
      )}

      {/* ── DEEP ANALYSIS TAB ── */}
      {subTab === 'deep' && (
        <>
          {error && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: '#fca5a5', marginBottom: 14, fontSize: 13 }}>{error}</div>}
          {loading && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🤖</div>
              Running full AI analysis on all holdings...<br />
              <span style={{ fontSize: 11 }}>Skills 1-13: Fundamentals, Technicals, Valuation, Defense, Alpha</span>
            </div>
          )}

      {/* Summary bar */}
      {!loading && loaded && data.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            {[
              { label: 'Accumulate / Buy', val: buyCount, color: '#22c55e' },
              { label: 'Watch / Hold', val: watchCount, color: '#eab308' },
              { label: 'Wait / Sell', val: exitCount, color: '#ef4444' },
              { label: 'Avg Composite Score', val: avgCS, color: '#60a5fa' },
            ].map(c => (
              <div key={c.label} style={{
                background: 'var(--bg-secondary)', borderRadius: 10, padding: '10px 16px',
                border: '1px solid var(--border)', flex: '1 1 120px',
              }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: c.color }}>{c.val}</div>
              </div>
            ))}
          </div>

          {/* Filter tabs */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {FILTER_OPTS.map(o => (
              <button key={o.key} onClick={() => setFilter(o.key)} style={{
                padding: '5px 14px', borderRadius: 20, border: '1px solid var(--border)',
                background: filter === o.key ? 'var(--accent-blue)' : 'transparent',
                color: filter === o.key ? '#fff' : 'var(--text-secondary)',
                cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}>{o.label}</button>
            ))}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)' }}>
                  {th('Stock', 'symbol')}
                  {th('Composite', 'compositeScore')}
                  {th('Fundamental', 'fundamentalScore')}
                  {th('Technical', 'technicalScore')}
                  <th style={{ padding: '9px 10px', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700, borderBottom: '1px solid var(--border)', textAlign: 'left' }}>Direction</th>
                  <th style={{ padding: '9px 10px', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700, borderBottom: '1px solid var(--border)', textAlign: 'left', whiteSpace: 'nowrap' }}>30D Target</th>
                  <th style={{ padding: '9px 10px', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700, borderBottom: '1px solid var(--border)', textAlign: 'left' }}>War Risk</th>
                  {th('Verdict', 'verdict')}
                  <th style={{ padding: '9px 10px', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700, borderBottom: '1px solid var(--border)', textAlign: 'left' }}>AI Take</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  if (r.error) return (
                    <tr key={r.symbol} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 700 }}>{r.symbol}</td>
                      <td colSpan={8} style={{ padding: '8px 10px', color: '#f87171', fontSize: 12 }}>{r.error}</td>
                    </tr>
                  );
                  const isExpanded = expandedRow === r.symbol;
                  const vColor = VERDICT_COLOR_AI[r.verdict] || '#94a3b8';
                  const vIcon = VERDICT_ICON_AI[r.verdict] || '?';
                  const dirCfg = DIR_CFG[(r.direction || '').toUpperCase()] || DIR_CFG['NEUTRAL'];
                  const warColor = WAR_COLOR[r.warRisk] || '#64748b';
                  const upside30 = r.target30d && r.cmp ? ((r.target30d - r.cmp) / r.cmp * 100).toFixed(1) : null;
                  return (
                    <>
                      <tr
                        key={r.symbol}
                        onClick={() => setExpandedRow(isExpanded ? null : r.symbol)}
                        style={{
                          borderBottom: '1px solid var(--border)',
                          cursor: 'pointer',
                          background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                        }}
                      >
                        {/* Stock */}
                        <td style={{ padding: '9px 10px' }}>
                          <div style={{ fontWeight: 700 }}>{r.symbol}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.sector}</div>
                          {r.cmp && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>₹{Number(r.cmp).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>}
                        </td>
                        {/* Composite */}
                        <td style={{ padding: '9px 10px' }}>
                          <ScoreBar value={r.compositeScore} color='#60a5fa' />
                        </td>
                        {/* Fundamental */}
                        <td style={{ padding: '9px 10px' }}>
                          <ScoreBar value={r.fundamentalScore} color='#4ade80' />
                        </td>
                        {/* Technical */}
                        <td style={{ padding: '9px 10px' }}>
                          <ScoreBar value={r.technicalScore} color='#a78bfa' />
                        </td>
                        {/* Direction */}
                        <td style={{ padding: '9px 10px' }}>
                          <span style={{ color: dirCfg.color, fontWeight: 700, fontSize: 13 }}>{dirCfg.icon} {r.direction || '—'}</span>
                          {r.rsi && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>RSI {r.rsi.toFixed(0)}</div>}
                        </td>
                        {/* 30D Target */}
                        <td style={{ padding: '9px 10px' }}>
                          {r.target30d ? (
                            <>
                              <div style={{ fontWeight: 600 }}>₹{Number(r.target30d).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                              {upside30 && <div style={{ fontSize: 11, color: parseFloat(upside30) >= 0 ? '#4ade80' : '#f87171', fontWeight: 600 }}>{upside30 > 0 ? '+' : ''}{upside30}%</div>}
                            </>
                          ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        {/* War Risk */}
                        <td style={{ padding: '9px 10px' }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: warColor }}>
                            {r.isSafeHaven ? '🛡 SAFE' : r.warRisk || '—'}
                          </span>
                        </td>
                        {/* Verdict */}
                        <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
                          <span style={{ fontWeight: 700, color: vColor, fontSize: 13 }}>{vIcon} {r.verdict || '—'}</span>
                        </td>
                        {/* AI Take */}
                        <td style={{ padding: '9px 10px', maxWidth: 200 }}>
                          {r.llmConviction?.summary ? (
                            <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                              {r.llmConviction.summary}
                            </span>
                          ) : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>}
                        </td>
                      </tr>
                      {/* Expanded detail */}
                      {isExpanded && (
                        <tr key={`${r.symbol}-detail`} style={{ background: 'rgba(96,165,250,0.04)' }}>
                          <td colSpan={9} style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                              {/* Fundamentals */}
                              <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 12 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: '#4ade80', marginBottom: 8 }}>FUNDAMENTALS</div>
                                {[['ROE', r.metrics?.roe != null ? `${(r.metrics.roe * 100).toFixed(1)}%` : '—'],
                                  ['P/E', r.metrics?.pe?.toFixed(1)],
                                  ['D/E', r.metrics?.de?.toFixed(0)],
                                  ['Fund Score', r.fundamentalScore?.toFixed(0)],
                                ].map(([k, v]) => (
                                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                                    <span style={{ fontWeight: 600 }}>{v || '—'}</span>
                                  </div>
                                ))}
                              </div>
                              {/* Fair value */}
                              {r.fairValue && (
                                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 12 }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: '#60a5fa', marginBottom: 8 }}>INTRINSIC VALUE</div>
                                  {[['CMP', r.fairValue.cmp ? `₹${Number(r.fairValue.cmp).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'],
                                    ['Fair Value', r.fairValue.intrinsicValue ? `₹${Number(r.fairValue.intrinsicValue).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'],
                                    ['Upside', r.fairValue.upside != null ? `${r.fairValue.upside.toFixed(1)}%` : '—'],
                                    ['Zone', r.fairValue.mosZone || r.fairValue.verdict || '—'],
                                  ].map(([k, v]) => (
                                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
                                      <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                                      <span style={{ fontWeight: 600 }}>{v}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {/* Red flag */}
                              {r.redFlag?.reasons && (
                                <div style={{ background: 'rgba(239,68,68,0.07)', borderRadius: 8, padding: 12, border: '1px solid rgba(239,68,68,0.2)' }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: '#f87171', marginBottom: 6 }}>RED FLAGS</div>
                                  <div style={{ fontSize: 11, color: '#fca5a5' }}>{r.redFlag.reasons}</div>
                                </div>
                              )}
                              {/* LLM conviction full */}
                              {r.llmConviction?.summary && (
                                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 12, gridColumn: 'span 2' }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', marginBottom: 6 }}>AI CONVICTION</div>
                                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{r.llmConviction.summary}</div>
                                  {r.llmConviction.keyRisks && (
                                    <div style={{ marginTop: 8, fontSize: 11, color: '#f87171' }}>
                                      <b>Key risks:</b> {r.llmConviction.keyRisks}
                                    </div>
                                  )}
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
        </>
      )}

          {!loading && !loaded && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)', fontSize: 13 }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🤖</div>
              Click "Deep Analysis" to analyze all holdings using the full AI algorithm<br />
              <span style={{ fontSize: 11 }}>Skills 1-13: Fundamentals, Technicals, Market Condition, India Themes, Defense Mode, Valuation</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Portfolio Valuation Tab ──────────────────────────────────────────────────
function PortfolioValuationTab({ portfolioName }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    api.getPortfolioValuation(portfolioName)
      .then(d => { setData(Array.isArray(d) ? d : []); setLoaded(true); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  const VERDICT_COLOR = {
    'UNDERVALUED': '#22c55e',
    'FAIRLY VALUED': '#eab308',
    'SLIGHTLY OVERVALUED': '#f97316',
    'OVERVALUED': '#ef4444',
    'SIGNIFICANTLY OVERVALUED': '#ef4444',
  };

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>⚖ Valuation Assessment</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            3-method fair value for each holding: Relative P/E · DCF · Graham Number
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            marginLeft: 'auto', padding: '9px 20px', borderRadius: 8, border: 'none',
            background: 'var(--accent-blue)', color: '#fff', fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer', fontSize: 13,
          }}
        >
          {loading ? '⟳ Fetching...' : loaded ? '↻ Refresh' : 'Run Valuation'}
        </button>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: '#fca5a5', marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 13 }}>
          Fetching valuation data for each holding... (~30s)
        </div>
      )}

      {!loading && loaded && data.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)' }}>
                {['Stock', 'CMP', 'Fair Value', 'MoS %', 'P/E', 'Sector P/E', 'P/B', 'Verdict', 'Entry Below', 'Exit Above'].map(h => (
                  <th key={h} style={{ padding: '9px 10px', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700, textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => {
                if (r.error) return (
                  <tr key={r.symbol} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 700 }}>{r.symbol}</td>
                    <td colSpan={9} style={{ padding: '8px 10px', color: '#f87171', fontSize: 12 }}>{r.error}</td>
                  </tr>
                );
                const mos = r.margin_of_safety_pct;
                const mosColor = mos == null ? '#64748b' : mos >= 20 ? '#22c55e' : mos >= 0 ? '#4ade80' : mos >= -20 ? '#eab308' : '#ef4444';
                const verdictColor = VERDICT_COLOR[r.verdict] || '#94a3b8';
                return (
                  <tr key={r.symbol} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                    <td style={{ padding: '8px 10px' }}>
                      <div style={{ fontWeight: 700 }}>{r.symbol}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                    </td>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                      {r.cmp ? `₹${Number(r.cmp).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#60a5fa', fontWeight: 700 }}>
                      {r.fair_value ? `₹${Number(r.fair_value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', fontWeight: 700, color: mosColor }}>
                      {mos != null ? `${mos > 0 ? '+' : ''}${mos}%` : '—'}
                    </td>
                    <td style={{ padding: '8px 10px' }}>{r.trailing_pe != null ? r.trailing_pe.toFixed(1) : '—'}</td>
                    <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>{r.sector_median_pe ?? '—'}</td>
                    <td style={{ padding: '8px 10px' }}>{r.price_to_book != null ? r.price_to_book.toFixed(1) : '—'}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{ fontWeight: 700, color: verdictColor, fontSize: 12, whiteSpace: 'nowrap' }}>{r.verdict || '—'}</span>
                    </td>
                    <td style={{ padding: '8px 10px', color: '#22c55e', fontSize: 12 }}>
                      {r.attractive_price ? `₹${Number(r.attractive_price).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#f87171', fontSize: 12 }}>
                      {r.exit_on_valuation ? `₹${Number(r.exit_on_valuation).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
            MoS = Margin of Safety (positive = stock below fair value). Fair value = 60% DCF + 40% Graham Number.
          </div>
        </div>
      )}

      {!loading && !loaded && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>
          Click "Run Valuation" to assess all holdings.
        </div>
      )}
    </div>
  );
}

function SectorMixTab({ data }) {
  if (!data || data.length === 0) {
    return <div className="empty-state"><h3>No portfolio data</h3></div>;
  }

  // Aggregate by sector
  const sectorMap = {};
  data.forEach(s => {
    const sector = s.sector || 'Unknown';
    if (!sectorMap[sector]) sectorMap[sector] = { count: 0, symbols: [] };
    sectorMap[sector].count += 1;
    sectorMap[sector].symbols.push((s.symbol || '').replace('.NS', ''));
  });

  const total = data.length;
  const sectors = Object.entries(sectorMap)
    .map(([name, d]) => ({ name, count: d.count, pct: Math.round((d.count / total) * 100), symbols: d.symbols }))
    .sort((a, b) => b.count - a.count);

  // Max recommended per sector (Prasenjit Paul: 25-30%)
  const MAX_PCT = 30;
  const overConcentrated = sectors.filter(s => s.pct > MAX_PCT);

  return (
    <div>
      {/* Warning banner */}
      {overConcentrated.length > 0 && (
        <div style={{
          padding: '10px 16px', borderRadius: 10, marginBottom: 16,
          background: 'rgba(234,179,8,0.10)', border: '1px solid rgba(234,179,8,0.3)',
          fontSize: 13, color: '#eab308',
        }}>
          ⚠ Over-concentrated: {overConcentrated.map(s => `${s.name} (${s.pct}%)`).join(', ')} — max recommended is {MAX_PCT}% per sector
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
        {/* Pie chart */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 12 }}>ALLOCATION BY SECTOR</div>
          <PieChart width={320} height={300}>
            <Pie
              data={sectors}
              dataKey="count"
              nameKey="name"
              cx="50%" cy="50%"
              innerRadius={70}
              outerRadius={130}
              paddingAngle={2}
              label={({ name, pct }) => `${pct}%`}
              labelLine={false}
            >
              {sectors.map((_, i) => (
                <Cell key={i} fill={SECTOR_COLORS[i % SECTOR_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
              formatter={(val, name, props) => [`${props.payload.pct}% (${val} stocks)`, name]}
            />
          </PieChart>
          {/* Centre label */}
          <div style={{ textAlign: 'center', marginTop: -10, fontSize: 11, color: 'var(--text-muted)' }}>
            {total} stocks · {sectors.length} sectors
          </div>
        </div>

        {/* Sector list */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 12 }}>SECTOR BREAKDOWN</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sectors.map((s, i) => {
              const color = SECTOR_COLORS[i % SECTOR_COLORS.length];
              const overLimit = s.pct > MAX_PCT;
              return (
                <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: overLimit ? '#eab308' : 'var(--text-primary)' }}>
                        {s.name} {overLimit && '⚠'}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.count} stocks · {s.pct}%</span>
                    </div>
                    <div style={{ height: 5, borderRadius: 3, background: 'var(--bg-secondary)', overflow: 'hidden' }}>
                      <div style={{
                        width: `${Math.min(100, (s.pct / MAX_PCT) * 100)}%`,
                        height: '100%', borderRadius: 3,
                        background: overLimit ? '#eab308' : color,
                      }} />
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.symbols.join(', ')}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Cap reference */}
          <div style={{ marginTop: 16, padding: '8px 12px', borderRadius: 8, background: 'var(--bg-secondary)', fontSize: 11, color: 'var(--text-muted)' }}>
            Rule: No single sector should exceed {MAX_PCT}% of portfolio (Prasenjit Paul)
          </div>
        </div>
      </div>
    </div>
  );
}
