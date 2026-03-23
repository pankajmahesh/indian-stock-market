import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import LoginPage from './components/LoginPage';
import { getAuthToken, setAuthToken, api } from './api';
import PortfolioView from './components/PortfolioView';
import DailyUpdatesView from './components/DailyUpdatesView';
import AIInsightsView from './components/AIInsightsView';
import IntrinsicValuationView from './components/IntrinsicValuationView';
import BacktestView from './components/BacktestView';
import PositionSizerView from './components/PositionSizerView';
import DefenseModeView from './components/DefenseModeView';
import ValuationView from './components/ValuationView';
import LiveTickerBar from './components/LiveTickerBar';
import LiveCommandCenter from './components/LiveCommandCenter';
import UserMenu from './components/UserMenu';
import Footer from './components/Footer';
import AddAccountModal from './components/AddAccountModal';
import MFPortfolioView from './components/MFPortfolioView';
import AIMFDashboardView from './components/AIMFDashboardView';
import StockModal from './components/StockModal';
import PicksView from './components/PicksView';
import ScreenerView from './components/ScreenerView';
// Admin-only tools
import PricePredictionView from './components/PricePredictionView';
import StockComparisonView from './components/StockComparisonView';
import India2030View from './components/India2030View';
import AdminUsersView from './components/AdminUsersView';

const ADMIN_FIXED_PORTFOLIOS = [
  { id: 'nuwama',       label: 'Nuwama' },
  { id: 'mf-portfolio', label: 'MF Portfolio' },
  { id: 'ai-mf',        label: 'AI MF Dashboard' },
  { id: 'sharekhan',    label: 'Sharekhan' },
];

function buildPortfolioGroup(isAdmin, accounts, onAddAccount, onDeleteAccount) {
  const fixed = isAdmin ? ADMIN_FIXED_PORTFOLIOS : [{ id: 'my-portfolio', label: 'All Holdings' }];
  const dynamic = accounts.map(acc => ({
    id: `acc-${acc.id}`,
    label: `${acc.icon} ${acc.label}`,
    accId: acc.id,
    onDelete: () => onDeleteAccount(acc.id),
  }));
  return {
    id: 'portfolio-group', label: 'Portfolio',
    children: [
      ...fixed,
      ...dynamic,
      { id: '__add_account__', label: '+ Add Account', action: onAddAccount, special: true },
    ],
  };
}

function buildTabs(isAdmin, accounts, onAddAccount, onDeleteAccount) {
  const toolsChildren = [
    { id: 'ai-insights', label: 'AI Stock Analyzer' },
    { id: 'valuation',   label: 'Intrinsic Valuation' },
    { id: 'val-assess',  label: '⚖ Valuation Check' },
    { id: 'defense',     label: '🛡 Defense Mode' },
    { id: 'sizer',       label: 'Position Sizer' },
    ...(isAdmin ? [
      { id: 'predict',   label: 'Price Prediction' },
      { id: 'compare',   label: 'Stock Compare' },
      { id: 'backtest',  label: 'Accuracy Backtest' },
      { id: 'india2030', label: 'India 2030' },
      { id: 'admin-users', label: 'User Admin' },
    ] : []),
  ];

  return [
    { id: 'live',     label: '⚡ Live' },
    { id: 'daily',    label: 'Dashboard' },
    { id: 'picks',    label: 'Picks' },
    { id: 'screener', label: 'Screener' },
    buildPortfolioGroup(isAdmin, accounts || [], onAddAccount, onDeleteAccount),
    { id: 'tools-group', label: 'Tools', children: toolsChildren },
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
  'live', 'daily', 'picks', 'screener', 'my-portfolio',
  'nuwama', 'mf-portfolio', 'ai-mf', 'sharekhan',
  'ai-insights', 'valuation', 'val-assess', 'defense', 'sizer',
  // admin-only
  'predict', 'compare', 'backtest', 'india2030',
  'admin-users',
]);
const ADMIN_ONLY_TABS = new Set(['predict', 'compare', 'backtest', 'india2030', 'admin-users']);

function getTabFromHash(isAdmin = getIsAdmin()) {
  const h = window.location.hash.replace('#', '');
  if (ADMIN_ONLY_TABS.has(h) && !isAdmin) return 'daily';
  return (ALL_VALID_TABS.has(h) || h.startsWith('acc-')) ? h : 'daily';
}

function getIsAdmin() {
  try {
    const u = JSON.parse(localStorage.getItem('screener_user') || '{}');
    return !!u.is_admin;
  } catch { return false; }
}

