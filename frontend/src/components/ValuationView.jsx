import { useState } from 'react';
import { api } from '../api';

const VERDICT_CFG = {
  'UNDERVALUED':              { color: '#22c55e', bg: 'rgba(34,197,94,0.15)',   icon: '▼₹' },
  'FAIRLY VALUED':            { color: '#eab308', bg: 'rgba(234,179,8,0.12)',   icon: '≈' },
  'SLIGHTLY OVERVALUED':      { color: '#f97316', bg: 'rgba(249,115,22,0.12)',  icon: '▲' },
  'OVERVALUED':               { color: '#ef4444', bg: 'rgba(239,68,68,0.15)',   icon: '▲▲' },
  'SIGNIFICANTLY OVERVALUED': { color: '#ef4444', bg: 'rgba(239,68,68,0.20)',   icon: '▲▲▲' },
};

const STATUS_COLOR = {
  'UNDERVALUED': '#22c55e',
  'FAIR': '#eab308',
  'FAIRLY VALUED': '#eab308',
  'SLIGHTLY OVERVALUED': '#f97316',
  'OVERVALUED': '#ef4444',
  'CHEAP': '#22c55e',
  'EXPENSIVE': '#f97316',
  'VERY EXPENSIVE': '#ef4444',
  'DEEP VALUE': '#22c55e',
  'FAIR VALUE': '#eab308',
  'SLIGHTLY EXPENSIVE': '#f97316',
  'SPECULATIVE': '#ef4444',
  'N/A': '#64748b',
};

function VerdictBadge({ verdict }) {
  const cfg = VERDICT_CFG[verdict] || { color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', icon: '?' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '5px 14px', borderRadius: 20, fontWeight: 700, fontSize: 13,
      background: cfg.bg, color: cfg.color,
    }}>
      {cfg.icon} {verdict}
    </span>
  );
}

function MosBadge({ mos }) {
  if (mos == null) return <span style={{ color: '#64748b' }}>—</span>;
  const color = mos >= 20 ? '#22c55e' : mos >= 5 ? '#4ade80' : mos >= -15 ? '#eab308' : mos >= -30 ? '#f97316' : '#ef4444';
  return (
    <span style={{ fontWeight: 700, color, fontSize: 15 }}>
      {mos > 0 ? '+' : ''}{mos}%
    </span>
  );
}

function MetricRow({ label, value, status, benchmark }) {
  const color = STATUS_COLOR[status] || '#94a3b8';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <span style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontWeight: 600, fontSize: 13 }}>{value ?? '—'}</span>
      {benchmark && <span style={{ fontSize: 11, color: '#64748b' }}>vs {benchmark}</span>}
      {status && status !== 'N/A' && (
        <span style={{ fontSize: 11, color, fontWeight: 600, minWidth: 80, textAlign: 'right' }}>{status}</span>
      )}
    </div>
  );
}

function MethodCard({ title, color, children }) {
  return (
    <div style={{
      background: 'var(--bg-secondary)', borderRadius: 12, padding: '16px',
      border: `1px solid ${color}33`, flex: '1 1 280px',
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 12, letterSpacing: 1 }}>{title}</div>
      {children}
    </div>
  );
}

function fmt(v, digits = 1) {
  if (v == null) return '—';
  return typeof v === 'number' ? v.toFixed(digits) : v;
}

