import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { api } from '../api';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import ScreenshotButton from './ScreenshotButton';

function SignalBadge({ signal }) {
  return <span className={`signal-badge signal-${signal || 'HOLD'}`}>{signal || 'N/A'}</span>;
}

const SOURCES = [
  { key: 'portfolio', label: 'My Portfolio' },
  { key: 'sharekhan', label: 'Sharekhan' },
  { key: 'gainers', label: 'NSE Gainers' },
  { key: 'losers', label: 'NSE Losers' },
  { key: 'custom', label: 'Custom' },
];

export default function SignalsView({ onSelectStock }) {
  const [mode, setMode] = useState('live'); // 'live' | 'batch'
  const [source, setSource] = useState('portfolio');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('ALL');
  const [customSymbols, setCustomSymbols] = useState('');
  const [marketStatus, setMarketStatus] = useState(null);
  const [movers, setMovers] = useState(null);
  const [moversLoading, setMoversLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [fallback, setFallback] = useState(false);
  const containerRef = useRef(null);
  const refreshRef = useRef(null);

  // Fetch market status
  useEffect(() => {
    api.getMarketStatus()
      .then(s => setMarketStatus(s))
      .catch(() => {});
  }, []);

  // Fetch batch signals on mount (default data)
  useEffect(() => {
    if (mode === 'batch') {
      setLoading(true);
      api.getSignals()
        .then(d => { setData(Array.isArray(d) ? d : []); setFallback(false); })
        .catch(() => setData([]))
        .finally(() => { setLoading(false); setLastUpdated(new Date().toLocaleTimeString()); });
    }
  }, [mode]);

  // Fetch live signals
  const fetchLive = useCallback(() => {
    if (mode !== 'live') return;
    setLoading(true);
    let params = {};
    if (source === 'portfolio') params = { source: 'portfolio', name: 'main' };
    else if (source === 'sharekhan') params = { source: 'portfolio', name: 'sharekhan' };
    else if (source === 'gainers') params = { source: 'gainers' };
    else if (source === 'losers') params = { source: 'losers' };
    else if (source === 'custom' && customSymbols.trim()) {
      params = { symbols: customSymbols.trim().toUpperCase() };
    } else {
      setLoading(false);
      return;
    }

    api.getLiveSignals(params)
      .then(res => {
        const items = res?.data || [];
        setData(Array.isArray(items) ? items : []);
        setFallback(!!res?.fallback);
        setLastUpdated(new Date().toLocaleTimeString());
      })
      .catch(() => setData([]))
      .finally(() => { setLoading(false); setCountdown(60); });
  }, [mode, source, customSymbols]);

  // Trigger live fetch on source change
  useEffect(() => {
    if (mode === 'live') fetchLive();
  }, [mode, source]);

  // Auto-refresh timer
  useEffect(() => {
    if (refreshRef.current) clearInterval(refreshRef.current);
    if (!autoRefresh || mode !== 'live') return;

    refreshRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { fetchLive(); return 60; }
        return prev - 1;
      });
    }, 1000);
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [autoRefresh, mode, fetchLive]);

  // Fetch market movers
  const loadMovers = () => {
    setMoversLoading(true);
    api.getMarketMovers()
      .then(d => { if (!d.error) setMovers(d); })
      .catch(() => {})
      .finally(() => setMoversLoading(false));
  };

  const filtered = useMemo(() => {
    if (filter === 'ALL') return data;
    return data.filter(s => s.signal === filter);
  }, [data, filter]);

  const strengthData = useMemo(() => {
    return data
      .filter(s => s.signal_strength != null && s.signal !== 'NO_DATA')
      .sort((a, b) => (b.signal_strength || 0) - (a.signal_strength || 0))
      .slice(0, 20)
      .map(s => ({
        symbol: (s.symbol || '').replace('.NS', ''),
        strength: s.signal_strength || 0,
        color: s.signal === 'BUY' ? '#22c55e' : s.signal === 'SELL' ? '#ef4444' : '#eab308',
      }));
  }, [data]);

  // Determine market open: use API status if available, else IST time-based fallback
  const marketOpen = useMemo(() => {
    const s = (marketStatus?.status || '').toLowerCase();
    if (s === 'open' || s === 'active' || s === 'live') return true;
    if (s === 'closed' || s === 'close') return false;
    // Fallback: Mon-Fri, 9:15 AM – 3:30 PM IST
    const now = new Date();
    const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const day = ist.getDay();
    if (day === 0 || day === 6) return false;
    const mins = ist.getHours() * 60 + ist.getMinutes();
    return mins >= 555 && mins <= 930; // 9:15–15:30
  }, [marketStatus]);

  return (
    <div ref={containerRef}>
      {/* Header controls */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* Market status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: marketOpen ? '#22c55e' : '#ef4444',
              boxShadow: marketOpen ? '0 0 6px #22c55e' : 'none',
            }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: marketOpen ? '#22c55e' : '#ef4444' }}>
              {marketOpen ? 'MARKET OPEN' : 'MARKET CLOSED'}
            </span>
          </div>

          {/* Mode toggle */}
          <div style={{
            display: 'flex', background: 'var(--bg-secondary)', borderRadius: 8, overflow: 'hidden',
            border: '1px solid var(--border)',
          }}>
            {['live', 'batch'].map(m => (
              <button key={m} onClick={() => setMode(m)}
                style={{
                  padding: '6px 16px', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  background: mode === m ? 'var(--accent-blue)' : 'transparent',
                  color: mode === m ? 'white' : 'var(--text-muted)',
                }}>
                {m === 'live' ? 'Live (NSE)' : 'Batch (CSV)'}
              </button>
            ))}
          </div>

          {/* Source selector (live mode only) */}
          {mode === 'live' && (
            <div style={{ display: 'flex', gap: 4 }}>
              {SOURCES.map(s => (
                <button key={s.key} onClick={() => setSource(s.key)}
                  style={{
                    padding: '5px 12px', borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 600,
                    background: source === s.key ? 'var(--accent-blue)' : 'var(--bg-card)',
                    color: source === s.key ? 'white' : 'var(--text-muted)',
                    cursor: 'pointer',
                  }}>
                  {s.label}
                </button>
              ))}
            </div>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <ScreenshotButton targetRef={containerRef} filename="live-signals" />
          </div>
        </div>

        {/* Custom symbols input */}
        {mode === 'live' && source === 'custom' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input
              placeholder="Enter symbols: TCS,RELIANCE,INFY"
              value={customSymbols}
              onChange={e => setCustomSymbols(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === 'Enter') fetchLive(); }}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 6,
                background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                color: 'var(--text-primary)', fontSize: 13, outline: 'none',
              }}
            />
            <button onClick={fetchLive} disabled={loading || !customSymbols.trim()}
              style={{
                padding: '8px 16px', borderRadius: 6, border: 'none',
                background: 'var(--accent-blue)', color: 'white',
                fontWeight: 600, fontSize: 12, cursor: 'pointer',
              }}>
              Scan
            </button>
          </div>
        )}

        {/* Auto-refresh + status bar */}
        {mode === 'live' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, marginTop: 10,
            padding: '6px 10px', background: 'var(--bg-secondary)', borderRadius: 6,
          }}>
            <button onClick={() => setAutoRefresh(!autoRefresh)}
              style={{
                padding: '3px 10px', borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 600,
                background: autoRefresh ? 'var(--accent-green)' : 'var(--bg-card)',
                color: autoRefresh ? 'white' : 'var(--text-muted)', cursor: 'pointer',
              }}>
              Auto-Refresh {autoRefresh ? 'ON' : 'OFF'}
            </button>
            {autoRefresh && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Next: {countdown}s</span>
            )}
            <button onClick={fetchLive} disabled={loading}
              style={{
                padding: '3px 12px', borderRadius: 6, border: '1px solid var(--border)',
                background: 'transparent', color: 'var(--text-secondary)',
                cursor: 'pointer', fontSize: 11, fontWeight: 600,
              }}>
              {loading ? 'Fetching...' : 'Refresh Now'}
            </button>
            <button onClick={loadMovers} disabled={moversLoading}
              style={{
                padding: '3px 12px', borderRadius: 6, border: '1px solid var(--border)',
                background: 'transparent', color: 'var(--text-secondary)',
                cursor: 'pointer', fontSize: 11, fontWeight: 600,
              }}>
              {moversLoading ? 'Loading...' : 'Market Movers'}
            </button>
            {lastUpdated && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                Updated: {lastUpdated}
              </span>
            )}
          </div>
        )}

        {/* Fallback banner */}
        {fallback && (
          <div style={{
            marginTop: 10, padding: '8px 12px', borderRadius: 6, fontSize: 12,
            background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.3)',
            color: '#eab308',
          }}>
            NSE proxy unavailable — showing last batch signals as fallback
          </div>
        )}
      </div>

      {/* Market Movers Panel */}
      {movers && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <MoversList title="Top Gainers" items={movers.gainers} color="#22c55e" />
            <MoversList title="Top Losers" items={movers.losers} color="#ef4444" />
          </div>
        </div>
      )}

      {loading && !data.length && (
        <div className="loading"><div className="spinner" /> {mode === 'live' ? 'Fetching live signals from NSE...' : 'Loading signals...'}</div>
      )}

      {/* Signal strength chart */}
      {strengthData.length > 0 && (
        <div className="card">
          <h2>Signal Strength {mode === 'live' ? '(Live)' : '(Batch)'} — Top {strengthData.length}</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={strengthData} margin={{ bottom: 60 }}>
              <XAxis dataKey="symbol" tick={{ fill: '#94a3b8', fontSize: 10, angle: -45 }} textAnchor="end" interval={0} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#1e2235', border: '1px solid #2d3348', borderRadius: 8 }} />
              <Bar dataKey="strength" radius={[4, 4, 0, 0]}>
                {strengthData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Signal table */}
      {data.length > 0 && (
        <div className="card">
          <h2>Trading Signals (RSI + StochRSI + MACD + VWAP + Supertrend)</h2>
          <div className="filter-bar">
            {['ALL', 'BUY', 'SELL', 'HOLD'].map(f => (
              <button key={f} className={`nav-tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
                {f} {f !== 'ALL' ? `(${data.filter(s => s.signal === f).length})` : `(${data.length})`}
              </button>
            ))}
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>CMP</th>
                  <th>Chg %</th>
                  {mode === 'batch' && <th>MCap Cr</th>}
                  {mode === 'batch' && <th>TT /8</th>}
                  <th>Signal</th>
                  <th>Strength</th>
                  <th>RSI</th>
                  <th>StochRSI %K</th>
                  <th>MACD</th>
                  <th>MACD Hist</th>
                  <th>Take Profit</th>
                  <th>Stop Loss</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => {
                  const sym = (s.symbol || '').replace('.NS', '');
                  const cmp = s.cmp ?? s.last_price;
                  const chg = s.change_pct ?? s.pChange;
                  return (
                    <tr key={sym} className="clickable" onClick={() => onSelectStock && onSelectStock(s.symbol)}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{sym}</div>
                        {s.name && s.name !== sym && (
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {s.name}
                          </div>
                        )}
                      </td>
                      <td style={{ fontWeight: 500 }}>
                        {cmp != null ? `\u20B9${Number(cmp).toLocaleString('en-IN', { maximumFractionDigits: 1 })}` : '\u2014'}
                      </td>
                      <td style={{ fontSize: 12, fontWeight: 600, color: (chg || 0) >= 0 ? '#22c55e' : '#ef4444' }}>
                        {chg != null ? `${chg >= 0 ? '+' : ''}${Number(chg).toFixed(2)}%` : '--'}
                      </td>
                      {mode === 'batch' && (
                        <td style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          {s.market_cap_cr != null ? `${(Number(s.market_cap_cr) / 1000).toFixed(0)}K` : '--'}
                        </td>
                      )}
                      {mode === 'batch' && (
                        <td>
                          {s.tech_trend_template != null ? (
                            (() => {
                              const n = Number(s.tech_trend_template);
                              const color = n >= 7 ? '#22c55e' : n >= 5 ? '#eab308' : n >= 3 ? '#f97316' : '#ef4444';
                              return (
                                <span style={{ padding: '2px 6px', borderRadius: 5, fontSize: 11, fontWeight: 700, background: `${color}18`, color }}>
                                  {n}<span style={{ fontSize: 9, opacity: 0.7 }}>/8</span>
                                </span>
                              );
                            })()
                          ) : <span style={{ color: '#475569', fontSize: 11 }}>—</span>}
                        </td>
                      )}
                      <td><SignalBadge signal={s.signal} /></td>
                      <td style={{ fontWeight: 600, color: (s.signal_strength || 0) > 0 ? 'var(--accent-green)' : (s.signal_strength || 0) < 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                        {s.signal_strength || 0}
                      </td>
                      <td>{s.rsi_value != null ? Number(s.rsi_value).toFixed(1) : 'N/A'}</td>
                      <td>{s.stochrsi_k != null ? Number(s.stochrsi_k).toFixed(1) : 'N/A'}</td>
                      <td>{s.macd_value != null ? Number(s.macd_value).toFixed(2) : 'N/A'}</td>
                      <td style={{ color: (s.macd_histogram || 0) > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                        {s.macd_histogram != null ? Number(s.macd_histogram).toFixed(2) : 'N/A'}
                      </td>
                      <td style={{ color: 'var(--accent-green)' }}>
                        {s.take_profit_price ? `\u20B9${Number(s.take_profit_price).toLocaleString('en-IN')}` : '\u2014'}
                      </td>
                      <td style={{ color: 'var(--accent-red)' }}>
                        {s.stop_loss_price ? `\u20B9${Number(s.stop_loss_price).toLocaleString('en-IN')}` : '\u2014'}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {s.signal_details || '\u2014'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && data.length === 0 && (
        <div className="empty-state">
          <h3>No Signal Data</h3>
          <p>{mode === 'live' ? 'Select a source and click Refresh to fetch live signals.' : 'Run the screener pipeline first to generate batch signals.'}</p>
        </div>
      )}
    </div>
  );
}

function MoversList({ title, items, color }) {
  if (!items) return null;
  // NSE data can be { data: [...] } or [...]
  const list = Array.isArray(items) ? items : (items?.data || []);
  if (!list.length) return null;

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {list.slice(0, 8).map((item, i) => {
          const sym = item.symbol || item.Symbol || '';
          const chg = item.netPrice || item.pChange || item.perChange || '';
          return (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '4px 8px', borderRadius: 4, background: 'var(--bg-card)',
              fontSize: 12,
            }}>
              <span style={{ fontWeight: 600 }}>{sym}</span>
              <span style={{ fontWeight: 600, color }}>{chg ? `${Number(chg) > 0 ? '+' : ''}${Number(chg).toFixed(2)}%` : ''}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
