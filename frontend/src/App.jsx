import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import Top20Table from './components/Top20Table';
import SignalsView from './components/SignalsView';
import PortfolioView from './components/PortfolioView';
import MultibaggerView from './components/MultibaggerView';
import VolumeBreakoutView from './components/VolumeBreakoutView';
import BreakoutView from './components/BreakoutView';
import Midcap150View from './components/Midcap150View';
import LargeMidcap250View from './components/LargeMidcap250View';
import Smallcap250View from './components/Smallcap250View';
import DailyUpdatesView from './components/DailyUpdatesView';
import PricePredictionView from './components/PricePredictionView';
import StockComparisonView from './components/StockComparisonView';
import IntrinsicValuationView from './components/IntrinsicValuationView';
import Intrinsic20View from './components/Intrinsic20View';
import India2030View from './components/India2030View';
import BacktestView from './components/BacktestView';
import AIInsightsView from './components/AIInsightsView';
import StockModal from './components/StockModal';
import MFPortfolioView from './components/MFPortfolioView';
import AIMFDashboardView from './components/AIMFDashboardView';
import PositionSizerView from './components/PositionSizerView';

const TABS = [
  { id: 'daily',       label: 'Dashboard' },
  { id: 'ai-insights', label: 'AI Stock Analyzer' },
  {
    id: 'portfolio-group', label: 'Portfolio', children: [
      { id: 'nuwama',       label: 'Nuwama' },
      { id: 'mf-portfolio', label: 'MF Portfolio' },
      { id: 'ai-mf',        label: 'AI MF Dashboard' },
      { id: 'sharekhan',    label: 'Sharekhan' },
    ],
  },
  {
    id: 'tools-group', label: 'Tools', children: [
      { id: 'predict',   label: 'Price Prediction' },
      { id: 'compare',   label: 'Stock Compare' },
      { id: 'valuation', label: 'Intrinsic Valuation' },
      { id: 'backtest',  label: 'Accuracy Backtest' },
      { id: 'sizer',     label: 'Position Sizer' },
    ],
  },
  {
    id: 'insights-group', label: 'Stock Insights', children: [
      { id: 'multibagger',    label: 'Multibagger' },
      { id: 'midcap150',      label: 'Midcap 150' },
      { id: 'largemidcap250', label: 'LargeMidcap 250' },
      { id: 'smallcap250',    label: 'Smallcap 250' },
      { id: 'volume',         label: 'Vol Breakout' },
      { id: 'breakout52w',    label: '52W Breakout' },
      { id: 'top20',          label: 'Top 20' },
      { id: 'intrinsic20',    label: 'Intrinsic 20' },
      { id: 'india2030',      label: 'India 2030' },
      { id: 'signals',        label: 'Live Signals' },
    ],
  },
];

function DropdownTab({ tab, activeTab, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const closeTimer = useRef(null);

  const handleEnter = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setOpen(true);
  };

  const handleLeave = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  const isChildActive = tab.children.some(c => c.id === activeTab);

  return (
    <div className="nav-dropdown" ref={ref} onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <button className={`nav-tab ${isChildActive ? 'active' : ''}`}>
        {tab.label} <span className="dropdown-arrow">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="dropdown-menu">
          {tab.children.map(child => (
            <button
              key={child.id}
              className={`dropdown-item ${activeTab === child.id ? 'active' : ''}`}
              onClick={() => { onSelect(child.id); setOpen(false); }}
            >
              {child.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const VALID_TABS = new Set(
  TABS.flatMap(t => t.children ? t.children.map(c => c.id) : [t.id])
);

function getTabFromHash() {
  const h = window.location.hash.replace('#', '');
  return VALID_TABS.has(h) ? h : 'daily';
}

export default function App() {
  const [tab, setTabRaw]           = useState(getTabFromHash);
  const [selectedStock, setSelectedStock] = useState(null);

  const setTab = useCallback((id) => {
    setTabRaw(id);
    window.history.pushState(null, '', `#${id}`);
  }, []);

  useEffect(() => {
    const onHash = () => setTabRaw(getTabFromHash());
    window.addEventListener('popstate', onHash);
    return () => window.removeEventListener('popstate', onHash);
  }, []);

  return (
    <div className="app">
      <header className="header">
        <h1><span>Indian</span> Stock Screener</h1>
        <nav className="nav-tabs">
          {TABS.map(t =>
            t.children ? (
              <DropdownTab key={t.id} tab={t} activeTab={tab} onSelect={setTab} />
            ) : (
              <button
                key={t.id}
                className={`nav-tab ${tab === t.id ? 'active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            )
          )}
        </nav>
      </header>

      <main className="main-content">
        {tab === 'daily'          && <DailyUpdatesView />}
        {tab === 'ai-insights'    && <AIInsightsView />}
        {tab === 'predict'        && <PricePredictionView />}
        {tab === 'compare'        && <StockComparisonView />}
        {tab === 'valuation'      && <IntrinsicValuationView />}
        {tab === 'backtest'       && <BacktestView />}
        {tab === 'sizer'          && <PositionSizerView />}
        {tab === 'nuwama'         && <PortfolioView portfolioName="main" title="Nuwama Portfolio" />}
        {tab === 'mf-portfolio'   && <MFPortfolioView />}
        {tab === 'ai-mf'          && <AIMFDashboardView />}
        {tab === 'sharekhan'      && <PortfolioView portfolioName="sharekhan" title="Sharekhan Portfolio" />}
        {tab === 'multibagger'    && <MultibaggerView />}
        {tab === 'midcap150'      && <Midcap150View />}
        {tab === 'largemidcap250' && <LargeMidcap250View />}
        {tab === 'smallcap250'    && <Smallcap250View />}
        {tab === 'volume'         && <VolumeBreakoutView />}
        {tab === 'top20'          && <Top20Table onSelectStock={setSelectedStock} />}
        {tab === 'intrinsic20'    && <Intrinsic20View />}
        {tab === 'india2030'      && <India2030View />}
        {tab === 'signals'        && <SignalsView onSelectStock={setSelectedStock} />}
        {tab === 'breakout52w'    && <BreakoutView onSelectStock={setSelectedStock} />}
      </main>

      {selectedStock && (
        <StockModal symbol={selectedStock} onClose={() => setSelectedStock(null)} />
      )}
    </div>
  );
}
