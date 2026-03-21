import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';

const fmtPct = (n) => (n == null || isNaN(n)) ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
const fmtNum = (n, d = 1) => (n == null || isNaN(n)) ? '—' : n.toFixed(d);

/* Color for accuracy ranges */
function accColor(pct) {
  if (pct >= 70) return '#22c55e';
  if (pct >= 55) return '#eab308';
  if (pct >= 40) return '#f97316';
  return '#ef4444';
}

function retColor(v) {
  if (v == null) return '#94a3b8';
  return v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : '#94a3b8';
}

/* Big metric card */
function MetricCard({ label, value, suffix = '', color, sub }) {
  return (
    <div style={{
      background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(51,65,85,0.4)',
      borderRadius: 12, padding: '14px 16px', flex: '1 1 140px', minWidth: 130,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <span style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 700, color: color || '#e2e8f0', fontVariantNumeric: 'tabular-nums' }}>
        {value}{suffix && <span style={{ fontSize: 12, fontWeight: 500, marginLeft: 2 }}>{suffix}</span>}
      </span>
      {sub && <span style={{ fontSize: 10, color: '#64748b' }}>{sub}</span>}
    </div>
  );
}

/* Gauge ring (reused pattern) */
function GaugeRing({ value, maxVal = 100, size = 56, label, color }) {
  const pct = Math.min(100, Math.max(0, (value / maxVal) * 100));
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const c = color || accColor(pct);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(100,116,139,0.15)" strokeWidth={5} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={c} strokeWidth={5}
            strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
        </svg>
        <span style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, color: c,
        }}>{fmtNum(value, 1)}{maxVal === 100 ? '%' : ''}</span>
      </div>
      {label && <span style={{ fontSize: 9, color: '#94a3b8', textAlign: 'center' }}>{label}</span>}
    </div>
  );
}

/* Quintile bar chart */
function QuintileChart({ quintiles, label }) {
  if (!quintiles || !quintiles.length) return null;
  const maxAbs = Math.max(1, ...quintiles.map(q => Math.abs(q.avg_return)));
  return (
    <div style={{
      background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(51,65,85,0.3)',
      borderRadius: 12, padding: 16,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', marginBottom: 12 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {quintiles.map((q) => (
          <div key={q.quintile} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: '#94a3b8', width: 70, textAlign: 'right', flexShrink: 0 }}>
              {q.label}
            </span>
            <div style={{
              flex: 1, height: 20, borderRadius: 4, background: 'rgba(51,65,85,0.3)',
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute',
                left: q.avg_return >= 0 ? '50%' : `${50 - (Math.abs(q.avg_return) / maxAbs) * 50}%`,
                width: `${(Math.abs(q.avg_return) / maxAbs) * 50}%`,
                height: '100%', borderRadius: 4,
                background: q.avg_return >= 0
                  ? 'linear-gradient(90deg, rgba(34,197,94,0.3), rgba(34,197,94,0.7))'
                  : 'linear-gradient(90deg, rgba(239,68,68,0.7), rgba(239,68,68,0.3))',
              }} />
              <div style={{
                position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1,
                background: 'rgba(148,163,184,0.3)',
              }} />
            </div>
            <span style={{
              fontSize: 11, fontWeight: 600, width: 55, textAlign: 'right',
              color: retColor(q.avg_return), fontVariantNumeric: 'tabular-nums',
            }}>{fmtPct(q.avg_return)}</span>
            <span style={{ fontSize: 9, color: '#64748b', width: 40, textAlign: 'right' }}>
              ({q.count})
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, fontSize: 9, color: '#64748b', textAlign: 'center' }}>
        Avg Score Range &rarr; Avg Return | Higher quintile = higher composite score
      </div>
    </div>
  );
}

