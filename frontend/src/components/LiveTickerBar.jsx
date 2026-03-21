import { useState, useEffect, useRef } from 'react';
import socket from '../socket';
import { api } from '../api';

const fmt = n => n != null ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—';
const fmtPct = n => n != null ? `${n >= 0 ? '+' : ''}${Number(n).toFixed(2)}%` : '';

function IndexPill({ name, price, change_pct, prev }) {
  const [flash, setFlash] = useState(null); // 'up' | 'down' | null

  useEffect(() => {
    if (prev == null || price == null || price === prev) return;
    const dir = price > prev ? 'up' : 'down';
    setFlash(dir);
    const t = setTimeout(() => setFlash(null), 800);
    return () => clearTimeout(t);
  }, [price]);

  const isUp = change_pct >= 0;
  const color = isUp ? 'var(--accent-green)' : 'var(--accent-red)';

  return (
    <div className="ticker-pill" style={{
      transition: 'background 0.3s',
      background: flash === 'up'   ? 'rgba(74,222,128,0.12)' :
                  flash === 'down' ? 'rgba(248,113,113,0.12)' : 'transparent',
    }}>
      <span className="ticker-name">{name}</span>
      <span className="ticker-price" style={{ color: flash ? color : 'var(--text-primary)' }}>
        {fmt(price)}
      </span>
      {change_pct != null && (
        <span className="ticker-chg" style={{ color }}>
          {fmtPct(change_pct)}
        </span>
      )}
    </div>
  );
}

export default function LiveTickerBar() {
  const [indices, setIndices]           = useState({});
  const [prevPrices, setPrevPrices]     = useState({});
  const [marketStatus, setMarketStatus] = useState('unknown');
  const [connected, setConnected]       = useState(false);
  const [lastTs, setLastTs]             = useState(null);

  // Bootstrap: fetch initial state from REST
  useEffect(() => {
    api.getLiveState?.()
      .then(s => {
        if (s?.indices) setIndices(s.indices);
        if (s?.market_status) setMarketStatus(s.market_status);
      })
      .catch(() => {});
  }, []);

  // WebSocket listeners
  useEffect(() => {
    function onConnect()    { setConnected(true); }
    function onDisconnect() { setConnected(false); }

    function onPriceUpdate(data) {
      if (!data?.indices) return;
      setIndices(prev => {
        const next = { ...prev };
        // capture prev prices for flash
        const prevSnap = {};
        Object.entries(data.indices).forEach(([name, d]) => {
          prevSnap[name] = prev[name]?.price;
          next[name] = d;
        });
        setPrevPrices(prevSnap);
        return next;
      });
      if (data.market_status) setMarketStatus(data.market_status);
      if (data.ts) setLastTs(data.ts);
    }

    socket.on('connect',      onConnect);
    socket.on('disconnect',   onDisconnect);
    socket.on('price_update', onPriceUpdate);
    setConnected(socket.connected);

    return () => {
      socket.off('connect',      onConnect);
      socket.off('disconnect',   onDisconnect);
      socket.off('price_update', onPriceUpdate);
    };
  }, []);

  const isOpen = marketStatus === 'open';

  return (
    <div className="live-ticker-bar">
      {/* Market status */}
      <div className="ticker-status">
        <span className={`ticker-dot ${isOpen ? 'dot-open' : 'dot-closed'}`} />
        <span className="ticker-status-text">{isOpen ? 'MARKET OPEN' : 'MARKET CLOSED'}</span>
      </div>

      <div className="ticker-divider" />

      {/* Index pills */}
      <div className="ticker-indices">
        {Object.entries(indices).length === 0 ? (
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Loading indices…</span>
        ) : (
          Object.entries(indices).map(([name, d]) => (
            <IndexPill
              key={name}
              name={name}
              price={d.price}
              change_pct={d.change_pct}
              prev={prevPrices[name]}
            />
          ))
        )}
      </div>

      <div className="ticker-divider" />

      {/* WS indicator */}
      <div className="ticker-ws">
        <span className={`ticker-dot ${connected ? 'dot-live' : 'dot-off'}`} />
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {connected ? `LIVE${lastTs ? ` · ${lastTs}` : ''}` : 'connecting…'}
        </span>
      </div>
    </div>
  );
}
