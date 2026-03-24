import { useState, useEffect } from 'react';
import { api } from '../api';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

function buildAIBrief(ai) {
  const conviction = ai?.llmConviction || null;
  const tips = Array.isArray(ai?.proTips) ? ai.proTips : [];
  const bulls = tips.filter(t => t?.type === 'bull').map(t => t.text).filter(Boolean);
  const bears = tips.filter(t => t?.type === 'bear').map(t => t.text).filter(Boolean);

  return {
    whyItRanked: conviction?.reason || bulls[0] || 'Composite ranking favors this stock on quality and setup.',
    bullCase: bulls[0] || 'Fundamental and technical pillars are supportive relative to peers.',
    bearCase: bears[0] || conviction?.risk || 'Watch for score deterioration or failed price follow-through.',
    keyRisk: conviction?.risk || bears[1] || 'Execution and market conditions can weaken the setup.',
    trigger: conviction?.catalyst || bulls[1] || 'Track the next technical confirmation or business catalyst.',
    conviction: conviction?.conviction ?? null,
    verdict: ai?.verdict || null,
  };
}

function ScoreBadge({ value, label }) {
  if (value == null) return null;
  const v = Number(value);
  const cls = v >= 70 ? 'score-high' : v >= 50 ? 'score-mid' : 'score-low';
  return (
    <div className="detail-item">
      <div className="label">{label}</div>
      <div className="value"><span className={`score-badge ${cls}`}>{v.toFixed(1)}</span></div>
    </div>
  );
}

function SignalBadge({ signal }) {
  return <span className={`signal-badge signal-${signal || 'HOLD'}`}>{signal || 'N/A'}</span>;
}

