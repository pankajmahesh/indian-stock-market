import { useState, useRef, useCallback } from 'react';
import { api } from '../api';
import ScreenshotButton from './ScreenshotButton';
import StockTypeahead from './StockTypeahead';

const fmt = (n) => {
  if (n == null || isNaN(n)) return 'N/A';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'T';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'B';
  return n.toFixed(1) + 'M';
};
const fmtP = (n) => (n == null || isNaN(n)) ? 'N/A' : `\u20B9${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const pctStr = (a, b) => b ? (((a - b) / b) * 100).toFixed(1) : '0.0';

const MOS_COLORS = {
  'Strong Buy': '#22c55e',
  'Buy': '#34d399',
  'Hold': '#f59e0b',
  'Sell': '#ef4444',
};

export default function IntrinsicValuationView() {
  const [symbol, setSymbol] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [inputs, setInputs] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('results');
  const [recalculating, setRecalculating] = useState(false);
  const containerRef = useRef(null);

  const handleFetch = async (sym) => {
    const s = (sym || symbol).trim().toUpperCase();
    if (!s) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setInputs(null);
    setTab('results');
    try {
      const data = await api.getIntrinsicValuation(s);
      if (data.error) {
        setError(data.error);
      } else {
        setResult(data);
        setInputs({ ...data.inputs });
      }
    } catch (e) {
      setError(e.message || 'Failed to fetch valuation');
    } finally {
      setLoading(false);
    }
  };

  const handleRecalculate = async () => {
    if (!symbol || !inputs) return;
    setRecalculating(true);
    setError(null);
    try {
      const data = await api.recalcIntrinsicValuation(symbol.trim().toUpperCase(), inputs);
      if (data.error) {
        setError(data.error);
      } else {
        setResult(data);
        setInputs({ ...data.inputs });
        setTab('results');
      }
    } catch (e) {
      setError(e.message || 'Recalculation failed');
    } finally {
      setRecalculating(false);
    }
  };

  const upd = useCallback((key, val) => {
    setInputs(prev => ({ ...prev, [key]: parseFloat(val) || 0 }));
  }, []);

  return (
    <div className="predict-view" ref={containerRef}>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Intrinsic Valuation</h2>
          <ScreenshotButton targetRef={containerRef} filename="intrinsic-valuation" label="Download" />
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginBottom: 8 }}>
          Morgan Stanley-style DCF + Relative Valuation with scenario analysis and sensitivity.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <StockTypeahead
            value={symbol}
            onChange={setSymbol}
            onSubmit={() => handleFetch()}
            placeholder="e.g. RELIANCE"
            style={{ flex: 1, minWidth: 160 }}
          />
          <button className="scan-btn" onClick={() => handleFetch()} disabled={loading}>
            {loading ? 'Fetching...' : 'Valuate'}
          </button>
        </div>
        {error && <p style={{ color: '#ef4444', marginTop: 8, fontSize: 13 }}>{error}</p>}
        {loading && (
          <p style={{ color: 'var(--text-secondary)', marginTop: 8, fontSize: 13 }}>
            Fetching financial data and computing valuation...
          </p>
        )}
      </div>

      {result && <ValuationResult result={result} inputs={inputs} upd={upd} tab={tab} setTab={setTab}
        handleRecalculate={handleRecalculate} recalculating={recalculating} />}
    </div>
  );
}

function ValuationResult({ result, inputs, upd, tab, setTab, handleRecalculate, recalculating }) {
  const { dcf, relative, composite, meta, scenarios, sensitivity, waccBreakdown, marginOfSafety } = result;
  const price = inputs?.currentPrice || 0;
  const maxVal = Math.max(price, dcf.dcfBull, relative.relativeValue, composite.intrinsicValue, dcf.dcfPerShare) * 1.2 || 1;

  const verdictColor = composite.verdict === 'Undervalued' ? '#34d399'
    : composite.verdict === 'Overvalued' ? '#ef4444' : '#f59e0b';
  const mosColor = MOS_COLORS[marginOfSafety?.zone] || '#64748b';

  const tabs = [
    { id: 'results', label: 'Results', dot: '#3b82f6' },
    { id: 'scenarios', label: 'Scenarios', dot: '#22c55e' },
    { id: 'dcf', label: 'DCF Model', dot: '#a78bfa' },
    { id: 'sensitivity', label: 'Sensitivity', dot: '#f59e0b' },
    { id: 'relative', label: 'Relative Val', dot: '#06b6d4' },
    { id: 'inputs', label: 'Edit Inputs', dot: '#94a3b8' },
  ];

  return (
    <>
      {/* Header */}
      <div className="card" style={{
        borderLeft: `4px solid ${verdictColor}`,
        background: `linear-gradient(135deg, var(--bg-card) 0%, rgba(30, 34, 53, 0.95) 100%)`,
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Subtle gradient orb in background */}
        <div style={{
          position: 'absolute', top: -40, right: -40, width: 160, height: 160,
          background: `radial-gradient(circle, ${verdictColor}08 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, position: 'relative' }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>{result.name} &bull; {result.sector}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Intrinsic Value Estimate</div>
            <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{fmtP(composite.intrinsicValue)}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: verdictColor, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 6,
                background: `${verdictColor}15`, fontSize: 12, fontWeight: 700,
              }}>
                {composite.verdict}
              </span>
              <span style={{ fontSize: 13 }}>{composite.upside >= 0 ? '+' : ''}{composite.upside}% vs {fmtP(price)}</span>
            </div>
            {marginOfSafety && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8,
                padding: '4px 12px', borderRadius: 20,
                background: `${mosColor}12`, border: `1px solid ${mosColor}40`,
                fontSize: 12, fontWeight: 600, color: mosColor,
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', background: mosColor,
                  boxShadow: `0 0 8px ${mosColor}60`,
                }} />
                MoS: {marginOfSafety.pct >= 0 ? '+' : ''}{marginOfSafety.pct}% &mdash; {marginOfSafety.zone}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>Breakdown</div>
            <div style={{ fontSize: 13, marginBottom: 2 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Weighted DCF </span>
              <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 15 }}>{fmtP(dcf.weightedDcfPerShare || dcf.dcfPerShare)}</span>
            </div>
            <div style={{ fontSize: 13, marginBottom: 2 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Relative Value </span>
              <span style={{ color: '#a78bfa', fontWeight: 700, fontSize: 15 }}>{fmtP(relative.relativeValue)}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>= Average of both methods</div>
            {waccBreakdown && (
              <div style={{
                display: 'inline-block', marginTop: 6, padding: '2px 10px', borderRadius: 6,
                background: 'rgba(59, 130, 246, 0.08)', fontSize: 11, fontWeight: 600, color: 'var(--accent)',
              }}>
                WACC: {waccBreakdown.wacc}%
              </div>
            )}
          </div>
        </div>

        {/* Visual bars */}
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
          <ValBar label="Market Price" value={price} max={maxVal} color="#64748b" />
          <ValBar label="Weighted DCF" value={dcf.weightedDcfPerShare || dcf.dcfPerShare} max={maxVal} color="var(--accent-blue)" />
          <ValBar label="Relative Val" value={relative.relativeValue} max={maxVal} color="#a78bfa" />
          <ValBar label="Intrinsic" value={composite.intrinsicValue} max={maxVal} color={verdictColor} bold />
        </div>
      </div>

      {/* Tabs */}
      <div className="val-tabs">
        {tabs.map(({ id, label, dot }) => (
          <button key={id} className={`val-tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
            <span className="tab-dot" style={{ background: dot }} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'results' && <ResultsTab dcf={dcf} relative={relative} meta={meta} price={price} waccBreakdown={waccBreakdown} scenarios={scenarios} />}
      {tab === 'scenarios' && <ScenariosTab scenarios={scenarios} dcf={dcf} price={price} />}
      {tab === 'dcf' && <DCFTab dcf={dcf} inputs={inputs} />}
      {tab === 'sensitivity' && <SensitivityTab sensitivity={sensitivity} price={price} inputs={inputs} />}
      {tab === 'relative' && <RelativeTab relative={relative} price={price} />}
      {tab === 'inputs' && <InputsTab inputs={inputs} upd={upd} handleRecalculate={handleRecalculate} recalculating={recalculating} />}
    </>
  );
}

/* ── Results Tab ─────────────────────────────────────────── */
function ResultsTab({ dcf, relative, meta, price, waccBreakdown, scenarios }) {
  return (
    <>
      {/* Scenario bar with weights */}
      <div className="card">
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>DCF Scenario Analysis (Probability-Weighted)</h3>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
          <span style={{ color: '#ef4444' }}>Bear ({scenarios?.bear?.weight || 25}%): {fmtP(dcf.dcfBear)}</span>
          <span style={{ color: 'var(--accent)' }}>Base ({scenarios?.base?.weight || 50}%): {fmtP(dcf.dcfPerShare)}</span>
          <span style={{ color: '#34d399' }}>Bull ({scenarios?.bull?.weight || 25}%): {fmtP(dcf.dcfBull)}</span>
        </div>
        <div style={{ position: 'relative', height: 16, background: '#1e293b', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', height: '100%', borderRadius: 8, opacity: 0.6,
            background: 'linear-gradient(to right, #ef4444, var(--accent), #34d399)',
            left: '5%', width: '90%',
          }} />
          {price > 0 && dcf.dcfBull !== dcf.dcfBear && (
            <div style={{
              position: 'absolute', top: 0, height: '100%', width: 2, background: 'white',
              left: `${Math.min(Math.max(((price - dcf.dcfBear) / (dcf.dcfBull - dcf.dcfBear)) * 90 + 5, 2), 98)}%`,
            }} />
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
          <span>Current Price: {fmtP(price)}</span>
          <span style={{ fontWeight: 600, color: 'var(--accent)' }}>Weighted Target: {fmtP(dcf.weightedDcfPerShare || dcf.dcfPerShare)}</span>
        </div>
      </div>

      {/* WACC Breakdown */}
      {waccBreakdown && (
        <div className="card" style={{
          background: 'linear-gradient(145deg, var(--bg-card) 0%, rgba(30, 34, 53, 0.95) 100%)',
        }}>
          <h3 style={{ fontSize: 14, marginBottom: 12 }}>WACC Breakdown</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px', fontSize: 12 }}>
            {[
              ['Risk-Free Rate (Rf)', `${waccBreakdown.riskFreeRate}%`],
              ['Equity Risk Premium', `${waccBreakdown.equityRiskPremium}%`],
              ['Beta', waccBreakdown.beta],
              ['Cost of Equity (Ke)', `${waccBreakdown.costOfEquity}%`, 'var(--accent-blue)'],
              ['Cost of Debt (Kd)', `${waccBreakdown.costOfDebt}%`],
              ['Tax Rate', `${waccBreakdown.taxRate}%`],
              ['Equity Weight', `${waccBreakdown.equityWeight}%`],
              ['Debt Weight', `${waccBreakdown.debtWeight}%`],
            ].map(([label, val, color]) => (
              <WaccRow key={label}>
                <span style={{ color: 'var(--text-secondary)', padding: '4px 0' }}>{label}</span>
                <span style={{
                  textAlign: 'right', fontWeight: 600, padding: '4px 0',
                  color: color || 'var(--text-primary)',
                  fontVariantNumeric: 'tabular-nums',
                }}>{val}</span>
              </WaccRow>
            ))}
          </div>
          <div style={{
            marginTop: 12, paddingTop: 12,
            borderTop: '1px solid rgba(59,130,246,0.2)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div>
              <span style={{ fontSize: 14, fontWeight: 700 }}>WACC</span>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic' }}>= (E/V x Ke) + (D/V x Kd x (1-t))</div>
            </div>
            <span style={{
              fontSize: 22, fontWeight: 700, color: 'var(--accent-blue)',
              letterSpacing: '-0.02em',
            }}>{waccBreakdown.wacc}%</span>
          </div>
        </div>
      )}

      {/* Key Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <MetricCard label="Market Cap" value={fmt(meta.marketCap)} />
        <MetricCard label="Enterprise Value" value={fmt(meta.ev)} />
        <MetricCard label="PV of Cash Flows" value={fmt(dcf.totalPVCF)} />
        <MetricCard label="PV of Terminal Value" value={fmt(dcf.pvTerminal)} />
      </div>

      {/* Multiples summary */}
      <div className="card">
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>Relative Valuation Multiples</h3>
        <table className="data-table" style={{ fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Multiple</th>
              <th>Current</th>
              <th>Target</th>
              <th>Implied Price</th>
              <th>vs Market</th>
            </tr>
          </thead>
          <tbody>
            {relative.multiples.map(m => {
              const diff = parseFloat(pctStr(m.implied, price));
              return (
                <tr key={m.name}>
                  <td style={{ textAlign: 'left', fontWeight: 500 }}>{m.name}</td>
                  <td>{m.current?.toFixed(1)}x</td>
                  <td style={{ color: 'var(--accent)' }}>{m.target?.toFixed(1)}x</td>
                  <td style={{ fontWeight: 600 }}>{fmtP(m.implied)}</td>
                  <td style={{ color: diff > 0 ? '#34d399' : '#ef4444' }}>
                    {diff > 0 ? '+' : ''}{diff}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ── Scenarios Tab (NEW) ─────────────────────────────────── */
function ScenariosTab({ scenarios, dcf, price }) {
  if (!scenarios) return <div className="card"><p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Scenario data not available.</p></div>;

  const cases = [
    { key: 'bull', label: 'Bull Case', color: '#34d399', data: scenarios.bull },
    { key: 'base', label: 'Base Case', color: 'var(--accent)', data: scenarios.base },
    { key: 'bear', label: 'Bear Case', color: '#ef4444', data: scenarios.bear },
  ];

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        {cases.map(({ key, label, color, data }) => {
          if (!data) return null;
          const upside = price > 0 ? ((data.dcfPerShare - price) / price * 100).toFixed(1) : '0.0';
          return (
            <div key={key} className="card" style={{
              borderTop: `3px solid ${color}`, position: 'relative', overflow: 'hidden',
              background: 'linear-gradient(145deg, var(--bg-card) 0%, rgba(30, 34, 53, 0.9) 100%)',
            }}>
              <div style={{
                position: 'absolute', top: -30, right: -30, width: 100, height: 100,
                background: `radial-gradient(circle, ${color}0a 0%, transparent 70%)`,
                pointerEvents: 'none',
              }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color }}>{label}</div>
                <div style={{
                  padding: '2px 8px', borderRadius: 12,
                  background: `${color}15`, fontSize: 11, fontWeight: 600, color,
                }}>{data.weight}%</div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 4, letterSpacing: '-0.02em' }}>{fmtP(data.dcfPerShare)}</div>
              <div style={{
                fontSize: 12, fontWeight: 600,
                color: parseFloat(upside) >= 0 ? '#34d399' : '#ef4444',
              }}>
                {parseFloat(upside) >= 0 ? '+' : ''}{upside}% vs CMP
              </div>
              <div style={{
                marginTop: 14, paddingTop: 12, borderTop: `1px solid ${color}20`,
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11,
              }}>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>Discount Rate</div>
                  <div style={{ fontWeight: 600 }}>{data.discountRateUsed}%</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>EBIT Margin</div>
                  <div style={{ fontWeight: 600 }}>{data.ebitMarginUsed}%</div>
                </div>
              </div>
              {data.revenues && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Revenue Trajectory</div>
                  <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 44 }}>
                    {data.revenues.map((r, i) => {
                      const maxR = Math.max(...data.revenues);
                      const h = maxR > 0 ? Math.max((r / maxR) * 40, 4) : 4;
                      return (
                        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                          <div style={{
                            width: '100%', height: h,
                            background: `linear-gradient(180deg, ${color}90, ${color}40)`,
                            borderRadius: 3,
                          }} />
                          <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>Y{i + 1}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Weighted Target Price */}
      <div className="card" style={{
        textAlign: 'center', position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(145deg, var(--bg-card) 0%, rgba(30, 34, 53, 0.95) 100%)',
        border: '1px solid rgba(59, 130, 246, 0.2)',
      }}>
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 200, height: 200,
          background: 'radial-gradient(circle, rgba(59,130,246,0.06) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Probability-Weighted Target Price</div>
          <div style={{ fontSize: 34, fontWeight: 700, color: 'var(--accent)', letterSpacing: '-0.02em' }}>{fmtP(scenarios.weightedTargetPrice)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.6 }}>
            = {scenarios.bear?.weight}% x {fmtP(scenarios.bear?.dcfPerShare)}
            &nbsp;+ {scenarios.base?.weight}% x {fmtP(scenarios.base?.dcfPerShare)}
            &nbsp;+ {scenarios.bull?.weight}% x {fmtP(scenarios.bull?.dcfPerShare)}
          </div>
          {price > 0 && (
            <div style={{
              display: 'inline-block', marginTop: 10, padding: '4px 16px', borderRadius: 20,
              fontSize: 14, fontWeight: 600,
              color: scenarios.weightedTargetPrice > price ? '#34d399' : '#ef4444',
              background: scenarios.weightedTargetPrice > price ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            }}>
              {((scenarios.weightedTargetPrice - price) / price * 100).toFixed(1)}% vs Current Price ({fmtP(price)})
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── DCF Tab (enhanced with FCF Bridge + Dual TV) ────────── */
function DCFTab({ dcf, inputs }) {
  const totalPV = dcf.totalPV || 1;
  const cfPct = ((dcf.totalPVCF / totalPV) * 100).toFixed(0);
  const tvPct = ((dcf.pvTerminal / totalPV) * 100).toFixed(0);

  return (
    <>
      <div className="card">
        <h3 style={{ fontSize: 14, marginBottom: 4 }}>DCF Operating Model: {dcf.model}</h3>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 12 }}>
          {inputs?.forecastYears || 5}-year projected cash flows discounted at {inputs?.discountRate}% with {inputs?.terminalGrowthRate}% terminal growth
        </p>
        <table className="data-table" style={{ fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Year</th>
              <th>Revenue</th>
              <th>Free Cash Flow</th>
              <th>PV of FCF</th>
            </tr>
          </thead>
          <tbody>
            {dcf.revenues.map((r, i) => (
              <tr key={i}>
                <td style={{ textAlign: 'left' }}>Year {i + 1}</td>
                <td>{fmt(r)}</td>
                <td style={{ color: 'var(--accent)' }}>{fmt(dcf.cashFlows[i])}</td>
                <td style={{ color: '#34d399' }}>{fmt(dcf.pvCashFlows[i])}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '1px solid var(--border)', fontWeight: 600 }}>
              <td style={{ textAlign: 'left' }}>Total PV (CFs)</td>
              <td /><td />
              <td style={{ color: '#34d399' }}>{fmt(dcf.totalPVCF)}</td>
            </tr>
            <tr>
              <td style={{ textAlign: 'left' }}>PV (Terminal)</td>
              <td /><td />
              <td style={{ color: '#a78bfa' }}>{fmt(dcf.pvTerminal)}</td>
            </tr>
            <tr style={{ borderTop: '1px solid var(--border)', fontWeight: 700 }}>
              <td style={{ textAlign: 'left' }}>Total Present Value</td>
              <td /><td />
              <td>{fmt(dcf.totalPV)}</td>
            </tr>
            {dcf.model === 'FCFF' && (
              <>
                <tr style={{ color: 'var(--text-secondary)' }}>
                  <td style={{ textAlign: 'left' }}>- Total Debt</td><td /><td />
                  <td style={{ color: '#ef4444' }}>-{fmt(inputs?.totalDebt)}</td>
                </tr>
                <tr style={{ color: 'var(--text-secondary)' }}>
                  <td style={{ textAlign: 'left' }}>+ Cash &amp; Equiv</td><td /><td />
                  <td style={{ color: '#34d399' }}>+{fmt(inputs?.cashAndEquiv)}</td>
                </tr>
              </>
            )}
            <tr style={{ borderTop: '2px solid var(--accent)', fontWeight: 700, color: 'var(--accent)' }}>
              <td style={{ textAlign: 'left' }}>Equity Value</td><td /><td />
              <td>{fmt(dcf.equityValue)}</td>
            </tr>
            <tr style={{ fontWeight: 700, fontSize: 14 }}>
              <td style={{ textAlign: 'left' }}>DCF Value / Share</td><td /><td />
              <td style={{ color: 'var(--accent)' }}>{fmtP(dcf.dcfPerShare)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* FCF Bridge */}
      {dcf.fcfBridge && dcf.fcfBridge.length > 0 && (
        <div className="card">
          <h3 style={{ fontSize: 14, marginBottom: 4 }}>Free Cash Flow Bridge</h3>
          <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Revenue &rarr; EBITDA &rarr; EBIT &rarr; NOPAT &rarr; FCFF waterfall (in M)
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Year</th>
                  <th>Revenue</th>
                  <th>EBITDA</th>
                  <th>EBIT</th>
                  <th>NOPAT</th>
                  <th style={{ color: '#34d399' }}>+ D&amp;A</th>
                  <th style={{ color: '#ef4444' }}>- CapEx</th>
                  <th style={{ color: '#ef4444' }}>- &Delta;WC</th>
                  <th style={{ fontWeight: 700, color: 'var(--accent)' }}>= FCFF</th>
                </tr>
              </thead>
              <tbody>
                {dcf.fcfBridge.map(row => (
                  <tr key={row.year}>
                    <td style={{ textAlign: 'left' }}>Y{row.year}</td>
                    <td>{fmt(row.revenue)}</td>
                    <td>{fmt(row.ebitda)}</td>
                    <td>{fmt(row.ebit)}</td>
                    <td>{fmt(row.nopat)}</td>
                    <td style={{ color: '#34d399' }}>+{fmt(row.da)}</td>
                    <td style={{ color: '#ef4444' }}>-{fmt(row.capex)}</td>
                    <td style={{ color: '#ef4444' }}>-{fmt(row.changeWC)}</td>
                    <td style={{ fontWeight: 700, color: 'var(--accent)' }}>{fmt(row.fcff)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Dual Terminal Value */}
      {dcf.terminalValueGordon != null && (
        <div className="card">
          <h3 style={{ fontSize: 14, marginBottom: 12 }}>Terminal Value (Dual Method)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            {[
              { label: 'Gordon Growth', value: dcf.terminalValueGordon, formula: 'FCF x (1+g) / (r-g)', color: 'var(--accent-blue)' },
              { label: 'Exit Multiple', value: dcf.terminalValueExit, formula: 'EBITDA x Exit EV/EBITDA', color: 'var(--accent-cyan)' },
              { label: 'Blended (Avg)', value: dcf.terminalValueBlended, formula: 'Used in valuation', color: '#a78bfa' },
            ].map(({ label, value, formula, color }) => (
              <div key={label} style={{
                textAlign: 'center', padding: '14px 10px', borderRadius: 10,
                background: `linear-gradient(145deg, rgba(15,23,42,0.4), rgba(15,23,42,0.2))`,
                border: `1px solid ${color}20`,
              }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color }}>{fmt(value)}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>{formula}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TV split */}
      <div className="card">
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>Terminal Value Contribution</h3>
        <div style={{ display: 'flex', height: 22, borderRadius: 12, overflow: 'hidden', background: '#1e293b' }}>
          <div style={{
            width: `${cfPct}%`, background: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#0f172a',
          }}>{cfPct}%</div>
          <div style={{
            width: `${tvPct}%`, background: '#a78bfa',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#0f172a',
          }}>{tvPct}%</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>
          <span>PV of Cash Flows: {fmt(dcf.totalPVCF)}</span>
          <span>PV of Terminal: {fmt(dcf.pvTerminal)}</span>
        </div>
      </div>
    </>
  );
}

/* ── Sensitivity Tab (NEW) ───────────────────────────────── */
function SensitivityTab({ sensitivity, price, inputs }) {
  if (!sensitivity) return <div className="card"><p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Sensitivity data not available.</p></div>;

  const baseWacc = inputs?.discountRate || 12;
  const baseTg = inputs?.terminalGrowthRate || 4;

  return (
    <div className="card" style={{
      background: 'linear-gradient(145deg, var(--bg-card) 0%, rgba(30, 34, 53, 0.95) 100%)',
    }}>
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Sensitivity Analysis: WACC vs Terminal Growth</h3>
      <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
        Intrinsic value per share at varying WACC and terminal growth rates.
      </p>
      <div style={{ display: 'flex', gap: 16, fontSize: 11, marginBottom: 14 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(34,197,94,0.3)' }} /> Undervalued vs {fmtP(price)}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(239,68,68,0.3)' }} /> Overvalued
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, border: '2px solid var(--accent-blue)' }} /> Base case
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 2, fontSize: 11 }}>
          <thead>
            <tr>
              <th style={{
                textAlign: 'left', fontSize: 10, padding: '8px 10px', borderRadius: 6,
                background: 'rgba(15,23,42,0.5)', color: 'var(--text-muted)', fontWeight: 600,
                letterSpacing: '0.04em',
              }}>WACC \ TG</th>
              {sensitivity.tgRange.map(tg => {
                const isBaseTg = Math.abs(tg - baseTg) < 0.01;
                return (
                  <th key={tg} style={{
                    padding: '8px 6px', borderRadius: 6, fontWeight: 600, fontSize: 10,
                    background: isBaseTg ? 'rgba(59,130,246,0.12)' : 'rgba(15,23,42,0.5)',
                    color: isBaseTg ? 'var(--accent-blue)' : 'var(--text-muted)',
                    textAlign: 'center',
                  }}>{tg}%</th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sensitivity.matrix.map(row => {
              const isBaseWacc = Math.abs(row.wacc - baseWacc) < 0.5;
              return (
                <tr key={row.wacc}>
                  <td style={{
                    textAlign: 'left', fontWeight: 600, padding: '6px 10px', borderRadius: 6,
                    background: isBaseWacc ? 'rgba(59,130,246,0.12)' : 'rgba(15,23,42,0.3)',
                    color: isBaseWacc ? 'var(--accent-blue)' : 'var(--text-secondary)',
                  }}>{row.wacc}%</td>
                  {row.values.map((val, i) => {
                    const tg = sensitivity.tgRange[i];
                    const isBase = isBaseWacc && Math.abs(tg - baseTg) < 0.3;
                    if (val == null) {
                      return <td key={i} style={{ padding: '6px', color: '#475569', textAlign: 'center', borderRadius: 4 }}>--</td>;
                    }
                    const diff = price > 0 ? (val - price) / price : 0;
                    let bg;
                    if (diff > 0.5) bg = 'rgba(22,101,52,0.35)';
                    else if (diff > 0.2) bg = 'rgba(21,128,61,0.25)';
                    else if (diff > 0) bg = 'rgba(34,197,94,0.12)';
                    else if (diff > -0.2) bg = 'rgba(239,68,68,0.12)';
                    else bg = 'rgba(220,38,38,0.25)';

                    return (
                      <td key={i} style={{
                        padding: '6px 4px', textAlign: 'center', background: bg,
                        fontWeight: isBase ? 700 : 400, borderRadius: 4,
                        outline: isBase ? '2px solid var(--accent-blue)' : 'none',
                        outlineOffset: -1,
                        color: isBase ? '#fff' : 'var(--text-primary)',
                        fontSize: isBase ? 12 : 11,
                      }}>
                        {fmtP(val)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Relative Tab ────────────────────────────────────────── */
function RelativeTab({ relative, price }) {
  return (
    <div className="card">
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Relative Valuation Method</h3>
      <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 12 }}>
        Target multiples estimated at 85% of current (conservative). Average implied price = Relative Value.
      </p>
      {relative.multiples.map(m => {
        const diff = parseFloat(pctStr(m.implied, price));
        return (
          <div key={m.name} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{m.name}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: diff > 0 ? '#34d399' : '#ef4444' }}>{fmtP(m.implied)}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
              <span>Current: {m.current?.toFixed(1)}x</span>
              <span>&rarr;</span>
              <span style={{ color: 'var(--accent)' }}>Target: {m.target?.toFixed(1)}x</span>
              <span style={{ marginLeft: 'auto' }}>{diff > 0 ? '+' : ''}{diff}% vs price</span>
            </div>
            <div style={{ marginTop: 4, height: 5, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 3,
                background: diff > 0 ? '#34d399' : '#ef4444',
                width: `${Math.min(Math.abs(diff), 100)}%`,
              }} />
            </div>
          </div>
        );
      })}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '2px solid #a78bfa40', display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Average Relative Value</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#a78bfa' }}>{fmtP(relative.relativeValue)}</span>
      </div>
    </div>
  );
}

/* ── Inputs Tab (enhanced with WACC + Scenario params) ──── */
function InputsTab({ inputs, upd, handleRecalculate, recalculating }) {
  if (!inputs) return null;
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {/* Column 1: Company Basics */}
        <div className="card">
          <h4 style={{ fontSize: 13, color: 'var(--accent)', marginBottom: 8 }}>Company Basics</h4>
          <InputRow label="Current Price" value={inputs.currentPrice} onChange={v => upd('currentPrice', v)} />
          <InputRow label="Shares (M)" value={inputs.sharesOutstanding} onChange={v => upd('sharesOutstanding', v)} />
          <InputRow label="TTM Revenue (M)" value={inputs.ttmRevenue} onChange={v => upd('ttmRevenue', v)} />
          <InputRow label="Total Debt (M)" value={inputs.totalDebt} onChange={v => upd('totalDebt', v)} />
          <InputRow label="Cash (M)" value={inputs.cashAndEquiv} onChange={v => upd('cashAndEquiv', v)} />
          <InputRow label="D&A (M)" value={inputs.depreciation} onChange={v => upd('depreciation', v)} />
          <InputRow label="CapEx (M)" value={inputs.capex} onChange={v => upd('capex', v)} />
          <InputRow label="delta WC (M)" value={inputs.changeInWC} onChange={v => upd('changeInWC', v)} />
          <InputRow label="Int. Expense (M)" value={inputs.interestExpense} onChange={v => upd('interestExpense', v)} />
        </div>

        {/* Column 2: WACC + DCF */}
        <div className="card">
          <h4 style={{ fontSize: 13, color: 'var(--accent)', marginBottom: 8 }}>WACC Components</h4>
          <InputRow label="Risk-Free %" value={inputs.riskFreeRate} onChange={v => upd('riskFreeRate', v)} />
          <InputRow label="ERP %" value={inputs.equityRiskPremium} onChange={v => upd('equityRiskPremium', v)} />
          <InputRow label="Beta" value={inputs.beta} onChange={v => upd('beta', v)} />
          <InputRow label="Ke %" value={inputs.costOfEquity} onChange={v => upd('costOfEquity', v)} />
          <InputRow label="Kd %" value={inputs.costOfDebt} onChange={v => upd('costOfDebt', v)} />
          <InputRow label="Equity Wt %" value={inputs.equityWeight} onChange={v => upd('equityWeight', v)} />
          <InputRow label="Debt Wt %" value={inputs.debtWeight} onChange={v => upd('debtWeight', v)} />

          <h4 style={{ fontSize: 13, color: 'var(--accent)', marginBottom: 8, marginTop: 12 }}>DCF Parameters</h4>
          <InputRow label="WACC/DR %" value={inputs.discountRate} onChange={v => upd('discountRate', v)} />
          <InputRow label="Terminal G %" value={inputs.terminalGrowthRate} onChange={v => upd('terminalGrowthRate', v)} />
          <InputRow label="EBIT Margin %" value={inputs.ebitMargin} onChange={v => upd('ebitMargin', v)} />
          <InputRow label="Net Margin %" value={inputs.netIncomeMargin} onChange={v => upd('netIncomeMargin', v)} />
          <InputRow label="FCF Margin %" value={inputs.fcfMargin} onChange={v => upd('fcfMargin', v)} />
          <InputRow label="Tax Rate %" value={inputs.taxRate} onChange={v => upd('taxRate', v)} />
          <InputRow label="Exit EV/EBITDA" value={inputs.exitEvEbitda} onChange={v => upd('exitEvEbitda', v)} />

          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8, marginBottom: 4 }}>Revenue Growth by Year (%)</div>
          {[1, 2, 3, 4, 5].map(i => (
            <InputRow key={i} label={`Y${i}`} value={inputs[`revenueGrowthY${i}`]} onChange={v => upd(`revenueGrowthY${i}`, v)} />
          ))}
        </div>

        {/* Column 3: Scenarios + Multiples */}
        <div className="card">
          <h4 style={{ fontSize: 13, color: '#34d399', marginBottom: 8 }}>Scenario Adjustments</h4>
          <InputRow label="Bull Growth x" value={inputs.bullGrowthMult} onChange={v => upd('bullGrowthMult', v)} />
          <InputRow label="Bear Growth x" value={inputs.bearGrowthMult} onChange={v => upd('bearGrowthMult', v)} />
          <InputRow label="Bull Margin %" value={inputs.bullMarginAdj} onChange={v => upd('bullMarginAdj', v)} />
          <InputRow label="Bear Margin %" value={inputs.bearMarginAdj} onChange={v => upd('bearMarginAdj', v)} />
          <InputRow label="Bull DR Adj %" value={inputs.bullDiscountAdj} onChange={v => upd('bullDiscountAdj', v)} />
          <InputRow label="Bear DR Adj %" value={inputs.bearDiscountAdj} onChange={v => upd('bearDiscountAdj', v)} />

          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8, marginBottom: 4 }}>Scenario Weights (%)</div>
          <InputRow label="Bull Wt" value={inputs.scenarioWeightBull} onChange={v => upd('scenarioWeightBull', v)} />
          <InputRow label="Base Wt" value={inputs.scenarioWeightBase} onChange={v => upd('scenarioWeightBase', v)} />
          <InputRow label="Bear Wt" value={inputs.scenarioWeightBear} onChange={v => upd('scenarioWeightBear', v)} />

          <h4 style={{ fontSize: 13, color: '#a78bfa', marginBottom: 8, marginTop: 12 }}>Relative Multiples</h4>
          <p style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 8 }}>Target = estimated fair multiple</p>
          {[
            ['PE', 'P/E'], ['EVEBITDA', 'EV/EBITDA'], ['EVEBIT', 'EV/EBIT'],
            ['EVSales', 'EV/Sales'], ['PFCFE', 'P/FCFE'],
          ].map(([k, label]) => (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 4 }}>
              <InputRow label={`${label} C`} value={inputs[`current${k}`]} onChange={v => upd(`current${k}`, v)} />
              <InputRow label={`${label} T`} value={inputs[`target${k}`]} onChange={v => upd(`target${k}`, v)} />
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
        <button className="scan-btn" onClick={handleRecalculate} disabled={recalculating} style={{ minWidth: 200 }}>
          {recalculating ? 'Recalculating...' : 'Recalculate with Custom Inputs'}
        </button>
      </div>
    </>
  );
}

/* ── Micro components ────────────────────────────────────── */

function WaccRow({ children }) { return <>{children}</>; }

function ValBar({ label, value, max, color, bold }) {
  const pct = max > 0 ? Math.min(Math.max((value / max) * 100, 2), 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{
        fontSize: 11, width: 85, textAlign: 'right',
        color, fontWeight: bold ? 700 : 500,
        letterSpacing: '0.01em',
      }}>{label}</span>
      <div style={{
        flex: 1, height: bold ? 12 : 8, background: 'rgba(30, 41, 59, 0.8)',
        borderRadius: 6, overflow: 'hidden', position: 'relative',
      }}>
        <div style={{
          height: '100%', borderRadius: 6, width: `${pct}%`,
          background: `linear-gradient(90deg, ${color}, ${color}cc)`,
          boxShadow: bold ? `0 0 12px ${color}40` : 'none',
          transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
        }} />
      </div>
      <span style={{
        fontSize: bold ? 13 : 11, width: 90, textAlign: 'right',
        fontWeight: bold ? 700 : 500,
        fontVariantNumeric: 'tabular-nums',
      }}>{fmtP(value)}</span>
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="card" style={{
      padding: '14px 16px',
      background: 'linear-gradient(145deg, var(--bg-card) 0%, rgba(30, 34, 53, 0.9) 100%)',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function InputRow({ label, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
      <label style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 85, fontWeight: 500 }}>{label}</label>
      <input
        type="number"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        step="any"
        style={{
          flex: 1, padding: '5px 8px', fontSize: 12,
          background: 'rgba(15, 23, 42, 0.6)', border: '1px solid var(--border)', borderRadius: 6,
          color: 'var(--text-primary)', outline: 'none', minWidth: 0,
          transition: 'border-color 0.2s, box-shadow 0.2s',
          fontVariantNumeric: 'tabular-nums',
        }}
        onFocus={e => { e.target.style.borderColor = '#3b82f6'; e.target.style.boxShadow = '0 0 0 2px rgba(59,130,246,0.15)'; }}
        onBlur={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none'; }}
      />
    </div>
  );
}
