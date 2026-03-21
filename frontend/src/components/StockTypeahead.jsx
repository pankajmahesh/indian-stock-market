import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';

// Shared cache so all typeahead instances use the same data
let _stockCache = null;
let _fetchPromise = null;

function loadStockList() {
  if (_stockCache) return Promise.resolve(_stockCache);
  if (_fetchPromise) return _fetchPromise;
  _fetchPromise = api.getStockList()
    .then(data => {
      _stockCache = Array.isArray(data) ? data : [];
      return _stockCache;
    })
    .catch(() => {
      _stockCache = [];
      return _stockCache;
    });
  return _fetchPromise;
}

export default function StockTypeahead({
  value,
  onChange,
  onSubmit,
  placeholder = 'Enter stock symbol',
  className = 'predict-input',
  style,
  disabled = false,
}) {
  const [stocks, setStocks] = useState(_stockCache || []);
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    loadStockList().then(setStocks);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filterStocks = useCallback((query) => {
    if (!query || query.length < 1) return [];
    const q = query.toUpperCase();
    const matches = [];
    for (const item of stocks) {
      if (matches.length >= 8) break;
      const sym = (item.s || '').toUpperCase();
      const name = (item.n || '').toUpperCase();
      if (sym.startsWith(q) || name.includes(q)) {
        matches.push(item);
      }
    }
    return matches;
  }, [stocks]);

  const handleChange = (e) => {
    const val = e.target.value;
    onChange(val);
    const filtered = filterStocks(val);
    setSuggestions(filtered);
    setShowDropdown(filtered.length > 0);
    setActiveIdx(-1);
  };

  const selectItem = (item) => {
    onChange(item.s);
    setShowDropdown(false);
    setSuggestions([]);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (!showDropdown || suggestions.length === 0) {
      if (e.key === 'Enter' && onSubmit) onSubmit();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(prev => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0 && activeIdx < suggestions.length) {
        selectItem(suggestions[activeIdx]);
      } else {
        setShowDropdown(false);
        if (onSubmit) onSubmit();
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (activeIdx >= 0 && listRef.current) {
      const items = listRef.current.children;
      if (items[activeIdx]) {
        items[activeIdx].scrollIntoView({ block: 'nearest' });
      }
    }
  }, [activeIdx]);

  return (
    <div ref={wrapperRef} style={{ position: 'relative', flex: style?.flex, minWidth: style?.minWidth }}>
      <input
        ref={inputRef}
        type="text"
        className={className}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (value && suggestions.length > 0) setShowDropdown(true);
          else if (value) {
            const filtered = filterStocks(value);
            setSuggestions(filtered);
            setShowDropdown(filtered.length > 0);
          }
        }}
        placeholder={placeholder}
        style={{ ...style, width: '100%' }}
        disabled={disabled}
        autoComplete="off"
      />
      {showDropdown && suggestions.length > 0 && (
        <div
          ref={listRef}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 1000,
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: 8,
            marginTop: 4,
            maxHeight: 240,
            overflowY: 'auto',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          {suggestions.map((item, idx) => (
            <div
              key={item.s}
              onClick={() => selectItem(item)}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                background: idx === activeIdx ? '#334155' : 'transparent',
                borderBottom: idx < suggestions.length - 1 ? '1px solid #1e293b20' : 'none',
              }}
              onMouseEnter={() => setActiveIdx(idx)}
            >
              <span style={{ fontWeight: 600, color: 'var(--accent)', whiteSpace: 'nowrap' }}>{item.s}</span>
              <span style={{
                color: 'var(--text-secondary)',
                fontSize: 11,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                textAlign: 'right',
              }}>{item.n}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
