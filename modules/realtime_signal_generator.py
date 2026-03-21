"""
Real-time Signal Generator — computes signals on-demand using live market data.

Data source priority:  Groww API  →  NSE Proxy  →  empty signal
Reuses the exact same indicator logic from SignalGenerator.
"""
import time as _time
from concurrent.futures import ThreadPoolExecutor, as_completed

from modules.signal_generator import SignalGenerator
from modules.nse_client import NSEClient
from modules.groww_client import GrowwClient
from utils.logger import log


# In-memory cache: symbol -> (result_dict, timestamp)
_signal_cache = {}
CACHE_TTL = 60  # seconds


class RealtimeSignalGenerator:

    def __init__(self):
        self.nse = NSEClient()
        self.groww = GrowwClient()
        # Reuse the core analysis engine (RSI, StochRSI, MACD, VWAP, Supertrend)
        self.sg = SignalGenerator()
        # Check which data sources are live
        self._groww_ok = None  # lazy-checked per session

    def proxy_available(self):
        return self.groww_available() or self.nse.is_available()

    def groww_available(self):
        if self._groww_ok is None:
            self._groww_ok = self.groww.is_available()
            if self._groww_ok:
                log.info("Groww API is available — using as primary data source")
            else:
                log.info("Groww API not available — falling back to NSE proxy")
        return self._groww_ok

    def compute_signal(self, symbol):
        """
        Compute a real-time signal for a single stock symbol.
        Returns dict with signal, strength, indicators, TP/SL.
        Data source priority: Groww → NSE Proxy.
        """
        # Check cache
        cached = _signal_cache.get(symbol)
        if cached and (_time.time() - cached[1]) < CACHE_TTL:
            return cached[0]

        clean = symbol.replace(".NS", "")
        prices = None
        cmp = None
        quote_info = {}
        source = None

        # ── Try Groww first ──────────────────────────────────────
        if self.groww_available():
            try:
                candle_data = self.groww.get_historical_candles(clean, interval_minutes=1440, days=365)
                prices = self.groww.candles_to_dataframe(candle_data) if candle_data else None
                if prices is not None and not prices.empty and len(prices) >= 30:
                    source = "groww"
                    # Get LTP from Groww
                    ltp_map = self.groww.get_ltp([clean])
                    if ltp_map and clean in ltp_map:
                        cmp = _parse_num(ltp_map[clean])
                    # Get full quote for enrichment
                    gquote = self.groww.get_quote(clean)
                    if gquote and isinstance(gquote, dict):
                        quote_info = {
                            "name": clean,
                            "cmp": cmp,
                            "change": _parse_num(gquote.get("net_change")),
                            "change_pct": _parse_num(gquote.get("percent_change")),
                            "day_high": _parse_num(gquote.get("high")),
                            "day_low": _parse_num(gquote.get("low")),
                            "open_price": _parse_num(gquote.get("open")),
                            "prev_close": _parse_num(gquote.get("close")),
                            "volume": _parse_num(gquote.get("volume")),
                            "high_52w": _parse_num(gquote.get("yearly_high")),
                            "low_52w": _parse_num(gquote.get("yearly_low")),
                        }
                else:
                    prices = None  # reset, try NSE
            except Exception as e:
                log.debug("Groww fetch failed for %s: %s", clean, e)
                prices = None

        # ── Fallback to NSE Proxy ────────────────────────────────
        if prices is None or prices.empty:
            chart_raw = self.nse.get_chart_data(clean, time="year")
            prices = self.nse.chart_to_dataframe(chart_raw) if chart_raw else None
            if prices is not None and not prices.empty and len(prices) >= 30:
                source = "nse"
                quote = self.nse.get_quote(clean)
                if quote and isinstance(quote, dict):
                    for key in ("lastPrice", "lastTradedPrice", "closePrice"):
                        val = quote.get(key)
                        if val is not None:
                            try:
                                cmp = float(str(val).replace(",", ""))
                                if cmp > 0:
                                    break
                            except (ValueError, TypeError):
                                continue
                    quote_info = {
                        "name": quote.get("companyName") or clean,
                        "cmp": cmp,
                        "change": _parse_num(quote.get("change")),
                        "change_pct": _parse_num(quote.get("pChange")),
                        "day_high": _parse_num(quote.get("dayHigh")),
                        "day_low": _parse_num(quote.get("dayLow")),
                        "open_price": _parse_num(quote.get("open")),
                        "prev_close": _parse_num(quote.get("previousClose")),
                        "volume": _parse_num(quote.get("totalTradedVolume")),
                        "high_52w": _parse_num(quote.get("high52")),
                        "low_52w": _parse_num(quote.get("low52")),
                    }

        # ── No data available ────────────────────────────────────
        if prices is None or prices.empty or len(prices) < 30:
            result = {"symbol": clean, **self.sg._empty_signal()}
            _signal_cache[symbol] = (result, _time.time())
            return result

        # ── Compute signal using existing indicator engine ───────
        try:
            signal_data = self.sg._analyze_stock(prices, cmp or float(prices["Close"].iloc[-1]))
        except Exception as e:
            log.warning("Signal computation failed for %s: %s", clean, e)
            result = {"symbol": clean, **self.sg._empty_signal()}
            _signal_cache[symbol] = (result, _time.time())
            return result

        # ── Build result ─────────────────────────────────────────
        result = {"symbol": clean, "source": source or "unknown"}
        if quote_info:
            result.update(quote_info)
        else:
            result["name"] = clean
            result["cmp"] = float(prices["Close"].iloc[-1])
        result.update(signal_data)

        _signal_cache[symbol] = (result, _time.time())
        return result

    def compute_signals_batch(self, symbols):
        """Compute signals for a list of symbols in parallel."""
        results = []
        with ThreadPoolExecutor(max_workers=5) as pool:
            futures = {pool.submit(self.compute_signal, sym): sym for sym in symbols}
            for future in as_completed(futures):
                sym = futures[future]
                try:
                    results.append(future.result(timeout=30))
                except Exception as e:
                    log.warning("Live signal failed for %s: %s", sym, e)
                    results.append({"symbol": sym.replace(".NS", ""), **self.sg._empty_signal()})

        # Sort by signal strength descending (strongest BUY first)
        results.sort(key=lambda r: r.get("signal_strength", 0), reverse=True)
        return results

    def get_market_movers(self):
        """Fetch gainers, losers, 52w highs/lows, top volume from NSE."""
        return {
            "gainers": self.nse.get_gainers(),
            "losers": self.nse.get_losers(),
            "high_52w": self.nse.get_52w_high(),
            "low_52w": self.nse.get_52w_low(),
            "top_volume": self.nse.get_top_volume(),
            "market_status": self.nse.get_market_status(),
        }


def _parse_num(val):
    """Safely parse a numeric value from NSE quote fields."""
    if val is None:
        return None
    try:
        return float(str(val).replace(",", ""))
    except (ValueError, TypeError):
        return None
