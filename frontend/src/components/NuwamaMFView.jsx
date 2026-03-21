import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';

/* ─── Sync Modal ──────────────────────────────────────────────────────────── */
function SyncModal({ onClose, onSynced }) {
  const dropRef = useRef(null);
  const fileInputRef = useRef(null);
  const [pan, setPan] = useState('');
  const [dob, setDob] = useState('');
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState(null);   // null | 'processing' | { ok, text, hint }

  const processPdf = useCallback(async (file) => {
    if (!file?.name?.endsWith('.pdf')) {
      setStatus({ ok: false, text: 'Select the CAS PDF file downloaded from MF Central.' });
      return;
    }
    if (!pan || pan.length !== 10) {
      setStatus({ ok: false, text: 'Enter your 10-character PAN first.' });
      return;
    }
    if (!dob || dob.length !== 8) {
      setStatus({ ok: false, text: 'Enter your Date of Birth in DDMMYYYY format.' });
      return;
    }
    setStatus('processing');
    try {
      const result = await api.importCams(file, { pan, dob, portfolio: 'main' });
      setStatus({
        ok: true,
        text: `${result.scheme_count} schemes synced · ₹${(result.total_value / 1e5).toFixed(2)}L · ${result.total_gain_pct >= 0 ? '+' : ''}${result.total_gain_pct?.toFixed(2)}% return`,
      });
      onSynced();
    } catch (err) {
      setStatus({ ok: false, text: err.message, hint: err.hint });
    }
  }, [pan, dob, onSynced]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    processPdf(e.dataTransfer?.files?.[0]);
  }, [processPdf]);

  const done = status?.ok;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: '92vw', maxWidth: 560, background: 'var(--bg-primary)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Sync MF Holdings</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Step 1 — Get the PDF */}
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8, color: 'var(--text-secondary)' }}>
              Step 1 — Download your CAS PDF
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.6 }}>
              Visit MF Central and download your Consolidated Account Statement (Summary CAS).
              The PDF will be in your Downloads folder.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <a
                href="https://mfc-cas.mfcentral.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ padding: '7px 14px', borderRadius: 7, background: 'var(--accent-blue)', color: '#fff', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}
              >
                Open MF Central ↗
              </a>
              <a
                href="mailto:casservice@camsonline.com?subject=SUMMARY"
                style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}
              >
                Request via Email (CAMS)
              </a>
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
              PDF password = PAN + Date of Birth (DDMMYYYY) — e.g. ABCDE1234F05011990
            </div>
          </div>

          {/* Step 2 — PAN + DOB */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8, color: 'var(--text-secondary)' }}>
              Step 2 — Enter PDF password details
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text" placeholder="PAN  e.g. ABCDE1234F"
                value={pan} onChange={e => setPan(e.target.value.toUpperCase())} maxLength={10}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 12 }}
              />
              <input
                type="text" placeholder="DOB  DDMMYYYY"
                value={dob} onChange={e => setDob(e.target.value.replace(/\D/g, ''))} maxLength={8}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 12 }}
              />
            </div>
          </div>

          {/* Step 3 — Drop zone */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8, color: 'var(--text-secondary)' }}>
              Step 3 — Drop the CAS PDF here
            </div>
            {done ? (
              <div style={{ textAlign: 'center', padding: '28px 20px', background: 'rgba(34,197,94,0.08)', borderRadius: 10, border: '1px solid rgba(34,197,94,0.3)' }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
                <div style={{ fontWeight: 700, color: 'var(--accent-green)', marginBottom: 4 }}>Sync complete</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{status.text}</div>
                <button
                  onClick={onClose}
                  style={{ marginTop: 14, padding: '8px 22px', borderRadius: 8, border: 'none', background: 'var(--accent-green)', color: '#fff', cursor: 'pointer', fontWeight: 700 }}
                >
                  View Holdings
                </button>
              </div>
            ) : (
              <>
                <div
                  ref={dropRef}
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    padding: '36px 20px', border: `2px dashed ${dragging ? 'var(--accent-blue)' : 'var(--border)'}`,
                    borderRadius: 10, textAlign: 'center', cursor: 'pointer',
                    background: dragging ? 'rgba(59,130,246,0.08)' : 'var(--bg-secondary)',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                    {status === 'processing' ? 'Parsing...' : 'Drop CAS PDF here'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>or click to select file</div>
                </div>
                <input
                  ref={fileInputRef} type="file" accept=".pdf" style={{ display: 'none' }}
                  onChange={e => { processPdf(e.target.files?.[0]); e.target.value = ''; }}
                />
                {status && status !== 'processing' && !status.ok && (
                  <div style={{ marginTop: 10, fontSize: 12, padding: '8px 12px', borderRadius: 7, background: 'rgba(239,68,68,0.08)', color: 'var(--accent-red)' }}>
                    {status.text}
                    {status.hint && <div style={{ marginTop: 4, color: 'var(--text-muted)' }}>{status.hint}</div>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Main View ───────────────────────────────────────────────────────────── */
export default function NuwamaMFView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSync, setShowSync] = useState(false);
  const [sortCol, setSortCol] = useState('value');
  const [sortAsc, setSortAsc] = useState(false);

  const load = () => {
    setLoading(true);
    api.getMfHoldings('main')
      .then(d => setData(d?.schemes?.length ? d : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(a => !a);
    else { setSortCol(col); setSortAsc(false); }
  };

  const sorted = data?.schemes ? [...data.schemes].sort((a, b) => {
    const av = a[sortCol] ?? 0, bv = b[sortCol] ?? 0;
    return sortAsc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  }) : [];

  const SortTh = ({ col, label, right }) => (
    <th
      onClick={() => handleSort(col)}
      style={{
        padding: '9px 10px', textAlign: right ? 'right' : 'left',
        color: sortCol === col ? 'var(--accent-blue)' : 'var(--text-muted)',
        fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
      }}
    >
      {label}{sortCol === col ? (sortAsc ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Nuwama — MF Holdings</h2>
          {data?.as_of && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {data.investor?.name && `${data.investor.name} · `}
              As of {data.as_of}
              {data.imported_at && ` · Synced ${new Date(data.imported_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
            </div>
          )}
        </div>
        <button
          onClick={() => setShowSync(true)}
          style={{ padding: '10px 20px', borderRadius: 9, border: 'none', background: 'var(--accent-blue)', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}
        >
          🔄 Sync from MF Central
        </button>
      </div>

      {loading && <div style={{ color: 'var(--text-muted)', padding: 40, textAlign: 'center' }}>Loading...</div>}

      {!loading && !data && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>📊</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>No MF holdings yet</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
            Download your CAS PDF from MF Central and sync it here.
          </div>
          <button
            onClick={() => setShowSync(true)}
            style={{ padding: '12px 28px', borderRadius: 10, border: 'none', background: 'var(--accent-blue)', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}
          >
            Sync from MF Central →
          </button>
        </div>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
            {[
              { label: 'Current Value', value: `₹${(data.total_value / 1e5).toFixed(2)}L`, color: 'var(--accent-blue)' },
              { label: 'Total Invested', value: `₹${(data.total_cost / 1e5).toFixed(2)}L`, color: 'var(--text-primary)' },
              { label: 'Total Gain', value: `${data.total_gain >= 0 ? '+' : ''}₹${(data.total_gain / 1e5).toFixed(2)}L`, color: data.total_gain >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' },
              { label: 'Overall Return', value: `${data.total_gain_pct >= 0 ? '+' : ''}${data.total_gain_pct?.toFixed(2)}%`, color: data.total_gain_pct >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' },
              { label: 'Schemes', value: data.schemes?.length, color: 'var(--text-secondary)' },
            ].map(c => (
              <div key={c.label} style={{ flex: '1 1 140px', background: 'var(--bg-card)', borderRadius: 12, padding: '14px 18px', border: '1px solid var(--border)', minWidth: 120 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: c.color }}>{c.value}</div>
              </div>
            ))}
          </div>

          {/* Table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <SortTh col="scheme" label="Scheme" />
                    <SortTh col="amc" label="AMC" />
                    <th style={{ padding: '9px 10px', color: 'var(--text-muted)', fontWeight: 600 }}>Folio</th>
                    <SortTh col="units" label="Units" right />
                    <SortTh col="nav" label="NAV (₹)" right />
                    <SortTh col="value" label="Value (₹)" right />
                    <SortTh col="cost" label="Cost (₹)" right />
                    <SortTh col="gain" label="Gain (₹)" right />
                    <SortTh col="gain_pct" label="Return %" right />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((s, i) => {
                    const gain = s.gain ?? (s.value - s.cost);
                    const gainPct = s.gain_pct ?? (s.cost ? gain / s.cost * 100 : 0);
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-light)' }}>
                        <td style={{ padding: '10px 10px', maxWidth: 320 }}>
                          <div style={{ fontWeight: 600, lineHeight: 1.3 }}>{s.scheme}</div>
                          {s.isin && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'monospace' }}>{s.isin}</div>}
                        </td>
                        <td style={{ padding: '10px 10px', color: 'var(--text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>{s.amc}</td>
                        <td style={{ padding: '10px 10px', color: 'var(--text-muted)', fontSize: 11 }}>{s.folio}</td>
                        <td style={{ padding: '10px 10px', textAlign: 'right' }}>{s.units?.toLocaleString('en-IN', { maximumFractionDigits: 3 })}</td>
                        <td style={{ padding: '10px 10px', textAlign: 'right' }}>{s.nav?.toLocaleString('en-IN', { maximumFractionDigits: 4 })}</td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700 }}>{s.value?.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', color: 'var(--text-muted)' }}>{s.cost?.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700, color: gain >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                          {gain >= 0 ? '+' : ''}{gain?.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 800, fontSize: 13, color: gainPct >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                          {gainPct >= 0 ? '+' : ''}{gainPct?.toFixed(2)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {showSync && (
        <SyncModal
          onClose={() => setShowSync(false)}
          onSynced={() => { load(); }}
        />
      )}
    </div>
  );
}
