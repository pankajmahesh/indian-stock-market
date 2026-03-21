import { useState, useEffect, useRef } from 'react';
import socket from '../socket';
import { api } from '../api';

// ── helpers ────────────────────────────────────────────────────────────────

const fmt    = n => n != null ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 }) : '—';
const fmtPct = n => n != null ? `${n >= 0 ? '+' : ''}${Number(n).toFixed(2)}%` : '—';
const fmtScore = n => n != null ? Number(n).toFixed(1) : '—';

function scoreColor(v) {
  if (v == null) return 'var(--text-muted)';
  if (v >= 70) return 'var(--accent-green)';
  if (v >= 55) return 'var(--accent-yellow)';
  return 'var(--accent-red)';
}

function signalStyle(s) {
  const map = {
    BUY:  { color: 'var(--accent-green)', bg: 'rgba(74,222,128,0.10)', border: 'rgba(74,222,128,0.30)' },
    SELL: { color: 'var(--accent-red)',   bg: 'rgba(248,113,113,0.10)', border: 'rgba(248,113,113,0.30)' },
    HOLD: { color: 'var(--accent-yellow)',bg: 'rgba(234,179,8,0.10)',  border: 'rgba(234,179,8,0.30)' },
  };
  return map[s] || map.HOLD;
}

function SignalBadge({ signal }) {
  const st = signalStyle(signal);
  return (
    <span style={{
      background: st.bg, color: st.color, border: `1px solid ${st.border}`,
      borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700,
    }}>
      {signal || 'HOLD'}
    </span>
  );
}

function ScoreBar({ value }) {
  if (value == null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 80 }}>
      <div style={{ flex: 1, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: scoreColor(value), borderRadius: 3, transition: 'width 0.4s' }} />
      </div>
      <span style={{ fontSize: 11, color: scoreColor(value), fontWeight: 600, minWidth: 28 }}>{fmtScore(value)}</span>
    </div>
  );
}

// ── Signal feed card ──────────────────────────────────────────────────────

function SignalCard({ event }) {
  const arrowColor = event.new_signal === 'BUY' ? 'var(--accent-green)' : event.new_signal === 'SELL' ? 'var(--accent-red)' : 'var(--accent-yellow)';
  return (
    <div style={{
      background: 'var(--bg-secondary)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center',
      gap: 10, fontSize: 12,
    }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent-cyan)', minWidth: 70 }}>
        {event.symbol}
      </div>
      <SignalBadge signal={event.old_signal} />
      <span style={{ color: arrowColor, fontWeight: 700 }}>→</span>
      <SignalBadge signal={event.new_signal} />
      <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
        <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>₹{fmt(event.price)}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>RSI {event.rsi} · {event.ts}</div>
      </div>
    </div>
  );
}

// ── Live Top-20 row ───────────────────────────────────────────────────────

