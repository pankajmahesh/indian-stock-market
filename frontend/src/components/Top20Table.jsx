import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { api } from '../api';
import ScreenshotButton from './ScreenshotButton';
import RunPipelineButton from './RunPipelineButton';

function ScoreBadge({ value }) {
  if (value == null) return <span className="score-badge score-low">N/A</span>;
  const v = Number(value);
  const cls = v >= 70 ? 'score-high' : v >= 50 ? 'score-mid' : 'score-low';
  return <span className={`score-badge ${cls}`}>{v.toFixed(1)}</span>;
}

// Minervini Trend Template badge: shows X/8 conditions met
function TTBadge({ conditions }) {
  if (conditions == null) return <span style={{ color: '#475569', fontSize: 11 }}>—</span>;
  const n = Number(conditions);
  const color = n >= 7 ? '#22c55e' : n >= 5 ? '#eab308' : n >= 3 ? '#f97316' : '#ef4444';
  const label = n >= 6 ? 'Stage 2' : n >= 4 ? 'Emerging' : 'Weak';
  return (
    <span title={`Trend Template: ${n}/8 conditions met. ${label}`} style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 6px', borderRadius: 5, fontSize: 11, fontWeight: 700,
      background: `${color}18`, color, border: `1px solid ${color}33`,
      cursor: 'default',
    }}>
      {n}<span style={{ fontSize: 9, opacity: 0.7 }}>/8</span>
    </span>
  );
}

// VCP (Volatility Contraction Pattern) badge
function VCPBadge({ score }) {
  if (score == null) return <span style={{ color: '#475569', fontSize: 11 }}>—</span>;
  const v = Number(score);
  const color = v >= 9 ? '#22c55e' : v >= 6 ? '#eab308' : '#64748b';
  const label = v >= 9 ? 'VCP' : v >= 6 ? 'Partial' : '';
  if (!label) return <span style={{ color: '#475569', fontSize: 11 }}>—</span>;
  return (
    <span title={`VCP score: ${v}/10`} style={{
      padding: '2px 6px', borderRadius: 5, fontSize: 10, fontWeight: 700,
      background: `${color}18`, color, border: `1px solid ${color}33`,
    }}>
      {label}
    </span>
  );
}

function LCatBadge({ cat }) {
  if (!cat) return null;
  const colors = { L1: '#22c55e', L2: '#f59e0b', L3: '#ef4444' };
  const color = colors[cat] || '#94a3b8';
  return (
    <span style={{ marginLeft: 4, fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 4, background: `${color}22`, color, border: `1px solid ${color}44` }}>
      {cat}
    </span>
  );
}

