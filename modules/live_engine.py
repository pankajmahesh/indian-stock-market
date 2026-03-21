"""
Live Engine — Real-time data engine for the AI Stock Platform.

Maintains live in-memory state refreshed at multiple intervals:
  10s  — Index prices (Nifty, Sensex, BankNifty, IT, Pharma) via yfinance .info
  10s  — Top-100 stock LTPs via Groww batch API (fallback: yfinance)
  30s  — Live RSI / trend signals from rolling price buffers
  5min — Re-score top stocks and emit updated live top-20

Emits via Flask-SocketIO:
  price_update   → {indices, stocks, ts, market_status}
  signal_change  → {symbol, old_signal, new_signal, price, rsi, ts}
  top20_update   → {top20: [...]}
  engine_status  → {status, last_price_ts, last_signal_ts, stocks_tracked}
"""

import csv
import os
import threading
import time
from datetime import datetime, timezone, timedelta

import config
from utils.logger import log

# ── Constants ─────────────────────────────────────────────────────────────

INDEX_TICKERS = {
    "Nifty 50":    "^NSEI",
    "Sensex":      "^BSESN",
    "Bank Nifty":  "^NSEBANK",
    "Nifty IT":    "^CNXIT",
    "Nifty Pharma":"^CNXPHARMA",
}

PRICE_INTERVAL  = 10   # seconds
SIGNAL_INTERVAL = 30   # seconds
SCORE_INTERVAL  = 300  # seconds (5 min)
INDEX_CACHE_TTL = 12   # seconds — avoid hammering yfinance per call
PRICE_BUF_SIZE  = 50   # rolling price buffer length per stock
MAX_SIGNAL_FEED = 40   # max signal-change events kept in memory

# ── Shared state ──────────────────────────────────────────────────────────

_lock = threading.Lock()

_live_state = {
    "indices":        {},   # name → {price, change, change_pct}
    "top_stocks":     {},   # symbol → enriched dict
    "live_top20":     [],   # top-20 by live_score
    "signal_feed":    [],   # recent signal-change events
    "market_status":  "unknown",
    "last_price_ts":  None,
    "last_signal_ts": None,
    "last_score_ts":  None,
    "stocks_tracked": 0,
    "groww_ok":       False,
    "nse_ok":         False,
    "price_source":   "yfinance",   # "groww" | "nse" | "yfinance"
}

_price_buffers: dict[str, list[float]] = {}   # symbol → list[price]
_index_cache:   dict[str, dict]        = {}   # ticker → cached result

_sio      = None  # Flask-SocketIO instance (set by init())
_universe: list[dict] = []   # top-100 stocks loaded from CSVs

# ── Init ──────────────────────────────────────────────────────────────────

def init(socketio_instance):
    """Call once from api_server after Flask app is configured."""
    global _sio
    _sio = socketio_instance
    _load_universe()
    threading.Thread(target=_price_loop,  daemon=True, name="live-price").start()
    threading.Thread(target=_signal_loop, daemon=True, name="live-signal").start()
    threading.Thread(target=_score_loop,  daemon=True, name="live-score").start()
    log.info("Live Engine initialised — tracking %d stocks", len(_universe))


def get_state() -> dict:
    """Return a snapshot of the current live state (thread-safe)."""
    with _lock:
        return {
            "indices":        dict(_live_state["indices"]),
            "live_top20":     list(_live_state["live_top20"]),
            "signal_feed":    list(_live_state["signal_feed"]),
            "market_status":  _live_state["market_status"],
            "last_price_ts":  _live_state["last_price_ts"],
            "last_signal_ts": _live_state["last_signal_ts"],
            "last_score_ts":  _live_state["last_score_ts"],
            "stocks_tracked": _live_state["stocks_tracked"],
            "groww_ok":       _live_state["groww_ok"],
            "nse_ok":         _live_state["nse_ok"],
            "price_source":   _live_state["price_source"],
        }

# ── Universe loader ───────────────────────────────────────────────────────

