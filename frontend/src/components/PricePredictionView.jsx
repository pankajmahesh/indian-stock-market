import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import ScreenshotButton from './ScreenshotButton';
import StockTypeahead from './StockTypeahead';

export default function PricePredictionView() {
  const [symbol, setSymbol] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('predict_history');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const containerRef = useRef(null);

  const handlePredict = async (sym) => {
    const s = (sym || symbol).trim().toUpperCase();
    if (!s) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await api.getPredict(s);
      if (data.error) {
        setError(data.error);
      } else {
        setResult({ ...data, queriedSymbol: s });
        setHistory(prev => {
          const filtered = prev.filter(h => h.queriedSymbol !== s);
          const updated = [{ ...data, queriedSymbol: s }, ...filtered].slice(0, 50);
          try { localStorage.setItem('predict_history', JSON.stringify(updated)); } catch {}
          return updated;
        });
      }
    } catch (e) {
      setError(e.message || 'Failed to fetch prediction');
    } finally {
      setLoading(false);
    }
  };

  const removeFromHistory = (sym) => {
    setHistory(prev => {
      const updated = prev.filter(h => h.queriedSymbol !== sym);
      try { localStorage.setItem('predict_history', JSON.stringify(updated)); } catch {}
      return updated;
    });
  };

  const fmt = (v) => v != null ? `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })}` : '—';
  const pctClass = (v) => v > 0 ? 'positive' : v < 0 ? 'negative' : '';
  const fmtPct = (v) => v != null ? `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}%` : '—';

  return (
    <div className="predict-view" ref={containerRef}>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Stock Price Prediction</h2>
          <ScreenshotButton targetRef={containerRef} filename="price-prediction" />
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
          Enter any NSE stock symbol to get ML-powered price predictions for 7, 30, and 90 days.
        </p>
        <div className="predict-input-row">
          <StockTypeahead
            value={symbol}
            onChange={setSymbol}
            onSubmit={() => handlePredict()}
            placeholder="Enter stock symbol (e.g., RELIANCE, TCS, INFY)"
          />
          <button onClick={() => handlePredict()} disabled={loading || !symbol.trim()} className="predict-btn">
            {loading ? 'Predicting...' : 'Predict'}
          </button>
        </div>

        {/* Quick symbols */}
        <div className="quick-symbols">
          {['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ITC', 'BAJFINANCE', 'SBIN', 'BHARTIARTL'].map(s => (
            <button key={s} className="quick-sym" onClick={() => { setSymbol(s); handlePredict(s); }}>{s}</button>
          ))}
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderLeft: '3px solid var(--accent-red)' }}>
          <p style={{ color: 'var(--accent-red)', margin: 0 }}>{error}</p>
        </div>
      )}

      {result && (
        <div className="card predict-result">
          <div className="predict-header">
            <div>
              <h2>{result.queriedSymbol.replace('.NS', '')}</h2>
              {result.algo_version && <span className="algo-badge">{result.algo_version}</span>}
            </div>
            {result.cmp != null && (
              <div className="cmp-display">
                <span className="cmp-label">Current Price</span>
                <span className="cmp-value">
                  {fmt(result.cmp)}
                  {result.change_pct != null && (
                    <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 6, color: result.change_pct >= 0 ? '#22c55e' : '#ef4444' }}>
                      ({result.change_pct >= 0 ? '+' : ''}{result.change_pct}%)
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>

          <div className="predict-targets">
            {[
              { label: '7-Day Target', target: result.target_7d, upside: result.upside_7d_pct },
              { label: '30-Day Target', target: result.target_30d, upside: result.upside_30d_pct },
              { label: '90-Day Target', target: result.target_90d, upside: result.upside_90d_pct },
            ].map(t => (
              <div key={t.label} className="target-card">
                <div className="target-label">{t.label}</div>
                <div className="target-price">{fmt(t.target)}</div>
                {t.upside != null && (
                  <div className={`target-upside ${pctClass(t.upside)}`}>{fmtPct(t.upside)}</div>
                )}
              </div>
            ))}
          </div>

          {/* Prediction Accuracy */}
          {result.accuracy && Object.keys(result.accuracy).length > 0 && (
            <div style={{
              background: 'var(--bg-secondary)', borderRadius: 10, padding: 16, marginBottom: 16,
              border: '1px solid rgba(59,130,246,0.2)',
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: 'var(--text-primary)' }}>
                ML Prediction Accuracy
                <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
                  Out-of-sample validation
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                {[
                  { key: 7, label: '7-Day' },
                  { key: 30, label: '30-Day' },
                  { key: 90, label: '90-Day' },
                ].map(h => {
                  const acc = result.accuracy[h.key];
                  if (!acc) return null;
                  return (
                    <div key={h.key} style={{
                      background: 'var(--bg-primary)', borderRadius: 8, padding: 12,
                      border: '1px solid var(--border)',
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>
                        {h.label}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Direction</span>
                          <span style={{
                            fontWeight: 700,
                            color: acc.direction_accuracy >= 60 ? '#22c55e' : acc.direction_accuracy >= 50 ? '#f59e0b' : '#ef4444',
                          }}>{acc.direction_accuracy}%</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Avg Error</span>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>±{acc.mae}%</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Within ±5%</span>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{acc.within_5pct}%</span>
                        </div>
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 6 }}>
                        {acc.samples} validation samples
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* DCF Intrinsic Value */}
          {result.intrinsic_value != null && (
            <div style={{
              background: 'var(--bg-secondary)', borderRadius: 10, padding: 16, marginBottom: 16,
              border: `1px solid ${result.dcf_upside_pct > 0 ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
                    DCF Intrinsic Value
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{fmt(result.intrinsic_value)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{
                    fontSize: 16, fontWeight: 700,
                    color: result.dcf_upside_pct > 0 ? '#22c55e' : '#ef4444',
                  }}>
                    {fmtPct(result.dcf_upside_pct)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {result.dcf_upside_pct > 10 ? 'Undervalued' : result.dcf_upside_pct < -10 ? 'Overvalued' : 'Fairly Valued'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {result.wacc_used != null && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    WACC: <strong>{result.wacc_used}%</strong>
                  </div>
                )}
                {result.fcf_growth_used != null && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    FCF Growth: <strong>{result.fcf_growth_used}%</strong>
                  </div>
                )}
                {result.terminal_growth != null && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    Terminal Growth: <strong>{result.terminal_growth}%</strong>
                  </div>
                )}
                {result.current_fcf_cr != null && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    Current FCF: <strong>{result.current_fcf_cr} Cr</strong>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Additional details if available */}
          {(result.rsi != null || result.trend != null || result.volatility_ann != null || result.market_cap_cr != null) && (
            <div className="predict-details">
              {result.market_cap_cr != null && <div className="detail-chip">MCap: <strong>{result.market_cap_cr >= 1000 ? `${(result.market_cap_cr / 1000).toFixed(0)}K Cr` : `${result.market_cap_cr} Cr`}</strong></div>}
              {result.promoter_holding_pct != null && <div className="detail-chip">Promoter: <strong>{result.promoter_holding_pct}%</strong></div>}
              {result.ema_trend && <div className="detail-chip">Trend: <strong>{result.ema_trend}</strong></div>}
              {result.rsi != null && <div className="detail-chip">RSI: <strong>{Number(result.rsi).toFixed(1)}</strong></div>}
              {result.volatility_ann != null && <div className="detail-chip">Volatility: <strong>{Number(result.volatility_ann).toFixed(1)}%</strong></div>}
              {result.vwap != null && <div className="detail-chip">VWAP: <strong>{fmt(result.vwap)}</strong></div>}
              {result.supertrend != null && (
                <div className="detail-chip" style={{ background: result.supertrend_signal === 'BUY' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)' }}>
                  Supertrend: <strong style={{ color: result.supertrend_signal === 'BUY' ? '#22c55e' : '#ef4444' }}>
                    {result.supertrend_signal} ({fmt(result.supertrend)})
                  </strong>
                </div>
              )}
              {result.support != null && <div className="detail-chip">Support: <strong>{fmt(result.support)}</strong></div>}
              {result.resistance != null && <div className="detail-chip">Resistance: <strong>{fmt(result.resistance)}</strong></div>}
              {result.adx != null && <div className="detail-chip">ADX: <strong>{Number(result.adx).toFixed(1)}</strong></div>}
              {result.confidence != null && <div className="detail-chip">Confidence: <strong>{result.confidence}</strong></div>}
            </div>
          )}
        </div>
      )}

      {/* History */}
      {history.length > 1 && (
        <div className="card">
          <h2>Recent Predictions</h2>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>CMP</th>
                  <th>Chg %</th>
                  <th>7D Target</th>
                  <th>7D Upside</th>
                  <th>30D Target</th>
                  <th>30D Upside</th>
                  <th>90D Target</th>
                  <th>90D Upside</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.queriedSymbol} className="clickable" onClick={() => { setSymbol(h.queriedSymbol); handlePredict(h.queriedSymbol); }}>
                    <td style={{ fontWeight: 600 }}>{h.queriedSymbol.replace('.NS', '')}</td>
                    <td>{fmt(h.cmp)}</td>
                    <td className={pctClass(h.change_pct)}>{fmtPct(h.change_pct)}</td>
                    <td>{fmt(h.target_7d)}</td>
                    <td className={pctClass(h.upside_7d_pct)}>{fmtPct(h.upside_7d_pct)}</td>
                    <td>{fmt(h.target_30d)}</td>
                    <td className={pctClass(h.upside_30d_pct)}>{fmtPct(h.upside_30d_pct)}</td>
                    <td>{fmt(h.target_90d)}</td>
                    <td className={pctClass(h.upside_90d_pct)}>{fmtPct(h.upside_90d_pct)}</td>
                    <td>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeFromHistory(h.queriedSymbol); }}
                        title="Remove from history"
                        style={{
                          padding: '3px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                          border: 'none', cursor: 'pointer',
                          background: 'rgba(239,68,68,0.1)', color: '#ef4444',
                        }}
                      >
                        x
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
