"""
NSE Direct Client — Free real-time price data via NSE India's web API.

No API token required. No proxy server needed.
Hits nseindia.com directly using a session with cookies (required by NSE).

Key features:
  - Bulk-fetches 500+ stock prices in 1-3 HTTP calls (Nifty 500 index endpoint)
  - Auto-refreshes session cookies every ~4 minutes
  - Thread-safe
  - Same get_ltp() / is_available() interface as GrowwClient

NSE endpoint used:
  https://www.nseindia.com/api/equity-stockIndices?index=NIFTY+500
  → Returns all 500 Nifty stocks with lastPrice, change, changePct, open, high, low
"""
import threading
import time

import requests

from utils.logger import log

# ── Constants ───────────────────────────────────────────────────────────────

_NSE_HOME    = "https://www.nseindia.com/"
_NSE_INDICES = "https://www.nseindia.com/api/equity-stockIndices"
_NSE_QUOTE   = "https://www.nseindia.com/api/quote-equity"
_NSE_ALL_IDX = "https://www.nseindia.com/api/allIndices"

SESSION_TTL    = 260    # seconds before re-getting cookies (~4.3 min)
CACHE_TTL      = 12     # seconds before re-fetching prices
REQUEST_TIMEOUT = 12

# Fetching these indices covers ~600 unique stocks in 3 calls
_BULK_INDICES = ["NIFTY 500", "NIFTY MIDCAP 150", "NIFTY SMALLCAP 250"]

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection":      "keep-alive",
}


class NseDirectClient:
    """
    Drop-in free alternative to GrowwClient.
    Provides get_ltp(), get_ohlc(), get_indices(), is_available().
    """

    def __init__(self):
        self._session     = None   # requests.Session or None
        self._session_ts  = 0.0
        self._sess_lock   = threading.Lock()

        # Price cache filled by bulk index fetch
        self._price_cache = {}    # symbol → float
        self._ohlc_cache  = {}    # symbol → {open,high,low,close,chg,chg_pct}
        self._cache_ts    = 0.0

    # ── Session management ────────────────────────────────────────────────

    def _make_session(self) -> requests.Session:
        s = requests.Session()
        s.headers.update(_HEADERS)
        s.headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        try:
            s.get(_NSE_HOME, timeout=REQUEST_TIMEOUT)
        except Exception as exc:
            log.debug("NseDirectClient: homepage fetch failed — %s", exc)
        return s

    def _get_session(self) -> requests.Session:
        now = time.time()
        with self._sess_lock:
            if self._session and (now - self._session_ts) < SESSION_TTL:
                return self._session
            s = self._make_session()
            self._session    = s
            self._session_ts = now
            log.debug("NseDirectClient: session refreshed")
            return s

    def _get_json(self, url: str, params=None):
        s = self._get_session()
        hdrs = {
            "Accept":           "application/json, text/plain, */*",
            "Referer":          _NSE_HOME,
            "X-Requested-With": "XMLHttpRequest",
        }
        try:
            r = s.get(url, params=params, headers=hdrs, timeout=REQUEST_TIMEOUT)
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            log.debug("NseDirectClient request failed (%s %s): %s", url, params, exc)
            return None

    # ── Bulk cache refresh ────────────────────────────────────────────────

    def _refresh_cache(self) -> bool:
        """Bulk-fetch prices from Nifty index endpoints. Returns True on any success."""
        fetched_any = False
        for idx in _BULK_INDICES:
            data = self._get_json(_NSE_INDICES, params={"index": idx})
            if not data or not isinstance(data, dict):
                continue
            for item in data.get("data", []):
                sym = (item.get("symbol") or "").strip().upper()
                if not sym:
                    continue
                try:
                    ltp = float(str(item.get("lastPrice", 0)).replace(",", ""))
                    self._price_cache[sym] = ltp
                    self._ohlc_cache[sym] = {
                        "open":       float(str(item.get("open", 0)).replace(",", "")),
                        "high":       float(str(item.get("dayHigh", 0) or item.get("high", 0)).replace(",", "")),
                        "low":        float(str(item.get("dayLow",  0) or item.get("low",  0)).replace(",", "")),
                        "close":      ltp,
                        "change":     float(str(item.get("change",          0)).replace(",", "")),
                        "change_pct": float(str(item.get("pChange",         0)).replace(",", "")),
                    }
                    fetched_any = True
                except (ValueError, TypeError):
                    pass

        if fetched_any:
            self._cache_ts = time.time()
            log.debug("NseDirectClient: cached %d prices", len(self._price_cache))
        return fetched_any

    def _ensure_cache(self):
        if (time.time() - self._cache_ts) > CACHE_TTL:
            self._refresh_cache()

    # ── Public API (same interface as GrowwClient) ────────────────────────

    def is_available(self) -> bool:
        """True if NSE web API is reachable (no auth needed)."""
        return self._refresh_cache()

    def get_ltp(self, symbols: list) -> dict:
        """Return {symbol: price} for the given symbols."""
        self._ensure_cache()
        result = {}
        for sym in symbols:
            clean = sym.replace(".NS", "").upper()
            price = self._price_cache.get(clean)
            result[clean] = price  # None if not found
        return result

    def get_ohlc(self, symbols: list) -> dict:
        """Return {symbol: {open,high,low,close,change,change_pct}} from cache."""
        self._ensure_cache()
        result = {}
        for sym in symbols:
            clean = sym.replace(".NS", "").upper()
            if clean in self._ohlc_cache:
                result[clean] = self._ohlc_cache[clean]
        return result

    def get_indices(self) -> dict:
        """
        Return {name: {price, change, change_pct}} for major NSE indices.
        Used to supplement / replace yfinance index calls.
        """
        data = self._get_json(_NSE_ALL_IDX)
        if not data or not isinstance(data, dict):
            return {}

        # Map NSE's index names → our dashboard names
        NAME_MAP = {
            "NIFTY 50":     "Nifty 50",
            "NIFTY BANK":   "Bank Nifty",
            "NIFTY IT":     "Nifty IT",
            "NIFTY PHARMA": "Nifty Pharma",
        }
        result = {}
        for item in data.get("data", []):
            nse_name = (item.get("index") or item.get("indexSymbol") or "").strip().upper()
            our_name = NAME_MAP.get(nse_name)
            if not our_name:
                continue
            try:
                result[our_name] = {
                    "name":       our_name,
                    "price":      round(float(str(item.get("last",          0)).replace(",", "")), 2),
                    "change":     round(float(str(item.get("variation",     0) or item.get("change", 0)).replace(",", "")), 2),
                    "change_pct": round(float(str(item.get("percentChange", 0)).replace(",", "")), 2),
                    "ts":         time.time(),
                }
            except (ValueError, TypeError):
                pass
        return result
