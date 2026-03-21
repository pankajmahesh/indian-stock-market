import { useState, useRef } from 'react';
import { api } from '../api';
import ScreenshotButton from './ScreenshotButton';
import StockTypeahead from './StockTypeahead';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Legend, Tooltip,
} from 'recharts';

const VERDICT_COLORS = {
  TIE: '#94a3b8',
  SLIGHT_EDGE: '#60a5fa',
  CLEAR_WINNER: '#34d399',
  DOMINANT: '#fbbf24',
};

const VERDICT_LABELS = {
  TIE: 'Virtual Tie',
  SLIGHT_EDGE: 'Slight Edge',
  CLEAR_WINNER: 'Clear Winner',
  DOMINANT: 'Dominant Winner',
};

const ACTION_COLORS = {
  'Strong Buy': '#22c55e',
  'Buy': '#34d399',
  'Accumulate': '#60a5fa',
  'Hold': '#f59e0b',
  'Reduce': '#f97316',
  'Sell': '#ef4444',
};

const TREND_COLORS = {
  'Bullish': '#22c55e',
  'Mildly Bullish': '#34d399',
  'Neutral': '#94a3b8',
  'Mildly Bearish': '#f97316',
  'Bearish': '#ef4444',
};

const RISK_COLORS = {
  'Low': '#34d399',
  'Medium': '#f59e0b',
  'High': '#ef4444',
};

const ST_COLORS = {
  'Strong': '#22c55e',
  'Moderate': '#34d399',
  'Neutral': '#94a3b8',
  'Weak': '#f97316',
  'Very Weak': '#ef4444',
};

