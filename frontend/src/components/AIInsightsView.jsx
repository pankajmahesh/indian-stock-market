/**
 * AI Stock Analyzer
 * Implements the 9-skill algorithm from skills.md:
 * Skill 1  Fundamental Analysis
 * Skill 2  Technical Analysis (VWAP + Supertrend + Ichimoku + RSI/MACD)
 * Skill 3  Market Condition Scanner
 * Skill 4  India Growth Story Overlay
 * Skill 5  News & Company Events
 * Skill 6  Macro & Global Flows
 * Skill 7  Sector Trend Analyzer
 * Skill 8  Accumulation Cue Engine  (verdict + tranche plan)
 * Skill 9  Undervaluation Screen
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, Legend,
} from 'recharts';
import { api } from '../api';
import StockTypeahead from './StockTypeahead';
import ScreenshotButton from './ScreenshotButton';

/* ── colour helpers ─────────────────────────────────────────────── */
const chgColor = v => v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : '#94a3b8';
const fmtP = v => v != null ? `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—';

const VERDICT_COLOR = {
  ACCUMULATE: '#22c55e', 'ACCUMULATE (STAGED)': '#4ade80',
  WATCH: '#eab308', WAIT: '#f97316',
  'Strong Buy': '#22c55e', Buy: '#4ade80',
  Hold: '#eab308', Sell: '#f97316', 'Strong Sell': '#ef4444',
};
const VERDICT_ICON = {
  ACCUMULATE: '✅', 'ACCUMULATE (STAGED)': '✅', WATCH: '👁', WAIT: '⏳',
  'Strong Buy': '✅', Buy: '✅', Hold: '👁', Sell: '⏳', 'Strong Sell': '🚫',
};

const REGIME_COLOR = {
  STRONG_BULL: '#22c55e', BULL: '#86efac', NEUTRAL: '#eab308',
  BEAR: '#f97316', STRONG_BEAR: '#ef4444',
};

const INDIA_THEMES = {
  'Technology':          { theme: 'Digital & AI adoption', alignment: 'Strong' },
  'Information Technology': { theme: 'Digital & AI adoption', alignment: 'Strong' },
  'Capital Goods':       { theme: 'Infrastructure & CapEx supercycle', alignment: 'Strong' },
  'Infrastructure':      { theme: 'Infrastructure & CapEx supercycle', alignment: 'Strong' },
  'Cement':              { theme: 'Infrastructure & CapEx supercycle', alignment: 'Moderate' },
  'Metals':              { theme: 'Infrastructure & CapEx supercycle', alignment: 'Moderate' },
  'Automobile':          { theme: 'PLI-driven manufacturing + Consumption upgrade', alignment: 'Strong' },
  'Auto':                { theme: 'PLI-driven manufacturing + Consumption upgrade', alignment: 'Strong' },
  'Pharma':              { theme: 'Healthcare & diagnostics + CDMO', alignment: 'Strong' },
  'Healthcare':          { theme: 'Healthcare & diagnostics', alignment: 'Strong' },
  'Financial Services':  { theme: 'Financial inclusion + BFSI', alignment: 'Moderate' },
  'Banking':             { theme: 'Financial inclusion + BFSI', alignment: 'Moderate' },
  'FMCG':                { theme: 'Consumption upgrade & premiumization', alignment: 'Moderate' },
  'Consumer':            { theme: 'Consumption upgrade', alignment: 'Moderate' },
  'Power':               { theme: 'Energy transition', alignment: 'Strong' },
  'Energy':              { theme: 'Energy transition + PLI', alignment: 'Moderate' },
  'Defence':             { theme: 'Defence indigenization', alignment: 'Strong' },
  'Telecom':             { theme: 'Digital & AI adoption', alignment: 'Moderate' },
  'Realty':              { theme: 'Urbanization & housing', alignment: 'Moderate' },
};

/* ── BANDHAN AMC STRATEGY HELPERS ───────────────────────────────── */
const SECTOR_L_BASE = {
  'Consumer Defensive': 'L1', 'Healthcare': 'L1',
  'Consumer Cyclical': 'L2', 'Industrials': 'L2', 'Technology': 'L2',
  'Communication Services': 'L2', 'Real Estate': 'L2',
  'Basic Materials': 'L3', 'Energy': 'L3', 'Utilities': 'L3',
};
const SECTOR_PREF_MULT = {
  'Industrials': 1.10, 'Consumer Cyclical': 1.07, 'Financial Services': 1.05,
  'Basic Materials': 1.03, 'Healthcare': 1.02, 'Consumer Defensive': 1.00,
  'Real Estate': 0.97, 'Communication Services': 0.97, 'Technology': 0.93,
  'Energy': 0.90, 'Utilities': 0.88,
};

function classifyLCategory(sector, industry, roeDecimal, de) {
  const roe = roeDecimal != null ? roeDecimal * 100 : null; // convert decimal→%
  const ind = (industry || '').toLowerCase();
  let base = SECTOR_L_BASE[sector] || 'L2';

  if (sector === 'Financial Services') {
    const isPremium = ['insurance', 'asset management', 'exchange', 'broker', 'capital market'].some(x => ind.includes(x));
    const isBank = ind.includes('bank');
    if (isPremium) base = 'L1';
    else if (isBank) base = roe != null && roe > 15 ? 'L1' : 'L3';
    else base = 'L2';
  }

  // Upgrade L2 → L1 if strong metrics
  if (base === 'L2' && roe != null && roe >= 20 && (de == null || de <= 50)) base = 'L1';

  // Downgrade on weak metrics
  if (roe != null && roe < 8 && base !== 'L1') base = 'L3';
  if (de != null && de > 100 && base === 'L1') base = 'L2';
  if (de != null && de > 100 && base === 'L2') base = 'L3';

  return base;
}

function getBandhanSectorFit(sector) {
  const mult = SECTOR_PREF_MULT[sector] ?? 1.0;
  if (mult >= 1.10) return { label: 'Most Preferred', color: '#22c55e', note: 'Manufacturing / Engineering / Industrials' };
  if (mult >= 1.05) return { label: 'Preferred', color: '#4ade80', note: 'Auto, FinServ (non-PSU), Chemicals' };
  if (mult >= 1.0)  return { label: 'Neutral', color: '#eab308', note: 'FMCG, Healthcare — quality but slower growth' };
  if (mult >= 0.95) return { label: 'Cautious', color: '#f97316', note: 'Real Estate, Telecom — wait for right price' };
  return { label: 'Underweight', color: '#ef4444', note: 'IT services / Oil & Gas / Utilities — avoid for alpha' };
}

/* ── SKILL TABS ─────────────────────────────────────────────────── */
const SKILL_TABS = [
  { id: 'overview',        label: '📊 Overview' },
  { id: 'fundamental',     label: '1. Fundamental' },
  { id: 'technical',       label: '2. Technical' },
  { id: 'market',          label: '3. Market' },
  { id: 'india',           label: '4. India Story' },
  { id: 'news',            label: '5. News' },
  { id: 'macro',           label: '6. Macro' },
  { id: 'sector',          label: '7. Sector' },
  { id: 'sentiment',       label: '8. Sentiment' },
  { id: 'future_results',  label: '📈 Future Results' },
  { id: 'verdict',         label: '10. Verdict' },
];

/* ══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════════════════════════════════ */
const INDEX_TABS = [
  { id: 'all',             label: 'All Indices' },
  { id: 'midcap150',       label: 'Midcap 150' },
  { id: 'largemidcap250',  label: 'LargeMidcap 250' },
  { id: 'smallcap250',     label: 'Smallcap 250' },
];

export default function AIInsightsView() {
  const [symbol, setSymbol]   = useState('');
  const [result, setResult]   = useState(null);
  const [mc, setMc]           = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [notInPipeline, setNotInPipeline] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const containerRef = useRef(null);

  // Index stocks panel
  const [indexTab, setIndexTab]       = useState('all');
  const [indexStocks, setIndexStocks] = useState([]);
  const [indexLoading, setIndexLoading] = useState(false);
  const [indexError, setIndexError]   = useState(null);

  const loadIndexStocks = useCallback((idx) => {
    setIndexLoading(true); setIndexError(null);
    api.getAIIndexStocks(idx, 20)
      .then(data => {
        const stocks = (data.stocks || []).slice().sort(
          (a, b) => (b.fundamental_score ?? b.composite_score ?? 0) - (a.fundamental_score ?? a.composite_score ?? 0)
        );
        setIndexStocks(stocks);
      })
      .catch(e => setIndexError(e.message))
      .finally(() => setIndexLoading(false));
  }, []);

  useEffect(() => { loadIndexStocks(indexTab); }, [indexTab, loadIndexStocks]);

  const analyze = (sym, live = false) => {
    const s = sym || symbol;
    if (!s) return;
    setLoading(true); setError(null); setResult(null); setMc(null);
    setNotInPipeline(false);
    setActiveTab('overview');

    const insightCall = live ? api.getAIInsightsLive(s) : api.getAIInsights(s);

    Promise.allSettled([
      insightCall,
      api.getMarketCondition(),
    ]).then(([insRes, mcRes]) => {
      if (insRes.status === 'fulfilled') {
        setResult(insRes.value);
      } else {
        // fetchJSON throws on non-2xx; the parsed JSON body is in err.data
        const errData = insRes.reason?.data || {};
        if (errData.not_in_pipeline) {
          setNotInPipeline(true);
          setError(null);
        } else {
          setError(errData.error || insRes.reason?.message || 'Analysis failed. Please try again.');
        }
      }
      if (mcRes.status === 'fulfilled') setMc(mcRes.value);
    }).finally(() => setLoading(false));
  };

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', minHeight: '80vh' }}>

      {/* ══ LEFT COLUMN — 30% ══════════════════════════════════════ */}
      <div style={{ width: '30%', minWidth: 260, flexShrink: 0 }}>
        <IndexStocksPanel
          indexTab={indexTab}
          setIndexTab={(t) => setIndexTab(t)}
          indexStocks={indexStocks}
          indexLoading={indexLoading}
          indexError={indexError}
          onRefresh={() => loadIndexStocks(indexTab)}
          onAnalyze={(sym) => { setSymbol(sym); analyze(sym); }}
          activeSymbol={symbol}
        />
      </div>

      {/* ══ RIGHT COLUMN — 70% ═════════════════════════════════════ */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* ── Search header ───────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <h2 style={{ margin: '0 0 2px', fontSize: 16 }}>AI Stock Analyzer</h2>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                9-skill: Fundamental · Technical · Market · India · News · Macro · Sector · Sentiment · Verdict
              </div>
            </div>
            {result && <ScreenshotButton targetRef={containerRef} filename="ai-analysis" />}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <StockTypeahead
                value={symbol}
                onChange={(v) => { setSymbol(v); setNotInPipeline(false); setError(null); }}
                onSelect={(sym) => { setSymbol(sym); analyze(sym); }}
                placeholder="Search stock (e.g. RELIANCE, TCS)..."
              />
            </div>
            <button
              onClick={() => analyze()}
              disabled={!symbol || loading}
              style={{
                padding: '10px 20px', borderRadius: 8, border: 'none',
                background: !symbol || loading ? '#334155' : '#3b82f6',
                color: '#fff', fontWeight: 700,
                cursor: !symbol || loading ? 'not-allowed' : 'pointer', fontSize: 13,
              }}>
              {loading ? '⟳' : 'Analyze'}
            </button>
          </div>
          {/* Quick picks */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
            {['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'BHARTIARTL', 'BAJFINANCE'].map(s => (
              <button key={s} onClick={() => { setSymbol(s); analyze(s); }}
                style={{
                  padding: '2px 8px', borderRadius: 5, fontSize: 10,
                  border: `1px solid ${symbol === s ? '#3b82f6' : 'var(--border)'}`,
                  background: symbol === s ? '#3b82f620' : 'transparent',
                  color: symbol === s ? '#60a5fa' : 'var(--text-secondary)', cursor: 'pointer',
                }}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* ── Loading / Error ─────────────────────────────────── */}
        {loading && (
          <div className="loading">
            <div className="spinner" />
            Running 9-skill analysis on {symbol}...
          </div>
        )}
        {error && (
          <div className="card" style={{ color: '#ef4444', textAlign: 'center', padding: 24 }}>
            {error}
          </div>
        )}
        {notInPipeline && !loading && (
          <div className="card" style={{ textAlign: 'center', padding: 28 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🔍</div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', marginBottom: 6 }}>
              {symbol} is not in the pipeline data
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
              This stock hasn't been scanned by the screener pipeline yet.<br />
              If it's <strong>listed on NSE</strong>, click below to fetch live data directly.<br />
              <span style={{ color: '#f59e0b' }}>Note: private companies (e.g. Lenskart, Zomato pre-IPO) are not available on NSE.</span>
            </div>
            <button
              onClick={() => analyze(symbol, true)}
              style={{
                background: '#3b82f6', color: '#fff', border: 'none',
                padding: '10px 24px', borderRadius: 8, fontWeight: 700,
                fontSize: 14, cursor: 'pointer', display: 'inline-flex',
                alignItems: 'center', gap: 8,
              }}
            >
              ⚡ Analyze Live
            </button>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
              Fetches price history &amp; fundamentals live from NSE · takes ~5–10 sec
            </div>
          </div>
        )}

        {/* ── Analysis result ─────────────────────────────────── */}
        {result && (
          <div ref={containerRef}>
            <StockHeader result={result} mc={mc} />

            {/* Skill tabs */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 16, overflowX: 'auto' }}>
              {SKILL_TABS.map(t => (
                <button key={t.id} onClick={() => setActiveTab(t.id)}
                  style={{
                    padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)',
                    background: activeTab === t.id ? '#3b82f6' : 'transparent',
                    color: activeTab === t.id ? '#fff' : 'var(--text-secondary)',
                    cursor: 'pointer', fontSize: 11, fontWeight: activeTab === t.id ? 700 : 400,
                    whiteSpace: 'nowrap',
                  }}>
                  {t.label}
                </button>
              ))}
            </div>

            {activeTab === 'overview'        && <OverviewTab result={result} mc={mc} />}
            {activeTab === 'fundamental'     && <Skill1Fundamental result={result} />}
            {activeTab === 'technical'       && <Skill2Technical result={result} symbol={symbol} />}
            {activeTab === 'market'          && <Skill3Market mc={mc} />}
            {activeTab === 'india'           && <Skill4India result={result} />}
            {activeTab === 'news'            && <Skill5News result={result} />}
            {activeTab === 'macro'           && <Skill6Macro result={result} mc={mc} />}
            {activeTab === 'sector'          && <Skill7Sector result={result} />}
            {activeTab === 'sentiment'       && <Skill8Sentiment result={result} />}
            {activeTab === 'future_results'  && <FutureResultsTab symbol={symbol} result={result} />}
            {activeTab === 'verdict'         && <Skill10Verdict result={result} mc={mc} />}
          </div>
        )}

        {!result && !loading && !error && (
          <div className="empty-state">
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Select a stock from the left panel, or search above to run a full 9-skill analysis.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Index Stocks Panel ──────────────────────────────────────────── */
const VERDICT_DOT = { ACCUMULATE: '#22c55e', 'ACCUMULATE (STAGED)': '#4ade80', WATCH: '#eab308', WAIT: '#f97316' };
const DIR_COLOR = { UP: '#22c55e', DOWN: '#ef4444', NEUTRAL: '#94a3b8' };

function IndexStocksPanel({ indexTab, setIndexTab, indexStocks, indexLoading, indexError, onRefresh, onAnalyze, activeSymbol }) {
  return (
    <div className="card" style={{ position: 'sticky', top: 16, maxHeight: 'calc(100vh - 40px)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Top Stocks</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Click to analyze</div>
        </div>
        <button onClick={onRefresh} disabled={indexLoading}
          style={{ padding: '3px 10px', borderRadius: 5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11 }}>
          ⟳
        </button>
      </div>

      {/* Index selector */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 10 }}>
        {INDEX_TABS.map(t => (
          <button key={t.id} onClick={() => setIndexTab(t.id)}
            style={{
              padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border)',
              background: indexTab === t.id ? '#3b82f6' : 'transparent',
              color: indexTab === t.id ? '#fff' : 'var(--text-secondary)',
              cursor: 'pointer', fontSize: 10, fontWeight: indexTab === t.id ? 700 : 400,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Stock list — scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {indexLoading && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0', fontSize: 12 }}>
            Loading...
          </div>
        )}
        {indexError && (
          <div style={{ color: '#ef4444', fontSize: 11 }}>Failed: {indexError}</div>
        )}
        {!indexLoading && !indexError && indexStocks.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'center', padding: '12px 0' }}>
            No data — run a scan first
          </div>
        )}
        {indexStocks.map(stock => {
          const sym = (stock.symbol || '').replace('.NS', '');
          const dir = (stock.direction || 'NEUTRAL').toUpperCase();
          const verdict = stock.verdict || 'WATCH';
          const dc = DIR_COLOR[dir] || '#94a3b8';
          const vc = VERDICT_DOT[verdict] || VERDICT_COLOR[verdict] || '#64748b';
          const score = stock.fundamental_score ?? stock.composite_score ?? null;
          const isActive = sym === activeSymbol?.toUpperCase();
          return (
            <div key={sym}
              onClick={() => onAnalyze(sym)}
              style={{
                padding: '8px 10px', borderRadius: 8,
                border: `1px solid ${isActive ? '#3b82f6' : 'var(--border)'}`,
                background: isActive ? 'rgba(59,130,246,0.08)' : 'var(--bg-secondary)',
                cursor: 'pointer', borderLeft: `3px solid ${vc}`,
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#1e293b'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-secondary)'; }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 12, color: isActive ? '#60a5fa' : 'var(--text-primary)' }}>{sym}</span>
                <span style={{ fontSize: 9, color: dc, fontWeight: 600 }}>{dir === 'BULLISH' || dir === 'UP' ? '▲' : dir === 'BEARISH' || dir === 'DOWN' ? '▼' : '—'}</span>
              </div>
              {stock.name && (
                <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {stock.name}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 600 }}>
                  {stock.cmp ? `₹${Number(stock.cmp).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}
                </span>
                <span style={{ fontSize: 9, fontWeight: 700, color: vc }}>{verdict}</span>
              </div>
              {score != null && (
                <div style={{ marginTop: 5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontSize: 9, color: '#475569' }}>Health</span>
                    <span style={{ fontSize: 9, fontWeight: 700, color: score >= 75 ? '#22c55e' : score >= 60 ? '#eab308' : '#f97316' }}>
                      {score.toFixed(0)}
                    </span>
                  </div>
                  <div style={{ height: 3, borderRadius: 2, background: '#1e293b', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, score)}%`, background: score >= 75 ? '#22c55e' : score >= 60 ? '#eab308' : '#f97316' }} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Stock header bar ────────────────────────────────────────────── */
function StockHeader({ result, mc }) {
  const verdict = result.verdict;
  const vc = VERDICT_COLOR[verdict] || '#64748b';
  const regime = mc?.regime;
  const rc = REGIME_COLOR[regime] || '#64748b';

  // Live CMP polling every 30s
  const sym = result.symbol?.replace('.NS', '') || '';
  const [liveCmp, setLiveCmp] = useState(result.cmp || null);
  const [liveChg, setLiveChg] = useState(null);
  const [liveTs, setLiveTs] = useState(null);

  useEffect(() => {
    if (!sym) return;
    const fetchPrice = () => {
      api.getLiveSignal(sym)
        .then(d => {
          if (d?.cmp) { setLiveCmp(d.cmp); setLiveChg(d.change_pct ?? null); }
          setLiveTs(new Date());
        })
        .catch(() => {
          // NSE proxy unavailable — fall back to yfinance live price
          api.getLivePrice(sym)
            .then(d => {
              if (d?.cmp) { setLiveCmp(d.cmp); setLiveChg(d.change_pct ?? null); }
              setLiveTs(new Date());
            })
            .catch(() => { setLiveTs(new Date()); });
        });
    };
    fetchPrice();
    const id = setInterval(fetchPrice, 30000);
    return () => clearInterval(id);
  }, [sym]);

  const displayCmp = liveCmp ?? result.cmp;

  return (
    <div className="card" style={{ marginBottom: 16, borderLeft: `4px solid ${vc}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 20, fontWeight: 800 }}>
              {result.name || result.symbol?.replace('.NS', '')}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-secondary)', padding: '2px 8px', borderRadius: 6 }}>
              NSE: {result.symbol?.replace('.NS', '') || '—'}
            </span>
            {result.liveData && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: '#0ea5e922', color: '#38bdf8', border: '1px solid #38bdf844' }}>
                ⚡ Live Data
              </span>
            )}
            {result.sector && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{result.sector}</span>
            )}
            {(() => {
              const lcat = classifyLCategory(result.sector, result.industry, result.metrics?.roe, result.metrics?.de);
              const lColors = { L1: '#22c55e', L2: '#f59e0b', L3: '#ef4444' };
              const lLabels = { L1: 'High Quality', L2: 'Mid Quality', L3: 'Cyclical' };
              const c = lColors[lcat];
              return (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: `${c}22`, color: c, border: `1px solid ${c}44` }}>
                  {lcat} · {lLabels[lcat]}
                </span>
              );
            })()}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>
            {fmtP(displayCmp)}
            {liveChg != null && (
              <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 8, color: chgColor(liveChg) }}>
                {liveChg >= 0 ? '+' : ''}{liveChg.toFixed(2)}%
              </span>
            )}
            {result.metrics?.pe && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 10 }}>
                P/E: {result.metrics.pe?.toFixed(1)}
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s infinite' }} />
            Live · {liveTs ? liveTs.toLocaleTimeString('en-IN') : 'Loading...'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* Verdict */}
          <div style={{
            padding: '12px 18px', borderRadius: 12, background: `${vc}15`,
            border: `1.5px solid ${vc}44`, textAlign: 'center',
          }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>VERDICT</div>
            <div style={{ fontSize: 22 }}>{VERDICT_ICON[verdict] || '—'}</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: vc, marginTop: 2 }}>{verdict}</div>
          </div>

          {/* Health score */}
          {result.healthScore != null && (
            <div style={{ padding: '12px 18px', borderRadius: 12, background: 'var(--bg-secondary)', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>HEALTH SCORE</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: scoreColor5(result.healthScore?.overall ?? result.healthScore) }}>
                {Number(result.healthScore?.overall ?? result.healthScore).toFixed(1)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>out of 5</div>
            </div>
          )}

          {/* Market regime */}
          {regime && (
            <div style={{ padding: '12px 18px', borderRadius: 12, background: `${rc}10`, border: `1px solid ${rc}30`, textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>MARKET</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: rc }}>{regime.replace('_', ' ')}</div>
              {mc?.vix && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>VIX {mc.vix.toFixed(1)}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Overview tab: skills summary ────────────────────────────────── */
function OverviewTab({ result, mc }) {
  const sector = result.sector || '';
  const theme = getTheme(sector);
  const verdict = result.verdict;
  const vc = VERDICT_COLOR[verdict] || '#64748b';
  const fairValue = result.fairValue;
  const mos = fairValue?.upside;

  const skills = [
    {
      num: '1', name: 'Fundamental',
      score: result.healthScore != null ? `${Number(result.healthScore?.overall ?? result.healthScore).toFixed(1)}/5` : '—',
      color: scoreColor5(result.healthScore?.overall ?? result.healthScore),
      note: result.metrics ? `ROE ${result.metrics.roe?.toFixed(1)}% · P/E ${result.metrics.pe?.toFixed(1)} · D/E ${result.metrics.de?.toFixed(2)}` : '—',
    },
    {
      num: '2', name: 'Technical',
      score: result.healthScore?.priceMomentum != null ? `${Number(result.healthScore.priceMomentum).toFixed(1)}/5` : '—',
      color: scoreColor5(result.healthScore?.priceMomentum),
      note: 'Price momentum pillar score',
    },
    {
      num: '3', name: 'Market',
      score: mc?.regime || '—',
      color: REGIME_COLOR[mc?.regime] || '#64748b',
      note: mc ? `VIX ${mc.vix?.toFixed(1)} · Nifty ${mc.nifty_vs_200dma_pct > 0 ? 'above' : 'below'} 200 DMA` : 'Loading...',
    },
    {
      num: '4', name: 'India Growth',
      score: theme.alignment || '—',
      color: theme.alignment === 'Strong' ? '#22c55e' : theme.alignment === 'Moderate' ? '#eab308' : '#94a3b8',
      note: theme.theme || `Sector: ${sector}`,
    },
    {
      num: '5', name: 'News & Events',
      score: result.catalysts?.length > 0 ? `${result.catalysts.length} catalysts` : '—',
      color: '#3b82f6',
      note: result.catalysts?.[0]?.summary || 'See News tab',
    },
    {
      num: '6', name: 'Macro',
      score: '—',
      color: '#94a3b8',
      note: mc ? `Equity: ${mc.equity_allocation_min}–${mc.equity_allocation_max}%` : 'See Macro tab',
    },
    {
      num: '7', name: 'Sector Trend',
      score: result.healthScore?.priceMomentum >= 3.5 ? 'Leader' : result.healthScore?.priceMomentum >= 2.5 ? 'Neutral' : 'Laggard',
      color: result.healthScore?.priceMomentum >= 3.5 ? '#22c55e' : result.healthScore?.priceMomentum >= 2.5 ? '#eab308' : '#ef4444',
      note: `${sector} momentum`,
    },
    {
      num: '8', name: 'Sentiment',
      score: result.healthScore?.priceMomentum != null ? mapSentiment(result.healthScore.priceMomentum) : '—',
      color: '#a855f7',
      note: 'Based on momentum + proTips',
    },
    {
      num: '9', name: 'Undervaluation',
      score: mos != null ? `${mos > 0 ? '+' : ''}${mos.toFixed(1)}% MOS` : '—',
      color: mos > 20 ? '#22c55e' : mos > 0 ? '#eab308' : '#ef4444',
      note: fairValue ? `FV ${fmtP(fairValue.intrinsicValue)} · CMP ${fmtP(fairValue.cmp)}` : 'See Verdict tab',
    },
  ];

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 14 }}>9-Skill Summary</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
          {skills.map(s => (
            <div key={s.num} style={{
              padding: '10px 14px', borderRadius: 10, background: 'var(--bg-secondary)',
              borderLeft: `3px solid ${s.color}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>SKILL {s.num} · {s.name.toUpperCase()}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: s.color }}>{s.score}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{s.note}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Verdict summary card */}
      <div className="card" style={{ borderLeft: `4px solid ${vc}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 24 }}>{VERDICT_ICON[verdict] || '—'}</span>
          <div>
            <span style={{ fontSize: 16, fontWeight: 800, color: vc }}>{verdict}</span>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {verdict === 'ACCUMULATE' ? 'All criteria aligned — act now in tranches'
                : verdict === 'ACCUMULATE (STAGED)' ? 'Good setup — buy in tranches on dips'
                : verdict === 'WATCH' ? 'Fundamentally strong — wait for technical trigger'
                : 'Market unfavourable — avoid new entry'}
            </div>
          </div>
        </div>
        {/* ProTips summary */}
        {result.proTips && result.proTips.length > 0 && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 600 }}>BULLS ({result.proTips.filter(t => t.type === 'bull').length})</span>
              {result.proTips.filter(t => t.type === 'bull').slice(0, 2).map((t, i) => (
                <div key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>↑ {t.text}</div>
              ))}
            </div>
            <div>
              <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 600 }}>BEARS ({result.proTips.filter(t => t.type === 'bear').length})</span>
              {result.proTips.filter(t => t.type === 'bear').slice(0, 2).map((t, i) => (
                <div key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>↓ {t.text}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bandhan AMC Strategy Card */}
      {(() => {
        const lcat = classifyLCategory(result.sector, result.industry, result.metrics?.roe, result.metrics?.de);
        const fit = getBandhanSectorFit(result.sector);
        const lColors = { L1: '#22c55e', L2: '#f59e0b', L3: '#ef4444' };
        const lLabels = { L1: 'High-quality structural business', L2: 'Mid-quality / cyclical transitional', L3: 'Highly cyclical / capital-intensive' };
        const lc = lColors[lcat];
        const bandhanVerdict =
          fit.label === 'Most Preferred' && lcat === 'L1' ? 'Strong Fit' :
          fit.label === 'Most Preferred' || (fit.label === 'Preferred' && lcat !== 'L3') ? 'Good Fit' :
          fit.label === 'Neutral' ? 'Neutral' :
          lcat === 'L3' ? 'Cyclical — time the cycle' : 'Cautious';
        const bvc = bandhanVerdict === 'Strong Fit' ? '#22c55e' : bandhanVerdict === 'Good Fit' ? '#4ade80' : bandhanVerdict === 'Neutral' ? '#eab308' : '#ef4444';
        return (
          <div className="card" style={{ borderLeft: `4px solid ${bvc}`, marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: 14 }}>Bandhan AMC Strategy Lens</h3>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 8, background: `${bvc}20`, color: bvc, border: `1px solid ${bvc}44` }}>
                {bandhanVerdict}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
              {/* L-Category */}
              <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--bg-secondary)', borderLeft: `3px solid ${lc}` }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>QUALITY BUCKET</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: lc }}>{lcat}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{lLabels[lcat]}</div>
              </div>
              {/* Sector Fit */}
              <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--bg-secondary)', borderLeft: `3px solid ${fit.color}` }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>SECTOR FIT (3-5yr)</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: fit.color }}>{fit.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{fit.note}</div>
              </div>
              {/* Capital Allocation */}
              {result.metrics?.roe != null && (
                <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--bg-secondary)', borderLeft: `3px solid ${result.metrics.roe * 100 > 20 ? '#22c55e' : result.metrics.roe * 100 > 12 ? '#eab308' : '#ef4444'}` }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>CAPITAL ALLOCATION</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: result.metrics.roe * 100 > 20 ? '#22c55e' : result.metrics.roe * 100 > 12 ? '#eab308' : '#ef4444' }}>
                    ROE {(result.metrics.roe * 100).toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {result.metrics.roe * 100 > 20 ? 'Excellent capital efficiency' : result.metrics.roe * 100 > 12 ? 'Moderate capital allocation' : 'Below-par returns on equity'}
                  </div>
                </div>
              )}
              {/* L3 caution note */}
              {lcat === 'L3' && (
                <div style={{ padding: '10px 14px', borderRadius: 10, background: '#ef444411', borderLeft: '3px solid #ef4444' }}>
                  <div style={{ fontSize: 10, color: '#ef4444', fontWeight: 600, marginBottom: 4 }}>CYCLE RISK</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Earnings volatile across cycles. Bandhan strategy: invest only when cycle is turning up.</div>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/* ══ SKILL 1: Fundamental Analysis ════════════════════════════════ */
function Skill1Fundamental({ result }) {
  const m = result.metrics || {};
  const p = (typeof result.healthScore === 'object' ? result.healthScore : null) || result.pillars || {};
  const hs = result.healthScore || {};
  const hsOverall = typeof hs === 'object' ? hs.overall : hs;
  const fundScore10 = hsOverall != null ? (Number(hsOverall) / 5) * 10 : null;

  const rows = [
    { category: 'Valuation', metrics: [
      { label: 'P/E Ratio', value: m.pe, fmt: v => v.toFixed(1), good: v => v > 0 && v < 25 },
      { label: 'Fwd P/E', value: m.forwardPe, fmt: v => v.toFixed(1), good: v => v > 0 && v < 22 },
      { label: 'EV/EBITDA', value: m.evEbitda, fmt: v => v.toFixed(1), good: v => v > 0 && v < 15 },
    ]},
    { category: 'Profitability', metrics: [
      { label: 'ROE', value: m.roe, fmt: v => `${v.toFixed(1)}%`, good: v => v > 15 },
      { label: 'ROCE', value: m.roce, fmt: v => `${v.toFixed(1)}%`, good: v => v > 15 },
      { label: 'Net Margin', value: m.profitMargin, fmt: v => `${v.toFixed(1)}%`, good: v => v > 10 },
    ]},
    { category: 'Growth', metrics: [
      { label: 'Revenue Growth', value: m.revenueGrowth, fmt: v => `${v.toFixed(0)}%`, good: v => v > 12 },
      { label: 'Earnings Growth', value: m.earningsGrowth, fmt: v => `${v.toFixed(0)}%`, good: v => v > 15 },
    ]},
    { category: 'Financial Health', metrics: [
      { label: 'D/E Ratio', value: m.de, fmt: v => v.toFixed(2), good: v => v < 0.5 },
      { label: 'Current Ratio', value: m.currentRatio, fmt: v => v.toFixed(2), good: v => v > 1.5 },
    ]},
  ];

  return (
    <div>
      <SectionHeader num="1" title="Fundamental Analysis" />
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          {fundScore10 != null && (
            <div style={{ textAlign: 'center', padding: '10px 20px', borderRadius: 10, background: 'var(--bg-secondary)' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>FUNDAMENTAL SCORE</div>
              <div style={{ fontSize: 36, fontWeight: 800, color: scoreColor10(fundScore10) }}>{fundScore10.toFixed(1)}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>out of 10</div>
            </div>
          )}
          {/* Pillar bars */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { key: 'profitability', label: 'Profitability', color: '#22c55e' },
              { key: 'growth', label: 'Growth', color: '#3b82f6' },
              { key: 'cashFlow', label: 'Cash Flow', color: '#06b6d4' },
              { key: 'relativeValue', label: 'Valuation', color: '#a78bfa' },
            ].map(pi => (
              <PillarBar key={pi.key} label={pi.label} score={hs[pi.key] ?? p[pi.key]} color={pi.color} />
            ))}
          </div>
        </div>
      </div>

      {/* Metric tables */}
      {rows.map(cat => (
        <div key={cat.category} className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>{cat.category.toUpperCase()}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
            {cat.metrics.map(mm => {
              const v = mm.value;
              if (v == null) return null;
              const good = mm.good(v);
              return (
                <div key={mm.label} style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--bg-secondary)', textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 3 }}>{mm.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: good ? '#22c55e' : '#f59e0b' }}>{mm.fmt(v)}</div>
                  <div style={{ fontSize: 9, color: good ? '#22c55e' : '#f59e0b' }}>{good ? '✓ Good' : '△ Watch'}</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* FCF / quality check */}
      {result.proTips && result.proTips.filter(t => t.type === 'bull').length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>QUALITY SIGNALS (BULLISH)</div>
          {result.proTips.filter(t => t.type === 'bull').map((t, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ color: '#22c55e', marginRight: 6 }}>↑</span>{t.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══ SKILL 2: Technical Analysis ══════════════════════════════════ */
const CHART_PERIODS = [
  { id: '1mo', label: '1M' }, { id: '3mo', label: '3M' },
  { id: '6mo', label: '6M' }, { id: '1y', label: '1Y' },
];

// Add calendar days to a date string (YYYY-MM-DD), skipping weekends
function addTradingDays(dateStr, calendarDays) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + calendarDays);
  // Skip to next weekday
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function PriceChart({ symbol, technicals = {} }) {
  const [chartData, setChartData] = useState(null);
  const [period, setPeriod] = useState('3mo');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    setChartData(null);
    api.getStockChart(symbol, period)
      .then(d => setChartData(d))
      .catch(() => setChartData(null))
      .finally(() => setLoading(false));
  }, [symbol, period]);

  const PriceTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    if (!d) return null;
    return (
      <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
        <div style={{ color: '#94a3b8', marginBottom: 4 }}>{label}</div>
        <div style={{ color: '#fff', fontWeight: 700 }}>₹{Number(d.close).toLocaleString('en-IN')}</div>
        {d.dma20 != null && <div style={{ color: '#f59e0b' }}>20 DMA: ₹{Number(d.dma20).toFixed(0)}</div>}
        {d.dma50 != null && <div style={{ color: '#3b82f6' }}>50 DMA: ₹{Number(d.dma50).toFixed(0)}</div>}
        {d.dma200 != null && <div style={{ color: '#a855f7' }}>200 DMA: ₹{Number(d.dma200).toFixed(0)}</div>}
      </div>
    );
  };

  const VolTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const vol = payload[0]?.value;
    return (
      <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '4px 8px', fontSize: 10 }}>
        <div style={{ color: '#64748b' }}>Vol: {vol ? (vol / 1e5).toFixed(1) + 'L' : '—'}</div>
      </div>
    );
  };

  const renderChart = () => {
    if (loading) return (
      <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
        Loading chart data...
      </div>
    );
    if (!chartData?.candles?.length) return (
      <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
        No chart data available
      </div>
    );

    const candles = chartData.candles;
    const chg = chartData.summary?.change_pct;
    const lineColor = chg == null || chg >= 0 ? '#22c55e' : '#ef4444';

    const tickEvery = Math.max(1, Math.floor(candles.length / 7));
    const ticks = candles.filter((_, i) => i % tickEvery === 0).map(c => c.date);

    const closes = candles.map(c => c.close).filter(v => v != null);

    // Build pattern lookup map from backend patterns
    const patternMap = {};
    (chartData.patterns || []).forEach(p => { patternMap[p.date] = p; });

    // Build prediction projection points
    const lastCandle = candles[candles.length - 1];
    const hasPred = lastCandle && (technicals.target_1d || technicals.target_7d || technicals.target_30d || technicals.target_90d);
    const predPoints = [];
    if (hasPred) {
      predPoints.push({ date: lastCandle.date, predicted: lastCandle.close });
      if (technicals.target_1d)  predPoints.push({ date: addTradingDays(lastCandle.date, 1),  predicted: Number(technicals.target_1d) });
      if (technicals.target_7d)  predPoints.push({ date: addTradingDays(lastCandle.date, 7),  predicted: Number(technicals.target_7d) });
      if (technicals.target_30d) predPoints.push({ date: addTradingDays(lastCandle.date, 30), predicted: Number(technicals.target_30d) });
      if (technicals.target_90d) predPoints.push({ date: addTradingDays(lastCandle.date, 90), predicted: Number(technicals.target_90d) });
    }

    // Merge: historical candles + future points (skip first predPoint — duplicate of lastCandle)
    const allData = hasPred
      ? [...candles, ...predPoints.slice(1).map(p => ({ date: p.date, predicted: p.predicted }))]
      : candles;

    // Mark last historical candle with predicted starting value
    if (hasPred) {
      const lastIdx = candles.length - 1;
      allData[lastIdx] = { ...allData[lastIdx], predicted: lastCandle.close };
    }

    // Inject pattern markers into data points
    for (let i = 0; i < allData.length; i++) {
      const pat = patternMap[allData[i].date];
      if (pat) {
        allData[i] = { ...allData[i], patternType: pat.type, patternName: pat.pattern, patternStrength: pat.strength };
      }
    }

    const levelPrices = [
      technicals.support ? Number(technicals.support) : null,
      technicals.resistance ? Number(technicals.resistance) : null,
    ].filter(Boolean);
    const allPrices = [...closes, ...predPoints.map(p => p.predicted).filter(Boolean), ...levelPrices];
    const yMin = Math.floor(Math.min(...allPrices) * 0.975);
    const yMax = Math.ceil(Math.max(...allPrices) * 1.025);

    const allTicks = allData.filter((_, i) => i % Math.max(1, Math.floor(allData.length / 7)) === 0).map(c => c.date);
    const confidence = technicals.confidence != null ? Number(technicals.confidence) : null;
    const predColor = '#f97316';

    const PredTooltip = ({ active, payload, label }) => {
      if (!active || !payload?.length) return null;
      const d = payload[0]?.payload;
      if (!d) return null;
      const patColor = d.patternType === 'bullish' ? '#22c55e' : d.patternType === 'bearish' ? '#ef4444' : '#94a3b8';
      return (
        <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
          <div style={{ color: '#94a3b8', marginBottom: 4 }}>{label}</div>
          {d.close != null && <div style={{ color: '#fff', fontWeight: 700 }}>₹{Number(d.close).toLocaleString('en-IN')}</div>}
          {d.predicted != null && d.close == null && <div style={{ color: predColor, fontWeight: 700 }}>Predicted: ₹{Number(d.predicted).toLocaleString('en-IN')}</div>}
          {d.predicted != null && d.close != null && <div style={{ color: predColor }}>Pred start: ₹{Number(d.predicted).toLocaleString('en-IN')}</div>}
          {d.dma20 != null && <div style={{ color: '#f59e0b' }}>20 DMA: ₹{Number(d.dma20).toFixed(0)}</div>}
          {d.dma50 != null && <div style={{ color: '#3b82f6' }}>50 DMA: ₹{Number(d.dma50).toFixed(0)}</div>}
          {d.dma200 != null && <div style={{ color: '#a855f7' }}>200 DMA: ₹{Number(d.dma200).toFixed(0)}</div>}
          {d.patternName && (
            <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid #1e293b', color: patColor, fontWeight: 700 }}>
              {'★'.repeat(d.patternStrength || 1)} {d.patternName}
            </div>
          )}
        </div>
      );
    };

    // Custom dot renderer — triangle markers for candlestick patterns
    const PatternDot = (props) => {
      const { cx, cy, payload } = props;
      if (!payload.patternType || !payload.close) return null;
      const isBull = payload.patternType === 'bullish';
      const isNeutral = payload.patternType === 'neutral';
      const color = isBull ? '#22c55e' : isNeutral ? '#94a3b8' : '#ef4444';
      const s = (payload.patternStrength || 1) + 2; // size 3–5
      if (isBull) {
        // upward triangle below the price line
        const pts = `${cx},${cy + s + 4} ${cx - s},${cy + s * 2 + 4} ${cx + s},${cy + s * 2 + 4}`;
        return <polygon key={`bull-${payload.date}`} points={pts} fill={color} stroke="#0f172a" strokeWidth={0.5} />;
      } else if (isNeutral) {
        return <circle key={`neu-${payload.date}`} cx={cx} cy={cy} r={s - 1} fill={color} stroke="#0f172a" strokeWidth={0.5} />;
      } else {
        // downward triangle above the price line
        const pts = `${cx},${cy - s - 4} ${cx - s},${cy - s * 2 - 4} ${cx + s},${cy - s * 2 - 4}`;
        return <polygon key={`bear-${payload.date}`} points={pts} fill={color} stroke="#0f172a" strokeWidth={0.5} />;
      }
    };

    return (
      <>
        {/* Prediction summary banner */}
        {hasPred && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {confidence != null && (
              <span style={{ fontSize: 10, background: 'rgba(249,115,22,0.12)', color: predColor, padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
                AI Confidence: {confidence.toFixed(0)}%
              </span>
            )}
            {technicals.target_1d && (() => {
              const cmp = lastCandle.close;
              const t1 = Number(technicals.target_1d);
              const pct = cmp ? ((t1 - cmp) / cmp * 100) : null;
              const absPct = Math.abs(pct);
              const c = t1 >= cmp ? '#22c55e' : '#ef4444';
              // Flag unrealistic 1d moves (>5%) as momentum extrapolation noise
              const isExtreme = absPct > 5;
              return (
                <span title={isExtreme ? `⚠️ ${absPct.toFixed(1)}% in 1 day is a momentum slope extrapolation — not a realistic intraday target. Use 7d/30d targets for decisions.` : '1-day momentum target'}
                  style={{ fontSize: 10, background: '#0f172a', color: '#94a3b8', padding: '2px 8px', borderRadius: 4, border: `1px solid ${isExtreme ? '#94a3b822' : c + '55'}`, opacity: isExtreme ? 0.6 : 1, cursor: isExtreme ? 'help' : 'default' }}>
                  1d → <span style={{ color: isExtreme ? '#64748b' : c, fontWeight: 700 }}>₹{t1.toLocaleString('en-IN')}</span>
                  {pct != null && <span style={{ color: isExtreme ? '#64748b' : c, marginLeft: 4 }}>({pct >= 0 ? '+' : ''}{pct.toFixed(2)}%{isExtreme ? ' ⚠️' : ''})</span>}
                </span>
              );
            })()}
            {technicals.target_7d && (() => {
              const cmp = lastCandle.close;
              const t7 = Number(technicals.target_7d);
              const pct = cmp ? ((t7 - cmp) / cmp * 100).toFixed(2) : null;
              const low = technicals.target_7d_low ? Number(technicals.target_7d_low) : null;
              const high = technicals.target_7d_high ? Number(technicals.target_7d_high) : null;
              return (
                <span style={{ fontSize: 10, background: '#0f172a', color: '#94a3b8', padding: '2px 8px', borderRadius: 4, border: '1px solid #1e293b' }}>
                  7d → <span style={{ color: predColor, fontWeight: 700 }}>₹{t7.toLocaleString('en-IN')}</span>
                  {pct && <span style={{ color: predColor, marginLeft: 4 }}>({pct >= 0 ? '+' : ''}{pct}%)</span>}
                  {low && high && <span style={{ color: '#475569', marginLeft: 4 }}>[{Number(low).toLocaleString('en-IN')}–{Number(high).toLocaleString('en-IN')}]</span>}
                </span>
              );
            })()}
            {technicals.target_30d && (
              <span style={{ fontSize: 10, background: '#0f172a', color: '#94a3b8', padding: '2px 8px', borderRadius: 4, border: '1px solid #1e293b' }}>
                30d → <span style={{ color: predColor, fontWeight: 700 }}>₹{Number(technicals.target_30d).toLocaleString('en-IN')}</span>
              </span>
            )}
            {technicals.target_90d && (
              <span style={{ fontSize: 10, background: '#0f172a', color: '#94a3b8', padding: '2px 8px', borderRadius: 4, border: '1px solid #1e293b' }}>
                90d → <span style={{ color: predColor, fontWeight: 700 }}>₹{Number(technicals.target_90d).toLocaleString('en-IN')}</span>
              </span>
            )}
          </div>
        )}

        {/* Price + DMA + Prediction */}
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={allData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis dataKey="date" ticks={allTicks} tick={{ fontSize: 9, fill: '#475569' }}
              tickLine={false} axisLine={false} />
            <YAxis domain={[yMin, yMax]} tick={{ fontSize: 9, fill: '#475569' }}
              tickLine={false} axisLine={false}
              tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v}
              width={48} />
            <Tooltip content={<PredTooltip />} />
            {hasPred && (
              <ReferenceLine x={lastCandle.date} stroke="#334155" strokeDasharray="4 3" label={{ value: 'Today', position: 'insideTopRight', fontSize: 8, fill: '#475569' }} />
            )}
            {technicals.support && (
              <ReferenceLine y={Number(technicals.support)} stroke="#22c55e" strokeDasharray="3 3" strokeWidth={1}
                label={{ value: `S ₹${Number(technicals.support).toLocaleString('en-IN')}`, position: 'insideBottomRight', fontSize: 8, fill: '#22c55e' }} />
            )}
            {technicals.resistance && (
              <ReferenceLine y={Number(technicals.resistance)} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1}
                label={{ value: `R ₹${Number(technicals.resistance).toLocaleString('en-IN')}`, position: 'insideTopRight', fontSize: 8, fill: '#ef4444' }} />
            )}
            <Line type="monotone" dataKey="close" stroke={lineColor}
              dot={(props) => <PatternDot {...props} />}
              activeDot={{ r: 4, fill: lineColor }}
              strokeWidth={2} connectNulls />
            <Line type="monotone" dataKey="dma20" stroke="#f59e0b" dot={false} strokeWidth={1.5}
              strokeDasharray="4 3" connectNulls />
            <Line type="monotone" dataKey="dma50" stroke="#3b82f6" dot={false} strokeWidth={1.5}
              strokeDasharray="4 3" connectNulls />
            <Line type="monotone" dataKey="dma200" stroke="#a855f7" dot={false} strokeWidth={1}
              strokeDasharray="3 3" connectNulls />
            {hasPred && (
              <Line type="monotone" dataKey="predicted" stroke={predColor} dot={(props) => {
                const { cx, cy, payload } = props;
                if (!payload.predicted || payload.close != null && payload.close !== payload.predicted) return null;
                return <circle key={payload.date} cx={cx} cy={cy} r={3} fill={predColor} stroke="#0f172a" strokeWidth={1} />;
              }} strokeWidth={2} strokeDasharray="6 3" connectNulls />
            )}
          </ComposedChart>
        </ResponsiveContainer>

        {/* Volume bars — separate chart beneath */}
        <ResponsiveContainer width="100%" height={50}>
          <ComposedChart data={candles} margin={{ top: 2, right: 4, bottom: 0, left: 0 }}>
            <XAxis dataKey="date" hide />
            <YAxis hide />
            <Tooltip content={<VolTooltip />} />
            <Bar dataKey="volume" fill="#334155" radius={[1, 1, 0, 0]} />
          </ComposedChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 14, marginTop: 4, flexWrap: 'wrap', fontSize: 10, color: '#475569' }}>
          {[
            { color: lineColor, label: 'Close Price', dash: false },
            { color: '#f59e0b', label: '20 DMA', dash: true },
            { color: '#3b82f6', label: '50 DMA', dash: true },
            { color: '#a855f7', label: '200 DMA', dash: true },
            ...(hasPred ? [{ color: predColor, label: 'AI Prediction', dash: true }] : []),
            ...(technicals.support ? [{ color: '#22c55e', label: 'Support', dash: true }] : []),
            ...(technicals.resistance ? [{ color: '#ef4444', label: 'Resistance', dash: true }] : []),
          ].map(l => (
            <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <svg width="18" height="6">
                {l.dash
                  ? <line x1="0" y1="3" x2="18" y2="3" stroke={l.color} strokeWidth="1.5" strokeDasharray="4 2" />
                  : <line x1="0" y1="3" x2="18" y2="3" stroke={l.color} strokeWidth="2" />
                }
              </svg>
              {l.label}
            </span>
          ))}
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, background: '#334155', borderRadius: 1 }} />
            Volume
          </span>
          {Object.keys(patternMap).length > 0 && (
            <>
              <span style={{ color: '#22c55e', display: 'flex', alignItems: 'center', gap: 3 }}>
                <svg width="10" height="10"><polygon points="5,0 0,10 10,10" fill="#22c55e" /></svg>
                Bullish
              </span>
              <span style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: 3 }}>
                <svg width="10" height="10"><polygon points="5,10 0,0 10,0" fill="#ef4444" /></svg>
                Bearish
              </span>
            </>
          )}
        </div>

        {/* Recent candlestick patterns */}
        {Object.keys(patternMap).length > 0 && (() => {
          const recent = Object.values(patternMap)
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 8);
          return (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                CANDLESTICK PATTERNS DETECTED ({Object.keys(patternMap).length} in period)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {recent.map(p => {
                  const isBull = p.type === 'bullish';
                  const isNeu  = p.type === 'neutral';
                  const c = isBull ? '#22c55e' : isNeu ? '#94a3b8' : '#ef4444';
                  const icon = isBull ? '▲' : isNeu ? '◆' : '▼';
                  return (
                    <div key={p.date} style={{
                      display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px',
                      borderRadius: 5, background: `${c}12`, border: `1px solid ${c}30`,
                      fontSize: 10,
                    }}>
                      <span style={{ color: c, fontSize: 8 }}>{icon}</span>
                      <span style={{ color: c, fontWeight: 700 }}>{p.pattern}</span>
                      <span style={{ color: '#475569' }}>{p.date}</span>
                      <span style={{ color: '#334155' }}>{'★'.repeat(p.strength)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </>
    );
  };

  const chg = chartData?.summary?.change_pct;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Price Chart</span>
          {chg != null && (
            <span style={{ fontSize: 12, fontWeight: 700, color: chg >= 0 ? '#22c55e' : '#ef4444' }}>
              {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%
            </span>
          )}
          {chartData?.summary && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              H: ₹{Number(chartData.summary.high).toLocaleString('en-IN')} · L: ₹{Number(chartData.summary.low).toLocaleString('en-IN')}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {CHART_PERIODS.map(p2 => (
            <button key={p2.id} onClick={() => setPeriod(p2.id)}
              style={{
                padding: '3px 10px', borderRadius: 5, fontSize: 11,
                border: `1px solid ${period === p2.id ? '#3b82f6' : 'var(--border)'}`,
                background: period === p2.id ? 'rgba(59,130,246,0.15)' : 'transparent',
                color: period === p2.id ? '#60a5fa' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: period === p2.id ? 700 : 400,
              }}>
              {p2.label}
            </button>
          ))}
        </div>
      </div>
      {renderChart()}
    </div>
  );
}

function Skill2Technical({ result, symbol }) {
  const m = result.metrics || {};
  const p = (typeof result.healthScore === 'object' ? result.healthScore : null) || result.pillars || {};
  const technicals = result.technicals || {};

  const indicators = [
    { name: 'VWAP', status: technicals.aboveVwap ?? (p.priceMomentum >= 3 ? true : null), labels: ['Above', 'Below'] },
    { name: 'Supertrend', status: technicals.supertrendBuy ?? (p.priceMomentum >= 3.5 ? true : null), labels: ['Buy', 'Sell'] },
    { name: 'Ichimoku Cloud', status: technicals.aboveCloud ?? null, labels: ['Above Cloud', 'Below Cloud'] },
    { name: 'RSI Trend', status: m.rsi ? m.rsi > 50 : null, labels: ['Above 50 (Bullish)', 'Below 50 (Bearish)'] },
    { name: 'MACD', status: technicals.macdBullish ?? (p.priceMomentum >= 3 ? true : null), labels: ['Bullish', 'Bearish'] },
  ];

  const bullCount = indicators.filter(i => i.status === true).length;
  const confluence = `${bullCount}/${indicators.length}`;

  return (
    <div>
      <SectionHeader num="2" title="Technical Analysis" />

      {/* Price Chart */}
      <PriceChart symbol={symbol} technicals={technicals} />

      {/* Signal confluence */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'center', padding: '10px 18px', borderRadius: 10, background: 'var(--bg-secondary)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>SIGNAL CONFLUENCE</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: bullCount >= 4 ? '#22c55e' : bullCount >= 2 ? '#eab308' : '#ef4444' }}>
              {confluence}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>indicators aligned</div>
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>MOMENTUM PILLAR</div>
          {p.priceMomentum != null && <PillarBar label="Price Momentum" score={p.priceMomentum} color="#f59e0b" />}
        </div>

        {/* Indicator status grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
          {indicators.map(ind => (
            <div key={ind.name} style={{
              padding: '8px 12px', borderRadius: 8, background: 'var(--bg-secondary)',
              border: `1px solid ${ind.status === true ? '#22c55e33' : ind.status === false ? '#ef444433' : '#33415533'}`,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 16 }}>{ind.status === true ? '✅' : ind.status === false ? '❌' : '⚠️'}</span>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600 }}>{ind.name}</div>
                <div style={{ fontSize: 10, color: ind.status === true ? '#22c55e' : ind.status === false ? '#ef4444' : '#94a3b8' }}>
                  {ind.status === true ? ind.labels[0] : ind.status === false ? ind.labels[1] : 'No Data'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Price levels */}
      {(technicals.support || technicals.resistance || result.fairValue) && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>PRICE LEVELS</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
            {technicals.support && <LevelCard label="Support" value={technicals.support} color="#22c55e" />}
            {technicals.resistance && <LevelCard label="Resistance" value={technicals.resistance} color="#ef4444" />}
            {result.fairValue?.intrinsicValue && <LevelCard label="Fair Value" value={result.fairValue.intrinsicValue} color="#3b82f6" />}
            {technicals.entry && <LevelCard label="Entry Zone" value={technicals.entry} color="#a855f7" />}
          </div>
        </div>
      )}

      {/* Chart pattern */}
      {technicals.pattern && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid #3b82f6' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>CHART PATTERN IDENTIFIED</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{technicals.pattern}</div>
          {technicals.breakoutLevel && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Breakout level: {fmtP(technicals.breakoutLevel)} (confirm with volume)
            </div>
          )}
        </div>
      )}

      {/* RSI note from skills.md */}
      <div className="card" style={{ background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.2)' }}>
        <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.7 }}>
          <strong style={{ color: '#3b82f6' }}>Skills.md Rule:</strong>{' '}
          RSI/MACD are supplementary — always confirm with VWAP + Supertrend. RSI &gt; 60 in uptrend = momentum; RSI &lt; 40 = weakness.
          Bullish divergence (price falling, RSI rising) = reversal watch. MACD crossover above zero = buy signal.
        </div>
      </div>
    </div>
  );
}

/* ══ SKILL 3: Market Condition ════════════════════════════════════ */
function Skill3Market({ mc }) {
  if (!mc) return (
    <div>
      <SectionHeader num="3" title="Market Condition Scanner" />
      <div className="card" style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>
        Market condition data not available.
      </div>
    </div>
  );

  const regime = mc.regime;
  const rc = REGIME_COLOR[regime] || '#64748b';
  const label = regime === 'STRONG_BULL' ? 'BULL MARKET' : regime === 'BULL' ? 'BULL MARKET'
    : regime === 'NEUTRAL' ? 'SIDEWAYS' : regime === 'BEAR' ? 'BEAR MARKET' : 'BEAR MARKET';

  return (
    <div>
      <SectionHeader num="3" title="Market Condition Scanner" />

      <div className="card" style={{ marginBottom: 16, borderLeft: `4px solid ${rc}` }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ textAlign: 'center', padding: '10px 18px', borderRadius: 10, background: `${rc}10` }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>REGIME</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: rc }}>{regime?.replace('_', ' ')}</div>
            <div style={{ fontSize: 10, color: rc, marginTop: 2 }}>{label}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>SKILLS.MD PRESCRIPTION</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 8 }}>
              {regime === 'STRONG_BULL' || regime === 'BULL'
                ? 'Deploy capital; prefer growth + momentum stocks.'
                : regime === 'NEUTRAL'
                  ? 'Sector rotation; focus on relative strength; accumulate quality in tranches.'
                  : 'Preserve capital; only defensives/cash/gold. Tighten stops.'}
            </div>
          </div>
        </div>

        {/* Key stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
          {[
            { label: 'Nifty 50', value: mc.nifty_price ? Number(mc.nifty_price).toLocaleString('en-IN') : '—', color: 'var(--text-primary)' },
            { label: 'vs 200 DMA', value: mc.nifty_vs_200dma_pct != null ? `${mc.nifty_vs_200dma_pct >= 0 ? '+' : ''}${mc.nifty_vs_200dma_pct.toFixed(1)}%` : '—', color: mc.nifty_vs_200dma_pct >= 0 ? '#22c55e' : '#ef4444' },
            { label: 'India VIX', value: mc.vix != null ? mc.vix.toFixed(1) : '—', color: mc.vix > 25 ? '#ef4444' : mc.vix > 18 ? '#f97316' : '#22c55e' },
            { label: 'Trend', value: mc.trend_direction || '—', color: mc.trend_direction === 'UPTREND' ? '#22c55e' : mc.trend_direction === 'DOWNTREND' ? '#ef4444' : '#eab308' },
            { label: 'Equity Alloc.', value: `${mc.equity_allocation_min}–${mc.equity_allocation_max}%`, color: rc },
            { label: 'ADD if Score ≥', value: `${mc.add_score_threshold}`, color: rc },
          ].map(stat => (
            <div key={stat.label} style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--bg-secondary)', textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 3 }}>{stat.label}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: stat.color }}>{stat.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Sector bias */}
      {mc.sector_bias && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>SECTOR ROTATION ADVICE</div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {mc.sector_bias.favour?.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#22c55e', marginBottom: 6 }}>FAVOUR</div>
                {mc.sector_bias.favour.map((s, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '3px 0' }}>✓ {s}</div>
                ))}
              </div>
            )}
            {mc.sector_bias.avoid?.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', marginBottom: 6 }}>AVOID</div>
                {mc.sector_bias.avoid.map((s, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '3px 0' }}>✗ {s}</div>
                ))}
              </div>
            )}
          </div>
          {mc.sector_bias.note && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, fontStyle: 'italic' }}>
              {mc.sector_bias.note}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ══ SKILL 4: India Growth Story ══════════════════════════════════ */
function Skill4India({ result }) {
  const sector = result.sector || '';
  const theme = getTheme(sector);
  const alignColor = theme.alignment === 'Strong' ? '#22c55e' : theme.alignment === 'Moderate' ? '#eab308' : '#94a3b8';

  const THEMES_TABLE = [
    { theme: 'Infrastructure & CapEx supercycle', sectors: 'Capital goods, Cement, Steel, Roads', icon: '🏗' },
    { theme: 'Digital & AI adoption', sectors: 'IT services, SaaS, Fintech, Semiconductors', icon: '💻' },
    { theme: 'PLI-driven manufacturing', sectors: 'Electronics, Pharma API, Auto components, Textiles', icon: '🏭' },
    { theme: 'Energy transition', sectors: 'Green hydrogen, Solar EPC, Wind, Power T&D', icon: '⚡' },
    { theme: 'Financial inclusion', sectors: 'Microfinance, Small finance banks, Insurance', icon: '🏦' },
    { theme: 'Consumption upgrade', sectors: 'QSR, FMCG premiumization, Luxury, Travel', icon: '🛍' },
    { theme: 'Defence indigenization', sectors: 'HAL, BEL, DRDO-linked companies', icon: '🛡' },
    { theme: 'Healthcare & diagnostics', sectors: 'Hospitals, Medtech, CDMO Pharma', icon: '🏥' },
  ];

  return (
    <div>
      <SectionHeader num="4" title="India Growth Story (2024–2030)" />

      {/* Stock theme alignment */}
      <div className="card" style={{ marginBottom: 16, borderLeft: `4px solid ${alignColor}` }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>THEME ALIGNMENT</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: alignColor }}>{theme.alignment}</div>
        <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{theme.theme || `Sector: ${sector}`}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          {theme.alignment === 'Strong'
            ? 'Direct beneficiary of India 2030 structural theme — tailwind for multi-year returns.'
            : theme.alignment === 'Moderate'
              ? 'Indirect beneficiary — check policy tailwinds (PLI, NIP) for specific catalyst.'
              : 'Limited structural tailwind — evaluate on standalone fundamentals.'}
        </div>
      </div>

      {/* All themes table */}
      <div className="card">
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 12 }}>CORE INDIA 2030 THEMES</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {THEMES_TABLE.map((t, i) => {
            const isActive = theme.theme === t.theme;
            return (
              <div key={i} style={{
                padding: '8px 12px', borderRadius: 8,
                background: isActive ? 'rgba(59,130,246,0.08)' : 'var(--bg-secondary)',
                border: isActive ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent',
              }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 16 }}>{t.icon}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: isActive ? 700 : 500, color: isActive ? '#3b82f6' : 'var(--text-primary)' }}>
                      {t.theme} {isActive && '← This stock'}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{t.sectors}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ══ SKILL 5: News & Events ═══════════════════════════════════════ */
function Skill5News({ result }) {
  const catalysts = result.catalysts || [];
  const risks     = result.risks     || [];
  const gov       = result.governance;

  const EVENTS_CHECKLIST = [
    'Earnings beats/misses vs estimates',
    'Management commentary (guidance raised/cut)',
    'Promoter buying/selling + pledge %',
    'Institutional block deals',
    'Board changes, auditor qualifications',
    'Regulatory approvals / rejections',
    'Major order wins or contract cancellations',
    'Litigation / scam / fraud alerts',
  ];

  return (
    <div>
      <SectionHeader num="5" title="News & Company Events" />

      {catalysts.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#22c55e', marginBottom: 10 }}>CATALYSTS & POSITIVE EVENTS</div>
          {catalysts.map((c, i) => (
            <div key={i} style={{ padding: '8px 12px', background: 'rgba(34,197,94,0.06)', borderRadius: 8, marginBottom: 6, fontSize: 12, borderLeft: '3px solid #22c55e' }}>
              <div style={{ fontWeight: 600 }}>{c.title || c.summary || c}</div>
              {c.source && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3 }}>Source: {c.source} · {c.date || ''}</div>}
            </div>
          ))}
        </div>
      )}

      {risks.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#ef4444', marginBottom: 10 }}>RISK EVENTS & WARNINGS</div>
          {risks.map((r, i) => (
            <div key={i} style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.06)', borderRadius: 8, marginBottom: 6, fontSize: 12, borderLeft: '3px solid #ef4444' }}>
              {r.title || r.summary || r}
            </div>
          ))}
        </div>
      )}

      {gov && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>GOVERNANCE ASSESSMENT</div>
          {Object.entries(gov).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>{k}</span>
              <span style={{ fontWeight: 600 }}>{v}</span>
            </div>
          ))}
        </div>
      )}

      {/* Checklist */}
      <div className="card">
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>EVENTS CHECKLIST (SKILLS.MD)</div>
        {EVENTS_CHECKLIST.map((item, i) => (
          <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '4px 0', display: 'flex', gap: 8 }}>
            <span style={{ color: '#3b82f6' }}>→</span> {item}
          </div>
        ))}
        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 8, fontStyle: 'italic' }}>
          Rule: All news claims must include citation (source + date). No uncited claims.
        </div>
      </div>
    </div>
  );
}

