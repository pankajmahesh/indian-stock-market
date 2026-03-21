import { useState, useEffect } from 'react';
import { api } from '../api';
import PipelineControl from './PipelineControl';

function ScoreBadge({ value }) {
  if (value == null) return <span className="score-badge score-low">N/A</span>;
  const v = Number(value);
  const cls = v >= 70 ? 'score-high' : v >= 50 ? 'score-mid' : 'score-low';
  return <span className={`score-badge ${cls}`}>{v.toFixed(1)}</span>;
}

export default function Dashboard({ onSelectStock }) {
  const [summary, setSummary] = useState(null);
  const [top20, setTop20] = useState([]);
  const [marketPulse, setMarketPulse] = useState([]);
  const [dailyReport, setDailyReport] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getSummary().catch(() => null),
      api.getTop20().catch(() => []),
      api.getMarketPulse().catch(() => []),
      api.getDailyReport().catch(() => null),
      api.getPortfolioAlerts('main').catch(() => []),
    ])
      .then(([s, t, mp, dr, al]) => {
        setSummary(s);
        setTop20(Array.isArray(t) ? t.slice(0, 10) : []);
        setMarketPulse(Array.isArray(mp) ? mp : []);
        setDailyReport(dr && !dr.error ? dr : null);
        setAlerts(Array.isArray(al) ? al : []);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading"><div className="spinner" /> Loading dashboard...</div>;

  const fmt = (v) => v != null ? Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 }) : '—';
  const fmtPct = (v) => v != null ? `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}%` : '—';
  const pctClass = (v) => v > 0 ? 'positive' : v < 0 ? 'negative' : '';

  const watchlistData = dailyReport?.watchlist_digest || [];
  const takeaways = dailyReport?.actionable_takeaways || [];
  const sectorOutlook = dailyReport?.sector_outlook || [];
  const learningQs = dailyReport?.learning_questions || [];

  return (
    <>
      <PipelineControl />

      {/* Market Pulse */}
      {marketPulse.length > 0 && (
        <div className="summary-grid" style={{ marginBottom: 20 }}>
          {marketPulse.map(idx => (
            <div key={idx.symbol} className="summary-card">
              <div className="label">{idx.name}</div>
              <div className="value" style={{ fontSize: 22 }}>{fmt(idx.price)}</div>
              <div className={`sub ${pctClass(idx.change_pct)}`} style={{ fontSize: 13, fontWeight: 600 }}>
                {idx.change != null ? `${idx.change > 0 ? '+' : ''}${fmt(idx.change)}` : ''} ({fmtPct(idx.change_pct)})
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Key Metrics */}
      {summary && summary.data_available?.final_top20 && (
        <div className="summary-grid">
          <div className="summary-card">
            <div className="label">Stocks Screened</div>
            <div className="value">{summary.universe_count}</div>
            <div className="sub">NSE universe</div>
          </div>
          <div className="summary-card">
            <div className="label">Quality Filter</div>
            <div className="value">{summary.post_redflag_count}</div>
            <div className="sub">Passed red-flag check</div>
          </div>
          <div className="summary-card">
            <div className="label">Buy Signals</div>
            <div className="value" style={{ color: 'var(--accent-green)' }}>{summary.signal_counts?.BUY || 0}</div>
            <div className="sub">Active buy signals</div>
          </div>
          <div className="summary-card">
            <div className="label">Sell Signals</div>
            <div className="value" style={{ color: 'var(--accent-red)' }}>{summary.signal_counts?.SELL || 0}</div>
            <div className="sub">Active sell signals</div>
          </div>
        </div>
      )}

      {/* Portfolio Alerts */}
      {alerts.length > 0 && (
        <div className="card" style={{ borderLeft: '3px solid var(--accent-yellow)' }}>
          <h2>Portfolio Alerts</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {alerts.slice(0, 5).map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <span className={`signal-badge signal-${a.action || 'HOLD'}`}>{a.action}</span>
                <span style={{ fontWeight: 600, cursor: 'pointer' }} onClick={() => onSelectStock(a.symbol)}>{a.symbol?.replace('.NS', '')}</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{a.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actionable Takeaways from Daily Report */}
      {takeaways.length > 0 && (
        <div className="card" style={{ borderLeft: '3px solid var(--accent-green)' }}>
          <h2>Today's Actionable Insights</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {takeaways.map((t, i) => (
              <div key={i} style={{ padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13, lineHeight: 1.5 }}>
                {typeof t === 'string' ? t : t.text || t.action || JSON.stringify(t)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sector Outlook */}
      {sectorOutlook.length > 0 && (
        <div className="card">
          <h2>Sector Outlook</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {sectorOutlook.slice(0, 8).map((s, i) => (
              <div key={i} style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 14 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{s.sector || s.name}</div>
                <div className={pctClass(s.change_pct)} style={{ fontSize: 15, fontWeight: 600 }}>{fmtPct(s.change_pct)}</div>
                {s.outlook && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{s.outlook}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Watchlist Highlights from Daily Report */}
      {watchlistData.length > 0 && (
        <div className="card">
          <h2>Watchlist Highlights</h2>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Signal</th>
                  <th>CMP</th>
                  <th>Insight</th>
                </tr>
              </thead>
              <tbody>
                {watchlistData.filter(w => w.signal === 'ACCUMULATE' || w.signal === 'ACCUMULATE (STAGED)').slice(0, 8).map((w, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{(w.symbol || '').replace('.NS', '')}</td>
                    <td><span className="signal-badge signal-BUY">{w.signal}</span></td>
                    <td>₹{fmt(w.cmp)}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: 12, whiteSpace: 'normal', maxWidth: 300 }}>{w.risk_note || w.summary || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top Picks */}
      {top20.length > 0 && (
        <div className="card">
          <h2>Top 10 Screener Picks</h2>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Symbol</th>
                  <th>Sector</th>
                  <th>CMP</th>
                  <th>Final Score</th>
                  <th>Signal</th>
                  <th>Entry Zone</th>
                </tr>
              </thead>
              <tbody>
                {top20.map((s, i) => (
                  <tr key={s.symbol} className="clickable" onClick={() => onSelectStock(s.symbol)}>
                    <td>{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>{s.symbol?.replace('.NS', '')}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{s.sector}</td>
                    <td>₹{fmt(s.cmp)}</td>
                    <td><ScoreBadge value={s.final_score} /></td>
                    <td>{s.signal && <span className={`signal-badge signal-${s.signal}`}>{s.signal}</span>}</td>
                    <td style={{ color: 'var(--accent-cyan)', fontSize: 12 }}>{s.entry_zone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Learning Questions */}
      {learningQs.length > 0 && (
        <div className="card">
          <h2>Today's Learning</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {learningQs.slice(0, 3).map((q, i) => (
              <div key={i} style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 14, fontSize: 13, lineHeight: 1.5, borderLeft: '3px solid var(--accent-purple)' }}>
                {typeof q === 'string' ? q : q.question || q.text || JSON.stringify(q)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state when no data at all */}
      {!summary && marketPulse.length === 0 && !dailyReport && (
        <div className="empty-state">
          <h3>No Data Available</h3>
          <p>Run the pipeline above to start screening, or generate a Daily Report for market insights.</p>
        </div>
      )}
    </>
  );
}
