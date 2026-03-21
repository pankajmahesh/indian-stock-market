/**
 * AddAccountModal — lets users connect a broker account or build a custom stock list.
 *
 * Brokers show as a selection grid. Choosing one shows a CSV upload or a "coming soon" note.
 * "Custom List" opens a stock picker with symbol search + qty + buy price.
 *
 * All accounts (including Custom List) are saved to the backend so the Portfolio
 * dropdown reflects the connected accounts.
 */
import { useState, useEffect, useRef } from 'react';
import { api } from '../api';

const BROKERS = [
  { id: 'nuwama',       label: 'Nuwama',         icon: '🏦', upload: true  },
  { id: 'sharekhan',    label: 'Sharekhan',       icon: '📊', upload: true  },
  { id: 'zerodha',      label: 'Zerodha',         icon: '🟢', upload: true  },
  { id: 'upstox',       label: 'Upstox',          icon: '🔵', upload: true  },
  { id: 'groww',        label: 'Groww',           icon: '🌱', upload: true  },
  { id: '5paisa',       label: '5paisa',          icon: '5️⃣', upload: true  },
  { id: 'angelone',     label: 'Angel One',       icon: '👼', upload: true  },
  { id: 'hdfc_sky',     label: 'HDFC Sky',        icon: '🏛️', upload: true  },
  { id: 'iifl',         label: 'IIFL Capital',    icon: '💼', upload: true  },
  { id: 'motilal',      label: 'Motilal Oswal',   icon: '📈', upload: true  },
  { id: 'dhan',         label: 'Dhan',            icon: '💎', upload: true  },
  { id: 'trustline',    label: 'Trustline',       icon: '🛡️', upload: true  },
];

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function StockSearchInput({ onAdd }) {
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState([]);
  const [open, setOpen]         = useState(false);
  const [selected, setSelected] = useState(null);
  const [qty, setQty]           = useState('');
  const [buyAmt, setBuyAmt]     = useState('');
  const [loading, setLoading]   = useState(false);
  const dropRef = useRef(null);
  const debouncedQ = useDebounce(query, 300);

  useEffect(() => {
    if (debouncedQ.length < 1) { setResults([]); return; }
    setLoading(true);
    api.searchStocks(debouncedQ)
      .then(r => { setResults(r || []); setOpen(true); })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [debouncedQ]);

  useEffect(() => {
    function onClick(e) {
      if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const selectStock = (s) => {
    setSelected(s);
    setQuery(s.symbol);
    setOpen(false);
  };

  const handleAdd = () => {
    if (!selected) return;
    onAdd({ symbol: selected.symbol, name: selected.name, qty: qty || null, buyAmt: buyAmt || null });
    setSelected(null);
    setQuery('');
    setQty('');
    setBuyAmt('');
    setResults([]);
  };

  const inp = {
    background: 'var(--bg-secondary)', border: '1px solid var(--border)',
    borderRadius: 7, padding: '8px 11px', color: 'var(--text-primary)',
    fontSize: 13, outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <div style={{ position: 'relative', flex: '1 1 160px' }} ref={dropRef}>
        <input
          style={{ ...inp, width: '100%' }}
          placeholder="Search stock (e.g. RELIANCE)"
          value={query}
          onChange={e => { setQuery(e.target.value); setSelected(null); }}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {loading && (
          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 11 }}>...</span>
        )}
        {open && results.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10000,
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            maxHeight: 220, overflowY: 'auto',
          }}>
            {results.map(r => (
              <div key={r.symbol}
                onClick={() => selectStock(r)}
                style={{
                  padding: '9px 12px', cursor: 'pointer', fontSize: 13,
                  borderBottom: '1px solid var(--border)',
                  display: 'flex', justifyContent: 'space-between',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = ''}
              >
                <span style={{ fontWeight: 700 }}>{r.symbol}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{r.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <input style={{ ...inp, width: 80 }} placeholder="Qty" type="number" min="0"
        value={qty} onChange={e => setQty(e.target.value)} />
      <input style={{ ...inp, width: 100 }} placeholder="Buy ₹" type="number" min="0"
        value={buyAmt} onChange={e => setBuyAmt(e.target.value)} />
      <button
        onClick={handleAdd}
        disabled={!selected}
        style={{
          padding: '8px 16px', borderRadius: 7, border: 'none', fontWeight: 700,
          background: selected ? 'var(--accent-blue)' : 'var(--bg-secondary)',
          color: selected ? 'white' : 'var(--text-muted)',
          cursor: selected ? 'pointer' : 'not-allowed', fontSize: 13,
        }}
      >
        + Add
      </button>
    </div>
  );
}

export default function AddAccountModal({ onClose, onSaved }) {
  const [step, setStep]           = useState('choose'); // 'choose' | 'broker' | 'custom'
  const [chosenBroker, setChosenBroker] = useState(null);
  const [accounts, setAccounts]   = useState([]);
  const [customStocks, setCustomStocks] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState(null);
  const [saving, setSaving]       = useState(false);
  const fileRef = useRef(null);

  // Load existing accounts on open
  useEffect(() => {
    api.getPortfolioAccounts()
      .then(accs => setAccounts(Array.isArray(accs) ? accs : []))
      .catch(() => {});
  }, []);

  const handleBrokerSelect = (broker) => {
    setChosenBroker(broker);
    setUploadMsg(null);
    setStep('broker');
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const result = await api.importPortfolioCsv(file, chosenBroker.id);
      const newAcc = {
        id: chosenBroker.id,
        label: chosenBroker.label,
        icon: chosenBroker.icon,
        holdings: (result.symbols || []).map(sym => ({ symbol: sym, name: sym, qty: null, buyAmt: null })),
        importedAt: new Date().toISOString(),
      };
      // Replace if exists, else add
      const updated = accounts.filter(a => a.id !== chosenBroker.id).concat(newAcc);
      setAccounts(updated);
      setUploadMsg({ type: 'ok', text: `Imported ${result.count} stocks from ${chosenBroker.label}` });
    } catch (err) {
      setUploadMsg({ type: 'error', text: err.message || 'Upload failed' });
    } finally {
      setUploading(false);
    }
  };

  const addCustomStock = (stock) => {
    setCustomStocks(prev => {
      if (prev.find(s => s.symbol === stock.symbol)) return prev;
      return [...prev, stock];
    });
  };

  const removeCustomStock = (symbol) => {
    setCustomStocks(prev => prev.filter(s => s.symbol !== symbol));
  };

  const saveCustomList = () => {
    if (!customStocks.length) return;
    const newAcc = {
      id: 'custom',
      label: 'Custom List',
      icon: '⭐',
      holdings: customStocks,
      importedAt: new Date().toISOString(),
    };
    const updated = accounts.filter(a => a.id !== 'custom').concat(newAcc);
    setAccounts(updated);
    setCustomStocks([]);
    setStep('choose');
  };

  const removeAccount = (id) => {
    setAccounts(prev => prev.filter(a => a.id !== id));
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      await api.savePortfolioAccounts(accounts);
      onSaved?.(accounts);
      onClose();
    } catch (err) {
      alert(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
  };
  const box = {
    background: 'var(--bg-card)', border: '1px solid var(--border)',
    borderRadius: 16, padding: '28px 28px 24px', width: 600, maxWidth: '95vw',
    maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 48px rgba(0,0,0,0.5)',
  };

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={box}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            {step !== 'choose' && (
              <button onClick={() => setStep('choose')} style={{ background: 'none', border: 'none', color: 'var(--accent-cyan)', cursor: 'pointer', fontSize: 13, marginRight: 12 }}>
                ← Back
              </button>
            )}
            <span style={{ fontSize: 17, fontWeight: 800 }}>
              {step === 'choose' ? 'Add Account / Portfolio' : step === 'broker' ? chosenBroker.label : 'Custom Stock List'}
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        {/* Step: Choose broker or custom */}
        {step === 'choose' && (
          <>
            {/* Connected accounts summary */}
            {accounts.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10, letterSpacing: 1 }}>CONNECTED ACCOUNTS</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {accounts.map(acc => (
                    <div key={acc.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 12px', borderRadius: 20, background: 'var(--bg-secondary)',
                      border: '1px solid var(--accent-cyan)', fontSize: 13,
                    }}>
                      <span>{acc.icon}</span>
                      <span style={{ fontWeight: 600 }}>{acc.label}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{acc.holdings?.length || 0} stocks</span>
                      <button
                        onClick={() => removeAccount(acc.id)}
                        title="Remove"
                        style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}
                      >×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 12, letterSpacing: 1 }}>SELECT BROKER OR ADD MANUALLY</div>

            {/* Broker grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
              {BROKERS.map(b => (
                <button key={b.id} onClick={() => handleBrokerSelect(b)} style={{
                  padding: '14px 8px', borderRadius: 10, border: '1px solid var(--border)',
                  background: accounts.find(a => a.id === b.id) ? 'rgba(6,182,212,0.1)' : 'var(--bg-secondary)',
                  borderColor: accounts.find(a => a.id === b.id) ? 'var(--accent-cyan)' : 'var(--border)',
                  cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  transition: 'border-color 0.15s',
                }}>
                  <span style={{ fontSize: 22 }}>{b.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{b.label}</span>
                  {accounts.find(a => a.id === b.id) && (
                    <span style={{ fontSize: 10, color: 'var(--accent-cyan)' }}>Connected</span>
                  )}
                </button>
              ))}
              {/* Custom List */}
              <button onClick={() => setStep('custom')} style={{
                padding: '14px 8px', borderRadius: 10, border: '1px solid var(--border)',
                background: accounts.find(a => a.id === 'custom') ? 'rgba(250,204,21,0.1)' : 'var(--bg-secondary)',
                borderColor: accounts.find(a => a.id === 'custom') ? '#facc15' : 'var(--border)',
                cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
              }}>
                <span style={{ fontSize: 22 }}>⭐</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>Custom List</span>
                {accounts.find(a => a.id === 'custom') && (
                  <span style={{ fontSize: 10, color: '#facc15' }}>Connected</span>
                )}
              </button>
            </div>

            {/* Save button */}
            {accounts.length > 0 && (
              <button
                onClick={handleSaveAll}
                disabled={saving}
                style={{
                  width: '100%', padding: '11px', borderRadius: 8, border: 'none',
                  background: saving ? 'var(--bg-secondary)' : 'var(--accent-blue)',
                  color: saving ? 'var(--text-muted)' : 'white',
                  fontWeight: 700, fontSize: 14, cursor: saving ? 'wait' : 'pointer',
                }}
              >
                {saving ? 'Saving...' : `Save & Apply (${accounts.length} account${accounts.length > 1 ? 's' : ''})`}
              </button>
            )}
          </>
        )}

        {/* Step: Broker CSV upload */}
        {step === 'broker' && chosenBroker && (
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Upload your <strong>{chosenBroker.label}</strong> holdings export (CSV or Excel).
              Go to your broker app → Portfolio → Export/Download holdings.
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xls,.xlsx"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              style={{
                padding: '10px 24px', borderRadius: 8, border: 'none',
                background: uploading ? 'var(--bg-secondary)' : 'var(--accent-blue)',
                color: uploading ? 'var(--text-muted)' : 'white',
                fontWeight: 700, fontSize: 14, cursor: uploading ? 'wait' : 'pointer',
              }}
            >
              {uploading ? 'Uploading...' : `Upload ${chosenBroker.label} Export`}
            </button>

            {uploadMsg && (
              <div style={{
                marginTop: 12, padding: '9px 12px', borderRadius: 7, fontSize: 12,
                background: uploadMsg.type === 'ok' ? 'rgba(34,197,94,0.1)' : 'rgba(248,113,113,0.1)',
                border: `1px solid ${uploadMsg.type === 'ok' ? 'rgba(34,197,94,0.3)' : 'rgba(248,113,113,0.3)'}`,
                color: uploadMsg.type === 'ok' ? 'var(--accent-green)' : 'var(--accent-red)',
              }}>
                {uploadMsg.text}
              </div>
            )}

            {uploadMsg?.type === 'ok' && (
              <button
                onClick={() => setStep('choose')}
                style={{
                  marginTop: 12, padding: '9px 20px', borderRadius: 8, border: 'none',
                  background: 'var(--accent-cyan)', color: '#0f172a',
                  fontWeight: 700, fontSize: 13, cursor: 'pointer',
                }}
              >
                Done → Back to accounts
              </button>
            )}
          </div>
        )}

        {/* Step: Custom stock list */}
        {step === 'custom' && (
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Search for a stock, enter quantity and buy price (optional), then click + Add.
            </div>

            <StockSearchInput onAdd={addCustomStock} />

            {/* Stock table */}
            {customStocks.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 11 }}>
                      <th style={{ textAlign: 'left', padding: '4px 8px' }}>Symbol</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px' }}>Name</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px' }}>Qty</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px' }}>Buy ₹</th>
                      <th style={{ padding: '4px 8px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {customStocks.map(s => (
                      <tr key={s.symbol} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 8px', fontWeight: 700, color: 'var(--accent-cyan)' }}>{s.symbol}</td>
                        <td style={{ padding: '6px 8px', color: 'var(--text-secondary)', fontSize: 12 }}>{s.name}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{s.qty || '—'}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{s.buyAmt ? `₹${s.buyAmt}` : '—'}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                          <button onClick={() => removeCustomStock(s.symbol)}
                            style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', fontSize: 16 }}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
              <button
                onClick={saveCustomList}
                disabled={!customStocks.length}
                style={{
                  padding: '10px 24px', borderRadius: 8, border: 'none',
                  background: customStocks.length ? 'var(--accent-blue)' : 'var(--bg-secondary)',
                  color: customStocks.length ? 'white' : 'var(--text-muted)',
                  fontWeight: 700, fontSize: 14, cursor: customStocks.length ? 'pointer' : 'not-allowed',
                }}
              >
                Save Custom List ({customStocks.length})
              </button>
              <button onClick={() => setStep('choose')}
                style={{
                  padding: '10px 20px', borderRadius: 8, border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13,
                }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
