import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import ScreenshotButton from './ScreenshotButton';

// ── helpers ────────────────────────────────────────────────────────────────

function fmt(n, dec = 1) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(dec);
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  const v = Number(n);
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function fmtPrice(n) {
  if (n == null || isNaN(n)) return '—';
  return `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 })}`;
}

// ── Regime badge ───────────────────────────────────────────────────────────

const REGIME_META = {
  STRONG_BULL: { label: 'Strong Bull', color: '#00c853', bg: 'rgba(0,200,83,0.15)', icon: '↑↑' },
  BULL:        { label: 'Bull',        color: '#69f0ae', bg: 'rgba(105,240,174,0.13)', icon: '↑' },
  NEUTRAL:     { label: 'Neutral',     color: '#ffd740', bg: 'rgba(255,215,64,0.13)',  icon: '→' },
  BEAR:        { label: 'Bear',        color: '#ff6d00', bg: 'rgba(255,109,0,0.15)',   icon: '↓' },
  STRONG_BEAR: { label: 'Strong Bear', color: '#d50000', bg: 'rgba(213,0,0,0.18)',     icon: '↓↓' },
};

function RegimeBadge({ regime }) {
  const meta = REGIME_META[regime] || REGIME_META.NEUTRAL;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: meta.bg, color: meta.color,
      border: `1px solid ${meta.color}44`,
      borderRadius: 6, padding: '3px 10px', fontWeight: 700, fontSize: 13,
    }}>
      {meta.icon} {meta.label}
    </span>
  );
}

// ── Fear-O-Meter (arc gauge) ───────────────────────────────────────────────

function FearGauge({ score }) {
  // score: -100 (extreme fear) → +100 (extreme greed)
  const pct    = (score + 100) / 200;          // 0..1
  const angle  = pct * 180 - 90;               // -90°(fear) → +90°(greed)
  const cx = 100, cy = 100, r = 75;

  // Arc color gradient from red → yellow → green
  const arcColor = score < -40 ? '#d50000'
    : score < -10 ? '#ff6d00'
    : score <  20 ? '#ffd740'
    : score <  50 ? '#69f0ae'
    : '#00c853';

  const label = score <= -55 ? 'EXTREME FEAR'
    : score <= -20 ? 'FEAR'
    : score <=  20 ? 'NEUTRAL'
    : score <=  55 ? 'GREED'
    : 'EXTREME GREED';

  const labelColor = arcColor;

  // needle
  const rad = (angle * Math.PI) / 180;
  const nx = cx + r * Math.cos(rad);
  const ny = cy + r * Math.sin(rad);

  return (
    <div style={{ textAlign: 'center' }}>
      <svg width="200" height="120" viewBox="0 0 200 120">
        {/* Background arc */}
        <path d="M 25 100 A 75 75 0 0 1 175 100" fill="none" stroke="#333" strokeWidth="14" strokeLinecap="round" />
        {/* Fear zone (red) */}
        <path d="M 25 100 A 75 75 0 0 1 68 36" fill="none" stroke="#d50000" strokeWidth="14" strokeLinecap="round" opacity="0.4" />
        {/* Neutral zone (yellow) */}
        <path d="M 68 36 A 75 75 0 0 1 132 36" fill="none" stroke="#ffd740" strokeWidth="14" strokeLinecap="round" opacity="0.4" />
        {/* Greed zone (green) */}
        <path d="M 132 36 A 75 75 0 0 1 175 100" fill="none" stroke="#00c853" strokeWidth="14" strokeLinecap="round" opacity="0.4" />
        {/* Needle */}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={arcColor} strokeWidth="3" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="6" fill={arcColor} />
        {/* Score text */}
        <text x={cx} y={cy + 22} textAnchor="middle" fill="#fff" fontSize="20" fontWeight="700">{score}</text>
      </svg>
      <div style={{ color: labelColor, fontWeight: 700, fontSize: 13, marginTop: -4 }}>{label}</div>
    </div>
  );
}

// ── Metric card ────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: '#1a1a2e', borderRadius: 10, padding: '12px 16px',
      border: '1px solid #2a2a4a', minWidth: 130, flex: 1,
    }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || '#e0e0e0' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#666', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ── RSI badge ─────────────────────────────────────────────────────────────