export default function StockComparisonView() {
  const [stock1, setStock1] = useState('');
  const [stock2, setStock2] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [expandedCats, setExpandedCats] = useState(new Set());
  const containerRef = useRef(null);

  const handleCompare = async () => {
    const s1 = stock1.trim().toUpperCase();
    const s2 = stock2.trim().toUpperCase();
    if (!s1 || !s2) {
      setError('Please enter both stock symbols');
      return;
    }
    if (s1 === s2) {
      setError('Please enter two different stocks');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await api.compareStocks(s1, s2);
      if (data.error) {
        setError(data.error);
      } else {
        setResult(data);
      }
    } catch (e) {
      setError(e.message || 'Comparison failed');
    } finally {
      setLoading(false);
    }
  };

  const toggleCategory = (cat) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const fmt = (v) => v != null ? `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })}` : '—';
  const fmtPct = (v) => v != null ? `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}%` : '—';
  const pctClass = (v) => v > 0 ? 'positive' : v < 0 ? 'negative' : '';

  return (
    <div className="predict-view" ref={containerRef}>
      {/* Input Section */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Stock Comparison</h2>
          <ScreenshotButton targetRef={containerRef} filename="stock-comparison" label="Download" />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <StockTypeahead
            value={stock1}
            onChange={setStock1}
            onSubmit={handleCompare}
            placeholder="Stock 1 (e.g. RELIANCE)"
            style={{ flex: 1, minWidth: 140 }}
          />
          <span style={{ color: 'var(--text-secondary)', fontWeight: 700, fontSize: 14 }}>VS</span>
          <StockTypeahead
            value={stock2}
            onChange={setStock2}
            onSubmit={handleCompare}
            placeholder="Stock 2 (e.g. TCS)"
            style={{ flex: 1, minWidth: 140 }}
          />
          <button
            className="scan-btn"
            onClick={handleCompare}
            disabled={loading}
            style={{
              padding: '10px 28px',
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: '0.5px',
            }}
          >
            {loading ? 'Comparing...' : 'Compare'}
          </button>
        </div>
        {error && <p style={{ color: '#ef4444', marginTop: 8, fontSize: 13 }}>{error}</p>}
        {loading && (
          <p style={{ color: 'var(--text-secondary)', marginTop: 8, fontSize: 13 }}>
            Fetching data for both stocks... This may take 15-30 seconds.
          </p>
        )}
      </div>

      {result && <ComparisonResult result={result} fmt={fmt} fmtPct={fmtPct} pctClass={pctClass}
        expandedCats={expandedCats} toggleCategory={toggleCategory} />}
    </div>
  );
}

function ComparisonResult({ result, fmt, fmtPct, pctClass, expandedCats, toggleCategory }) {
  const { stock1, stock2, verdict, radar_data, category_breakdown, metrics_comparison, warnings, piotroski, altman_z } = result;
  const name1 = stock1.name || stock1.symbol;
  const name2 = stock2.name || stock2.symbol;

  // Get radar chart data keys (stock names)
  const radarKeys = radar_data.length > 0
    ? Object.keys(radar_data[0]).filter(k => k !== 'category' && k !== 'fullCategory')
    : [name1, name2];

  return (
    <>
      {/* Verdict Banner */}
      <div className="card" style={{
        borderLeft: `4px solid ${VERDICT_COLORS[verdict.category] || '#60a5fa'}`,
        background: 'linear-gradient(135deg, rgba(30,41,59,0.8), rgba(15,23,42,0.95))',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <span style={{
              display: 'inline-block', padding: '3px 10px', borderRadius: 12,
              background: VERDICT_COLORS[verdict.category] || '#60a5fa',
              color: '#0f172a', fontSize: 11, fontWeight: 700, marginBottom: 6,
            }}>
              {VERDICT_LABELS[verdict.category] || verdict.category}
            </span>
            <h3 style={{ margin: '4px 0', fontSize: 18 }}>
              {verdict.winner ? `${verdict.winner} wins` : 'Too close to call'}
              {verdict.margin > 0 && <span style={{ color: 'var(--text-secondary)', fontSize: 14, fontWeight: 400 }}>
                {' '}by {verdict.margin} pts
              </span>}
            </h3>
          </div>
          <div style={{ display: 'flex', gap: 24, textAlign: 'center' }}>
            <ScoreCircle label={stock1.symbol} score={verdict.stock1_composite}
              action={verdict.stock1_action} color="var(--accent)" />
            <ScoreCircle label={stock2.symbol} score={verdict.stock2_composite}
              action={verdict.stock2_action} color="#f59e0b" />
          </div>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>
          {verdict.summary}
        </p>
      </div>

      {/* Stock Info Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <StockInfoCard stock={stock1} color="var(--accent)" fmt={fmt} fmtPct={fmtPct} pctClass={pctClass} />
        <StockInfoCard stock={stock2} color="#f59e0b" fmt={fmt} fmtPct={fmtPct} pctClass={pctClass} />
      </div>

      {/* Radar Chart */}
      <div className="card">
        <h3 style={{ fontSize: 14, marginBottom: 12 }}>Category Comparison</h3>
        <ResponsiveContainer width="100%" height={350}>
          <RadarChart data={radar_data} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
            <PolarGrid stroke="#334155" />
            <PolarAngleAxis dataKey="category" tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} />
            <Radar name={radarKeys[0]} dataKey={radarKeys[0]} stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.2} />
            <Radar name={radarKeys[1]} dataKey={radarKeys[1]} stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} />
            <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Category Breakdown */}
      <div className="card">
        <h3 style={{ fontSize: 14, marginBottom: 12 }}>Category Breakdown</h3>
        <table className="data-table" style={{ fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Category</th>
              <th>Weight</th>
              <th style={{ color: 'var(--accent)' }}>{stock1.symbol}</th>
              <th style={{ color: '#f59e0b' }}>{stock2.symbol}</th>
              <th>Winner</th>
            </tr>
          </thead>
          <tbody>
            {category_breakdown.map(row => (
              <tr key={row.category} style={{ cursor: 'pointer' }} onClick={() => toggleCategory(row.category)}>
                <td style={{ textAlign: 'left', fontWeight: 500 }}>
                  <span style={{ marginRight: 4 }}>{expandedCats.has(row.category) ? '▾' : '▸'}</span>
                  {row.category}
                </td>
                <td>{row.weight}%</td>
                <td>
                  <ScoreBar score={row.stock1_score} color="var(--accent)" />
                </td>
                <td>
                  <ScoreBar score={row.stock2_score} color="#f59e0b" />
                </td>
                <td style={{
                  color: row.winner === 'Tie' ? '#94a3b8'
                    : row.winner === name1 || row.winner === stock1.name ? 'var(--accent)' : '#f59e0b',
                  fontWeight: 600,
                }}>
                  {row.winner === 'Tie' ? '—' : row.winner === stock1.name || row.winner === name1 ? stock1.symbol : stock2.symbol}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detailed Metrics (expandable per category) */}
      {Object.entries(metrics_comparison).map(([category, metrics]) => {
        if (!expandedCats.has(category)) return null;
        return (
          <div className="card" key={category}>
            <h3 style={{ fontSize: 14, marginBottom: 8 }}>{category} — Detailed Metrics</h3>
            <table className="data-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Metric</th>
                  <th style={{ color: 'var(--accent)' }}>{stock1.symbol}</th>
                  <th style={{ color: '#f59e0b' }}>{stock2.symbol}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {metrics.map(m => (
                  <tr key={m.metric}>
                    <td style={{ textAlign: 'left' }}>{m.label}</td>
                    <td style={{
                      fontWeight: m.better === 'stock1' ? 700 : 400,
                      color: m.better === 'stock1' ? '#34d399' : 'inherit',
                    }}>{m.stock1_value}</td>
                    <td style={{
                      fontWeight: m.better === 'stock2' ? 700 : 400,
                      color: m.better === 'stock2' ? '#34d399' : 'inherit',
                    }}>{m.stock2_value}</td>
                    <td style={{ width: 20 }}>
                      {m.better === 'stock1' && <span style={{ color: 'var(--accent)' }}>●</span>}
                      {m.better === 'stock2' && <span style={{ color: '#f59e0b' }}>●</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {/* Piotroski & Altman Z */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="card">
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Piotroski F-Score</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: 11, marginBottom: 12 }}>
            0–9 scale. Higher = stronger fundamentals.
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-around' }}>
            <FScoreDisplay label={stock1.symbol} score={piotroski.stock1} color="var(--accent)" />
            <FScoreDisplay label={stock2.symbol} score={piotroski.stock2} color="#f59e0b" />
          </div>
        </div>
        <div className="card">
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Altman Z-Score</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: 11, marginBottom: 12 }}>
            &gt;2.99 Safe | 1.81–2.99 Grey | &lt;1.81 Distress
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-around' }}>
            <ZScoreDisplay label={stock1.symbol} score={altman_z.stock1} color="var(--accent)" />
            <ZScoreDisplay label={stock2.symbol} score={altman_z.stock2} color="#f59e0b" />
          </div>
        </div>
      </div>

      {/* Strengths */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="card">
          <h4 style={{ fontSize: 13, color: 'var(--accent)', marginBottom: 8 }}>{stock1.symbol} Strengths</h4>
          {verdict.stock1_strengths?.map(s => (
            <div key={s} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '2px 0' }}>● {s}</div>
          ))}
        </div>
        <div className="card">
          <h4 style={{ fontSize: 13, color: '#f59e0b', marginBottom: 8 }}>{stock2.symbol} Strengths</h4>
          {verdict.stock2_strengths?.map(s => (
            <div key={s} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '2px 0' }}>● {s}</div>
          ))}
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="card" style={{ borderLeft: '4px solid #f59e0b' }}>
          <h3 style={{ fontSize: 14, color: '#f59e0b', marginBottom: 8 }}>Warnings</h3>
          {warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '3px 0', lineHeight: 1.5 }}>
              ⚠ {w}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ── Sub-components ────────────────────────────────────────── */

function ScoreCircle({ label, score, action, color }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        width: 56, height: 56, borderRadius: '50%',
        border: `3px solid ${color}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, fontWeight: 700, color,
      }}>
        {score?.toFixed(1)}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{label}</div>
      {action && (
        <div style={{
          fontSize: 10, fontWeight: 700, marginTop: 3,
          color: ACTION_COLORS[action] || '#94a3b8',
        }}>
          {action}
        </div>
      )}
    </div>
  );
}

function ScoreBar({ score, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
      <div style={{
        width: 60, height: 6, borderRadius: 3,
        background: '#1e293b',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${Math.min(100, Math.max(0, score))}%`,
          height: '100%',
          borderRadius: 3,
          background: color,
        }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, minWidth: 28 }}>{score?.toFixed(1)}</span>
    </div>
  );
}

function StockInfoCard({ stock, color, fmt, fmtPct, pctClass }) {
  const sig = stock.signals || {};
  return (
    <div className="card" style={{ borderTop: `3px solid ${color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color }}>{stock.symbol}</div>
        {sig.action && (
          <span style={{
            padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700,
            background: ACTION_COLORS[sig.action] || '#94a3b8',
            color: '#0f172a',
          }}>
            {sig.action}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
        {stock.name} • {stock.sector}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, marginBottom: sig.trend ? 8 : 0 }}>
        <div>
          <span style={{ color: 'var(--text-secondary)' }}>CMP </span>
          <span style={{ fontWeight: 600 }}>{fmt(stock.cmp)}</span>
          {stock.change_pct != null && (
            <span className={pctClass(stock.change_pct)} style={{ marginLeft: 4 }}>
              ({fmtPct(stock.change_pct)})
            </span>
          )}
        </div>
        {stock.market_cap_cr != null && (
          <div>
            <span style={{ color: 'var(--text-secondary)' }}>MCap </span>
            <span>{stock.market_cap_cr >= 1000 ? `${(stock.market_cap_cr / 1000).toFixed(1)}K Cr` : `${stock.market_cap_cr} Cr`}</span>
          </div>
        )}
        <div>
          <span style={{ color: 'var(--text-secondary)' }}>Industry </span>
          <span>{stock.industry}</span>
        </div>
      </div>
      {sig.trend && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <SignalBadge label="Trend" value={sig.trend} colorMap={TREND_COLORS} />
          <SignalBadge label="Risk" value={sig.risk_level} colorMap={RISK_COLORS} />
          <SignalBadge label="ST Signal" value={sig.st_signal} colorMap={ST_COLORS} />
        </div>
      )}
      {sig.reasoning && sig.reasoning !== 'balanced signals' && (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6, fontStyle: 'italic' }}>
          {sig.reasoning}
        </div>
      )}
    </div>
  );
}

function SignalBadge({ label, value, colorMap }) {
  const c = (colorMap && colorMap[value]) || '#94a3b8';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, padding: '2px 8px', borderRadius: 8,
      border: `1px solid ${c}40`, background: `${c}15`,
    }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}:</span>
      <span style={{ color: c, fontWeight: 600 }}>{value}</span>
    </span>
  );
}

function FScoreDisplay({ label, score, color }) {
  const zone = score >= 7 ? '#34d399' : score >= 4 ? '#f59e0b' : '#ef4444';
  const zoneText = score >= 7 ? 'Strong' : score >= 4 ? 'Moderate' : 'Weak';
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: zone }}>{score}</div>
      <div style={{ fontSize: 11, color: zone }}>{zoneText}</div>
      <div style={{ fontSize: 11, color, marginTop: 4 }}>{label}</div>
    </div>
  );
}

function ZScoreDisplay({ label, score, color }) {
  if (score == null) {
    return (
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#64748b' }}>N/A</div>
        <div style={{ fontSize: 11, color, marginTop: 4 }}>{label}</div>
      </div>
    );
  }
  const zone = score > 2.99 ? '#34d399' : score > 1.81 ? '#f59e0b' : '#ef4444';
  const zoneText = score > 2.99 ? 'Safe' : score > 1.81 ? 'Grey Zone' : 'Distress';
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: zone }}>{score.toFixed(2)}</div>
      <div style={{ fontSize: 11, color: zone }}>{zoneText}</div>
      <div style={{ fontSize: 11, color, marginTop: 4 }}>{label}</div>
    </div>
  );
}
