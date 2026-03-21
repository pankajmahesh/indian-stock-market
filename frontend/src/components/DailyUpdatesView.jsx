import { useState, useEffect, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  ReferenceLine,
} from 'recharts';
import RunPipelineButton from './RunPipelineButton';
import { api } from '../api';
import StockModal from './StockModal';

/* ── Ticker CSS injected once ──────────────────────────────────────── */
const TICKER_STYLE = `
@keyframes tickerScroll {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
`;

/* ── colour helpers ─────────────────────────────────────────────── */
const chgColor  = v => v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : '#94a3b8';
const vixColor  = v => v == null ? '#94a3b8' : v > 25 ? '#ef4444' : v > 18 ? '#f97316' : '#22c55e';
const dmaColor  = v => v == null ? '#94a3b8' : v >= 0 ? '#22c55e' : '#ef4444';
const scoreColor = v => v >= 75 ? '#22c55e' : v >= 60 ? '#eab308' : '#94a3b8';
const fmt        = v => v != null ? Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 }) : '—';

const REGIME_COLOR = {
  STRONG_BULL: '#22c55e', BULL: '#86efac',
  NEUTRAL: '#eab308',
  BEAR: '#f97316', STRONG_BEAR: '#ef4444',
};
const REGIME_BG = {
  STRONG_BULL: 'rgba(34,197,94,0.10)', BULL: 'rgba(134,239,172,0.08)',
  NEUTRAL: 'rgba(234,179,8,0.08)',
  BEAR: 'rgba(249,115,22,0.08)', STRONG_BEAR: 'rgba(239,68,68,0.10)',
};
const OUTLOOK_COLOR = {
  'STRONG MOMENTUM': '#22c55e', 'POSITIVE': '#86efac',
  'NEUTRAL': '#94a3b8', 'WEAK': '#ef4444',
};

/* ── Custom tooltip ───────────────────────────────────────────────── */
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '6px 12px', fontSize: 12 }}>
      <div style={{ color: '#94a3b8', marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 700, color: chgColor(v) }}>
        {v > 0 ? '+' : ''}{typeof v === 'number' ? v.toFixed(2) : v}%
      </div>
    </div>
  );
};

