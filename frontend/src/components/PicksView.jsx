import { useState } from 'react';
import Top20Table from './Top20Table';
import MultibaggerView from './MultibaggerView';
import Intrinsic20View from './Intrinsic20View';

const TABS = [
  { id: 'top20',       label: 'Top 20',      desc: 'Highest-ranked stocks by composite score' },
  { id: 'multibagger', label: 'Multibagger',  desc: 'Long-term wealth compounders' },
  { id: 'intrinsic20', label: 'Intrinsic 20', desc: 'Undervalued picks by DCF analysis' },
];

export default function PicksView({ onSelectStock }) {
  const [tab, setTab] = useState('top20');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderBottom: '1px solid #1e293b', background: 'var(--bg-primary, #0b1120)' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            title={t.desc}
            style={{
              padding: '5px 16px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 13,
              background: tab === t.id ? '#22d3ee' : '#1e293b',
              color: tab === t.id ? '#000' : '#94a3b8',
              fontWeight: tab === t.id ? 700 : 400,
              transition: 'all 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
        <span style={{ marginLeft: 8, fontSize: 11, color: '#475569' }}>
          {TABS.find(t => t.id === tab)?.desc}
        </span>
      </div>

      {tab === 'top20'       && <Top20Table onSelectStock={onSelectStock} />}
      {tab === 'multibagger' && <MultibaggerView />}
      {tab === 'intrinsic20' && <Intrinsic20View />}
    </div>
  );
}
