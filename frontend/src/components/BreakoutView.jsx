import { useState } from 'react';
import { api } from '../api';

const chgColor = v => v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : '#94a3b8';
const volColor = v => v >= 3 ? '#22c55e' : v >= 2 ? '#86efac' : v >= 1.5 ? '#eab308' : '#94a3b8';

function ScoreBadge({ value }) {
  if (value == null) return <span style={{ color: '#64748b', fontSize: 11 }}>—</span>;
  const v = Number(value);
  const color = v >= 70 ? '#22c55e' : v >= 50 ? '#eab308' : '#ef4444';
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
      background: `${color}18`, color,
    }}>{v.toFixed(0)}</span>
  );
}

export default function BreakoutView({ onSelectStock }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [days, setDays]       = useState(5);
  const [volRatio, setVolRatio] = useState(1.5);

  const scan = () => {
    setLoading(true);
    setError(null);
    api.getBreakouts52w({ days, vol_ratio: volRatio })
      .then(setData)
      .catch(e => setError(e.message || 'Scan failed'))
      .finally(() => setLoading(false));
  };

  const fmt = v => v != null ? Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 }) : '—';

  return (
    <div>
      {/* Controls */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: '0 0 2px' }}>52-Week High Breakout Scanner</h2>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
              Stocks crossing their 52-week high on above-average volume — zero overhead resistance
            </p>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              Breakout within
              <select value={days} onChange={e => setDays(Number(e.target.value))}
                style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 12 }}>
                {[1, 2, 3, 5, 10].map(d => <option key={d} value={d}>{d}d</option>)}
              </select>
            </label>

            <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              Min vol ratio
              <select value={volRatio} onChange={e => setVolRatio(Number(e.target.value))}
                style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 12 }}>
                {[1.2, 1.5, 2.0, 2.5, 3.0].map(v => <option key={v} value={v}>{v}x</option>)}
              </select>
            </label>

            <button onClick={scan} disabled={loading}
              style={{
                padding: '8px 20px', borderRadius: 8, border: 'none',
                background: loading ? '#334155' : 'var(--accent-green)', color: 'white',
                fontWeight: 700, cursor: loading ? 'wait' : 'pointer', fontSize: 13,
              }}>
              {loading ? 'Scanning...' : 'Scan Now'}
            </button>
          </div>
        </div>

        {/* Info pills */}
        <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          {[
            ['No Overhead Supply', 'At new highs there are no sellers waiting to break even'],
            ['Volume Confirmation', 'Institutions needed to push price to new highs'],
            ['Stage 2 Filter', 'Price above 50 MA ensures uptrend is intact'],
          ].map(([title, desc]) => (
            <div key={title} style={{
              padding: '6px 12px', borderRadius: 8,
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              fontSize: 11,
            }}>
              <span style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>{title}</span>
              <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading && <div className="loading"><div className="spinner" /> Scanning {200} screened stocks for 52-week breakouts...</div>}

      {!loading && !data && !error && (
        <div className="empty-state">
          <h3>Ready to Scan</h3>
          <p>Click "Scan Now" to find stocks breaking out to 52-week highs. Uses the screened universe (up to 200 stocks).</p>
        </div>
      )}

      {data && (
        <>
          {/* Summary bar */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            {[
              ['Breakouts Found', data.count, '#22c55e'],
              ['Universe Scanned', data.universe_scanned, '#3b82f6'],
              ['Hit Rate', data.universe_scanned > 0 ? `${((data.count / data.universe_scanned) * 100).toFixed(1)}%` : '—', '#eab308'],
            ].map(([label, val, color]) => (
              <div key={label} style={{
                flex: '1 1 140px', padding: '12px 16px', borderRadius: 10,
                background: 'var(--bg-card)', border: `1px solid ${color}33`,
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color }}>{val}</div>
              </div>
            ))}
          </div>

          {data.count === 0 ? (
            <div className="empty-state">
              <h3>No Breakouts Found</h3>
              <p>No stocks in the screened universe broke to 52-week highs with ≥{volRatio}x volume in the last {days} days.</p>
              <p style={{ fontSize: 12 }}>Try relaxing the volume ratio or increasing the day window.</p>
            </div>
          ) : (
            <div className="card">
              <h3 style={{ margin: '0 0 12px' }}>
                {data.count} Breakout{data.count !== 1 ? 's' : ''} — sorted by volume surge
              </h3>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Symbol</th>
                      <th>Sector</th>
                      <th>CMP</th>
                      <th>Chg %</th>
                      <th>Vol Ratio</th>
                      <th>Breakout %</th>
                      <th>52W High</th>
                      <th>Prior High</th>
                      <th>50 MA</th>
                      <th>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.breakouts.map((s, i) => {
                      const sym = (s.symbol || '').replace('.NS', '');
                      return (
                        <tr key={s.symbol} className="clickable"
                          onClick={() => onSelectStock && onSelectStock(s.symbol)}
                          style={{ borderLeft: `3px solid ${volColor(s.volume_ratio)}` }}>
                          <td>{i + 1}</td>
                          <td>
                            <div style={{ fontWeight: 700, color: 'var(--accent-blue)' }}>{sym}</div>
                            {s.name && s.name !== sym && (
                              <div style={{ fontSize: 10, color: 'var(--text-muted)', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                            )}
                          </td>
                          <td style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{s.sector || '—'}</td>
                          <td style={{ fontWeight: 600 }}>₹{fmt(s.cmp)}</td>
                          <td style={{ fontWeight: 700, color: chgColor(s.change_pct) }}>
                            {s.change_pct > 0 ? '+' : ''}{s.change_pct?.toFixed(2)}%
                          </td>
                          <td>
                            <span style={{
                              fontWeight: 800, fontSize: 13,
                              color: volColor(s.volume_ratio),
                            }}>{s.volume_ratio?.toFixed(1)}x</span>
                          </td>
                          <td style={{ fontWeight: 700, color: '#22c55e', fontSize: 12 }}>
                            +{s.breakout_pct?.toFixed(2)}%
                          </td>
                          <td style={{ fontSize: 12 }}>₹{fmt(s.high_52w)}</td>
                          <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>₹{fmt(s.prior_52w_high)}</td>
                          <td style={{ fontSize: 11 }}>₹{fmt(s.ma50)}</td>
                          <td><ScoreBadge value={s.final_score ?? s.composite_score} /></td>
                        </tr>
                      );
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