/* Mini stock table */
function StockTable({ rows, columns, title }) {
  if (!rows || !rows.length) return null;
  return (
    <div style={{
      background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(51,65,85,0.3)',
      borderRadius: 12, padding: 14, overflow: 'auto',
    }}>
      {title && <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', marginBottom: 10 }}>{title}</div>}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} style={{
                textAlign: c.align || 'left', padding: '4px 8px', color: '#94a3b8',
                fontWeight: 500, borderBottom: '1px solid rgba(51,65,85,0.3)',
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid rgba(51,65,85,0.15)' }}>
              {columns.map(c => (
                <td key={c.key} style={{
                  padding: '5px 8px', textAlign: c.align || 'left',
                  color: c.color ? c.color(r[c.key], r) : '#e2e8f0',
                  fontWeight: c.bold ? 600 : 400, fontVariantNumeric: 'tabular-nums',
                }}>{c.format ? c.format(r[c.key], r) : r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function BacktestView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const pollRef = useRef(null);

  const loadData = useCallback(async () => {
    try {
      const res = await api.getBacktest();
      if (!res.error) { setData(res); setLoading(false); }
      else { setData(null); setLoading(false); }
    } catch { setData(null); setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const startScan = async () => {
    try {
      await api.scanBacktest();
      setScanning(true);
      pollRef.current = setInterval(async () => {
        try {
          const s = await api.getBacktestStatus();
          setStatus(s);
          if (!s.running) {
            clearInterval(pollRef.current);
            setScanning(false);
            loadData();
          }
        } catch { /* ignore */ }
      }, 3000);
    } catch { /* ignore */ }
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const tabs = [
    { id: 'overview', label: 'Overview', dot: '#3b82f6' },
    { id: 'predictions', label: 'Price Predictions', dot: '#06b6d4' },
    { id: 'signals', label: 'Signal Win Rate', dot: '#22c55e' },
    { id: 'scores', label: 'Score Correlation', dot: '#a78bfa' },
  ];

  const s = data?.summary || {};
  const pp = s.price_prediction || {};
  const sig = s.signals || {};
  const cs = s.composite_scores || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(15,23,42,0.8), rgba(30,41,59,0.7))',
        border: '1px solid rgba(51,65,85,0.4)', borderRadius: 14, padding: '18px 20px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>Accuracy Backtest</div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
            Walk-forward testing of price predictions, signals & composite scores using cached historical data
          </div>
        </div>
        <button
          onClick={startScan} disabled={scanning}
          style={{
            padding: '8px 18px', borderRadius: 8, border: '1px solid rgba(59,130,246,0.5)',
            background: scanning ? 'rgba(51,65,85,0.5)' : 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(59,130,246,0.3))',
            color: '#93c5fd', fontSize: 12, fontWeight: 600, cursor: scanning ? 'wait' : 'pointer',
          }}
        >
          {scanning ? 'Running Backtest...' : 'Run Backtest'}
        </button>
      </div>

      {/* Scan progress */}
      {scanning && status && (
        <div style={{
          background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(51,65,85,0.3)',
          borderRadius: 10, padding: 12, maxHeight: 120, overflow: 'auto',
        }}>
          <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 6 }}>Scan Progress</div>
          {(status.log_lines || []).slice(-8).map((l, i) => (
            <div key={i} style={{ fontSize: 10, color: '#64748b', lineHeight: 1.6 }}>{l}</div>
          ))}
        </div>
      )}

      {/* No data state */}
      {!loading && !data && !scanning && (
        <div style={{
          background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(51,65,85,0.3)',
          borderRadius: 12, padding: 40, textAlign: 'center',
        }}>
          <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 8 }}>No backtest results yet</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            Click "Run Backtest" to test prediction accuracy against historical data.
            Requires cached stock data from previous scans (Index, Portfolio, etc.)
          </div>
        </div>
      )}

      {/* Tabs */}
      {data && (
        <>
          <div className="val-tabs" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                  border: activeTab === t.id ? `1px solid ${t.dot}44` : '1px solid rgba(51,65,85,0.3)',
                  background: activeTab === t.id ? `${t.dot}18` : 'rgba(15,23,42,0.4)',
                  color: activeTab === t.id ? t.dot : '#94a3b8', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.dot, opacity: activeTab === t.id ? 1 : 0.4 }} />
                {t.label}
              </button>
            ))}
          </div>

          {/* ═══ Overview Tab ═══ */}
          {activeTab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Top-level summary cards */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <MetricCard label="Stocks Tested" value={data.tested_stocks} sub={`${data.skipped_stocks} skipped`} />
                <MetricCard label="Predictions" value={data.total_predictions} sub="7d + 30d + 90d combined" />
                <MetricCard label="Signals Tested" value={data.total_signals} />
                <MetricCard label="Score Pairs" value={data.total_score_pairs} sub="Composite score vs return" />
              </div>

              {/* Accuracy gauges */}
              <div style={{
                background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(51,65,85,0.4)',
                borderRadius: 12, padding: 16,
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 14 }}>
                  Prediction Accuracy Summary
                </div>
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {['7d', '30d', '90d'].map(h => {
                    const hd = pp[h];
                    if (!hd) return null;
                    return (
                      <div key={h} style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                        background: 'rgba(15,23,42,0.4)', borderRadius: 10, padding: '12px 18px',
                        border: '1px solid rgba(51,65,85,0.25)', minWidth: 150,
                      }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#06b6d4' }}>{h.toUpperCase()} Horizon</span>
                        <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
                          <GaugeRing value={hd.direction_accuracy} label="Direction" />
                          <GaugeRing value={hd.within_5pct} label="Within 5%" />
                          <GaugeRing value={hd.within_10pct} label="Within 10%" />
                        </div>
                        <div style={{ display: 'flex', gap: 12, fontSize: 10, color: '#94a3b8' }}>
                          <span>MAE: <b style={{ color: '#e2e8f0' }}>{hd.mae}%</b></span>
                          <span>N: <b style={{ color: '#e2e8f0' }}>{hd.count}</b></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Signal + Score summary row */}
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {/* Signal win rate */}
                {sig.total > 0 && (
                  <div style={{
                    flex: '1 1 280px', background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(51,65,85,0.4)',
                    borderRadius: 12, padding: 16,
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 10 }}>
                      Signal Win Rate
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
                      <GaugeRing value={sig.overall_win_rate} size={64} label="Overall" />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {Object.entries(sig.by_type || {}).map(([k, v]) => (
                          <div key={k} style={{ display: 'flex', gap: 8, fontSize: 11, alignItems: 'center' }}>
                            <span style={{
                              padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 600,
                              background: k === 'BULLISH' ? 'rgba(34,197,94,0.15)' : k === 'BEARISH' ? 'rgba(239,68,68,0.15)' : 'rgba(148,163,184,0.15)',
                              color: k === 'BULLISH' ? '#22c55e' : k === 'BEARISH' ? '#ef4444' : '#94a3b8',
                            }}>{k}</span>
                            <span style={{ color: accColor(v.win_rate), fontWeight: 600 }}>{v.win_rate}%</span>
                            <span style={{ color: '#64748b' }}>({v.count})</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Score correlation */}
                {cs.total_stocks > 0 && (
                  <div style={{
                    flex: '1 1 280px', background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(51,65,85,0.4)',
                    borderRadius: 12, padding: 16,
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 10 }}>
                      Composite Score Correlation
                    </div>
                    <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginBottom: 8 }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 24, fontWeight: 700, color: cs.correlation_30d > 0 ? '#22c55e' : '#ef4444' }}>
                          {fmtNum(cs.correlation_30d, 3)}
                        </div>
                        <div style={{ fontSize: 10, color: '#94a3b8' }}>30-day corr.</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 24, fontWeight: 700, color: cs.correlation_90d > 0 ? '#22c55e' : '#ef4444' }}>
                          {fmtNum(cs.correlation_90d, 3)}
                        </div>
                        <div style={{ fontSize: 10, color: '#94a3b8' }}>90-day corr.</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 9, color: '#64748b', textAlign: 'center' }}>
                      {cs.total_stocks} stocks | Positive = higher score predicts higher return
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══ Predictions Tab ═══ */}
          {activeTab === 'predictions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Per-horizon detail cards */}
              {['7d', '30d', '90d'].map(h => {
                const hd = pp[h];
                if (!hd) return null;
                return (
                  <div key={h} style={{
                    background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(51,65,85,0.4)',
                    borderRadius: 12, padding: 16,
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#06b6d4', marginBottom: 12 }}>
                      {h.toUpperCase()} Price Prediction
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                      <MetricCard label="Samples" value={hd.count} />
                      <MetricCard label="Direction Accuracy" value={hd.direction_accuracy} suffix="%" color={accColor(hd.direction_accuracy)} />
                      <MetricCard label="Mean Abs Error" value={hd.mae} suffix="%" color="#eab308" />
                      <MetricCard label="Median Error" value={hd.median_error} suffix="%" />
                      <MetricCard label="Within 5%" value={hd.within_5pct} suffix="%" color={accColor(hd.within_5pct)} />
                      <MetricCard label="Within 10%" value={hd.within_10pct} suffix="%" color={accColor(hd.within_10pct)} />
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#94a3b8' }}>
                      <span>Avg Predicted Return: <b style={{ color: retColor(hd.avg_pred_return) }}>{fmtPct(hd.avg_pred_return)}</b></span>
                      <span>Avg Actual Return: <b style={{ color: retColor(hd.avg_actual_return) }}>{fmtPct(hd.avg_actual_return)}</b></span>
                    </div>
                  </div>
                );
              })}

              {/* Best / Worst predictions tables */}
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 380px' }}>
                  <StockTable
                    title="Most Accurate Predictions"
                    rows={data.best_predictions || []}
                    columns={[
                      { key: 'symbol', label: 'Symbol', bold: true },
                      { key: 'horizon', label: 'Days', align: 'center', format: v => `${v}d` },
                      { key: 'pred_return_pct', label: 'Predicted', align: 'right', format: v => fmtPct(v), color: retColor },
                      { key: 'actual_return_pct', label: 'Actual', align: 'right', format: v => fmtPct(v), color: retColor },
                      { key: 'abs_error_pct', label: 'Error', align: 'right', format: v => `${fmtNum(v)}%`, color: () => '#eab308' },
                      { key: 'direction_correct', label: 'Dir', align: 'center', format: v => v ? 'Y' : 'N', color: v => v ? '#22c55e' : '#ef4444' },
                    ]}
                  />
                </div>
                <div style={{ flex: '1 1 380px' }}>
                  <StockTable
                    title="Least Accurate Predictions"
                    rows={data.worst_predictions || []}
                    columns={[
                      { key: 'symbol', label: 'Symbol', bold: true },
                      { key: 'horizon', label: 'Days', align: 'center', format: v => `${v}d` },
                      { key: 'pred_return_pct', label: 'Predicted', align: 'right', format: v => fmtPct(v), color: retColor },
                      { key: 'actual_return_pct', label: 'Actual', align: 'right', format: v => fmtPct(v), color: retColor },
                      { key: 'abs_error_pct', label: 'Error', align: 'right', format: v => `${fmtNum(v)}%`, color: () => '#ef4444' },
                      { key: 'direction_correct', label: 'Dir', align: 'center', format: v => v ? 'Y' : 'N', color: v => v ? '#22c55e' : '#ef4444' },
                    ]}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ═══ Signals Tab ═══ */}
          {activeTab === 'signals' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {sig.total > 0 ? (
                <>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <MetricCard label="Total Signals" value={sig.total} />
                    <MetricCard label="Win Rate" value={sig.overall_win_rate} suffix="%" color={accColor(sig.overall_win_rate)} />
                    {Object.entries(sig.by_type || {}).map(([k, v]) => (
                      <MetricCard key={k} label={`${k} Win Rate`} value={v.win_rate} suffix="%"
                        color={accColor(v.win_rate)} sub={`${v.count} signals, avg ${fmtPct(v.avg_return)}`} />
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 380px' }}>
                      <StockTable
                        title="Top Signal Winners (30d)"
                        rows={data.top_signal_winners || []}
                        columns={[
                          { key: 'symbol', label: 'Symbol', bold: true },
                          { key: 'signal', label: 'Signal', align: 'center',
                            color: (v) => v === 'BULLISH' ? '#22c55e' : v === 'BEARISH' ? '#ef4444' : '#94a3b8' },
                          { key: 'cmp_at_signal', label: 'Entry', align: 'right', format: v => `₹${fmtNum(v, 0)}` },
                          { key: 'price_after_30d', label: 'After 30d', align: 'right', format: v => `₹${fmtNum(v, 0)}` },
                          { key: 'return_pct', label: 'Return', align: 'right', format: v => fmtPct(v), color: retColor },
                          { key: 'win', label: 'Win', align: 'center', format: v => v ? 'Y' : 'N', color: v => v ? '#22c55e' : '#ef4444' },
                        ]}
                      />
                    </div>
                    <div style={{ flex: '1 1 380px' }}>
                      <StockTable
                        title="Top Signal Losers (30d)"
                        rows={data.top_signal_losers || []}
                        columns={[
                          { key: 'symbol', label: 'Symbol', bold: true },
                          { key: 'signal', label: 'Signal', align: 'center',
                            color: (v) => v === 'BULLISH' ? '#22c55e' : v === 'BEARISH' ? '#ef4444' : '#94a3b8' },
                          { key: 'cmp_at_signal', label: 'Entry', align: 'right', format: v => `₹${fmtNum(v, 0)}` },
                          { key: 'price_after_30d', label: 'After 30d', align: 'right', format: v => `₹${fmtNum(v, 0)}` },
                          { key: 'return_pct', label: 'Return', align: 'right', format: v => fmtPct(v), color: retColor },
                          { key: 'win', label: 'Win', align: 'center', format: v => v ? 'Y' : 'N', color: v => v ? '#22c55e' : '#ef4444' },
                        ]}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
                  No signal data available. Run the backtest first.
                </div>
              )}
            </div>
          )}

          {/* ═══ Scores Tab ═══ */}
          {activeTab === 'scores' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {cs.total_stocks > 0 ? (
                <>
                  {/* Correlation headline */}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <MetricCard label="Stocks Analyzed" value={cs.total_stocks} />
                    <MetricCard label="30d Correlation" value={cs.correlation_30d}
                      color={cs.correlation_30d > 0.1 ? '#22c55e' : cs.correlation_30d < -0.1 ? '#ef4444' : '#94a3b8'}
                      sub="Pearson r: score vs return" />
                    <MetricCard label="90d Correlation" value={cs.correlation_90d}
                      color={cs.correlation_90d > 0.1 ? '#22c55e' : cs.correlation_90d < -0.1 ? '#ef4444' : '#94a3b8'}
                      sub="Pearson r: score vs return" />
                  </div>

                  {/* Quintile charts */}
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 380px' }}>
                      <QuintileChart quintiles={cs.quintiles_30d} label="30-Day Return by Score Quintile" />
                    </div>
                    <div style={{ flex: '1 1 380px' }}>
                      <QuintileChart quintiles={cs.quintiles_90d} label="90-Day Return by Score Quintile" />
                    </div>
                  </div>

                  {/* Interpretation */}
                  <div style={{
                    background: 'rgba(15,23,42,0.4)', border: '1px solid rgba(51,65,85,0.25)',
                    borderRadius: 10, padding: 14,
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#a78bfa', marginBottom: 8 }}>How to Interpret</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>
                      <div><b style={{ color: '#e2e8f0' }}>Correlation &gt; 0.1:</b> Higher composite scores are associated with higher returns — scoring system has predictive value.</div>
                      <div><b style={{ color: '#e2e8f0' }}>Correlation ~ 0:</b> No linear relationship between score and return — scores may be useful for screening but not return prediction.</div>
                      <div><b style={{ color: '#e2e8f0' }}>Correlation &lt; -0.1:</b> Higher scores are associated with lower returns — may indicate mean reversion (high-scored stocks already priced in).</div>
                      <div><b style={{ color: '#e2e8f0' }}>Quintile spread:</b> If Top 20% outperforms Bottom 20%, the scoring system effectively separates winners from losers.</div>
                    </div>
                  </div>

                  {/* Score vs Return scatter data as table */}
                  <StockTable
                    title="Score vs Return Data (top 200 by composite score)"
                    rows={(data.score_return_data || []).sort((a, b) => b.composite_score - a.composite_score).slice(0, 50)}
                    columns={[
                      { key: 'symbol', label: 'Symbol', bold: true },
                      { key: 'name', label: 'Name', format: v => v ? (v.length > 25 ? v.slice(0, 25) + '...' : v) : '' },
                      { key: 'sector', label: 'Sector', format: v => v ? (v.length > 15 ? v.slice(0, 15) + '...' : v) : '' },
                      { key: 'composite_score', label: 'Score', align: 'right', bold: true, color: () => '#3b82f6' },
                      { key: 'fundamental_score', label: 'Fund.', align: 'right', format: v => fmtNum(v) },
                      { key: 'technical_score', label: 'Tech.', align: 'right', format: v => fmtNum(v) },
                      { key: 'return_30d', label: '30d Ret', align: 'right', format: v => fmtPct(v), color: retColor },
                      { key: 'return_90d', label: '90d Ret', align: 'right', format: v => fmtPct(v), color: retColor },
                    ]}
                  />
                </>
              ) : (
                <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
                  No score correlation data. Run the backtest first.
                </div>
              )}
            </div>
          )}

          {/* Methodology note */}
          <div style={{
            background: 'rgba(15,23,42,0.3)', borderRadius: 10, padding: 12,
            border: '1px solid rgba(51,65,85,0.2)',
          }}>
            <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.7 }}>
              <b style={{ color: '#94a3b8' }}>Methodology:</b> Walk-forward backtest using cached 1-year price data.
              For each stock, the predictor runs on historical data up to T-N days and predictions are compared
              with actual prices at T (today). Direction accuracy = predicted up/down matched actual direction.
              Signal win = BULLISH + positive 30d return, or BEARISH + negative 30d return.
              Composite score correlation uses Pearson r between score and actual 30d/90d return.
              Quintile analysis groups stocks into 5 equal buckets by composite score and measures average returns in each.
              <b style={{ color: '#94a3b8' }}> Limitations:</b> Single-point-in-time test (current data only), survivorship bias possible, no transaction costs.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