/* ── Widget shell ─────────────────────────────────────────────────── */
function Widget({ label, title, borderColor = '#3b82f6', colSpan = 1, children, style = {} }) {
  return (
    <div style={{
      background: '#1e293b',
      border: '1px solid #334155',
      borderLeft: `3px solid ${borderColor}`,
      borderRadius: 10,
      padding: '12px 14px',
      gridColumn: `span ${colSpan}`,
      ...style,
    }}>
      {(label || title) && (
        <div style={{ marginBottom: 10 }}>
          {label && (
            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 }}>
              {label}
            </div>
          )}
          {title && (
            <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>{title}</div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   IST TIME HELPERS
════════════════════════════════════════════════════════════════════ */
function getISTMinutes() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const istMs = utcMs + 330 * 60000;
  const ist = new Date(istMs);
  return ist.getHours() * 60 + ist.getMinutes();
}

function shouldShowFutures() {
  const mins = getISTMinutes();
  const marketOpen  = 9 * 60 + 15;
  const marketClose = 15 * 60 + 30;
  return mins < marketOpen || mins >= marketClose;
}

/* ═══════════════════════════════════════════════════════════════════
   1. STOCK TICKER
════════════════════════════════════════════════════════════════════ */
function StockTicker({ data, indices }) {
  const items = [];

  // Add indices first
  (indices || []).forEach(idx => {
    items.push({
      symbol: idx.name?.replace('Nifty ', 'NIFTY ') || idx.name,
      price: idx.close,
      change: idx.change_pct,
      isIndex: true,
    });
  });

  // Add top stock live prices
  (data || []).forEach(s => {
    if (s.symbol && s.price != null) {
      items.push({
        symbol: (s.symbol || '').replace('.NS', ''),
        price: s.price,
        change: s.change_pct,
        isIndex: false,
      });
    }
  });

  if (!items.length) {
    return (
      <div style={{ background: '#0f172a', borderBottom: '1px solid #1e293b', padding: '8px 16px', fontSize: 11, color: '#475569' }}>
        Loading market data...
      </div>
    );
  }

  // Duplicate for seamless loop
  const doubled = [...items, ...items];

  return (
    <div style={{ background: '#0f172a', borderBottom: '1px solid #1e293b', overflow: 'hidden', position: 'relative' }}>
      <div style={{
        display: 'flex',
        animation: 'tickerScroll 60s linear infinite',
        whiteSpace: 'nowrap',
        width: 'max-content',
      }}>
        {doubled.map((item, i) => (
          <span key={i} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '7px 18px',
            borderRight: '1px solid #1e293b',
            fontSize: 12,
          }}>
            <span style={{ fontWeight: 700, color: item.isIndex ? '#60a5fa' : '#f1f5f9' }}>
              {item.symbol}
            </span>
            <span style={{ color: '#94a3b8' }}>
              ₹{Number(item.price).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </span>
            {item.change != null && (
              <span style={{ fontWeight: 700, color: chgColor(item.change) }}>
                {item.change > 0 ? '+' : ''}{Number(item.change).toFixed(2)}%
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   2. MORNING BRIEF WIDGET
════════════════════════════════════════════════════════════════════ */
function MorningBriefWidget({ mc, quickBuys, signalsAge }) {
  const now = new Date();
  const isWeekday = now.getDay() >= 1 && now.getDay() <= 5;
  const regime = mc?.regime || null;
  const rc = regime ? (REGIME_COLOR[regime] || '#64748b') : '#64748b';
  const vix = mc?.vix;
  const vixLabel = vix == null ? null : vix > 25 ? 'PANIC' : vix > 18 ? 'FEAR' : vix > 14 ? 'MODERATE' : 'CALM';
  const vixC = vixColor(vix);
  const favour = mc?.sector_bias?.favour || [];
  const avoid  = mc?.sector_bias?.avoid  || [];
  const topBuys = (quickBuys || []).slice(0, 3);

  const summary = regime
    ? `Market is in ${regime.replace('_', ' ')} regime. Equity allocation: ${mc.equity_allocation_min}–${mc.equity_allocation_max}%. `
      + (topBuys.length ? `Top setups: ${topBuys.map(s => (s.symbol || '').replace('.NS', '')).join(', ')}.` : 'Run pipeline for top picks.')
    : 'Market data loading — click Refresh Dashboard for today\'s brief.';

  return (
    <Widget label="Morning Brief" title="" borderColor="#3b82f6" colSpan={2} style={{
      background: 'linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(139,92,246,0.05) 100%)',
      borderColor: 'rgba(59,130,246,0.25)',
    }}>
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 16 }}>☀</span>
        <span style={{ fontSize: 14, fontWeight: 800, color: '#f1f5f9' }}>Morning Brief</span>
        <span style={{ fontSize: 11, color: '#64748b', marginLeft: 4 }}>
          {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
        </span>
        {!isWeekday && (
          <span style={{ fontSize: 10, fontWeight: 700, color: '#f97316', marginLeft: 4, padding: '1px 6px', borderRadius: 4, background: 'rgba(249,115,22,0.1)' }}>
            MARKET CLOSED
          </span>
        )}
        {signalsAge && (
          <span style={{ fontSize: 10, color: '#64748b', marginLeft: 'auto' }}>
            Signals: <span style={{ color: signalsAge !== new Date().toISOString().slice(0, 10) ? '#eab308' : '#22c55e', fontWeight: 600 }}>{signalsAge}</span>
          </span>
        )}
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
        {regime && (
          <div>
            <div style={{ fontSize: 9, color: '#64748b', marginBottom: 1 }}>REGIME</div>
            <span style={{ fontSize: 13, fontWeight: 800, color: rc }}>{regime.replace('_', ' ')}</span>
          </div>
        )}
        {vix != null && (
          <div>
            <div style={{ fontSize: 9, color: '#64748b', marginBottom: 1 }}>VIX</div>
            <span style={{ fontSize: 13, fontWeight: 700, color: vixC }}>{vix.toFixed(1)} · {vixLabel}</span>
          </div>
        )}
        {mc?.equity_allocation_min != null && (
          <div>
            <div style={{ fontSize: 9, color: '#64748b', marginBottom: 1 }}>EQUITY ALLOC</div>
            <span style={{ fontSize: 13, fontWeight: 700, color: rc }}>{mc.equity_allocation_min}–{mc.equity_allocation_max}%</span>
          </div>
        )}
        {mc?.add_score_threshold != null && (
          <div>
            <div style={{ fontSize: 9, color: '#64748b', marginBottom: 1 }}>MIN SCORE TO BUY</div>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>{mc.add_score_threshold}/100</span>
          </div>
        )}
        {topBuys.length > 0 && (
          <div>
            <div style={{ fontSize: 9, color: '#64748b', marginBottom: 1 }}>TOP SETUPS</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {topBuys.map(s => (
                <span key={s.symbol} style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
                  {(s.symbol || '').replace('.NS', '')}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sector bias */}
      {(favour.length > 0 || avoid.length > 0) && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 6 }}>
          {favour.length > 0 && (
            <span style={{ fontSize: 11 }}>
              <span style={{ fontWeight: 700, color: '#22c55e' }}>Favour: </span>
              <span style={{ color: '#94a3b8' }}>{favour.join(', ')}</span>
            </span>
          )}
          {avoid.length > 0 && (
            <span style={{ fontSize: 11 }}>
              <span style={{ fontWeight: 700, color: '#ef4444' }}>Avoid: </span>
              <span style={{ color: '#94a3b8' }}>{avoid.join(', ')}</span>
            </span>
          )}
        </div>
      )}

      {/* Summary */}
      <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic', borderTop: '1px solid #334155', paddingTop: 7, marginTop: 4 }}>
        {summary}
      </div>
    </Widget>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   3. QUICK BUY WIDGET
════════════════════════════════════════════════════════════════════ */
function QuickBuyWidget({ stocks, liveVerify, verifying, onVerify, signalsAge, onSelect }) {
  const today = new Date().toISOString().slice(0, 10);
  const isStale = signalsAge && signalsAge !== today;
  const anyVerified = Object.keys(liveVerify || {}).length > 0;

  return (
    <Widget label="Quick Buy" title="Top Buy Suggestions" borderColor="#22c55e" colSpan={1}>
      {/* Header actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontWeight: 700 }}>
          QUICK BUY
        </span>
        <button
          onClick={onVerify}
          disabled={verifying}
          style={{
            marginLeft: 'auto', padding: '3px 10px', borderRadius: 5, border: 'none', fontSize: 10, fontWeight: 600,
            background: anyVerified ? 'rgba(34,197,94,0.15)' : 'rgba(59,130,246,0.15)',
            color: anyVerified ? '#22c55e' : '#3b82f6',
            cursor: verifying ? 'wait' : 'pointer',
          }}
        >
          {verifying ? 'Verifying...' : anyVerified ? '✓ Verified' : '⟳ Verify Live'}
        </button>
      </div>

      {isStale && !anyVerified && (
        <div style={{ fontSize: 10, color: '#eab308', padding: '5px 8px', borderRadius: 6, background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)', marginBottom: 8 }}>
          Signals from {signalsAge} — may be stale. Verify live.
        </div>
      )}

      {/* Vertical list of stocks */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(stocks || []).map((s, i) => {
          const sym = (s.symbol || '').replace('.NS', '');
          const score = s.final_score ?? s.composite_score;
          const signal = s.sig?.signal || s.signal;
          const upside = s.target_price && s.cmp
            ? (((s.target_price - s.cmp) / s.cmp) * 100).toFixed(1)
            : null;
          const live = (liveVerify || {})[s.symbol];
          const liveSignal = live?.signal;
          const livePrice = live?.price || live?.cmp;
          const liveRsi = live?.rsi;
          const signalHolds = liveSignal === 'BUY';
          const signalChanged = live && liveSignal !== 'BUY';
          const cardBorder = live
            ? signalHolds ? '#22c55e44' : '#ef444444'
            : '#33415580';

          return (
            <div
              key={s.symbol}
              onClick={() => onSelect(s.symbol)}
              style={{
                background: '#0f172a',
                border: `1px solid ${cardBorder}`,
                borderRadius: 8, padding: '9px 10px',
                cursor: 'pointer',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = signalHolds ? '#22c55e88' : '#3b82f666'}
              onMouseLeave={e => e.currentTarget.style.borderColor = cardBorder}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: '#f1f5f9' }}>#{i + 1} {sym}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  {score != null && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: scoreColor(score), background: `${scoreColor(score)}18`, padding: '1px 5px', borderRadius: 4 }}>
                      {Number(score).toFixed(0)}
                    </span>
                  )}
                  {live && (
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: signalHolds ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: signalHolds ? '#22c55e' : '#ef4444' }}>
                      {signalHolds ? '✓' : `⚠ ${liveSignal || '?'}`}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>
                  ₹{fmt(livePrice ?? s.cmp)}
                </span>
                {livePrice != null && <span style={{ fontSize: 9, color: '#22c55e' }}>LIVE</span>}
                {upside && <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 600, marginLeft: 'auto' }}>+{upside}% ↑</span>}
              </div>

              <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: signalChanged ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)', color: signalChanged ? '#ef4444' : '#22c55e' }}>
                  {signalChanged ? `Was: ${signal}` : signal}
                </span>
                {s.sector && <span style={{ fontSize: 9, color: '#64748b' }}>{s.sector}</span>}
                {liveRsi != null && (
                  <span style={{ fontSize: 9, color: liveRsi >= 70 ? '#ef4444' : liveRsi <= 30 ? '#22c55e' : '#64748b', marginLeft: 'auto' }}>
                    RSI {Number(liveRsi).toFixed(0)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {(!stocks || stocks.length === 0) && (
          <div style={{ fontSize: 11, color: '#475569', textAlign: 'center', padding: '16px 0' }}>
            No BUY signals — run pipeline to update.
          </div>
        )}
      </div>
    </Widget>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   4. MARKET SIGNALS WIDGET
════════════════════════════════════════════════════════════════════ */
function MarketSignalsWidget({ volBreakouts, signals }) {
  const [tab, setTab] = useState('vol');

  // Uptrend: HOLD + strong trend
  const uptrend = (signals || [])
    .filter(s => s.signal === 'HOLD' && (s.rsi > 55 || s.trend === 'UP'))
    .slice(0, 8);

  // Near Breakout: within 3% of 52w high
  const nearBreakout = (signals || [])
    .filter(s => {
      const high52w = s.high_52w || s['52w_high'];
      const price = s.price || s.cmp;
      if (!high52w || !price) return false;
      return ((high52w - price) / high52w) < 0.03;
    })
    .slice(0, 8);

  const volData = (volBreakouts || []).slice(0, 8);

  const tabs = [
    { key: 'vol', label: 'Vol Breakout', count: volData.length },
    { key: 'uptrend', label: 'Uptrend', count: uptrend.length },
    { key: 'breakout', label: 'Near Breakout', count: nearBreakout.length },
  ];

  return (
    <Widget label="Market Signals" title="Breakouts & Trends" borderColor="#f97316" colSpan={1}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 10 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              flex: 1, padding: '4px 0', borderRadius: 5, border: 'none', fontSize: 9, fontWeight: 700,
              background: tab === t.key ? '#334155' : 'transparent',
              color: tab === t.key ? '#f1f5f9' : '#64748b',
              cursor: 'pointer',
            }}
          >
            {t.label} {t.count > 0 && <span style={{ color: '#f97316' }}>({t.count})</span>}
          </button>
        ))}
      </div>

      {/* Vol Breakout */}
      {tab === 'vol' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {volData.length === 0 && <div style={{ fontSize: 11, color: '#475569' }}>No volume breakouts. Scan to refresh.</div>}
          {volData.map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', borderRadius: 6, background: '#0f172a', fontSize: 11 }}>
              <span style={{ fontWeight: 700, color: '#f1f5f9' }}>{(s.symbol || '').replace('.NS', '')}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {s.vol_ratio != null && (
                  <span style={{ color: '#f97316', fontWeight: 600 }}>{Number(s.vol_ratio).toFixed(1)}x</span>
                )}
                {s.change_pct != null && (
                  <span style={{ fontWeight: 600, color: chgColor(s.change_pct) }}>
                    {s.change_pct > 0 ? '+' : ''}{Number(s.change_pct).toFixed(2)}%
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Uptrend */}
      {tab === 'uptrend' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {uptrend.length === 0 && <div style={{ fontSize: 11, color: '#475569' }}>No uptrend stocks found.</div>}
          {uptrend.map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', borderRadius: 6, background: '#0f172a', fontSize: 11 }}>
              <span style={{ fontWeight: 700, color: '#f1f5f9' }}>{(s.symbol || '').replace('.NS', '')}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {s.rsi != null && (
                  <span style={{ color: '#3b82f6', fontWeight: 600 }}>RSI {Number(s.rsi).toFixed(0)}</span>
                )}
                <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(34,197,94,0.12)', color: '#22c55e', fontWeight: 700 }}>
                  HOLD
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Near Breakout */}
      {tab === 'breakout' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {nearBreakout.length === 0 && <div style={{ fontSize: 11, color: '#475569' }}>No stocks near 52w high.</div>}
          {nearBreakout.map((s, i) => {
            const high52w = s.high_52w || s['52w_high'];
            const price = s.price || s.cmp;
            const distPct = high52w && price ? (((high52w - price) / high52w) * 100).toFixed(1) : null;
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', borderRadius: 6, background: '#0f172a', fontSize: 11 }}>
                <span style={{ fontWeight: 700, color: '#f1f5f9' }}>{(s.symbol || '').replace('.NS', '')}</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {distPct != null && (
                    <span style={{ color: '#eab308', fontWeight: 600 }}>{distPct}% below 52w</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Widget>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   5. GIFT NIFTY WIDGET
════════════════════════════════════════════════════════════════════ */
function GiftNiftyWidget({ data: d, loading, onRefresh }) {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const istMs = utcMs + 330 * 60000;
  const istHour = new Date(istMs).getHours();
  const istMin  = new Date(istMs).getMinutes();
  const isPreMarket = istHour < 9 || (istHour === 9 && istMin < 15);
  const label = isPreMarket ? 'PRE-MARKET' : 'POST-MARKET';

  const chg = d?.change_pct != null ? Number(d.change_pct) : null;
  const chgC = chg == null ? '#94a3b8' : chg > 0 ? '#22c55e' : chg < 0 ? '#ef4444' : '#94a3b8';
  const gapSignal = chg == null ? null
    : chg >= 1.5   ? { text: 'GAP UP ↑↑',  color: '#22c55e', bg: 'rgba(34,197,94,0.10)' }
    : chg >= 0.5   ? { text: 'GAP UP ↑',   color: '#4ade80', bg: 'rgba(74,222,128,0.08)' }
    : chg >= -0.5  ? { text: 'FLAT →',     color: '#eab308', bg: 'rgba(234,179,8,0.08)' }
    : chg >= -1.5  ? { text: 'GAP DOWN ↓', color: '#f97316', bg: 'rgba(249,115,22,0.08)' }
    :                { text: 'GAP DOWN ↓↓',color: '#ef4444', bg: 'rgba(239,68,68,0.10)' };

  return (
    <Widget label={label} title="Gift Nifty Futures" borderColor={chgC} colSpan={1}
      style={{ background: gapSignal ? gapSignal.bg : 'rgba(100,116,139,0.06)', borderColor: `${chgC}33` }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {gapSignal && (
          <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 9px', borderRadius: 12, background: gapSignal.bg, color: gapSignal.color, border: `1px solid ${gapSignal.color}44` }}>
            {gapSignal.text}
          </span>
        )}
        <button onClick={onRefresh} disabled={loading} style={{ marginLeft: 'auto', padding: '3px 9px', borderRadius: 5, border: 'none', fontSize: 10, background: '#1e293b', color: '#94a3b8', cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? '↻' : '↻ Refresh'}
        </button>
      </div>

      {loading && !d && <div style={{ fontSize: 11, color: '#475569' }}>Fetching Gift Nifty...</div>}

      {d && (
        <>
          <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 9, color: '#64748b', marginBottom: 1 }}>LTP</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: chgC, lineHeight: 1 }}>
                {d.ltp != null ? Number(d.ltp).toLocaleString('en-IN') : '—'}
              </div>
              {chg != null && (
                <div style={{ fontSize: 12, fontWeight: 700, color: chgC }}>
                  {chg > 0 ? '+' : ''}{chg.toFixed(2)}%
                </div>
              )}
            </div>
            {d.nifty_spot != null && (
              <div>
                <div style={{ fontSize: 9, color: '#64748b', marginBottom: 1 }}>NIFTY SPOT</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{Number(d.nifty_spot).toLocaleString('en-IN')}</div>
                {d.premium != null && (
                  <div style={{ fontSize: 10, color: d.premium >= 0 ? '#22c55e' : '#ef4444' }}>
                    {d.premium >= 0 ? '+' : ''}{Number(d.premium).toFixed(0)} {d.premium >= 0 ? 'premium' : 'discount'}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 12, marginBottom: 6 }}>
            {d.high != null && <div><div style={{ fontSize: 9, color: '#64748b' }}>HIGH</div><div style={{ fontSize: 11, fontWeight: 600, color: '#22c55e' }}>{Number(d.high).toLocaleString('en-IN')}</div></div>}
            {d.low != null && <div><div style={{ fontSize: 9, color: '#64748b' }}>LOW</div><div style={{ fontSize: 11, fontWeight: 600, color: '#ef4444' }}>{Number(d.low).toLocaleString('en-IN')}</div></div>}
            {d.expiry && <div><div style={{ fontSize: 9, color: '#64748b' }}>EXPIRY</div><div style={{ fontSize: 11, fontWeight: 600 }}>{d.expiry}</div></div>}
          </div>

          {gapSignal && isPreMarket && (
            <div style={{ fontSize: 10, color: '#94a3b8', fontStyle: 'italic', padding: '6px 8px', background: 'var(--bg-secondary, #0f172a)', borderRadius: 6 }}>
              {chg >= 1.5  ? 'Strong gap-up at 9:15 AM expected — watch resistance.'
               : chg >= 0.5 ? 'Mild gap-up — watch for continuation vs fade.'
               : chg >= -0.5 ? 'Flat open — direction set by first 15 min.'
               : chg >= -1.5 ? 'Gap-down expected — wait for support before entry.'
               : 'Sharp gap-down — avoid fresh entries until stable.'}
            </div>
          )}

          {d?.fetched_at && (
            <div style={{ fontSize: 9, color: '#475569', marginTop: 6 }}>Updated {d.fetched_at} · auto 30s</div>
          )}
        </>
      )}
    </Widget>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   6. GLOBAL CUES WIDGET
════════════════════════════════════════════════════════════════════ */
function GlobalCuesWidget({ global: globalData, macro }) {
  const macroRules = {
    'India VIX':    { bull: v => v != null && v < 16 },
    'USD/INR':      { bull: v => v != null && v < 85 },
    'Crude Oil':    { bull: v => v != null && v < 80 },
    'US 10Y Yield': { bull: v => v != null && v < 4.5 },
    'US Dollar':    { bull: v => v != null && v < 105 },
  };
  const macroItems = Object.entries(macro || {}).map(([name, d]) => ({
    name, close: d.close, change_pct: d.change_pct,
    bullish: macroRules[name]?.bull(d.close),
  }));
  const bullCount = macroItems.filter(m => m.bullish === true).length;
  const totalMacro = macroItems.filter(m => m.bullish !== undefined).length;
  const macroScore = totalMacro > 0 ? Math.round((bullCount / totalMacro) * 8) : null;

  return (
    <Widget label="Global Cues & Macro" title="" borderColor="#8b5cf6" colSpan={1}>
      {/* Global indices */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: '#64748b', letterSpacing: 1, marginBottom: 5 }}>GLOBAL INDICES</div>
        {(globalData || []).map(g => (
          <div key={g.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '4px 0', borderBottom: '1px solid #1e293b' }}>
            <span style={{ color: '#94a3b8' }}>{g.name}</span>
            <span style={{ fontWeight: 600, color: chgColor(g.change_pct) }}>
              {g.change_pct > 0 ? '+' : ''}{g.change_pct?.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>

      {/* Macro */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#64748b', letterSpacing: 1 }}>MACRO FACTORS</div>
          {macroScore != null && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
              background: macroScore >= 5 ? 'rgba(34,197,94,0.12)' : macroScore >= 3 ? 'rgba(234,179,8,0.12)' : 'rgba(239,68,68,0.12)',
              color: macroScore >= 5 ? '#22c55e' : macroScore >= 3 ? '#eab308' : '#ef4444',
            }}>
              Macro {macroScore}/8
            </span>
          )}
        </div>
        {macroItems.map(m => (
          <div key={m.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, padding: '4px 0', borderBottom: '1px solid #1e293b' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {m.bullish !== undefined && (
                <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: m.bullish ? '#22c55e' : '#ef4444', display: 'inline-block' }} />
              )}
              <span style={{ color: '#94a3b8' }}>{m.name}</span>
            </div>
            <div>
              <span style={{ fontWeight: 600 }}>
                {m.close?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
              {m.change_pct != null && (
                <span style={{ color: chgColor(m.change_pct), fontSize: 9, marginLeft: 5 }}>
                  {m.change_pct > 0 ? '+' : ''}{m.change_pct?.toFixed(2)}%
                </span>
              )}
            </div>
          </div>
        ))}
        {macroScore != null && (
          <div style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic', marginTop: 6 }}>
            {macroScore >= 5 ? 'Macro bullish — consider increasing equity'
              : macroScore >= 3 ? 'Mixed macro — stay selective'
              : 'Macro bearish — raise cash'}
          </div>
        )}
      </div>
    </Widget>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   7. RISK WIDGET
════════════════════════════════════════════════════════════════════ */
function RiskWidget({ mc }) {
  if (!mc) return (
    <Widget label="Risk Analyzer" title="" borderColor="#eab308" colSpan={1}>
      <div style={{ fontSize: 11, color: '#475569' }}>No market data. Refresh dashboard.</div>
    </Widget>
  );

  const vix = mc.vix;
  const regime = mc.regime || 'NEUTRAL';
  const rc = REGIME_COLOR[regime] || '#64748b';
  const vixPct = vix != null ? Math.min(100, (vix / 40) * 100) : 0;
  const vixC = vixColor(vix);

  const dmas = [
    { label: 'vs 50 DMA', val: mc.nifty_vs_50dma_pct },
    { label: 'vs 200 DMA', val: mc.nifty_vs_200dma_pct },
    { label: '20d ROC', val: mc.roc_20d_pct },
  ].filter(d => d.val != null);

  return (
    <Widget label="Risk Analyzer" title="" borderColor="#eab308" colSpan={1}>
      {/* VIX */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: '#64748b', letterSpacing: 1, marginBottom: 5 }}>INDIA VIX</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#475569', marginBottom: 3 }}>
          <span>Calm</span><span>Fear</span><span>Panic</span>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: '#0f172a', position: 'relative', overflow: 'hidden', marginBottom: 2 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to right, #22c55e, #eab308, #ef4444)', opacity: 0.2, borderRadius: 4 }} />
          <div style={{ width: `${vixPct}%`, height: '100%', background: vixC, borderRadius: 4, transition: 'width 0.5s' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: vixC }}>{vix != null ? vix.toFixed(1) : '—'}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: vixC }}>
            {vix == null ? '' : vix > 25 ? 'PANIC' : vix > 18 ? 'FEAR' : vix > 14 ? 'MODERATE' : 'CALM'}
          </span>
        </div>
      </div>

      {/* DMA Bars */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: '#64748b', letterSpacing: 1, marginBottom: 5 }}>NIFTY DMA POSITION</div>
        {dmas.map(d => (
          <div key={d.label} style={{ marginBottom: 7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
              <span style={{ color: '#64748b' }}>{d.label}</span>
              <span style={{ fontWeight: 700, color: dmaColor(d.val) }}>{d.val >= 0 ? '+' : ''}{d.val.toFixed(1)}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: '#0f172a', position: 'relative' }}>
              <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#334155' }} />
              {d.val >= 0 ? (
                <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: `${Math.min(50, (d.val / 20) * 50)}%`, background: '#22c55e', borderRadius: 3, opacity: 0.8 }} />
              ) : (
                <div style={{ position: 'absolute', right: '50%', top: 0, bottom: 0, width: `${Math.min(50, (Math.abs(d.val) / 20) * 50)}%`, background: '#ef4444', borderRadius: 3, opacity: 0.8 }} />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Allocation */}
      <div style={{ background: REGIME_BG[regime] || '#0f172a', border: `1px solid ${rc}33`, borderRadius: 7, padding: '8px 10px' }}>
        <div style={{ fontSize: 9, color: '#64748b', marginBottom: 2 }}>RECOMMENDED EQUITY</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: rc }}>{mc.equity_allocation_min}–{mc.equity_allocation_max}%</div>
        <div style={{ fontSize: 9, color: '#64748b', marginTop: 2 }}>
          Cash/Debt: {100 - mc.equity_allocation_max}–{100 - mc.equity_allocation_min}%
        </div>
        {mc.add_score_threshold != null && (
          <div style={{ fontSize: 9, color: '#64748b', marginTop: 3 }}>
            Add stocks if score ≥ <span style={{ color: rc, fontWeight: 700 }}>{mc.add_score_threshold}</span>
          </div>
        )}
      </div>
    </Widget>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   8. INDIAN INDICES WIDGET
════════════════════════════════════════════════════════════════════ */
function IndicesWidget({ indices }) {
  return (
    <Widget label="Indian Indices" title="" borderColor="#3b82f6" colSpan={1}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(indices || []).map(idx => (
          <div key={idx.name} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '6px 8px', borderRadius: 6, background: '#0f172a',
          }}>
            <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>
              {idx.name?.replace('Nifty ', '')}
            </span>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#f1f5f9' }}>
                {Number(idx.close).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, color: chgColor(idx.change_pct) }}>
                {idx.change_pct > 0 ? '+' : ''}{idx.change_pct?.toFixed(2)}%
              </div>
            </div>
          </div>
        ))}
        {(!indices || indices.length === 0) && (
          <div style={{ fontSize: 11, color: '#475569' }}>No index data available.</div>
        )}
      </div>
    </Widget>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   9. SECTOR WIDGET (span 2)
════════════════════════════════════════════════════════════════════ */
function SectorWidget({ sectors, sectorOutlook }) {
  const useOutlook = sectorOutlook && sectorOutlook.length > 0;
  const chartData = useOutlook
    ? sectorOutlook.map(s => ({ name: s.name.replace('Nifty ', ''), value: s.month_change_pct, outlook: s.outlook }))
    : (sectors || []).map(s => ({ name: s.name.replace('Nifty ', ''), value: s.change_pct }));
  const sorted = [...chartData].sort((a, b) => b.value - a.value);

  return (
    <Widget label="Sector Performance" title={useOutlook ? '1-Month Returns' : '1-Day Returns'} borderColor="#22c55e" colSpan={2}>
      <ResponsiveContainer width="100%" height={Math.max(180, sorted.length * 24)}>
        <BarChart data={sorted} layout="vertical" margin={{ top: 0, right: 50, bottom: 0, left: 0 }}>
          <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}
            tickFormatter={v => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`} />
          <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <ReferenceLine x={0} stroke="#334155" />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {sorted.map((d, i) => (
              <Cell key={i}
                fill={useOutlook ? (OUTLOOK_COLOR[d.outlook] || chgColor(d.value)) : chgColor(d.value)}
                fillOpacity={0.8} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {useOutlook && (
        <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          {Object.entries(OUTLOOK_COLOR).map(([k, v]) => (
            <span key={k} style={{ fontSize: 9, color: v, display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: v, display: 'inline-block' }} />
              {k}
            </span>
          ))}
        </div>
      )}
    </Widget>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   10. MUTUAL FUNDS WIDGET
════════════════════════════════════════════════════════════════════ */
const AC_ORDER = ['Equity', 'Hybrid', 'Debt', 'Solution Oriented', 'Other / ETF'];
const AC_LABELS = {
  'Equity': { bias: 'Growth', note: 'Market-linked returns, higher risk' },
  'Hybrid': { bias: 'Balanced', note: 'Mix of equity & debt' },
  'Debt': { bias: 'Safety', note: 'Lower risk, stable returns' },
  'Solution Oriented': { bias: 'Goal-based', note: 'Retirement & children plans' },
  'Other / ETF': { bias: 'Passive', note: 'Index funds & ETFs' },
};

function MutualFundsWidget() {
  const [catData, setCatData]     = useState(null);
  const [top10, setTop10]         = useState(null);
  const [top10Loading, setTop10Loading] = useState(false);
  const [top10Err, setTop10Err]   = useState(null);
  const [activeClass, setActiveClass] = useState('Equity');
  const [view, setView]           = useState('top10'); // 'top10' | 'universe'
  const [catLoading, setCatLoading] = useState(true);

  useEffect(() => {
    api.getMfCategories()
      .then(d => { setCatData(d); setCatLoading(false); })
      .catch(() => setCatLoading(false));
    // Auto-load top10 on mount
    loadTop10();
  }, []);

  function loadTop10() {
    setTop10Loading(true);
    setTop10Err(null);
    api.getMfTop10()
      .then(d => { setTop10(d); setTop10Loading(false); })
      .catch(e => { setTop10Err('Failed to load'); setTop10Loading(false); });
  }

  // Group categories by asset class
  const grouped = {};
  if (catData) {
    for (const c of catData.categories) {
      if (!grouped[c.asset_class]) grouped[c.asset_class] = [];
      grouped[c.asset_class].push(c);
    }
  }
  const activeList = (grouped[activeClass] || []).slice(0, 8);

  const CAT_COLORS = {
    'Flexi Cap Fund': '#22c55e',
    'Large & Mid Cap Fund': '#3b82f6',
    'Large Cap Fund': '#60a5fa',
    'Mid Cap Fund': '#f59e0b',
    'Small Cap Fund': '#f97316',
    'Multi Cap Fund': '#a78bfa',
    'ELSS': '#ec4899',
    'Focused Fund': '#14b8a6',
  };

  return (
    <Widget label="Mutual Funds" title="MF Scheme Universe" borderColor="#8b5cf6" colSpan={1}>
      {/* View toggle */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {['top10', 'universe'].map(v => (
          <button key={v} onClick={() => setView(v)} style={{
            fontSize: 10, padding: '3px 10px', borderRadius: 4, border: 'none',
            cursor: 'pointer', fontWeight: 700,
            background: view === v ? '#8b5cf6' : '#1e293b',
            color: view === v ? '#fff' : '#64748b',
          }}>
            {v === 'top10' ? 'Top 10 (1yr)' : 'Universe'}
          </button>
        ))}
      </div>

      {/* ── Top 10 view ── */}
      {view === 'top10' && (
        top10Loading ? (
          <div style={{ color: '#475569', fontSize: 11, padding: '16px 0', textAlign: 'center' }}>
            Fetching returns from mfapi.in...
            <div style={{ fontSize: 9, color: '#334155', marginTop: 4 }}>Scanning ~180 equity direct growth plans</div>
          </div>
        ) : top10Err ? (
          <div>
            <div style={{ color: '#ef4444', fontSize: 11 }}>{top10Err}</div>
            <button onClick={loadTop10} style={{ marginTop: 6, fontSize: 9, padding: '2px 8px', borderRadius: 4,
              background: '#1e293b', color: '#94a3b8', border: 'none', cursor: 'pointer' }}>Retry</button>
          </div>
        ) : top10?.top10?.length > 0 ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 9, color: '#475569' }}>
                Scanned {top10.total_scanned} funds · {top10.fetched_at}
              </span>
              <button onClick={loadTop10} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3,
                background: '#1e293b', color: '#64748b', border: 'none', cursor: 'pointer' }}>↻</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {top10.top10.map((mf, i) => {
                const catKey = mf.short_category || '';
                const color = CAT_COLORS[catKey] || '#8b5cf6';
                const ret = mf.return_1yr;
                const retColor = ret >= 30 ? '#22c55e' : ret >= 15 ? '#86efac' : ret >= 0 ? '#94a3b8' : '#ef4444';
                return (
                  <div key={i} style={{ padding: '6px 8px', borderRadius: 6, background: '#0f172a',
                    borderLeft: `2px solid ${color}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, paddingRight: 6 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#e2e8f0', lineHeight: 1.3 }}>
                          {i + 1}. {mf.name}
                        </div>
                        <div style={{ fontSize: 9, color: '#64748b', marginTop: 1 }}>
                          {mf.amc_short} · <span style={{ color }}>{mf.short_category}</span>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: retColor }}>
                          {ret >= 0 ? '+' : ''}{ret}%
                        </div>
                        <div style={{ fontSize: 8, color: '#475569' }}>1yr return</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <span style={{ fontSize: 8, color: '#475569' }}>NAV ₹{mf.nav?.toFixed(2)}</span>
                      <span style={{ fontSize: 8, color: '#334155' }}>1yr ago ₹{mf.nav_1yr_ago?.toFixed(2)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 8, color: '#334155', marginTop: 6, fontStyle: 'italic' }}>
              Source: mfapi.in · Equity Direct Growth plans only · Past returns ≠ future performance
            </div>
          </div>
        ) : (
          <div style={{ color: '#475569', fontSize: 11, textAlign: 'center', padding: '12px 0' }}>
            <div>No data yet</div>
            <button onClick={loadTop10} style={{ marginTop: 6, fontSize: 10, padding: '3px 10px', borderRadius: 4,
              background: '#8b5cf6', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
              Fetch Top 10
            </button>
          </div>
        )
      )}

      {/* ── Universe view ── */}
      {view === 'universe' && (
        catLoading ? (
          <div style={{ color: '#475569', fontSize: 11 }}>Loading...</div>
        ) : catData ? (
          <div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: '#94a3b8' }}>
                <span style={{ color: '#f1f5f9', fontWeight: 700 }}>{catData.total_schemes?.toLocaleString()}</span> schemes
              </span>
              <span style={{ fontSize: 10, color: '#94a3b8' }}>
                <span style={{ color: '#f1f5f9', fontWeight: 700 }}>{catData.total_amcs}</span> AMCs
              </span>
            </div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
              {AC_ORDER.filter(ac => grouped[ac]).map(ac => (
                <button key={ac} onClick={() => setActiveClass(ac)} style={{
                  fontSize: 9, padding: '2px 7px', borderRadius: 4, border: 'none',
                  cursor: 'pointer', fontWeight: 700,
                  background: activeClass === ac ? (grouped[ac]?.[0]?.color || '#8b5cf6') : '#1e293b',
                  color: activeClass === ac ? '#fff' : '#64748b',
                }}>
                  {ac} <span style={{ opacity: 0.7 }}>({(grouped[ac] || []).reduce((s, c) => s + c.count, 0).toLocaleString()})</span>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {activeList.map((cat, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '5px 8px', borderRadius: 5, background: '#0f172a', borderLeft: `2px solid ${cat.color}` }}>
                  <span style={{ fontSize: 10, color: '#e2e8f0', flex: 1, paddingRight: 6 }}>{cat.short_name}</span>
                  <span style={{ fontSize: 9, color: cat.color, fontWeight: 700 }}>{cat.count} schemes</span>
                </div>
              ))}
              {(grouped[activeClass] || []).length > 8 && (
                <div style={{ fontSize: 9, color: '#475569', textAlign: 'center', paddingTop: 2 }}>
                  +{(grouped[activeClass].length - 8)} more categories
                </div>
              )}
            </div>
            <div style={{ fontSize: 9, color: '#334155', marginTop: 6, fontStyle: 'italic' }}>
              Source: AMFI/NSDL scheme master
            </div>
          </div>
        ) : (
          <div style={{ color: '#475569', fontSize: 11 }}>MF data unavailable</div>
        )
      )}
    </Widget>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN COMPONENT — DailyUpdatesView
════════════════════════════════════════════════════════════════════ */
export default function DailyUpdatesView() {
  const [report, setReport]             = useState(null);
  const [loading, setLoading]           = useState(true);
  const [generating, setGenerating]     = useState(false);
  const [genStatus, setGenStatus]       = useState(null);
  const [mc, setMc]                     = useState(null);
  const [quickBuys, setQuickBuys]       = useState([]);
  const [signalsAge, setSignalsAge]     = useState(null);
  const [liveVerify, setLiveVerify]     = useState({});
  const [verifying, setVerifying]       = useState(false);
  const [selectedStock, setSelectedStock] = useState(null);
  const [giftNifty, setGiftNifty]       = useState(null);
  const [giftLoading, setGiftLoading]   = useState(false);
  const [showFutures, setShowFutures]   = useState(shouldShowFutures());
  const [tickerData, setTickerData]     = useState([]);
  const [volBreakouts, setVolBreakouts] = useState([]);
  const [marketSignals, setMarketSignals] = useState([]);
  const [allSignals, setAllSignals]     = useState([]);

  const pollRef     = useRef(null);
  const giftPollRef = useRef(null);
  const tickerRef   = useRef(null);

  /* Inject ticker CSS once */
  useEffect(() => {
    const id = 'ticker-style';
    if (!document.getElementById(id)) {
      const el = document.createElement('style');
      el.id = id;
      el.textContent = TICKER_STYLE;
      document.head.appendChild(el);
    }
    return () => {};
  }, []);

  /* Load all data */
  const loadAll = () => {
    setLoading(true);
    Promise.allSettled([
      api.getDailyReport(),
      api.getMarketCondition(),
      api.getTop20(),
      api.getSignals(),
    ]).then(([rep, condition, top20Res, signalsRes]) => {
      if (rep.status === 'fulfilled') setReport(rep.value);
      if (condition.status === 'fulfilled') setMc(condition.value);

      const top20 = top20Res.status === 'fulfilled' && Array.isArray(top20Res.value) ? top20Res.value : [];
      const signals = signalsRes.status === 'fulfilled' && Array.isArray(signalsRes.value) ? signalsRes.value : [];
      const sigMap = Object.fromEntries(signals.map(s => [s.symbol, s]));
      const buys = top20
        .map(s => ({ ...s, sig: sigMap[s.symbol] }))
        .filter(s => s.sig?.signal === 'BUY' || s.signal === 'BUY')
        .sort((a, b) => (b.final_score || 0) - (a.final_score || 0))
        .slice(0, 5);
      setQuickBuys(buys);
      setAllSignals(signals);
      setMarketSignals(signals);

      const reportDate = rep.status === 'fulfilled' ? rep.value?.date : null;
      setSignalsAge(reportDate);
    }).finally(() => setLoading(false));
  };

  /* Fetch ticker live prices */
  const fetchTicker = () => {
    Promise.allSettled([
      api.getTop20LivePrices(),
    ]).then(([pricesRes]) => {
      if (pricesRes.status === 'fulfilled') {
        const d = pricesRes.value;
        if (Array.isArray(d)) setTickerData(d);
        else if (d && typeof d === 'object') {
          const arr = Object.entries(d).map(([symbol, vals]) => ({
            symbol,
            price: vals.price ?? vals.ltp,
            change_pct: vals.change_pct,
          }));
          setTickerData(arr);
        }
      }
    });
  };

  /* Fetch volume breakouts */
  const fetchVolBreakouts = () => {
    api.getVolumeBreakouts()
      .then(d => {
        if (Array.isArray(d)) setVolBreakouts(d);
        else if (d && d.stocks) setVolBreakouts(d.stocks);
      })
      .catch(() => {});
  };

  /* Live-verify BUY signals */
  const verifyLive = async (stocks) => {
    if (!stocks.length) return;
    setVerifying(true);
    const results = {};
    await Promise.allSettled(
      stocks.map(s =>
        api.getLiveSignal(s.symbol)
          .then(d => { results[s.symbol] = d; })
          .catch(() => { results[s.symbol] = null; })
      )
    );
    setLiveVerify(results);
    setVerifying(false);
  };

  /* Gift Nifty fetch */
  const fetchGiftNifty = () => {
    if (!shouldShowFutures()) return;
    setGiftLoading(true);
    api.getGiftNifty()
      .then(d => setGiftNifty(d))
      .catch(() => {})
      .finally(() => setGiftLoading(false));
  };

  useEffect(() => { loadAll(); fetchVolBreakouts(); fetchTicker(); }, []);

  /* Ticker auto-refresh every 10s */
  useEffect(() => {
    tickerRef.current = setInterval(fetchTicker, 10000);
    return () => clearInterval(tickerRef.current);
  }, []);

  /* IST check every minute */
  useEffect(() => {
    const timer = setInterval(() => setShowFutures(shouldShowFutures()), 60000);
    return () => clearInterval(timer);
  }, []);

  /* Gift Nifty refresh */
  useEffect(() => {
    if (!showFutures) { setGiftNifty(null); return; }
    fetchGiftNifty();
    giftPollRef.current = setInterval(fetchGiftNifty, 30000);
    return () => clearInterval(giftPollRef.current);
  }, [showFutures]);

  /* Poll while generating */
  useEffect(() => {
    if (!generating) return;
    pollRef.current = setInterval(() => {
      api.getDailyStatus().then(s => {
        setGenStatus(s);
        if (!s.running && s.status !== 'idle') {
          setGenerating(false);
          clearInterval(pollRef.current);
          if (s.status === 'completed') loadAll();
        }
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(pollRef.current);
  }, [generating]);

  const startGenerate = () => {
    setGenerating(true);
    setGenStatus({ running: true, status: 'starting', log_lines: [] });
    api.generateDailyReport().catch(() => setGenerating(false));
  };

  const dash = report?.market_dashboard;
  const indices = dash?.indices || [];
  const tickerIndices = indices.slice(0, 3);

  /* Responsive grid column count via state */
  const [cols, setCols] = useState(3);
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      if (w < 900) setCols(1);
      else if (w < 1300) setCols(2);
      else setCols(3);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  /* Compute effective column span based on available columns */
  const span = (desired) => Math.min(desired, cols);

  return (
    <div style={{ padding: '0 0 24px' }}>
      {/* Ticker CSS already injected via useEffect */}

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#1e293b', borderBottom: '1px solid #334155', flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#f1f5f9' }}>Dashboard</h2>
          {report && (
            <span style={{ fontSize: 11, color: '#64748b' }}>
              {report.date} · Generated: {report.generated_at}
            </span>
          )}
        </div>
        <RunPipelineButton label="Run Full Pipeline" variant="bar" onDone={loadAll} />
        <button onClick={startGenerate} disabled={generating}
          style={{
            padding: '7px 16px', borderRadius: 7, border: 'none',
            background: generating ? '#334155' : '#3b82f6',
            color: 'white', fontWeight: 600, cursor: generating ? 'wait' : 'pointer', fontSize: 12,
          }}>
          {generating ? 'Refreshing...' : 'Refresh Dashboard'}
        </button>
      </div>

      {generating && genStatus && (
        <div style={{ padding: '10px 16px', background: '#0f172a', borderBottom: '1px solid #1e293b', fontSize: 11 }}>
          <div style={{ marginBottom: 4, fontWeight: 600, color: '#3b82f6' }}>Status: {genStatus.status}</div>
          <div style={{ maxHeight: 80, overflow: 'auto', fontFamily: 'monospace', fontSize: 10, color: '#64748b', lineHeight: 1.6 }}>
            {(genStatus.log_lines || []).map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      )}

      {/* ── Stock Ticker ─────────────────────────────────────────────── */}
      <StockTicker data={tickerData} indices={tickerIndices} />

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '40px 20px', justifyContent: 'center', color: '#64748b', fontSize: 13 }}>
          <div className="spinner" /> Loading dashboard...
        </div>
      )}

      {!loading && !report && !generating && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748b' }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: '#94a3b8' }}>No Dashboard Data Yet</div>
          <div style={{ fontSize: 13 }}>Click "Refresh Dashboard" to fetch today's market data.</div>
        </div>
      )}

      {/* ── Widget Grid ─────────────────────────────────────────────── */}
      {!loading && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: 16,
          padding: '16px',
        }}>

          {/* 1. Morning Brief — span 2 */}
          <MorningBriefWidget mc={mc} quickBuys={quickBuys} signalsAge={signalsAge} />

          {/* 2. Top Buy Suggestions — span 1 */}
          <QuickBuyWidget
            stocks={quickBuys}
            liveVerify={liveVerify}
            verifying={verifying}
            onVerify={() => verifyLive(quickBuys)}
            signalsAge={signalsAge}
            onSelect={setSelectedStock}
          />

          {/* 3. Market Signals — span 1 */}
          <MarketSignalsWidget volBreakouts={volBreakouts} signals={allSignals} />

          {/* 4. Gift Nifty — span 1, conditional */}
          {showFutures && (
            <GiftNiftyWidget data={giftNifty} loading={giftLoading} onRefresh={fetchGiftNifty} />
          )}

          {/* 5. Global Cues — span 1 */}
          {dash && (
            <GlobalCuesWidget global={dash.global_indices} macro={dash.macro} />
          )}

          {/* 6. Risk Analyzer — span 1 */}
          <RiskWidget mc={mc} />

          {/* 7. Indian Indices — span 1 */}
          {indices.length > 0 && (
            <IndicesWidget indices={indices} />
          )}

          {/* 8. Sector Performance — span 2 */}
          {(dash?.sectors || report?.sector_outlook) && (
            <SectorWidget
              sectors={dash?.sectors || []}
              sectorOutlook={report?.sector_outlook}
            />
          )}

          {/* 9. Mutual Funds — span 1 */}
          <MutualFundsWidget />

        </div>
      )}

      {/* Disclaimer */}
      <div style={{ fontSize: 10, color: '#334155', textAlign: 'center', padding: '8px 0 0' }}>
        For educational purposes only. Not financial advice. Data sourced from Yahoo Finance &amp; public indices.
      </div>

      {selectedStock && <StockModal symbol={selectedStock} onClose={() => setSelectedStock(null)} />}
    </div>
  );
}
