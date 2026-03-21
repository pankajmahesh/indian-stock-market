import { useState, useEffect, useMemo } from 'react';
import { api } from '../api';

function ScoreBadge({ value }) {
  if (value == null) return <span className="score-badge score-low">N/A</span>;
  const v = Number(value);
  const cls = v >= 70 ? 'score-high' : v >= 50 ? 'score-mid' : 'score-low';
  return <span className={`score-badge ${cls}`}>{v.toFixed(1)}</span>;
}

export default function CompositeView({ onSelectStock }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sectorFilter, setSectorFilter] = useState('ALL');
  const [sortKey, setSortKey] = useState('composite_score');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    api.getComposite()
      .then(d => setData(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const sectors = useMemo(() => {
    const s = new Set(data.map(d => d.sector).filter(Boolean));
    return ['ALL', ...Array.from(s).sort()];
  }, [data]);

  const filtered = useMemo(() => {
    let rows = [...data];
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        (r.symbol || '').toLowerCase().includes(q) ||
        (r.name || '').toLowerCase().includes(q)
      );
    }
    if (sectorFilter !== 'ALL') {
      rows = rows.filter(r => r.sector === sectorFilter);
    }
    rows.sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (typeof va === 'string') return sortAsc ? va.localeCompare(vb || '') : (vb || '').localeCompare(va);
      return sortAsc ? (va || 0) - (vb || 0) : (vb || 0) - (va || 0);
    });
    return rows;
  }, [data, search, sectorFilter, sortKey, sortAsc]);

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  function toggleSort(key) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  }

  if (loading) return <div className="loading"><div className="spinner" /> Loading all stocks...</div>;

  return (
    <div className="card">
      <h2>All Ranked Stocks ({filtered.length} total)</h2>
      <div className="filter-bar">
        <input placeholder="Search symbol or name..." value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} style={{ width: 250 }} />
        <select value={sectorFilter} onChange={e => { setSectorFilter(e.target.value); setPage(0); }}>
          {sectors.map(s => <option key={s} value={s}>{s === 'ALL' ? 'All Sectors' : s}</option>)}
        </select>
        <span style={{ color: 'var(--text-muted)', fontSize: 12, alignSelf: 'center' }}>
          Page {page + 1}/{totalPages || 1}
          {page > 0 && <button className="nav-tab" onClick={() => setPage(p => p - 1)} style={{ marginLeft: 8 }}>Prev</button>}
          {page < totalPages - 1 && <button className="nav-tab" onClick={() => setPage(p => p + 1)} style={{ marginLeft: 4 }}>Next</button>}
        </span>
      </div>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              {[
                ['composite_rank', 'Rank'], ['symbol', 'Symbol'], ['name', 'Name'],
                ['sector', 'Sector'], ['market_cap', 'MCap'],
                ['composite_score', 'Composite'], ['fundamental_score', 'Fund.'],
                ['technical_score', 'Tech.'], ['fundamental_rank', 'F.Rank'],
                ['technical_rank', 'T.Rank'], ['data_quality', 'Quality'],
              ].map(([key, label]) => (
                <th key={key} onClick={() => toggleSort(key)}>
                  {label} {sortKey === key ? (sortAsc ? '↑' : '↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map(s => (
              <tr key={s.symbol} className="clickable" onClick={() => onSelectStock(s.symbol)}>
                <td>{s.composite_rank}</td>
                <td style={{ fontWeight: 600, color: 'var(--accent-blue)' }}>{s.symbol?.replace('.NS', '')}</td>
                <td style={{ color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</td>
                <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{s.sector}</td>
                <td>{s.market_cap ? `₹${(s.market_cap / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr` : 'N/A'}</td>
                <td><ScoreBadge value={s.composite_score} /></td>
                <td><ScoreBadge value={s.fundamental_score} /></td>
                <td><ScoreBadge value={s.technical_score} /></td>
                <td style={{ color: 'var(--text-muted)' }}>{s.fundamental_rank}</td>
                <td style={{ color: 'var(--text-muted)' }}>{s.technical_rank}</td>
                <td>
                  <span className={`score-badge ${s.data_quality === 'HIGH' ? 'score-high' : s.data_quality === 'MEDIUM' ? 'score-mid' : 'score-low'}`}>
                    {s.data_quality || 'N/A'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {paged.length === 0 && <div className="empty-state"><h3>No stocks match your filters</h3></div>}
    </div>
  );
}