function LiveRow({ stock, rank, onSelect, prevLtp }) {
  const [flash, setFlash] = useState(null);
  const ltp = stock.ltp;

  useEffect(() => {
    if (prevLtp == null || ltp == null || ltp === prevLtp) return;
    setFlash(ltp > prevLtp ? 'up' : 'down');
    const t = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(t);
  }, [ltp]);

  const chgColor = stock.change_pct >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';

  return (
    <tr
      onClick={() => onSelect?.(stock.symbol)}
      style={{
        cursor: 'pointer',
        background: flash === 'up'   ? 'rgba(74,222,128,0.06)' :
                    flash === 'down' ? 'rgba(248,113,113,0.06)' : 'transparent',
        transition: 'background 0.4s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-muted)' }}>{rank}</td>
      <td style={{ padding: '8px 10px' }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent-cyan)' }}>
          {stock.symbol?.replace('.NS', '')}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
          {stock.l_category || ''} · {stock.sector || ''}
        </div>
      </td>
      <td style={{ padding: '8px 10px', fontWeight: 600, fontSize: 13 }}>
        {ltp != null ? `₹${fmt(ltp)}` : '—'}
      </td>
      <td style={{ padding: '8px 10px', fontSize: 12, color: chgColor, fontWeight: 600 }}>
        {fmtPct(stock.change_pct)}
      </td>
      <td style={{ padding: '8px 10px', minWidth: 110 }}>
        <ScoreBar value={stock.live_score ?? stock.composite_score} />
      </td>
      <td style={{ padding: '8px 10px', minWidth: 100 }}>
        <ScoreBar value={stock.fundamental_score} />
      </td>
      <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text-secondary)' }}>
        {stock.rsi != null ? Number(stock.rsi).toFixed(0) : '—'}
      </td>
      <td style={{ padding: '8px 10px' }}>
        <SignalBadge signal={stock.signal} />
      </td>
      <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--accent-green)' }}>
        {stock.entry_zone || '—'}
      </td>
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function LiveCommandCenter({ onSelectStock }) {
  const [top20, setTop20]             = useState([]);
  const [signalFeed, setSignalFeed]   = useState([]);
  const [connected, setConnected]     = useState(false);
  const [marketStatus, setMarketStatus] = useState('unknown');
  const [lastTs, setLastTs]           = useState(null);
  const [growwOk, setGrowwOk]         = useState(false);
  const [priceSource, setPriceSource] = useState('yfinance');
  const [trackedCount, setTrackedCount] = useState(0);
  const prevLtpRef = useRef({});       // symbol → previous ltp for flash

  // Initial REST fetch
  useEffect(() => {
    api.getLiveState?.()
      .then(s => {
        if (s?.live_top20?.length)  setTop20(s.live_top20);
        if (s?.signal_feed?.length) setSignalFeed(s.signal_feed);
        if (s?.market_status)       setMarketStatus(s.market_status);
        if (s?.groww_ok != null)    setGrowwOk(s.groww_ok);
        if (s?.price_source)        setPriceSource(s.price_source);
        if (s?.stocks_tracked)      setTrackedCount(s.stocks_tracked);
      })
      .catch(() => {});

    api.getLiveSignalFeed?.()
      .then(feed => { if (Array.isArray(feed)) setSignalFeed(feed); })
      .catch(() => {});
  }, []);

  // WebSocket
  useEffect(() => {
    function onConnect()    { setConnected(true); }
    function onDisconnect() { setConnected(false); }

    function onPriceUpdate(data) {
      if (!data?.stocks) return;
      if (data.market_status) setMarketStatus(data.market_status);
      if (data.ts) setLastTs(data.ts);

      setTop20(prev => prev.map(s => {
        const clean = s.symbol?.replace('.NS', '');
        const update = data.stocks[clean] || data.stocks[s.symbol];
        if (!update) return s;
        prevLtpRef.current[s.symbol] = s.ltp;
        return { ...s, ltp: update.ltp, change_pct: update.change_pct };
      }));
    }

    function onSignalChange(event) {
      setSignalFeed(prev => [event, ...prev].slice(0, 40));
      // Also update signal in top20
      setTop20(prev => prev.map(s => {
        if (s.symbol?.replace('.NS', '') === event.symbol) {
          return { ...s, signal: event.new_signal, rsi: event.rsi };
        }
        return s;
      }));
    }

    function onTop20Update(data) {
      if (data?.top20?.length) {
        setTop20(data.top20);
      }
    }

    function onEngineStatus(data) {
      if (data?.groww_ok != null)    setGrowwOk(data.groww_ok);
      if (data?.stocks_tracked)      setTrackedCount(data.stocks_tracked);
      if (data?.price_source)        setPriceSource(data.price_source);
    }

    socket.on('connect',       onConnect);
    socket.on('disconnect',    onDisconnect);
    socket.on('price_update',  onPriceUpdate);
    socket.on('signal_change', onSignalChange);
    socket.on('top20_update',  onTop20Update);
    socket.on('engine_status', onEngineStatus);
    setConnected(socket.connected);

    return () => {
      socket.off('connect',       onConnect);
      socket.off('disconnect',    onDisconnect);
      socket.off('price_update',  onPriceUpdate);
      socket.off('signal_change', onSignalChange);
      socket.off('top20_update',  onTop20Update);
      socket.off('engine_status', onEngineStatus);
    };
  }, []);

  const isOpen = marketStatus === 'open';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Status bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '12px 20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 10, height: 10, borderRadius: '50%',
            background: connected ? 'var(--accent-green)' : 'var(--accent-red)',
            boxShadow: connected ? '0 0 8px var(--accent-green)' : 'none',
            display: 'inline-block',
            animation: connected ? 'pulse 2s infinite' : 'none',
          }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: connected ? 'var(--accent-green)' : 'var(--accent-red)' }}>
            {connected ? 'LIVE' : 'DISCONNECTED'}
          </span>
        </div>

        <div style={{ color: 'var(--border)', fontSize: 14 }}>|</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: isOpen ? 'var(--accent-green)' : 'var(--text-muted)',
            display: 'inline-block',
          }} />
          <span style={{ fontSize: 12, color: isOpen ? 'var(--accent-green)' : 'var(--text-muted)' }}>
            {isOpen ? 'NSE OPEN' : 'NSE CLOSED'}
          </span>
        </div>

        <div style={{ color: 'var(--border)', fontSize: 14 }}>|</div>

        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Data:{' '}
          <span style={{
            fontWeight: 600,
            color: priceSource === 'groww'   ? 'var(--accent-cyan)'
                 : priceSource === 'nse'     ? 'var(--accent-green)'
                 :                             'var(--accent-yellow)',
          }}>
            {priceSource === 'groww'   ? 'Groww API'
           : priceSource === 'nse'     ? 'NSE India (free)'
           :                             'yfinance'}
          </span>
        </span>

        <div style={{ color: 'var(--border)', fontSize: 14 }}>|</div>

        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Tracking <strong style={{ color: 'var(--text-primary)' }}>{trackedCount}</strong> stocks
        </span>

        {lastTs && (
          <>
            <div style={{ color: 'var(--border)', fontSize: 14 }}>|</div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Updated {lastTs}</span>
          </>
        )}

        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
          Prices every 10s · Signals every 30s · Re-rank every 5min
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, alignItems: 'start' }}>

        {/* ── Live Top-20 ── */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>AI Live Top 20</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-secondary)', borderRadius: 4, padding: '2px 8px' }}>
              Live Score = 80% Fundamental + 20% Live Technical
            </span>
            {!isOpen && (
              <span style={{ fontSize: 11, color: 'var(--accent-yellow)', marginLeft: 'auto' }}>
                Market closed — showing last session data
              </span>
            )}
          </div>

          {top20.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              {connected
                ? 'Waiting for live engine to populate…\nRun the pipeline first to build the stock universe.'
                : 'Connecting to live engine…'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)' }}>
                    {['#', 'Stock', 'LTP', 'Day %', 'Live Score', 'Fund', 'RSI', 'Signal', 'Entry'].map(h => (
                      <th key={h} style={{
                        padding: '8px 10px', textAlign: 'left', fontWeight: 600,
                        color: 'var(--text-secondary)', fontSize: 11,
                        borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {top20.map((s, i) => (
                    <LiveRow
                      key={s.symbol}
                      stock={s}
                      rank={i + 1}
                      onSelect={onSelectStock}
                      prevLtp={prevLtpRef.current[s.symbol]}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Signal Feed ── */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Signal Feed</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {signalFeed.length} events
            </span>
          </div>

          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 620, overflowY: 'auto' }}>
            {signalFeed.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                No signal changes yet.<br />
                <span style={{ fontSize: 11, opacity: 0.6 }}>Changes appear here as they happen.</span>
              </div>
            ) : (
              signalFeed.map((e, i) => <SignalCard key={i} event={e} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
