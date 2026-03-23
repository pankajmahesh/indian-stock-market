import { useState } from 'react';
import { api } from '../api';
import IndexPredictionView from './IndexPredictionView';
import VolumeBreakoutView from './VolumeBreakoutView';
import BreakoutView from './BreakoutView';
import SignalsView from './SignalsView';
import MarketDipView from './MarketDipView';

const INDICES = [
  {
    key: 'midcap150', label: 'Midcap 150',
    title: 'Nifty Midcap 150',
    description: 'Scans all Nifty Midcap 150 stocks with real-time CMP and price predictions (7/30/90 day targets).',
    apiGet: api.getMidcap150, apiScan: api.scanMidcap150,
    apiStatus: api.getMidcap150Status, apiLive: api.getMidcap150Live,
  },
  {
    key: 'largemidcap250', label: 'LargeMidcap 250',
    title: 'Nifty LargeMidcap 250',
    description: 'Scans all Nifty LargeMidcap 250 stocks with real-time CMP and price predictions (7/30/90 day targets).',
    apiGet: api.getLargemidcap250, apiScan: api.scanLargemidcap250,
    apiStatus: api.getLargemidcap250Status, apiLive: api.getLargemidcap250Live,
  },
  {
    key: 'smallcap250', label: 'Smallcap 250',
    title: 'Nifty Smallcap 250',
    description: 'Scans all Nifty Smallcap 250 stocks with real-time CMP and price predictions (7/30/90 day targets).',
    apiGet: api.getSmallcap250, apiScan: api.scanSmallcap250,
    apiStatus: api.getSmallcap250Status, apiLive: api.getSmallcap250Live,
  },
];

const TABS = [
  { id: 'index',    label: 'Index Screener', desc: 'Price predictions across Midcap/LargeMidcap/Smallcap indices' },
  { id: 'breakout', label: 'Breakouts',      desc: 'Volume breakouts and 52-week high breakouts' },
  { id: 'signals',  label: 'Live Signals',   desc: 'Real-time BUY/SELL/HOLD signals' },
  { id: 'dip',      label: 'Dip Scanner',    desc: 'Quality stocks at a discount' },
];

const BREAKOUT_TYPES = [
  { id: 'vol',  label: 'Volume Breakout' },
  { id: '52w',  label: '52W High Breakout' },
];

function SubTabBar({ tabs, active, onChange, extra }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderBottom: '1px solid #1e293b', background: 'var(--bg-primary, #0b1120)', flexWrap: 'wrap' }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          title={t.desc}
          style={{
            padding: '5px 16px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 13,
            background: active === t.id ? '#22d3ee' : '#1e293b',
            color: active === t.id ? '#000' : '#94a3b8',
            fontWeight: active === t.id ? 700 : 400,
            transition: 'all 0.15s',
          }}
        >
          {t.label}
        </button>
      ))}
      {extra && <div style={{ marginLeft: 'auto' }}>{extra}</div>}
      <span style={{ fontSize: 11, color: '#475569', marginLeft: extra ? 0 : 8 }}>
        {tabs.find(t => t.id === active)?.desc}
      </span>
    </div>
  );
}

export default function ScreenerView({ onSelectStock }) {
  const [tab, setTab]               = useState('index');
  const [selectedIndex, setIndex]   = useState('midcap150');
  const [breakoutType, setBreakout] = useState('vol');

  const indexCfg = INDICES.find(i => i.key === selectedIndex);

  return (
    <div>
      <SubTabBar tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'index' && (
        <div>
          {/* Index picker */}
          <div style={{ display: 'flex', gap: 6, padding: '8px 16px', background: '#0f172a', borderBottom: '1px solid #1e293b' }}>
            {INDICES.map(idx => (
              <button
                key={idx.key}
                onClick={() => setIndex(idx.key)}
                style={{
                  padding: '3px 12px', borderRadius: 4, border: `1px solid ${selectedIndex === idx.key ? '#22d3ee' : '#334155'}`,
                  background: selectedIndex === idx.key ? 'rgba(34,211,238,0.1)' : 'transparent',
                  color: selectedIndex === idx.key ? '#22d3ee' : '#64748b',
                  cursor: 'pointer', fontSize: 12, fontWeight: selectedIndex === idx.key ? 700 : 400,
                }}
              >
                {idx.label}
              </button>
            ))}
          </div>
          <IndexPredictionView
            key={selectedIndex}
            title={indexCfg.title}
            description={indexCfg.description}
            apiGet={indexCfg.apiGet}
            apiScan={indexCfg.apiScan}
            apiStatus={indexCfg.apiStatus}
            apiLive={indexCfg.apiLive}
          />
        </div>
      )}

      {tab === 'breakout' && (
        <div>
          <div style={{ display: 'flex', gap: 6, padding: '8px 16px', background: '#0f172a', borderBottom: '1px solid #1e293b' }}>
            {BREAKOUT_TYPES.map(bt => (
              <button
                key={bt.id}
                onClick={() => setBreakout(bt.id)}
                style={{
                  padding: '3px 12px', borderRadius: 4, border: `1px solid ${breakoutType === bt.id ? '#a78bfa' : '#334155'}`,
                  background: breakoutType === bt.id ? 'rgba(167,139,250,0.1)' : 'transparent',
                  color: breakoutType === bt.id ? '#a78bfa' : '#64748b',
                  cursor: 'pointer', fontSize: 12, fontWeight: breakoutType === bt.id ? 700 : 400,
                }}
              >
                {bt.label}
              </button>
            ))}
          </div>
          {breakoutType === 'vol' && <VolumeBreakoutView />}
          {breakoutType === '52w' && <BreakoutView onSelectStock={onSelectStock} />}
        </div>
      )}

      {tab === 'signals' && <SignalsView onSelectStock={onSelectStock} />}
      {tab === 'dip'     && <MarketDipView onSelectStock={onSelectStock} />}
    </div>
  );
}