export default function StockModal({ symbol, onClose }) {
  const [data, setData] = useState(null);
  const [aiData, setAiData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setAiData(null);
    Promise.allSettled([
      api.getStock(symbol),
      api.getAIInsights(symbol.replace('.NS', '')),
    ])
      .then(([stockRes, aiRes]) => {
        if (stockRes.status === 'fulfilled') setData(stockRes.value);
        if (aiRes.status === 'fulfilled') setAiData(aiRes.value);
      })
      .finally(() => setLoading(false));
  }, [symbol]);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const final = data?.final || {};
  const signal = data?.signal || {};
  const composite = data?.composite || {};
  const fundamental = data?.fundamental || {};
  const deepdive = data?.deep_dive || {};
  const aiBrief = aiData ? buildAIBrief(aiData) : null;

  // Fundamental score breakdown chart
  const scoreChart = [
    { name: 'Profitability', score: fundamental.fund_profitability, color: '#3b82f6' },
    { name: 'Growth', score: fundamental.fund_growth, color: '#22c55e' },
    { name: 'Valuation', score: fundamental.fund_valuation, color: '#a855f7' },
    { name: 'Fin. Health', score: fundamental.fund_financial_health, color: '#06b6d4' },
    { name: 'Dividend', score: fundamental.fund_dividend, color: '#eab308' },
  ].filter(d => d.score != null);

  // Qualitative breakdown chart (Bandhan strategy dimensions)
  const qualChart = [
    { name: 'Management', score: final.qual_management ?? deepdive.qual_management, color: '#3b82f6' },
    { name: 'Moat', score: final.qual_moat ?? deepdive.qual_moat, color: '#22c55e' },
    { name: 'Catalysts', score: final.qual_catalysts ?? deepdive.qual_catalysts, color: '#a855f7' },
    { name: 'Governance', score: final.qual_governance ?? deepdive.qual_governance, color: '#06b6d4' },
    { name: 'Strategy', score: final.qual_strategy_alignment ?? deepdive.qual_strategy_alignment, color: '#f59e0b' },
  ].filter(d => d.score != null);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        {loading ? (
          <div className="loading"><div className="spinner" /> Loading stock details...</div>
        ) : !data ? (
          <div className="empty-state">
            <h3>Stock Not Found</h3>
            <p>{symbol}</p>
          </div>
        ) : (
          <>
            <div className="modal-header">
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {symbol.replace('.NS', '')} — {final.name || composite.name || ''}
                  {final.l_category && (() => {
                    const colors = { L1: '#22c55e', L2: '#f59e0b', L3: '#ef4444' };
                    const labels = { L1: 'High Quality', L2: 'Mid Quality', L3: 'Cyclical' };
                    const c = colors[final.l_category] || '#94a3b8';
                    return (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: `${c}22`, color: c, border: `1px solid ${c}44` }}>
                        {final.l_category} · {labels[final.l_category]}
                      </span>
                    );
                  })()}
                </h2>
                <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                  {final.sector || composite.sector || ''} | {final.industry || composite.industry || ''}
                </div>
              </div>
              <button className="modal-close" onClick={onClose}>✕</button>
            </div>

            {/* Key metrics */}
            <div className="detail-grid">
              <div className="detail-item">
                <div className="label">CMP</div>
                <div className="value">₹{Number(final.cmp || composite.last_price || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })}</div>
              </div>
              <div className="detail-item">
                <div className="label">Market Cap</div>
                <div className="value">{final.market_cap_cr ? `₹${Number(final.market_cap_cr).toLocaleString('en-IN')} Cr` : 'N/A'}</div>
              </div>
              <div className="detail-item">
                <div className="label">Signal</div>
                <div className="value"><SignalBadge signal={signal.signal} /></div>
              </div>
              <div className="detail-item">
                <div className="label">Signal Strength</div>
                <div className="value" style={{ color: (signal.signal_strength || 0) > 0 ? 'var(--accent-green)' : (signal.signal_strength || 0) < 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                  {signal.signal_strength || 0}
                </div>
              </div>
              <div className="detail-item">
                <div className="label">P/E Ratio</div>
                <div className="value">{final.pe_ratio != null ? Number(final.pe_ratio).toFixed(1) : 'N/A'}</div>
              </div>
              <div className="detail-item">
                <div className="label">D/E Ratio</div>
                <div className="value">{final.debt_to_equity != null ? `${Number(final.debt_to_equity).toFixed(0)}%` : 'N/A'}</div>
              </div>
            </div>

            {/* Scores */}
            <div className="detail-grid">
              <ScoreBadge value={final.final_score || composite.composite_score} label="Final Score" />
              <ScoreBadge value={final.fundamental_score || composite.fundamental_score} label="Fundamental" />
              <ScoreBadge value={final.technical_score || composite.technical_score} label="Technical" />
              <ScoreBadge value={final.qualitative_score} label="Qualitative" />
              <ScoreBadge value={final.qual_strategy_alignment} label="Strategy Alignment" />
              <ScoreBadge value={final.composite_score || composite.composite_score} label="Composite" />
            </div>

            {/* Fundamental breakdown chart */}
            {scoreChart.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <h2 style={{ fontSize: 14, marginBottom: 12 }}>Fundamental Breakdown</h2>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={scoreChart} layout="vertical" margin={{ left: 80 }}>
                    <XAxis type="number" domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} width={80} />
                    <Tooltip contentStyle={{ background: '#1e2235', border: '1px solid #2d3348', borderRadius: 8 }} />
                    <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                      {scoreChart.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Qualitative (Bandhan) breakdown chart */}
            {qualChart.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <h2 style={{ fontSize: 14, marginBottom: 12 }}>Qualitative Breakdown <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>(Bandhan Strategy)</span></h2>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={qualChart} layout="vertical" margin={{ left: 80 }}>
                    <XAxis type="number" domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} width={80} />
                    <Tooltip contentStyle={{ background: '#1e2235', border: '1px solid #2d3348', borderRadius: 8 }} />
                    <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                      {qualChart.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Thesis & Risk */}
            {aiBrief && (
              <div style={{ marginBottom: 20 }}>
                <h2 style={{ fontSize: 14, marginBottom: 10 }}>AI Stock Brief</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                  {[
                    ['Why It Ranked', aiBrief.whyItRanked, '#60a5fa'],
                    ['Bull Case', aiBrief.bullCase, '#22c55e'],
                    ['Bear Case', aiBrief.bearCase, '#f97316'],
                    ['Key Risk', aiBrief.keyRisk, '#ef4444'],
                    ['Near-Term Trigger', aiBrief.trigger, '#a78bfa'],
                  ].map(([label, text, color]) => (
                    <div key={label} style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--bg-secondary)', borderLeft: `3px solid ${color}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <div style={{ fontSize: 10, color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
                        {label === 'Why It Ranked' && aiBrief.conviction != null && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#60a5fa' }}>
                            {aiBrief.conviction}/10
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{text}</div>
                    </div>
                  ))}
                </div>
                {aiBrief.verdict && (
                  <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
                    AI verdict: <strong style={{ color: 'var(--text-primary)' }}>{aiBrief.verdict}</strong>
                  </div>
                )}
              </div>
            )}

            {final.bull_thesis && (
              <>
                <h2 style={{ fontSize: 14, marginBottom: 8 }}>Bull Thesis</h2>
                <div className="thesis-box">{final.bull_thesis}</div>
              </>
            )}
            {final.key_risk && (
              <>
                <h2 style={{ fontSize: 14, marginBottom: 8 }}>Key Risk</h2>
                <div className="risk-box">{final.key_risk}</div>
              </>
            )}

            {/* Levels */}
            <div className="detail-grid" style={{ marginTop: 16 }}>
              <div className="detail-item">
                <div className="label">Entry Zone</div>
                <div className="value" style={{ color: 'var(--accent-cyan)', fontSize: 15 }}>₹{final.entry_zone || 'N/A'}</div>
              </div>
              <div className="detail-item">
                <div className="label">Stop Loss</div>
                <div className="value" style={{ color: 'var(--accent-red)', fontSize: 15 }}>₹{final.stop_loss || 'N/A'}</div>
              </div>
              <div className="detail-item">
                <div className="label">Target</div>
                <div className="value" style={{ color: 'var(--accent-green)', fontSize: 15 }}>₹{final.target || 'N/A'}</div>
              </div>
              {signal.take_profit_price && (
                <div className="detail-item">
                  <div className="label">Take Profit (5%)</div>
                  <div className="value" style={{ color: 'var(--accent-green)', fontSize: 15 }}>₹{Number(signal.take_profit_price).toLocaleString('en-IN')}</div>
                </div>
              )}
            </div>

            {/* Signal details */}
            {signal.signal_details && (
              <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)' }}>
                <strong>Signal Details:</strong> {signal.signal_details}
              </div>
            )}

            {/* Indicator values */}
            {signal.rsi_value != null && (
              <div className="detail-grid" style={{ marginTop: 16 }}>
                <div className="detail-item">
                  <div className="label">RSI (14)</div>
                  <div className="value">{Number(signal.rsi_value).toFixed(1)}</div>
                </div>
                <div className="detail-item">
                  <div className="label">StochRSI %K</div>
                  <div className="value">{Number(signal.stochrsi_k).toFixed(1)}</div>
                </div>
                <div className="detail-item">
                  <div className="label">MACD</div>
                  <div className="value">{Number(signal.macd_value).toFixed(2)}</div>
                </div>
                <div className="detail-item">
                  <div className="label">MACD Histogram</div>
                  <div className="value" style={{ color: (signal.macd_histogram || 0) > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                    {Number(signal.macd_histogram).toFixed(2)}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
