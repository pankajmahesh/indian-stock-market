import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import LoginPage from './components/LoginPage';
import { getAuthToken, setAuthToken, api } from './api';
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
import MarketDipView from './components/MarketDipView';
import DefenseModeView from './components/DefenseModeView';
import ValuationView from './components/ValuationView';
import LiveTickerBar from './components/LiveTickerBar';
import LiveCommandCenter from './components/LiveCommandCenter';
import UserMenu from './components/UserMenu';
import Footer from './components/Footer';
import AddAccountModal from './components/AddAccountModal';

const ADMIN_PORTFOLIO_GROUP = {
  id: 'portfolio-group', label: 'Portfolio', children: [
    { id: 'nuwama',       label: 'Nuwama' },
    { id: 'mf-portfolio', label: 'MF Portfolio' },
    { id: 'ai-mf',        label: 'AI MF Dashboard' },
    { id: 'sharekhan',    label: 'Sharekhan' },
  ],
};

// Build user portfolio dropdown from connected accounts
function buildUserPortfolioGroup(accounts, onAddAccount, onDeleteAccount) {
  const children = [
    { id: 'my-portfolio', label: 'All Holdings' },
    ...accounts.map(acc => ({
      id: `acc-${acc.id}`,
      label: `${acc.icon} ${acc.label}`,
      accId: acc.id,
      onDelete: () => onDeleteAccount(acc.id),
    })),
    { id: '__add_account__', label: '+ Add Account', action: onAddAccount, special: true },
  ];
  return { id: 'portfolio-group', label: 'Portfolio', children };
}

function buildTabs(isAdmin, accounts, onAddAccount, onDeleteAccount) {
  return [
    { id: 'live',        label: '⚡ Live' },
    { id: 'daily',       label: 'Dashboard' },
    { id: 'ai-insights', label: 'AI Stock Analyzer' },
    isAdmin ? ADMIN_PORTFOLIO_GROUP : buildUserPortfolioGroup(accounts || [], onAddAccount, onDeleteAccount),
    {
      id: 'tools-group', label: 'Tools', children: [
        { id: 'predict',      label: 'Price Prediction' },
        { id: 'compare',      label: 'Stock Compare' },
        { id: 'valuation',    label: 'Intrinsic Valuation' },
        { id: 'val-assess',   label: '⚖ Valuation Check' },
        { id: 'defense',      label: '🛡 Defense Mode' },
        { id: 'backtest',     label: 'Accuracy Backtest' },
        { id: 'sizer',        label: 'Position Sizer' },
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
        { id: 'market-dip',     label: 'Dip Scanner' },
      ],
    },
  ];
}

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
            child.special ? (
              <button
                key={child.id}
                className="dropdown-item"
                onClick={() => { child.action?.(); setOpen(false); }}
                style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}
              >
                {child.label}
              </button>
            ) : child.onDelete ? (
              <div key={child.id} style={{ display: 'flex', alignItems: 'center' }}>
                <button
                  className={`dropdown-item ${activeTab === child.id ? 'active' : ''}`}
                  style={{ flex: 1, textAlign: 'left' }}
                  onClick={() => { onSelect(child.id); setOpen(false); }}
                >
                  {child.label}
                </button>
                <button
                  title="Delete"
                  onClick={(e) => { e.stopPropagation(); child.onDelete(); setOpen(false); }}
                  style={{
                    background: 'none', border: 'none', color: 'var(--accent-red)',
                    cursor: 'pointer', fontSize: 16, padding: '0 10px', lineHeight: 1,
                    flexShrink: 0,
                  }}
                >×</button>
              </div>
            ) : (
              <button
                key={child.id}
                className={`dropdown-item ${activeTab === child.id ? 'active' : ''}`}
                onClick={() => { onSelect(child.id); setOpen(false); }}
              >
                {child.label}
              </button>
            )
          ))}
        </div>
      )}
    </div>
  );
}

const ALL_VALID_TABS = new Set([
  'live', 'daily', 'ai-insights', 'my-portfolio',
  'nuwama', 'mf-portfolio', 'ai-mf', 'sharekhan',
  'predict', 'compare', 'valuation', 'val-assess', 'defense', 'backtest', 'sizer',
  'multibagger', 'midcap150', 'largemidcap250', 'smallcap250',
  'volume', 'breakout52w', 'top20', 'intrinsic20', 'india2030', 'signals', 'market-dip',
]);

function getTabFromHash() {
  const h = window.location.hash.replace('#', '');
  return (ALL_VALID_TABS.has(h) || h.startsWith('acc-')) ? h : 'daily';
}

function getIsAdmin() {
  try {
    const u = JSON.parse(localStorage.getItem('screener_user') || '{}');
    return !!u.is_admin;
  } catch { return false; }
}