function fmtPrice(v) {
  if (v == null) return '—';
  return `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export default function ValuationView() {
  const [symbol, setSymbol] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const analyze = () => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    setLoading(true);
    setError(null);
    setData(null);
    api.getValuation(sym)
      .then(d => setData(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  const ma = data?.method_a || {};
  const mb = data?.method_b || {};
  const mc = data?.method_c || {};

  return (
    <div className="card">
      <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800 }}>⚖ Valuation Level Assessment</h2>
      <p style={{ margin: '0 0 20px', color: 'var(--text-secondary)', fontSize: 13 }}>
        3-method valuation: Relative (P/E, P/B, EV/EBITDA) · DCF Fair Value · Graham Number
      </p>

      {/* Search */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, maxWidth: 500 }}>
        <input
          value={symbol}
          onChange={e => setSymbol(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && analyze()}
          placeholder="Enter NSE symbol (e.g. RELIANCE, TCS)"
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--bg-secondary)',
            color: 'var(--text-primary)', fontSize: 14,
          }}
        />
        <button
          onClick={analyze}
          disabled={loading || !symbol.trim()}
          style={{
            padding: '10px 24px', borderRadius: 8, border: 'none',
            background: 'var(--accent-blue)', color: '#fff',
            fontWeight: 700, cursor: loading ? 'wait' : 'pointer', fontSize: 14,
          }}
        >
          {loading ? 'Analyzing...' : 'Analyze'}
        </button>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '12px 16px', color: '#fca5a5', marginBottom: 20 }}>
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Header summary */}
          <div style={{
            background: 'var(--bg-secondary)', borderRadius: 12, padding: '20px',
            marginBottom: 24, border: '1px solid var(--border)',
            display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center',
          }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{data.name || data.symbol}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{data.sector}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>CMP</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{fmtPrice(data.cmp)}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Fair Value</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#60a5fa' }}>{fmtPrice(data.fair_value)}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Margin of Safety</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>
                <MosBadge mos={data.margin_of_safety_pct} />
              </div>
            </div>
            <div>
              <VerdictBadge verdict={data.verdict} />
            </div>
          </div>

          {/* Entry / exit zones */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
            <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 10, padding: '12px 18px', flex: 1 }}>
              <div style={{ fontSize: 11, color: '#4ade80', fontWeight: 700 }}>ATTRACTIVE ENTRY BELOW</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#22c55e', marginTop: 4 }}>{fmtPrice(data.attractive_price)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>80% of fair value</div>
            </div>
            <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '12px 18px', flex: 1 }}>
              <div style={{ fontSize: 11, color: '#f87171', fontWeight: 700 }}>EXIT ON VALUATION ABOVE</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#ef4444', marginTop: 4 }}>{fmtPrice(data.exit_on_valuation)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>130% of fair value</div>
            </div>
            {data.premium_justified != null && (
              <div style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', borderRadius: 10, padding: '12px 18px', flex: 1 }}>
                <div style={{ fontSize: 11, color: '#eab308', fontWeight: 700 }}>PREMIUM JUSTIFIED?</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: data.premium_justified ? '#22c55e' : '#ef4444', marginTop: 4 }}>
                  {data.premium_justified ? 'YES' : 'NO'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {data.earnings_growth != null ? `Earnings growth: ${data.earnings_growth}%` : ''}
                </div>
              </div>
            )}
          </div>

          {/* 3 method cards */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>

            {/* Method A — Relative */}
            <MethodCard title="METHOD A — RELATIVE VALUATION (40%)" color="#60a5fa">
              <MetricRow
                label="P/E vs Sector"
                value={fmt(data.trailing_pe)}
                status={ma.pe_vs_sector}
                benchmark={`sector ${data.sector_median_pe}`}
              />
              <MetricRow
                label="P/B vs Sector"
                value={fmt(data.price_to_book)}
                status={ma.pb_vs_sector}
                benchmark={`sector ${data.sector_median_pb}`}
              />
              <MetricRow
                label="EV/EBITDA"
                value={fmt(data.ev_to_ebitda)}
                status={ma.ev_ebitda_status}
              />
              <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(96,165,250,0.08)' }}>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>Overall: </span>
                <span style={{ fontWeight: 700, color: STATUS_COLOR[ma.overall] || '#94a3b8' }}>{ma.overall || '—'}</span>
              </div>
              {ma.signals && ma.signals.length > 0 && (
                <ul style={{ margin: '8px 0 0', paddingLeft: 16, fontSize: 11, color: 'var(--text-secondary)' }}>
                  {ma.signals.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              )}
            </MethodCard>

            {/* Method B — DCF */}
            <MethodCard title="METHOD B — DCF / EARNINGS-BASED (40%)" color="#a855f7">
              <MetricRow label="EPS (TTM)" value={fmt(data.eps)} />
              <MetricRow label="Earnings Growth" value={data.earnings_growth != null ? `${data.earnings_growth}%` : null} />
              <MetricRow label="Revenue Growth" value={data.revenue_growth != null ? `${data.revenue_growth}%` : null} />
              {mb.growth_used && <MetricRow label="Growth Used in DCF" value={`${mb.growth_used}%`} />}
              <MetricRow label="DCF Fair Value" value={fmtPrice(mb.fair_value)} />
              {mb.premium_pct != null && (
                <MetricRow
                  label="vs CMP"
                  value={`${mb.premium_pct > 0 ? '+' : ''}${mb.premium_pct}%`}
                  status={mb.premium_pct > 20 ? 'OVERVALUED' : mb.premium_pct < -10 ? 'UNDERVALUED' : 'FAIR'}
                />
              )}
              {mb.note && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#64748b', fontStyle: 'italic' }}>{mb.note}</div>
              )}
            </MethodCard>

            {/* Method C — Graham */}
            <MethodCard title="METHOD C — GRAHAM NUMBER (20%)" color="#22c55e">
              <MetricRow label="EPS (TTM)" value={fmt(data.eps)} />
              <MetricRow label="Book Value/Share" value={fmt(data.book_value_per_share)} />
              <MetricRow label="Graham Number" value={fmtPrice(mc.fair_value)} />
              {mc.premium_pct != null && (
                <MetricRow
                  label="CMP vs Graham"
                  value={`${mc.premium_pct > 0 ? '+' : ''}${mc.premium_pct}%`}
                  status={mc.status}
                />
              )}
              <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(34,197,94,0.08)' }}>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>Status: </span>
                <span style={{ fontWeight: 700, color: STATUS_COLOR[mc.status] || '#94a3b8' }}>{mc.status || '—'}</span>
              </div>
              {mc.note && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#64748b', fontStyle: 'italic' }}>{mc.note}</div>
              )}
            </MethodCard>

          </div>

          {/* Red flags */}
          {(() => {
            const flags = [];
            if (data.trailing_pe > 50 && data.earnings_growth < 30) flags.push('P/E > 50 without 30%+ earnings growth — bubble risk');
            if (data.price_to_book > 10 && data.roe < 25) flags.push('P/B > 10 without ROE > 25% — unjustified premium');
            if (data.ev_to_ebitda > 30) flags.push('EV/EBITDA > 30 — very expensive');
            if (data.revenue_growth < 0 && data.trailing_pe > 30) flags.push('Revenue declining but P/E elevated — multiple expansion trap');
            return flags.length > 0 ? (
              <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, padding: '14px 18px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#f87171', marginBottom: 8 }}>⚠ VALUATION RED FLAGS</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#fca5a5' }}>
                  {flags.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            ) : null;
          })()}
        </>
      )}
    </div>
  );
}