export default function App() {
  const [tab, setTabRaw]                     = useState(() => getTabFromHash(getIsAdmin()));
  const [selectedStock, setSelectedStock]    = useState(null);
  const [authed,        setAuthed]           = useState(false);
  const [authChecked,   setAuthChecked]      = useState(false);
  const [isAdmin,       setIsAdmin]          = useState(getIsAdmin);
  const [userAccounts,  setUserAccounts]     = useState([]);
  const [showAddAccount, setShowAddAccount]  = useState(false);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) { setAuthed(false); setAuthChecked(true); return; }
    api.verifyToken()
      .then(res => {
        if (res?.email) {
          const userInfo = { email: res.email, name: res.name || '', is_admin: res.is_admin || false, created_at: res.created_at || '' };
          localStorage.setItem('screener_user', JSON.stringify(userInfo));
          setIsAdmin(!!res.is_admin);
        }
        setAuthed(true);
      })
      .catch(() => { setAuthToken(null); setAuthed(false); })
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (!authed) return;
    api.getPortfolioAccounts()
      .then(accs => setUserAccounts(Array.isArray(accs) ? accs : []))
      .catch(() => {});
  }, [authed]);

  useEffect(() => {
    const handler = () => setAuthed(false);
    window.addEventListener('auth:logout', handler);
    return () => window.removeEventListener('auth:logout', handler);
  }, []);

  useEffect(() => {
    if (!isAdmin && ADMIN_ONLY_TABS.has(tab)) {
      setTabRaw('daily');
      window.history.replaceState(null, '', '#daily');
    }
  }, [isAdmin, tab]);

  const deleteAccount = useCallback((accId) => {
    const updated = userAccounts.filter(a => a.id !== accId);
    api.savePortfolioAccounts(updated)
      .then(() => {
        setUserAccounts(updated);
        if (tab === `acc-${accId}`) setTabRaw('my-portfolio');
      })
      .catch(() => {});
  }, [userAccounts, tab]);

  const setTab = useCallback((id) => {
    if (!isAdmin && ADMIN_ONLY_TABS.has(id)) {
      setTabRaw('daily');
      window.history.pushState(null, '', '#daily');
      return;
    }
    setTabRaw(id);
    window.history.pushState(null, '', `#${id}`);
  }, [isAdmin]);

  useEffect(() => {
    const onHash = () => setTabRaw(getTabFromHash(isAdmin));
    window.addEventListener('popstate', onHash);
    return () => window.removeEventListener('popstate', onHash);
  }, [isAdmin]);

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
        <UserMenu onLogout={() => setAuthed(false)} onAdminConsole={() => setTab('admin-users')} />
      </header>

      <LiveTickerBar />

      <main className="main-content" style={{ flex: 1 }}>
        {tab === 'live'         && <LiveCommandCenter onSelectStock={setSelectedStock} />}
        {tab === 'daily'        && <DailyUpdatesView />}
        {tab === 'picks'        && <PicksView onSelectStock={setSelectedStock} />}
        {tab === 'screener'     && <ScreenerView onSelectStock={setSelectedStock} />}

        {/* Portfolio */}
        {tab === 'my-portfolio' && <PortfolioView portfolioName="my" title="My Portfolio" />}
        {userAccounts.map(acc =>
          tab === `acc-${acc.id}` ? (
            <PortfolioView key={acc.id} portfolioName="my" title={`${acc.icon} ${acc.label}`} />
          ) : null
        )}
        {tab === 'nuwama'       && <PortfolioView portfolioName="main" title="Nuwama Portfolio" />}
        {tab === 'mf-portfolio' && <MFPortfolioView />}
        {tab === 'ai-mf'        && <AIMFDashboardView />}
        {tab === 'sharekhan'    && <PortfolioView portfolioName="sharekhan" title="Sharekhan Portfolio" />}

        {/* Tools */}
        {tab === 'ai-insights'  && <AIInsightsView />}
        {tab === 'valuation'    && <IntrinsicValuationView />}
        {tab === 'val-assess'   && <ValuationView />}
        {tab === 'defense'      && <DefenseModeView onSelectStock={setSelectedStock} />}
        {tab === 'sizer'        && <PositionSizerView />}

        {/* Admin-only tools */}
        {tab === 'predict'      && <PricePredictionView />}
        {tab === 'compare'      && <StockComparisonView />}
        {tab === 'backtest'     && <BacktestView />}
        {tab === 'india2030'    && <India2030View />}
        {tab === 'admin-users' && isAdmin && <AdminUsersView />}
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
            setTab('my-portfolio');
            api.scanPortfolio('my', false).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