function RsiBadge({ rsi }) {
  if (rsi == null) return <span style={{ color: '#666' }}>—</span>;
  const color = rsi < 30 ? '#d50000' : rsi < 40 ? '#ff6d00' : rsi < 50 ? '#ffd740' : '#888';
  const label = rsi < 30 ? 'Oversold' : rsi < 40 ? 'Weak' : rsi < 50 ? 'Soft' : 'Neutral';
  return (
    <span style={{ color, fontWeight: 600, fontSize: 12 }}>
      {fmt(rsi, 0)} <span style={{ fontSize: 10, opacity: 0.75 }}>({label})</span>
    </span>
  );
}

// ── Score bar ─────────────────────────────────────────────────────────────

function ScoreBar({ value, max = 100 }) {
  if (value == null) return <span style={{ color: '#666' }}>—</span>;
  const pct = Math.min(100, (value / max) * 100);
  const color = value >= 75 ? '#00c853' : value >= 55 ? '#69f0ae' : value >= 40 ? '#ffd740' : '#ff6d00';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 6, background: '#333', borderRadius: 3, overflow: 'hidden', minWidth: 50 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ color, fontSize: 12, fontWeight: 600, minWidth: 28 }}>{fmt(value, 0)}</span>
    </div>
  );
}

// ── Signal badge ───────────────────────────────────────────────────────────

function SignalBadge({ signal }) {
  const colors = { BUY: '#00c853', SELL: '#d50000', HOLD: '#ffd740', 'N/A': '#555' };
  return (
    <span style={{
      background: `${colors[signal] || '#555'}22`,
      color: colors[signal] || '#aaa',
      border: `1px solid ${colors[signal] || '#555'}55`,
      borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 700,
    }}>{signal || 'HOLD'}</span>
  );
}

// ── Sector pill list ───────────────────────────────────────────────────────