def _safe_float(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _load_universe():
    global _universe
    stocks: dict[str, dict] = {}

    sig_path = os.path.join(config.DATA_DIR, "signals.csv")
    if os.path.exists(sig_path):
        with open(sig_path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                sym = row.get("symbol", "").strip()
                if not sym:
                    continue
                stocks[sym] = {
                    "symbol":            sym,
                    "name":              row.get("name", ""),
                    "sector":            row.get("sector", ""),
                    "fundamental_score": _safe_float(row.get("fundamental_score"), 0),
                    "technical_score":   _safe_float(row.get("technical_score"),   0),
                    "composite_score":   _safe_float(row.get("composite_score"),   0),
                    "signal":            row.get("signal", "HOLD"),
                    "rsi":               _safe_float(row.get("rsi_value"),         50),
                    "cmp":               _safe_float(row.get("cmp"),               0),
                    "entry_zone":        row.get("entry_zone", ""),
                    "stop_loss":         row.get("stop_loss", ""),
                    "target":            row.get("target",    ""),
                    "l_category":        row.get("l_category", ""),
                }

    comp_path = os.path.join(config.DATA_DIR, "composite_ranked.csv")
    if os.path.exists(comp_path):
        with open(comp_path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                sym = row.get("symbol", "").strip()
                if sym and sym not in stocks:
                    stocks[sym] = {
                        "symbol":            sym,
                        "name":              row.get("name", ""),
                        "sector":            row.get("sector", ""),
                        "fundamental_score": _safe_float(row.get("fundamental_score"), 0),
                        "technical_score":   _safe_float(row.get("technical_score"),   0),
                        "composite_score":   _safe_float(row.get("composite_score"),   0),
                        "signal":            "HOLD",
                        "rsi":               50.0,
                        "cmp":               _safe_float(row.get("cmp"), 0),
                        "entry_zone":        "",
                        "stop_loss":         "",
                        "target":            "",
                        "l_category":        row.get("l_category", ""),
                    }

    _universe = sorted(
        stocks.values(),
        key=lambda x: x["composite_score"],
        reverse=True,
    )[:100]

    with _lock:
        _live_state["stocks_tracked"] = len(_universe)

    log.info("Live Engine: loaded %d stocks", len(_universe))


# ── Technical helpers ──────────────────────────────────────────────────────

def _calc_rsi(prices: list, period: int = 14) -> float:
    if len(prices) < period + 1:
        return 50.0
    arr = prices[-(period * 2):]
    deltas = [arr[i] - arr[i - 1] for i in range(1, len(arr))]
    gains  = [d if d > 0 else 0.0 for d in deltas]
    losses = [-d if d < 0 else 0.0 for d in deltas]
    avg_g  = sum(gains[-period:])  / period
    avg_l  = sum(losses[-period:]) / period
    if avg_l == 0:
        return 100.0
    return round(100 - (100 / (1 + avg_g / avg_l)), 1)


def _calc_live_signal(rsi: float, prices: list, prev_signal: str) -> str:
    if len(prices) < 3:
        return prev_signal
    short_avg = sum(prices[-3:]) / 3
    long_avg  = sum(prices[-min(10, len(prices)):]) / min(10, len(prices))
    up_trend  = short_avg > long_avg
    if rsi < 35 and up_trend:
        return "BUY"
    if rsi > 70 or (rsi > 62 and not up_trend):
        return "SELL"
    return "HOLD"


def _calc_live_score(fund: float, tech: float, rsi: float, prices: list) -> float:
    rsi_adj = max(0.0, min(100.0, (65 - rsi) * 1.8))
    if len(prices) >= 5:
        trend_pct = (prices[-1] - prices[-5]) / max(prices[-5], 0.01) * 100
        trend_adj = max(0.0, min(100.0, 50 + trend_pct * 5))
    else:
        trend_adj = 50.0
    live_tech = tech * 0.4 + rsi_adj * 0.4 + trend_adj * 0.2
    return round(fund * 0.8 + live_tech * 0.2, 1)


# ── Index price fetch (yfinance .info — live regularMarketPrice) ───────────

def _fetch_index_prices() -> dict:
    try:
        import yfinance as yf
    except ImportError:
        return {}

    result = {}
    now = time.time()

    for name, ticker in INDEX_TICKERS.items():
        cached = _index_cache.get(ticker)
        if cached and (now - cached.get("ts", 0)) < INDEX_CACHE_TTL:
            result[name] = cached
            continue
        try:
            info = yf.Ticker(ticker).info or {}
            price = info.get("regularMarketPrice") or info.get("currentPrice")
            prev  = info.get("regularMarketPreviousClose") or info.get("previousClose")
            if price:
                change     = round(float(price) - float(prev), 2)     if prev else None
                change_pct = round(change / float(prev) * 100, 2) if prev else None
                entry = {
                    "name":       name,
                    "price":      round(float(price), 2),
                    "change":     change,
                    "change_pct": change_pct,
                    "ts":         now,
                }
                _index_cache[ticker] = entry
                result[name] = entry
        except Exception:
            if cached:
                result[name] = cached

    return result


# ── Price source clients ───────────────────────────────────────────────────
# Priority: Groww (if token set) → NSE Direct (free, always) → yfinance

_groww_client   = None
_groww_checked  = False
_nse_client     = None
_nse_checked    = False


def _get_groww():
    global _groww_client, _groww_checked
    if _groww_checked:
        return _groww_client
    _groww_checked = True
    try:
        from modules.groww_client import GrowwClient
        gc = GrowwClient()
        if gc.is_available():
            _groww_client = gc
            log.info("Live Engine: Groww API connected")
        else:
            log.warning("Live Engine: Groww unavailable")
    except Exception as exc:
        log.warning("Live Engine: Groww import error — %s", exc)
    return _groww_client


def _get_nse():
    global _nse_client, _nse_checked
    if _nse_checked:
        return _nse_client
    _nse_checked = True
    try:
        from modules.nse_direct_client import NseDirectClient
        nc = NseDirectClient()
        if nc.is_available():
            _nse_client = nc
            log.info("Live Engine: NSE Direct connected (free)")
        else:
            log.warning("Live Engine: NSE Direct unavailable")
    except Exception as exc:
        log.warning("Live Engine: NSE Direct import error — %s", exc)
    return _nse_client


def _fetch_stock_prices(symbols: list) -> dict:
    """
    Return {clean_symbol: price} using the best available source:
      1. Groww API  (requires token in config)
      2. NSE Direct (free, no token needed)
      3. yfinance   (last resort, rate-limited)
    """
    result: dict[str, float] = {}
    source = "yfinance"

    groww = _get_groww()
    nse   = _get_nse()

    # ── 1. Groww ─────────────────────────────────────────────────────────
    if groww:
        for i in range(0, len(symbols), 50):
            batch = symbols[i:i + 50]
            prices = groww.get_ltp(batch) or {}
            result.update({k: v for k, v in prices.items() if v})
        if result:
            source = "groww"

    # ── 2. NSE Direct (fills gaps or all if Groww not available) ─────────
    if nse:
        missing_before = [s for s in symbols if not result.get(s)]
        if missing_before:
            nse_prices = nse.get_ltp(missing_before) or {}
            filled = {k: v for k, v in nse_prices.items() if v}
            result.update(filled)
            if filled and source == "yfinance":
                source = "nse"

    # ── 3. yfinance fallback ─────────────────────────────────────────────
    missing = [s for s in symbols if not result.get(s)]
    if missing:
        try:
            import yfinance as yf
            ns_syms = " ".join(f"{s}.NS" for s in missing)
            tickers = yf.Tickers(ns_syms)
            for s in missing:
                try:
                    info  = tickers.tickers.get(f"{s}.NS", {})
                    price = (getattr(info, "info", {}) or {}).get("regularMarketPrice")
                    if price:
                        result[s] = float(price)
                except Exception:
                    pass
        except Exception:
            pass

    with _lock:
        _live_state["groww_ok"]     = groww is not None
        _live_state["nse_ok"]       = nse   is not None
        _live_state["price_source"] = source

    return result


# ── Price loop (every 10 s) ────────────────────────────────────────────────

def _price_loop():
    while True:
        try:
            _update_prices()
        except Exception as exc:
            log.warning("Live Engine price loop error: %s", exc)
        time.sleep(PRICE_INTERVAL)


def _update_prices():
    indices = _fetch_index_prices()
    syms    = [s["symbol"].replace(".NS", "") for s in _universe]
    prices  = _fetch_stock_prices(syms)
    now_str = datetime.now().strftime("%H:%M:%S")
    stock_deltas: dict[str, dict] = {}

    with _lock:
        _live_state["indices"] = indices
        _live_state["market_status"] = "open" if _is_market_open() else "closed"

        for stock in _universe:
            sym       = stock["symbol"]
            clean_sym = sym.replace(".NS", "")
            price     = prices.get(clean_sym) or prices.get(sym)
            if not price or price <= 0:
                continue

            prev       = (_live_state["top_stocks"].get(sym) or {}).get("ltp") or stock.get("cmp") or price
            change_pct = round((price - prev) / prev * 100, 2) if prev else 0.0

            buf = _price_buffers.setdefault(sym, [])
            buf.append(price)
            if len(buf) > PRICE_BUF_SIZE:
                _price_buffers[sym] = buf[-PRICE_BUF_SIZE:]

            existing = _live_state["top_stocks"].get(sym) or {}
            _live_state["top_stocks"][sym] = {
                **existing,
                "symbol":            sym,
                "name":              stock["name"],
                "sector":            stock["sector"],
                "l_category":        stock.get("l_category", ""),
                "fundamental_score": stock["fundamental_score"],
                "technical_score":   stock["technical_score"],
                "composite_score":   stock["composite_score"],
                "entry_zone":        stock.get("entry_zone", ""),
                "stop_loss":         stock.get("stop_loss", ""),
                "target":            stock.get("target", ""),
                "ltp":               round(price, 2),
                "change_pct":        change_pct,
                "signal":            existing.get("signal", stock.get("signal", "HOLD")),
                "rsi":               existing.get("rsi", stock.get("rsi", 50)),
                "live_score":        existing.get("live_score", stock["composite_score"]),
            }
            stock_deltas[clean_sym] = {"ltp": round(price, 2), "change_pct": change_pct}

        _live_state["last_price_ts"] = now_str

    if _sio and stock_deltas:
        _sio.emit("price_update", {
            "indices":       indices,
            "stocks":        stock_deltas,
            "ts":            now_str,
            "market_status": _live_state["market_status"],
        })


# ── Signal loop (every 30 s) ──────────────────────────────────────────────

def _signal_loop():
    time.sleep(35)   # let price loop populate buffers first
    while True:
        try:
            _update_signals()
        except Exception as exc:
            log.warning("Live Engine signal loop error: %s", exc)
        time.sleep(SIGNAL_INTERVAL)


def _update_signals():
    changes   = []
    now_str   = datetime.now().strftime("%H:%M:%S")

    with _lock:
        for sym, sd in list(_live_state["top_stocks"].items()):
            buf = _price_buffers.get(sym, [])
            if len(buf) < 3:
                continue

            rsi         = _calc_rsi(buf)
            old_signal  = sd.get("signal", "HOLD")
            new_signal  = _calc_live_signal(rsi, buf, old_signal)
            live_score  = _calc_live_score(
                sd.get("fundamental_score", 0),
                sd.get("technical_score", sd.get("composite_score", 0)),
                rsi,
                buf,
            )

            _live_state["top_stocks"][sym].update({
                "rsi":        rsi,
                "signal":     new_signal,
                "live_score": live_score,
            })

            if new_signal != old_signal:
                event = {
                    "symbol":     sym.replace(".NS", ""),
                    "name":       sd.get("name", ""),
                    "sector":     sd.get("sector", ""),
                    "old_signal": old_signal,
                    "new_signal": new_signal,
                    "price":      round(buf[-1], 2),
                    "rsi":        rsi,
                    "ts":         now_str,
                }
                changes.append(event)
                _live_state["signal_feed"] = (
                    [event] + _live_state["signal_feed"]
                )[:MAX_SIGNAL_FEED]

        _live_state["last_signal_ts"] = now_str

    if _sio:
        for event in changes:
            _sio.emit("signal_change", event)

        _sio.emit("engine_status", {
            "last_signal_ts": now_str,
            "stocks_tracked": len(_live_state["top_stocks"]),
            "groww_ok":       _live_state["groww_ok"],
            "nse_ok":         _live_state["nse_ok"],
            "price_source":   _live_state["price_source"],
        })


# ── Score loop (every 5 min) ───────────────────────────────────────────────

def _score_loop():
    time.sleep(90)   # wait for both loops to populate state
    while True:
        try:
            _update_top20()
            _load_universe()   # picks up any new pipeline run
        except Exception as exc:
            log.warning("Live Engine score loop error: %s", exc)
        time.sleep(SCORE_INTERVAL)


def _update_top20():
    now_str = datetime.now().strftime("%H:%M:%S")
    with _lock:
        all_stocks = list(_live_state["top_stocks"].values())
        ranked = sorted(
            all_stocks,
            key=lambda x: x.get("live_score") or x.get("composite_score") or 0,
            reverse=True,
        )
        _live_state["live_top20"]    = ranked[:20]
        _live_state["last_score_ts"] = now_str

    if _sio:
        _sio.emit("top20_update", {"top20": _live_state["live_top20"]})


# ── Market hours (NSE: Mon–Fri 09:15–15:30 IST) ────────────────────────────

def _is_market_open() -> bool:
    IST = timezone(timedelta(hours=5, minutes=30))
    now = datetime.now(IST)
    if now.weekday() >= 5:
        return False
    from datetime import time as dtime
    return dtime(9, 15) <= now.time() <= dtime(15, 30)
