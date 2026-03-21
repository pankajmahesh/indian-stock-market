/**
 * NSE Proxy Server — wraps stock-market-india for real-time NSE data.
 * Runs on port 3100, called by the Python Flask backend.
 */
const express = require('express');
const cors = require('cors');
const API = require('../../stock-market-india');
const NSE = API.NSE;

const app = express();
app.use(cors());

const PORT = process.env.NSE_PROXY_PORT || 3100;

// ─── Simple TTL cache ──────────────────────────────────────────
const cache = new Map();

function cached(key, ttlMs, fetcher) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ttlMs) {
    return Promise.resolve(entry.data);
  }
  return fetcher().then(data => {
    cache.set(key, { data, ts: Date.now() });
    return data;
  });
}

// ─── Error wrapper ─────────────────────────────────────────────
function wrap(handler) {
  return async (req, res) => {
    try {
      const result = await handler(req, res);
      res.json(result);
    } catch (err) {
      console.error(`[NSE Proxy] Error: ${err.message}`);
      res.status(502).json({ error: err.message || 'NSE request failed' });
    }
  };
}

// ─── Health check ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Quote endpoints ───────────────────────────────────────────
app.get('/nse/quote/:symbol', wrap(async (req) => {
  const sym = req.params.symbol.toUpperCase();
  return cached(`quote:${sym}`, 30000, async () => {
    const r = await NSE.getQuoteInfo(sym);
    return r.data;
  });
}));

app.get('/nse/quotes', wrap(async (req) => {
  const symbols = (req.query.symbols || '').split(',').filter(Boolean).map(s => s.trim().toUpperCase());
  if (!symbols.length) return [];
  const results = [];
  for (const sym of symbols) {
    try {
      const data = await cached(`quote:${sym}`, 30000, async () => {
        const r = await NSE.getQuoteInfo(sym);
        return r.data;
      });
      results.push({ symbol: sym, ...data });
    } catch (e) {
      results.push({ symbol: sym, error: e.message });
    }
  }
  return results;
}));

// ─── Chart data (OHLC history) ─────────────────────────────────
// Normalizes NSE response to clean JSON array:
// [{date, open, high, low, close, volume}, ...]
app.get('/nse/chart/:symbol', wrap(async (req) => {
  const sym = req.params.symbol.toUpperCase();
  const time = req.query.time || 'year';
  const timeKey = typeof time === 'string' ? time : parseInt(time);

  return cached(`chart:${sym}:${timeKey}`, 300000, async () => {
    const r = await NSE.getChartDataNew(sym, timeKey);
    return normalizeChartData(r.data);
  });
}));

/**
 * Parse NSE chart response into clean OHLC array.
 * NSE GetHistoricalNew.jsp returns pipe-delimited data or an object with
 * d0/d1 fields containing pipe-delimited OHLC rows.
 */
