const BASE = '/api';

async function fetchJSON(endpoint, options) {
  const res = await fetch(`${BASE}${endpoint}`, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `API error: ${res.status}`);
    err.data = body;
    throw err;
  }
  return res.json();
}

export const api = {
  getStockList: () => fetchJSON('/stock-list'),
  getSummary: () => fetchJSON('/summary'),
  getTop20: () => fetchJSON('/top20'),
  getTop20LivePrices: () => fetchJSON('/top20/live-prices'),
  getSignals: () => fetchJSON('/signals'),
  getBreakouts52w: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return fetchJSON(`/breakouts/52w${qs ? '?' + qs : ''}`);
  },
  getLiveSignals: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return fetchJSON(`/signals/live${qs ? '?' + qs : ''}`);
  },
  getLiveSignal: (symbol) => fetchJSON(`/signals/live/${encodeURIComponent(symbol)}`),
  getLivePrice: (symbol) => fetchJSON(`/live-price/${encodeURIComponent(symbol)}`),
  getMarketMovers: () => fetchJSON('/nse/market-movers'),
  getMarketStatus: () => fetchJSON('/nse/market-status'),
  getComposite: () => fetchJSON('/composite'),
  getSectors: () => fetchJSON('/sectors'),
  getStock: (symbol) => fetchJSON(`/stock/${encodeURIComponent(symbol)}`),
  getConfig: () => fetchJSON('/config'),
  getRedFlag: () => fetchJSON('/redflag'),
  getUniverse: () => fetchJSON('/universe'),

  // Pipeline control
  startPipeline: (step = 1, skipCache = false) =>
    fetchJSON('/pipeline/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step, skip_cache: skipCache }),
    }),
  getPipelineStatus: () => fetchJSON('/pipeline/status'),
  stopPipeline: () => fetchJSON('/pipeline/stop', { method: 'POST' }),
  getPipelineSchedule: () => fetchJSON('/pipeline/schedule'),
  setPipelineSchedule: (time_ist, days = '1-5') =>
    fetchJSON('/pipeline/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time_ist, days }),
    }),
  deletePipelineSchedule: () => fetchJSON('/pipeline/schedule', { method: 'DELETE' }),

  // Portfolio (supports named portfolios: "main", "sharekhan", etc.)
  getPortfolios: () => fetchJSON('/portfolios'),
  getPortfolio: (name = 'main') => fetchJSON(`/portfolio?name=${name}`),
  scanPortfolio: (name = 'main', skipCache = false) =>
    fetchJSON('/portfolio/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, skip_cache: skipCache }),
    }),
  getPortfolioStatus: (name = 'main') => fetchJSON(`/portfolio/status?name=${name}`),
  getPortfolioAlerts: (name = 'main') => fetchJSON(`/portfolio/alerts?name=${name}`),
  importPortfolioCsv: async (file, portfolioName) => {
    const formData = new FormData();
    formData.append('file', file);
    if (portfolioName) formData.append('name', portfolioName);
    const res = await fetch(`${BASE}/portfolio/import-csv`, { method: 'POST', body: formData });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },
  importCams: async (file, { pan, dob, password, portfolio } = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    if (pan) formData.append('pan', pan);
    if (dob) formData.append('dob', dob);
    if (password) formData.append('password', password);
    if (portfolio) formData.append('portfolio', portfolio);
    const res = await fetch(`${BASE}/portfolio/import-cams`, { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw Object.assign(new Error(err.error || `API error: ${res.status}`), { hint: err.hint });
    }
    return res.json();
  },
  getMfHoldings: (portfolioName = 'main') => fetchJSON(`/portfolio/mf-holdings?name=${portfolioName}`),
  addPortfolioStock: (name, symbol) =>
    fetchJSON('/portfolio/add-stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, symbol }),
    }),
  removePortfolioStock: (name, symbol) =>
    fetchJSON('/portfolio/remove-stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, symbol }),
    }),

  // Real-time risk
  getRisk: (symbol) => fetchJSON(`/risk/${encodeURIComponent(symbol)}`),

  // Volume breakouts
  getVolumeBreakouts: () => fetchJSON('/volume-breakouts'),
  scanVolumeBreakouts: () =>
    fetchJSON('/volume-breakouts/scan', { method: 'POST' }),
  getVolumeBreakoutsStatus: () => fetchJSON('/volume-breakouts/status'),

  // Multibagger screener
  getMultibaggers: () => fetchJSON('/multibagger'),
  scanMultibaggers: (skipCache = false) =>
    fetchJSON('/multibagger/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skip_cache: skipCache }),
    }),
  getMultibaggerStatus: () => fetchJSON('/multibagger/status'),

  // Market condition & Rebalance
  getMarketCondition: () => fetchJSON('/market-condition'),
  getRebalance: (name = 'main') => fetchJSON(`/rebalance?name=${name}`),

  // Portfolio insights
  getGrowthTrend: (name = 'main') => fetchJSON(`/portfolio/growth-trend?name=${name}`),
  getValuationTrend: (name = 'main') => fetchJSON(`/portfolio/valuation-trend?name=${name}`),
  getPortfolioCalendar: (name = 'main') => fetchJSON(`/portfolio/calendar?name=${name}`),
  getPortfolioHedge: (name = 'main') => fetchJSON(`/portfolio/hedge?name=${name}`),
  getPortfolioReport: (name = 'main') => fetchJSON(`/portfolio/report?name=${name}`),

  // Midcap 150 with price predictions
  getMidcap150: () => fetchJSON('/midcap150'),
  getMidcap150Live: () => fetchJSON('/midcap150/live'),
  scanMidcap150: () =>
    fetchJSON('/midcap150/scan', { method: 'POST' }),
  getMidcap150Status: () => fetchJSON('/midcap150/status'),

  // LargeMidcap 250 with price predictions
  getLargemidcap250: () => fetchJSON('/largemidcap250'),
  getLargemidcap250Live: () => fetchJSON('/largemidcap250/live'),
  scanLargemidcap250: () =>
    fetchJSON('/largemidcap250/scan', { method: 'POST' }),
  getLargemidcap250Status: () => fetchJSON('/largemidcap250/status'),

  // Smallcap 250 with price predictions
  getSmallcap250: () => fetchJSON('/smallcap250'),
  getSmallcap250Live: () => fetchJSON('/smallcap250/live'),
  scanSmallcap250: () =>
    fetchJSON('/smallcap250/scan', { method: 'POST' }),
  getSmallcap250Status: () => fetchJSON('/smallcap250/status'),

  // Single stock prediction
  getPredict: (symbol) => fetchJSON(`/predict/${encodeURIComponent(symbol)}`),

  // Stock comparison
  compareStocks: (stock1, stock2) =>
    fetchJSON('/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock1, stock2 }),
    }),

  // Intrinsic valuation
  getIntrinsicValuation: (symbol) =>
    fetchJSON(`/intrinsic-valuation/${encodeURIComponent(symbol)}`),
  recalcIntrinsicValuation: (symbol, inputs) =>
    fetchJSON(`/intrinsic-valuation/${encodeURIComponent(symbol)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputs),
    }),

  // Intrinsic 20 — batch DCF screener
  getIntrinsic20: () => fetchJSON('/intrinsic20'),
  scanIntrinsic20: () => fetchJSON('/intrinsic20/scan', { method: 'POST' }),
  getIntrinsic20Status: () => fetchJSON('/intrinsic20/status'),
  getIntrinsic20Live: () => fetchJSON('/intrinsic20/live'),

  // India 2030 Strategy
  getIndia2030: () => fetchJSON('/india2030'),
  scanIndia2030: () => fetchJSON('/india2030/scan', { method: 'POST' }),
  getIndia2030Status: () => fetchJSON('/india2030/status'),

  // Backtest / Accuracy Testing
  getBacktest: () => fetchJSON('/backtest'),
  scanBacktest: () => fetchJSON('/backtest/scan', { method: 'POST' }),
  getBacktestStatus: () => fetchJSON('/backtest/status'),

  // ML Gated-Signal Backtest (Gap A)
  getMLBacktest: () => fetchJSON('/backtest/ml'),
  scanMLBacktest: () => fetchJSON('/backtest/ml/scan', { method: 'POST' }),
  getMLBacktestStatus: () => fetchJSON('/backtest/ml/status'),

  // AI Stock Analyzer (9-skill analysis)
  getAIInsights: (symbol) => fetchJSON(`/ai-insights/${encodeURIComponent(symbol)}`),
  getAIInsightsLive: (symbol) => fetchJSON(`/ai-insights/${encodeURIComponent(symbol)}?live=1`),
  getAIPicks: () => fetchJSON('/ai-picks'),
  getAIIndexStocks: (index = 'all', limit = 20) =>
    fetchJSON(`/ai-index-stocks?index=${index}&limit=${limit}`),
  getStockChart: (symbol, period = '3mo') =>
    fetchJSON(`/stock-chart/${encodeURIComponent(symbol)}?period=${period}`),
  getStockFutureResults: (symbol) =>
    fetchJSON(`/stock-future-results/${encodeURIComponent(symbol)}`),

  // AI Returns — Predictive AI to Real Market Returns
  getAIReturns: () => fetchJSON('/ai-returns'),
  takeAISnapshot: () => fetchJSON('/ai-returns/snapshot', { method: 'POST' }),
  getAIPerformance: () => fetchJSON('/ai-returns/performance'),

  // Market pulse
  getMarketPulse: () => fetchJSON('/market-pulse'),

  // AI MF Dashboard — exclusive fund picks
  getAIMfPicks: () => fetchJSON('/ai-mf-picks'),
  refreshAIMfPicks: () => fetchJSON('/ai-mf-picks/refresh', { method: 'POST' }),

  // MF Categories from AMFI/NSDL scheme master
  getMfCategories: () => fetchJSON('/mf-categories'),
  getMfTop10: () => fetchJSON('/mf-top10'),

  // Gift Nifty / Nifty Futures pre-market indicator
  getGiftNifty: () => fetchJSON('/gift-nifty'),

  // Daily report
  getDailyReport: () => fetchJSON('/daily'),
  generateDailyReport: () => fetchJSON('/daily/generate', { method: 'POST' }),
  getDailyStatus: () => fetchJSON('/daily/status'),

  // Cross-stock ML model training
  trainMLModels: () => fetchJSON('/ml/train', { method: 'POST' }),
  getMLTrainStatus: () => fetchJSON('/ml/train/status'),
};