function SectorPills({ sectors, color, label }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {sectors.map(s => (
          <span key={s} style={{
            background: `${color}1a`, color, border: `1px solid ${color}44`,
            borderRadius: 20, padding: '3px 10px', fontSize: 12,
          }}>{s}</span>
        ))}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function MarketDipView({ onSelectStock }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [minFund, setMinFund] = useState(50);
  const [maxRsi, setMaxRsi]   = useState(50);
  const [sectorFilter, setSectorFilter] = useState('ALL');
  const [sortKey, setSortKey] = useState('dip_score');
  const [sortDir, setSortDir] = useState(-1);         // -1 = desc
  const containerRef = useRef(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api.getDipOpportunities({ min_fund: minFund, max_rsi: maxRsi })
      .then(d => setData(d))
      .catch(e => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const mc       = data?.market_condition || {};
  const regime   = mc.regime || 'NEUTRAL';
  const regimeMeta = REGIME_META[regime] || REGIME_META.NEUTRAL;
  const stats    = data?.stats || {};
  const sectorBias = mc.sector_bias || {};

  // Build sector list for filter
  const sectorDist = data?.sector_distribution || {};
  const sectors    = ['ALL', ...Object.keys(sectorDist).sort()];

  // Filter + sort opportunities
  const rows = (data?.opportunities || [])
    .filter(o => sectorFilter === 'ALL' || o.sector === sectorFilter)
    .sort((a, b) => {
      const va = a[sortKey] ?? 0;
      const vb = b[sortKey] ?? 0;
      return typeof va === 'string'
        ? va.localeCompare(vb) * sortDir
        : (va - vb) * sortDir;
    });

  const thStyle = {
    padding: '8px 10px', textAlign: 'left', fontSize: 11,
    color: '#888', fontWeight: 600, borderBottom: '1px solid #2a2a4a',
    whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
  };
  const tdStyle = { padding: '8px 10px', fontSize: 12, borderBottom: '1px solid #1e1e3a', whiteSpace: 'nowrap' };

  const handleSort = key => {
    if (sortKey === key) setSortDir(d => -d);
    else { setSortKey(key); setSortDir(-1); }
  };

  const th = (key, label) => (
    <th style={thStyle} onClick={() => handleSort(key)}>
      {label}{sortKey === key ? (sortDir === -1 ? ' ↓' : ' ↑') : ''}
    </th>
  );

  return (
    <div ref={containerRef} style={{ padding: '20px 24px', color: '#e0e0e0', maxWidth: 1400 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
            Market Dip Opportunity Scanner
          </h2>
          <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
            Quality stocks on sale — oversold, undervalued, waiting for reversal
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {data?.generated_at && (
            <span style={{ fontSize: 11, color: '#555' }}>
              {new Date(data.generated_at).toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            style={{
              padding: '6px 14px', borderRadius: 6, border: '1px solid #444',
              background: '#1e1e3e', color: '#ccc', cursor: 'pointer', fontSize: 12,
            }}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <ScreenshotButton containerRef={containerRef} filename="market-dip" />
        </div>
      </div>

      {error && (
        <div style={{ background: '#2a0a0a', border: '1px solid #d50000', borderRadius: 8, padding: 16, marginBottom: 20, color: '#ff6b6b' }}>
          {error}
        </div>
      )}

      {loading && !data && (
        <div style={{ textAlign: 'center', padding: 60, color: '#666' }}>
          Analysing market conditions and scoring opportunities…
        </div>
      )}

      {data && (
        <>
          {/* ── Market Regime Banner ── */}
          <div style={{
            background: regimeMeta.bg, border: `1px solid ${regimeMeta.color}33`,
            borderRadius: 12, padding: '16px 20px', marginBottom: 20,
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20,
          }}>
            <div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Market Regime</div>
              <RegimeBadge regime={regime} />
            </div>
            {mc.nifty_price && (
              <div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Nifty 50</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>
                  {fmtPrice(mc.nifty_price)}
                  {mc.nifty_change_pct != null && (
                    <span style={{ fontSize: 13, marginLeft: 8, color: mc.nifty_change_pct >= 0 ? '#00c853' : '#d50000' }}>
                      {fmtPct(mc.nifty_change_pct)}
                    </span>
                  )}
                </div>
              </div>
            )}
            <div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Trend</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: mc.trend_direction === 'DOWNTREND' ? '#ff6d00' : mc.trend_direction === 'UPTREND' ? '#00c853' : '#ffd740' }}>
                {mc.trend_direction || '—'}
              </div>
            </div>
            <div style={{ marginLeft: 'auto', fontSize: 12, color: '#888', maxWidth: 320, fontStyle: 'italic' }}>
              {sectorBias.note || ''}
            </div>
          </div>

          {/* ── Market Health + Fear Gauge row ── */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>

            {/* Fear Gauge */}
            <div style={{ background: '#1a1a2e', borderRadius: 12, padding: '16px', border: '1px solid #2a2a4a', minWidth: 200 }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 8, fontWeight: 600 }}>Market Sentiment</div>
              <FearGauge score={mc.regime_score ?? 0} />
            </div>

            {/* Metric cards */}
            <div style={{ display: 'flex', gap: 10, flex: 1, flexWrap: 'wrap' }}>
              <MetricCard
                label="vs 50 DMA"
                value={mc.nifty_vs_50dma_pct != null ? `${mc.nifty_vs_50dma_pct > 0 ? '+' : ''}${mc.nifty_vs_50dma_pct?.toFixed(1)}%` : '—'}
                sub={mc.dma50 ? `50DMA: ${fmtPrice(mc.dma50)}` : ''}
                color={mc.nifty_vs_50dma_pct >= 0 ? '#69f0ae' : '#ff6d00'}
              />
              <MetricCard
                label="vs 200 DMA"
                value={mc.nifty_vs_200dma_pct != null ? `${mc.nifty_vs_200dma_pct > 0 ? '+' : ''}${mc.nifty_vs_200dma_pct?.toFixed(1)}%` : '—'}
                sub={mc.dma200 ? `200DMA: ${fmtPrice(mc.dma200)}` : ''}
                color={mc.nifty_vs_200dma_pct >= 0 ? '#69f0ae' : '#ff6d00'}
              />
              <MetricCard
                label="20D Momentum"
                value={mc.roc_20d_pct != null ? `${mc.roc_20d_pct > 0 ? '+' : ''}${mc.roc_20d_pct?.toFixed(1)}%` : '—'}
                sub="20-day rate of change"
                color={mc.roc_20d_pct >= 0 ? '#69f0ae' : '#ff6d00'}
              />
              <MetricCard
                label="India VIX"
                value={mc.vix != null ? mc.vix.toFixed(1) : '—'}
                sub={mc.vix != null ? (mc.vix < 16 ? 'Low fear' : mc.vix < 20 ? 'Moderate' : mc.vix < 25 ? 'Elevated' : 'High fear') : ''}
                color={mc.vix == null ? '#888' : mc.vix < 16 ? '#00c853' : mc.vix < 20 ? '#ffd740' : '#ff6d00'}
              />
              <MetricCard
                label="Equity Allocation"
                value={`${mc.equity_allocation_min ?? '—'}–${mc.equity_allocation_max ?? '—'}%`}
                sub="Recommended range"
                color="#69f0ae"
              />
              <MetricCard
                label="Dip Picks Found"
                value={stats.total ?? 0}
                sub={`${stats.buy_signals ?? 0} BUY · ${stats.oversold_count ?? 0} oversold`}
                color="#ffd740"
              />
            </div>
          </div>

          {/* ── Sector Rotation Guide ── */}
          {(sectorBias.favour?.length || sectorBias.avoid?.length) && (
            <div style={{
              background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 12,
              padding: '16px 20px', marginBottom: 20,
            }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 14, color: '#ccc' }}>
                Sector Rotation — {regimeMeta.label} Playbook
              </div>
              <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
                {sectorBias.favour?.length > 0 && (
                  <SectorPills sectors={sectorBias.favour} color="#00c853" label="Favour (rotate into)" />
                )}
                {sectorBias.avoid?.length > 0 && (
                  <SectorPills sectors={sectorBias.avoid} color="#d50000" label="Avoid / Reduce" />
                )}
              </div>
            </div>
          )}

          {/* ── Filters ── */}
          <div style={{
            background: '#1a1a2e', borderRadius: 10, padding: '12px 16px',
            marginBottom: 16, display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 12, color: '#888' }}>Min Fund Score:</label>
              <input
                type="range" min="40" max="80" step="5" value={minFund}
                onChange={e => setMinFund(Number(e.target.value))}
                style={{ width: 100 }}
              />
              <span style={{ fontSize: 12, color: '#ffd740', minWidth: 24 }}>{minFund}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 12, color: '#888' }}>Max RSI:</label>
              <input
                type="range" min="30" max="65" step="5" value={maxRsi}
                onChange={e => setMaxRsi(Number(e.target.value))}
                style={{ width: 100 }}
              />
              <span style={{ fontSize: 12, color: '#ffd740', minWidth: 24 }}>{maxRsi}</span>
            </div>
            <button
              onClick={load} disabled={loading}
              style={{
                padding: '5px 12px', borderRadius: 6, background: '#2a2a5a',
                border: '1px solid #444', color: '#ccc', cursor: 'pointer', fontSize: 12,
              }}
            >
              Apply
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
              <label style={{ fontSize: 12, color: '#888' }}>Sector:</label>
              <select
                value={sectorFilter}
                onChange={e => setSectorFilter(e.target.value)}
                style={{
                  background: '#12122a', border: '1px solid #333', color: '#ccc',
                  borderRadius: 6, padding: '4px 8px', fontSize: 12,
                }}
              >
                {sectors.map(s => (
                  <option key={s} value={s}>
                    {s === 'ALL' ? 'All Sectors' : `${s} (${sectorDist[s] ?? 0})`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* ── Opportunity Table ── */}
          <div style={{
            background: '#1a1a2e', borderRadius: 12, border: '1px solid #2a2a4a',
            overflow: 'auto',
          }}>
            <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #2a2a4a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>
                Quality Stocks on Dip
                <span style={{ marginLeft: 8, fontSize: 12, color: '#666', fontWeight: 400 }}>
                  ({rows.length} stocks)
                </span>
              </span>
              <span style={{ fontSize: 11, color: '#555' }}>
                Dip Score = 65% Fundamental + 35% Oversold Signal
              </span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {th('symbol',            'Stock')}
                  {th('sector',            'Sector')}
                  {th('l_category',        'Cat')}
                  {th('cmp',               'CMP')}
                  {th('change_pct',        'Day %')}
                  {th('fundamental_score', 'Fund Score')}
                  {th('technical_score',   'Tech Score')}
                  {th('rsi_value',         'RSI')}
                  {th('signal',            'Signal')}
                  {th('entry_zone',        'Entry Zone')}
                  {th('stop_loss',         'Stop Loss')}
                  {th('target',            'Target')}
                  {th('dip_score',         'Dip Score')}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={13} style={{ ...tdStyle, textAlign: 'center', color: '#555', padding: 32 }}>
                      No opportunities match the current filters. Try relaxing Min Fund Score or Max RSI.
                    </td>
                  </tr>
                ) : rows.map((row, i) => {
                  const isOversold = (row.rsi_value ?? 99) < 35;
                  const isBuy      = row.signal === 'BUY';
                  return (
                    <tr
                      key={row.symbol}
                      style={{
                        background: i % 2 === 0 ? 'transparent' : '#ffffff05',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#ffffff0d'}
                      onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : '#ffffff05'}
                    >
                      <td style={tdStyle}>
                        <span
                          onClick={() => onSelectStock?.(row.symbol)}
                          style={{ color: '#7eb6ff', fontWeight: 700, cursor: onSelectStock ? 'pointer' : 'default', fontSize: 13 }}
                        >
                          {row.symbol?.replace('.NS', '')}
                        </span>
                        {isOversold && (
                          <span style={{ marginLeft: 5, fontSize: 9, background: '#d5000022', color: '#ff6b6b', border: '1px solid #d5000044', borderRadius: 3, padding: '1px 4px' }}>
                            OVERSOLD
                          </span>
                        )}
                        {isBuy && !isOversold && (
                          <span style={{ marginLeft: 5, fontSize: 9, background: '#00c85322', color: '#00c853', border: '1px solid #00c85344', borderRadius: 3, padding: '1px 4px' }}>
                            BUY
                          </span>
                        )}
                        <div style={{ fontSize: 10, color: '#666', marginTop: 1 }}>{row.name?.split(' ').slice(0, 3).join(' ')}</div>
                      </td>
                      <td style={{ ...tdStyle, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', color: '#bbb' }}>
                        {row.sector || '—'}
                      </td>
                      <td style={{ ...tdStyle, color: '#888' }}>
                        {row.l_category || '—'}
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>
                        {fmtPrice(row.cmp)}
                      </td>
                      <td style={{ ...tdStyle, color: row.change_pct >= 0 ? '#69f0ae' : '#ff6b6b' }}>
                        {row.change_pct != null ? fmtPct(row.change_pct) : '—'}
                      </td>
                      <td style={{ ...tdStyle, minWidth: 110 }}>
                        <ScoreBar value={row.fundamental_score} />
                      </td>
                      <td style={{ ...tdStyle, minWidth: 110 }}>
                        <ScoreBar value={row.technical_score} />
                      </td>
                      <td style={tdStyle}>
                        <RsiBadge rsi={row.rsi_value} />
                      </td>
                      <td style={tdStyle}>
                        <SignalBadge signal={row.signal} />
                      </td>
                      <td style={{ ...tdStyle, color: '#69f0ae', fontSize: 11 }}>
                        {row.entry_zone || '—'}
                      </td>
                      <td style={{ ...tdStyle, color: '#ff6b6b', fontSize: 11 }}>
                        {row.stop_loss || '—'}
                      </td>
                      <td style={{ ...tdStyle, color: '#ffd740', fontSize: 11 }}>
                        {row.target || '—'}
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 700, color: '#7eb6ff' }}>
                        {fmt(row.dip_score, 1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Bull Thesis peek ── */}
          {rows.some(r => r.bull_thesis) && (
            <div style={{ marginTop: 20, background: '#1a1a2e', borderRadius: 12, border: '1px solid #2a2a4a', padding: '14px 16px' }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: '#ccc' }}>
                Bull Thesis — Top Picks
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
                {rows.filter(r => r.bull_thesis).slice(0, 6).map(r => (
                  <div key={r.symbol} style={{
                    background: '#12122a', borderRadius: 8, padding: '10px 12px',
                    border: '1px solid #2a2a4a',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span
                        style={{ color: '#7eb6ff', fontWeight: 700, cursor: onSelectStock ? 'pointer' : 'default' }}
                        onClick={() => onSelectStock?.(r.symbol)}
                      >
                        {r.symbol?.replace('.NS', '')}
                      </span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <SignalBadge signal={r.signal} />
                        <span style={{ fontSize: 11, color: '#666' }}>RSI {fmt(r.rsi_value, 0)}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: '#999', lineHeight: 1.5 }}>{r.bull_thesis}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Footer note ── */}
          <div style={{ marginTop: 16, fontSize: 11, color: '#444', textAlign: 'center' }}>
            Dip Score ranks quality stocks experiencing technical weakness. Not investment advice. Verify with your own analysis.
          </div>
        </>
      )}
    </div>
  );
}