function normalizeChartData(raw) {
  if (!raw) return [];

  // If already an array, return as-is
  if (Array.isArray(raw)) return raw;

  // Try to extract pipe-delimited data from the response
  let csvStr = '';
  if (typeof raw === 'string') {
    csvStr = raw;
  } else if (typeof raw === 'object') {
    // NSE chart responses often have d0 (dates) and d1 (OHLC) arrays
    // or the entire response may be an object with chart data
    if (raw.d0 && raw.d1) {
      return parseNSEChartArrays(raw);
    }
    // Sometimes it's a string inside a wrapper
    csvStr = JSON.stringify(raw);
  }

  // Parse pipe-delimited rows: Date|Open|High|Low|Close|Volume|...
  const lines = csvStr.split(/[\n#]/).filter(l => l.trim());
  const results = [];

  for (const line of lines) {
    const parts = line.split('|').map(p => p.trim());
    if (parts.length >= 5) {
      const date = parts[0];
      const open = parseFloat(parts[1]);
      const high = parseFloat(parts[2]);
      const low = parseFloat(parts[3]);
      const close = parseFloat(parts[4]);
      const volume = parts.length >= 6 ? parseFloat(parts[5]) : 0;

      if (!isNaN(close) && close > 0) {
        results.push({ date, open, high, low, close, volume: volume || 0 });
      }
    }
  }

  return results;
}

/**
 * Parse NSE chart arrays (d0 = timestamps, d1 = OHLCV values).
 */
function parseNSEChartArrays(raw) {
  const results = [];
  try {
    const dates = raw.d0 || [];
    const values = raw.d1 || [];
    const len = Math.min(dates.length, values.length);
    for (let i = 0; i < len; i++) {
      const v = values[i];
      if (typeof v === 'string') {
        const parts = v.split('|');
        if (parts.length >= 4) {
          results.push({
            date: dates[i],
            open: parseFloat(parts[0]),
            high: parseFloat(parts[1]),
            low: parseFloat(parts[2]),
            close: parseFloat(parts[3]),
            volume: parts.length >= 5 ? parseFloat(parts[4]) : 0,
          });
        }
      } else if (typeof v === 'object' && v !== null) {
        results.push({
          date: dates[i],
          open: v.open || v.Open || 0,
          high: v.high || v.High || 0,
          low: v.low || v.Low || 0,
          close: v.close || v.Close || 0,
          volume: v.volume || v.Volume || 0,
        });
      }
    }
  } catch (e) {
    console.error('[NSE Proxy] Chart parse error:', e.message);
  }
  return results;
}

// ─── Intraday data ─────────────────────────────────────────────
app.get('/nse/intraday/:symbol', wrap(async (req) => {
  const sym = req.params.symbol.toUpperCase();
  const time = req.query.time || 5;
  const timeVal = typeof time === 'string' && !isNaN(time) ? parseInt(time) : time;

  return cached(`intraday:${sym}:${timeVal}`, 60000, async () => {
    const r = await NSE.getIntraDayData(sym, timeVal);
    return r.data;
  });
}));

// ─── Market movers ─────────────────────────────────────────────
app.get('/nse/gainers', wrap(async () => {
  return cached('gainers', 30000, async () => {
    const r = await NSE.getGainers();
    return r.data;
  });
}));

app.get('/nse/losers', wrap(async () => {
  return cached('losers', 30000, async () => {
    const r = await NSE.getLosers();
    return r.data;
  });
}));

app.get('/nse/52w-high', wrap(async () => {
  return cached('52w-high', 60000, async () => {
    const r = await NSE.get52WeekHigh();
    return r.data;
  });
}));

app.get('/nse/52w-low', wrap(async () => {
  return cached('52w-low', 60000, async () => {
    const r = await NSE.get52WeekLow();
    return r.data;
  });
}));

app.get('/nse/top-volume', wrap(async () => {
  return cached('top-volume', 30000, async () => {
    const r = await NSE.getTopVolumeStocks();
    return r.data;
  });
}));

app.get('/nse/top-value', wrap(async () => {
  return cached('top-value', 30000, async () => {
    const r = await NSE.getTopValueStocks();
    return r.data;
  });
}));

app.get('/nse/market-status', wrap(async () => {
  return cached('market-status', 15000, async () => {
    const r = await NSE.getMarketStatus();
    return r.data;
  });
}));

app.get('/nse/index-stocks/:slug', wrap(async (req) => {
  const slug = req.params.slug;
  return cached(`index:${slug}`, 60000, async () => {
    const r = await NSE.getIndexStocks(slug);
    return r.data;
  });
}));

app.get('/nse/sectors', wrap(async () => {
  return cached('sectors', 300000, async () => {
    const r = await NSE.getSectorsList();
    return r.data;
  });
}));

// ─── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[NSE Proxy] Running on http://127.0.0.1:${PORT}`);
  console.log(`[NSE Proxy] Endpoints: /health, /nse/quote/:symbol, /nse/gainers, /nse/losers, etc.`);
});