function parseEntryZone(ez) {
  if (!ez) return null;
  const parts = String(ez).split('-').map(s => parseFloat(s.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return { low: parts[0], high: parts[1] };
  return null;
}

function inEntryZone(cmp, entry_zone) {
  const ez = parseEntryZone(entry_zone);
  if (!ez || !cmp) return false;
  return cmp >= ez.low && cmp <= ez.high;
}

function belowEntryZone(cmp, entry_zone) {
  const ez = parseEntryZone(entry_zone);
  if (!ez || !cmp) return false;
  return cmp < ez.low;
}

const REFRESH_MS = 60_000; // refresh live prices every 60s

export default function Top20Table({ onSelectStock }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState('rank');
  const [sortAsc, setSortAsc] = useState(true);
  const [search, setSearch] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const containerRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    api.getTop20()
      .then(d => setData(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const refreshPrices = useCallback(() => {
    setRefreshing(true);
    api.getTop20LivePrices()
      .then(prices => {
        if (prices && typeof prices === 'object' && !prices.error) {
          let updated = 0;
          setData(prev => prev.map(row => {
            const sym = (row.symbol || '').replace('.NS', '');
            const live = prices[sym] || prices[row.symbol];
            if (!live || live.cmp == null) return row;  // keep CSV cmp if live unavailable
            updated++;
            return {
              ...row,
              cmp: live.cmp,
              change_pct: live.change_pct ?? row.change_pct,
              cmp_live: true,
            };
          }));
          if (updated > 0) setLastRefresh(new Date());
        }
      })
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, []);

  // Auto-refresh every 60s after initial data loads
  useEffect(() => {
    if (data.length === 0) return;
    refreshPrices(); // immediate first refresh
    timerRef.current = setInterval(refreshPrices, REFRESH_MS);
    return () => clearInterval(timerRef.current);
  }, [data.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearInterval(timerRef.current), []);

  const sorted = useMemo(() => {
    let rows = [...data];
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        (r.symbol || '').toLowerCase().includes(q) ||
        (r.name || '').toLowerCase().includes(q) ||
        (r.sector || '').toLowerCase().includes(q)
      );
    }
    rows.sort((a, b) => {
      // Always float in-zone stocks to top (unless user is sorting by something else)
      if (sortKey === 'rank') {
        const aIn = inEntryZone(a.cmp, a.entry_zone);
        const bIn = inEntryZone(b.cmp, b.entry_zone);
        if (aIn !== bIn) return aIn ? -1 : 1;
      }
      let va = a[sortKey], vb = b[sortKey];
      if (typeof va === 'string') return sortAsc ? va.localeCompare(vb || '') : (vb || '').localeCompare(va);
      return sortAsc ? (va || 0) - (vb || 0) : (vb || 0) - (va || 0);
    });
    return rows;
  }, [data, sortKey, sortAsc, search]);

  function toggleSort(key) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === 'rank'); }
  }

  if (loading) return <div className="loading"><div className="spinner" /> Loading...</div>;

  return (
    <div className="card" ref={containerRef}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Top 20 Stock Picks — Detailed View</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <RunPipelineButton label="Run Pipeline" onDone={() => api.getTop20().then(d => setData(Array.isArray(d) ? d : []))} />
          {lastRefresh && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              CMP updated {lastRefresh.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={refreshPrices} disabled={refreshing}
            style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: refreshing ? 'var(--text-muted)' : 'var(--accent-blue)', cursor: refreshing ? 'wait' : 'pointer', fontSize: 11, fontWeight: 600 }}
          >
            {refreshing ? '↻ Refreshing...' : '↻ Refresh CMP'}
          </button>
          <ScreenshotButton targetRef={containerRef} filename="top20-stocks" />
        </div>
      </div>
      <div className="filter-bar">
        <input placeholder="Search symbol, name, sector..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 280 }} />
      </div>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              {[
                ['rank', '#'], ['symbol', 'Symbol'], ['name', 'Company'], ['sector', 'Sector'],
                ['change_pct', 'Chg %'], ['market_cap_cr', 'MCap (Cr)'], ['promoter_holding_pct', 'Promoter %'],
                ['final_score', 'Final'], ['fundamental_score', 'Fund.'], ['technical_score', 'Tech.'],
                ['tech_trend_template', 'TT /8'], ['tech_vcp', 'VCP'],
                ['qualitative_score', 'Qual.'], ['qual_strategy_alignment', 'Strategy ↑'], ['composite_score', 'Composite'],
                ['entry_zone', 'Entry Zone'], ['cmp', 'CMP (₹)'], ['stop_loss', 'Stop Loss'], ['target', 'Target'],
              ].map(([key, label]) => (
                <th key={key} onClick={() => toggleSort(key)}>
                  {label} {sortKey === key ? (sortAsc ? '↑' : '↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((s, i) => {
              const isIn = inEntryZone(s.cmp, s.entry_zone);
              const isBelow = belowEntryZone(s.cmp, s.entry_zone);
              return (
                <tr key={s.symbol} className="clickable" onClick={() => onSelectStock(s.symbol)}
                  style={isIn ? { background: 'rgba(34,197,94,0.06)', borderLeft: '3px solid #22c55e' } : isBelow ? { borderLeft: '3px solid #3b82f6' } : {}}>
                  <td>{s.rank || i + 1}</td>
                  <td style={{ fontWeight: 600, color: 'var(--accent-blue)' }}>
                    {s.symbol?.replace('.NS', '')}
                    <LCatBadge cat={s.l_category} />
                    {isIn && <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#22c55e22', color: '#22c55e' }}>IN ZONE</span>}
                    {isBelow && <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#3b82f622', color: '#3b82f6' }}>BELOW</span>}
                  </td>
                  <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{s.sector}</td>
                  <td style={{ color: (s.change_pct || 0) >= 0 ? '#22c55e' : '#ef4444', fontWeight: 600, fontSize: 12 }}>
                    {s.change_pct != null ? `${s.change_pct >= 0 ? '+' : ''}${s.change_pct}%` : '--'}
                  </td>
                  <td>{Number(s.market_cap_cr || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                  <td style={{ fontSize: 12 }}>{s.promoter_holding_pct != null ? `${s.promoter_holding_pct}%` : '--'}</td>
                  <td><ScoreBadge value={s.final_score} /></td>
                  <td><ScoreBadge value={s.fundamental_score} /></td>
                  <td><ScoreBadge value={s.technical_score} /></td>
                  <td><TTBadge conditions={s.tech_trend_template} /></td>
                  <td><VCPBadge score={s.tech_vcp} /></td>
                  <td><ScoreBadge value={s.qualitative_score} /></td>
                  <td><ScoreBadge value={s.qual_strategy_alignment} /></td>
                  <td><ScoreBadge value={s.composite_score} /></td>
                  <td style={{ color: 'var(--accent-cyan)', fontSize: 12 }}>₹{s.entry_zone}</td>
                  <td style={{ fontWeight: isIn ? 700 : 400, color: isIn ? '#22c55e' : isBelow ? '#3b82f6' : 'var(--text-primary)' }}>
                    {s.cmp != null ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        ₹{Number(s.cmp).toLocaleString('en-IN', { maximumFractionDigits: 1 })}
                        <span title={s.cmp_live ? 'Live price' : 'Pipeline price (stale)'} style={{
                          width: 5, height: 5, borderRadius: '50%',
                          background: s.cmp_live ? '#22c55e' : '#f59e0b',
                          display: 'inline-block', flexShrink: 0,
                        }} />
                      </span>
                    ) : '--'}
                  </td>
                  <td style={{ color: 'var(--accent-red)', fontSize: 12 }}>₹{s.stop_loss}</td>
                  <td style={{ color: 'var(--accent-green)', fontSize: 12 }}>₹{s.target}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sorted.length === 0 && <div className="empty-state"><h3>No stocks found</h3></div>}

      {/* Bandhan AMC Portfolio Balance */}
      {data.length > 0 && (() => {
        const counts = data.reduce((acc, s) => { acc[s.l_category || 'L2'] = (acc[s.l_category || 'L2'] || 0) + 1; return acc; }, {});
        const total = data.length;
        const l1 = counts.L1 || 0, l2 = counts.L2 || 0, l3 = counts.L3 || 0;
        const l1pct = Math.round(l1 / total * 100), l2pct = Math.round(l2 / total * 100), l3pct = Math.round(l3 / total * 100);
        return (
          <div style={{ marginTop: 20, padding: '14px 18px', borderRadius: 10, background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10, letterSpacing: '0.05em' }}>
              PORTFOLIO BALANCE — Bandhan AMC Strategy
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              {[['L1', l1, l1pct, '#22c55e', 'High Quality'], ['L2', l2, l2pct, '#f59e0b', 'Mid Quality'], ['L3', l3, l3pct, '#ef4444', 'Cyclical']].map(([cat, n, pct, color, label]) => (
                <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 8, background: `${color}11`, border: `1px solid ${color}33` }}>
                  <span style={{ fontWeight: 700, color, fontSize: 13 }}>{cat}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
                  <span style={{ fontWeight: 700, color, fontSize: 15 }}>{n}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({pct}%)</span>
                </div>
              ))}
              {l1pct > 70 && <span style={{ fontSize: 11, color: '#f59e0b' }}>⚠ Heavy L1 — consider selective cyclical exposure</span>}
              {l3pct > 40 && <span style={{ fontSize: 11, color: '#ef4444' }}>⚠ High L3 cyclical exposure — ensure cycle timing is right</span>}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