export default function App() {
  const [tab, setTabRaw]           = useState(getTabFromHash);
  const [selectedStock, setSelectedStock] = useState(null);
  const [authed,      setAuthed]      = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin,     setIsAdmin]     = useState(getIsAdmin);
  const [userAccounts,    setUserAccounts]    = useState([]);
  const [showAddAccount,  setShowAddAccount]  = useState(false);

  // Verify stored token on mount; clear if server rejects it
  useEffect(() => {
    const token = getAuthToken();
    if (!token) { setAuthed(false); setAuthChecked(true); return; }
    api.verifyToken()
      .then(res => {
        // Refresh user info from server
        if (res?.email) {
          const userInfo = {
            email:    res.email,
            name:     res.name || '',
            is_admin: res.is_admin || false,
          };
          localStorage.setItem('screener_user', JSON.stringify(userInfo));
          setIsAdmin(!!res.is_admin);
        }
        setAuthed(true);
      })
      .catch(() => { setAuthToken(null); setAuthed(false); })
      .finally(() => setAuthChecked(true));
  }, []);

  // Load user portfolio accounts (non-admin only)
  useEffect(() => {
    if (!authed || isAdmin) return;
    api.getPortfolioAccounts()
      .then(accs => setUserAccounts(Array.isArray(accs) ? accs : []))
      .catch(() => {});
  }, [authed, isAdmin]);

  // Listen for forced logout (401 from any API call)
  useEffect(() => {
    const handler = () => setAuthed(false);
    window.addEventListener('auth:logout', handler);
    return () => window.removeEventListener('auth:logout', handler);
  }, []);

  const deleteAccount = useCallback((accId) => {
    const updated = userAccounts.filter(a => a.id !== accId);
    api.savePortfolioAccounts(updated)
      .then(() => {
        setUserAccounts(updated);
        // If currently viewing the deleted account, go back to all holdings
        if (tab === `acc-${accId}`) setTabRaw('my-portfolio');
      })
      .catch(() => {});
  }, [userAccounts, tab]);

  const setTab = useCallback((id) => {
    setTabRaw(id);
    window.history.pushState(null, '', `#${id}`);
  }, []);

  useEffect(() => {
    const onHash = () => setTabRaw(getTabFromHash());
    window.addEventListener('popstate', onHash);
    return () => window.removeEventListener('popstate', onHash);
  }, []);

  if (!authChecked) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', flexDirection: 'column', gap: 16 }}>
        <div className="spinner" style={{ width: 36, height: 36, borderWidth: 4 }} />
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</span>
      </div>
    );
  }

  if (!authed) {
    return <LoginPage onLogin={() => { setIsAdmin(getIsAdmin()); setAuthed(true); }} />;
  }

  return (
    <div className="app" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <header className="header">
        <h1><span>Indian</span> Stock Screener</h1>
        <nav className="nav-tabs">
          {buildTabs(isAdmin, userAccounts, () => setShowAddAccount(true), deleteAccount).map(t =>
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
        <UserMenu onLogout={() => setAuthed(false)} />
      </header>

      <LiveTickerBar />

      <main className="main-content" style={{ flex: 1 }}>
        {tab === 'live'           && <LiveCommandCenter onSelectStock={setSelectedStock} />}
        {tab === 'daily'          && <DailyUpdatesView />}
        {tab === 'ai-insights'    && <AIInsightsView />}
        {tab === 'predict'        && <PricePredictionView />}
        {tab === 'compare'        && <StockComparisonView />}
        {tab === 'valuation'      && <IntrinsicValuationView />}
        {tab === 'backtest'       && <BacktestView />}
        {tab === 'sizer'          && <PositionSizerView />}
        {tab === 'my-portfolio'   && <PortfolioView portfolioName="my" title="My Portfolio" />}
        {!isAdmin && userAccounts.map(acc =>
          tab === `acc-${acc.id}` ? (
            <PortfolioView key={acc.id} portfolioName="my" title={`${acc.icon} ${acc.label}`} />
          ) : null
        )}
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
        {tab === 'market-dip'    && <MarketDipView onSelectStock={setSelectedStock} />}
        {tab === 'defense'       && <DefenseModeView onSelectStock={setSelectedStock} />}
        {tab === 'val-assess'    && <ValuationView />}
      </main>

      <Footer />

      {selectedStock && (
        <StockModal symbol={selectedStock} onClose={() => setSelectedStock(null)} />
      )}

      {showAddAccount && (
        <AddAccountModal
          onClose={() => setShowAddAccount(false)}
          onSaved={(accs) => {
            setUserAccounts(accs);
            setShowAddAccount(false);
            // Navigate to portfolio and auto-scan
            setTab('my-portfolio');
            api.scanPortfolio('my', false).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
