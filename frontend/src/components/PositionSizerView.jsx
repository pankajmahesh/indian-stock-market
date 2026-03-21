import { useState, useMemo } from 'react';
import { api } from '../api';

/*
  Position Sizing Calculator — Minervini R-based method
  Risk no more than 1-2% of portfolio per trade.
  Position size = (Portfolio × Risk%) / (Entry - Stop)
*/

const PRESETS = [
  { label: 'Conservative', risk: 0.5, stop: 7 },
  { label: 'Moderate',     risk: 1.0, stop: 7 },
  { label: 'Aggressive',   risk: 2.0, stop: 8 },
];

function fmt(v, dec = 0) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('en-IN', { maximumFractionDigits: dec });
}

function ResultRow({ label, value, color, sub }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</div>
        {sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{sub}</div>}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color || 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

export default function PositionSizerView() {
  const [portfolio, setPortfolio]   = useState(500000);
  const [riskPct, setRiskPct]       = useState(1.0);
  const [entry, setEntry]           = useState('');
  const [stopPct, setStopPct]       = useState(7);
  const [target, setTarget]         = useState('');
  const [symbol, setSymbol]         = useState('');
  const [livePrice, setLivePrice]   = useState(null);
  const [fetching, setFetching]     = useState(false);

  const entryNum  = parseFloat(entry)  || 0;
  const targetNum = parseFloat(target) || 0;

  const stopPrice = entryNum > 0 ? entryNum * (1 - stopPct / 100) : 0;
  const riskPerShare = entryNum - stopPrice;
  const maxRiskAmount = portfolio * (riskPct / 100);

  const shares = riskPerShare > 0 ? Math.floor(maxRiskAmount / riskPerShare) : 0;
  const investedAmt = shares * entryNum;
  const maxLoss     = shares * riskPerShare;
  const potentialGain = targetNum > 0 && shares > 0 ? shares * (targetNum - entryNum) : null;
  const rr = potentialGain != null && maxLoss > 0 ? potentialGain / maxLoss : null;
  const portfolioPct = portfolio > 0 ? (investedAmt / portfolio) * 100 : 0;

  const rrColor = rr == null ? '#94a3b8' : rr >= 3 ? '#22c55e' : rr >= 2 ? '#eab308' : '#ef4444';
  const rrLabel = rr == null ? '' : rr >= 3 ? 'Excellent' : rr >= 2 ? 'Acceptable' : 'Poor — skip';

  const fetchLive = () => {
    if (!symbol.trim()) return;
    setFetching(true);
    const sym = symbol.trim().toUpperCase().includes('.NS')
      ? symbol.trim().toUpperCase()
      : symbol.trim().toUpperCase() + '.NS';
    api.getLivePrice(sym)
      .then(d => {
        const p = d?.price ?? d?.cmp ?? d?.regularMarketPrice;
        if (p) {
          setLivePrice(p);
          setEntry(String(Number(p).toFixed(2)));
        }
      })
      .catch(() => {})
      .finally(() => setFetching(false));
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 4px' }}>Position Sizing Calculator</h2>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
          Risk-based sizing (Minervini method) — never lose more than 1–2% of portfolio per trade
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>

        {/* ── Inputs ── */}
        <div className="card">
          <h3 style={{ margin: '0 0 16px', fontSize: 14 }}>Inputs</h3>

          {/* Preset buttons */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>RISK PRESET</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {PRESETS.map(p => (
                <button key={p.label}
                  onClick={() => { setRiskPct(p.risk); setStopPct(p.stop); }}
                  style={{
                    flex: 1, padding: '6px 0', borderRadius: 7, border: '1px solid var(--border)',
                    background: riskPct === p.risk && stopPct === p.stop ? 'var(--accent-blue)' : 'var(--bg-secondary)',
                    color: riskPct === p.risk && stopPct === p.stop ? 'white' : 'var(--text-secondary)',
                    fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Portfolio size */}
          <Field label="Portfolio Size (₹)" hint="Total capital you are working with">
            <input type="number" value={portfolio} onChange={e => setPortfolio(Number(e.target.value))}
              style={inputStyle} />
          </Field>

          {/* Risk % */}
          <Field label={`Risk per Trade: ${riskPct}%`} hint="Max % of portfolio to risk (1% recommended)">
            <input type="range" min={0.25} max={3} step={0.25} value={riskPct}
              onChange={e => setRiskPct(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent-blue)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
              <span>0.25%</span><span>1%</span><span>2%</span><span>3%</span>
            </div>
          </Field>

          {/* Symbol + live price */}
          <Field label="Symbol (optional)" hint="Fetch live price automatically">
            <div style={{ display: 'flex', gap: 6 }}>
              <input placeholder="e.g. RELIANCE" value={symbol}
                onChange={e => setSymbol(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && fetchLive()}
                style={{ ...inputStyle, flex: 1 }} />
              <button onClick={fetchLive} disabled={fetching || !symbol.trim()}
                style={{
                  padding: '7px 12px', borderRadius: 7, border: 'none',
                  background: 'var(--accent-blue)', color: 'white',
                  fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                }}>
                {fetching ? '...' : 'Live ₹'}
              </button>
            </div>
            {livePrice && (
              <div style={{ fontSize: 10, color: '#22c55e', marginTop: 3 }}>
                Live: ₹{fmt(livePrice, 2)} — set as entry price
              </div>
            )}
          </Field>

          {/* Entry price */}
          <Field label="Entry Price (₹)" hint="Price at which you plan to buy">
            <input type="number" value={entry} onChange={e => setEntry(e.target.value)}
              placeholder="e.g. 2450.00" style={inputStyle} />
          </Field>

          {/* Stop-loss % */}
          <Field label={`Stop-Loss: ${stopPct}% below entry`} hint="Minervini: hard stop at 7–8%">
            <input type="range" min={2} max={15} step={0.5} value={stopPct}
              onChange={e => setStopPct(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#ef4444' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
              <span>2%</span><span>7%</span><span>10%</span><span>15%</span>
            </div>
          </Field>

          {/* Target */}
          <Field label="Target Price (₹) — optional" hint="Used to calculate risk:reward ratio">
            <input type="number" value={target} onChange={e => setTarget(e.target.value)}
              placeholder="e.g. 3100.00" style={inputStyle} />
          </Field>
        </div>

        {/* ── Results ── */}
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>Position Size</h3>
            <div style={{ fontSize: 32, fontWeight: 900, color: 'var(--accent-blue)', marginBottom: 2 }}>
              {shares > 0 ? fmt(shares) : '—'} <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-muted)' }}>shares</span>
            </div>
            {investedAmt > 0 && (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                = ₹{fmt(investedAmt)} invested ({portfolioPct.toFixed(1)}% of portfolio)
              </div>
            )}
          </div>

          <div className="card">
            <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Trade Summary</h3>

            <ResultRow label="Entry Price" value={entryNum > 0 ? `₹${fmt(entryNum, 2)}` : '—'} />
            <ResultRow
              label="Stop-Loss Price"
              value={stopPrice > 0 ? `₹${fmt(stopPrice, 2)}` : '—'}
              color="#ef4444"
              sub={`${stopPct}% below entry`}
            />
            <ResultRow
              label="Max Loss (1R)"
              value={maxLoss > 0 ? `₹${fmt(maxLoss)}` : '—'}
              color="#ef4444"
              sub={`${riskPct}% of ₹${fmt(portfolio)} portfolio`}
            />
            {targetNum > 0 && (
              <ResultRow
                label="Target Price"
                value={`₹${fmt(targetNum, 2)}`}
                color="#22c55e"
              />
            )}
            {potentialGain != null && (
              <ResultRow
                label="Potential Gain"
                value={`₹${fmt(potentialGain)}`}
                color="#22c55e"
                sub={`+${(((targetNum - entryNum) / entryNum) * 100).toFixed(1)}% return`}
              />
            )}
            {rr != null && (
              <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Risk : Reward</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{rrLabel}</div>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: rrColor }}>
                    1 : {rr.toFixed(1)}
                  </div>
                </div>
                {rr < 2 && (
                  <div style={{ marginTop: 6, fontSize: 11, color: '#ef4444' }}>
                    Minervini rule: only take trades with minimum 3:1 risk:reward
                  </div>
                )}
              </div>
            )}

            <ResultRow
              label="Portfolio Concentration"
              value={portfolioPct > 0 ? `${portfolioPct.toFixed(1)}%` : '—'}
              color={portfolioPct > 15 ? '#eab308' : 'var(--text-primary)'}
              sub={portfolioPct > 15 ? 'Consider splitting into smaller buys' : 'Within safe limits'}
            />
          </div>

          {/* Pyramid plan */}
          {shares > 2 && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3 style={{ margin: '0 0 10px', fontSize: 13 }}>Pyramid Buy Plan</h3>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                Minervini: buy in 3 tranches — initial + add on confirmed strength
              </div>
              {[
                { label: 'Initial Entry', pct: 50, desc: 'At breakout pivot' },
                { label: 'Add #1',        pct: 30, desc: '+3% above entry (breakout confirmation)' },
                { label: 'Add #2',        pct: 20, desc: '+7% above entry (trend continuation)' },
              ].map(t => {
                const trancheShares = Math.floor(shares * t.pct / 100);
                const tranchePrice = t.label === 'Initial Entry' ? entryNum
                  : t.label === 'Add #1' ? entryNum * 1.03 : entryNum * 1.07;
                return (
                  <div key={t.label} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 12,
                  }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{t.label} ({t.pct}%)</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t.desc}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700 }}>{fmt(trancheShares)} shares</div>
                      {tranchePrice > 0 && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          ~₹{fmt(trancheShares * tranchePrice)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 7,
  border: '1px solid var(--border)',
  background: 'var(--bg-secondary)', color: 'var(--text-primary)',
  fontSize: 13, outline: 'none', boxSizing: 'border-box',
};

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
        {label}
        {hint && <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>— {hint}</span>}
      </div>
      {children}
    </div>
  );
}