/* ══ SKILL 6: Macro & Global Flows ═══════════════════════════════ */
function Skill6Macro({ result, mc }) {
  const MACRO_TABLE = [
    { factor: 'FII Flows',       bull: 'Net buyers in cash market', bear: 'Sustained sellers / futures short' },
    { factor: 'DII Flows',       bull: 'Buying on FII dip (support)', bear: 'Both selling = danger zone' },
    { factor: 'INR/USD',         bull: 'INR strengthening < 83', bear: 'INR weakening > 85+' },
    { factor: 'Crude Oil (Brent)', bull: 'Below $80/barrel', bear: 'Above $90/barrel' },
    { factor: 'US 10Y Yield',    bull: 'Falling / below 4%', bear: 'Rising / above 4.5%' },
    { factor: 'US Dollar (DXY)', bull: 'DXY falling (EM positive)', bear: 'DXY rising > 105' },
    { factor: 'Nikkei / Hang Seng', bull: 'Stable / rising', bear: 'Sharp fall = risk-off' },
    { factor: 'S&P 500 trend',   bull: 'Above 200 DMA', bear: 'Break below 200 DMA' },
  ];

  const macroScore = mc ? (mc.regime_score > 40 ? 6 : mc.regime_score > 0 ? 4 : mc.regime_score > -40 ? 3 : 1) : null;

  return (
    <div>
      <SectionHeader num="6" title="Macro & Global Flows" />

      {mc && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'center', padding: '8px 18px', borderRadius: 10, background: 'var(--bg-secondary)' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>MACRO SCORE</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: macroScore >= 5 ? '#22c55e' : macroScore >= 3 ? '#eab308' : '#ef4444' }}>
                {macroScore}/8
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Bullish factors</div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6, flex: 1 }}>
              {macroScore >= 5 ? '≥ 5/8 macro factors Bullish → Increase exposure, add to winners'
                : macroScore >= 4 ? 'Mixed → Stock-specific; prefer large-cap, avoid high-beta'
                : '≥ 4/8 macro factors Bearish → Reduce exposure, raise cash'}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>MACRO FACTORS DASHBOARD (SKILLS.MD)</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600, color: 'var(--text-muted)', fontSize: 10 }}>FACTOR</th>
                <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600, color: '#22c55e', fontSize: 10 }}>BULLISH SIGNAL</th>
                <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600, color: '#ef4444', fontSize: 10 }}>BEARISH SIGNAL</th>
              </tr>
            </thead>
            <tbody>
              {MACRO_TABLE.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 10px', fontWeight: 600 }}>{row.factor}</td>
                  <td style={{ padding: '6px 10px', color: '#22c55e', fontSize: 11 }}>{row.bull}</td>
                  <td style={{ padding: '6px 10px', color: '#ef4444', fontSize: 11 }}>{row.bear}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ══ SKILL 7: Sector Trend ════════════════════════════════════════ */
function Skill7Sector({ result }) {
  const p = (typeof result.healthScore === 'object' ? result.healthScore : null) || result.pillars || {};
  const sector = result.sector || '—';
  const momentum = p.priceMomentum;
  const isLeader = momentum >= 3.5;
  const isLaggard = momentum != null && momentum < 2.5;
  const trendLabel = isLeader ? 'Leader' : isLaggard ? 'Laggard' : 'Neutral';
  const trendColor = isLeader ? '#22c55e' : isLaggard ? '#ef4444' : '#eab308';

  const ROTATION = [
    { phase: 'Economic Expansion', sectors: 'Tech, Industrials, Consumer Discretionary', active: ['Technology', 'Capital Goods', 'Consumer'] },
    { phase: 'Peak',               sectors: 'Energy, Materials, Healthcare', active: ['Energy', 'Metals', 'Healthcare'] },
    { phase: 'Contraction',        sectors: 'Utilities, Staples, Healthcare', active: ['FMCG', 'Pharma'] },
    { phase: 'Recovery',           sectors: 'Financials, Real Estate, Consumer Discretionary', active: ['Banking', 'Financial Services', 'Realty'] },
  ];

  return (
    <div>
      <SectionHeader num="7" title="Sector Trend Analyzer" />

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ textAlign: 'center', padding: '10px 18px', borderRadius: 10, background: `${trendColor}10`, border: `1px solid ${trendColor}30` }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>SECTOR STATUS</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: trendColor }}>{trendLabel}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{sector}</div>
          </div>
          {momentum != null && <PillarBar label="Price Momentum Score" score={momentum} color={trendColor} />}
        </div>
      </div>

      {/* Sector Rotation Matrix */}
      <div className="card">
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>SECTOR ROTATION MATRIX (SKILLS.MD)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
          {ROTATION.map((phase, i) => {
            const isActive = phase.active.some(s => sector.includes(s));
            return (
              <div key={i} style={{
                padding: '10px 12px', borderRadius: 8,
                background: isActive ? 'rgba(59,130,246,0.08)' : 'var(--bg-secondary)',
                border: isActive ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent',
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: isActive ? '#3b82f6' : 'var(--text-muted)', marginBottom: 4 }}>
                  {phase.phase} {isActive && '← Current'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{phase.sectors}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ══ SKILL 8: Sentiment ═══════════════════════════════════════════ */
function Skill8Sentiment({ result }) {
  const p      = (typeof result.healthScore === 'object' ? result.healthScore : null) || result.pillars || {};
  const tips   = result.proTips || [];
  const bulls  = tips.filter(t => t.type === 'bull');
  const bears  = tips.filter(t => t.type === 'bear');
  const sentiment = mapSentiment(p.priceMomentum);
  const sentColor = sentiment.includes('Bullish') ? '#22c55e' : sentiment.includes('Bearish') ? '#ef4444' : '#eab308';

  return (
    <div>
      <SectionHeader num="8" title="Sentiment Analysis" />

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ textAlign: 'center', padding: '10px 20px', borderRadius: 10, background: `${sentColor}10`, border: `1px solid ${sentColor}30` }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>SENTIMENT</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: sentColor }}>{sentiment}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#22c55e', marginBottom: 2 }}>BULLISH SIGNALS</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#22c55e' }}>{bulls.length}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#ef4444', marginBottom: 2 }}>BEARISH SIGNALS</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#ef4444' }}>{bears.length}</div>
              </div>
            </div>
          </div>
        </div>

        {/* ProTips */}
        {tips.length > 0 && (
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {bulls.length > 0 && (
              <div style={{ flex: '1 1 200px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#22c55e', marginBottom: 6 }}>BULLISH SIGNALS</div>
                {bulls.map((t, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: '#22c55e', marginRight: 6 }}>↑</span>{t.text}
                  </div>
                ))}
              </div>
            )}
            {bears.length > 0 && (
              <div style={{ flex: '1 1 200px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#ef4444', marginBottom: 6 }}>BEARISH SIGNALS</div>
                {bears.map((t, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: '#ef4444', marginRight: 6 }}>↓</span>{t.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sentiment sources (skills.md table) */}
      <div className="card">
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>SENTIMENT DATA SOURCES (SKILLS.MD)</div>
        {[
          { source: 'Analyst Ratings', signal: 'Consensus direction + target price' },
          { source: 'Institutional Activity', signal: 'FII/DII holding change QoQ' },
          { source: 'Options Data', signal: 'PCR > 1.2 = bullish; < 0.8 = bearish' },
          { source: 'Short Interest / F&O OI', signal: 'Rising OI + price fall = bearish' },
          { source: 'News Sentiment Score', signal: 'Positive / Neutral / Negative ratio' },
          { source: 'Social Media (X, Reddit)', signal: 'Retail buzz; contrarian at extremes' },
        ].map((row, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontWeight: 500 }}>{row.source}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{row.signal}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══ FUTURE RESULTS TAB ═══════════════════════════════════════════ */
function FutureResultsTab({ symbol, result }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [subTab, setSubTab] = useState('overview');

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    setData(null);
    api.getStockFutureResults(symbol)
      .then(d => setData(d))
      .catch(e => setError(e?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [symbol]);

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 12 }}>
      <div className="spinner" style={{ margin: '0 auto 12px' }} />
      Loading financial forecasts...
    </div>
  );
  if (error) return (
    <div className="card" style={{ color: '#ef4444', textAlign: 'center', padding: 24, fontSize: 12 }}>{error}</div>
  );
  if (!data) return null;

  const km = data.keyMetrics || {};
  const at = data.analystTargets || {};
  const proj = data.projections;
  const technicals = result.technicals || {};
  const cmp = at.currentPrice || result.cmp;

  const recColors = {
    'strong_buy': '#22c55e', 'buy': '#4ade80', 'hold': '#eab308',
    'sell': '#f97316', 'strong_sell': '#ef4444', 'underperform': '#ef4444',
  };
  const recColor = recColors[(at.recommendationKey || '').toLowerCase()] || '#64748b';
  const recLabel = (at.recommendationKey || '').replace('_', ' ').toUpperCase() || '—';

  const subTabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'quarterly', label: 'Quarterly P&L' },
    { id: 'annual', label: 'Annual P&L' },
    { id: 'estimates', label: 'Analyst Estimates' },
    { id: 'projections', label: 'AI Projections' },
  ];

  const FinTable = ({ tableData, title }) => {
    if (!tableData?.rows?.length) return (
      <div style={{ color: 'var(--text-muted)', fontSize: 11, padding: 8 }}>No data available</div>
    );
    const { periods, rows } = tableData;
    const keyMetricRows = ['Total Revenue', 'Gross Profit', 'Operating Income', 'Net Income', 'EBITDA', 'Basic EPS'];
    return (
      <div style={{ overflowX: 'auto' }}>
        {title && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>{title}</div>}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #1e293b', minWidth: 140 }}>Metric</th>
              {periods.map(p => (
                <th key={p} style={{ textAlign: 'right', padding: '6px 8px', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap' }}>{p}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isKey = keyMetricRows.includes(row.label);
              // Compute YoY growth for last vs prev value
              const vals = row.values;
              const growth = vals.length >= 2 && vals[0] && vals[1] ? ((vals[0] / vals[1]) - 1) * 100 : null;
              return (
                <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                  <td style={{ padding: '6px 8px', color: isKey ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: isKey ? 600 : 400 }}>
                    {row.label}
                    {isKey && growth != null && (
                      <span style={{ marginLeft: 6, fontSize: 9, color: growth >= 0 ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
                        {growth >= 0 ? '▲' : '▼'}{Math.abs(growth).toFixed(1)}% YoY
                      </span>
                    )}
                  </td>
                  {vals.map((v, j) => (
                    <td key={j} style={{ textAlign: 'right', padding: '6px 8px', color: v == null ? '#334155' : v < 0 ? '#ef4444' : isKey ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: isKey ? 600 : 400 }}>
                      {v == null ? '—' : row.label.includes('EPS') ? `₹${v.toFixed(2)}` : `₹${v.toLocaleString('en-IN')}Cr`}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ fontSize: 9, color: '#334155', marginTop: 4 }}>* Values in ₹ Crore except EPS. Source: yfinance.</div>
      </div>
    );
  };

  const EstimateTable = ({ tableData, title, isCurrency }) => {
    if (!tableData?.length) return (
      <div style={{ color: 'var(--text-muted)', fontSize: 11, padding: 8 }}>Analyst estimates not available for this stock.</div>
    );
    const allKeys = Object.keys(tableData[0]).filter(k => k !== 'period');
    return (
      <div style={{ overflowX: 'auto' }}>
        {title && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>{title}</div>}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #1e293b' }}>Period</th>
              {allKeys.map(k => (
                <th key={k} style={{ textAlign: 'right', padding: '6px 8px', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap' }}>{k.replace(/([A-Z])/g, ' $1').trim()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableData.map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                <td style={{ padding: '6px 8px', fontWeight: 600, color: 'var(--text-primary)' }}>{row.period}</td>
                {allKeys.map(k => {
                  const v = row[k];
                  return (
                    <td key={k} style={{ textAlign: 'right', padding: '6px 8px', color: v == null ? '#334155' : 'var(--text-secondary)' }}>
                      {v == null ? '—' : isCurrency ? `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : typeof v === 'number' ? v.toFixed(2) : v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div>
      <SectionHeader num="📈" title="Future Results & Analyst Forecasts" />

      {/* Sub-tab nav */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 16 }}>
        {subTabs.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            style={{
              padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)',
              background: subTab === t.id ? '#3b82f6' : 'transparent',
              color: subTab === t.id ? '#fff' : 'var(--text-secondary)',
              cursor: 'pointer', fontSize: 11, fontWeight: subTab === t.id ? 700 : 400,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {subTab === 'overview' && (
        <div>
          {/* Analyst consensus */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 12 }}>ANALYST CONSENSUS</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ textAlign: 'center', padding: '12px 20px', borderRadius: 10, background: `${recColor}15`, border: `1px solid ${recColor}33` }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>RECOMMENDATION</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: recColor }}>{recLabel}</div>
                {at.numberOfAnalysts && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{at.numberOfAnalysts} analysts</div>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, flex: 1 }}>
                {[
                  { label: 'CMP', value: cmp ? `₹${Number(cmp).toLocaleString('en-IN')}` : '—', color: 'var(--text-primary)' },
                  { label: 'Target (Mean)', value: at.targetMeanPrice ? `₹${Number(at.targetMeanPrice).toLocaleString('en-IN')}` : '—', color: '#3b82f6' },
                  { label: 'Target (High)', value: at.targetHighPrice ? `₹${Number(at.targetHighPrice).toLocaleString('en-IN')}` : '—', color: '#22c55e' },
                  { label: 'Target (Low)', value: at.targetLowPrice ? `₹${Number(at.targetLowPrice).toLocaleString('en-IN')}` : '—', color: '#ef4444' },
                  { label: 'Upside (Mean)', value: at.upsidePct != null ? `${at.upsidePct >= 0 ? '+' : ''}${at.upsidePct}%` : '—', color: at.upsidePct >= 0 ? '#22c55e' : '#ef4444' },
                  { label: 'Rating Score', value: at.recommendationMean ? at.recommendationMean.toFixed(2) : '—', color: '#eab308' },
                ].map(s => (
                  <div key={s.label} style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--bg-secondary)', textAlign: 'center' }}>
                    <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 3 }}>{s.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Key forward-looking metrics */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 12 }}>FORWARD-LOOKING METRICS</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
              {[
                { label: 'Forward P/E', value: km.forwardPE != null ? km.forwardPE.toFixed(1) : '—', note: 'Next 12m earnings', color: km.forwardPE < 20 ? '#22c55e' : km.forwardPE < 40 ? '#eab308' : '#ef4444' },
                { label: 'Trailing P/E', value: km.trailingPE != null ? km.trailingPE.toFixed(1) : '—', note: 'Last 12m earnings', color: 'var(--text-primary)' },
                { label: 'PEG Ratio', value: km.pegRatio != null ? km.pegRatio.toFixed(2) : '—', note: '<1 = undervalued', color: km.pegRatio < 1 ? '#22c55e' : km.pegRatio < 2 ? '#eab308' : '#ef4444' },
                { label: 'Forward EPS', value: km.forwardEps != null ? `₹${km.forwardEps.toFixed(2)}` : '—', note: 'Estimated', color: '#3b82f6' },
                { label: 'EPS Growth', value: km.earningsGrowth != null ? `${km.earningsGrowth >= 0 ? '+' : ''}${km.earningsGrowth}%` : '—', note: 'YoY', color: km.earningsGrowth >= 15 ? '#22c55e' : km.earningsGrowth >= 0 ? '#eab308' : '#ef4444' },
                { label: 'Revenue Growth', value: km.revenueGrowth != null ? `${km.revenueGrowth >= 0 ? '+' : ''}${km.revenueGrowth}%` : '—', note: 'YoY', color: km.revenueGrowth >= 10 ? '#22c55e' : km.revenueGrowth >= 0 ? '#eab308' : '#ef4444' },
                { label: 'Net Margin', value: km.profitMargins != null ? `${km.profitMargins}%` : '—', note: 'TTM', color: km.profitMargins >= 15 ? '#22c55e' : 'var(--text-secondary)' },
                { label: 'Oper. Margin', value: km.operatingMargins != null ? `${km.operatingMargins}%` : '—', note: 'TTM', color: km.operatingMargins >= 15 ? '#22c55e' : 'var(--text-secondary)' },
              ].map(s => (
                <div key={s.label} style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-secondary)', textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 3 }}>{s.label}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 9, color: '#475569', marginTop: 2 }}>{s.note}</div>
                </div>
              ))}
            </div>
          </div>

          {/* AI price predictions */}
          {(technicals.target_1d || technicals.target_7d || technicals.target_30d || technicals.target_90d) && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 12 }}>AI PRICE PREDICTIONS</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                {[
                  { label: '1-Day Target', val: technicals.target_1d, horizon: '1 trading day' },
                  { label: '7-Day Target', val: technicals.target_7d, low: technicals.target_7d_low, high: technicals.target_7d_high, horizon: '7 trading days' },
                  { label: '30-Day Target', val: technicals.target_30d, low: technicals.target_30d_low, high: technicals.target_30d_high, horizon: '30 days' },
                  { label: '90-Day Target', val: technicals.target_90d, horizon: '90 days' },
                ].filter(t => t.val).map(t => {
                  const pct = cmp ? ((Number(t.val) - Number(cmp)) / Number(cmp) * 100).toFixed(1) : null;
                  const c = pct >= 0 ? '#22c55e' : '#ef4444';
                  return (
                    <div key={t.label} style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-secondary)', border: `1px solid ${c}22` }}>
                      <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 4 }}>{t.label}</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: c }}>₹{Number(t.val).toLocaleString('en-IN')}</div>
                      {pct && <div style={{ fontSize: 10, color: c }}>{pct >= 0 ? '+' : ''}{pct}%</div>}
                      {t.low && t.high && (
                        <div style={{ fontSize: 9, color: '#475569', marginTop: 3 }}>
                          Range: ₹{Number(t.low).toLocaleString('en-IN')} – ₹{Number(t.high).toLocaleString('en-IN')}
                        </div>
                      )}
                      {technicals.confidence && <div style={{ fontSize: 9, color: '#f97316', marginTop: 2 }}>Confidence: {Number(technicals.confidence).toFixed(0)}%</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Earnings calendar */}
          {(km.nextEarningsDate || data.calendar) && (
            <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid #3b82f6' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>EARNINGS CALENDAR</div>
              {km.nextEarningsDate && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 18 }}>📅</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Next Results: {km.nextEarningsDate}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Estimated earnings announcement date</div>
                  </div>
                </div>
              )}
              {data.calendar && typeof data.calendar === 'object' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6, marginTop: 8 }}>
                  {Object.entries(data.calendar).filter(([k]) => !k.toLowerCase().includes('timestamp')).map(([k, v]) => (
                    <div key={k} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, background: 'var(--bg-secondary)' }}>
                      <span style={{ color: '#64748b' }}>{k.replace(/([A-Z])/g, ' $1').trim()}: </span>
                      <span style={{ fontWeight: 600 }}>{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Trend projections */}
          {proj && (
            <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid #a855f7' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>TREND-BASED REVENUE PROJECTION</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                {[
                  { label: `${proj.nextQ1Label} (Projected)`, value: `₹${proj.projectedRevQ1?.toLocaleString('en-IN')} Cr`, color: '#a855f7' },
                  { label: `${proj.nextQ2Label} (Projected)`, value: `₹${proj.projectedRevQ2?.toLocaleString('en-IN')} Cr`, color: '#a855f7' },
                  { label: 'QoQ Growth Rate', value: `${proj.revenueGrowthQoQ >= 0 ? '+' : ''}${proj.revenueGrowthQoQ}%`, color: proj.revenueGrowthQoQ >= 0 ? '#22c55e' : '#ef4444' },
                ].map(s => (
                  <div key={s.label} style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--bg-secondary)', textAlign: 'center' }}>
                    <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 3 }}>{s.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 8 }}>⚠️ {proj.note}</div>
            </div>
          )}
        </div>
      )}

      {/* QUARTERLY P&L */}
      {subTab === 'quarterly' && (
        <div className="card">
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12 }}>Quarterly P&L (₹ Crore)</div>
          <FinTable tableData={data.quarterly} />
        </div>
      )}

      {/* ANNUAL P&L */}
      {subTab === 'annual' && (
        <div className="card">
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12 }}>Annual P&L (₹ Crore)</div>
          <FinTable tableData={data.annual} />
        </div>
      )}

      {/* ANALYST ESTIMATES */}
      {subTab === 'estimates' && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <EstimateTable tableData={data.earningsEstimate} title="EPS Estimates by Period" isCurrency={false} />
          </div>
          <div className="card" style={{ marginBottom: 16 }}>
            <EstimateTable tableData={data.revenueEstimate} title="Revenue Estimates by Period (₹)" isCurrency={true} />
          </div>
          {data.epsTrend?.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <EstimateTable tableData={data.epsTrend} title="EPS Trend (Revisions)" isCurrency={false} />
            </div>
          )}
          {data.growthEstimates?.length > 0 && (
            <div className="card">
              <EstimateTable tableData={data.growthEstimates} title="Growth Estimates" isCurrency={false} />
            </div>
          )}
        </div>
      )}

      {/* AI PROJECTIONS */}
      {subTab === 'projections' && (
        <div>
          <div className="card" style={{ marginBottom: 16, background: 'rgba(168,85,247,0.05)', border: '1px solid rgba(168,85,247,0.2)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#a855f7', marginBottom: 12 }}>AI MODEL PRICE PREDICTIONS</div>
            {(technicals.target_1d || technicals.target_7d || technicals.target_30d || technicals.target_90d) ? (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
                  {[
                    { label: '1-Day Target', val: technicals.target_1d, horizon: 'Next trading session' },
                    { label: '7-Day Target', val: technicals.target_7d, low: technicals.target_7d_low, high: technicals.target_7d_high, horizon: '1 week' },
                    { label: '30-Day Target', val: technicals.target_30d, low: technicals.target_30d_low, high: technicals.target_30d_high, horizon: '1 month' },
                    { label: '90-Day Target', val: technicals.target_90d, horizon: '3 months' },
                  ].filter(t => t.val).map(t => {
                    const pct = cmp ? ((Number(t.val) - Number(cmp)) / Number(cmp) * 100).toFixed(2) : null;
                    const c = pct >= 0 ? '#22c55e' : '#ef4444';
                    return (
                      <div key={t.label} style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--bg-secondary)', border: `2px solid ${c}33` }}>
                        <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 6 }}>{t.label}</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: c }}>₹{Number(t.val).toLocaleString('en-IN')}</div>
                        {pct && <div style={{ fontSize: 12, color: c, fontWeight: 600 }}>{pct >= 0 ? '+' : ''}{pct}% vs CMP</div>}
                        <div style={{ fontSize: 9, color: '#475569', marginTop: 4 }}>{t.horizon}</div>
                        {t.low && t.high && (
                          <div style={{ fontSize: 10, color: '#64748b', marginTop: 4, borderTop: '1px solid #1e293b', paddingTop: 4 }}>
                            Low: ₹{Number(t.low).toLocaleString('en-IN')} · High: ₹{Number(t.high).toLocaleString('en-IN')}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {technicals.confidence && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(249,115,22,0.08)', borderRadius: 8 }}>
                    <span style={{ fontSize: 16 }}>🎯</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#f97316' }}>Model Confidence: {Number(technicals.confidence).toFixed(0)}%</div>
                      <div style={{ fontSize: 10, color: '#94a3b8' }}>Based on technical momentum, trend strength, and historical pattern accuracy</div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>AI price predictions not available. Run the screener pipeline to generate predictions.</div>
            )}
          </div>

          {proj && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12 }}>REVENUE TREND PROJECTION</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <div style={{ padding: '12px', borderRadius: 8, background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>QoQ Growth Rate</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: proj.revenueGrowthQoQ >= 0 ? '#22c55e' : '#ef4444', marginTop: 4 }}>
                    {proj.revenueGrowthQoQ >= 0 ? '+' : ''}{proj.revenueGrowthQoQ}%
                  </div>
                </div>
                <div style={{ padding: '12px', borderRadius: 8, background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>{proj.nextQ1Label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#a855f7', marginTop: 4 }}>₹{proj.projectedRevQ1?.toLocaleString('en-IN')} Cr</div>
                  <div style={{ fontSize: 9, color: '#64748b' }}>Projected Revenue</div>
                </div>
                <div style={{ padding: '12px', borderRadius: 8, background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>{proj.nextQ2Label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#a855f7', marginTop: 4 }}>₹{proj.projectedRevQ2?.toLocaleString('en-IN')} Cr</div>
                  <div style={{ fontSize: 9, color: '#64748b' }}>Projected Revenue</div>
                </div>
              </div>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 10, padding: '6px 10px', background: 'rgba(234,179,8,0.08)', borderRadius: 6 }}>
                ⚠️ {proj.note}
              </div>
            </div>
          )}

          <div className="card" style={{ background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.2)' }}>
            <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.7 }}>
              <strong style={{ color: '#3b82f6' }}>Methodology:</strong>{' '}
              AI price targets use momentum regression (slope × days), EMA trend alignment, RSI oscillator weighting, and
              Supertrend signal confirmation. Revenue projections extrapolate recent QoQ growth. These are quantitative
              estimates — always validate with fundamental research and analyst consensus before investing.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


/* ══ SKILL 10: Verdict + Tranche Plan (Skill 8 cue + Skill 9 undervaluation) ══ */
function Skill10Verdict({ result, mc }) {
  const verdict   = result.verdict;
  const vc        = VERDICT_COLOR[verdict] || '#64748b';
  const fv        = result.fairValue || {};
  const iv        = fv.intrinsicValue;
  const cmp       = fv.cmp || result.cmp;
  const upside    = fv.upside;
  const mosZone   = fv.mosZone || '';
  const mosColor  = mosZone.toLowerCase().includes('strong buy') ? '#22c55e' : mosZone.toLowerCase().includes('buy') ? '#4ade80' : mosZone.toLowerCase().includes('hold') ? '#eab308' : '#ef4444';
  const m         = result.metrics || {};
  const tech      = result.technicals || {};
  const p         = (typeof result.healthScore === 'object' ? result.healthScore : null) || result.pillars || {};

  // ── Technical signal scoring ─────────────────────────────────────
  const techSignals = [
    {
      name: 'VWAP',
      status: tech.aboveVwap ?? null,
      bull: 'Price above VWAP',
      bear: 'Price below VWAP',
      weight: 1,
    },
    {
      name: 'Supertrend',
      status: tech.supertrendBuy ?? null,
      bull: 'Supertrend BUY signal',
      bear: 'Supertrend SELL signal',
      weight: 2,
    },
    {
      name: 'EMA Trend',
      status: tech.ema_trend ? tech.ema_trend.toUpperCase().includes('BULL') : null,
      bull: `EMA Trend: ${tech.ema_trend || '—'}`,
      bear: `EMA Trend: ${tech.ema_trend || '—'}`,
      weight: 2,
    },
    {
      name: 'MACD',
      status: tech.macdBullish ?? null,
      bull: `MACD bullish (${tech.macd_trend || 'crossover'})`,
      bear: `MACD bearish (${tech.macd_trend || 'fading'})`,
      weight: 1,
    },
    {
      name: 'RSI',
      status: m.rsi != null ? m.rsi > 50 : null,
      bull: `RSI ${m.rsi?.toFixed(1)} — above 50 (bullish)`,
      bear: `RSI ${m.rsi?.toFixed(1)} — below 50 (bearish)`,
      extra: m.rsi != null ? (m.rsi >= 70 ? ' (Overbought ⚠️)' : m.rsi <= 30 ? ' (Oversold 🔔)' : '') : '',
      weight: 1,
    },
    {
      name: 'ADX Strength',
      status: tech.adx != null ? tech.adx >= 25 : null,
      bull: `ADX ${tech.adx?.toFixed(1)} — strong trend`,
      bear: `ADX ${tech.adx?.toFixed(1)} — weak/no trend`,
      weight: 1,
    },
    {
      name: 'Direction',
      status: tech.direction ? tech.direction.toUpperCase() === 'BULLISH' : null,
      bull: 'Overall direction: BULLISH',
      bear: `Overall direction: ${tech.direction || 'NEUTRAL'}`,
      weight: 2,
    },
    {
      name: 'Ichimoku Cloud',
      status: tech.aboveCloud ?? null,
      bull: 'Price above Ichimoku Cloud',
      bear: 'Price below Ichimoku Cloud',
      weight: 1,
    },
    {
      name: 'Price vs Support',
      status: tech.support && cmp ? Number(cmp) > Number(tech.support) : null,
      bull: `Holding above support ₹${Number(tech.support || 0).toLocaleString('en-IN')}`,
      bear: `Below support ₹${Number(tech.support || 0).toLocaleString('en-IN')} ⚠️`,
      weight: 2,
    },
    {
      name: 'AI 7d Target',
      status: tech.target_7d && cmp ? Number(tech.target_7d) > Number(cmp) : null,
      bull: `7d target ₹${Number(tech.target_7d || 0).toLocaleString('en-IN')} above CMP`,
      bear: `7d target ₹${Number(tech.target_7d || 0).toLocaleString('en-IN')} below CMP`,
      weight: 1,
    },
  ].filter(s => s.status !== null);

  const bullPoints = techSignals.filter(s => s.status === true).reduce((acc, s) => acc + s.weight, 0);
  const totalPoints = techSignals.reduce((acc, s) => acc + s.weight, 0);
  const techPct = totalPoints > 0 ? (bullPoints / totalPoints) * 100 : 0;

  // ML Direction Score (0-100) from price_predictor — fixes inverted-confidence bug.
  // 50=neutral, >60 bullish, >75 strongly bullish, <40 bearish, <25 strongly bearish.
  const dirScore = tech.direction_score != null ? Number(tech.direction_score) : null;

  // Blend signal-based techPct (60%) with ML dirScore (40%) when available
  const blendedPct = dirScore != null
    ? techPct * 0.6 + dirScore * 0.4
    : techPct;

  // Pure technical verdict (uses blended score — more accurate than signal-only)
  const techVerdict = blendedPct >= 70 ? { label: 'Strong Buy', color: '#22c55e', icon: '✅' }
    : blendedPct >= 55 ? { label: 'Buy',         color: '#4ade80', icon: '✅' }
    : blendedPct >= 42 ? { label: 'Hold',         color: '#eab308', icon: '👁' }
    : blendedPct >= 28 ? { label: 'Sell',         color: '#f97316', icon: '⚠️' }
    :                    { label: 'Strong Sell',  color: '#ef4444', icon: '🚫' };

  // Detect signal conflict between AI verdict (fundamental-heavy) and technical verdict
  const aiIsBullish  = ['Strong Buy', 'Buy', 'ACCUMULATE', 'ACCUMULATE (STAGED)'].includes(verdict);
  const aiIsBearish  = ['Strong Sell', 'Sell', 'WAIT'].includes(verdict);
  const techIsBullish = blendedPct >= 55;
  const techIsBearish = blendedPct < 40;
  const hasConflict  = (aiIsBearish && techIsBullish) || (aiIsBullish && techIsBearish);

  // Context-aware conflict narrative
  const sector = result.sector || '';
  const isCyclical = ['Metals', 'Steel', 'Mining', 'Oil', 'Energy', 'Basic Materials',
                       'Chemicals', 'Commodities', 'Cement'].some(s => sector.includes(s));
  const isOverbought = m.rsi != null && m.rsi >= 70;
  const atResistance = tech.resistance && cmp && Math.abs(Number(cmp) - Number(tech.resistance)) / Number(tech.resistance) < 0.02;
  const target7dBearish = tech.target_7d && cmp && Number(tech.target_7d) < Number(cmp);

  const conflictStory = (() => {
    if (!hasConflict) return null;

    if (aiIsBearish && techIsBullish) {
      // Fundamental sell but technical buy
      const reasons = [];
      const actions = [];

      if (isCyclical) {
        reasons.push(`${sector || 'Cyclical'} stocks can have powerful short-term price runs driven by commodity cycles, sector rotation, or macro optimism — even when fundamental quality is weak.`);
        actions.push({ who: 'Short-term trader (< 30 days)', action: 'Follow the technical signal. Ride momentum with tight stop at support. Book at resistance.', color: '#4ade80' });
        actions.push({ who: 'Medium-term investor (1–6 months)', action: 'Cautious. Wait for RSI to cool, price to consolidate. Cyclical rallies reverse fast.', color: '#eab308' });
        actions.push({ who: 'Long-term investor (> 6 months)', action: 'Respect the Sell verdict. High debt + commodity risk = earnings volatility. Avoid accumulating.', color: '#ef4444' });
      } else {
        reasons.push('The AI verdict reflects fundamental quality (earnings, debt, valuation). The technical signal reflects recent price momentum — these can diverge for weeks before aligning.');
        actions.push({ who: 'Short-term trader', action: 'Technical Buy is valid for a momentum trade. Set stop at support, target at resistance.', color: '#4ade80' });
        actions.push({ who: 'Long-term investor', action: 'Fundamental Sell takes precedence. Avoid adding unless fundamentals improve.', color: '#ef4444' });
      }

      if (isOverbought) {
        reasons.push(`RSI ${m.rsi?.toFixed(1)} is in overbought territory — momentum may be near exhaustion. Technical upside is limited from here.`);
      }
      if (atResistance) {
        reasons.push(`Price is at/above resistance ₹${Number(tech.resistance).toLocaleString('en-IN')} — a natural supply zone. Breakout needs strong volume to sustain.`);
      }
      if (target7dBearish) {
        reasons.push(`AI 7-day target (₹${Number(tech.target_7d).toLocaleString('en-IN')}) is actually BELOW current price — the momentum model expects a pullback, not a continuation.`);
      }
      return { type: 'warn', headline: 'Fundamental Sell vs Technical Momentum — Timeframe Is Everything', reasons, actions };
    }

    if (aiIsBullish && techIsBearish) {
      // Fundamental buy but technical weak
      return {
        type: 'info',
        headline: 'Fundamentally Strong but Technically Broken — Wait for Setup',
        reasons: [
          'Strong fundamentals don\'t guarantee near-term price performance. Technically weak stocks can stay depressed for months.',
          'This is a classic "value trap" risk — cheap for a reason, or just waiting for a catalyst.',
        ],
        actions: [
          { who: 'Accumulating investor', action: 'Buy in small tranches on dips. Don\'t deploy all capital at once — wait for technical confirmation (RSI > 50, price above 50 DMA).', color: '#4ade80' },
          { who: 'Momentum trader', action: 'Avoid. No technical entry signal yet. Wait for Supertrend to flip BUY.', color: '#eab308' },
        ],
      };
    }
    return null;
  })();

  // RSI zone
  const rsiZone = m.rsi == null ? null
    : m.rsi >= 70 ? { label: 'Overbought', color: '#ef4444' }
    : m.rsi >= 60 ? { label: 'Bullish',    color: '#22c55e' }
    : m.rsi >= 50 ? { label: 'Neutral+',   color: '#4ade80' }
    : m.rsi >= 40 ? { label: 'Neutral−',   color: '#eab308' }
    : m.rsi >= 30 ? { label: 'Bearish',    color: '#f97316' }
    :               { label: 'Oversold',   color: '#22c55e' }; // oversold = reversal watch

  // Tranche plan
  const entry1 = cmp;
  const entry2 = tech.support ? Number(tech.support) : (iv && cmp ? Math.min(Number(cmp), Number(iv) * 0.95) : null);

  // Stop loss = 5% below support or 7% below CMP
  const stopLoss = tech.support
    ? Math.max(Number(tech.support) * 0.97, Number(cmp) * 0.93)
    : Number(cmp) * 0.93;

  // Target = resistance or 7d AI target
  const target1 = tech.resistance ? Number(tech.resistance) : (tech.target_7d ? Number(tech.target_7d) : null);
  const rr = (target1 && stopLoss && cmp)
    ? ((target1 - Number(cmp)) / (Number(cmp) - stopLoss)).toFixed(1)
    : null;

  return (
    <div>
      <SectionHeader num="8+9+10" title="Verdict · Technical Conviction · Action Plan" />

      {/* Top row: AI verdict + Technical verdict side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {/* AI Verdict */}
        <div className="card" style={{ borderLeft: `4px solid ${vc}` }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>AI COMPOSITE VERDICT</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ fontSize: 28 }}>{VERDICT_ICON[verdict] || '?'}</div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: vc }}>{verdict}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                Composite {result.compositeScore?.toFixed(0) ?? '—'} · Fund {result.fundamentalScore?.toFixed(0) ?? '—'} · Tech {result.technicalScore?.toFixed(0) ?? '—'}
              </div>
            </div>
          </div>
          {mc?.regime && (
            <div style={{ padding: '4px 8px', borderRadius: 6, background: `${REGIME_COLOR[mc.regime]}15`, display: 'inline-block' }}>
              <span style={{ fontSize: 10, color: REGIME_COLOR[mc.regime], fontWeight: 700 }}>Market: {mc.regime.replace('_', ' ')}</span>
            </div>
          )}
        </div>

        {/* Pure Technical Verdict */}
        <div className="card" style={{ borderLeft: `4px solid ${techVerdict.color}` }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>TECHNICAL VERDICT</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ fontSize: 28 }}>{techVerdict.icon}</div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: techVerdict.color }}>{techVerdict.label}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {bullPoints}/{totalPoints} signals · blended {blendedPct.toFixed(0)}%
              </div>
            </div>
          </div>
          {/* Mini progress bar — blended score */}
          <div style={{ height: 6, borderRadius: 3, background: '#1e293b', overflow: 'hidden' }}>
            <div style={{ width: `${blendedPct}%`, height: '100%', background: techVerdict.color, borderRadius: 3, transition: 'width 0.5s' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#475569', marginTop: 3 }}>
            <span>Bearish</span>
            <span style={{ color: techVerdict.color, fontWeight: 700 }}>{blendedPct.toFixed(0)}%</span>
            <span>Bullish</span>
          </div>
          {/* ML Direction Score badge */}
          {dirScore != null && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>ML Direction</div>
              <div style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                background: dirScore >= 65 ? 'rgba(34,197,94,0.15)' : dirScore >= 50 ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.15)',
                color: dirScore >= 65 ? '#22c55e' : dirScore >= 50 ? '#eab308' : '#ef4444',
              }}>
                {dirScore.toFixed(0)}/100 {dirScore >= 65 ? '↑ Bullish' : dirScore >= 50 ? '→ Neutral' : '↓ Bearish'}
              </div>
              <div style={{ fontSize: 9, color: '#475569' }}>signals {techPct.toFixed(0)}%</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Signal Conflict Resolver ─────────────────────────────── */}
      {conflictStory && (
        <div className="card" style={{
          marginBottom: 16,
          borderLeft: `4px solid ${conflictStory.type === 'warn' ? '#f97316' : '#3b82f6'}`,
          background: conflictStory.type === 'warn' ? 'rgba(249,115,22,0.04)' : 'rgba(59,130,246,0.04)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 18 }}>{conflictStory.type === 'warn' ? '⚡' : 'ℹ️'}</span>
            <div style={{ fontSize: 12, fontWeight: 700, color: conflictStory.type === 'warn' ? '#f97316' : '#3b82f6' }}>
              SIGNAL CONFLICT DETECTED — {conflictStory.headline}
            </div>
          </div>

          {/* Context */}
          <div style={{ marginBottom: 12 }}>
            {conflictStory.reasons.map((r, i) => (
              <div key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 4, paddingLeft: 8, borderLeft: '2px solid #334155' }}>
                {r}
              </div>
            ))}
          </div>

          {/* Who should do what */}
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>WHAT TO DO — BY INVESTOR TYPE</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {conflictStory.actions.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-secondary)', alignItems: 'flex-start' }}>
                <div style={{ flexShrink: 0, padding: '2px 8px', borderRadius: 4, background: `${a.color}20`, border: `1px solid ${a.color}44`, fontSize: 10, fontWeight: 700, color: a.color, whiteSpace: 'nowrap' }}>
                  {a.who}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{a.action}</div>
              </div>
            ))}
          </div>

          {/* Quick reference: what drives each verdict */}
          <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(100,116,139,0.08)', fontSize: 10, color: '#64748b', lineHeight: 1.7 }}>
            <strong style={{ color: '#94a3b8' }}>How verdicts are calculated: </strong>
            AI Verdict = 40% Health Score + 35% Composite + 15% Fundamental + 10% Technical (long-term quality lens) ·
            Technical Verdict = weighted confluence of 10 signals: Supertrend, EMA, Direction, Support, VWAP, MACD, RSI, ADX, Ichimoku, AI target (short-term momentum lens)
          </div>
        </div>
      )}

      {/* Technical signals detail */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 12 }}>
          TECHNICAL SIGNAL BREAKDOWN ({techSignals.filter(s => s.status).length} bullish · {techSignals.filter(s => !s.status).length} bearish)
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
          {techSignals.map(sig => {
            const c = sig.status ? '#22c55e' : '#ef4444';
            const icon = sig.status ? '✅' : '❌';
            return (
              <div key={sig.name} style={{
                padding: '8px 10px', borderRadius: 8, background: 'var(--bg-secondary)',
                border: `1px solid ${c}25`, display: 'flex', gap: 8, alignItems: 'flex-start',
              }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {sig.name}
                    <span style={{ marginLeft: 4, fontSize: 9, color: '#64748b' }}>×{sig.weight}</span>
                  </div>
                  <div style={{ fontSize: 10, color: c, marginTop: 1 }}>
                    {sig.status ? sig.bull : sig.bear}{sig.extra || ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* RSI + Price levels side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {/* RSI meter */}
        {m.rsi != null && rsiZone && (
          <div className="card">
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>RSI GAUGE</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ textAlign: 'center', flex: '0 0 60px' }}>
                <div style={{ fontSize: 26, fontWeight: 800, color: rsiZone.color }}>{m.rsi.toFixed(1)}</div>
                <div style={{ fontSize: 10, color: rsiZone.color, fontWeight: 700 }}>{rsiZone.label}</div>
              </div>
              <div style={{ flex: 1 }}>
                {/* RSI bar */}
                <div style={{ position: 'relative', height: 12, borderRadius: 6, background: 'linear-gradient(to right, #22c55e 0%, #4ade80 30%, #eab308 50%, #f97316 70%, #ef4444 100%)', overflow: 'hidden' }}>
                  <div style={{
                    position: 'absolute', top: 0, bottom: 0,
                    left: `${Math.max(0, Math.min(100, m.rsi))}%`,
                    width: 3, background: '#fff', borderRadius: 2,
                    transform: 'translateX(-50%)',
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#475569', marginTop: 3 }}>
                  <span>0</span><span>30</span><span>50</span><span>70</span><span>100</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                  {m.rsi >= 70 ? '⚠️ Overbought — consider partial booking'
                    : m.rsi <= 30 ? '🔔 Oversold — reversal watch, potential entry'
                    : m.rsi >= 50 ? '📈 Bullish zone — momentum positive'
                    : '📉 Bearish zone — wait for RSI to reclaim 50'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Price levels */}
        <div className="card">
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>KEY PRICE LEVELS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { label: 'Resistance', value: tech.resistance, color: '#ef4444', icon: '🔴' },
              { label: 'CMP',        value: cmp,             color: 'var(--text-primary)', icon: '●' },
              { label: 'Support',    value: tech.support,    color: '#22c55e', icon: '🟢' },
              { label: 'Stop Loss',  value: stopLoss,        color: '#f97316', icon: '🛑' },
            ].filter(l => l.value).map(l => (
              <div key={l.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', borderRadius: 6, background: 'var(--bg-secondary)' }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{l.icon} {l.label}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: l.color }}>{fmtP(l.value)}</span>
              </div>
            ))}
            {rr && (
              <div style={{ padding: '4px 8px', borderRadius: 6, background: Number(rr) >= 2 ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Risk:Reward</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: Number(rr) >= 2 ? '#22c55e' : '#ef4444' }}>1 : {rr}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Skill 9 — Fair value */}
      {iv && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>UNDERVALUATION SCREEN (SKILL 9)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, textAlign: 'center' }}>
            <div style={{ padding: '10px', background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 3 }}>FAIR VALUE</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: mosColor }}>{fmtP(iv)}</div>
              <div style={{ fontSize: 10, color: mosColor }}>{mosZone}</div>
            </div>
            <div style={{ padding: '10px', background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 3 }}>CMP</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtP(cmp)}</div>
            </div>
            <div style={{ padding: '10px', background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 3 }}>MARGIN OF SAFETY</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: (upside || 0) > 20 ? '#22c55e' : (upside || 0) > 0 ? '#eab308' : '#ef4444' }}>
                {upside != null ? `${upside > 0 ? '+' : ''}${upside.toFixed(1)}%` : '—'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tranche Plan */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>TRANCHE PLAN</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { label: 'Tranche 1 — 30%', note: 'At CMP if technical verdict ≥ Buy', price: entry1, color: '#22c55e' },
            { label: 'Tranche 2 — 40%', note: tech.support ? `On dip to support ₹${Number(tech.support).toLocaleString('en-IN')}` : 'On dip to next support', price: entry2, color: '#3b82f6' },
            { label: 'Tranche 3 — 30%', note: tech.resistance ? `On breakout above ₹${Number(tech.resistance).toLocaleString('en-IN')} with volume` : 'On breakout with volume', price: null, color: '#a855f7' },
          ].map((t, i) => (
            <div key={i} style={{ flex: '1 1 160px', padding: '10px 14px', borderRadius: 8, background: 'var(--bg-secondary)', borderLeft: `3px solid ${t.color}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: t.color, marginBottom: 4 }}>{t.label}</div>
              {t.price && <div style={{ fontSize: 13, fontWeight: 700 }}>{fmtP(t.price)}</div>}
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{t.note}</div>
            </div>
          ))}
        </div>
      </div>

      {/* What changes view */}
      <div className="card" style={{ background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.15)' }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>SIGNAL CHANGE TRIGGERS</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.8 }}>
          <div>🟢 <strong>Upgrade to BUY if:</strong> Supertrend flips BUY + RSI crosses 50 + Price reclaims {tech.support ? `₹${Number(tech.support).toLocaleString('en-IN')} support` : 'key support'}</div>
          <div>🔴 <strong>Exit / downgrade if:</strong> {tech.support ? `Close below ₹${Number(tech.support).toLocaleString('en-IN')} support` : 'Close below stop loss'} + Supertrend flips SELL + MACD bearish crossover</div>
          <div>⚠️ <strong>Hold / watch if:</strong> RSI between 40–60, ADX &lt; 25 (no trend), price range-bound between support and resistance</div>
          {m.rsi >= 70 && <div>🔔 <strong>RSI overbought ({m.rsi.toFixed(1)}):</strong> Consider booking 20–30% profits; wait for RSI to cool below 60 before adding</div>}
          {m.rsi <= 30 && <div>📣 <strong>RSI oversold ({m.rsi.toFixed(1)}):</strong> Reversal watch — look for volume spike + bullish candle pattern before buying</div>}
        </div>
      </div>

      {/* DCF breakdown if available */}
      {(fv.dcfPerShare || fv.relativeValue) && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>VALUATION METHODS</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {fv.dcfPerShare > 0 && (
              <div style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--bg-secondary)' }}>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>DCF Per Share</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{fmtP(fv.dcfPerShare)}</div>
              </div>
            )}
            {fv.relativeValue > 0 && (
              <div style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--bg-secondary)' }}>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>Relative Valuation</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{fmtP(fv.relativeValue)}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Shared UI helpers ─────────────────────────────────────────── */
function SectionHeader({ num, title }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: '#3b82f620', color: '#3b82f6' }}>
          SKILL {num}
        </span>
        <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
      </div>
    </div>
  );
}

function PillarBar({ label, score, color }) {
  if (score == null) return null;
  const pct = Math.max(0, Math.min(100, ((score - 1) / 4) * 100));
  const c = score >= 4 ? '#22c55e' : score >= 3 ? '#4ade80' : score >= 2.5 ? '#eab308' : '#ef4444';
  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: color || c }}>{score.toFixed(1)}/5</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'rgba(100,116,139,0.12)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: color || c, transition: 'width 0.5s ease' }} />
      </div>
    </div>
  );
}

function LevelCard({ label, value, color }) {
  return (
    <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--bg-secondary)', textAlign: 'center', borderTop: `2px solid ${color}` }}>
      <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color }}>{fmtP(value)}</div>
    </div>
  );
}

/* ── pure helpers ──────────────────────────────────────────────── */
function scoreColor5(s) {
  if (s == null) return '#94a3b8';
  return s >= 4 ? '#22c55e' : s >= 3 ? '#4ade80' : s >= 2.5 ? '#eab308' : '#ef4444';
}
function scoreColor10(s) {
  if (s == null) return '#94a3b8';
  return s >= 7 ? '#22c55e' : s >= 5 ? '#eab308' : '#ef4444';
}
function mapSentiment(score) {
  if (score == null) return 'Neutral';
  if (score >= 4) return 'Strongly Bullish';
  if (score >= 3.2) return 'Mildly Bullish';
  if (score >= 2.5) return 'Neutral';
  if (score >= 2) return 'Mildly Bearish';
  return 'Strongly Bearish';
}
function getTheme(sector) {
  if (!sector) return { theme: '', alignment: 'Weak' };
  for (const [key, val] of Object.entries(INDIA_THEMES)) {
    if (sector.includes(key)) return val;
  }
  return { theme: `Sector: ${sector}`, alignment: 'Moderate' };
}
