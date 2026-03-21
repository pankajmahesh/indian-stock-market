#!/usr/bin/env python3
"""
Flask API Server for the Indian Stock Screener React Dashboard.
Serves all screener data as JSON endpoints.

Usage:
  python3 api_server.py              # Start server on port 5000
  python3 api_server.py --port 8080  # Custom port
"""
import argparse
import json
import math
import os
import subprocess
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS

import config

app = Flask(__name__)
CORS(app)

# Pipeline state tracking
_pipeline_state = {
    "running": False,
    "status": "idle",
    "log_lines": [],
    "pid": None,
}


def _sanitize_value(v):
    """Convert NaN/Inf/numpy types to JSON-safe values."""
    if v is None:
        return None
    if isinstance(v, (float, np.floating)):
        if math.isnan(v) or math.isinf(v):
            return None
        return float(v)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    return v


def _safe_float(v, default=0):
    """Safely convert a value to float, returning default on failure."""
    if v is None:
        return default
    try:
        f = float(v)
        return default if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return default


def load_csv(filename, subdir=None):
    """Load a CSV from data dir, return as list of JSON-safe dicts."""
    if subdir:
        path = os.path.join(config.DATA_DIR, subdir, filename)
    else:
        path = os.path.join(config.DATA_DIR, filename)
    if not os.path.exists(path):
        return None
    df = pd.read_csv(path)
    records = df.to_dict(orient="records")
    # Sanitize every value — pandas to_dict leaks NaN/numpy types
    return [{k: _sanitize_value(v) for k, v in row.items()} for row in records]


def load_output_csv(filename):
    return load_csv(filename, subdir="output")


# ============================================================
# API ENDPOINTS
# ============================================================

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "project": "Indian Stock Screener"})


@app.route("/api/summary", methods=["GET"])
def summary():
    """Dashboard summary stats."""
    universe = load_csv("universe.csv")
    post_rf = load_csv("post_redflag.csv")
    final = load_output_csv("final_top20.csv")
    signals = load_csv("signals.csv")

    signal_counts = {"BUY": 0, "SELL": 0, "HOLD": 0, "NO_DATA": 0}
    if signals:
        for s in signals:
            sig = s.get("signal", "HOLD")
            if sig in signal_counts:
                signal_counts[sig] += 1

    return jsonify({
        "universe_count": len(universe) if universe else 0,
        "post_redflag_count": len(post_rf) if post_rf else 0,
        "final_count": len(final) if final else 0,
        "signal_counts": signal_counts,
        "data_available": {
            "universe": universe is not None,
            "post_redflag": post_rf is not None,
            "fundamental_scores": os.path.exists(os.path.join(config.DATA_DIR, "fundamental_scores.csv")),
            "technical_scores": os.path.exists(os.path.join(config.DATA_DIR, "technical_scores.csv")),
            "composite_ranked": os.path.exists(os.path.join(config.DATA_DIR, "composite_ranked.csv")),
            "deep_dive": os.path.exists(os.path.join(config.DATA_DIR, "top50_deep_dive.csv")),
            "final_top20": final is not None,
            "signals": signals is not None,
        },
    })


@app.route("/api/stock-list", methods=["GET"])
def stock_list():
    """Lightweight list of stock symbols + names for typeahead."""
    path = os.path.join(config.DATA_DIR, "nse_equity_list.csv")
    if not os.path.exists(path):
        return jsonify([])
    df = pd.read_csv(path)
    # Return just symbol and name
    result = []
    for _, row in df.iterrows():
        sym = str(row.get("SYMBOL", "")).strip()
        name = str(row.get("NAME OF COMPANY", "")).strip()
        if sym:
            result.append({"s": sym, "n": name})
    return jsonify(result)


@app.route("/api/universe", methods=["GET"])
def universe():
    """Full universe of stocks."""
    data = load_csv("universe.csv")
    if data is None:
        return jsonify({"error": "Universe data not found. Run the screener first."}), 404
    return jsonify(data)


@app.route("/api/redflag", methods=["GET"])
def redflag():
    """Stocks with red flag audit (includes rejected)."""
    data = load_csv("post_redflag_full.csv")
    if data is None:
        return jsonify({"error": "Red flag data not found."}), 404
    return jsonify(data)


@app.route("/api/fundamentals", methods=["GET"])
def fundamentals():
    """Fundamental scores for all stocks."""
    data = load_csv("fundamental_scores.csv")
    if data is None:
        return jsonify({"error": "Fundamental scores not found."}), 404
    return jsonify(data)


@app.route("/api/technicals", methods=["GET"])
def technicals():
    """Technical scores for all stocks."""
    data = load_csv("technical_scores.csv")
    if data is None:
        return jsonify({"error": "Technical scores not found."}), 404
    return jsonify(data)


@app.route("/api/composite", methods=["GET"])
def composite():
    """Composite ranked stocks."""
    data = load_csv("composite_ranked.csv")
    if data is None:
        return jsonify({"error": "Composite ranking not found."}), 404
    return jsonify(data)


@app.route("/api/deepdive", methods=["GET"])
def deepdive():
    """Top 50 deep dive analysis."""
    data = load_csv("top50_deep_dive.csv")
    if data is None:
        return jsonify({"error": "Deep dive data not found."}), 404
    return jsonify(data)


@app.route("/api/top20", methods=["GET"])
def top20():
    """Final top 20 picks with full analysis."""
    data = load_output_csv("final_top20.csv")
    if data is None:
        return jsonify({"error": "Final top 20 data not found. Run the screener first."}), 404
    return jsonify(data)


@app.route("/api/top20/live-prices", methods=["GET"])
def top20_live_prices():
    """Fetch live CMP + change_pct for top20 symbols via yfinance batch download.
    Compatible with yfinance ≥0.2 (MultiIndex columns: Price × Ticker).
    """
    data = load_output_csv("final_top20.csv")
    if not data:
        return jsonify({}), 404
    try:
        import yfinance as yf
        import math as _math
        symbols = [str(r.get("symbol", "")).strip() for r in data if r.get("symbol")]
        symbols_ns = [s if s.endswith(".NS") else s + ".NS" for s in symbols]

        df = yf.download(symbols_ns, period="2d", interval="1d",
                         progress=False, threads=True, auto_adjust=True)

        result = {}
        for sym, sym_ns in zip(symbols, symbols_ns):
            try:
                # yfinance ≥0.2: MultiIndex (Price, Ticker) — access as df["Close"][sym_ns]
                # yfinance <0.2 (single ticker): df["Close"] is a Series directly
                if isinstance(df.columns, pd.MultiIndex):
                    if len(symbols_ns) == 1:
                        closes = df["Close"].dropna()
                    else:
                        closes = df["Close"][sym_ns].dropna()
                else:
                    closes = df["Close"].dropna()

                closes = closes.dropna()
                if closes.empty:
                    continue
                cmp_val = float(closes.iloc[-1])
                if _math.isnan(cmp_val):
                    continue
                if len(closes) >= 2:
                    prev = float(closes.iloc[-2])
                    change_pct = round((cmp_val - prev) / prev * 100, 2) if prev else None
                else:
                    prev = None
                    change_pct = None
                result[sym] = {"cmp": round(cmp_val, 2), "change_pct": change_pct}
            except Exception:
                pass
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/signals", methods=["GET"])
def signals():
    """Trading signals for final picks (batch — from CSV)."""
    data = load_csv("signals.csv")
    if data is None:
        return jsonify({"error": "Signal data not found."}), 404
    return jsonify(data)


# ─── Real-time signals via NSE proxy ────────────────────────────

_rt_signal_gen = None

def _get_rt():
    global _rt_signal_gen
    if _rt_signal_gen is None:
        from modules.realtime_signal_generator import RealtimeSignalGenerator
        _rt_signal_gen = RealtimeSignalGenerator()
    return _rt_signal_gen


@app.route("/api/signals/live", methods=["GET"])
def signals_live():
    """Real-time signals via NSE proxy.

    Query params:
      ?symbols=TCS,RELIANCE          — specific symbols
      ?source=portfolio&name=main    — portfolio stocks
      ?source=gainers                — today's NSE gainers
      ?source=losers                 — today's NSE losers
    Falls back to batch signals.csv if NSE proxy unavailable.
    """
    rt = _get_rt()
    if not rt.proxy_available():
        data = load_csv("signals.csv")
        return jsonify({"mode": "batch", "data": _deep_sanitize(data or []), "fallback": True})

    source = request.args.get("source", "symbols")

    if source == "portfolio":
        name = request.args.get("name", "main")
        portfolio = config.PORTFOLIOS.get(name)
        if not portfolio:
            return jsonify({"error": f"Unknown portfolio: {name}"}), 404
        symbols = portfolio.get("stocks", [])
    elif source == "gainers":
        gainers_data = rt.nse.get_gainers()
        symbols = _extract_symbols(gainers_data)
    elif source == "losers":
        losers_data = rt.nse.get_losers()
        symbols = _extract_symbols(losers_data)
    else:
        symbols_str = request.args.get("symbols", "")
        symbols = [s.strip().upper() for s in symbols_str.split(",") if s.strip()]

    if not symbols:
        return jsonify({"error": "No symbols specified"}), 400

    results = rt.compute_signals_batch(symbols)
    return jsonify({"mode": "live", "data": _deep_sanitize(results), "symbol_count": len(symbols)})


@app.route("/api/signals/live/<symbol>", methods=["GET"])
def signal_live_single(symbol):
    """Real-time signal for a single stock.
    Falls back to yfinance price when NSE proxy is unavailable (returns 200 with mode=fallback).
    """
    import yfinance as yf
    rt = _get_rt()
    sym = symbol.strip().upper()

    if not rt.proxy_available():
        # Fallback: fetch price via yfinance so the UI still gets a CMP
        sym_ns = sym if sym.endswith(".NS") else sym + ".NS"
        try:
            ticker = yf.Ticker(sym_ns)
            info = ticker.fast_info
            price = getattr(info, "last_price", None) or getattr(info, "regular_market_price", None)
            prev  = getattr(info, "previous_close", None) or getattr(info, "regular_market_previous_close", None)
            if price is None:
                hist = ticker.history(period="2d", interval="1d", auto_adjust=True)
                if not hist.empty:
                    price = float(hist["Close"].iloc[-1])
                    if len(hist) >= 2:
                        prev = float(hist["Close"].iloc[-2])
            chg_pct = round((price - prev) / prev * 100, 2) if price and prev else None
            return jsonify({
                "symbol": sym, "cmp": round(float(price), 2) if price else None,
                "change_pct": chg_pct, "signal": "HOLD", "mode": "fallback",
                "note": "NSE proxy unavailable — price via yfinance, no live signal",
            })
        except Exception:
            return jsonify({"error": "NSE proxy unavailable, yfinance fallback also failed"}), 503

    result = rt.compute_signal(sym)
    return jsonify(_deep_sanitize(result))


@app.route("/api/live-price/<symbol>", methods=["GET"])
def live_price(symbol):
    """Lightweight live price via yfinance — fallback when NSE proxy unavailable."""
    import yfinance as yf
    sym = symbol.strip().upper()
    sym_ns = sym if sym.endswith(".NS") else sym + ".NS"
    try:
        ticker = yf.Ticker(sym_ns)
        info = ticker.fast_info
        price = getattr(info, "last_price", None) or getattr(info, "regular_market_price", None)
        prev_close = getattr(info, "previous_close", None) or getattr(info, "regular_market_previous_close", None)
        if price is None:
            hist = ticker.history(period="2d", interval="1d", auto_adjust=True)
            if not hist.empty:
                price = float(hist["Close"].iloc[-1])
                if len(hist) >= 2:
                    prev_close = float(hist["Close"].iloc[-2])
        if price is None:
            return jsonify({"error": "Price unavailable"}), 404
        change_pct = round((price - prev_close) / prev_close * 100, 2) if prev_close else None
        return jsonify({
            "symbol": sym,
            "cmp": round(float(price), 2),
            "prev_close": round(float(prev_close), 2) if prev_close else None,
            "change_pct": change_pct,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/nse/market-movers", methods=["GET"])
def market_movers():
    """Gainers, losers, 52w highs/lows, top volume from NSE."""
    rt = _get_rt()
    if not rt.proxy_available():
        return jsonify({"error": "NSE proxy unavailable"}), 503
    data = rt.get_market_movers()
    return jsonify(_deep_sanitize(data))


@app.route("/api/nse/market-status", methods=["GET"])
def nse_market_status():
    """Is the market open or closed?"""
    from modules.nse_client import NSEClient
    nse = NSEClient()
    status = nse.get_market_status()
    return jsonify(status or {"status": "unknown"})


def _extract_symbols(nse_data):
    """Extract symbol list from NSE gainers/losers response."""
    if not nse_data:
        return []
    # NSE data can be a dict with a 'data' array, or a list directly
    items = nse_data
    if isinstance(nse_data, dict):
        items = nse_data.get("data", [])
    if not isinstance(items, list):
        return []
    symbols = []
    for item in items[:20]:
        sym = None
        if isinstance(item, dict):
            sym = item.get("symbol") or item.get("Symbol") or item.get("sym")
        if sym:
            symbols.append(sym.strip().upper())
    return symbols


@app.route("/api/stock/<symbol>", methods=["GET"])
def stock_detail(symbol):
    """Detailed data for a single stock (aggregated from all CSVs)."""
    result = {}

    # Fundamental
    fund = load_csv("fundamental_scores.csv")
    if fund:
        match = [s for s in fund if s.get("symbol") == symbol]
        if match:
            result["fundamental"] = match[0]

    # Technical
    tech = load_csv("technical_scores.csv")
    if tech:
        match = [s for s in tech if s.get("symbol") == symbol]
        if match:
            result["technical"] = match[0]

    # Composite
    comp = load_csv("composite_ranked.csv")
    if comp:
        match = [s for s in comp if s.get("symbol") == symbol]
        if match:
            result["composite"] = match[0]

    # Deep dive
    dd = load_csv("top50_deep_dive.csv")
    if dd:
        match = [s for s in dd if s.get("symbol") == symbol]
        if match:
            result["deep_dive"] = match[0]

    # Final
    final = load_output_csv("final_top20.csv")
    if final:
        match = [s for s in final if s.get("symbol") == symbol]
        if match:
            result["final"] = match[0]

    # Signals
    sig = load_csv("signals.csv")
    if sig:
        match = [s for s in sig if s.get("symbol") == symbol]
        if match:
            result["signal"] = match[0]

    if not result:
        return jsonify({"error": f"Stock {symbol} not found."}), 404

    return jsonify(result)


@app.route("/api/config", methods=["GET"])
def get_config():
    """Current screener configuration."""
    return jsonify({
        "universe_filters": {
            "min_market_cap_cr": config.MIN_MARKET_CAP / 1e7,
            "min_avg_daily_volume_lakh": config.MIN_AVG_DAILY_VOLUME_VALUE / 1e5,
            "min_price": config.MIN_PRICE,
        },
        "fundamental_weights": config.FUNDAMENTAL_WEIGHTS,
        "technical_weights": config.TECHNICAL_WEIGHTS,
        "composite_weights": {
            "fundamental": config.COMPOSITE_FUNDAMENTAL_WEIGHT,
            "technical": config.COMPOSITE_TECHNICAL_WEIGHT,
        },
        "qualitative_weights": config.QUALITATIVE_WEIGHTS,
        "signal_strategy": config.SIGNAL_STRATEGY,
        "red_flags": config.RED_FLAGS,
    })


@app.route("/api/sectors", methods=["GET"])
def sectors():
    """Sector-wise breakdown from composite data."""
    data = load_csv("composite_ranked.csv")
    if data is None:
        return jsonify({"error": "Composite data not found."}), 404

    sector_map = {}
    for stock in data:
        sector = stock.get("sector") or "Unknown"
        if sector not in sector_map:
            sector_map[sector] = {
                "sector": sector,
                "count": 0,
                "avg_composite": 0,
                "avg_fundamental": 0,
                "avg_technical": 0,
                "stocks": [],
            }
        sector_map[sector]["count"] += 1
        sector_map[sector]["avg_composite"] += stock.get("composite_score", 0) or 0
        sector_map[sector]["avg_fundamental"] += stock.get("fundamental_score", 0) or 0
        sector_map[sector]["avg_technical"] += stock.get("technical_score", 0) or 0
        sector_map[sector]["stocks"].append(stock.get("symbol"))

    for s in sector_map.values():
        if s["count"] > 0:
            s["avg_composite"] = round(s["avg_composite"] / s["count"], 1)
            s["avg_fundamental"] = round(s["avg_fundamental"] / s["count"], 1)
            s["avg_technical"] = round(s["avg_technical"] / s["count"], 1)

    result = sorted(sector_map.values(), key=lambda x: x["avg_composite"], reverse=True)
    return jsonify(result)


# ============================================================
# PIPELINE CONTROL
# ============================================================

def _run_pipeline(step=1, skip_cache=False):
    """Run the pipeline in a background thread."""
    global _pipeline_state
    _pipeline_state["running"] = True
    _pipeline_state["status"] = "starting"
    _pipeline_state["log_lines"] = []

    try:
        cmd = [sys.executable, os.path.join(config.BASE_DIR, "main.py"), "--step", str(step)]
        if skip_cache:
            cmd.append("--skip-cache")

        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd=config.BASE_DIR,
        )
        _pipeline_state["pid"] = proc.pid
        _pipeline_state["status"] = "running"

        for line in proc.stdout:
            line = line.strip()
            if line:
                _pipeline_state["log_lines"].append(line)
                # Keep only last 200 lines
                if len(_pipeline_state["log_lines"]) > 200:
                    _pipeline_state["log_lines"] = _pipeline_state["log_lines"][-200:]
                # Update status from log
                if "STEP" in line:
                    _pipeline_state["status"] = line.strip()

        proc.wait()
        _pipeline_state["status"] = "completed" if proc.returncode == 0 else f"failed (code {proc.returncode})"
    except Exception as e:
        _pipeline_state["status"] = f"error: {str(e)}"
    finally:
        _pipeline_state["running"] = False
        _pipeline_state["pid"] = None


@app.route("/api/pipeline/start", methods=["POST"])
def pipeline_start():
    """Start the screening pipeline."""
    if _pipeline_state["running"]:
        return jsonify({"error": "Pipeline is already running", "status": _pipeline_state["status"]}), 409

    body = request.get_json(silent=True) or {}
    step = body.get("step", 1)
    skip_cache = body.get("skip_cache", False)

    thread = threading.Thread(target=_run_pipeline, args=(step, skip_cache), daemon=True)
    thread.start()

    return jsonify({"message": "Pipeline started", "step": step, "skip_cache": skip_cache})


@app.route("/api/pipeline/status", methods=["GET"])
def pipeline_status():
    """Get pipeline status and recent logs."""
    return jsonify({
        "running": _pipeline_state["running"],
        "status": _pipeline_state["status"],
        "log_lines": _pipeline_state["log_lines"][-50:],  # Last 50 lines
    })


@app.route("/api/pipeline/stop", methods=["POST"])
def pipeline_stop():
    """Stop the running pipeline."""
    if not _pipeline_state["running"] or not _pipeline_state["pid"]:
        return jsonify({"error": "No pipeline running"}), 404

    try:
        import signal
        os.kill(_pipeline_state["pid"], signal.SIGTERM)
        _pipeline_state["status"] = "stopped by user"
        _pipeline_state["running"] = False
        return jsonify({"message": "Pipeline stopped"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ============================================================
# PIPELINE SCHEDULE (cron-based auto-run)
# ============================================================
_CRON_MARKER = "# indian-stock-screener-auto-pipeline"


def _cron_ist_to_utc(hh_ist, mm_ist):
    """Convert IST HH:MM to UTC HH:MM (IST = UTC+5:30)."""
    total = hh_ist * 60 + mm_ist - 330  # subtract 5h30m
    total = total % (24 * 60)
    return total // 60, total % 60


@app.route("/api/pipeline/schedule", methods=["GET"])
def pipeline_schedule_get():
    """Return current auto-schedule (if any)."""
    try:
        result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
        lines = result.stdout.splitlines()
        for line in lines:
            if _CRON_MARKER in line:
                # Parse HH MM from cron line: "MM HH * * 1-5 cmd # marker"
                parts = line.split()
                if len(parts) >= 2:
                    mm_utc, hh_utc = int(parts[0]), int(parts[1])
                    # Convert UTC back to IST
                    total_ist = (hh_utc * 60 + mm_utc + 330) % (24 * 60)
                    hh_ist, mm_ist = total_ist // 60, total_ist % 60
                    return jsonify({
                        "scheduled": True,
                        "time_ist": f"{hh_ist:02d}:{mm_ist:02d}",
                        "days": "Mon-Fri",
                        "cron_line": line,
                    })
        return jsonify({"scheduled": False})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/pipeline/schedule", methods=["POST"])
def pipeline_schedule_set():
    """Create or update the daily auto-pipeline cron job.
    Body: { "time_ist": "16:00", "days": "1-5" }
    """
    body = request.get_json(silent=True) or {}
    time_ist = body.get("time_ist", "16:00")
    days = body.get("days", "1-5")

    try:
        hh_ist, mm_ist = map(int, time_ist.split(":"))
    except Exception:
        return jsonify({"error": "Invalid time format. Use HH:MM"}), 400

    hh_utc, mm_utc = _cron_ist_to_utc(hh_ist, mm_ist)
    python_path = sys.executable
    script_path = os.path.join(config.BASE_DIR, "main.py")
    log_path = os.path.join(config.DATA_DIR, "pipeline_cron.log")

    new_cron = (
        f"{mm_utc} {hh_utc} * * {days} "
        f"cd {config.BASE_DIR} && {python_path} {script_path} "
        f">> {log_path} 2>&1 "
        f"{_CRON_MARKER}"
    )

    try:
        # Read existing crontab, strip old marker lines, append new one
        result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
        existing = [l for l in result.stdout.splitlines() if _CRON_MARKER not in l]
        existing.append(new_cron)
        new_crontab = "\n".join(existing) + "\n"
        subprocess.run(["crontab", "-"], input=new_crontab, text=True, check=True)
        return jsonify({
            "message": f"Scheduled daily at {time_ist} IST ({days})",
            "time_ist": time_ist,
            "cron_line": new_cron,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/pipeline/schedule", methods=["DELETE"])
def pipeline_schedule_delete():
    """Remove the auto-pipeline cron job."""
    try:
        result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
        existing = [l for l in result.stdout.splitlines() if _CRON_MARKER not in l]
        new_crontab = "\n".join(existing) + "\n"
        subprocess.run(["crontab", "-"], input=new_crontab, text=True, check=True)
        return jsonify({"message": "Schedule removed"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ============================================================
# ML CROSS-STOCK MODEL TRAINING
# ============================================================

_ml_train_state = {"running": False, "status": "idle", "started_at": None, "summary": None}


@app.route("/api/ml/train", methods=["POST"])
def ml_train():
    """
    Trigger cross-stock ML model training in the background.
    Aggregates all cached stock histories (3y preferred, 1y fallback) and trains
    one shared RF+GBM+MLP ensemble per prediction horizon (7d/30d/90d).
    These pretrained models replace per-stock on-the-fly training, giving 10-50x
    more training samples and substantially higher direction accuracy.
    """
    if _ml_train_state["running"]:
        return jsonify({"status": "already_running", "message": "Training already in progress"})

    def _run_training():
        _ml_train_state["running"] = True
        _ml_train_state["status"] = "running"
        _ml_train_state["started_at"] = __import__("datetime").datetime.now().isoformat()
        try:
            from modules.price_predictor import PricePredictor
            pp = PricePredictor()
            summary = pp.train_cross_stock_models()
            _ml_train_state["summary"] = summary
            _ml_train_state["status"] = "done"
        except Exception as e:
            _ml_train_state["status"] = f"error: {e}"
            _ml_train_state["summary"] = {"error": str(e)}
        finally:
            _ml_train_state["running"] = False

    import threading as _threading
    t = _threading.Thread(target=_run_training, daemon=True)
    t.start()
    return jsonify({"status": "started", "message": "Cross-stock ML training started in background"})


@app.route("/api/ml/train/status", methods=["GET"])
def ml_train_status():
    """Check cross-stock ML training status."""
    return jsonify({
        "running": _ml_train_state["running"],
        "status":  _ml_train_state["status"],
        "started_at": _ml_train_state["started_at"],
        "summary": _ml_train_state["summary"],
    })


# ============================================================
# PORTFOLIO ANALYSIS (supports multiple named portfolios)
# ============================================================

# Per-portfolio scan state: { "main": { running, status, log_lines }, ... }
_portfolio_states = {}


def _get_pf_state(name):
    if name not in _portfolio_states:
        _portfolio_states[name] = {
            "running": False, "status": "idle", "log_lines": [],
        }
    return _portfolio_states[name]


def _pf_csv_name(name):
    """CSV filename for a named portfolio."""
    if name == "main":
        return "portfolio_analysis.csv"
    return f"portfolio_analysis_{name}.csv"


def _run_portfolio_scan(name, symbols, skip_cache=False):
    """Run portfolio analysis in a background thread."""
    state = _get_pf_state(name)
    state["running"] = True
    state["status"] = "scanning"
    state["log_lines"] = [f"Starting {name} portfolio scan ({len(symbols)} stocks)..."]

    try:
        from modules.portfolio_analyzer import PortfolioAnalyzer
        import logging

        class LogCapture(logging.Handler):
            def emit(self, record):
                msg = self.format(record)
                state["log_lines"].append(msg)
                if len(state["log_lines"]) > 200:
                    state["log_lines"] = state["log_lines"][-200:]

        handler = LogCapture()
        handler.setFormatter(logging.Formatter("%(message)s"))
        logging.getLogger().addHandler(handler)

        analyzer = PortfolioAnalyzer(skip_cache=skip_cache)
        csv_name = _pf_csv_name(name)
        df = analyzer.analyze(symbols, output_filename=csv_name)

        state["status"] = "completed"
    except Exception as e:
        state["status"] = f"error: {str(e)}"
        state["log_lines"].append(f"ERROR: {str(e)}")
    finally:
        state["running"] = False
        for h in logging.getLogger().handlers[:]:
            if isinstance(h, LogCapture):
                logging.getLogger().removeHandler(h)


@app.route("/api/portfolios", methods=["GET"])
def portfolios_list():
    """List all configured portfolios."""
    result = {}
    for name, pf in config.PORTFOLIOS.items():
        csv_path = os.path.join(config.DATA_DIR, _pf_csv_name(name))
        result[name] = {
            "label": pf["label"],
            "count": len(pf["stocks"]),
            "has_data": os.path.exists(csv_path),
        }
    return jsonify(result)


@app.route("/api/portfolio", methods=["GET"])
def portfolio():
    """Get portfolio analysis results. ?name=main (default) or ?name=sharekhan"""
    name = request.args.get("name", "main")
    data = load_csv(_pf_csv_name(name))
    if data is None:
        label = config.PORTFOLIOS.get(name, {}).get("label", name)
        return jsonify({"error": f"No {label} analysis found. Click 'Scan Portfolio' first."}), 404
    return jsonify(data)


@app.route("/api/portfolio/scan", methods=["POST"])
def portfolio_scan():
    """Start a portfolio scan. Body: { name, symbols, skip_cache }"""
    body = request.get_json(silent=True) or {}
    name = body.get("name", "main")
    state = _get_pf_state(name)

    if state["running"]:
        return jsonify({"error": "Portfolio scan already running"}), 409

    # Get symbols from body or config
    pf_config = config.PORTFOLIOS.get(name, {})
    symbols = body.get("symbols", pf_config.get("stocks", config.MY_PORTFOLIO))
    skip_cache = body.get("skip_cache", False)

    thread = threading.Thread(
        target=_run_portfolio_scan, args=(name, symbols, skip_cache), daemon=True
    )
    thread.start()

    return jsonify({"message": f"{name} portfolio scan started", "count": len(symbols)})


@app.route("/api/portfolio/alerts", methods=["GET"])
def portfolio_alerts():
    """Get actionable alerts for a portfolio. ?name=main"""
    name = request.args.get("name", "main")
    data = load_csv(_pf_csv_name(name))
    if data is None:
        return jsonify([])

    alerts = []
    for s in data:
        sym = (s.get("symbol") or "").replace(".NS", "")
        rec = s.get("recommendation", "")
        signal = s.get("signal", "")
        risk_level = s.get("risk_level", "")
        trend = s.get("trend", "")
        risk_score = s.get("risk_score")
        cmp = s.get("cmp")
        name_str = s.get("name", sym)

        base = {
            "symbol": sym,
            "name": name_str,
            "cmp": cmp,
            "recommendation": rec,
            "signal": signal,
            "risk_level": risk_level,
            "risk_score": risk_score,
            "trend": trend,
            "rationale": s.get("rationale", ""),
            "analyst_upside_pct": s.get("analyst_upside_pct"),
            "pct_from_52w_high": s.get("pct_from_52w_high"),
            "signal_details": s.get("signal_details", ""),
        }

        # STRONG BUY recommendation — accumulation opportunity
        if rec == "STRONG BUY":
            alerts.append({
                **base,
                "alert_type": "STRONG_BUY",
                "severity": "high",
                "message": f"{sym} is a STRONG BUY — fundamentals, valuation, and trend all favorable",
            })

        # SELL recommendation — exit signal
        if rec == "SELL":
            alerts.append({
                **base,
                "alert_type": "SELL_EXIT",
                "severity": "critical",
                "message": f"{sym} flagged for SELL — weak fundamentals and unfavorable conditions",
            })

        # REDUCE with HIGH risk — needs attention
        if rec == "REDUCE" and risk_level == "HIGH":
            alerts.append({
                **base,
                "alert_type": "HIGH_RISK_REDUCE",
                "severity": "critical",
                "message": f"{sym} is REDUCE + HIGH risk (score {risk_score}) — consider trimming position",
            })

        # BUY momentum signal (regardless of recommendation)
        if signal == "BUY":
            alerts.append({
                **base,
                "alert_type": "BUY_SIGNAL",
                "severity": "medium",
                "message": f"{sym} has a BUY momentum signal — {s.get('signal_details', '')}",
            })

        # SELL momentum signal — short-term warning
        if signal == "SELL":
            alerts.append({
                **base,
                "alert_type": "SELL_SIGNAL",
                "severity": "high",
                "message": f"{sym} has a SELL momentum signal — {s.get('signal_details', '')}",
            })

        # HIGH risk + BEARISH trend — danger zone
        if risk_level == "HIGH" and trend in ("BEARISH", "WEAK") and rec not in ("SELL",):
            alerts.append({
                **base,
                "alert_type": "DANGER_ZONE",
                "severity": "critical",
                "message": f"{sym} is HIGH risk ({risk_score}/100) with {trend} trend — monitor closely",
            })

    # Sort: critical first, then high, then medium
    severity_order = {"critical": 0, "high": 1, "medium": 2}
    alerts.sort(key=lambda a: severity_order.get(a["severity"], 9))

    return jsonify(alerts)


@app.route("/api/portfolio/status", methods=["GET"])
def portfolio_status():
    """Get portfolio scan status. ?name=main"""
    name = request.args.get("name", "main")
    state = _get_pf_state(name)
    return jsonify({
        "running": state["running"],
        "status": state["status"],
        "log_lines": state["log_lines"][-30:],
    })


# ============================================================
# PORTFOLIO INSIGHTS (Growth Trend & Valuation Trend)
# ============================================================

@app.route("/api/portfolio/growth-trend", methods=["GET"])
def portfolio_growth_trend():
    """Growth trend analysis for a portfolio. ?name=main"""
    name = request.args.get("name", "main")
    pf_config = config.PORTFOLIOS.get(name)
    if not pf_config:
        return jsonify({"error": f"Unknown portfolio: {name}"}), 404
    try:
        from modules.portfolio_insights import PortfolioInsights
        insights = PortfolioInsights()
        result = insights.growth_trend(pf_config["stocks"])
        return jsonify(_deep_sanitize(result))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/portfolio/valuation-trend", methods=["GET"])
def portfolio_valuation_trend():
    """Valuation trend (long-term PE) for a portfolio. ?name=main"""
    name = request.args.get("name", "main")
    pf_config = config.PORTFOLIOS.get(name)
    if not pf_config:
        return jsonify({"error": f"Unknown portfolio: {name}"}), 404
    try:
        from modules.portfolio_insights import PortfolioInsights
        insights = PortfolioInsights()
        result = insights.valuation_trend(pf_config["stocks"])
        return jsonify(_deep_sanitize(result))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/portfolio/calendar", methods=["GET"])
def portfolio_calendar():
    """Portfolio calendar — dividend/split events. ?name=main"""
    name = request.args.get("name", "main")
    pf_config = config.PORTFOLIOS.get(name)
    if not pf_config:
        return jsonify({"error": f"Unknown portfolio: {name}"}), 404
    try:
        from modules.portfolio_calendar import PortfolioCalendar
        cal = PortfolioCalendar()
        result = cal.get_events(pf_config["stocks"])
        return jsonify(_deep_sanitize(result))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/portfolio/hedge", methods=["GET"])
def portfolio_hedge():
    """Portfolio hedge analysis — beta & protection levels. ?name=main"""
    name = request.args.get("name", "main")
    pf_config = config.PORTFOLIOS.get(name)
    if not pf_config:
        return jsonify({"error": f"Unknown portfolio: {name}"}), 404
    try:
        from modules.portfolio_hedge import PortfolioHedge
        hedge = PortfolioHedge()
        result = hedge.analyze(pf_config["stocks"])
        return jsonify(_deep_sanitize(result))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/portfolio/report", methods=["GET"])
def portfolio_report():
    """Full portfolio report — performance, diversification, risk. ?name=main"""
    name = request.args.get("name", "main")
    pf_config = config.PORTFOLIOS.get(name)
    if not pf_config:
        return jsonify({"error": f"Unknown portfolio: {name}"}), 404
    try:
        from modules.portfolio_report import PortfolioReport
        report = PortfolioReport()
        result = report.generate(pf_config["stocks"])
        return jsonify(_deep_sanitize(result))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ============================================================
# REAL-TIME RISK SCAN (single stock, on demand)
# ============================================================

@app.route("/api/risk/<symbol>", methods=["GET"])
def risk_single(symbol):
    """Real-time risk analysis for a single stock (always fresh data)."""
    try:
        import yfinance as yf
        from modules.risk_analyzer import RiskAnalyzer

        if not symbol.endswith(".NS"):
            symbol += ".NS"

        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="1y", auto_adjust=True)

        if hist is None or hist.empty:
            return jsonify({"error": f"No price data for {symbol}"}), 404

        analyzer = RiskAnalyzer()
        risk = analyzer.analyze(hist)

        info = ticker.info or {}
        risk["symbol"] = symbol
        risk["name"] = info.get("shortName", symbol.replace(".NS", ""))
        risk["current_price"] = info.get("currentPrice") or info.get("regularMarketPrice")

        # Sanitize NaN
        risk = {k: _sanitize_value(v) for k, v in risk.items()}
        return jsonify(risk)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ============================================================
# VOLUME BREAKOUT SCANNER
# ============================================================

_volume_state = {
    "running": False, "status": "idle", "log_lines": [],
}


def _run_volume_scan():
    """Run volume breakout scan in a background thread."""
    _volume_state["running"] = True
    _volume_state["status"] = "scanning"
    _volume_state["log_lines"] = ["Starting volume breakout scan..."]

    try:
        from modules.volume_breakout import VolumeBreakoutScanner
        import logging

        class LogCapture(logging.Handler):
            def emit(self, record):
                msg = self.format(record)
                _volume_state["log_lines"].append(msg)
                if len(_volume_state["log_lines"]) > 200:
                    _volume_state["log_lines"] = _volume_state["log_lines"][-200:]

        handler = LogCapture()
        handler.setFormatter(logging.Formatter("%(message)s"))
        logging.getLogger().addHandler(handler)

        scanner = VolumeBreakoutScanner()
        scanner.scan()

        _volume_state["status"] = "completed"
    except Exception as e:
        _volume_state["status"] = f"error: {str(e)}"
        _volume_state["log_lines"].append(f"ERROR: {str(e)}")
    finally:
        _volume_state["running"] = False
        for h in logging.getLogger().handlers[:]:
            if isinstance(h, LogCapture):
                logging.getLogger().removeHandler(h)


@app.route("/api/volume-breakouts", methods=["GET"])
def volume_breakouts():
    """Get volume breakout stocks."""
    data = load_csv("volume_breakouts.csv")
    if data is None:
        return jsonify({"error": "No volume breakout data. Click 'Scan Breakouts' first."}), 404
    return jsonify(data)


@app.route("/api/volume-breakouts/scan", methods=["POST"])
def volume_breakouts_scan():
    """Start volume breakout scanning."""
    if _volume_state["running"]:
        return jsonify({"error": "Volume scan already running"}), 409

    thread = threading.Thread(target=_run_volume_scan, daemon=True)
    thread.start()

    return jsonify({"message": "Volume breakout scan started"})


@app.route("/api/volume-breakouts/status", methods=["GET"])
def volume_breakouts_status():
    """Get volume scan status."""
    return jsonify({
        "running": _volume_state["running"],
        "status": _volume_state["status"],
        "log_lines": _volume_state["log_lines"][-30:],
    })


# ============================================================
# 52-WEEK HIGH BREAKOUT SCANNER
# ============================================================

@app.route("/api/breakouts/52w", methods=["GET"])
def breakouts_52w():
    """
    Scan for stocks breaking out to 52-week highs on high volume.
    Uses top-screener universe (composite_ranked.csv) for speed.
    Query params:
      ?days=5        — look for breakout within last N trading days (default 5)
      ?vol_ratio=1.5 — minimum volume ratio vs 20-day avg (default 1.5)
    """
    try:
        days = int(request.args.get("days", 5))
        vol_ratio_min = float(request.args.get("vol_ratio", 1.5))

        # Load the screened universe (composite ranked stocks)
        import glob as _glob
        csv_candidates = [
            os.path.join(config.DATA_DIR, "composite_ranked.csv"),
            os.path.join(config.DATA_DIR, "fundamental_scores.csv"),
            os.path.join(config.DATA_DIR, "post_redflag.csv"),
        ]
        df = None
        for p in csv_candidates:
            if os.path.exists(p):
                df = pd.read_csv(p)
                break

        if df is None or df.empty:
            return jsonify({"error": "No screened universe available. Run the pipeline first."}), 404

        symbols = df["symbol"].dropna().tolist()[:200]  # cap at 200 for speed

        import yfinance as yf
        results = []

        # Batch download 1 year of data
        syms_str = " ".join(symbols)
        try:
            raw = yf.download(syms_str, period="1y", auto_adjust=True, progress=False, threads=True)
        except Exception as e:
            return jsonify({"error": f"Price data fetch failed: {e}"}), 500

        for sym in symbols:
            try:
                if isinstance(raw.columns, pd.MultiIndex):
                    close = raw["Close"][sym].dropna()
                    volume = raw["Volume"][sym].dropna()
                else:
                    close = raw["Close"].dropna()
                    volume = raw["Volume"].dropna()

                if len(close) < 60:
                    continue

                current = close.iloc[-1]

                # 52-week high excluding last `days` trading days
                prior_high = close.iloc[:-days].max() if len(close) > days else close.max()

                # Did we just cross the 52-week high?
                just_broke = current > prior_high

                if not just_broke:
                    continue

                # Volume check on the breakout day
                vol_20avg = volume.iloc[-21:-1].mean() if len(volume) > 21 else volume.mean()
                breakout_vol = volume.iloc[-1]
                vol_r = breakout_vol / vol_20avg if vol_20avg > 0 else 0

                if vol_r < vol_ratio_min:
                    continue

                # Above 50-day MA
                ma50 = close.rolling(50).mean().iloc[-1]
                if current < ma50:
                    continue

                # Price change on breakout day
                chg_pct = ((current / close.iloc[-2]) - 1) * 100 if len(close) >= 2 else 0

                # Get extra info from screener data
                row_info = df[df["symbol"] == sym].iloc[0].to_dict() if sym in df["symbol"].values else {}

                results.append({
                    "symbol": sym,
                    "name": row_info.get("name", sym.replace(".NS", "")),
                    "sector": row_info.get("sector", ""),
                    "cmp": round(float(current), 2),
                    "high_52w": round(float(close.max()), 2),
                    "prior_52w_high": round(float(prior_high), 2),
                    "breakout_pct": round(((current / prior_high) - 1) * 100, 2),
                    "change_pct": round(float(chg_pct), 2),
                    "volume_ratio": round(float(vol_r), 2),
                    "ma50": round(float(ma50), 2),
                    "fundamental_score": row_info.get("fundamental_score"),
                    "composite_score": row_info.get("composite_score"),
                    "final_score": row_info.get("final_score"),
                })
            except Exception:
                continue

        # Sort by volume ratio desc (strongest breakouts first)
        results.sort(key=lambda x: x["volume_ratio"], reverse=True)

        return jsonify({
            "breakouts": results,
            "count": len(results),
            "universe_scanned": len(symbols),
            "params": {"days": days, "vol_ratio_min": vol_ratio_min},
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ============================================================
# MULTIBAGGER SCREENER + REBALANCE
# ============================================================

_multibagger_state = {
    "running": False, "status": "idle", "log_lines": [],
}


def _run_multibagger_scan(skip_cache=False):
    """Run multibagger screening in a background thread."""
    _multibagger_state["running"] = True
    _multibagger_state["status"] = "screening"
    _multibagger_state["log_lines"] = ["Starting multibagger screening..."]

    try:
        from modules.multibagger_screener import MultibaggerScreener
        import logging

        class LogCapture(logging.Handler):
            def emit(self, record):
                msg = self.format(record)
                _multibagger_state["log_lines"].append(msg)
                if len(_multibagger_state["log_lines"]) > 200:
                    _multibagger_state["log_lines"] = _multibagger_state["log_lines"][-200:]

        handler = LogCapture()
        handler.setFormatter(logging.Formatter("%(message)s"))
        logging.getLogger().addHandler(handler)

        screener = MultibaggerScreener(skip_cache=skip_cache)
        screener.screen()

        _multibagger_state["status"] = "completed"
    except Exception as e:
        _multibagger_state["status"] = f"error: {str(e)}"
        _multibagger_state["log_lines"].append(f"ERROR: {str(e)}")
    finally:
        _multibagger_state["running"] = False
        for h in logging.getLogger().handlers[:]:
            if isinstance(h, LogCapture):
                logging.getLogger().removeHandler(h)


@app.route("/api/multibagger", methods=["GET"])
def multibagger():
    """Get multibagger candidates."""
    data = load_csv("multibagger_candidates.csv")
    if data is None:
        return jsonify({"error": "No multibagger data. Click 'Screen Multibaggers' first."}), 404
    return jsonify(data)


@app.route("/api/multibagger/scan", methods=["POST"])
def multibagger_scan():
    """Start multibagger screening."""
    if _multibagger_state["running"]:
        return jsonify({"error": "Multibagger scan already running"}), 409

    body = request.get_json(silent=True) or {}
    skip_cache = body.get("skip_cache", False)

    thread = threading.Thread(
        target=_run_multibagger_scan, args=(skip_cache,), daemon=True
    )
    thread.start()

    return jsonify({"message": "Multibagger screening started"})


@app.route("/api/multibagger/status", methods=["GET"])
def multibagger_status():
    """Get multibagger scan status."""
    return jsonify({
        "running": _multibagger_state["running"],
        "status": _multibagger_state["status"],
        "log_lines": _multibagger_state["log_lines"][-30:],
    })


@app.route("/api/market-condition", methods=["GET"])
def market_condition():
    """Get current broad-market regime (Nifty 50 analysis)."""
    try:
        from modules.market_condition_analyzer import MarketConditionAnalyzer
        mc = MarketConditionAnalyzer().analyze()
        return jsonify({k: _sanitize_value(v) if not isinstance(v, (dict, list)) else v
                        for k, v in mc.items()})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/rebalance", methods=["GET"])
def rebalance():
    """Get market-condition-aware portfolio rebalance suggestions. ?name=main"""
    name = request.args.get("name", "main")
    try:
        from modules.multibagger_screener import MultibaggerScreener
        screener = MultibaggerScreener()
        result = screener.get_rebalance_suggestions(name)
        # Sanitize list fields
        def sanitize_list(lst):
            return [{k: _sanitize_value(v) for k, v in item.items()} for item in lst]
        result["add"] = sanitize_list(result["add"])
        result["trim"] = sanitize_list(result["trim"])
        result["keep"] = sanitize_list(result["keep"])
        result["auto_rebalance"] = sanitize_list(result.get("auto_rebalance", []))
        # Sanitize market_condition scalars (keep nested dicts as-is)
        mc = result.get("market_condition", {})
        result["market_condition"] = {
            k: (_sanitize_value(v) if not isinstance(v, (dict, list)) else v)
            for k, v in mc.items()
        }
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ============================================================
# GENERIC INDEX SCANNER WITH PRICE PREDICTIONS
# (Midcap 150, LargeMidcap 250, Smallcap 250)
# ============================================================

# Per-index scan state
_index_states = {}

# Index registry: key -> (portfolio_key, csv_name, label)
INDEX_REGISTRY = {
    "midcap150":      ("midcap150",      "midcap150_predictions.csv",      "Nifty Midcap 150"),
    "largemidcap250": ("largemidcap250", "largemidcap250_predictions.csv", "Nifty LargeMidcap 250"),
    "smallcap250":    ("smallcap250",    "smallcap250_predictions.csv",    "Nifty Smallcap 250"),
}


def _get_index_state(index_key):
    if index_key not in _index_states:
        _index_states[index_key] = {
            "running": False, "status": "idle", "log_lines": [],
        }
    return _index_states[index_key]


def _run_index_scan(index_key):
    """Generic index scan: fetch live prices + generate price predictions."""
    pf_key, csv_name, label = INDEX_REGISTRY[index_key]
    state = _get_index_state(index_key)
    state["running"] = True
    state["status"] = "scanning"
    state["log_lines"] = [f"Starting {label} scan with price predictions..."]

    try:
        from modules.price_predictor import PricePredictor
        import logging

        class LogCapture(logging.Handler):
            def emit(self_, record):
                msg = self_.format(record)
                state["log_lines"].append(msg)
                if len(state["log_lines"]) > 200:
                    state["log_lines"] = state["log_lines"][-200:]

        handler = LogCapture()
        handler.setFormatter(logging.Formatter("%(message)s"))
        logging.getLogger().addHandler(handler)

        # Get symbols from config
        stocks = config.PORTFOLIOS.get(pf_key, {}).get("stocks", [])
        symbols_ns = [s.strip().upper() + ".NS" for s in stocks]
        state["log_lines"].append(f"Scanning {len(symbols_ns)} {label} stocks...")

        # Load screener data for enrichment
        composite = load_csv("composite_ranked.csv") or []
        comp_map = {r["symbol"]: r for r in composite}

        # Collect portfolio symbols (main + sharekhan only)
        all_pf_syms = set()
        for pf_name in ("main", "sharekhan"):
            pf = config.PORTFOLIOS.get(pf_name, {})
            for s in pf.get("stocks", []):
                all_pf_syms.add(s.strip().upper() + ".NS")

        # --- Fetch LIVE prices via yfinance ---
        import yfinance as yf

        state["log_lines"].append("Fetching real-time prices...")
        live_prices = {}
        try:
            batch_size = 50
            for i in range(0, len(symbols_ns), batch_size):
                batch = symbols_ns[i:i + batch_size]
                tickers_str = " ".join(batch)
                live_data = yf.download(tickers_str, period="1d", progress=False)
                if live_data is not None and not live_data.empty:
                    close_col = live_data["Close"] if "Close" in live_data.columns else None
                    if close_col is not None:
                        if len(batch) == 1:
                            val = close_col.iloc[-1] if len(close_col) > 0 else None
                            if val is not None and not (isinstance(val, float) and math.isnan(val)):
                                live_prices[batch[0]] = float(val)
                        else:
                            for sym in batch:
                                if sym in close_col.columns:
                                    val = close_col[sym].dropna()
                                    if len(val) > 0:
                                        live_prices[sym] = float(val.iloc[-1])
                state["log_lines"].append(
                    f"Live prices fetched: {len(live_prices)}/{min(i + batch_size, len(symbols_ns))}"
                )
        except Exception as e:
            state["log_lines"].append(f"Live price fetch warning: {str(e)}")

        state["log_lines"].append(
            f"Got real-time prices for {len(live_prices)} of {len(symbols_ns)} stocks"
        )

        # --- Download & cache 1-year + 3-year history for stocks missing it ---
        missing_1y = []
        missing_3y = []
        for sym in symbols_ns:
            cache_key = sym.replace(".", "_")
            cache_sym_dir = os.path.join(config.CACHE_DIR, cache_key)
            if not os.path.exists(os.path.join(cache_sym_dir, "history_1y.pkl")):
                missing_1y.append(sym)
            if not os.path.exists(os.path.join(cache_sym_dir, "history_3y.pkl")):
                missing_3y.append(sym)

        import pickle as _pickle

        def _download_and_cache(sym_list, period, label):
            if not sym_list:
                return 0
            state["log_lines"].append(
                f"Downloading {label} history for {len(sym_list)} stocks..."
            )
            dl_batch, downloaded = 10, 0
            for i in range(0, len(sym_list), dl_batch):
                batch = sym_list[i:i + dl_batch]
                try:
                    for sym in batch:
                        hist = yf.download(sym, period=period, progress=False)
                        if hist is not None and not hist.empty and len(hist) >= 30:
                            ckey = sym.replace(".", "_")
                            cdir = os.path.join(config.CACHE_DIR, ckey)
                            os.makedirs(cdir, exist_ok=True)
                            with open(os.path.join(cdir, f"history_{period}.pkl"), "wb") as hf:
                                _pickle.dump(hist, hf)
                            downloaded += 1
                except Exception as dl_err:
                    state["log_lines"].append(f"Download warning: {str(dl_err)}")
            state["log_lines"].append(
                f"{label} history download complete: {downloaded} of {len(sym_list)} stocks"
            )
            return downloaded

        _download_and_cache(missing_1y, "1y", "1-year")
        _download_and_cache(missing_3y, "3y", "3-year")

        # --- Batch fetch ticker info for extra fields ---
        state["log_lines"].append("Fetching stock info (market cap, promoter holdings)...")
        ticker_info_map = {}
        try:
            from utils.data_fetcher import DataFetcher
            fetcher = DataFetcher()
            ticker_info_map = fetcher.batch_fetch_info(symbols_ns)
        except Exception as info_err:
            state["log_lines"].append(f"Info fetch warning: {str(info_err)}")

        # --- Generate predictions ---
        predictor = PricePredictor()
        results = []
        scanned = 0
        errors = 0

        for sym in symbols_ns:
            try:
                pred = predictor.predict_stock(sym)
                if pred:
                    # Override CMP with live price
                    if sym in live_prices:
                        live_cmp = live_prices[sym]
                        pred["cmp"] = round(live_cmp, 2)
                        if live_cmp > 0:
                            if pred.get("target_1d"):
                                pred["upside_1d_pct"] = round(
                                    (pred["target_1d"] - live_cmp) / live_cmp * 100, 1)
                            pred["upside_7d_pct"] = round(
                                (pred["target_7d"] - live_cmp) / live_cmp * 100, 1)
                            pred["upside_30d_pct"] = round(
                                (pred["target_30d"] - live_cmp) / live_cmp * 100, 1)
                            pred["upside_90d_pct"] = round(
                                (pred["target_90d"] - live_cmp) / live_cmp * 100, 1)

                    # Enrich with screener data
                    comp = comp_map.get(sym, {})
                    pred["name"] = comp.get("name", sym.replace(".NS", ""))
                    pred["sector"] = comp.get("sector", "")
                    pred["industry"] = comp.get("industry", "")
                    pred["market_cap"] = comp.get("market_cap")
                    pred["composite_score"] = comp.get("composite_score")
                    pred["fundamental_score"] = comp.get("fundamental_score")
                    pred["technical_score"] = comp.get("technical_score")
                    pred["composite_rank"] = comp.get("composite_rank")
                    pred["in_portfolio"] = sym in all_pf_syms

                    # Extra fields from ticker info
                    t_info = ticker_info_map.get(sym, {})
                    cmp_val = pred.get("cmp")
                    prev_close = t_info.get("previousClose") or t_info.get("regularMarketPreviousClose")
                    if cmp_val and prev_close and prev_close > 0:
                        pred["change_pct"] = round((cmp_val - prev_close) / prev_close * 100, 2)
                    mcap = t_info.get("marketCap")
                    if mcap and not (isinstance(mcap, float) and math.isnan(mcap)):
                        pred["market_cap_cr"] = round(float(mcap) / 1e7, 1)
                    promoter = t_info.get("heldPercentInsiders")
                    if promoter is not None and not (isinstance(promoter, float) and math.isnan(promoter)):
                        pred["promoter_holding_pct"] = round(float(promoter) * 100, 1)

                    results.append(pred)
                    scanned += 1
                else:
                    errors += 1
            except Exception:
                errors += 1

            if scanned % 25 == 0 and scanned > 0:
                state["log_lines"].append(f"Processed {scanned} stocks...")

        results.sort(key=lambda x: x.get("upside_30d_pct", 0), reverse=True)

        if results:
            df = pd.DataFrame(results)
            out_path = os.path.join(config.DATA_DIR, csv_name)
            df.to_csv(out_path, index=False)
            state["log_lines"].append(f"Saved {len(results)} predictions to {csv_name}")

        state["log_lines"].append(f"Done: {scanned} scanned, {errors} errors")
        state["status"] = "completed"
    except Exception as e:
        state["status"] = f"error: {str(e)}"
        state["log_lines"].append(f"ERROR: {str(e)}")
    finally:
        state["running"] = False
        for h in logging.getLogger().handlers[:]:
            if isinstance(h, LogCapture):
                logging.getLogger().removeHandler(h)


def _index_live_refresh(csv_name):
    """Generic live price refresh for any index prediction CSV."""
    import yfinance as yf
    from datetime import datetime

    data = load_csv(csv_name)
    if data is None:
        return None

    symbols = [r["symbol"] for r in data if r.get("symbol")]
    live_prices = {}
    try:
        batch_size = 50
        for i in range(0, len(symbols), batch_size):
            batch = symbols[i:i + batch_size]
            tickers_str = " ".join(batch)
            live_data = yf.download(tickers_str, period="1d", progress=False)
            if live_data is not None and not live_data.empty:
                close_col = live_data.get("Close")
                if close_col is not None:
                    if len(batch) == 1:
                        val = close_col.iloc[-1] if len(close_col) > 0 else None
                        if val is not None and not (isinstance(val, float) and math.isnan(val)):
                            live_prices[batch[0]] = float(val)
                    else:
                        for sym in batch:
                            if sym in close_col.columns:
                                val = close_col[sym].dropna()
                                if len(val) > 0:
                                    live_prices[sym] = float(val.iloc[-1])
    except Exception:
        pass

    for row in data:
        sym = row.get("symbol")
        if sym in live_prices:
            live_cmp = live_prices[sym]
            row["cmp"] = round(live_cmp, 2)
            if live_cmp > 0:
                for key_t, key_u in [("target_7d", "upside_7d_pct"),
                                     ("target_30d", "upside_30d_pct"),
                                     ("target_90d", "upside_90d_pct")]:
                    t = row.get(key_t)
                    if t is not None:
                        row[key_u] = round((t - live_cmp) / live_cmp * 100, 1)

    data.sort(key=lambda x: x.get("upside_30d_pct", 0), reverse=True)
    return {
        "data": data,
        "updated_at": datetime.now().strftime("%H:%M:%S"),
        "live_count": len(live_prices),
    }


# --- Midcap 150 endpoints ---

@app.route("/api/midcap150", methods=["GET"])
def midcap150():
    data = load_csv("midcap150_predictions.csv")
    if data is None:
        return jsonify({"error": "No Midcap 150 data. Click 'Scan' first."}), 404
    return jsonify(data)


@app.route("/api/midcap150/scan", methods=["POST"])
def midcap150_scan():
    state = _get_index_state("midcap150")
    if state["running"]:
        return jsonify({"error": "Scan already running"}), 409
    thread = threading.Thread(target=_run_index_scan, args=("midcap150",), daemon=True)
    thread.start()
    return jsonify({"message": "Midcap 150 scan started"})


@app.route("/api/midcap150/live", methods=["GET"])
def midcap150_live():
    result = _index_live_refresh("midcap150_predictions.csv")
    if result is None:
        return jsonify({"error": "No data. Run scan first."}), 404
    return jsonify(result)


@app.route("/api/midcap150/status", methods=["GET"])
def midcap150_status():
    state = _get_index_state("midcap150")
    return jsonify({
        "running": state["running"],
        "status": state["status"],
        "log_lines": state["log_lines"][-30:],
    })


# --- LargeMidcap 250 endpoints ---

@app.route("/api/largemidcap250", methods=["GET"])
def largemidcap250():
    data = load_csv("largemidcap250_predictions.csv")
    if data is None:
        return jsonify({"error": "No LargeMidcap 250 data. Click 'Scan' first."}), 404
    return jsonify(data)


@app.route("/api/largemidcap250/scan", methods=["POST"])
def largemidcap250_scan():
    state = _get_index_state("largemidcap250")
    if state["running"]:
        return jsonify({"error": "Scan already running"}), 409
    thread = threading.Thread(target=_run_index_scan, args=("largemidcap250",), daemon=True)
    thread.start()
    return jsonify({"message": "LargeMidcap 250 scan started"})


@app.route("/api/largemidcap250/live", methods=["GET"])
def largemidcap250_live():
    result = _index_live_refresh("largemidcap250_predictions.csv")
    if result is None:
        return jsonify({"error": "No data. Run scan first."}), 404
    return jsonify(result)


@app.route("/api/largemidcap250/status", methods=["GET"])
def largemidcap250_status():
    state = _get_index_state("largemidcap250")
    return jsonify({
        "running": state["running"],
        "status": state["status"],
        "log_lines": state["log_lines"][-30:],
    })


# --- Smallcap 250 endpoints ---

@app.route("/api/smallcap250", methods=["GET"])
def smallcap250():
    data = load_csv("smallcap250_predictions.csv")
    if data is None:
        return jsonify({"error": "No Smallcap 250 data. Click 'Scan' first."}), 404
    return jsonify(data)


@app.route("/api/smallcap250/scan", methods=["POST"])
def smallcap250_scan():
    state = _get_index_state("smallcap250")
    if state["running"]:
        return jsonify({"error": "Scan already running"}), 409
    thread = threading.Thread(target=_run_index_scan, args=("smallcap250",), daemon=True)
    thread.start()
    return jsonify({"message": "Smallcap 250 scan started"})


@app.route("/api/smallcap250/live", methods=["GET"])
def smallcap250_live():
    result = _index_live_refresh("smallcap250_predictions.csv")
    if result is None:
        return jsonify({"error": "No data. Run scan first."}), 404
    return jsonify(result)


@app.route("/api/smallcap250/status", methods=["GET"])
def smallcap250_status():
    state = _get_index_state("smallcap250")
    return jsonify({
        "running": state["running"],
        "status": state["status"],
        "log_lines": state["log_lines"][-30:],
    })


# ========================================================================
# Daily Report endpoints
# ========================================================================

_daily_state = {"running": False, "status": "idle", "log_lines": []}


@app.route("/api/daily", methods=["GET"])
def daily_report_get():
    """Return the latest daily report."""
    from modules.daily_report import DailyReportGenerator
    gen = DailyReportGenerator()
    report = gen.get_latest_report()
    if report is None:
        return jsonify({"error": "No daily report yet. Click 'Generate' to create one."}), 404
    return jsonify(report)


@app.route("/api/daily/generate", methods=["POST"])
def daily_report_generate():
    """Generate a fresh daily report."""
    if _daily_state["running"]:
        return jsonify({"error": "Report generation already running"}), 409

    def run_gen():
        _daily_state["running"] = True
        _daily_state["status"] = "generating"
        _daily_state["log_lines"] = ["Starting daily report generation..."]
        try:
            from modules.daily_report import DailyReportGenerator
            gen = DailyReportGenerator()

            def cb(msg):
                _daily_state["log_lines"].append(msg)
                if len(_daily_state["log_lines"]) > 100:
                    _daily_state["log_lines"] = _daily_state["log_lines"][-100:]

            gen.generate(callback=cb)
            _daily_state["status"] = "completed"
        except Exception as e:
            _daily_state["status"] = f"error: {str(e)}"
            _daily_state["log_lines"].append(f"ERROR: {str(e)}")
        finally:
            _daily_state["running"] = False

    thread = threading.Thread(target=run_gen, daemon=True)
    thread.start()
    return jsonify({"message": "Daily report generation started"})


@app.route("/api/daily/status", methods=["GET"])
def daily_report_status():
    return jsonify({
        "running": _daily_state["running"],
        "status": _daily_state["status"],
        "log_lines": _daily_state["log_lines"][-30:],
    })


@app.route("/api/predict/<symbol>", methods=["GET"])
def predict_single(symbol):
    """Price prediction for a single stock with real-time CMP."""
    try:
        from modules.price_predictor import PricePredictor
        import yfinance as yf

        if not symbol.endswith(".NS"):
            symbol += ".NS"

        predictor = PricePredictor()
        result = predictor.predict_stock(symbol)

        if result is None:
            return jsonify({"error": f"No price data for {symbol}"}), 404

        # Fetch live price
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info or {}
            live_price = info.get("currentPrice") or info.get("regularMarketPrice")
            if live_price and not (isinstance(live_price, float) and math.isnan(live_price)):
                live_price = float(live_price)
                result["cmp"] = round(live_price, 2)
                if live_price > 0:
                    result["upside_7d_pct"] = round(
                        (result["target_7d"] - live_price) / live_price * 100, 1
                    )
                    result["upside_30d_pct"] = round(
                        (result["target_30d"] - live_price) / live_price * 100, 1
                    )
                    result["upside_90d_pct"] = round(
                        (result["target_90d"] - live_price) / live_price * 100, 1
                    )
                # Price change %
                prev_close = info.get("previousClose") or info.get("regularMarketPreviousClose")
                if prev_close and not (isinstance(prev_close, float) and math.isnan(prev_close)):
                    result["change_pct"] = round((live_price - float(prev_close)) / float(prev_close) * 100, 2)
            # Market cap
            mcap = info.get("marketCap")
            if mcap and not (isinstance(mcap, float) and math.isnan(mcap)):
                result["market_cap_cr"] = round(float(mcap) / 1e7, 1)
            # Promoter / insider holding
            promoter = info.get("heldPercentInsiders")
            if promoter is not None and not (isinstance(promoter, float) and math.isnan(promoter)):
                result["promoter_holding_pct"] = round(float(promoter) * 100, 1)
        except Exception:
            info = {}

        # DCF Intrinsic Value
        try:
            from modules.dcf_calculator import DCFCalculator
            dcf = DCFCalculator().calculate(symbol, info=info)
            if dcf:
                result["intrinsic_value"] = dcf["intrinsic_value"]
                result["dcf_upside_pct"] = dcf["dcf_upside_pct"]
                result["wacc_used"] = dcf["wacc_used"]
                result["fcf_growth_used"] = dcf["fcf_growth_used"]
                result["terminal_growth"] = dcf["terminal_growth"]
                result["current_fcf_cr"] = dcf["current_fcf_cr"]
        except Exception:
            pass

        result = {k: _sanitize_value(v) for k, v in result.items()}
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# --------------- Portfolio CSV import ---------------
PORTFOLIO_OVERRIDES_DIR = os.path.join(config.DATA_DIR, "portfolio_overrides")
os.makedirs(PORTFOLIO_OVERRIDES_DIR, exist_ok=True)


def _load_portfolio_override(name):
    """Load portfolio override from JSON file if it exists."""
    path = os.path.join(PORTFOLIO_OVERRIDES_DIR, f"{name}.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return None


def _save_portfolio_override(name, symbols, label=None):
    """Save portfolio override to JSON file and update runtime config."""
    path = os.path.join(PORTFOLIO_OVERRIDES_DIR, f"{name}.json")
    data = {"symbols": symbols}
    if label:
        data["label"] = label
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    # Update runtime config
    if name in config.PORTFOLIOS:
        config.PORTFOLIOS[name]["stocks"] = symbols
        if label:
            config.PORTFOLIOS[name]["label"] = label
    else:
        config.PORTFOLIOS[name] = {"label": label or name, "stocks": symbols}


# Load any existing overrides on startup
for _ovr_file in os.listdir(PORTFOLIO_OVERRIDES_DIR):
    if _ovr_file.endswith(".json"):
        _ovr_name = _ovr_file.replace(".json", "")
        _ovr_data = _load_portfolio_override(_ovr_name)
        if _ovr_data and "symbols" in _ovr_data:
            if _ovr_name in config.PORTFOLIOS:
                config.PORTFOLIOS[_ovr_name]["stocks"] = _ovr_data["symbols"]
            else:
                config.PORTFOLIOS[_ovr_name] = {
                    "label": _ovr_data.get("label", _ovr_name),
                    "stocks": _ovr_data["symbols"],
                }


@app.route("/api/portfolio/import-csv", methods=["POST"])
def portfolio_import_csv():
    """Import portfolio holdings from a CSV or Excel file.

    Accepts multipart form data with:
      - file: CSV or XLS/XLSX file (required)
      - name: portfolio name (default: auto-detect from filename or 'imported')

    Supports common broker CSV/Excel formats:
      - Looks for columns containing 'symbol', 'scrip', 'stock', 'name', 'ticker', 'isin'
      - Strips common suffixes like '.NS', '.BSE', '-EQ'
      - Deduplicates and sorts
    """
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded. Use multipart form with 'file' field."}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "Empty filename"}), 400

    portfolio_name = request.form.get("name", "").strip().lower()
    if not portfolio_name:
        # Try to guess from filename
        base = os.path.splitext(file.filename)[0].lower()
        if "sharekhan" in base:
            portfolio_name = "sharekhan"
        elif "nuvama" in base or "nuwama" in base or "edelweiss" in base:
            portfolio_name = "main"
        else:
            portfolio_name = "main"

    # Detect file type by extension and parse
    import io
    ext = os.path.splitext(file.filename)[1].lower()
    file_bytes = file.read()
    df = None
    parse_error = None

    if ext == ".xlsx":
        try:
            df = pd.read_excel(io.BytesIO(file_bytes), engine="openpyxl")
        except Exception as e:
            parse_error = str(e)
    elif ext == ".xls":
        # Try xlrd first (real .xls BIFF format)
        try:
            df = pd.read_excel(io.BytesIO(file_bytes), engine="xlrd")
        except Exception:
            pass
        # Many broker .xls files are actually HTML tables — try that
        if df is None:
            try:
                tables = pd.read_html(io.BytesIO(file_bytes))
                if tables:
                    # Pick the table with the most rows (likely the data table)
                    df = max(tables, key=lambda t: len(t))
            except Exception:
                pass
        # Last resort: try openpyxl (some .xls are really .xlsx)
        if df is None:
            try:
                df = pd.read_excel(io.BytesIO(file_bytes), engine="openpyxl")
            except Exception as e:
                parse_error = f"Could not parse .xls file (tried xlrd, HTML, openpyxl): {e}"
    else:
        # Default: treat as CSV
        try:
            content = file_bytes.decode("utf-8", errors="ignore")
            df = pd.read_csv(io.StringIO(content))
        except Exception as e:
            parse_error = str(e)

    if df is None:
        return jsonify({"error": f"Failed to parse file: {parse_error or 'Unknown format'}"}), 400

    if df.empty:
        return jsonify({"error": "File is empty"}), 400

    # Ensure all column names are strings
    df.columns = [str(c) for c in df.columns]

    # --- Smart header detection ---
    # Broker exports often have metadata/title rows before the actual data.
    # Scan the first 40 rows for a row that looks like a column header.
    _header_keywords = {
        "symbol", "scrip", "scripname", "scrip name", "stock symbol",
        "ticker", "stock", "trading symbol", "tradingsymbol",
        "instrument", "security", "security name", "isin",
        "name", "stock name", "skscripcode",
        "qty", "quantity", "current qty",
        "ltp", "avgcost", "avg cost", "investment price",
        "current market price", "holding value", "market value",
    }

    def _row_has_header(row_vals):
        matches = sum(1 for v in row_vals if str(v).strip().lower() in _header_keywords)
        return matches >= 2  # At least 2 known column names

    # Check if current columns are already good
    current_cols_lower = {str(c).lower().strip() for c in df.columns}
    if not (current_cols_lower & _header_keywords):
        # Current headers don't match — scan rows for the real header
        for row_idx in range(min(40, len(df))):
            row_vals = df.iloc[row_idx].tolist()
            if _row_has_header(row_vals):
                df.columns = [str(v).strip() for v in row_vals]
                df = df.iloc[row_idx + 1:].reset_index(drop=True)
                break

    # Drop empty columns (columns named 'nan' or 'Unnamed:*')
    drop_cols = [c for c in df.columns if str(c).lower().strip() in ("nan",) or str(c).startswith("Unnamed")]
    if drop_cols and len(df.columns) - len(drop_cols) >= 2:
        df = df.drop(columns=drop_cols)

    # Drop rows that are summaries (e.g. "Total" in first column)
    first_col = df.columns[0]
    df = df[~df[first_col].astype(str).str.strip().str.lower().isin(["total", "grand total"])]
    df = df.dropna(subset=[first_col])
    df = df.reset_index(drop=True)

    # Find the best column for stock symbols
    cols_lower = {str(c).lower().strip(): c for c in df.columns}
    symbol_col = None
    for candidate in ["symbol", "scrip", "scrip name", "scripname", "stock symbol",
                       "ticker", "stock", "stock name", "trading symbol", "tradingsymbol",
                       "instrument", "name", "security", "security name"]:
        if candidate in cols_lower:
            symbol_col = cols_lower[candidate]
            break

    if symbol_col is None:
        # Fallback: use the first column
        symbol_col = df.columns[0]

    raw_symbols = df[symbol_col].dropna().astype(str).str.strip().tolist()

    # Clean up symbols
    symbols = []
    for s in raw_symbols:
        s = s.upper().strip()
        # Remove common suffixes
        for suffix in [".NS", ".BSE", "-EQ", " EQ", "-BE", " BE"]:
            if s.endswith(suffix):
                s = s[: -len(suffix)]
        s = s.strip()
        if s and len(s) >= 2 and s not in symbols and not s.startswith("ISIN"):
            symbols.append(s)

    if not symbols:
        return jsonify({"error": "No valid stock symbols found in CSV"}), 400

    # Check for quantity column (optional enrichment)
    qty_col = None
    for candidate in ["quantity", "qty", "total quantity", "net qty", "holding qty"]:
        if candidate in cols_lower:
            qty_col = cols_lower[candidate]
            break

    label = config.PORTFOLIOS.get(portfolio_name, {}).get("label", portfolio_name.title())
    _save_portfolio_override(portfolio_name, symbols, label)

    result = {
        "portfolio": portfolio_name,
        "label": label,
        "symbols": symbols,
        "count": len(symbols),
        "source_file": file.filename,
        "column_used": symbol_col,
    }

    return jsonify(result)



# ─── MF Holdings storage (separate from equity portfolio) ────────────────────
MF_HOLDINGS_FILE = os.path.join(config.DATA_DIR, "mf_holdings.json")


def _load_mf_holdings():
    try:
        with open(MF_HOLDINGS_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def _save_mf_holdings(data: dict):
    os.makedirs(config.DATA_DIR, exist_ok=True)
    with open(MF_HOLDINGS_FILE, "w") as f:
        json.dump(data, f, indent=2, default=str)


def _parse_cas_with_casparser(file_bytes, password: str):
    """Use the `casparser` library to parse a CAMS/KFintech/MF Central CAS PDF.

    Returns a structured dict:
      investor: {name, email, address}
      folios: list of {amc, folio, pan, schemes: [{scheme, isin, amfi,
              units, nav, value, cost, gain, gain_pct}]}
      as_of: valuation date string
      total_value: float
      total_cost: float
    """
    import casparser
    import io

    data = casparser.read_cas_pdf(io.BytesIO(file_bytes), password, output="dict")

    investor = {}
    if "investor_info" in data:
        ii = data["investor_info"]
        investor = {
            "name": ii.get("name", ""),
            "email": ii.get("email", ""),
            "address": ii.get("address", ""),
        }

    schemes_out = []
    total_value = 0.0
    total_cost = 0.0
    as_of = ""

    for folio in data.get("folios", []):
        amc = folio.get("amc", "")
        folio_no = folio.get("folio", "")
        pan = folio.get("PAN", "")

        for scheme in folio.get("schemes", []):
            val_info = scheme.get("valuation", {}) or {}
            nav = float(val_info.get("nav") or 0)
            value = float(val_info.get("value") or 0)
            cost = float(val_info.get("cost") or 0)
            units = float(scheme.get("close") or scheme.get("open") or 0)
            gain = value - cost
            gain_pct = (gain / cost * 100) if cost else 0
            val_date = str(val_info.get("date") or "")
            if val_date and not as_of:
                as_of = val_date

            total_value += value
            total_cost += cost

            schemes_out.append({
                "amc": amc,
                "folio": folio_no,
                "pan": pan,
                "scheme": scheme.get("scheme", ""),
                "isin": scheme.get("isin", ""),
                "amfi": scheme.get("amfi", ""),
                "units": round(units, 4),
                "nav": round(nav, 4),
                "value": round(value, 2),
                "cost": round(cost, 2),
                "gain": round(gain, 2),
                "gain_pct": round(gain_pct, 2),
                "as_of": val_date,
            })

    return {
        "investor": investor,
        "schemes": schemes_out,
        "as_of": as_of,
        "total_value": round(total_value, 2),
        "total_cost": round(total_cost, 2),
        "total_gain": round(total_value - total_cost, 2),
        "total_gain_pct": round((total_value - total_cost) / total_cost * 100, 2) if total_cost else 0,
    }


@app.route("/api/portfolio/import-cams", methods=["POST"])
def portfolio_import_cams():
    """Parse a MF Central / CAMS / KFintech CAS PDF and store MF holdings.

    MF Central CAS PDFs from https://mfc-cas.mfcentral.com/ are password-protected.
    Password = PAN (uppercase) + Date-of-Birth in DDMMYYYY format.
    e.g. PAN=ABCDE1234F, DOB=05-Jan-1990 → password ABCDE1234F05011990

    Form fields:
      file       — CAS PDF file (required)
      pan        — PAN number, e.g. ABCDE1234F  (required for MF Central PDFs)
      dob        — Date of birth DDMMYYYY, e.g. 05011990 (required for MF Central PDFs)
      password   — override: full PDF password (optional, skips PAN+DOB)
      portfolio  — portfolio name (default: 'main')
    """
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "Empty filename"}), 400

    portfolio_name = (request.form.get("portfolio") or request.form.get("name") or "main").strip().lower()
    file_bytes = file.read()
    ext = os.path.splitext(file.filename)[1].lower()

    if ext != ".pdf":
        return jsonify({
            "error": "MF Central CAS files are PDFs. For broker Excel exports use /api/portfolio/import-csv."
        }), 400

    # Build the PDF password
    password = (request.form.get("password") or "").strip()
    if not password:
        pan = (request.form.get("pan") or "").strip().upper()
        dob = (request.form.get("dob") or "").strip().replace("-", "").replace("/", "")
        if not pan or not dob:
            return jsonify({
                "error": "Provide 'pan' + 'dob' (DDMMYYYY) or the full 'password' field.",
                "hint": "MF Central PDF password = PAN + DDMMYYYY date-of-birth, e.g. ABCDE1234F05011990",
            }), 400
        password = pan + dob

    try:
        result = _parse_cas_with_casparser(file_bytes, password)
    except Exception as e:
        err_str = str(e).lower()
        if "password" in err_str or "decrypt" in err_str or "incorrect" in err_str:
            return jsonify({
                "error": "Wrong PDF password. Check PAN and date-of-birth (DDMMYYYY format).",
                "hint": f"Tried password: {password[:5]}...{password[-4:] if len(password) > 8 else ''}",
            }), 400
        return jsonify({"error": f"Could not parse CAS PDF: {e}"}), 400

    if not result["schemes"]:
        return jsonify({"error": "No mutual fund schemes found in the CAS PDF."}), 400

    # Persist MF holdings (keyed by portfolio_name)
    mf_store = _load_mf_holdings()
    mf_store[portfolio_name] = {
        **result,
        "imported_at": pd.Timestamp.now().isoformat(),
        "source_file": file.filename,
    }
    _save_mf_holdings(mf_store)

    return jsonify({
        "portfolio": portfolio_name,
        "investor": result["investor"],
        "schemes": result["schemes"],
        "scheme_count": len(result["schemes"]),
        "as_of": result["as_of"],
        "total_value": result["total_value"],
        "total_cost": result["total_cost"],
        "total_gain": result["total_gain"],
        "total_gain_pct": result["total_gain_pct"],
        "saved": True,
    })


@app.route("/api/portfolio/mf-holdings", methods=["GET"])
def portfolio_mf_holdings():
    """Return saved MF holdings for a portfolio (parsed from MF Central CAS)."""
    portfolio_name = request.args.get("name", "main")
    mf_store = _load_mf_holdings()
    data = mf_store.get(portfolio_name)
    if not data:
        return jsonify({"schemes": [], "total_value": 0, "total_cost": 0, "as_of": None}), 200
    return jsonify(data)


@app.route("/api/portfolio/add-stock", methods=["POST"])
def portfolio_add_stock():
    """Add a stock to a portfolio."""
    body = request.get_json(force=True) or {}
    name = body.get("name", "main")
    sym = (body.get("symbol") or "").strip().upper()
    if not sym:
        return jsonify({"error": "Symbol is required"}), 400

    pf = config.PORTFOLIOS.get(name)
    if not pf:
        return jsonify({"error": f"Portfolio '{name}' not found"}), 404

    stocks = pf.get("stocks", [])
    if sym not in stocks:
        stocks.append(sym)
        _save_portfolio_override(name, stocks)

    return jsonify({"symbols": stocks, "count": len(stocks)})


@app.route("/api/portfolio/remove-stock", methods=["POST"])
def portfolio_remove_stock():
    """Remove a stock from a portfolio."""
    body = request.get_json(force=True) or {}
    name = body.get("name", "main")
    sym = (body.get("symbol") or "").strip().upper()
    if not sym:
        return jsonify({"error": "Symbol is required"}), 400

    pf = config.PORTFOLIOS.get(name)
    if not pf:
        return jsonify({"error": f"Portfolio '{name}' not found"}), 404

    stocks = [s for s in pf.get("stocks", []) if s != sym]
    _save_portfolio_override(name, stocks)

    return jsonify({"symbols": stocks, "count": len(stocks)})


# --------------- Watchlist endpoints ---------------
WATCHLIST_FILE = os.path.join(config.DATA_DIR, "watchlist.json")


def _load_watchlist():
    if os.path.exists(WATCHLIST_FILE):
        with open(WATCHLIST_FILE) as f:
            return json.load(f)
    return []


def _save_watchlist(symbols):
    os.makedirs(os.path.dirname(WATCHLIST_FILE), exist_ok=True)
    with open(WATCHLIST_FILE, "w") as f:
        json.dump(symbols, f, indent=2)


@app.route("/api/watchlist", methods=["GET"])
def get_watchlist():
    symbols = _load_watchlist()
    # Try to load cached stock data
    stock_data = {}
    cache_path = os.path.join(config.DATA_DIR, "watchlist_data.json")
    if os.path.exists(cache_path):
        with open(cache_path) as f:
            stock_data = json.load(f)
    return jsonify({"symbols": symbols, "stock_data": stock_data})


@app.route("/api/watchlist/add", methods=["POST"])
def add_to_watchlist():
    body = request.get_json(force=True) or {}
    sym = (body.get("symbol") or "").strip().upper()
    if not sym:
        return jsonify({"error": "Symbol is required"}), 400
    if not sym.endswith(".NS"):
        sym_ns = sym + ".NS"
    else:
        sym_ns = sym
    symbols = _load_watchlist()
    if sym_ns not in symbols:
        symbols.append(sym_ns)
        _save_watchlist(symbols)
    return jsonify({"symbols": symbols})


@app.route("/api/watchlist/remove", methods=["POST"])
def remove_from_watchlist():
    body = request.get_json(force=True) or {}
    sym = (body.get("symbol") or "").strip().upper()
    if not sym:
        return jsonify({"error": "Symbol is required"}), 400
    symbols = _load_watchlist()
    # Remove with or without .NS
    symbols = [s for s in symbols if s != sym and s != sym + ".NS" and s.replace(".NS", "") != sym]
    _save_watchlist(symbols)
    return jsonify({"symbols": symbols})


@app.route("/api/watchlist/scan", methods=["POST"])
def scan_watchlist():
    """Scan all watchlist stocks with price predictions."""
    import yfinance as yf
    from modules.price_predictor import PricePredictor

    symbols = _load_watchlist()
    if not symbols:
        return jsonify({"symbols": [], "stock_data": {}})

    predictor = PricePredictor()
    stock_data = {}

    for sym in symbols:
        try:
            result = predictor.predict_stock(sym)
            if result is None:
                stock_data[sym] = {}
                continue
            # Fetch live price
            try:
                ticker = yf.Ticker(sym)
                info = ticker.info or {}
                live = info.get("currentPrice") or info.get("regularMarketPrice")
                prev_close = info.get("previousClose") or info.get("regularMarketPreviousClose")
                if live and not (isinstance(live, float) and math.isnan(live)):
                    live = float(live)
                    result["cmp"] = round(live, 2)
                    if live > 0:
                        if result.get("target_1d"):
                            result["upside_1d_pct"] = round((result["target_1d"] - live) / live * 100, 1)
                        result["upside_7d_pct"] = round((result["target_7d"] - live) / live * 100, 1)
                        result["upside_30d_pct"] = round((result["target_30d"] - live) / live * 100, 1)
                        result["upside_90d_pct"] = round((result["target_90d"] - live) / live * 100, 1)
                    if prev_close:
                        result["change_pct"] = round((live - float(prev_close)) / float(prev_close) * 100, 2)
                # Market cap
                mcap = info.get("marketCap")
                if mcap and not (isinstance(mcap, float) and math.isnan(mcap)):
                    result["market_cap_cr"] = round(float(mcap) / 1e7, 1)
                # Promoter / insider holding
                promoter = info.get("heldPercentInsiders")
                if promoter is not None and not (isinstance(promoter, float) and math.isnan(promoter)):
                    result["promoter_holding_pct"] = round(float(promoter) * 100, 1)
            except Exception:
                pass
            stock_data[sym] = {k: _sanitize_value(v) for k, v in result.items()}
        except Exception:
            stock_data[sym] = {}

    # Cache results
    cache_path = os.path.join(config.DATA_DIR, "watchlist_data.json")
    with open(cache_path, "w") as f:
        json.dump(stock_data, f, indent=2)

    return jsonify({"symbols": symbols, "stock_data": stock_data})


# --------------- MF Categories from AMFI/NSDL scheme master ---------------
_MF_CATEGORIES_CACHE = None
_MF_TOP10_CACHE = {}  # key: category_filter -> (timestamp, data)

@app.route("/api/mf-categories", methods=["GET"])
def mf_categories():
    """
    Parse SchemeData CSV (AMFI/NSDL scheme master) and return aggregated
    MF categories with scheme counts, grouped by asset class.
    """
    global _MF_CATEGORIES_CACHE
    if _MF_CATEGORIES_CACHE is not None:
        return jsonify(_MF_CATEGORIES_CACHE)

    import csv, os as _os
    csv_path = _os.path.join(_os.path.dirname(__file__), "SchemeData1703260645SS.csv")
    if not _os.path.exists(csv_path):
        return jsonify({"error": "MF scheme data not found"}), 404

    counts = {}
    amcs = set()
    try:
        with open(csv_path, encoding="utf-8", errors="ignore") as f:
            reader = csv.DictReader(f)
            for row in reader:
                cat = (row.get("Scheme Category") or "").strip()
                amc = (row.get("AMC") or "").strip()
                if cat:
                    counts[cat] = counts.get(cat, 0) + 1
                if amc:
                    amcs.add(amc)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    def asset_class(cat):
        cat_lower = cat.lower()
        if cat_lower.startswith("equity"):
            return "Equity"
        elif cat_lower.startswith("debt"):
            return "Debt"
        elif cat_lower.startswith("hybrid"):
            return "Hybrid"
        elif cat_lower.startswith("solution"):
            return "Solution Oriented"
        elif cat_lower.startswith("other"):
            return "Other / ETF"
        return "Other"

    COLOR_MAP = {
        "Equity": "#22c55e",
        "Debt": "#3b82f6",
        "Hybrid": "#8b5cf6",
        "Solution Oriented": "#f59e0b",
        "Other / ETF": "#64748b",
        "Other": "#64748b",
    }

    categories = []
    for cat, count in sorted(counts.items(), key=lambda x: -x[1]):
        ac = asset_class(cat)
        # Derive a short display name by removing the prefix
        short = cat
        for prefix in ("Equity Scheme - ", "Debt Scheme - ", "Hybrid Scheme - ",
                       "Solution Oriented Scheme - ", "Other Scheme - "):
            if cat.startswith(prefix):
                short = cat[len(prefix):]
                break
        categories.append({
            "category": cat,
            "short_name": short,
            "asset_class": ac,
            "color": COLOR_MAP.get(ac, "#64748b"),
            "count": count,
        })

    result = {
        "total_schemes": sum(counts.values()),
        "total_amcs": len(amcs),
        "categories": categories,
    }
    _MF_CATEGORIES_CACHE = result
    return jsonify(result)


# --------------- MF Top 10 by 1-year returns (mfapi.in) ---------------
@app.route("/api/mf-top10", methods=["GET"])
def mf_top10():
    """
    Return top 10 equity mutual funds by 1-year NAV return.
    Reads scheme codes from SchemeData CSV, fetches NAV history from mfapi.in,
    calculates 1-yr returns and returns the best performers.
    Results cached for 24 hours.
    """
    import csv, os as _os, time as _time, re
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import requests as req_lib

    EQUITY_CATS = {
        "Equity Scheme - Flexi Cap Fund",
        "Equity Scheme - Large & Mid Cap Fund",
        "Equity Scheme - Large Cap Fund",
        "Equity Scheme - Mid Cap Fund",
        "Equity Scheme - Small Cap Fund",
        "Equity Scheme - Multi Cap Fund",
        "Equity Scheme - ELSS",
        "Equity Scheme - Focused Fund",
    }
    CACHE_TTL = 86400  # 24 hours

    cache_key = "equity_top10"
    if cache_key in _MF_TOP10_CACHE:
        ts, cached = _MF_TOP10_CACHE[cache_key]
        if _time.time() - ts < CACHE_TTL:
            return jsonify(cached)

    csv_path = _os.path.join(_os.path.dirname(__file__), "SchemeData1703260645SS.csv")
    if not _os.path.exists(csv_path):
        return jsonify({"error": "MF scheme data not found"}), 404

    # Filter equity direct growth plans
    dg_pat = re.compile(r'direct.*growth|growth.*direct', re.IGNORECASE)
    schemes = []
    try:
        with open(csv_path, encoding="utf-8", errors="ignore") as f:
            reader = csv.DictReader(f)
            for row in reader:
                cat = (row.get("Scheme Category") or "").strip()
                nav_name = (row.get("Scheme NAV Name") or "").strip()
                code = (row.get("Code") or "").strip()
                amc = (row.get("AMC") or "").strip()
                scheme_name = (row.get("Scheme Name") or "").strip()
                if cat in EQUITY_CATS and code and dg_pat.search(nav_name):
                    schemes.append({
                        "code": code,
                        "name": scheme_name,
                        "nav_name": nav_name,
                        "amc": amc,
                        "category": cat,
                    })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    def fetch_return(scheme):
        code = scheme["code"]
        try:
            r = req_lib.get(
                f"https://api.mfapi.in/mf/{code}",
                timeout=8,
                headers={"User-Agent": "Mozilla/5.0"},
            )
            if r.status_code != 200:
                return None
            data = r.json().get("data", [])
            if len(data) < 2:
                return None
            # data[0] is most recent, find entry ~365 days ago
            from datetime import datetime as _dt
            try:
                latest_nav = float(data[0]["nav"])
                latest_date = _dt.strptime(data[0]["date"], "%d-%m-%Y")
            except (ValueError, KeyError):
                return None
            # Find NAV closest to 365 days ago
            target = latest_date.replace(year=latest_date.year - 1)
            best = None
            best_diff = float("inf")
            for entry in data:
                try:
                    d = _dt.strptime(entry["date"], "%d-%m-%Y")
                    diff = abs((d - target).days)
                    if diff < best_diff:
                        best_diff = diff
                        best = float(entry["nav"])
                except (ValueError, KeyError):
                    continue
            if best is None or best <= 0:
                return None
            ret_1yr = round((latest_nav - best) / best * 100, 2)
            return {**scheme, "nav": latest_nav, "nav_1yr_ago": best, "return_1yr": ret_1yr}
        except Exception:
            return None

    results = []
    with ThreadPoolExecutor(max_workers=15) as ex:
        futures = {ex.submit(fetch_return, s): s for s in schemes}
        for fut in as_completed(futures):
            r = fut.result()
            if r and r["return_1yr"] is not None:
                results.append(r)

    # Sort by 1yr return descending, take top 10
    results.sort(key=lambda x: x["return_1yr"], reverse=True)
    top10 = results[:10]

    # Shorten category label
    for item in top10:
        cat = item["category"]
        for prefix in ("Equity Scheme - ",):
            if cat.startswith(prefix):
                item["short_category"] = cat[len(prefix):]
                break
        else:
            item["short_category"] = cat
        # Shorten AMC name (remove " AMC Limited" / " Asset Management" etc.)
        amc = item["amc"]
        amc = re.sub(r'\s+(AMC Limited|AMC Ltd|Asset Management Company.*|Mutual Fund.*)', '', amc, flags=re.IGNORECASE)
        item["amc_short"] = amc.strip()

    payload = {
        "top10": top10,
        "total_scanned": len(results),
        "fetched_at": _time.strftime("%Y-%m-%d %H:%M"),
    }
    _MF_TOP10_CACHE[cache_key] = (_time.time(), payload)
    return jsonify(payload)


# --------------- AI MF Dashboard — exclusive fund picks via Claude ---------------
_AI_MF_CACHE = {}  # key: "exclusive" -> (timestamp, data)

# Curated exclusive funds: code, name, category, theme
_EXCLUSIVE_FUNDS = [
    # ── Sectoral / Thematic ──────────────────────────────────────────────────
    {"code": "118762", "name": "Nippon India Power & Infra Fund",     "category": "Sectoral – Power & Infra",   "theme": "India's energy transition & infrastructure push"},
    {"code": "120578", "name": "SBI Technology Opportunities Fund",    "category": "Sectoral – Technology",      "theme": "Digital India & IT services boom"},
    {"code": "120575", "name": "SBI Consumption Opportunities Fund",   "category": "Sectoral – Consumption",     "theme": "Rising middle class consumption"},
    {"code": "118758", "name": "Nippon India Pharma Fund",             "category": "Sectoral – Pharma",          "theme": "Healthcare + generic pharma exports"},
    {"code": "119646", "name": "Aditya Birla Sun Life MNC Fund",       "category": "Sectoral – MNC",             "theme": "Quality MNC moats with global backing"},
    {"code": "120594", "name": "ICICI Prudential Technology Fund",     "category": "Sectoral – Technology",      "theme": "AI, Cloud, Software – future of work"},
    {"code": "119247", "name": "DSP India T.I.G.E.R. Fund",            "category": "Sectoral – Infra",           "theme": "Infrastructure, real estate & energy revival"},
    {"code": "120731", "name": "UTI Transportation & Logistics Fund",  "category": "Sectoral – Logistics",       "theme": "EV transition + India logistics build-out"},
    {"code": "120782", "name": "UTI Healthcare Fund",                  "category": "Sectoral – Healthcare",      "theme": "Health insurance, diagnostics, hospitals"},
    {"code": "118588", "name": "Nippon India Banking & PSU Debt Fund", "category": "Sectoral – BFSI",            "theme": "Banking NPAs clearing; PSU bank re-rating"},
    # ── Value / Contra ──────────────────────────────────────────────────────
    {"code": "118935", "name": "HDFC Value Fund",                      "category": "Value",                      "theme": "Deep-value contrarian; buys unloved sectors"},
    {"code": "118494", "name": "Templeton India Value Fund",           "category": "Value",                      "theme": "Global value philosophy applied to India"},
    {"code": "119769", "name": "Kotak Contra Fund",                    "category": "Contra",                     "theme": "Invests against consensus; strong alpha historically"},
    {"code": "120323", "name": "ICICI Prudential Value Discovery Fund","category": "Value",                      "theme": "Price-to-book & earnings yield focus"},
    # ── Multi Asset ─────────────────────────────────────────────────────────
    {"code": "120821", "name": "Quant Multi Asset Allocation Fund",    "category": "Multi Asset",                "theme": "Quantitative model rotates across equity/debt/gold"},
    {"code": "120334", "name": "ICICI Prudential Multi-Asset Fund",    "category": "Multi Asset",                "theme": "All-weather: equity + commodities + debt + REITs"},
    # ── International / FoF ─────────────────────────────────────────────────
    {"code": "120847", "name": "Mirae Asset NYSE FANG+ ETF FoF",       "category": "International – US Tech",    "theme": "Direct US Big Tech exposure: Apple, Google, Nvidia"},
    {"code": "120828", "name": "Quant Small Cap Fund",                 "category": "Small Cap – Quant",          "theme": "Quantitative momentum in small caps; top 5yr performer"},
    # ── Dividend Yield ───────────────────────────────────────────────────────
    {"code": "119507", "name": "Aditya Birla Dividend Yield Fund",     "category": "Dividend Yield",             "theme": "High dividend stocks; defensive + income generating"},
    {"code": "120682", "name": "UTI MNC Fund",                         "category": "Dividend Yield – MNC",       "theme": "MNC dividend payers with stable foreign parent"},
]


def _fetch_mf_returns(code, session):
    """Fetch 1yr and 3yr NAV returns for a fund from mfapi.in."""
    try:
        r = session.get(f"https://api.mfapi.in/mf/{code}", timeout=8)
        if r.status_code != 200:
            return None
        data = r.json().get("data", [])
        if len(data) < 2:
            return None
        from datetime import datetime as _dt
        import math as _math

        def parse_nav(entry):
            try:
                return float(entry["nav"]), _dt.strptime(entry["date"], "%d-%m-%Y")
            except Exception:
                return None, None

        latest_nav, latest_date = parse_nav(data[0])
        if not latest_nav or _math.isnan(latest_nav):
            return None

        def find_closest(target_date, entries):
            best, best_diff = None, float("inf")
            for e in entries:
                nav_val, d = parse_nav(e)
                if d and nav_val and not _math.isnan(nav_val):
                    diff = abs((d - target_date).days)
                    if diff < best_diff:
                        best_diff, best = diff, nav_val
            return best

        # 1-year ago
        t1 = latest_date.replace(year=latest_date.year - 1)
        nav_1yr = find_closest(t1, data)
        ret_1yr = round((latest_nav - nav_1yr) / nav_1yr * 100, 1) if nav_1yr else None

        # 3-year ago
        t3 = latest_date.replace(year=latest_date.year - 3)
        nav_3yr = find_closest(t3, data)
        ret_3yr = None
        if nav_3yr:
            cagr_3 = (latest_nav / nav_3yr) ** (1 / 3) - 1
            ret_3yr = round(cagr_3 * 100, 1)

        return {
            "nav": round(latest_nav, 2),
            "nav_date": data[0]["date"],
            "return_1yr": ret_1yr,
            "return_3yr_cagr": ret_3yr,
        }
    except Exception:
        return None


@app.route("/api/ai-mf-picks", methods=["GET"])
def ai_mf_picks():
    """
    AI-curated exclusive MF dashboard.
    Fetches NAV returns for 20 exclusive funds, then asks Claude to:
      1. Score each fund 0-100
      2. Identify top 5 picks with thesis
      3. Provide portfolio allocation suggestions
      4. Warn about sector risks
    Results cached for 24 hours.
    """
    import time as _time
    import os as _os
    CACHE_TTL = 86400

    cache_key = "exclusive"
    if cache_key in _AI_MF_CACHE:
        ts, cached = _AI_MF_CACHE[cache_key]
        if _time.time() - ts < CACHE_TTL:
            return jsonify(cached)

    # 1. Fetch returns for all exclusive funds in parallel
    import requests as req_lib
    from concurrent.futures import ThreadPoolExecutor, as_completed

    session = req_lib.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0"})

    fund_data = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        futures = {ex.submit(_fetch_mf_returns, f["code"], session): f for f in _EXCLUSIVE_FUNDS}
        for fut in as_completed(futures):
            fund_def = futures[fut]
            returns = fut.result()
            if returns:
                fund_data.append({**fund_def, **returns})

    # Sort by 1yr return
    fund_data.sort(key=lambda x: x.get("return_1yr") or -999, reverse=True)

    # 2. Call Claude for AI analysis
    ai_analysis = None
    api_key = _os.environ.get("ANTHROPIC_API_KEY", "")

    if api_key:
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=api_key)

            # Build prompt
            fund_summary = "\n".join(
                f"- {f['name']} | {f['category']} | 1yr: {f.get('return_1yr','?')}% | "
                f"3yr CAGR: {f.get('return_3yr_cagr','?')}% | Theme: {f['theme']}"
                for f in fund_data
            )

            prompt = f"""You are an expert Indian mutual fund analyst. Analyze these 20 exclusive/niche mutual funds based on their recent performance data:

{fund_summary}

Today's date: {_time.strftime('%Y-%m-%d')}. Indian market context: post-election rally, rate cut cycle beginning, manufacturing & infrastructure boom, small/mid cap correction in progress.

Provide a concise JSON response with this structure:
{{
  "top_picks": [
    {{
      "code": "fund_code",
      "name": "fund_name",
      "ai_score": 85,
      "conviction": "HIGH/MEDIUM/LOW",
      "thesis": "2-3 sentence investment thesis",
      "risk": "Key risk in 1 sentence",
      "ideal_for": "investor profile this suits"
    }}
  ],  // top 5 picks only
  "avoid": [
    {{"code": "fund_code", "name": "...", "reason": "why to avoid now"}}
  ],  // 2-3 to avoid currently
  "portfolio_allocation": {{
    "aggressive": "How to allocate these for aggressive investor",
    "moderate": "How to allocate for moderate investor"
  }},
  "macro_view": "2-3 sentences on current macro context for these themes",
  "rebalance_trigger": "When should investor review/rebalance"
}}

Be specific with fund names, cite actual return numbers, and give actionable advice."""

            msg = client.messages.create(
                model="claude-opus-4-6",
                max_tokens=1500,
                messages=[{"role": "user", "content": prompt}],
            )
            import json as _json
            raw = msg.content[0].text
            # Extract JSON from response
            start = raw.find("{")
            end = raw.rfind("}") + 1
            if start >= 0 and end > start:
                ai_analysis = _json.loads(raw[start:end])
        except Exception as e:
            ai_analysis = {"error": str(e)}
    else:
        # Rule-based fallback: top picks by 1yr return
        top5 = [f for f in fund_data if f.get("return_1yr") is not None][:5]
        ai_analysis = {
            "top_picks": [
                {
                    "code": f["code"],
                    "name": f["name"],
                    "ai_score": min(99, max(40, int(50 + (f.get("return_1yr", 0) or 0)))),
                    "conviction": "HIGH" if (f.get("return_1yr") or 0) > 25 else "MEDIUM",
                    "thesis": f"{f['theme']}. 1yr return {f.get('return_1yr','?')}%, 3yr CAGR {f.get('return_3yr_cagr','?')}%.",
                    "risk": "Sector concentration risk — diversify across themes.",
                    "ideal_for": "Investors with 3-5 year horizon and sector conviction.",
                }
                for f in top5
            ],
            "avoid": [],
            "portfolio_allocation": {
                "aggressive": "40% best sectoral + 30% value/contra + 20% multi-asset + 10% international",
                "moderate": "20% best sectoral + 40% multi-asset + 40% value/dividend yield",
            },
            "macro_view": "Infrastructure and power sectors aligned with govt capex. Tech sector benefiting from AI tailwinds. Value/contra positioned for mid-cycle rotation.",
            "rebalance_trigger": "Review annually or when any fund drops below category median for 2 consecutive quarters.",
            "mode": "rule_based_fallback",
        }

    payload = {
        "funds": fund_data,
        "ai_analysis": ai_analysis,
        "total_scanned": len(fund_data),
        "fetched_at": _time.strftime("%Y-%m-%d %H:%M"),
        "ai_powered": bool(api_key),
    }
    _AI_MF_CACHE[cache_key] = (_time.time(), payload)
    return jsonify(payload)


@app.route("/api/ai-mf-picks/refresh", methods=["POST"])
def ai_mf_picks_refresh():
    """Force refresh the AI MF picks cache."""
    _AI_MF_CACHE.clear()
    return jsonify({"message": "Cache cleared. Next GET will re-fetch."})


# --------------- Gift Nifty / Nifty Futures (pre-market indicator) ---------------
@app.route("/api/gift-nifty", methods=["GET"])
def gift_nifty():
    """
    Fetch Gift Nifty (NSE International Exchange, GIFT City) futures data.
    Sourced from NSE's derivatives API — nearest-expiry Nifty 50 futures contract.
    Gift Nifty trades 6:30 AM – 11:30 PM IST and is the primary pre-market
    indicator for where the Indian equity market will open.
    """
    import requests as req_lib
    from datetime import datetime as dt

    def _fetch_nse_gift_nifty():
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                          "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://www.nseindia.com/",
        }
        session = req_lib.Session()
        session.headers.update(headers)
        # Warm up cookies
        session.get("https://www.nseindia.com", timeout=8)

        # Fetch all Nifty 50 futures contracts
        r = session.get(
            "https://www.nseindia.com/api/liveEquity-derivatives?index=nse50_fut",
            timeout=8,
        )
        r.raise_for_status()
        data = r.json().get("data", [])

        # Filter nearest-expiry Nifty 50 index futures
        futures = [
            d for d in data
            if d.get("underlying") == "NIFTY" and d.get("instrumentType") == "FUTIDX"
        ]
        if not futures:
            return None

        # Sort by expiry date (DD-Mon-YYYY) → nearest first
        def parse_expiry(x):
            try:
                return dt.strptime(x.get("expiryDate", ""), "%d-%b-%Y")
            except Exception:
                return dt.max

        futures.sort(key=parse_expiry)
        f = futures[0]

        ltp         = f.get("lastPrice")
        change      = f.get("change")
        change_pct  = f.get("pChange")
        expiry      = f.get("expiryDate", "")
        prev_close  = f.get("previousClose") or f.get("prevClose")
        open_price  = f.get("open")
        high        = f.get("dayHigh")
        low         = f.get("dayLow")
        volume      = f.get("totalTradedVolume") or f.get("totalVol")
        oi          = f.get("openInterest") or f.get("oi")
        oi_chg_pct  = f.get("changeinOpenInterest") or f.get("oiChange")

        # Also grab Nifty 50 spot for premium/discount calc
        spot = None
        try:
            spot_r = session.get(
                "https://www.nseindia.com/api/allIndices",
                timeout=5,
            )
            if spot_r.ok:
                for idx in spot_r.json().get("data", []):
                    if idx.get("index") == "NIFTY 50":
                        spot = idx.get("last")
                        break
        except Exception:
            pass

        premium = None
        if ltp and spot:
            try:
                premium = round(float(ltp) - float(spot), 2)
            except Exception:
                pass

        return {
            "ltp":          _sanitize_value(ltp),
            "change":       _sanitize_value(change),
            "change_pct":   _sanitize_value(change_pct),
            "prev_close":   _sanitize_value(prev_close),
            "open":         _sanitize_value(open_price),
            "high":         _sanitize_value(high),
            "low":          _sanitize_value(low),
            "volume":       _sanitize_value(volume),
            "oi":           _sanitize_value(oi),
            "oi_change_pct":_sanitize_value(oi_chg_pct),
            "expiry":       expiry,
            "nifty_spot":   _sanitize_value(spot),
            "premium":      premium,
            "fetched_at":   dt.now().strftime("%H:%M:%S IST"),
            "source":       "NSE Nifty 50 Futures (nearest expiry)",
        }

    try:
        result = _fetch_nse_gift_nifty()
        if result is None:
            return jsonify({"error": "No Gift Nifty data available from NSE"}), 503
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 503


# --------------- Market Pulse endpoint ---------------
@app.route("/api/market-pulse", methods=["GET"])
def market_pulse():
    """Fetch live market indices data for dashboard."""
    import yfinance as yf

    indices = {
        "^NSEI": "Nifty 50",
        "^BSESN": "Sensex",
        "^NSEBANK": "Bank Nifty",
        "^CNXIT": "Nifty IT",
        "^CNXPHARMA": "Nifty Pharma",
    }
    result = []
    for ticker_sym, name in indices.items():
        try:
            t = yf.Ticker(ticker_sym)
            info = t.info or {}
            price = info.get("regularMarketPrice") or info.get("currentPrice")
            prev = info.get("regularMarketPreviousClose") or info.get("previousClose")
            change = None
            change_pct = None
            if price and prev:
                change = round(float(price) - float(prev), 2)
                change_pct = round(change / float(prev) * 100, 2)
            result.append({
                "symbol": ticker_sym,
                "name": name,
                "price": _sanitize_value(price),
                "change": _sanitize_value(change),
                "change_pct": _sanitize_value(change_pct),
            })
        except Exception:
            result.append({"symbol": ticker_sym, "name": name, "price": None, "change": None, "change_pct": None})
    return jsonify(result)


# --------------- Stock Comparison ---------------

@app.route("/api/compare", methods=["POST"])
def compare_stocks():
    """Compare two stocks across multiple fundamental & technical categories."""
    try:
        body = request.get_json(force=True) or {}
        sym1 = (body.get("stock1") or "").strip().upper()
        sym2 = (body.get("stock2") or "").strip().upper()
        if not sym1 or not sym2:
            return jsonify({"error": "Both stock1 and stock2 are required"}), 400
        if sym1 == sym2:
            return jsonify({"error": "Please enter two different stocks"}), 400

        if not sym1.endswith(".NS"):
            sym1 += ".NS"
        if not sym2.endswith(".NS"):
            sym2 += ".NS"

        from modules.stock_comparator import StockComparator
        comparator = StockComparator()
        result = comparator.compare(sym1, sym2)

        if "error" in result:
            return jsonify(result), 400

        # Sanitize all nested values
        result = _deep_sanitize(result)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _deep_sanitize(obj):
    """Recursively sanitize values in nested dicts/lists for JSON."""
    if isinstance(obj, dict):
        return {k: _deep_sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_deep_sanitize(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return [_deep_sanitize(v) for v in obj.tolist()]
    return _sanitize_value(obj)


# --------------- Intrinsic Valuation ---------------

@app.route("/api/intrinsic-valuation/<symbol>", methods=["GET"])
def intrinsic_valuation(symbol):
    """Compute intrinsic valuation (DCF + Relative) for a stock."""
    try:
        from modules.intrinsic_valuator import IntrinsicValuator
        valuator = IntrinsicValuator()
        result = valuator.valuate(symbol)
        if "error" in result:
            return jsonify(result), 400
        result = _deep_sanitize(result)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/intrinsic-valuation/<symbol>", methods=["POST"])
def intrinsic_valuation_custom(symbol):
    """Compute intrinsic valuation with user-overridden inputs."""
    try:
        from modules.intrinsic_valuator import IntrinsicValuator
        overrides = request.get_json(force=True) or {}
        valuator = IntrinsicValuator()
        result = valuator.valuate(symbol, overrides=overrides)
        if "error" in result:
            return jsonify(result), 400
        result = _deep_sanitize(result)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# --------------- Intrinsic 20 — Batch DCF Screener ---------------

def _run_intrinsic20_scan():
    """Batch DCF scan: valuate stocks from midcap/largecap/smallcap indices."""
    state = _get_index_state("intrinsic20")
    state["running"] = True
    state["status"] = "scanning"
    state["log_lines"] = ["Starting Intrinsic 20 scan..."]

    try:
        from modules.intrinsic_valuator import IntrinsicValuator
        from concurrent.futures import ThreadPoolExecutor, as_completed

        # Collect unique symbols from all 3 indices
        all_syms = set()
        for pf_key in ("midcap150", "largemidcap250", "smallcap250"):
            stocks = config.PORTFOLIOS.get(pf_key, {}).get("stocks", [])
            for s in stocks:
                all_syms.add(s.strip().upper())
        symbols = sorted(all_syms)
        total = len(symbols)
        state["log_lines"].append(f"Universe: {total} unique stocks from 3 indices")

        results = []
        done = 0
        errors = 0
        lock = threading.Lock()

        def _valuate_one(sym):
            nonlocal done, errors
            try:
                valuator = IntrinsicValuator()
                res = valuator.valuate(sym)
                if "error" in res:
                    with lock:
                        errors += 1
                    return None
                # Extract flat summary row
                comp = res.get("composite", {})
                dcf = res.get("dcf", {})
                inp = res.get("inputs", {})
                mos = res.get("marginOfSafety", {})
                wacc_bd = res.get("waccBreakdown", {})
                row = {
                    "symbol": sym,
                    "name": res.get("name", sym),
                    "sector": res.get("sector", ""),
                    "cmp": _sanitize_value(inp.get("currentPrice")),
                    "intrinsicValue": _sanitize_value(comp.get("intrinsicValue")),
                    "dcfPerShare": _sanitize_value(dcf.get("dcfPerShare")),
                    "weightedDcfPerShare": _sanitize_value(dcf.get("weightedDcfPerShare")),
                    "relativeValue": _sanitize_value(res.get("relative", {}).get("relativeValue")),
                    "upside": _sanitize_value(comp.get("upside")),
                    "marginOfSafety": _sanitize_value(mos.get("pct")),
                    "mosZone": mos.get("zone", ""),
                    "verdict": comp.get("verdict", ""),
                    "wacc": _sanitize_value(wacc_bd.get("wacc")),
                    "costOfEquity": _sanitize_value(wacc_bd.get("costOfEquity")),
                    "beta": _sanitize_value(wacc_bd.get("beta")),
                    "dcfBear": _sanitize_value(dcf.get("dcfBear")),
                    "dcfBull": _sanitize_value(dcf.get("dcfBull")),
                }
                return row
            except Exception as e:
                with lock:
                    errors += 1
                return None

        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = {pool.submit(_valuate_one, sym): sym for sym in symbols}
            for future in as_completed(futures):
                row = future.result()
                with lock:
                    done += 1
                    if row:
                        results.append(row)
                    if done % 20 == 0 or done == total:
                        state["log_lines"].append(
                            f"Progress: {done}/{total} ({len(results)} valid, {errors} errors)"
                        )
                        if len(state["log_lines"]) > 200:
                            state["log_lines"] = state["log_lines"][-200:]

        # Sort by margin of safety descending (most undervalued first)
        results.sort(key=lambda r: r.get("marginOfSafety") or -9999, reverse=True)

        if results:
            df = pd.DataFrame(results)
            out_path = os.path.join(config.DATA_DIR, "intrinsic20_all.csv")
            df.to_csv(out_path, index=False)
            state["log_lines"].append(f"Saved {len(results)} valuations to intrinsic20_all.csv")

        state["log_lines"].append(f"Done: {len(results)} valuated, {errors} errors out of {total}")
        state["status"] = "completed"
    except Exception as e:
        state["status"] = f"error: {str(e)}"
        state["log_lines"].append(f"ERROR: {str(e)}")
    finally:
        state["running"] = False


def _intrinsic20_live_refresh():
    """Refresh CMP for intrinsic20 results using yfinance."""
    import yfinance as yf
    from datetime import datetime

    data = load_csv("intrinsic20_all.csv")
    if data is None:
        return None

    symbols = [r["symbol"] + ".NS" for r in data if r.get("symbol")]
    live_prices = {}
    try:
        batch_size = 50
        for i in range(0, len(symbols), batch_size):
            batch = symbols[i:i + batch_size]
            tickers_str = " ".join(batch)
            live_data = yf.download(tickers_str, period="1d", progress=False)
            if live_data is not None and not live_data.empty:
                close_col = live_data.get("Close")
                if close_col is not None:
                    if len(batch) == 1:
                        val = close_col.iloc[-1] if len(close_col) > 0 else None
                        if val is not None and not (isinstance(val, float) and math.isnan(val)):
                            live_prices[batch[0]] = float(val)
                    else:
                        for sym in batch:
                            if sym in close_col.columns:
                                val = close_col[sym].dropna()
                                if len(val) > 0:
                                    live_prices[sym] = float(val.iloc[-1])
    except Exception:
        pass

    for row in data:
        sym_ns = row.get("symbol", "") + ".NS"
        if sym_ns in live_prices:
            new_cmp = round(live_prices[sym_ns], 2)
            row["cmp"] = new_cmp
            iv = row.get("intrinsicValue")
            if iv and new_cmp > 0:
                try:
                    iv_f = float(iv)
                    row["upside"] = round((iv_f - new_cmp) / new_cmp * 100, 1)
                    row["marginOfSafety"] = round((iv_f - new_cmp) / iv_f * 100, 1)
                except (ValueError, TypeError, ZeroDivisionError):
                    pass

    data.sort(key=lambda r: float(r.get("marginOfSafety") or -9999), reverse=True)
    return {
        "data": data,
        "updated_at": datetime.now().strftime("%H:%M:%S"),
        "live_count": len(live_prices),
    }


@app.route("/api/intrinsic20", methods=["GET"])
def intrinsic20():
    data = load_csv("intrinsic20_all.csv")
    if data is None:
        return jsonify({"error": "No Intrinsic 20 data. Click 'Scan' first."}), 404
    return jsonify(data)


@app.route("/api/intrinsic20/scan", methods=["POST"])
def intrinsic20_scan():
    state = _get_index_state("intrinsic20")
    if state["running"]:
        return jsonify({"error": "Scan already running"}), 409
    thread = threading.Thread(target=_run_intrinsic20_scan, daemon=True)
    thread.start()
    return jsonify({"message": "Intrinsic 20 scan started"})


@app.route("/api/intrinsic20/status", methods=["GET"])
def intrinsic20_status():
    state = _get_index_state("intrinsic20")
    return jsonify({
        "running": state["running"],
        "status": state["status"],
        "log_lines": state["log_lines"][-30:],
    })


@app.route("/api/intrinsic20/live", methods=["GET"])
def intrinsic20_live():
    result = _intrinsic20_live_refresh()
    if result is None:
        return jsonify({"error": "No data. Run scan first."}), 404
    return jsonify(result)


# ============================================================
# INDIA 2030 STRATEGY — Macro Thematic Research & Growth Picks
# ============================================================

STOCK_RESEARCH = {
    "LLOYDSME": {
        "growth_plan": "Ramping up 3 MTPA integrated steel plant at Ghugus (Maharashtra) with captive iron ore mines (~250 MT reserves), targeting full commissioning by FY26 with Phase 2 to 5 MTPA by FY28.",
        "moat": "Only sponge iron/steel player with captive iron ore mining leases in Maharashtra (Surjagarh mine), giving 30-40% cost advantage over peers reliant on merchant ore.",
        "catalyst": "Iron ore mine production ramp from ~5 MT to 10+ MT annually in FY26 will dramatically improve blended margins as high-margin mining revenue scales.",
        "risk": "Single-location concentration and iron ore price cyclicality",
    },
    "ENGINERSIN": {
        "growth_plan": "Targeting Rs 15,000+ Cr order book by FY27 via green hydrogen consulting mandates, refinery modernization, and offshore wind energy EPC advisory.",
        "moat": "India's only listed PSU engineering consultancy with 60+ years of refinery/petrochemical FEED expertise, pre-qualified with virtually every Indian PSU oil & gas company.",
        "catalyst": "Rs 1 lakh Cr+ green hydrogen Mission and HPCL/BPCL/IOCL refinery expansion DFRs converting to EPC orders in FY26-27.",
        "risk": "Government capex slowdown or disinvestment overhang",
    },
    "GVT&D": {
        "growth_plan": "Order book Rs 10,000+ Cr (2.5x book-to-bill) driven by 765kV+ UHVDC transmission orders under Rs 2.4 lakh Cr National Grid expansion plan.",
        "moat": "One of only 2-3 Indian players qualified to manufacture 765kV gas-insulated switchgear (GIS) and power transformers, backed by GE Vernova's global tech transfer.",
        "catalyst": "500 GW renewable target requires massive transmission buildout; PGCIL capex doubling to Rs 40,000 Cr/year in FY26-27.",
        "risk": "Execution delays on large EPC orders and working capital strain",
    },
    "TARIL": {
        "growth_plan": "Expanding transformer capacity from ~15,000 MVA to 25,000+ MVA by FY27 with new Moraiya (Gujarat) facility, targeting export markets in Middle East and Africa.",
        "moat": "Niche specialization in 400kV+ power and furnace transformers; one of few Indian manufacturers qualified for 765kV class transformers.",
        "catalyst": "Global transformer shortage (2-3 year backlogs in US/Europe) driving 30-40% export order growth and significant pricing power through FY26-27.",
        "risk": "CRGO steel price volatility and state utility concentration",
    },
    "POLYCAB": {
        "growth_plan": "Rs 2,000+ Cr capex over FY25-27 to expand wire & cable capacity by 40%, add optical fiber cable lines, and scale FMEG (fans, switches) to Rs 2,500 Cr revenue.",
        "moat": "India's largest wires & cables manufacturer (25%+ organized market share), widest dealer network (~4,500), backward-integrated into copper rod manufacturing.",
        "catalyst": "Real estate upcycle + Rs 1.4 lakh Cr RDSS (Revamped Distribution Sector Scheme) creating multi-year cable demand visibility.",
        "risk": "Copper price volatility and FMEG profitability delays",
    },
    "SAILIFE": {
        "growth_plan": "Investing Rs 800-1,000 Cr to expand Hyderabad CDMO campus with new large-scale API/intermediate blocks, targeting 50%+ revenue CAGR through FY27.",
        "moat": "Integrated CRAMS/CDMO specializing in complex chemistry (chiral molecules, multi-step synthesis) with relationships with 6 of top 10 global innovator pharma companies.",
        "catalyst": "US Biosecure Act driving diversification from Chinese CDMOs — 40%+ order book growth from Western innovators in FY25.",
        "risk": "Customer concentration in top 5 clients; newly listed scale-up risk",
    },
    "NATCOPHARM": {
        "growth_plan": "Building Rs 500 Cr oncology/specialty injectable facility for US/EU, expanding gRevlimid market share, and preparing 15+ complex generic ANDAs for FY26-28.",
        "moat": "Para-IV first-to-file on high-value oncology generics (Revlimid, Ibrutinib, Ponatinib) with proven patent challenge track record against innovators.",
        "catalyst": "gCopaxone 40mg and gIbrutinib US launches in FY26, each Rs 500+ Cr peak revenue opportunity.",
        "risk": "Binary patent litigation outcomes and lumpy limited-competition revenues",
    },
    "MAXHEALTH": {
        "growth_plan": "Adding 2,500+ beds by FY28 (Lucknow, Dwarka Phase 2, Gurugram, Nanavati Mumbai integration), targeting Rs 10,000 Cr revenue by FY27.",
        "moat": "Highest ARPOB (Rs 75,000+) among listed hospitals with 40%+ revenue from complex tertiary/quaternary care and oncology.",
        "catalyst": "Nanavati Hospital acquisition (500+ beds) integration in FY26 adds Rs 1,200+ Cr revenue and entry into Mumbai market.",
        "risk": "Elevated 75x PE leaves no room for execution misses",
    },
    "ASTRAZEN": {
        "growth_plan": "Expanding oncology portfolio with Tagrisso, Lynparza, Enhertu in new indications — targeting doubling India oncology revenue to Rs 1,500+ Cr by FY27.",
        "moat": "Only listed pure-play MNC pharma subsidiary focused on oncology/rare diseases with exclusive access to AstraZeneca global's immuno-oncology pipeline.",
        "catalyst": "New FY26 oncology launches (Imfinzi for lung cancer, Calquence for CLL) could drive 20%+ revenue growth.",
        "risk": "Parent transfer pricing decisions and low ~25% free float",
    },
    "DBREALTY": {
        "growth_plan": "Pivoting to JD of prime BKC and Lower Parel land parcels with Rs 15,000+ Cr GDV launches by FY27 (now renamed Valor Estate).",
        "moat": "Holds ~50 acres of prime Mumbai land bank (BKC, Dahisar, Mira Road) acquired at legacy costs — among most valuable urban portfolios of any listed developer.",
        "catalyst": "Mumbai Metro completion driving significant land value appreciation around Dahisar-Mira Road 25+ acre holdings.",
        "risk": "Promoter governance history and D/E ~25x",
    },
    "ANANDRATHI": {
        "growth_plan": "Targeting Rs 75,000 Cr AUM by FY27 (from ~62,000 Cr), adding 40-50 RMs/year, expanding into Tier-2/3 cities with digital wealth platform for HNI segment.",
        "moat": "Pure-play wealth management (not diversified broker) with 97%+ trail-revenue model giving 85%+ revenue visibility and industry-leading 40%+ PAT margins.",
        "catalyst": "HNI wealth growing 15%+ CAGR; adding Rs 2,000+ Cr net new AUM per quarter with improving wallet share.",
        "risk": "Key-man risk (founder-driven) and MF TER regulation changes",
    },
    "RBLBANK": {
        "growth_plan": "New CEO executing 'RBL 2.0' — growing retail/MSME to 60%+ of advances by FY27, targeting 13-15% loan growth with focus on secured lending and credit cards.",
        "moat": "6th largest credit card issuer (5M+ cards) with Bajaj Finance and Google Pay partnerships providing low-cost customer acquisition.",
        "catalyst": "Asset quality normalization (GNPA <3%) and NIM improvement should drive RoA from ~0.9% to 1.2%+, re-rating from 0.8x P/BV.",
        "risk": "Microfinance stress and management credibility gap from past CEO transitions",
    },
    "NAM-INDIA": {
        "growth_plan": "Targeting Rs 6 lakh Cr AUM by FY27 (from ~4.7L Cr), expanding through ETF/index leadership, digital SIP acquisitions, and rural penetration with Nippon Life capital.",
        "moat": "Largest ETF/passive fund manager (70%+ market share by AUM) benefiting from EPFO/NPS mandates providing sticky, long-duration flows.",
        "catalyst": "SEBI's new asset class regulation in FY26 allows higher-fee products; Nippon Life's 75% stake ensures permanent commitment to Indian market.",
        "risk": "SEBI TER reduction pressure on equity fund margins",
    },
    "HDFCAMC": {
        "growth_plan": "Targeting Rs 9+ lakh Cr AUM by FY27, leveraging HDFC Bank's 8,000+ branch network post-merger for MF cross-sell, expanding passive/AIF funds.",
        "moat": "Highest equity AUM mix (~65%) giving best revenue yield (50+ bps), combined with HDFC Bank's 80M+ customer distribution ecosystem.",
        "catalyst": "HDFC Bank merger unlocking massive cross-sell; new SIPs at 4L+/month with 95%+ renewal rates.",
        "risk": "Market correction reducing equity AUM and mark-to-market revenue",
    },
    "KARURVYSYA": {
        "growth_plan": "Targeting 15%+ credit growth through FY27, scaling gold loans (Rs 15,000+ Cr book), MSME lending, and vehicle finance, maintaining NIM 4%+ via digital transformation.",
        "moat": "South India's strongest old-private-sector franchise with 800+ branches, 90+ year trust, and highest CASA ratio (~35%) among regional peers enabling low cost of funds.",
        "catalyst": "RoA 1.5%+ and RoE 15%+ with GNPA <2% should trigger re-rating from 1.5x to 2x+ P/BV as institutional ownership rises.",
        "risk": "Geographic concentration in TN/Karnataka; limited brand recall outside South India",
    },
    "FORCEMOT": {
        "growth_plan": "Ramping Sanand plant for next-gen BMW/Mercedes powertrain assemblies + new Traveller/Gurkha models, Rs 800 Cr capex over FY25-27 to double premium OEM revenue.",
        "moat": "Only Indian company with exclusive powertrain supply for both BMW and Mercedes India — a 20+ year sticky relationship with deep engineering integration no peer has replicated.",
        "catalyst": "BMW X3/X5 and Mercedes GLC India production ramp driving 25-30% YoY growth in high-margin powertrain revenues through FY26-27.",
        "risk": "Luxury auto cyclicality; BMW ~40% of revenue",
    },
    "TVSMOTOR": {
        "growth_plan": "Rs 1,500 Cr investment in EV platform (iQube expansion to 4-5 models), ethanol-flex ICE engines, and Africa/ASEAN expansion targeting 50 lakh+ annual volumes.",
        "moat": "Strongest EV execution among 2W OEMs with ~20% e-scooter share, in-house motor/controller design, and 100+ exclusive EV touchpoints — Hero/Bajaj don't match this integrated EV play.",
        "catalyst": "FAME-III subsidy clarity and iQube ST launch at sub-Rs 1L could accelerate EV mix from ~8% to 15%+ of domestic volumes by Q4FY26.",
        "risk": "Margin pressure from EV pricing war with Ola/Ather",
    },
    "EICHERMOT": {
        "growth_plan": "New Vallam Vadagal CKD/export hub + Bhopal expansion to 13 lakh+ units/year by FY27; launching electric Himalayan and 2-3 new ICE platforms.",
        "moat": "95%+ share of 250-750cc mid-size segment with unmatched brand cult, 2,200+ exclusive stores, and 40%+ EBITDA margins — Harley/Triumph haven't dented share.",
        "catalyst": "Electric Himalayan H2FY26 launch + export traction targeting 1.5 lakh+ international shipments; VECV CV recovery with infra spending uptick.",
        "risk": "Stagnating domestic 350cc volumes if premiumization slows",
    },
    "ADANIPORTS": {
        "growth_plan": "Targeting 1,000 MMT cargo capacity by FY28 (from ~600 MMT) via Vizhinjam transhipment port, Colombo West terminal, and Mundra/Dhamra expansions — Rs 15-18K Cr capex.",
        "moat": "India's largest private port operator (27% of national cargo, 13 ports) with unmatched logistics network and SEZ/warehousing integration that JSW Infra cannot replicate at scale.",
        "catalyst": "Vizhinjam deepwater port (India's first transhipment hub) ramp in FY26 could capture 15-20% of transhipment cargo currently routed via Colombo/Singapore.",
        "risk": "Adani Group governance overhang; ~3.5x net debt/EBITDA",
    },
    "SYRMA": {
        "growth_plan": "Scaling from Rs 3,000 Cr to Rs 5,000+ Cr revenue by FY27 via new Chennai/Bengaluru EMS facilities for auto electronics, IoT/smart meters, and RFID products under PLI.",
        "moat": "Design-led EMS (not just box-build) with proprietary RFID tags, smart meter modules, sensor designs — higher margin ODM mix (~30%) vs pure contract manufacturers like Dixon.",
        "catalyst": "Smart meter order book (Rs 1,500+ Cr pipeline from state discoms) entering high-execution phase in FY26-27.",
        "risk": "Working capital intensity and consumer electronics client concentration",
    },
    "NETWEB": {
        "growth_plan": "Expanding to 10,000+ server capacity/year and GPU-as-a-Service cloud infra; targeting Rs 2,500+ Cr revenue by FY27 riding India's Rs 10,000 Cr AI Mission.",
        "moat": "India's only listed pure-play HPC/AI server OEM with NVIDIA DGX-ready certification, proprietary liquid cooling IP, and CDAC/ISRO/defence integration — no Indian peer has this.",
        "catalyst": "India AI Mission's Rs 10,000 Cr compute allocation + wins from Yotta/NxtGen data centers for GPU clusters signal accelerating FY26 demand.",
        "risk": "NVIDIA GPU supply constraints and lumpy govt order cycles",
    },
    "PGEL": {
        "growth_plan": "New Greater Noida Phase 2 and Roorkee facility adding 4M AC units ODM capacity by FY27; entering washing machine/cooler ODM lines with Rs 600+ Cr capex.",
        "moat": "Largest pure-play AC ODM (8+ brand clients), deeper backward integration into PCB/sheet metal/injection molding than any EMS peer, yielding 11-12% EBITDA vs 6-7% box-build.",
        "catalyst": "AC ODM penetration rising from 30% to 50%+ as brands go asset-light — directly growing PGEL's addressable wallet share through FY26-27.",
        "risk": "Seasonal demand concentration (60%+ in Q4/Q1) and customer bargaining power",
    },
    "KAYNES": {
        "growth_plan": "Building India's first private OSAT (semiconductor packaging) in Telangana (~Rs 3,000 Cr with govt support), targeting FY27 commissioning + expanding Mysuru PCBA 3x for defence/EV.",
        "moat": "Only listed Indian EMS with credible semiconductor packaging (OSAT) entry + high-reliability aerospace/defence PCBA — peers like Dixon lack this chip-to-board roadmap.",
        "catalyst": "OSAT groundbreaking + defence/auto order book (Rs 4,000+ Cr) converting to revenue at 40%+ YoY growth in FY26-27.",
        "risk": "OSAT first-of-kind execution risk with long gestation",
    },
    "KFINTECH": {
        "growth_plan": "Expanding international RTA (Malaysia, Philippines), building AIF/PMS fund administration and corporate registry digitization — 20%+ revenue CAGR on asset-light SaaS model.",
        "moat": "Duopoly with CAMS in MF RTA market (~45% share), 10-year sticky contracts, 85%+ gross margins — regulatory barriers make new entry near-impossible.",
        "catalyst": "MF AUM at Rs 70L Cr + Rs 25,000+ Cr monthly SIPs creates automatic volume-linked revenue growth; new AIF/PMS mandates expand TAM in FY26.",
        "risk": "SEBI mandating lower RTA charges",
    },
    "CCL": {
        "growth_plan": "Doubling Vietnam plant to 20,000 MT + Swiss freeze-dry facility, taking global capacity to 55,000+ MT by FY27 for Walmart/Costco/European retailer private-label demand.",
        "moat": "World's largest private-label instant coffee maker (50,000+ MT, India+Vietnam+Switzerland) — vertically integrated bean-to-cup with cost edge over Nestle/JDE own manufacturing.",
        "catalyst": "Record Arabica prices driving brands to outsource more to CCL — visible in H2FY26 order pipeline growth.",
        "risk": "Robusta/Arabica price volatility squeezing pass-through margins",
    },
    "HONASA": {
        "growth_plan": "Pivoting to offline (1.5L+ retail outlets), scaling The Derma Co to Rs 1,000 Cr, launching Aqualogica/BBlunt in mass premium — Rs 200+ Cr annual brand-building spend.",
        "moat": "First-mover digital-native personal care platform with 6+ brands spanning Rs 200-2,000; data-driven 50+ SKU/year launch velocity that legacy FMCG can't match.",
        "catalyst": "Turning sustained EBITDA-positive in FY26 as offline economics improve and The Derma Co nears breakeven — profitability inflection re-rates from D2C to multi-brand platform.",
        "risk": "Brand fatigue in crowded D2C beauty market; cash burn on new brands",
    },
    "ENRIN": {
        "growth_plan": "Targeting 2-3 GW wind/solar capacity additions over FY25-27 leveraging India's 500 GW non-fossil target, with Rs 4-5K Cr project pipeline.",
        "moat": "Focused renewable player with early-mover project development and PPA-secured revenue offering long-duration cash flow visibility vs merchant power peers.",
        "catalyst": "India's accelerating RE tendering (50+ GW in FY25) + potential green energy index/ESG inclusion driving institutional inflows in FY26.",
        "risk": "Policy/tariff uncertainty and land/grid connectivity delays",
    },
    "ADANIGREEN": {
        "growth_plan": "50 GW target by 2030 (from ~11 GW operational); Rs 40-50K Cr capex over FY25-28 including world's largest 30 GW Khavda renewable park.",
        "moat": "India's largest RE company with lowest LCOE from procurement scale (60%+ share in some solar tenders) — NTPC RE/Tata Power can't match the scale advantage.",
        "catalyst": "5-6 GW new commissioning in FY26-27 converting pipeline to revenue + potential TotalEnergies equity infusion for deleveraging.",
        "risk": "~7x net debt/EBITDA and Adani Group governance overhang",
    },
    "TORNTPOWER": {
        "growth_plan": "Adding 5 GW renewable capacity by FY28 + expanding Ahmedabad/Surat distribution and 1.2 GW Dahej gas-based power commissioning.",
        "moat": "India's most efficient private distribution company (T&D losses <5% vs 20%+ state discoms) — regulated monopoly in Gujarat's richest urban pockets provides annuity earnings.",
        "catalyst": "Ahmedabad smart city electrification (8-10% volume growth) + new RE projects achieving COD, expanding green mix from 30% to 40%+.",
        "risk": "Regulatory tariff order delays impacting distribution earnings",
    },
    "NYKAA": {
        "growth_plan": "50-70 new stores (Luxe + On Trend) by FY27, scaling fashion to Rs 3,000+ Cr GMV, building owned brands (Nykaa Cosmetics, Dot & Key) to 15%+ of BPC revenue.",
        "moat": "India's only omnichannel beauty platform at scale (190+ stores, 6,500+ brands) with content-to-commerce flywheel — Amazon/Flipkart/Reliance Tira haven't replicated this.",
        "catalyst": "Fashion turning contribution-positive in FY26 + owned brand margins 65%+ could lift EBITDA from ~5% to 8-9%, triggering profitability re-rating.",
        "risk": "Reliance Tira's aggressive expansion; elevated stock-based comp diluting EPS",
    },
    "TRENT": {
        "growth_plan": "150-200 new Zudio stores/year (targeting 1,000+ by FY27) + Westside expansion, total store count 1,100+, entering beauty retail via Zudio Beauty.",
        "moat": "Only Indian retailer with a value-fashion format (Zudio, ASP ~Rs 400) at scale with Tata backend, achieving 18-20% store-level EBITDA even at mass-market pricing.",
        "catalyst": "Zudio SSG recovery as rural/semi-urban spending rebounds + potential Zudio IPO/demerger to unlock value.",
        "risk": "Hyper-aggressive store rollout leading to cannibalization and margin dilution",
    },
    "INDIAMART": {
        "growth_plan": "Targeting 10,000+ paying subscriber net-adds/quarter + scaling Busy Infotech (cloud accounting SaaS) to build full B2B operating system.",
        "moat": "Dominant B2B marketplace (200M+ listings, 7.5M+ storefronts) — JustDial pivoted away, making IndiaMART the de-facto monopoly in B2B discovery.",
        "catalyst": "Silver/Platinum tier ARPU growth + Busy Infotech crossing Rs 100 Cr revenue run-rate, validating the B2B SaaS bundle thesis.",
        "risk": "Paying subscriber net-add deceleration amid SME spending slowdown",
    },
    "JUBLFOOD": {
        "growth_plan": "Targeting 3,000+ Domino's stores by FY27 (from ~2,000), aggressive Popeyes rollout to 250+ stores, Domino's 20-min delivery in top metros.",
        "moat": "Exclusive Domino's master franchise with India's largest QSR cold-chain (50+ supply centers) — unit economics new entrants can't replicate for years.",
        "catalyst": "SSSG recovery to mid-high single digits via value offerings (Rs 99 pizza) + Popeyes reaching store-level breakeven.",
        "risk": "QSR competition and aggregator margin pressure",
    },
    "IRCTC": {
        "growth_plan": "Scaling Bharat Gaurav tourist trains to 200+ departures/year, e-catering to 500+ stations, new tourism packages leveraging Vande Bharat sleeper rollout.",
        "moat": "Statutory monopoly on Indian Railways ticketing (~1.5B tickets/year) and sole authorized catering licensee — 25M daily captive passenger base no private player can access.",
        "catalyst": "Potential convenience fee hike (unchanged since 2019) + premium train tourism surge with Vande Bharat sleeper coaches launch.",
        "risk": "Government fee/revenue-share policy intervention",
    },
    "AMBER": {
        "growth_plan": "Doubling RAC capacity to 5M+ units by FY27 (Rs 800+ Cr capex, Sri City + Pune plants), scaling electronics/PCB via ILJIN and Sidwal subsidiaries.",
        "moat": "India's largest AC ODM/OEM (~30% outsourced market share), supplying 8 of top 10 brands, backward-integrated into motors/PCBs/sheet metal — 8-12% cost edge over imports.",
        "catalyst": "AC penetration inflection (India ~10% vs 60%+ China) + BEE norms pushing OEMs to outsource more to spec-compliant ODMs.",
        "risk": "Top 3 clients ~50% of revenue",
    },
    "BAJAJ-AUTO": {
        "growth_plan": "Rs 1,000+ Cr in Chetak EV capacity (1M units/year by FY27), CNG motorcycle Freedom 125 launch, targeting 50%+ export share in Africa via localized assembly.",
        "moat": "Global 3-wheeler leader (~70% India share), highest 2W EBITDA margins (~20%), KTM/Triumph partnerships driving premiumization across 70+ export countries.",
        "catalyst": "Chetak scaling to 20K+ units/month by mid-FY27 + Freedom 125 CNG opening a new Rs 15,000 Cr rural addressable market.",
        "risk": "Currency volatility in African/LatAm export markets",
    },
    "ASHOKLEY": {
        "growth_plan": "MHCV market share recovery to 32%+ (from ~28%) via AVTR platform, Rs 500 Cr defence orders (Stallion 4x4), Rs 3,000 Cr Switch Mobility e-bus deliveries.",
        "moat": "~50% bus chassis market share + only Indian OEM with dedicated EV subsidiary (Switch Mobility) running proven UK/European electric bus operations.",
        "catalyst": "CV replacement upcycle (10+ yr fleet age) + Rs 2,500 Cr+ e-bus orders from PM e-Bus Sewa scheme driving FY26-27 growth.",
        "risk": "CV demand cyclicality and Switch Mobility cash burn",
    },
    "NESTLEIND": {
        "growth_plan": "9th factory in Odisha (Rs 900 Cr) for noodles/confectionery/pet food (Purina), targeting 50+ new launches/year through premiumization and health-focus.",
        "moat": "Maggi 60%+ instant noodle share + Cerelac/NAN infant nutrition dominance, 5M+ outlet reach — Nestle global R&D moat no domestic FMCG matches in packaged foods.",
        "catalyst": "Gross margin expansion from benign commodities (palm oil, wheat) + urban on-the-go volume recovery.",
        "risk": "FSSAI regulatory tightening on sugar/salt in packaged foods",
    },
    "LTFOODS": {
        "growth_plan": "Targeting Rs 10,000 Cr revenue by FY27 via Daawat premium rice gains in US/Middle East, organic/RTE portfolio to 15% of revenue, and Kari Kari snacking brand.",
        "moat": "India's #2 basmati exporter with largest aged-rice inventory (18-24 month aging) and 50,000+ farmer relationships — aging infra creates 2-3 year entry barrier.",
        "catalyst": "Government lifting basmati MEP floor/export restrictions, unleashing pent-up Middle East/EU demand where Daawat commands premium.",
        "risk": "Government export curbs and monsoon-dependent input cost volatility",
    },
    "ESCORTS": {
        "growth_plan": "Kubota partnership driving 5+ new tractor models (sub-30HP and 50HP+), Rs 700 Cr in railway braking + construction equipment capacity doubling.",
        "moat": "Only Indian tractor OEM with Kubota (44.8% stake) as strategic tech partner, enabling premium positioning and global export channel vs Mahindra/TAFE.",
        "catalyst": "Record Rabi output + rising rural incomes driving 10%+ tractor industry growth in FY27; gaining share in high-margin 40-50HP Kubota-tech segment.",
        "risk": "Erratic monsoon; tractor demand 65%+ rural-dependent",
    },
    "DATAPATTNS": {
        "growth_plan": "Rs 2,500+ Cr order book, scaling to Rs 1,000 Cr revenue by FY27 via LRDE radars, BrahMos subsystems, naval combat systems, and ISRO/IN-SPACe satellite electronics.",
        "moat": "One of 3-4 private companies with DRDO/MoD certification for mission-critical defence electronics (radars, EW suites, seekers) end-to-end — 5+ years to replicate.",
        "catalyst": "Rs 1.72 lakh Cr defence capital outlay with 75% indigenization mandate; prime beneficiary of BrahMos/Akash-NG production ramp.",
        "risk": "Lumpy order book and long defence procurement cycles",
    },
    "INDUSTOWER": {
        "growth_plan": "68,000+ macro towers with 5G co-location driving tenancy ratio from 1.7x to 2.0x+; edge data center rollout in partnership with hyperscalers targeting tier-2/3 cities.",
        "moat": "India's largest independent tower company by sites (68K+); long-term MSAs with all 3 telcos create sticky 15-20 year revenue streams — near-impossible to replicate at scale.",
        "catalyst": "Bharti Airtel's ongoing 5G rollout needs 40-50K new tenancies; tower sharing economics improve with each additional tenant — operating leverage inflection in FY26-27.",
        "risk": "Vodafone Idea's financial stress (28% revenue share); single-sector concentration in telecom",
    },
    "RAILTEL": {
        "growth_plan": "Expanding from 65,000+ km OFC backbone to cloud/data center services; building Tier-3/4 edge data centers at 100+ railway stations; targeting Rs 3,000+ Cr revenue by FY27.",
        "moat": "Only company with exclusive RoW along Indian Railways' 68,000 km network — fibre backbone that would cost Rs 50,000+ Cr and decades to replicate.",
        "catalyst": "Government's BharatNet Phase-3 (Rs 1.39 lakh Cr) and Kavach signaling rollout across 35,000 km — RailTel is exclusive telecom partner for Indian Railways' digital push.",
        "risk": "Heavy government dependence (80%+ revenue); slow procurement cycles",
    },
    "BHARTIHEXA": {
        "growth_plan": "Aggressive 5G and fixed wireless broadband expansion across 6 circles (Rajasthan, UP-East, NE, etc.); ARPU lift from Rs 200+ to Rs 300+ through premiumization and postpaid conversion.",
        "moat": "Bharti Airtel subsidiary with exclusive licenses in 6 high-growth circles covering 15%+ of India's population; benefits from Airtel's brand, tech stack, and 5G investment.",
        "catalyst": "ARPU improvement cycle (Rs 200→Rs 300+) driven by tariff hikes and 5G upsell; fixed broadband as second growth engine in underserved markets.",
        "risk": "Regulatory tariff caps; parent Airtel controls strategy and capex priorities",
    },
    "TATACOMM": {
        "growth_plan": "Pivoting from legacy voice to digital platform services (cloud, cybersecurity, IoT, edge); targeting $2B+ digital revenue with 60%+ margins by FY27.",
        "moat": "Owns world's largest subsea cable network (500,000+ km) and India's #1 enterprise data network — foundational infra for cloud, CDN, and IoT connectivity globally.",
        "catalyst": "AI/GenAI workloads driving enterprise cloud migration; Tata group synergies (TCS, Tata Elxsi, Air India) create captive demand for DIGO platform.",
        "risk": "Legacy voice revenue (25%) declining 10-15% annually; high debt from subsea cable investments",
    },
    "ROUTE": {
        "growth_plan": "Scaling cloud communication platform (CPaaS) globally; targeting 50B+ messages/year across SMS, RCS, WhatsApp Business; expanding into AI-powered conversational commerce.",
        "moat": "Direct connections to 800+ mobile operators globally for A2P messaging — 10+ year relationships and compliance certifications that take 3-5 years for new entrants.",
        "catalyst": "Enterprise shift from SMS to rich messaging (RCS, WhatsApp Business) drives 3-5x ARPU uplift per message; Google's RCS rollout is a structural tailwind.",
        "risk": "Margin pressure from OTT cannibalization (WhatsApp direct); currency risk from 70%+ international revenue",
    },
}

INDIA_2030_THEMES = [
    {
        "id": "govt-capex",
        "title": "Govt Capex & Infrastructure",
        "subtitle": "Rs 11.2L Cr FY26 capex sustaining India's infrastructure supercycle",
        "color": "#3b82f6",
        "research": [
            "Union Budget FY26 allocated Rs 11.21 lakh crore for capital expenditure — government sustained the infra push despite fiscal consolidation, signalling long-term commitment to growth capex.",
            "National Infrastructure Pipeline execution accelerated — 9,000+ projects worth Rs 108 lakh crore at various stages; multi-year revenue visibility for EPC and materials companies.",
            "Railway capex crossed Rs 2.80 lakh crore in FY26; 130+ Vande Bharat trains running, DFC Phase 2 operational — order books of L&T, RVNL, IRFC extended to FY29.",
            "Bharatmala Phase 1 nearing completion; Sagarmala 2.0 targets deep-water ports and inland waterways — India's port capacity set to double from 2,500 MMTPA to 5,000 MMTPA by 2030.",
            "PLI delivering results — electronics exports crossed $35 billion; solar module PLI building 50 GW domestic manufacturing capacity by 2027; specialty chemicals capex cycle in full swing.",
        ],
        "industries": [
            "Engineering & Construction", "Specialty Industrial Machinery", "Railroads",
            "Building Materials", "Steel", "Electrical Equipment & Parts",
            "Infrastructure Operations", "Building Products & Equipment",
            "Tools & Accessories", "Cement",
        ],
    },
    {
        "id": "population",
        "title": "1.4B People & Their Needs",
        "subtitle": "World's youngest large nation — healthcare, housing & financial inclusion",
        "color": "#22c55e",
        "research": [
            "India's 1.44 billion population (median age 28) creates a massive demand runway for healthcare, housing, education, and financial services — the structural story is intact through 2030.",
            "Insurance penetration at 4.2% vs 6.8% global average — life and health insurance premiums growing at 15% CAGR; Bima Sugam digital marketplace accelerating retail adoption.",
            "Housing shortage of 10 crore units; PM Awas Yojana 2.0 has sanctioned 3 crore houses — building materials, affordable housing developers, and home loan NBFCs are key beneficiaries.",
            "Healthcare spend at 3.3% of GDP targeting 5% by 2030 — hospital chains, diagnostic labs, and specialty pharma see 18-22% earnings growth; medical tourism crossing $10 billion.",
            "National Education Policy 2.0 rollout; 37 crore students in the system driving skill development spend — vocational training, EdTech, and assessment companies ride secular tailwind.",
        ],
        "industries": [
            "Drug Manufacturers - General", "Drug Manufacturers - Specialty & Generic",
            "Medical Care Facilities", "Diagnostics & Research",
            "Insurance - Life", "Insurance - Diversified",
            "Real Estate - Development", "Real Estate - Diversified",
            "Credit Services", "Education & Training Services",
            "Healthcare Plans", "Health Information Services",
        ],
    },
    {
        "id": "growth-segments",
        "title": "India's Growth Segments",
        "subtitle": "Capital markets, UPI, logistics & credit expansion powering GDP",
        "color": "#a78bfa",
        "research": [
            "Demat accounts crossed 18 crore by early 2026 — capital markets deepening with retail participation driving volumes; AMCs, depositories, and brokers in structural upcycle.",
            "UPI processed 16+ billion transactions/month in 2026 — RBI's Account Aggregator framework and ONDC create new monetisation opportunities for digital finance platforms.",
            "India's logistics sector worth $450 billion growing at 11% CAGR; multimodal logistics parks, DFC-linked warehousing, and 3PL companies are compounding at 20%+ earnings growth.",
            "Mutual fund AUM crossed Rs 75 lakh crore; monthly SIP flows exceed Rs 25,000 crore — wealth management, portfolio management services, and financial data companies benefit structurally.",
            "Credit-to-GDP ratio at 59% vs 150%+ in developed nations — massive headroom for banks and NBFCs; retail credit, MSME lending, and co-lending partnerships are key growth vectors.",
        ],
        "industries": [
            "Capital Markets", "Asset Management", "Banks - Regional",
            "Financial Conglomerates", "Financial Data & Stock Exchanges",
            "Integrated Freight & Logistics", "Mortgage Finance",
            "Insurance Brokers", "Trucking",
        ],
    },
    {
        "id": "global-impact",
        "title": "Global Influence & Trade",
        "subtitle": "China+1, $1T export target, and India's role in global supply chains",
        "color": "#f59e0b",
        "research": [
            "China+1 strategy intensifying in 2026 — US tariff escalation and geopolitical tensions pushing more MNCs to India; FDI approvals for electronics, chemicals, and machinery at record levels.",
            "Merchandise exports on track for $600B+ in FY26; India-UK FTA signed, EU FTA in advanced negotiations — pharma, auto parts, specialty chemicals, and engineering goods lead.",
            "India supplies 20% of world generic medicines; biosimilar exports accelerating — USFDA approvals pipeline strong; GLP-1 APIs and oncology injectables are the next big opportunity.",
            "India's installed renewable capacity crossed 220 GW (solar 150 GW+); $15B+ green energy investments announced in 2025-26 — module makers, inverter suppliers, and cable companies benefit.",
            "IMEC (India-Middle East-Europe Corridor) gaining momentum post-2025 geopolitical reset; India positioned as a neutral trade hub bridging East and West supply chains.",
        ],
        "industries": [
            "Drug Manufacturers - General", "Drug Manufacturers - Specialty & Generic",
            "Specialty Chemicals", "Solar", "Marine Shipping",
            "Textile Manufacturing", "Auto Parts", "Auto Manufacturers",
            "Chemicals", "Packaging & Containers",
        ],
    },
    {
        "id": "tech-frontier",
        "title": "Semicon, EV, Cloud & AI",
        "subtitle": "Rs 76K Cr semiconductor mission, EV revolution, GenAI & cybersecurity",
        "color": "#06b6d4",
        "research": [
            "India Semiconductor Mission: Tata's fab in Gujarat, Micron's assembly plant operational in 2025 — electronics manufacturing growing at 30% CAGR; India on track to be $500B electronics economy by 2030.",
            "EV penetration at 6%+ of new vehicle sales in 2026; 2W and 3W EVs leading — battery cell manufacturing (ACC PLI), charging infra (EVSE), and EV component companies compounding at 40%+ revenue growth.",
            "Data center investments crossed $15B in 2025-26 — India is the fastest-growing data center market in Asia; cloud and colocation players, fibre network companies, and power backup firms benefit.",
            "GenAI deployment accelerating in India — banking, healthcare, and enterprise software sectors leading GenAI adoption; Indian IT majors winning large AI transformation deals worth $20B+ in FY26.",
            "Cybersecurity market growing at 25% CAGR in India — digital infrastructure expansion, DPDP Act compliance requirements, and rising cyber threats drive structural demand for security platforms.",
        ],
        "industries": [
            "Information Technology Services", "Software - Application",
            "Software - Infrastructure", "Electronic Components",
            "Semiconductor Equipment & Materials", "Communication Equipment",
            "Computer Hardware", "Consumer Electronics",
            "Telecom Services", "Electronics & Computer Distribution",
        ],
    },
    {
        "id": "structural-position",
        "title": "Structurally Positioned India",
        "subtitle": "Clean energy transition, DII market floor & utility expansion",
        "color": "#8b5cf6",
        "research": [
            "India's power demand growing at 7-8% annually; peak demand crossed 260 GW — utilities, power equipment, and transmission companies have Rs 9 lakh crore capex pipeline through 2032.",
            "Oil & gas sector faces structural headwinds: EV adoption is reducing petrol/diesel demand growth; crude oil demand globally expected to peak before 2030; refining margin compression persists in 2026.",
            "Green hydrogen and clean energy transition: India's National Green Hydrogen Mission targets 5 MMT production by 2030 — electrolyser makers, green ammonia, and renewable-linked utilities are new growth vectors.",
            "FMCG market worth $250 billion, growing at 10-12% CAGR; premiumisation and rural recovery (aided by good monsoons 2025) driving volume growth for household and personal care brands.",
            "Corporate profit-to-GDP at multi-decade highs; DIIs providing Rs 45,000+ crore monthly structural floor — Indian markets increasingly self-funded, reducing FII dependence.",
        ],
        "industries": [
            "Utilities - Regulated Electric", "Utilities - Renewable",
            "Utilities - Independent Power Producers", "Utilities - Regulated Water",
            "Electrical Equipment & Parts",
            "Packaged Foods", "Household & Personal Products",
            "Conglomerates", "Specialty Chemicals",
        ],
    },
    {
        "id": "genz-alpha",
        "title": "GenZ & Alpha Wave",
        "subtitle": "377M GenZ reshaping consumption — quick commerce, content economy & fintech",
        "color": "#ec4899",
        "research": [
            "India has 377 million GenZ (born 1997-2012) — largest GenZ globally; now entering peak earning years (22-28 age group), driving discretionary spend in experiences, tech, and lifestyle.",
            "Quick commerce matured in 2025-26; Blinkit/Zepto profitable in top cities, expanding to Tier 2 — grocery, electronics, and beauty through 10-minute delivery is a Rs 1.5 lakh crore market by 2028.",
            "Creator economy and streaming: India has 600M internet users consuming 50GB/month data — OTT platforms, gaming, and content monetisation companies see secular tailwind.",
            "D2C brand market crossed $100 billion in 2025; fashion, beauty, nutraceuticals, and pet care brands scaling via social commerce (Instagram, Meesho) — niche consumer brands are compounders.",
            "Fintech adoption rate 87%; GenZ driving micro-investing (Rs 100 SIPs via Groww/Zerodha), digital credit, and embedded insurance — financial inclusion market still largely untapped.",
        ],
        "industries": [
            "Internet Retail", "Internet Content & Information",
            "Apparel Retail", "Apparel Manufacturing",
            "Restaurants", "Entertainment", "Travel Services",
            "Consumer Electronics", "Footwear & Accessories",
            "Leisure",
        ],
    },
    {
        "id": "consumption",
        "title": "Indian Consumption Engine",
        "subtitle": "580M middle class by 2030 — auto EV transition, housing & premiumisation",
        "color": "#f97316",
        "research": [
            "India is the world's 3rd largest auto market; PV sales crossed 44 lakh units in FY26 — EV models now account for 8%+ of new sales; SUV premiumisation continues unabated.",
            "Middle class expanding from 430 million to 580 million by 2030; per capita income crossing $3,500 — discretionary spending on health, leisure, and premium products accelerating sharply.",
            "Building materials market on fire — tiles, pipes, paints, and sanitaryware growing at 2x GDP; real estate launches at 10-year high in 2025 sustaining multi-year demand for building materials.",
            "Air conditioner penetration at 9% (vs 90% China) — consumer durables and appliances face structural demand upcycle; energy-efficient 5-star products and inverter ACs lead premiumisation.",
            "Premiumisation across categories: branded goods market share crossed 42%; consumers trading up in personal care, packaged foods, and electronics — margins expanding for premium-focused brands.",
        ],
        "industries": [
            "Auto Parts", "Auto Manufacturers",
            "Building Materials", "Building Products & Equipment",
            "Luxury Goods", "Packaging & Containers",
            "Home Improvement Retail", "Department Stores",
            "Specialty Retail", "Discount Stores",
            "Furnishings, Fixtures & Appliances",
        ],
    },
    {
        "id": "agriculture",
        "title": "Agriculture Transformation",
        "subtitle": "18% of GDP, 42% workforce — food processing, water security & agri-tech",
        "color": "#84cc16",
        "research": [
            "Agriculture contributes 18% of GDP employing 42% of the workforce — mechanisation, precision farming, and food processing remain multi-decade growth themes; good monsoons in 2024-25 boosted rural incomes.",
            "Food processing industry growing at 9% CAGR; India still processes only 12% of food output vs 70% in developed nations — value-added food, ready-to-eat, and functional nutrition are fast-growing segments.",
            "Water security emerging as critical theme: India has 4% of world's water but 17% of population — water treatment, drip irrigation, micro-irrigation PLI, and wastewater recycling companies see 20%+ growth.",
            "Agri-inputs market crossed Rs 2.8 lakh crore; crop protection, hybrid seeds, and biological pesticides growing faster than chemical fertilisers — sustainability shift benefits niche agri-chem companies.",
            "Farm mechanisation at 50%; tractor penetration growing 8% annually — farm equipment, drone-based crop management (Niti Aayog promoting 100K drones by 2026), and agri-data platforms are emerging compounders.",
        ],
        "industries": [
            "Agricultural Inputs", "Farm Products",
            "Packaged Foods", "Farm & Heavy Construction Machinery",
            "Food Distribution", "Beverages - Non-Alcoholic",
            "Beverages - Brewers", "Beverages - Wineries & Distilleries",
            "Confectioners",
        ],
    },
    {
        "id": "defence-ai",
        "title": "Defence & AI Future",
        "subtitle": "Rs 6.8L Cr defence budget, 100+ export nations & drone/space revolution",
        "color": "#ef4444",
        "research": [
            "Defence budget FY26 crossed Rs 6.8 lakh crore; 75% domestic procurement mandate enforced strictly — Hindustan Aeronautics, BEL, Bharat Forge, and DRDO PSUs have Rs 3 lakh crore+ order books.",
            "Defence exports crossed Rs 25,000 crore in FY25; India now exports to 100+ countries — Brahmos missiles, Tejas jets, naval vessels, and surveillance radars driving export pipeline growth.",
            "Space economy reforms: IN-SPACe licences 50+ private players; Agnikul, Skyroot, and ISRO's commercial arm targeting Rs 40,000 crore space economy — satellite components, launch vehicles, ground systems.",
            "Drone revolution: government approved 100+ drone manufacturers; border surveillance, precision agriculture, cargo delivery drones — Rs 15,000 crore Indian drone market by 2030.",
            "Nuclear energy as strategic baseload: India plans 20 new nuclear reactors by 2040 — BHEL, L&T, and specialised engineering firms building nuclear-grade components with long-duration order pipelines.",
        ],
        "industries": [
            "Aerospace & Defense", "Electronic Components",
            "Communication Equipment", "Scientific & Technical Instruments",
            "Metal Fabrication", "Specialty Industrial Machinery",
            "Engineering & Construction",
        ],
    },
]


def _compute_multibagger_score(row):
    """Compute a multibagger potential score (0-100) based on quarterly growth
    strength, momentum, relative strength, profitability and ROE.
    Higher = stronger recent quarter performance & multibagger characteristics."""
    def _val(key, default=0):
        v = row.get(key)
        if v is None:
            return default
        try:
            f = float(v)
            return default if (math.isnan(f) or math.isinf(f)) else f
        except (TypeError, ValueError):
            return default

    growth = _val("fund_growth")           # Quarterly earnings/revenue growth (0-100)
    momentum = _val("tech_momentum")       # Price momentum (0-100)
    rel_strength = _val("tech_relative_strength")  # Outperforming market (0-100)
    trend = _val("tech_trend")             # Trend strength (0-100)
    profitability = _val("fund_profitability")  # Profit margins (0-100)
    roe = _val("roe")

    # Normalize ROE: cap at 40%, scale to 0-100
    roe_score = min(100, max(0, (roe / 40) * 100)) if roe > 0 else 0

    # Weighted multibagger score
    score = (
        growth * 0.30 +          # Quarterly growth is #1 signal
        momentum * 0.20 +        # Price momentum confirms conviction
        rel_strength * 0.20 +    # Outperforming market = institutional interest
        trend * 0.10 +           # Uptrend confirmation
        profitability * 0.10 +   # Profitable growth > unprofitable
        roe_score * 0.10         # Capital efficiency
    )
    return round(score, 2)


def _multibagger_reason(row):
    """Generate a short reason string explaining why this stock has multibagger potential."""
    reasons = []
    def _val(key):
        v = row.get(key)
        if v is None:
            return 0
        try:
            f = float(v)
            return 0 if (math.isnan(f) or math.isinf(f)) else f
        except (TypeError, ValueError):
            return 0

    g = _val("fund_growth")
    m = _val("tech_momentum")
    rs = _val("tech_relative_strength")
    roe = _val("roe")
    de = _val("debt_to_equity")

    if g >= 80:
        reasons.append("exceptional quarterly growth")
    elif g >= 60:
        reasons.append("strong quarterly growth")
    if m >= 75:
        reasons.append("high momentum")
    if rs >= 80:
        reasons.append("outperforming market")
    elif rs >= 60:
        reasons.append("relative strength")
    if roe > 20:
        reasons.append(f"ROE {roe:.0f}%")
    if de < 0.3 and de >= 0:
        reasons.append("low debt")
    if not reasons:
        reasons.append("balanced growth + momentum profile")
    return "; ".join(reasons[:3])


def _build_india2030_data():
    """Build India 2030 thematic data by matching stocks from index universes
    to themes via industry keywords. No scan required — reads composite_ranked.csv."""
    composite = load_csv("composite_ranked.csv")
    if not composite:
        return {"error": "No composite_ranked.csv data available"}

    # Load saved CMP data from previous scan (if available)
    saved_cmp = {}
    saved_rows = load_csv("india2030_strategy.csv")
    if saved_rows:
        for row in saved_rows:
            sym = (row.get("symbol") or "").strip()
            cmp_val = row.get("cmp")
            if sym and cmp_val is not None and str(cmp_val).strip() not in ("", "None"):
                try:
                    saved_cmp[sym] = round(float(cmp_val), 2)
                except (ValueError, TypeError):
                    pass

    # Load entry_zone from signals.csv
    entry_zone_map = {}
    signal_rows = load_csv("signals.csv")
    if signal_rows:
        for row in signal_rows:
            sym = (row.get("symbol") or "").strip()
            ez = row.get("entry_zone")
            if sym and ez:
                entry_zone_map[sym] = str(ez)

    # Build union of 3 index universes
    index_symbols = set()
    for idx_key in ("midcap150", "largemidcap250", "smallcap250"):
        pf = config.PORTFOLIOS.get(idx_key, {})
        for s in pf.get("stocks", []):
            index_symbols.add(s.strip().upper() + ".NS")

    # Build lookup
    comp_map = {}
    for row in composite:
        sym = (row.get("symbol") or "").strip()
        if sym:
            comp_map[sym] = row

    themes_out = []
    for theme in INDIA_2030_THEMES:
        industry_set = {ind.strip().lower() for ind in theme["industries"]}
        matches = []
        for sym in index_symbols:
            row = comp_map.get(sym)
            if not row:
                continue
            row_industry = (row.get("industry") or "").strip().lower()
            if row_industry in industry_set:
                mb_score = _compute_multibagger_score(row)
                matches.append({
                    "symbol": row.get("symbol", ""),
                    "name": row.get("name", ""),
                    "sector": row.get("sector", ""),
                    "industry": row.get("industry", ""),
                    "composite_score": _sanitize_value(row.get("composite_score")),
                    "fundamental_score": _sanitize_value(row.get("fundamental_score")),
                    "technical_score": _sanitize_value(row.get("technical_score")),
                    "roe": _sanitize_value(row.get("roe")),
                    "pe_ratio": _sanitize_value(row.get("pe_ratio")),
                    "debt_to_equity": _sanitize_value(row.get("debt_to_equity")),
                    "red_flag_status": row.get("red_flag_status", ""),
                    "composite_rank": _sanitize_value(row.get("composite_rank")),
                    "fund_growth": _sanitize_value(row.get("fund_growth")),
                    "tech_momentum": _sanitize_value(row.get("tech_momentum")),
                    "tech_relative_strength": _sanitize_value(row.get("tech_relative_strength")),
                    "multibagger_score": mb_score,
                    "multibagger_reason": _multibagger_reason(row),
                    "cmp": saved_cmp.get(row.get("symbol", "").strip()),
                    "entry_zone": entry_zone_map.get(row.get("symbol", "").strip()),
                })
        # Sort by composite_score desc, take top 8
        matches.sort(key=lambda x: x.get("composite_score") or 0, reverse=True)
        top_picks = matches[:8]

        # Multibagger picks: sort by multibagger_score desc, take top 5
        mb_sorted = sorted(matches, key=lambda x: x.get("multibagger_score") or 0, reverse=True)
        mb_picks = mb_sorted[:5]

        # Inject curated forward-looking research into multibagger picks
        for pick in mb_picks:
            sym_clean = (pick.get("symbol") or "").replace(".NS", "")
            research = STOCK_RESEARCH.get(sym_clean, {})
            pick["growth_plan"] = research.get("growth_plan", "")
            pick["peer_moat"] = research.get("moat", "")
            pick["near_catalyst"] = research.get("catalyst", "")
            pick["key_risk"] = research.get("risk", "")

        themes_out.append({
            "id": theme["id"],
            "title": theme["title"],
            "subtitle": theme["subtitle"],
            "color": theme["color"],
            "research": theme["research"],
            "matchCount": len(matches),
            "stocks": top_picks,
            "multibaggers": mb_picks,
        })

    # ── Build Prospective Portfolio (2-3 year diversified mix) ──
    # 1. Collect & deduplicate all multibagger picks
    seen = {}
    for th in themes_out:
        for s in (th.get("multibaggers") or []):
            sym = s.get("symbol", "")
            if not sym:
                continue
            existing = seen.get(sym)
            if not existing or (s.get("multibagger_score") or 0) > (existing.get("multibagger_score") or 0):
                pick = dict(s)
                pick["_theme_id"] = th["id"]
                pick["_theme_title"] = th["title"]
                pick["_theme_color"] = th["color"]
                seen[sym] = pick
    all_mb = list(seen.values())

    # 2. Compute portfolio fitness score
    for s in all_mb:
        cs = s.get("composite_score") or 0
        mb = s.get("multibagger_score") or 0
        de = _safe_float(s.get("debt_to_equity"), 99)
        flag_ok = (s.get("red_flag_status") or "").upper() in ("PASS", "")
        # Risk adjustment: reward low debt + clean flags
        risk_adj = 100 if (flag_ok and de < 0.8) else (
            80 if (flag_ok and de < 1.5) else (
                60 if flag_ok else 35
            ))
        s["_portfolio_score"] = round(cs * 0.40 + mb * 0.40 + risk_adj * 0.20, 2)

    # 3. Sort by portfolio score, take top 20
    all_mb.sort(key=lambda x: x.get("_portfolio_score") or 0, reverse=True)
    portfolio_picks = all_mb[:20]

    # 4. Assign risk tiers
    # Core: composite >= 58, PASS flag, D/E < 1.5  (steady compounders)
    # Growth: mb_score >= 55, decent fundamentals   (high growth, moderate risk)
    # Tactical: everything else                     (high risk / high reward)
    for s in portfolio_picks:
        cs = s.get("composite_score") or 0
        mb = s.get("multibagger_score") or 0
        de = _safe_float(s.get("debt_to_equity"), 99)
        flag_ok = (s.get("red_flag_status") or "").upper() in ("PASS", "")
        if cs >= 58 and flag_ok and de < 1.5:
            s["_tier"] = "core"
        elif mb >= 55 and cs >= 48:
            s["_tier"] = "growth"
        else:
            s["_tier"] = "tactical"

    core = [s for s in portfolio_picks if s["_tier"] == "core"]
    growth = [s for s in portfolio_picks if s["_tier"] == "growth"]
    tactical = [s for s in portfolio_picks if s["_tier"] == "tactical"]

    # 5. Weight allocation: Core 45%, Growth 35%, Tactical 20%
    tier_targets = {"core": 45, "growth": 35, "tactical": 20}
    # Rebalance if a tier is empty
    total_used = 0
    tier_counts = {"core": len(core), "growth": len(growth), "tactical": len(tactical)}
    active_tiers = {k: v for k, v in tier_counts.items() if v > 0}
    if len(active_tiers) < 3:
        # Redistribute empty tier's allocation
        empty_alloc = sum(tier_targets[k] for k in tier_counts if tier_counts[k] == 0)
        per_active = empty_alloc / len(active_tiers) if active_tiers else 0
        for k in active_tiers:
            tier_targets[k] = tier_targets[k] + per_active

    for s in portfolio_picks:
        tier = s["_tier"]
        count = tier_counts[tier]
        s["_weight"] = round(tier_targets[tier] / count, 2) if count > 0 else 0

    # 6. Theme diversification stats
    theme_alloc = {}
    for s in portfolio_picks:
        tid = s.get("_theme_title", "Unknown")
        theme_alloc[tid] = theme_alloc.get(tid, 0) + s.get("_weight", 0)
    theme_alloc = {k: round(v, 1) for k, v in sorted(theme_alloc.items(), key=lambda x: -x[1])}

    # Build output objects
    def _portfolio_stock(s):
        return {
            "symbol": s.get("symbol", ""),
            "name": s.get("name", ""),
            "industry": s.get("industry", ""),
            "sector": s.get("sector", ""),
            "theme": s.get("_theme_title", ""),
            "themeColor": s.get("_theme_color", "#64748b"),
            "tier": s.get("_tier", "tactical"),
            "weight": s.get("_weight", 0),
            "portfolioScore": s.get("_portfolio_score", 0),
            "compositeScore": s.get("composite_score"),
            "fundamentalScore": s.get("fundamental_score"),
            "technicalScore": s.get("technical_score"),
            "multibaggerScore": s.get("multibagger_score"),
            "roe": s.get("roe"),
            "peRatio": s.get("pe_ratio"),
            "debtToEquity": s.get("debt_to_equity"),
            "redFlagStatus": s.get("red_flag_status", ""),
            "multibaggerReason": s.get("multibagger_reason", ""),
            "growthPlan": s.get("growth_plan", ""),
            "peerMoat": s.get("peer_moat", ""),
            "nearCatalyst": s.get("near_catalyst", ""),
            "keyRisk": s.get("key_risk", ""),
            "cmp": s.get("cmp"),
            "entryZone": s.get("entry_zone"),
        }

    prospective_portfolio = {
        "totalStocks": len(portfolio_picks),
        "totalCandidates": len(all_mb),
        "tiers": {
            "core": {
                "label": "Core Holdings",
                "description": "High composite score, clean fundamentals, low debt — steady compounders for 2-3yr hold",
                "targetWeight": round(tier_targets.get("core", 45), 1),
                "count": len(core),
                "stocks": [_portfolio_stock(s) for s in core],
            },
            "growth": {
                "label": "Growth Accelerators",
                "description": "High multibagger score, strong momentum — capturing India's fastest growth segments",
                "targetWeight": round(tier_targets.get("growth", 35), 1),
                "count": len(growth),
                "stocks": [_portfolio_stock(s) for s in growth],
            },
            "tactical": {
                "label": "Tactical Bets",
                "description": "Highest upside potential, accepts higher risk — small allocation for asymmetric payoff",
                "targetWeight": round(tier_targets.get("tactical", 20), 1),
                "count": len(tactical),
                "stocks": [_portfolio_stock(s) for s in tactical],
            },
        },
        "themeAllocation": theme_alloc,
        "methodology": {
            "scoring": "Portfolio Score = Composite (40%) + Multibagger Score (40%) + Risk Adjustment (20%)",
            "riskAdj": "Clean flags + D/E < 0.8 = 100 pts | Clean flags + D/E < 1.5 = 80 | Flagged = 35",
            "rebalance": "Review quarterly; exit if red flag turns FAIL or composite drops below 45; avoid Oil & Gas refining — energy transition headwind",
            "horizon": "2-3 years (FY26–FY29) | SIP-friendly equal-weight within each tier | entry zone highlighted for buy timing",
        },
    }

    return {
        "themes": themes_out,
        "totalIndexStocks": len(index_symbols),
        "prospectivePortfolio": prospective_portfolio,
    }


def _run_india2030_scan():
    """Enrich India 2030 stock picks with live CMP via yfinance."""
    state = _get_index_state("india2030")
    state["running"] = True
    state["status"] = "scanning"
    state["log_lines"] = ["Starting India 2030 Strategy live price refresh..."]

    try:
        import yfinance as yf

        result = _build_india2030_data()
        if "error" in result:
            state["log_lines"].append(f"Error: {result['error']}")
            state["status"] = "error"
            state["running"] = False
            return

        themes = result["themes"]
        # Collect all unique symbols across themes
        all_symbols = set()
        for th in themes:
            for s in th["stocks"]:
                sym = s.get("symbol", "")
                if sym:
                    all_symbols.add(sym)

        state["log_lines"].append(f"Fetching live prices for {len(all_symbols)} stocks...")

        # Batch fetch live prices
        live_prices = {}
        symbols_list = sorted(all_symbols)
        batch_size = 50
        for i in range(0, len(symbols_list), batch_size):
            batch = symbols_list[i:i + batch_size]
            state["log_lines"].append(f"  Batch {i // batch_size + 1}: {len(batch)} stocks...")
            try:
                tickers_str = " ".join(batch)
                data = yf.download(tickers_str, period="1d", progress=False)
                if data is not None and not data.empty:
                    close_col = data.get("Close")
                    if close_col is not None:
                        if len(batch) == 1:
                            val = close_col.iloc[-1] if len(close_col) > 0 else None
                            if val is not None and not (isinstance(val, float) and math.isnan(val)):
                                live_prices[batch[0]] = round(float(val), 2)
                        else:
                            for sym in batch:
                                if sym in close_col.columns:
                                    val = close_col[sym].iloc[-1]
                                    if val is not None and not (isinstance(val, float) and math.isnan(val)):
                                        live_prices[sym] = round(float(val), 2)
            except Exception as e:
                state["log_lines"].append(f"  Batch error: {e}")

        state["log_lines"].append(f"Got live prices for {len(live_prices)} stocks")

        # Inject CMP into stock rows and save flat CSV
        all_rows = []
        for th in themes:
            for s in th["stocks"]:
                sym = s.get("symbol", "")
                s["cmp"] = live_prices.get(sym)
                s["theme_id"] = th["id"]
                s["theme_title"] = th["title"]
                all_rows.append(s)

        # Save flat CSV
        if all_rows:
            import pandas as pd
            df = pd.DataFrame(all_rows)
            out_path = os.path.join(config.DATA_DIR, "india2030_strategy.csv")
            df.to_csv(out_path, index=False)
            state["log_lines"].append(f"Saved {len(all_rows)} rows to india2030_strategy.csv")

        state["status"] = "done"
        state["log_lines"].append("India 2030 Strategy scan complete!")

    except Exception as e:
        state["status"] = "error"
        state["log_lines"].append(f"Error: {e}")
    finally:
        state["running"] = False


@app.route("/api/india2030", methods=["GET"])
def india2030():
    result = _build_india2030_data()
    if "error" in result:
        return jsonify(result), 404
    return jsonify(result)


@app.route("/api/india2030/scan", methods=["POST"])
def india2030_scan():
    state = _get_index_state("india2030")
    if state["running"]:
        return jsonify({"error": "Scan already running"}), 409
    thread = threading.Thread(target=_run_india2030_scan, daemon=True)
    thread.start()
    return jsonify({"message": "India 2030 Strategy scan started"})


@app.route("/api/india2030/status", methods=["GET"])
def india2030_status():
    state = _get_index_state("india2030")
    return jsonify({
        "running": state["running"],
        "status": state["status"],
        "log_lines": state["log_lines"][-30:],
    })


# ═══════════════════════════════════════════════════════════════════════
# BACKTEST — Accuracy Testing for Predictions, Signals & Scores
# ═══════════════════════════════════════════════════════════════════════

def _run_backtest():
    """
    Walk-forward backtest using cached 1-year price history.

    For each stock with cached data:
      1. Price Prediction accuracy: predict from T-90, T-30, T-7 and compare
         predicted targets with actual prices at T (today).
      2. Signal accuracy: generate signal at T-30, check if price moved in
         signal direction by T.
      3. Composite score correlation: check if higher composite scores
         correspond to higher returns over 30/90 days.
    """
    import pickle
    from modules.price_predictor import PricePredictor

    state = _get_index_state("backtest")
    state["running"] = True
    state["status"] = "scanning"
    state["log_lines"] = ["Starting accuracy backtest..."]

    try:
        predictor = PricePredictor()

        # Load composite_ranked for score data
        comp_path = os.path.join(config.DATA_DIR, "composite_ranked.csv")
        comp_rows = load_csv(comp_path)  # returns list of dicts
        comp_map = {}
        if comp_rows:
            for r in comp_rows:
                sym = str(r.get("symbol", "")).strip()
                comp_map[sym] = {
                    "composite_score": _safe_float(r.get("composite_score")),
                    "fundamental_score": _safe_float(r.get("fundamental_score")),
                    "technical_score": _safe_float(r.get("technical_score")),
                    "sector": str(r.get("sector", "")),
                    "industry": str(r.get("industry", "")),
                    "name": str(r.get("name", "")),
                }

        # Get all cached stocks
        cache_dir = config.CACHE_DIR
        stock_dirs = []
        if os.path.isdir(cache_dir):
            stock_dirs = [d for d in os.listdir(cache_dir)
                          if os.path.isdir(os.path.join(cache_dir, d))]

        state["log_lines"].append(f"Found {len(stock_dirs)} cached stocks")

        # Results accumulators
        pred_results = []  # price prediction accuracy
        signal_results = []  # signal accuracy
        score_return_pairs = []  # composite score vs returns

        tested = 0
        skipped = 0

        for sd in stock_dirs:
            hist_path = os.path.join(cache_dir, sd, "history_1y.pkl")
            if not os.path.exists(hist_path):
                skipped += 1
                continue

            try:
                with open(hist_path, "rb") as f:
                    prices = pickle.load(f)
            except Exception:
                skipped += 1
                continue

            if prices is None or prices.empty or len(prices) < 100:
                skipped += 1
                continue

            close = prices["Close"].astype(float).dropna()
            if len(close) < 100:
                skipped += 1
                continue

            symbol = sd.replace("_NS", ".NS")
            actual_price = float(close.iloc[-1])

            # ── Price Prediction Backtest ──
            # Take historical slice ending N days ago, predict forward, compare
            for lookback_days in [7, 30, 90]:
                if len(close) < lookback_days + 60:
                    continue
                # Slice prices up to T-lookback_days
                hist_slice = prices.iloc[:-lookback_days]
                if hist_slice.empty or len(hist_slice) < 60:
                    continue

                pred = predictor.predict_stock(symbol, prices=hist_slice)
                if not pred:
                    continue

                pred_cmp = pred["cmp"]
                if lookback_days == 7:
                    pred_target = pred["target_7d"]
                elif lookback_days == 30:
                    pred_target = pred["target_30d"]
                else:
                    pred_target = pred["target_90d"]

                # Actual price at T (or closest)
                actual_at_t = actual_price

                # Predicted return vs actual return
                pred_return_pct = ((pred_target - pred_cmp) / pred_cmp * 100) if pred_cmp > 0 else 0
                actual_return_pct = ((actual_at_t - pred_cmp) / pred_cmp * 100) if pred_cmp > 0 else 0

                # Direction accuracy
                pred_direction = 1 if pred_return_pct > 0 else (-1 if pred_return_pct < 0 else 0)
                actual_direction = 1 if actual_return_pct > 0 else (-1 if actual_return_pct < 0 else 0)
                direction_correct = pred_direction == actual_direction

                # Error
                error_pct = pred_return_pct - actual_return_pct

                pred_results.append({
                    "symbol": symbol.replace(".NS", ""),
                    "horizon": lookback_days,
                    "pred_cmp": round(pred_cmp, 2),
                    "pred_target": round(pred_target, 2),
                    "actual_price": round(actual_at_t, 2),
                    "pred_return_pct": round(pred_return_pct, 1),
                    "actual_return_pct": round(actual_return_pct, 1),
                    "error_pct": round(error_pct, 1),
                    "abs_error_pct": round(abs(error_pct), 1),
                    "direction_correct": direction_correct,
                    "within_5pct": abs(error_pct) <= 5,
                    "within_10pct": abs(error_pct) <= 10,
                    "algo_version": pred.get("algo_version", "v3"),
                    "confidence": pred.get("confidence", 0),
                })

            # ── Signal Backtest (30-day lookback) ──
            if len(close) >= 90:
                hist_30 = prices.iloc[:-30]
                try:
                    pred_30 = predictor.predict_stock(symbol, prices=hist_30)
                    if pred_30:
                        sig_direction = pred_30.get("direction", "SIDEWAYS")
                        cmp_30 = pred_30["cmp"]
                        ret_30 = ((actual_price - cmp_30) / cmp_30 * 100) if cmp_30 > 0 else 0

                        if sig_direction == "BULLISH":
                            win = ret_30 > 0
                        elif sig_direction == "BEARISH":
                            win = ret_30 < 0
                        else:
                            win = abs(ret_30) < 5  # sideways means small move

                        signal_results.append({
                            "symbol": symbol.replace(".NS", ""),
                            "signal": sig_direction,
                            "cmp_at_signal": round(cmp_30, 2),
                            "price_after_30d": round(actual_price, 2),
                            "return_pct": round(ret_30, 1),
                            "win": win,
                        })
                except Exception:
                    pass

            # ── Composite Score vs Return ──
            comp_info = comp_map.get(symbol, {})
            cs = comp_info.get("composite_score", 0)
            if cs and cs > 0 and len(close) >= 30:
                price_30ago = float(close.iloc[-30]) if len(close) >= 30 else None
                price_90ago = float(close.iloc[-90]) if len(close) >= 90 else None

                ret_30d = ((actual_price - price_30ago) / price_30ago * 100) if price_30ago else None
                ret_90d = ((actual_price - price_90ago) / price_90ago * 100) if price_90ago else None

                score_return_pairs.append({
                    "symbol": symbol.replace(".NS", ""),
                    "name": comp_info.get("name", ""),
                    "sector": comp_info.get("sector", ""),
                    "composite_score": round(cs, 1),
                    "fundamental_score": round(comp_info.get("fundamental_score", 0), 1),
                    "technical_score": round(comp_info.get("technical_score", 0), 1),
                    "return_30d": round(ret_30d, 1) if ret_30d is not None else None,
                    "return_90d": round(ret_90d, 1) if ret_90d is not None else None,
                })

            tested += 1
            if tested % 50 == 0:
                state["log_lines"].append(f"Tested {tested} stocks...")

        state["log_lines"].append(f"Backtest complete: {tested} tested, {skipped} skipped")

        # ── Aggregate metrics ──
        import numpy as np

        summary = {"price_prediction": {}, "signals": {}, "composite_scores": {}}

        # Price prediction aggregates by horizon
        for horizon in [7, 30, 90]:
            h_results = [r for r in pred_results if r["horizon"] == horizon]
            if not h_results:
                continue
            errors = [r["abs_error_pct"] for r in h_results]
            summary["price_prediction"][f"{horizon}d"] = {
                "count": len(h_results),
                "mae": round(np.mean(errors), 1),
                "median_error": round(np.median(errors), 1),
                "direction_accuracy": round(
                    sum(1 for r in h_results if r["direction_correct"]) / len(h_results) * 100, 1
                ),
                "within_5pct": round(
                    sum(1 for r in h_results if r["within_5pct"]) / len(h_results) * 100, 1
                ),
                "within_10pct": round(
                    sum(1 for r in h_results if r["within_10pct"]) / len(h_results) * 100, 1
                ),
                "avg_pred_return": round(np.mean([r["pred_return_pct"] for r in h_results]), 1),
                "avg_actual_return": round(np.mean([r["actual_return_pct"] for r in h_results]), 1),
            }

        # Signal win rate
        if signal_results:
            total_sigs = len(signal_results)
            wins = sum(1 for s in signal_results if s["win"])
            by_type = {}
            for stype in ["BULLISH", "BEARISH", "SIDEWAYS"]:
                typed = [s for s in signal_results if s["signal"] == stype]
                if typed:
                    by_type[stype] = {
                        "count": len(typed),
                        "win_rate": round(sum(1 for s in typed if s["win"]) / len(typed) * 100, 1),
                        "avg_return": round(np.mean([s["return_pct"] for s in typed]), 1),
                    }
            summary["signals"] = {
                "total": total_sigs,
                "overall_win_rate": round(wins / total_sigs * 100, 1),
                "by_type": by_type,
            }

        # Composite score correlation
        if score_return_pairs:
            valid_30 = [s for s in score_return_pairs if s["return_30d"] is not None]
            valid_90 = [s for s in score_return_pairs if s["return_90d"] is not None]

            # Quintile analysis: split by score into 5 buckets
            def quintile_analysis(data, return_key):
                if len(data) < 10:
                    return []
                sorted_data = sorted(data, key=lambda x: x["composite_score"])
                bucket_size = len(sorted_data) // 5
                if bucket_size == 0:
                    return []
                quintiles = []
                for q in range(5):
                    start = q * bucket_size
                    end = start + bucket_size if q < 4 else len(sorted_data)
                    bucket = sorted_data[start:end]
                    returns = [b[return_key] for b in bucket if b[return_key] is not None]
                    scores = [b["composite_score"] for b in bucket]
                    if returns:
                        quintiles.append({
                            "quintile": q + 1,
                            "label": ["Bottom 20%", "20-40%", "40-60%", "60-80%", "Top 20%"][q],
                            "avg_score": round(np.mean(scores), 1),
                            "score_range": f"{round(min(scores), 1)} - {round(max(scores), 1)}",
                            "avg_return": round(np.mean(returns), 1),
                            "median_return": round(np.median(returns), 1),
                            "count": len(returns),
                            "positive_pct": round(sum(1 for r in returns if r > 0) / len(returns) * 100, 1),
                        })
                return quintiles

            # Correlation coefficient
            def correlation(data, return_key):
                vals = [(d["composite_score"], d[return_key]) for d in data if d[return_key] is not None]
                if len(vals) < 5:
                    return 0
                scores_arr = np.array([v[0] for v in vals])
                returns_arr = np.array([v[1] for v in vals])
                if np.std(scores_arr) == 0 or np.std(returns_arr) == 0:
                    return 0
                return round(float(np.corrcoef(scores_arr, returns_arr)[0, 1]), 3)

            summary["composite_scores"] = {
                "total_stocks": len(score_return_pairs),
                "correlation_30d": correlation(valid_30, "return_30d"),
                "correlation_90d": correlation(valid_90, "return_90d"),
                "quintiles_30d": quintile_analysis(valid_30, "return_30d"),
                "quintiles_90d": quintile_analysis(valid_90, "return_90d"),
            }

        # Top/bottom prediction examples
        sorted_by_error = sorted(pred_results, key=lambda x: x["abs_error_pct"])
        best_predictions = sorted_by_error[:10]
        worst_predictions = sorted_by_error[-10:][::-1]

        # Top signal winners/losers
        sorted_sigs = sorted(signal_results, key=lambda x: x["return_pct"], reverse=True)
        top_signal_winners = sorted_sigs[:10]
        top_signal_losers = sorted_sigs[-10:][::-1]

        result = {
            "summary": summary,
            "tested_stocks": tested,
            "skipped_stocks": skipped,
            "total_predictions": len(pred_results),
            "total_signals": len(signal_results),
            "total_score_pairs": len(score_return_pairs),
            "best_predictions": best_predictions,
            "worst_predictions": worst_predictions,
            "top_signal_winners": top_signal_winners,
            "top_signal_losers": top_signal_losers,
            "score_return_data": score_return_pairs[:200],  # cap for response size
        }

        # Save to cache
        result_path = os.path.join(config.DATA_DIR, "backtest_results.json")
        with open(result_path, "w") as f:
            json.dump(result, f, indent=2, default=str)

        state["log_lines"].append(f"Results saved to {result_path}")
        state["status"] = "done"
        state["running"] = False
        state["result"] = result

    except Exception as e:
        state["log_lines"].append(f"ERROR: {e}")
        state["status"] = "error"
        state["running"] = False


@app.route("/api/backtest", methods=["GET"])
def get_backtest():
    """Return cached backtest results."""
    result_path = os.path.join(config.DATA_DIR, "backtest_results.json")
    if os.path.exists(result_path):
        with open(result_path, "r") as f:
            return jsonify(json.load(f))
    # Check in-memory state
    state = _get_index_state("backtest")
    if "result" in state:
        return jsonify(state["result"])
    return jsonify({"error": "No backtest results. Run a backtest scan first."}), 404


@app.route("/api/backtest/scan", methods=["POST"])
def backtest_scan():
    state = _get_index_state("backtest")
    if state["running"]:
        return jsonify({"error": "Backtest already running"}), 409
    thread = threading.Thread(target=_run_backtest, daemon=True)
    thread.start()
    return jsonify({"message": "Backtest scan started"})


@app.route("/api/backtest/status", methods=["GET"])
def backtest_status():
    state = _get_index_state("backtest")
    return jsonify({
        "running": state["running"],
        "status": state["status"],
        "log_lines": state["log_lines"][-30:],
    })


# ═══════════════════════════════════════════════════════════════════════
# ML BACKTEST — Gated-signal walk-forward P&L accuracy
# ═══════════════════════════════════════════════════════════════════════

_ML_BT_STATE = {"running": False, "status": "idle", "result": None}


def _run_ml_backtest():
    """
    Gap A — True ML backtest: walk-forward simulation over cached history.

    For each stock with ≥180 days of history:
      - Simulate gated-signal predictions at weekly intervals over the last 6 months
      - For each STRONG_BUY / BUY gated signal, record the actual 7/30-day return
      - Compute: hit_rate%, avg_return, Sharpe ratio, max_drawdown, win_streak
    Only predictions with gate_passed=True are included (high-conviction calls).
    """
    import pickle
    import math as _math
    import numpy as _np
    from datetime import datetime
    from modules.price_predictor import PricePredictor

    global _ML_BT_STATE
    _ML_BT_STATE["running"] = True
    _ML_BT_STATE["status"]  = "scanning"

    try:
        predictor  = PricePredictor()
        cache_dir  = config.CACHE_DIR
        stock_dirs = [d for d in os.listdir(cache_dir) if os.path.isdir(os.path.join(cache_dir, d))]

        buy_trades   = []   # {symbol, entry_date, entry_price, exit_7d, exit_30d, ret_7d, ret_30d, gated_signal}
        all_returns  = []   # used for Sharpe
        tested = skipped = 0

        for sd in stock_dirs:
            prices = None
            for fn in ("history_3y.pkl", "history_1y.pkl"):
                fp = os.path.join(cache_dir, sd, fn)
                if os.path.exists(fp):
                    try:
                        with open(fp, "rb") as f:
                            prices = pickle.load(f)
                        break
                    except Exception:
                        pass

            if prices is None or prices.empty or len(prices) < 180:
                skipped += 1
                continue

            close = prices["Close"].astype(float).dropna()
            if len(close) < 180:
                skipped += 1
                continue

            symbol = sd.replace("_NS", ".NS")
            n      = len(close)

            # Simulate predictions at weekly intervals over the last 26 weeks (~6 months)
            # We "predict" using data up to T-horizon and check actual return over horizon
            for weeks_back in range(4, 27, 1):  # step 1 week; skip last 4 weeks (need future data)
                # Slice: use data up to T-weeks_back*7 trading days (approx)
                cutoff = n - weeks_back * 5  # ~5 trading days per week
                if cutoff < 100:
                    break
                hist_slice = prices.iloc[:cutoff]
                if hist_slice.empty or len(hist_slice) < 100:
                    continue

                try:
                    pred = predictor.predict_stock(symbol, prices=hist_slice)
                except Exception:
                    continue

                if not pred:
                    continue

                gate_passed = pred.get("gate_passed", False)
                gated_signal = pred.get("gated_signal", "NEUTRAL")
                if not gate_passed:
                    continue  # only evaluate high-conviction calls

                # Entry price at cutoff
                entry_price = float(close.iloc[cutoff - 1])

                # Actual 7-day exit
                exit_idx_7  = min(cutoff - 1 + 7, n - 1)
                exit_price_7 = float(close.iloc[exit_idx_7])
                ret_7d = (exit_price_7 - entry_price) / entry_price * 100 if entry_price > 0 else 0

                # Actual 30-day exit
                exit_idx_30 = min(cutoff - 1 + 22, n - 1)  # ~22 trading days
                exit_price_30 = float(close.iloc[exit_idx_30])
                ret_30d = (exit_price_30 - entry_price) / entry_price * 100 if entry_price > 0 else 0

                is_bull = gated_signal in ("STRONG_BUY", "BUY")
                is_bear = gated_signal in ("STRONG_SELL", "SELL")

                # Adjust return for signal direction
                dir_ret_7d  = ret_7d  if is_bull else (-ret_7d  if is_bear else 0)
                dir_ret_30d = ret_30d if is_bull else (-ret_30d if is_bear else 0)

                trade = {
                    "symbol":       symbol.replace(".NS", ""),
                    "gated_signal": gated_signal,
                    "entry_price":  round(entry_price, 2),
                    "ret_7d":       round(ret_7d, 2),
                    "ret_30d":      round(ret_30d, 2),
                    "dir_ret_7d":   round(dir_ret_7d, 2),
                    "dir_ret_30d":  round(dir_ret_30d, 2),
                    "win_7d":       dir_ret_7d > 0,
                    "win_30d":      dir_ret_30d > 0,
                    "confidence":   pred.get("confidence", 0),
                    "sector":       pred.get("accuracy", {}).get(7, {}).get("sector"),
                    "sector_model": pred.get("accuracy", {}).get(7, {}).get("sector_model", False),
                }
                buy_trades.append(trade)
                all_returns.append(dir_ret_30d)

            tested += 1

        _ML_BT_STATE["status"] = "aggregating"

        if not buy_trades:
            _ML_BT_STATE["result"] = {
                "error": "No gated BUY/SELL signals found — train cross-stock models first",
                "tested": tested, "skipped": skipped,
            }
            _ML_BT_STATE["running"] = False
            return

        ret_arr = _np.array(all_returns)

        def sharpe(returns):
            if len(returns) < 2 or _np.std(returns) == 0:
                return 0.0
            return round(float(_np.mean(returns) / _np.std(returns) * _math.sqrt(252)), 3)

        def max_dd(returns):
            equity = _np.cumprod(1 + _np.array(returns) / 100)
            roll_max = _np.maximum.accumulate(equity)
            dd = (equity - roll_max) / roll_max * 100
            return round(float(dd.min()), 2)

        def by_signal(signal_list, signal_type):
            trades = [t for t in signal_list if t["gated_signal"] == signal_type]
            if not trades:
                return None
            rets_30 = [t["dir_ret_30d"] for t in trades]
            rets_7  = [t["dir_ret_7d"]  for t in trades]
            return {
                "count": len(trades),
                "hit_rate_7d":  round(sum(1 for t in trades if t["win_7d"])  / len(trades) * 100, 1),
                "hit_rate_30d": round(sum(1 for t in trades if t["win_30d"]) / len(trades) * 100, 1),
                "avg_ret_7d":   round(float(_np.mean(rets_7)), 2),
                "avg_ret_30d":  round(float(_np.mean(rets_30)), 2),
                "sharpe_30d":   sharpe(rets_30),
            }

        # Overall stats
        wins_30 = [t for t in buy_trades if t["win_30d"]]
        result = {
            "total_trades":      len(buy_trades),
            "tested_stocks":     tested,
            "skipped_stocks":    skipped,
            "overall_hit_rate_30d": round(len(wins_30) / len(buy_trades) * 100, 1),
            "overall_avg_ret_30d":  round(float(_np.mean([t["dir_ret_30d"] for t in buy_trades])), 2),
            "sharpe_ratio_30d":  sharpe(ret_arr.tolist()),
            "max_drawdown_30d":  max_dd(ret_arr.tolist()),
            "by_signal": {
                sig: by_signal(buy_trades, sig)
                for sig in ("STRONG_BUY", "BUY", "STRONG_SELL", "SELL")
            },
            "top_wins":  sorted(buy_trades, key=lambda x: x["dir_ret_30d"], reverse=True)[:15],
            "top_losses": sorted(buy_trades, key=lambda x: x["dir_ret_30d"])[:15],
            "sector_model_trades": sum(1 for t in buy_trades if t["sector_model"]),
            "global_model_trades": sum(1 for t in buy_trades if not t["sector_model"]),
            "generated_at": datetime.now().isoformat(),
        }

        # Save
        ml_bt_path = os.path.join(config.DATA_DIR, "ml_backtest_results.json")
        with open(ml_bt_path, "w") as f:
            json.dump(result, f, indent=2, default=str)

        _ML_BT_STATE["result"]  = result
        _ML_BT_STATE["status"]  = "done"

    except Exception as e:
        _ML_BT_STATE["status"] = f"error: {e}"
    finally:
        _ML_BT_STATE["running"] = False


@app.route("/api/backtest/ml", methods=["GET"])
def get_ml_backtest():
    """Return cached ML gated-signal backtest results."""
    ml_bt_path = os.path.join(config.DATA_DIR, "ml_backtest_results.json")
    if os.path.exists(ml_bt_path):
        with open(ml_bt_path, "r") as f:
            return jsonify(json.load(f))
    if _ML_BT_STATE.get("result"):
        return jsonify(_ML_BT_STATE["result"])
    return jsonify({"error": "No ML backtest results. POST /api/backtest/ml/scan to run."}), 404


@app.route("/api/backtest/ml/scan", methods=["POST"])
def run_ml_backtest():
    if _ML_BT_STATE["running"]:
        return jsonify({"error": "ML backtest already running"}), 409
    t = threading.Thread(target=_run_ml_backtest, daemon=True)
    t.start()
    return jsonify({"message": "ML backtest started"})


@app.route("/api/backtest/ml/status", methods=["GET"])
def ml_backtest_status():
    return jsonify({
        "running": _ML_BT_STATE["running"],
        "status":  _ML_BT_STATE["status"],
    })


# ═══════════════════════════════════════════════════════════════════════
# AI INSIGHTS — InvestingPro-style analysis
# ═══════════════════════════════════════════════════════════════════════


def _health_pillar(val, low_bad=True, lo=0, hi=100):
    """Convert a metric to a 1-5 health rating.
    low_bad=True  → higher val = better (e.g. ROE)
    low_bad=False → lower val  = better (e.g. D/E, P/E)
    """
    if val is None:
        return 3  # neutral default
    v = _safe_float(val, 0)
    if low_bad:
        pct = max(0, min(1, (v - lo) / (hi - lo))) if hi != lo else 0.5
    else:
        pct = max(0, min(1, 1 - (v - lo) / (hi - lo))) if hi != lo else 0.5
    return round(1 + pct * 4, 1)  # 1.0 – 5.0


def _compute_financial_health(row):
    """Compute InvestingPro-style 5-pillar Financial Health Score (1-5)."""
    # Pillar 1: Profitability Health
    prof = _safe_float(row.get("fund_profitability"), 50)
    roe = _safe_float(row.get("roe"), 10)
    profitability = round((_health_pillar(prof, True, 0, 100) * 0.6 +
                           _health_pillar(roe, True, 0, 30) * 0.4), 1)

    # Pillar 2: Growth Health
    growth_score = _safe_float(row.get("fund_growth"), 50)
    growth = _health_pillar(growth_score, True, 0, 100)

    # Pillar 3: Cash Flow Health
    fin_health = _safe_float(row.get("fund_financial_health"), 50)
    de = _safe_float(row.get("debt_to_equity"), 1)
    cash_flow = round((_health_pillar(fin_health, True, 0, 100) * 0.6 +
                        _health_pillar(de, False, 0, 3) * 0.4), 1)

    # Pillar 4: Relative Value
    val_score = _safe_float(row.get("fund_valuation"), 50)
    pe = _safe_float(row.get("pe_ratio"), 25)
    relative_value = round((_health_pillar(val_score, True, 0, 100) * 0.6 +
                             _health_pillar(pe, False, 0, 60) * 0.4), 1)

    # Pillar 5: Price Momentum
    momentum = _safe_float(row.get("tech_momentum"), 50)
    trend = _safe_float(row.get("tech_trend"), 50)
    rel_str = _safe_float(row.get("tech_relative_strength"), 50)
    price_momentum = round((_health_pillar(momentum, True, 0, 100) * 0.4 +
                             _health_pillar(trend, True, 0, 100) * 0.3 +
                             _health_pillar(rel_str, True, 0, 100) * 0.3), 1)

    # Overall = weighted average
    overall = round((profitability * 0.25 + growth * 0.20 + cash_flow * 0.20 +
                     relative_value * 0.15 + price_momentum * 0.20), 1)

    return {
        "overall": overall,
        "profitability": profitability,
        "growth": growth,
        "cashFlow": cash_flow,
        "relativeValue": relative_value,
        "priceMomentum": price_momentum,
    }


def _generate_pro_tips(row, health):
    """Generate InvestingPro-style bullish/bearish ProTips."""
    tips = []
    roe = _safe_float(row.get("roe"), 0)
    de = _safe_float(row.get("debt_to_equity"), 99)
    pe = _safe_float(row.get("pe_ratio"), 0)
    cs = _safe_float(row.get("composite_score"), 0)
    fs = _safe_float(row.get("fundamental_score"), 0)
    ts = _safe_float(row.get("technical_score"), 0)
    prof = _safe_float(row.get("fund_profitability"), 0)
    growth = _safe_float(row.get("fund_growth"), 0)
    momentum = _safe_float(row.get("tech_momentum"), 0)
    trend = _safe_float(row.get("tech_trend"), 0)
    rel_str = _safe_float(row.get("tech_relative_strength"), 0)
    vol = _safe_float(row.get("tech_volume"), 0)
    dividend = _safe_float(row.get("fund_dividend"), 0)
    flag = (row.get("red_flag_status") or "").upper()

    # Bullish tips
    if roe > 20:
        tips.append({"type": "bull", "text": f"High Return on Equity of {roe:.1f}% indicates efficient capital deployment"})
    elif roe > 15:
        tips.append({"type": "bull", "text": f"Healthy ROE of {roe:.1f}% — above industry average"})
    if de < 0.3:
        tips.append({"type": "bull", "text": "Nearly debt-free balance sheet provides financial flexibility"})
    elif de < 0.8:
        tips.append({"type": "bull", "text": f"Low debt-to-equity of {de:.2f} — conservative leverage"})
    if growth > 70:
        tips.append({"type": "bull", "text": "Strong revenue and earnings growth trajectory"})
    elif growth > 55:
        tips.append({"type": "bull", "text": "Above-average growth profile — earnings accelerating"})
    if prof > 70:
        tips.append({"type": "bull", "text": "High profitability margins significantly above sector peers"})
    if momentum > 70:
        tips.append({"type": "bull", "text": "Strong price momentum — RSI and MACD aligned bullish"})
    if trend > 70:
        tips.append({"type": "bull", "text": "Trading above all key moving averages (EMA 20/50/200)"})
    if rel_str > 65:
        tips.append({"type": "bull", "text": "Outperforming NIFTY50 benchmark — relative strength positive"})
    if cs > 65:
        tips.append({"type": "bull", "text": f"Top-tier composite score ({cs:.1f}/100) — screener ranks it highly"})
    if flag == "PASS":
        tips.append({"type": "bull", "text": "Clean fundamentals — passed all red flag checks"})
    if pe > 0 and pe < 15:
        tips.append({"type": "bull", "text": f"Attractively valued at P/E {pe:.1f} — potential undervaluation"})
    if dividend > 60:
        tips.append({"type": "bull", "text": "Consistent dividend payer with healthy payout ratio"})
    if vol > 65:
        tips.append({"type": "bull", "text": "Strong volume accumulation — institutional buying interest"})

    # Bearish tips
    if roe < 8 and roe > 0:
        tips.append({"type": "bear", "text": f"Low ROE of {roe:.1f}% — subpar capital efficiency"})
    if de > 2:
        tips.append({"type": "bear", "text": f"High debt-to-equity of {de:.2f} — elevated financial risk"})
    elif de > 1.2:
        tips.append({"type": "bear", "text": f"Above-average leverage (D/E {de:.2f}) — monitor debt servicing"})
    if growth < 30:
        tips.append({"type": "bear", "text": "Weak growth metrics — revenue or earnings declining"})
    if pe > 50:
        tips.append({"type": "bear", "text": f"Expensive valuation at P/E {pe:.1f} — limited margin of safety"})
    elif pe > 35:
        tips.append({"type": "bear", "text": f"P/E of {pe:.1f} trades at premium to sector average"})
    if momentum < 30:
        tips.append({"type": "bear", "text": "Weak price momentum — bearish technical indicators"})
    if trend < 30:
        tips.append({"type": "bear", "text": "Trading below key moving averages — downtrend in progress"})
    if rel_str < 30:
        tips.append({"type": "bear", "text": "Underperforming NIFTY50 benchmark — negative relative strength"})
    if flag and flag not in ("PASS", ""):
        reasons = row.get("red_flag_reasons", "")
        tips.append({"type": "bear", "text": f"Red flags detected: {reasons}" if reasons else "Red flags detected — exercise caution"})
    if prof < 30:
        tips.append({"type": "bear", "text": "Low profitability margins — weaker pricing power"})

    # Sort: bulls first, then bears
    tips.sort(key=lambda t: (0 if t["type"] == "bull" else 1))
    return tips


def _compute_ai_verdict(health_overall, cs, fs, ts, flag):
    """AI verdict: Strong Buy / Buy / Hold / Sell / Strong Sell."""
    score = (health_overall / 5) * 40 + cs * 0.35 + fs * 0.15 + ts * 0.10
    penalty = 0 if flag in ("PASS", "") else 15
    score -= penalty
    if score >= 55:
        return "Strong Buy"
    elif score >= 42:
        return "Buy"
    elif score >= 30:
        return "Hold"
    elif score >= 20:
        return "Sell"
    else:
        return "Strong Sell"


def _build_ai_picks():
    """Build curated AI strategy picks (ProPicks-style)."""
    composite = load_csv("composite_ranked.csv")
    if not composite:
        return {"error": "No composite data"}

    # Load intrinsic20 for fair value data if available
    intrinsic = load_csv("intrinsic20_all.csv")
    iv_map = {}
    if intrinsic:
        for r in intrinsic:
            sym = (r.get("symbol") or "").strip()
            if sym:
                iv_map[sym] = r

    # Index universe
    index_syms = set()
    for idx_key in ("midcap150", "largemidcap250", "smallcap250"):
        for s in config.PORTFOLIOS.get(idx_key, {}).get("stocks", []):
            index_syms.add(s.strip().upper() + ".NS")

    stocks = []
    for row in composite:
        sym = (row.get("symbol") or "").strip()
        if not sym or sym not in index_syms:
            continue
        flag = (row.get("red_flag_status") or "").upper()
        if flag and flag not in ("PASS", ""):
            continue
        health = _compute_financial_health(row)
        cs = _safe_float(row.get("composite_score"), 0)
        fs = _safe_float(row.get("fundamental_score"), 0)
        ts = _safe_float(row.get("technical_score"), 0)
        verdict = _compute_ai_verdict(health["overall"], cs, fs, ts, flag)
        iv = iv_map.get(sym, {})

        entry = {
            "symbol": sym,
            "name": row.get("name", ""),
            "sector": row.get("sector", ""),
            "industry": row.get("industry", ""),
            "compositeScore": cs,
            "fundamentalScore": fs,
            "technicalScore": ts,
            "healthOverall": health["overall"],
            "healthPillars": health,
            "verdict": verdict,
            "roe": _safe_float(row.get("roe")),
            "pe": _safe_float(row.get("pe_ratio")),
            "de": _safe_float(row.get("debt_to_equity")),
            "growth": _safe_float(row.get("fund_growth")),
            "momentum": _safe_float(row.get("tech_momentum")),
            "profitability": _safe_float(row.get("fund_profitability")),
            "relativeStrength": _safe_float(row.get("tech_relative_strength")),
            "fairValue": _safe_float(iv.get("intrinsicValue")),
            "cmp": _safe_float(iv.get("cmp")),
            "upside": _safe_float(iv.get("upside")),
            "mosZone": iv.get("mosZone", ""),
        }
        stocks.append(entry)

    # Strategy 1: Market Outperformers (top composite, high health)
    outperformers = sorted(stocks, key=lambda s: s["compositeScore"] + s["healthOverall"] * 10, reverse=True)[:15]

    # Strategy 2: Bharat Bargains (undervalued — high fundamental, low P/E, fair value upside)
    bargains = [s for s in stocks if s["pe"] > 0 and s["pe"] < 25 and s["fundamentalScore"] > 50]
    bargains.sort(key=lambda s: s.get("upside") or s["fundamentalScore"], reverse=True)
    bargains = bargains[:15]

    # Strategy 3: Mid-Cap Movers (highest growth + momentum)
    movers = sorted(stocks, key=lambda s: s["growth"] * 0.5 + s["momentum"] * 0.5, reverse=True)[:15]

    # Strategy 4: Quality Compounders (high ROE, low debt, consistent profitability)
    compounders = [s for s in stocks if s["roe"] > 12 and s["de"] < 1.5 and s["profitability"] > 50]
    compounders.sort(key=lambda s: s["roe"] + s["profitability"] * 0.5, reverse=True)
    compounders = compounders[:15]

    # Strategy 5: Momentum Stars (top technical + relative strength)
    momentum_stars = sorted(stocks, key=lambda s: s["momentum"] * 0.4 + s["relativeStrength"] * 0.4 + s["technicalScore"] * 0.2, reverse=True)[:15]

    strategies = [
        {
            "id": "outperformers",
            "name": "Market Outperformers",
            "description": "Top-ranked stocks with the highest composite scores and financial health — AI's most confident picks for consistent outperformance.",
            "color": "#3b82f6",
            "icon": "crown",
            "stocks": outperformers,
        },
        {
            "id": "bargains",
            "name": "Bharat Bargains",
            "description": "Undervalued Indian stocks with strong fundamentals trading below their intrinsic worth — deep value opportunities.",
            "color": "#22c55e",
            "icon": "tag",
            "stocks": bargains,
        },
        {
            "id": "movers",
            "name": "Mid-Cap Movers",
            "description": "High-growth mid-cap companies with accelerating earnings momentum and scalable business models.",
            "color": "#f59e0b",
            "icon": "rocket",
            "stocks": movers,
        },
        {
            "id": "compounders",
            "name": "Quality Compounders",
            "description": "High ROE, low debt stocks with consistent profitability — built for long-term wealth compounding.",
            "color": "#a78bfa",
            "icon": "shield",
            "stocks": compounders,
        },
        {
            "id": "momentum",
            "name": "Momentum Stars",
            "description": "Stocks with the strongest price momentum, relative strength, and technical breakout signals.",
            "color": "#ef4444",
            "icon": "bolt",
            "stocks": momentum_stars,
        },
    ]

    return {"strategies": strategies, "totalAnalyzed": len(stocks)}


def _resolve_symbol(symbol):
    """Try symbol as-is, then with .NS suffix, both upper-cased."""
    s = symbol.strip().upper()
    candidates = [s, s + ".NS"]
    if s.endswith(".NS"):
        candidates = [s, s[:-3]]
    return candidates


def _find_in_csv(rows, symbol):
    """Case-insensitive, .NS-flexible row lookup."""
    candidates = set(_resolve_symbol(symbol))
    for r in (rows or []):
        if (r.get("symbol") or "").strip().upper() in candidates:
            return r
    return None


def _llm_conviction(symbol, name, sector, fs, ts, cs, health, technicals, metrics):
    """
    Gap 7: Ask Claude to rate conviction 1-10 based on quant data.
    Returns {conviction, reason, risk, catalyst} or None if API key not set.
    Cached per symbol for 6 hours.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return None
    cache_key = f"llm_conviction_{symbol}"
    cached = _AI_MF_CACHE.get(cache_key)
    if cached and (time.time() - cached.get("ts", 0)) < 21600:
        return cached.get("data")
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        prompt = f"""You are an expert Indian stock analyst. Based ONLY on the quantitative data below, rate conviction 1-10 and explain briefly.

Stock: {symbol} ({name}) | Sector: {sector}
Fundamental Score: {fs}/100 | Technical Score: {ts}/100 | Composite: {cs}/100
Health: {health}/10 | ROE: {metrics.get('roe')}% | P/E: {metrics.get('pe')} | D/E: {metrics.get('de')}
Profitability: {metrics.get('profitability')}/100 | Growth: {metrics.get('growth')}/100 | Valuation: {metrics.get('valuation')}/100
RSI: {technicals.get('rsi')} | ADX: {technicals.get('adx')} | Direction: {technicals.get('direction')} | Supertrend: {technicals.get('supertrend_signal')}

Reply ONLY as JSON: {{"conviction": <1-10>, "reason": "<20 words max>", "risk": "<15 words max>", "catalyst": "<15 words max>"}}"""
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=120,
            messages=[{"role": "user", "content": prompt}],
        )
        import json as _json
        text = msg.content[0].text.strip()
        start = text.find("{")
        end   = text.rfind("}") + 1
        data  = _json.loads(text[start:end]) if start >= 0 else {}
        data  = {
            "conviction": int(data.get("conviction", 5)),
            "reason":     str(data.get("reason", "")),
            "risk":       str(data.get("risk", "")),
            "catalyst":   str(data.get("catalyst", "")),
        }
        _AI_MF_CACHE[cache_key] = {"data": data, "ts": time.time()}
        return data
    except Exception:
        return None


def _build_live_row(symbol):
    """
    Fetch live fundamental + price data from yfinance for any stock.
    Builds a synthetic composite row compatible with ai_insights().
    Returns dict or None on failure.
    """
    try:
        import yfinance as yf
        from modules.price_predictor import PricePredictor

        # Try with .NS suffix for NSE, then bare symbol
        ns_sym = symbol if symbol.endswith(".NS") else f"{symbol}.NS"
        ticker = yf.Ticker(ns_sym)
        info   = ticker.info or {}

        # If yfinance returns mostly empty info, try bare symbol
        if not info.get("regularMarketPrice") and not info.get("currentPrice"):
            ticker = yf.Ticker(symbol)
            info   = ticker.info or {}

        name     = info.get("longName") or info.get("shortName") or symbol
        sector   = info.get("sector", "")
        industry = info.get("industry", "")
        cmp      = _safe_float(info.get("currentPrice") or info.get("regularMarketPrice"))
        roe      = _safe_float(info.get("returnOnEquity"))       # decimal (e.g. 0.18 = 18%)
        pe       = _safe_float(info.get("trailingPE"))
        de       = _safe_float(info.get("debtToEquity"))         # sometimes in %
        rev_gr   = _safe_float(info.get("revenueGrowth"))        # decimal
        earn_gr  = _safe_float(info.get("earningsGrowth"))       # decimal
        div_yld  = _safe_float(info.get("dividendYield"))        # decimal
        mkt_cap  = _safe_float(info.get("marketCap"))

        if not name and not cmp:
            return None

        # ── Estimate sub-scores from raw metrics ────────────────────────
        # These are rough heuristics since we haven't run the full pipeline
        roe_pct = (roe or 0) * 100  # convert to %
        prof_score  = min(100, max(0, 40 + roe_pct * 2))            # ROE-based profitability
        growth_score = min(100, max(0, 50 + (earn_gr or 0) * 200))  # earnings growth
        de_norm = (de or 0) / 100 if (de or 0) > 5 else (de or 0)  # normalise D/E
        health_score = min(100, max(0, 70 - de_norm * 30))
        pe_ok  = pe and 5 < pe < 80
        val_score = min(100, max(0, 55 - (pe or 25) * 0.5)) if pe_ok else 50
        div_score = min(100, (div_yld or 0) * 1000)                  # 3% yield → 30 pts

        fs_est = round(
            prof_score * 0.25 + growth_score * 0.25 + val_score * 0.20 +
            health_score * 0.20 + div_score * 0.10, 1
        )

        # ── Price predictions via PricePredictor ────────────────────────
        predictor = PricePredictor()
        hist = ticker.history(period="1y", auto_adjust=True)
        pred_result = None
        if hist is not None and not hist.empty and len(hist) >= 50:
            pred_result = predictor.predict_stock(ns_sym, prices=hist)

        tech_score = 0.0
        if pred_result:
            ds = pred_result.get("direction_score", 50)
            tech_score = round(ds, 1)

        cs_est = round(fs_est * 0.8 + tech_score * 0.2, 1)

        row = {
            "symbol":              symbol,
            "name":                name,
            "sector":              sector,
            "industry":            industry,
            "composite_score":     cs_est,
            "fundamental_score":   fs_est,
            "technical_score":     tech_score,
            "composite_rank":      "",
            "red_flag_status":     "PASS",
            "red_flag_reasons":    "",
            "roe":                 roe,
            "pe_ratio":            pe,
            "debt_to_equity":      de_norm,
            "fund_profitability":  round(prof_score, 1),
            "fund_growth":         round(growth_score, 1),
            "fund_valuation":      round(val_score, 1),
            "fund_financial_health": round(health_score, 1),
            "fund_dividend":       round(div_score, 1),
            "tech_trend":          tech_score,
            "tech_momentum":       tech_score,
            "tech_volume":         50,
            "tech_relative_strength": 50,
            "last_price":          cmp,
            "market_cap":          mkt_cap,
            "_live":               True,       # flag so frontend knows this is live-fetched
            "_pred":               pred_result,  # carry predictions through
        }
        return row
    except Exception:
        return None


@app.route("/api/ai-insights/<symbol>", methods=["GET"])
def ai_insights(symbol):
    """AI analysis for a single stock — searches composite + all index prediction CSVs."""

    # ── 1. Composite data (fundamentals + scores) ─────────────────────────
    composite = load_csv("composite_ranked.csv")
    row = _find_in_csv(composite, symbol)

    # ── 2. Prediction data (technicals + price targets) ───────────────────
    pred_row = None
    for csv_name in ("midcap150_predictions.csv", "largemidcap250_predictions.csv",
                     "smallcap250_predictions.csv"):
        pred_row = _find_in_csv(load_csv(csv_name), symbol)
        if pred_row:
            break

    # ── 3. Fall back: use prediction data as primary if composite missing ──
    if not row and pred_row:
        # Build a synthetic composite row from prediction data
        row = {
            "symbol":              pred_row.get("symbol", symbol),
            "name":                pred_row.get("name", ""),
            "sector":              pred_row.get("sector", ""),
            "industry":            pred_row.get("industry", ""),
            "composite_score":     pred_row.get("composite_score", 0),
            "fundamental_score":   pred_row.get("fundamental_score", 0),
            "technical_score":     pred_row.get("technical_score", 0),
            "composite_rank":      pred_row.get("composite_rank", ""),
            "red_flag_status":     "PASS",
            "red_flag_reasons":    "",
            # Carry fundamental sub-scores from prediction CSV if present
            "fund_profitability":  pred_row.get("fund_profitability", 50),
            "fund_growth":         pred_row.get("fund_growth", 50),
            "fund_valuation":      pred_row.get("fund_valuation", 50),
            "fund_financial_health": pred_row.get("fund_financial_health", 50),
            "fund_dividend":       pred_row.get("fund_dividend", 50),
            "roe":                 pred_row.get("roe", 0),
            "pe_ratio":            pred_row.get("pe_ratio", 0),
            "debt_to_equity":      pred_row.get("debt_to_equity", 0),
            "tech_trend":          pred_row.get("tech_trend", 50),
            "tech_momentum":       pred_row.get("tech_momentum", 50),
            "tech_volume":         pred_row.get("tech_volume", 50),
            "tech_relative_strength": pred_row.get("tech_relative_strength", 50),
        }

    if not row:
        # ── Live fetch fallback ──────────────────────────────────────────────
        # When ?live=1 is passed (or this is a manual analyze request),
        # download data directly from yfinance instead of requiring pipeline CSVs.
        live = request.args.get("live", "0") in ("1", "true", "yes")
        if live:
            row = _build_live_row(symbol)
            if not row:
                return jsonify({"error": f"Could not fetch live data for '{symbol}'. "
                                         "Check the symbol (use NSE format, e.g. TATAPOWER)."}), 404
        else:
            return jsonify({
                "error": f"Stock '{symbol}' not found in pipeline data.",
                "not_in_pipeline": True,
                "hint": "Click 'Analyze Live' to fetch data directly from NSE/yfinance.",
            }), 404

    # ── 4. Compute scores & verdict ───────────────────────────────────────
    health = _compute_financial_health(row)
    cs     = _safe_float(row.get("composite_score"), 0)
    fs     = _safe_float(row.get("fundamental_score"), 0)
    ts     = _safe_float(row.get("technical_score"), 0)
    flag   = (row.get("red_flag_status") or "").upper()
    verdict = _compute_ai_verdict(health["overall"], cs, fs, ts, flag)
    tips    = _generate_pro_tips(row, health)

    # ── 5. Fair value from intrinsic20 ────────────────────────────────────
    iv_data = _find_in_csv(load_csv("intrinsic20_all.csv"), symbol)
    fair_value = None
    if iv_data:
        fair_value = {
            "intrinsicValue": _safe_float(iv_data.get("intrinsicValue")),
            "cmp":            _safe_float(iv_data.get("cmp")),
            "upside":         _safe_float(iv_data.get("upside")),
            "mosZone":        iv_data.get("mosZone", ""),
            "verdict":        iv_data.get("verdict", ""),
            "dcfPerShare":    _safe_float(iv_data.get("dcfPerShare")),
            "relativeValue":  _safe_float(iv_data.get("relativeValue")),
        }

    # ── 6. Build technicals from prediction data ──────────────────────────
    # For live-fetched stocks, use the PricePredictor result stored in row['_pred']
    if not pred_row and row.get("_pred"):
        pred_row = row["_pred"]  # PricePredictor dict maps directly to the same keys

    technicals = {}
    if pred_row:
        def _pf(k): return _safe_float(pred_row.get(k)) or None
        cmp_p = _pf("cmp") or _pf("last_price")
        vwap  = _pf("vwap")
        st    = _pf("supertrend")
        technicals = {
            "cmp":              cmp_p,
            "target_1d":        _pf("target_1d"),
            "target_1d_low":    _pf("target_1d_low"),
            "target_1d_high":   _pf("target_1d_high"),
            "upside_1d_pct":    _pf("upside_1d_pct"),
            "target_7d":        _pf("target_7d"),
            "target_30d":       _pf("target_30d"),
            "target_90d":       _pf("target_90d"),
            "target_7d_low":    _pf("target_7d_low"),
            "target_7d_high":   _pf("target_7d_high"),
            "target_30d_low":   _pf("target_30d_low"),
            "target_30d_high":  _pf("target_30d_high"),
            "upside_7d_pct":    _pf("upside_7d_pct"),
            "upside_30d_pct":   _pf("upside_30d_pct"),
            "upside_90d_pct":   _pf("upside_90d_pct"),
            "direction":        pred_row.get("direction", ""),
            "ema_trend":        pred_row.get("ema_trend", ""),
            "macd_trend":       pred_row.get("macd_trend", ""),
            "rsi":              _pf("rsi"),
            "adx":              _pf("adx"),
            "volatility_ann":   _pf("volatility_ann"),
            "support":          _pf("support"),
            "resistance":       _pf("resistance"),
            "vwap":             vwap,
            "supertrend":       st,
            "supertrend_signal": pred_row.get("supertrend_signal", ""),
            "confidence":       _pf("confidence"),
            "direction_score":  _pf("direction_score"),
            "trend_strength":   _pf("trend_strength"),
            "aboveVwap":        (cmp_p is not None and vwap is not None and cmp_p > vwap),
            "supertrendBuy":    pred_row.get("supertrend_signal", "").upper() == "BUY",
            "macdBullish":      "BULL" in (pred_row.get("macd_trend") or "").upper(),
        }
        # Use pred CMP as primary CMP if composite doesn't have it
        if not fair_value and cmp_p:
            fair_value = {
                "intrinsicValue": None,
                "cmp": cmp_p,
                "upside": None,
                "mosZone": "",
                "verdict": "",
                "dcfPerShare": None,
                "relativeValue": None,
            }

    # ── 7. LLM conviction (Gap 7) ─────────────────────────────────────────
    metrics_for_llm = {
        "roe": _safe_float(row.get("roe")), "pe": _safe_float(row.get("pe_ratio")),
        "de": _safe_float(row.get("debt_to_equity")),
        "profitability": _safe_float(row.get("fund_profitability")),
        "growth": _safe_float(row.get("fund_growth")),
        "valuation": _safe_float(row.get("fund_valuation")),
    }
    llm_conviction = _llm_conviction(
        symbol=row.get("symbol", symbol),
        name=row.get("name", ""),
        sector=row.get("sector", ""),
        fs=fs, ts=ts, cs=cs,
        health=health.get("overall", 0) if isinstance(health, dict) else health,
        technicals=technicals,
        metrics=metrics_for_llm,
    )

    result = {
        "symbol":         row.get("symbol", ""),
        "name":           row.get("name", ""),
        "sector":         row.get("sector", ""),
        "industry":       row.get("industry", ""),
        "cmp":            technicals.get("cmp") or _safe_float(row.get("last_price")) or None,
        "liveData":       bool(row.get("_live")),   # true when fetched live from yfinance
        "compositeScore": cs,
        "fundamentalScore": fs,
        "technicalScore": ts,
        "compositeRank":  _safe_float(row.get("composite_rank")),
        "healthScore":    health,
        "verdict":        verdict,
        "proTips":        tips,
        "fairValue":      fair_value,
        "technicals":     technicals,
        "llmConviction":  llm_conviction,
        "metrics": {
            "roe":            _safe_float(row.get("roe")),
            "pe":             _safe_float(row.get("pe_ratio")),
            "de":             _safe_float(row.get("debt_to_equity")),
            "profitability":  _safe_float(row.get("fund_profitability")),
            "growth":         _safe_float(row.get("fund_growth")),
            "valuation":      _safe_float(row.get("fund_valuation")),
            "financialHealth": _safe_float(row.get("fund_financial_health")),
            "dividend":       _safe_float(row.get("fund_dividend")),
            "trend":          _safe_float(row.get("tech_trend")),
            "momentum":       _safe_float(row.get("tech_momentum")),
            "volume":         _safe_float(row.get("tech_volume")),
            "relativeStrength": _safe_float(row.get("tech_relative_strength")),
            # Also expose raw technicals for skills.md display
            "rsi":            technicals.get("rsi"),
            "adx":            technicals.get("adx"),
            "vwap":           technicals.get("vwap"),
            "supertrendSignal": technicals.get("supertrend_signal"),
            "direction":      technicals.get("direction"),
            "confidence":     technicals.get("confidence"),
        },
        "redFlag": {
            "status":  row.get("red_flag_status", ""),
            "reasons": row.get("red_flag_reasons", ""),
        },
    }
    return jsonify(result)


@app.route("/api/ai-index-stocks", methods=["GET"])
def ai_index_stocks():
    """
    Returns top stocks from each index prediction CSV + combined top 20.
    ?index=midcap150|largemidcap250|smallcap250|all  (default: all)
    ?limit=20
    """
    index_param = request.args.get("index", "all").lower()
    limit = int(request.args.get("limit", 20))

    INDEX_MAP = {
        "midcap150":      "midcap150_predictions.csv",
        "largemidcap250": "largemidcap250_predictions.csv",
        "smallcap250":    "smallcap250_predictions.csv",
    }

    def _row_to_card(r, source):
        cs = _safe_float(r.get("composite_score"), 0)
        fs = _safe_float(r.get("fundamental_score"), 0)
        ts = _safe_float(r.get("technical_score"), 0)
        direction = (r.get("direction") or "").upper()
        return {
            "symbol":          (r.get("symbol") or "").replace(".NS", ""),
            "name":            r.get("name", ""),
            "sector":          r.get("sector", ""),
            "cmp":             _safe_float(r.get("cmp")) or None,
            "upside_30d_pct":  _safe_float(r.get("upside_30d_pct")) or None,
            "direction":       direction,
            "ema_trend":       r.get("ema_trend", ""),
            "rsi":             _safe_float(r.get("rsi")) or None,
            "confidence":      _safe_float(r.get("confidence")) or None,
            "composite_score": round(cs, 1),
            "fundamental_score": round(fs, 1),
            "technical_score": round(ts, 1),
            "supertrend_signal": r.get("supertrend_signal", ""),
            "source":          source,
        }

    if index_param == "all":
        # Combine all three, deduplicate, sort by composite_score desc
        seen = set()
        combined = []
        for key, csv_name in INDEX_MAP.items():
            rows = load_csv(csv_name) or []
            for r in rows:
                sym = (r.get("symbol") or "").strip()
                if sym and sym not in seen:
                    seen.add(sym)
                    combined.append(_row_to_card(r, key))
        combined.sort(key=lambda x: x["composite_score"] or 0, reverse=True)
        return jsonify({"index": "all", "stocks": combined[:limit], "total": len(combined)})

    csv_name = INDEX_MAP.get(index_param)
    if not csv_name:
        return jsonify({"error": f"Unknown index '{index_param}'"}), 400

    rows = load_csv(csv_name) or []
    cards = [_row_to_card(r, index_param) for r in rows if r.get("symbol")]
    cards.sort(key=lambda x: x["composite_score"] or 0, reverse=True)
    return jsonify({"index": index_param, "stocks": cards[:limit], "total": len(cards)})


@app.route("/api/ai-picks", methods=["GET"])
def ai_picks():
    """ProPicks-style curated AI strategy portfolios."""
    result = _build_ai_picks()
    if "error" in result:
        return jsonify(result), 404
    return jsonify(result)


# ─────────── AI Returns — Predictive AI to Real Market Returns ───────────


def _build_ai_returns():
    """
    Algorithm: Convert AI predictions + quality scores into a trackable model
    portfolio and measure actual market returns over time.

    Expected Alpha Score per stock =
      prediction_upside (30d) * 0.30       → ML price prediction signal
    + composite_score * 0.25               → overall quality rank
    + health_score * 0.15                  → financial health (1-5 → 0-100)
    + momentum * 0.15                      → technical momentum
    + fundamental_score * 0.15             → fundamental strength
    - risk_penalty                         → volatility + red flag adjustment

    Output: Top 20 stocks as the AI Model Portfolio.
    """
    from datetime import datetime

    composite = load_csv("composite_ranked.csv")
    if not composite:
        return {"error": "No composite data — run the screener pipeline first"}

    # Build composite lookup
    comp_map = {}
    for row in composite:
        sym = (row.get("symbol") or "").strip()
        if sym:
            comp_map[sym] = row

    # Load prediction data from all 3 index universes
    pred_map = {}
    for csv_name in ("midcap150_predictions.csv", "largemidcap250_predictions.csv", "smallcap250_predictions.csv"):
        preds = load_csv(csv_name)
        if preds:
            for p in preds:
                sym = (p.get("symbol") or "").strip()
                if sym and sym not in pred_map:
                    pred_map[sym] = p

    # Load intrinsic data for fair value upside
    intrinsic = load_csv("intrinsic20_all.csv")
    iv_map = {}
    if intrinsic:
        for r in intrinsic:
            sym = (r.get("symbol") or "").strip()
            if sym:
                iv_map[sym] = r

    # Index universe
    index_syms = set()
    for idx_key in ("midcap150", "largemidcap250", "smallcap250"):
        for s in config.PORTFOLIOS.get(idx_key, {}).get("stocks", []):
            index_syms.add(s.strip().upper() + ".NS")

    # Score every stock that has both composite + prediction data
    scored = []
    for sym in index_syms:
        row = comp_map.get(sym)
        pred = pred_map.get(sym)
        if not row:
            continue

        flag = (row.get("red_flag_status") or "").upper()
        if flag and flag not in ("PASS", ""):
            continue

        cs = _safe_float(row.get("composite_score"), 0)
        fs = _safe_float(row.get("fundamental_score"), 0)
        ts = _safe_float(row.get("technical_score"), 0)
        momentum = _safe_float(row.get("tech_momentum"), 0)
        rel_str = _safe_float(row.get("tech_relative_strength"), 0)
        trend = _safe_float(row.get("tech_trend"), 0)
        volatility = _safe_float(pred.get("volatility_ann"), 40) if pred else 40
        health = _compute_financial_health(row)
        health_score = health["overall"]  # 1-5

        # Prediction upside (30d target vs CMP)
        pred_upside = 0
        cmp = 0
        target_30d = 0
        confidence = 0
        direction = ""
        if pred:
            cmp = _safe_float(pred.get("cmp"), 0)
            target_30d = _safe_float(pred.get("target_30d"), 0)
            pred_upside = _safe_float(pred.get("upside_30d_pct"), 0)
            confidence = _safe_float(pred.get("confidence"), 50)
            direction = (pred.get("direction") or "").upper()

        # Fair value upside bonus
        iv_upside = _safe_float(iv_map.get(sym, {}).get("upside"), 0)

        # ── Expected Alpha Score ──
        # Normalize prediction upside: cap at ±50% → scale to 0-100
        pred_signal = max(0, min(100, (pred_upside + 50)))  # -50%→0, 0%→50, +50%→100
        health_norm = (health_score / 5) * 100  # 1-5 → 20-100
        iv_bonus = max(0, min(20, iv_upside * 0.2))  # up to 20 bonus from fair value upside

        # Risk penalty: high volatility or low confidence
        risk_penalty = 0
        if volatility > 60:
            risk_penalty += (volatility - 60) * 0.15
        if confidence < 40:
            risk_penalty += (40 - confidence) * 0.1
        if direction == "BEARISH":
            risk_penalty += 10

        alpha_score = (
            pred_signal * 0.30
            + cs * 0.25
            + health_norm * 0.15
            + momentum * 0.15
            + fs * 0.15
            + iv_bonus
            - risk_penalty
        )

        scored.append({
            "symbol": sym,
            "name": row.get("name", ""),
            "sector": row.get("sector", ""),
            "industry": row.get("industry", ""),
            "alphaScore": round(alpha_score, 2),
            "predUpside30d": round(pred_upside, 2),
            "compositeScore": round(cs, 1),
            "fundamentalScore": round(fs, 1),
            "technicalScore": round(ts, 1),
            "healthScore": round(health_score, 2),
            "momentum": round(momentum, 1),
            "relativeStrength": round(rel_str, 1),
            "roe": round(_safe_float(row.get("roe")), 1),
            "pe": round(_safe_float(row.get("pe_ratio")), 1),
            "de": round(_safe_float(row.get("debt_to_equity")), 2),
            "volatility": round(volatility, 1),
            "confidence": round(confidence, 0),
            "direction": direction,
            "cmp": round(cmp, 2) if cmp else None,
            "target30d": round(target_30d, 2) if target_30d else None,
            "fairValueUpside": round(iv_upside, 1),
            "verdict": _compute_ai_verdict(health_score, cs, fs, ts, flag),
        })

    # Sort by alpha score, take top 20
    scored.sort(key=lambda s: s["alphaScore"], reverse=True)
    portfolio = scored[:20]

    return {
        "portfolio": portfolio,
        "totalScored": len(scored),
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M"),
    }


def _load_snapshots():
    """Load all historical AI portfolio snapshots."""
    rows = load_csv("ai_returns_snapshots.csv")
    if not rows:
        return []
    # Group by snapshot_date
    snapshots = {}
    for r in rows:
        date = r.get("snapshot_date", "")
        if date not in snapshots:
            snapshots[date] = []
        snapshots[date].append(r)
    return snapshots


def _take_snapshot():
    """
    Take a snapshot of the current AI portfolio with entry prices.
    Fetches live CMP via yfinance for the top 20 picks.
    Appends to ai_returns_snapshots.csv.
    """
    import yfinance as yf
    from datetime import datetime

    result = _build_ai_returns()
    if "error" in result:
        return result

    portfolio = result["portfolio"]
    if not portfolio:
        return {"error": "No stocks in AI portfolio"}

    # Check if we already have a snapshot for today
    today = datetime.now().strftime("%Y-%m-%d")
    existing = load_csv("ai_returns_snapshots.csv")
    if existing:
        for r in existing:
            if r.get("snapshot_date") == today:
                return {"error": f"Snapshot already exists for {today}. Only one snapshot per day."}

    # Fetch live prices for all portfolio stocks (batch)
    symbols = [s["symbol"] for s in portfolio]
    live_prices = {}
    for i in range(0, len(symbols), 30):
        batch = symbols[i:i + 30]
        try:
            tickers = yf.Tickers(" ".join(batch))
            for sym in batch:
                try:
                    t = tickers.tickers.get(sym)
                    if t:
                        info = t.fast_info
                        price = getattr(info, "last_price", None) or getattr(info, "previous_close", None)
                        if price and price > 0:
                            live_prices[sym] = round(float(price), 2)
                except Exception:
                    pass
        except Exception:
            pass

    # Fetch NIFTY50 benchmark price
    nifty_price = None
    try:
        nifty = yf.Ticker("^NSEI")
        nifty_price = round(float(nifty.fast_info.last_price), 2)
    except Exception:
        pass

    # Build snapshot rows
    snapshot_rows = []
    for s in portfolio:
        entry_price = live_prices.get(s["symbol"], s.get("cmp") or 0)
        if not entry_price or entry_price <= 0:
            continue
        snapshot_rows.append({
            "snapshot_date": today,
            "symbol": s["symbol"],
            "name": s["name"],
            "sector": s["sector"],
            "entry_price": entry_price,
            "alpha_score": s["alphaScore"],
            "composite_score": s["compositeScore"],
            "pred_upside_30d": s["predUpside30d"],
            "health_score": s["healthScore"],
            "verdict": s["verdict"],
            "nifty_at_entry": nifty_price or 0,
        })

    if not snapshot_rows:
        return {"error": "Could not fetch prices for any portfolio stock"}

    # Append to CSV
    out_path = os.path.join(config.DATA_DIR, "ai_returns_snapshots.csv")
    df_new = pd.DataFrame(snapshot_rows)
    if os.path.exists(out_path):
        df_old = pd.read_csv(out_path)
        df = pd.concat([df_old, df_new], ignore_index=True)
    else:
        df = df_new
    df.to_csv(out_path, index=False)

    return {
        "message": f"Snapshot saved for {today} with {len(snapshot_rows)} stocks",
        "date": today,
        "stocks": len(snapshot_rows),
        "niftyPrice": nifty_price,
    }


def _compute_returns():
    """
    Compute actual returns for all historical snapshots by comparing
    entry prices to current live prices and NIFTY50 benchmark.
    """
    import yfinance as yf
    from datetime import datetime

    rows = load_csv("ai_returns_snapshots.csv")
    if not rows:
        return {"error": "No snapshots found. Take your first snapshot to start tracking."}

    # Group by date
    date_groups = {}
    all_symbols = set()
    for r in rows:
        date = r.get("snapshot_date", "")
        if not date:
            continue
        if date not in date_groups:
            date_groups[date] = []
        date_groups[date].append(r)
        all_symbols.add((r.get("symbol") or "").strip())

    # Fetch current prices for all unique symbols
    symbols = list(all_symbols)
    live_prices = {}
    for i in range(0, len(symbols), 30):
        batch = symbols[i:i + 30]
        try:
            tickers = yf.Tickers(" ".join(batch))
            for sym in batch:
                try:
                    t = tickers.tickers.get(sym)
                    if t:
                        info = t.fast_info
                        price = getattr(info, "last_price", None) or getattr(info, "previous_close", None)
                        if price and price > 0:
                            live_prices[sym] = round(float(price), 2)
                except Exception:
                    pass
        except Exception:
            pass

    # Current NIFTY50
    nifty_now = None
    try:
        nifty = yf.Ticker("^NSEI")
        nifty_now = round(float(nifty.fast_info.last_price), 2)
    except Exception:
        pass

    # Compute returns per snapshot
    snapshots = []
    for date in sorted(date_groups.keys(), reverse=True):
        picks = date_groups[date]
        stock_returns = []
        total_return = 0
        hits = 0
        total_counted = 0

        nifty_entry = _safe_float(picks[0].get("nifty_at_entry"), 0) if picks else 0

        for r in picks:
            sym = (r.get("symbol") or "").strip()
            entry = _safe_float(r.get("entry_price"), 0)
            current = live_prices.get(sym, 0)

            if entry <= 0 or current <= 0:
                stock_returns.append({
                    "symbol": sym,
                    "name": r.get("name", ""),
                    "sector": r.get("sector", ""),
                    "entryPrice": entry,
                    "currentPrice": None,
                    "returnPct": None,
                    "alphaScore": _safe_float(r.get("alpha_score")),
                    "predUpside": _safe_float(r.get("pred_upside_30d")),
                    "verdict": r.get("verdict", ""),
                })
                continue

            ret = ((current - entry) / entry) * 100
            total_return += ret
            total_counted += 1
            if ret > 0:
                hits += 1

            stock_returns.append({
                "symbol": sym,
                "name": r.get("name", ""),
                "sector": r.get("sector", ""),
                "entryPrice": round(entry, 2),
                "currentPrice": round(current, 2),
                "returnPct": round(ret, 2),
                "alphaScore": _safe_float(r.get("alpha_score")),
                "predUpside": _safe_float(r.get("pred_upside_30d")),
                "verdict": r.get("verdict", ""),
            })

        # Sort by return
        stock_returns.sort(key=lambda s: s.get("returnPct") or -999, reverse=True)

        avg_return = round(total_return / total_counted, 2) if total_counted > 0 else 0
        hit_rate = round((hits / total_counted) * 100, 1) if total_counted > 0 else 0

        # NIFTY50 benchmark return
        nifty_return = None
        if nifty_entry > 0 and nifty_now and nifty_now > 0:
            nifty_return = round(((nifty_now - nifty_entry) / nifty_entry) * 100, 2)

        alpha = round(avg_return - nifty_return, 2) if nifty_return is not None else None

        # Winners/losers
        winners = [s for s in stock_returns if (s.get("returnPct") or 0) > 0]
        losers = [s for s in stock_returns if (s.get("returnPct") or 0) < 0]
        avg_win = round(sum(w["returnPct"] for w in winners) / len(winners), 2) if winners else 0
        avg_loss = round(sum(l["returnPct"] for l in losers) / len(losers), 2) if losers else 0

        # Days since snapshot
        try:
            snap_dt = datetime.strptime(date, "%Y-%m-%d")
            days = (datetime.now() - snap_dt).days
        except Exception:
            days = 0

        snapshots.append({
            "date": date,
            "daysHeld": days,
            "stocks": stock_returns,
            "totalStocks": len(stock_returns),
            "avgReturn": avg_return,
            "hitRate": hit_rate,
            "niftyReturn": nifty_return,
            "alpha": alpha,
            "winners": len(winners),
            "losers": len(losers),
            "avgWin": avg_win,
            "avgLoss": avg_loss,
            "bestPick": stock_returns[0]["symbol"] if stock_returns and stock_returns[0].get("returnPct") else None,
            "worstPick": stock_returns[-1]["symbol"] if stock_returns and stock_returns[-1].get("returnPct") else None,
        })

    # Aggregate stats across all snapshots
    all_avg = round(sum(s["avgReturn"] for s in snapshots) / len(snapshots), 2) if snapshots else 0
    all_alpha_list = [s["alpha"] for s in snapshots if s["alpha"] is not None]
    all_alpha = round(sum(all_alpha_list) / len(all_alpha_list), 2) if all_alpha_list else None
    all_hit = round(sum(s["hitRate"] for s in snapshots) / len(snapshots), 1) if snapshots else 0

    return {
        "snapshots": snapshots,
        "summary": {
            "totalSnapshots": len(snapshots),
            "avgPortfolioReturn": all_avg,
            "avgAlpha": all_alpha,
            "avgHitRate": all_hit,
            "niftyCurrent": nifty_now,
        },
    }


@app.route("/api/ai-returns", methods=["GET"])
def ai_returns():
    """Get current AI portfolio (expected alpha ranked picks)."""
    result = _build_ai_returns()
    if "error" in result:
        return jsonify(result), 404
    return jsonify(result)


@app.route("/api/ai-returns/snapshot", methods=["POST"])
def ai_returns_snapshot():
    """Take a snapshot of AI portfolio with live entry prices for tracking."""
    result = _take_snapshot()
    return jsonify(result)


@app.route("/api/ai-returns/performance", methods=["GET"])
def ai_returns_performance():
    """Compute actual returns for all historical snapshots."""
    result = _compute_returns()
    if "error" in result:
        # Return empty data instead of 404 — no snapshots is a valid state
        return jsonify({"snapshots": [], "summary": {
            "totalSnapshots": 0, "avgPortfolioReturn": 0,
            "avgAlpha": None, "avgHitRate": 0, "niftyCurrent": None,
        }})
    return jsonify(result)


# ─────────── Screener Detail — Comprehensive stock page ───────────

_screener_fetcher = None

def _get_screener_fetcher():
    global _screener_fetcher
    if _screener_fetcher is None:
        from modules.data_fetcher import DataFetcher
        _screener_fetcher = DataFetcher()
    return _screener_fetcher


def _format_financials_table(df, row_labels=None):
    """Convert a yfinance financials DataFrame to list-of-dicts for JSON."""
    if df is None or df.empty:
        return None
    result = []
    for idx, row in df.iterrows():
        label = str(idx)
        entry = {"label": label}
        for col in df.columns:
            period = col.strftime("%b %Y") if hasattr(col, "strftime") else str(col)
            val = row[col]
            entry[period] = _sanitize_value(val)
        result.append(entry)
    return result


def _quarterly_results(ticker):
    """Get quarterly financials from yfinance."""
    try:
        q = ticker.quarterly_income_stmt
        if q is not None and not q.empty:
            return _format_financials_table(q)
    except Exception:
        pass
    return None


def _annual_pnl(ticker):
    """Get annual income statement."""
    try:
        a = ticker.income_stmt
        if a is not None and not a.empty:
            return _format_financials_table(a)
    except Exception:
        pass
    return None


def _balance_sheet(ticker):
    """Get annual balance sheet."""
    try:
        bs = ticker.balance_sheet
        if bs is not None and not bs.empty:
            return _format_financials_table(bs)
    except Exception:
        pass
    return None


def _cash_flow(ticker):
    """Get annual cash flow statement."""
    try:
        cf = ticker.cashflow
        if cf is not None and not cf.empty:
            return _format_financials_table(cf)
    except Exception:
        pass
    return None


def _get_peers(info, composite_data):
    """Find peer companies in the same sector/industry."""
    sector = (info.get("sector") or "").strip()
    industry = (info.get("industry") or "").strip()
    symbol = (info.get("symbol") or "").replace(".NS", "")
    if not composite_data or not (sector or industry):
        return []
    peers = []
    for r in composite_data:
        r_sym = (r.get("symbol") or "").strip()
        if r_sym == symbol:
            continue
        r_ind = (r.get("industry") or "").strip()
        r_sec = (r.get("sector") or "").strip()
        match = (industry and r_ind == industry) or (sector and r_sec == sector)
        if match:
            peers.append({
                "symbol": r_sym,
                "name": r.get("name", ""),
                "cmp": _safe_float(r.get("last_price") or r.get("cmp")),
                "marketCap": _safe_float(r.get("market_cap")),
                "pe": _safe_float(r.get("pe_ratio")),
                "roe": _safe_float(r.get("roe")),
                "de": _safe_float(r.get("debt_to_equity")),
                "compositeScore": _safe_float(r.get("composite_score")),
            })
    peers.sort(key=lambda x: x.get("marketCap", 0), reverse=True)
    return peers[:10]


def _compute_ratios(info, fin_data):
    """Compute key financial ratios from info + financials."""
    ratios = {}
    ratios["roe"] = _safe_float(info.get("returnOnEquity"), None)
    if ratios["roe"] is not None:
        ratios["roe"] = round(ratios["roe"] * 100, 2)
    ratios["roa"] = _safe_float(info.get("returnOnAssets"), None)
    if ratios["roa"] is not None:
        ratios["roa"] = round(ratios["roa"] * 100, 2)
    ratios["pe"] = _safe_float(info.get("trailingPE"), None)
    ratios["forwardPE"] = _safe_float(info.get("forwardPE"), None)
    ratios["pb"] = _safe_float(info.get("priceToBook"), None)
    ratios["debtToEquity"] = _safe_float(info.get("debtToEquity"), None)
    ratios["currentRatio"] = _safe_float(info.get("currentRatio"), None)
    ratios["quickRatio"] = _safe_float(info.get("quickRatio"), None)
    ratios["operatingMargin"] = _safe_float(info.get("operatingMargins"), None)
    if ratios["operatingMargin"] is not None:
        ratios["operatingMargin"] = round(ratios["operatingMargin"] * 100, 2)
    ratios["profitMargin"] = _safe_float(info.get("profitMargins"), None)
    if ratios["profitMargin"] is not None:
        ratios["profitMargin"] = round(ratios["profitMargin"] * 100, 2)
    ratios["dividendYield"] = _safe_float(info.get("dividendYield"), None)
    if ratios["dividendYield"] is not None:
        ratios["dividendYield"] = round(ratios["dividendYield"] * 100, 2)
    ratios["payoutRatio"] = _safe_float(info.get("payoutRatio"), None)
    if ratios["payoutRatio"] is not None:
        ratios["payoutRatio"] = round(ratios["payoutRatio"] * 100, 2)
    ratios["evToEbitda"] = _safe_float(info.get("enterpriseToEbitda"), None)
    ratios["evToRevenue"] = _safe_float(info.get("enterpriseToRevenue"), None)
    ratios["pegRatio"] = _safe_float(info.get("pegRatio"), None)
    ratios["earningsGrowth"] = _safe_float(info.get("earningsGrowth"), None)
    if ratios["earningsGrowth"] is not None:
        ratios["earningsGrowth"] = round(ratios["earningsGrowth"] * 100, 2)
    ratios["revenueGrowth"] = _safe_float(info.get("revenueGrowth"), None)
    if ratios["revenueGrowth"] is not None:
        ratios["revenueGrowth"] = round(ratios["revenueGrowth"] * 100, 2)
    ratios["bookValue"] = _safe_float(info.get("bookValue"), None)
    ratios["eps"] = _safe_float(info.get("trailingEps"), None)
    return {k: v for k, v in ratios.items() if v is not None}


def _get_shareholding(info):
    """Extract shareholding pattern from info."""
    sh = {}
    sh["promoters"] = _safe_float(info.get("heldPercentInsiders"), None)
    if sh["promoters"] is not None:
        sh["promoters"] = round(sh["promoters"] * 100, 2)
    sh["institutionalHolders"] = _safe_float(info.get("heldPercentInstitutions"), None)
    if sh["institutionalHolders"] is not None:
        sh["institutionalHolders"] = round(sh["institutionalHolders"] * 100, 2)
    if sh.get("promoters") is not None and sh.get("institutionalHolders") is not None:
        sh["public"] = round(100 - sh["promoters"] - sh["institutionalHolders"], 2)
    return {k: v for k, v in sh.items() if v is not None}


def _get_price_chart_data(symbol, period="5y"):
    """Get OHLCV data for price chart."""
    try:
        import yfinance as yf
        ticker = yf.Ticker(f"{symbol}.NS")
        hist = ticker.history(period=period)
        if hist is None or hist.empty:
            return None
        data = []
        for date, row in hist.iterrows():
            data.append({
                "date": date.strftime("%Y-%m-%d"),
                "open": round(float(row["Open"]), 2),
                "high": round(float(row["High"]), 2),
                "low": round(float(row["Low"]), 2),
                "close": round(float(row["Close"]), 2),
                "volume": int(row["Volume"]),
            })
        return data
    except Exception:
        return None


def _generate_pros_cons(info, ratios):
    """Generate pros and cons for a stock based on its metrics."""
    pros = []
    cons = []
    roe = ratios.get("roe")
    if roe is not None:
        if roe > 15:
            pros.append(f"Strong ROE of {roe:.1f}% indicates efficient use of equity")
        elif roe < 8:
            cons.append(f"Low ROE of {roe:.1f}% suggests poor equity efficiency")

    de = ratios.get("debtToEquity")
    if de is not None:
        if de < 50:
            pros.append(f"Low debt-to-equity ratio of {de:.1f}% indicates conservative financing")
        elif de > 150:
            cons.append(f"High debt-to-equity ratio of {de:.1f}% indicates heavy leverage")

    pe = ratios.get("pe")
    if pe is not None:
        if pe < 20 and pe > 0:
            pros.append(f"Reasonable valuation with P/E of {pe:.1f}")
        elif pe > 50:
            cons.append(f"Expensive valuation with P/E of {pe:.1f}")

    om = ratios.get("operatingMargin")
    if om is not None:
        if om > 20:
            pros.append(f"Healthy operating margin of {om:.1f}%")
        elif om < 5:
            cons.append(f"Thin operating margin of {om:.1f}%")

    cr = ratios.get("currentRatio")
    if cr is not None:
        if cr > 1.5:
            pros.append(f"Good liquidity with current ratio of {cr:.2f}")
        elif cr < 0.8:
            cons.append(f"Liquidity concern with current ratio of {cr:.2f}")

    dy = ratios.get("dividendYield")
    if dy is not None and dy > 1.5:
        pros.append(f"Attractive dividend yield of {dy:.1f}%")

    rg = ratios.get("revenueGrowth")
    if rg is not None:
        if rg > 15:
            pros.append(f"Strong revenue growth of {rg:.1f}%")
        elif rg < -5:
            cons.append(f"Revenue declining at {rg:.1f}%")

    eg = ratios.get("earningsGrowth")
    if eg is not None:
        if eg > 20:
            pros.append(f"Robust earnings growth of {eg:.1f}%")
        elif eg < -10:
            cons.append(f"Earnings declined by {eg:.1f}%")

    pb = ratios.get("pb")
    if pb is not None and pb < 2:
        pros.append(f"Trading near book value (P/B: {pb:.2f})")

    target = _safe_float(info.get("targetMeanPrice"), None)
    cmp = _safe_float(info.get("currentPrice") or info.get("regularMarketPrice"), None)
    if target and cmp and target > cmp * 1.1:
        upside = round((target / cmp - 1) * 100, 1)
        pros.append(f"Analyst target suggests {upside}% upside")
    elif target and cmp and target < cmp * 0.95:
        downside = round((1 - target / cmp) * 100, 1)
        cons.append(f"Analyst target implies {downside}% downside")

    return pros[:6], cons[:6]


@app.route("/api/screener-detail/<symbol>", methods=["GET"])
def screener_detail(symbol):
    """Comprehensive stock detail page — like screener.in."""
    import yfinance as yf

    yf_symbol = f"{symbol.strip().upper()}.NS"
    ticker = yf.Ticker(yf_symbol)

    try:
        info = ticker.info or {}
    except Exception:
        info = {}

    if not info or info.get("regularMarketPrice") is None:
        return jsonify({"error": f"Could not fetch data for {symbol}"}), 404

    cmp = _safe_float(info.get("currentPrice") or info.get("regularMarketPrice"))
    prev_close = _safe_float(info.get("previousClose") or info.get("regularMarketPreviousClose"))
    change = round(cmp - prev_close, 2) if cmp and prev_close else 0
    change_pct = round((change / prev_close) * 100, 2) if prev_close else 0
    mcap = _safe_float(info.get("marketCap"), 0)
    mcap_cr = round(mcap / 1e7, 1) if mcap else 0

    ratios = _compute_ratios(info, None)
    pros, cons = _generate_pros_cons(info, ratios)
    shareholding = _get_shareholding(info)

    # Peer comparison from composite data
    composite = load_csv("composite_ranked.csv")
    peers = _get_peers(info, composite)

    # Financial tables
    quarterly = _quarterly_results(ticker)
    pnl = _annual_pnl(ticker)
    balance_sheet = _balance_sheet(ticker)
    cash_flow = _cash_flow(ticker)

    # Price chart (1 year for performance)
    chart_data = _get_price_chart_data(symbol, period="5y")

    result = {
        "symbol": symbol.upper(),
        "name": info.get("longName") or info.get("shortName") or symbol,
        "sector": info.get("sector", ""),
        "industry": info.get("industry", ""),
        "cmp": cmp,
        "prevClose": prev_close,
        "change": change,
        "changePct": change_pct,
        "marketCapCr": mcap_cr,
        "high52w": _safe_float(info.get("fiftyTwoWeekHigh")),
        "low52w": _safe_float(info.get("fiftyTwoWeekLow")),
        "dayHigh": _safe_float(info.get("dayHigh")),
        "dayLow": _safe_float(info.get("dayLow")),
        "volume": _safe_float(info.get("volume")),
        "avgVolume": _safe_float(info.get("averageVolume")),
        "bookValue": _safe_float(info.get("bookValue")),
        "faceValue": _safe_float(info.get("faceValue")),
        "eps": _safe_float(info.get("trailingEps")),
        "pe": _safe_float(info.get("trailingPE")),
        "pb": _safe_float(info.get("priceToBook")),
        "dividendYield": ratios.get("dividendYield"),
        "targetMeanPrice": _safe_float(info.get("targetMeanPrice")),
        "targetHighPrice": _safe_float(info.get("targetHighPrice")),
        "targetLowPrice": _safe_float(info.get("targetLowPrice")),
        "recommendationMean": _safe_float(info.get("recommendationMean")),
        "recommendationKey": info.get("recommendationKey", ""),
        "numberOfAnalysts": _safe_float(info.get("numberOfAnalystOpinions")),
        "about": info.get("longBusinessSummary", ""),
        "website": info.get("website", ""),
        "ratios": ratios,
        "pros": pros,
        "cons": cons,
        "peers": peers,
        "quarterlyResults": quarterly,
        "profitLoss": pnl,
        "balanceSheet": balance_sheet,
        "cashFlow": cash_flow,
        "shareholding": shareholding,
        "chartData": chart_data,
    }
    return jsonify(_deep_sanitize(result))


# ─────────── Stock AI Chat — Ask anything about a company ───────────

@app.route("/api/stock-chat", methods=["POST"])
def stock_chat():
    """Chat endpoint: answer questions about a stock using available data.

    Body: { "symbol": "RELIANCE", "question": "What are the red flags?" }
    Returns a structured answer built from screener data + yfinance info.
    """
    body = request.get_json(force=True)
    symbol = (body.get("symbol") or "").strip().upper()
    question = (body.get("question") or "").strip()

    if not symbol:
        return jsonify({"error": "Symbol is required"}), 400
    if not question:
        return jsonify({"error": "Question is required"}), 400

    import yfinance as yf

    yf_symbol = f"{symbol}.NS"
    ticker = yf.Ticker(yf_symbol)
    try:
        info = ticker.info or {}
    except Exception:
        info = {}

    cmp = _safe_float(info.get("currentPrice") or info.get("regularMarketPrice"))
    name = info.get("longName") or info.get("shortName") or symbol

    # Gather all available data
    ratios = _compute_ratios(info, None)
    pros, cons = _generate_pros_cons(info, ratios)
    shareholding = _get_shareholding(info)

    # Load screener data
    composite = load_csv("composite_ranked.csv")
    screener_row = None
    if composite:
        for r in composite:
            if (r.get("symbol") or "").strip() == symbol:
                screener_row = r
                break

    # Build knowledge base context
    kb = {
        "name": name,
        "symbol": symbol,
        "sector": info.get("sector", "N/A"),
        "industry": info.get("industry", "N/A"),
        "cmp": cmp,
        "marketCapCr": round(_safe_float(info.get("marketCap"), 0) / 1e7, 1),
        "about": info.get("longBusinessSummary", ""),
        "ratios": ratios,
        "pros": pros,
        "cons": cons,
        "shareholding": shareholding,
    }

    if screener_row:
        kb["compositeScore"] = _safe_float(screener_row.get("composite_score"))
        kb["fundamentalScore"] = _safe_float(screener_row.get("fundamental_score"))
        kb["technicalScore"] = _safe_float(screener_row.get("technical_score"))
        kb["redFlagStatus"] = screener_row.get("red_flag_status", "")
        kb["redFlagReasons"] = screener_row.get("red_flag_reasons", "")

    # Route to appropriate answer generator based on question keywords
    q_lower = question.lower()
    answer = ""
    answer_type = "text"

    if any(w in q_lower for w in ["business model", "about", "what does", "explain the company", "overview"]):
        answer = _chat_business_model(kb, info)
    elif any(w in q_lower for w in ["red flag", "risk", "concern", "danger", "warning"]):
        answer = _chat_red_flags(kb, info, ratios)
    elif any(w in q_lower for w in ["evolution", "history", "last 3 year", "last 5 year", "track record", "journey"]):
        answer = _chat_evolution(kb, info, ticker)
    elif any(w in q_lower for w in ["growth", "outlook", "future", "next 3 year", "prospect", "potential"]):
        answer = _chat_growth_outlook(kb, info, ratios)
    elif any(w in q_lower for w in ["management", "promoter", "commentary", "leadership", "ceo"]):
        answer = _chat_management(kb, info, shareholding)
    elif any(w in q_lower for w in ["product", "revenue mix", "segment", "key product"]):
        answer = _chat_products(kb, info)
    elif any(w in q_lower for w in ["perform", "stock expected", "price target", "upside", "return"]):
        answer = _chat_performance(kb, info, ratios)
    elif any(w in q_lower for w in ["guidance", "delivery", "past guidance", "promise"]):
        answer = _chat_guidance(kb, info, ratios)
    elif any(w in q_lower for w in ["fundamental", "valuation", "financials", "ratio"]):
        answer = _chat_fundamentals(kb, ratios)
    elif any(w in q_lower for w in ["technical", "trend", "momentum", "signal", "chart"]):
        answer = _chat_technical(kb, screener_row)
    elif any(w in q_lower for w in ["compare", "peer", "competitor", "vs"]):
        answer = _chat_peers(kb, info, composite)
    elif any(w in q_lower for w in ["dividend", "payout", "yield"]):
        answer = _chat_dividend(kb, info, ratios)
    else:
        answer = _chat_general(kb, info, ratios)

    return jsonify({
        "symbol": symbol,
        "name": name,
        "question": question,
        "answer": answer,
        "answerType": answer_type,
        "dataPoints": len([v for v in kb.values() if v]),
    })


def _chat_business_model(kb, info):
    about = kb.get("about", "")
    if about:
        lines = [f"**{kb['name']}** ({kb['symbol']})", ""]
        lines.append(about)
        lines.append("")
        lines.append(f"**Sector:** {kb['sector']} | **Industry:** {kb['industry']}")
        lines.append(f"**Market Cap:** {kb['marketCapCr']:,.0f} Cr | **CMP:** ₹{kb['cmp']:,.2f}" if kb.get('cmp') else "")
        return "\n".join(lines)
    return f"Detailed business description is not available for {kb['name']}. It operates in the {kb['industry']} industry under the {kb['sector']} sector."


def _chat_red_flags(kb, info, ratios):
    lines = [f"**Red Flag Analysis for {kb['name']}**", ""]
    if kb.get("redFlagStatus"):
        lines.append(f"**Screener Status:** {kb['redFlagStatus']}")
        if kb.get("redFlagReasons"):
            lines.append(f"**Reasons:** {kb['redFlagReasons']}")
        lines.append("")

    cons = kb.get("cons", [])
    if cons:
        lines.append("**Key Concerns:**")
        for c in cons:
            lines.append(f"- {c}")
        lines.append("")

    # Additional checks
    warnings = []
    de = ratios.get("debtToEquity")
    if de and de > 100:
        warnings.append(f"High leverage — Debt/Equity at {de:.1f}%")
    pe = ratios.get("pe")
    if pe and pe > 40:
        warnings.append(f"Expensive valuation — P/E at {pe:.1f}")
    cr_val = ratios.get("currentRatio")
    if cr_val and cr_val < 1:
        warnings.append(f"Liquidity risk — Current Ratio at {cr_val:.2f}")

    if warnings:
        lines.append("**Additional Warnings:**")
        for w in warnings:
            lines.append(f"- ⚠ {w}")

    if not cons and not warnings and not kb.get("redFlagReasons"):
        lines.append("No significant red flags detected based on available data.")

    return "\n".join(lines)


def _chat_evolution(kb, info, ticker):
    lines = [f"**Evolution of {kb['name']}**", ""]
    lines.append(f"**Sector:** {kb['sector']} | **Industry:** {kb['industry']}")
    lines.append(f"**Current Market Cap:** {kb['marketCapCr']:,.0f} Cr" if kb.get('marketCapCr') else "")
    lines.append("")

    # Try to get historical price performance
    try:
        hist = ticker.history(period="3y")
        if hist is not None and len(hist) > 60:
            first_price = float(hist["Close"].iloc[0])
            last_price = float(hist["Close"].iloc[-1])
            ret_3y = round((last_price / first_price - 1) * 100, 1)
            high_3y = round(float(hist["High"].max()), 2)
            low_3y = round(float(hist["Low"].min()), 2)
            lines.append("**3-Year Price Performance:**")
            lines.append(f"- Return: {ret_3y:+.1f}%")
            lines.append(f"- Range: ₹{low_3y:,.2f} — ₹{high_3y:,.2f}")
            lines.append(f"- Current: ₹{last_price:,.2f}")
            lines.append("")
    except Exception:
        pass

    ratios = kb.get("ratios", {})
    rg = ratios.get("revenueGrowth")
    eg = ratios.get("earningsGrowth")
    if rg is not None or eg is not None:
        lines.append("**Recent Growth Trends:**")
        if rg is not None:
            lines.append(f"- Revenue Growth: {rg:+.1f}%")
        if eg is not None:
            lines.append(f"- Earnings Growth: {eg:+.1f}%")

    return "\n".join(lines)


def _chat_growth_outlook(kb, info, ratios):
    lines = [f"**Growth Outlook for {kb['name']}**", ""]

    target = _safe_float(info.get("targetMeanPrice"), None)
    cmp = kb.get("cmp")
    if target and cmp:
        upside = round((target / cmp - 1) * 100, 1)
        lines.append(f"**Analyst Consensus Target:** ₹{target:,.2f} ({upside:+.1f}% from CMP ₹{cmp:,.2f})")
        n_analysts = info.get("numberOfAnalystOpinions")
        if n_analysts:
            lines.append(f"**Coverage:** {int(n_analysts)} analysts")
        rec = info.get("recommendationKey", "")
        if rec:
            lines.append(f"**Recommendation:** {rec.upper()}")
        lines.append("")

    rg = ratios.get("revenueGrowth")
    eg = ratios.get("earningsGrowth")
    if rg is not None or eg is not None:
        lines.append("**Recent Growth:**")
        if rg is not None:
            lines.append(f"- Revenue Growth: {rg:+.1f}%")
        if eg is not None:
            lines.append(f"- Earnings Growth: {eg:+.1f}%")
        lines.append("")

    pros = kb.get("pros", [])
    if pros:
        lines.append("**Growth Strengths:**")
        for p in pros:
            lines.append(f"- {p}")

    return "\n".join(lines)


def _chat_management(kb, info, shareholding):
    lines = [f"**Management & Ownership — {kb['name']}**", ""]
    if shareholding:
        lines.append("**Shareholding Pattern:**")
        for k, v in shareholding.items():
            lines.append(f"- {k.replace('institutionalHolders', 'Institutional').title()}: {v:.1f}%")
        lines.append("")

    rec = info.get("recommendationKey", "")
    rec_mean = _safe_float(info.get("recommendationMean"), None)
    if rec:
        lines.append(f"**Analyst View:** {rec.upper()}" + (f" (score: {rec_mean:.1f}/5)" if rec_mean else ""))

    if not shareholding:
        lines.append("Detailed management and promoter data is limited from available sources.")

    return "\n".join(lines)


def _chat_products(kb, info):
    lines = [f"**Products & Segments — {kb['name']}**", ""]
    about = kb.get("about", "")
    if about:
        lines.append(about[:500])
        if len(about) > 500:
            lines.append("...")
    else:
        lines.append(f"Operates in {kb['industry']} within the {kb['sector']} sector.")
    lines.append("")
    lines.append(f"**Website:** {info.get('website', 'N/A')}")
    return "\n".join(lines)


def _chat_performance(kb, info, ratios):
    lines = [f"**Stock Performance Outlook — {kb['name']}**", ""]

    cmp = kb.get("cmp")
    if cmp:
        lines.append(f"**CMP:** ₹{cmp:,.2f}")
    target = _safe_float(info.get("targetMeanPrice"), None)
    if target and cmp:
        upside = round((target / cmp - 1) * 100, 1)
        lines.append(f"**Analyst Target:** ₹{target:,.2f} ({upside:+.1f}%)")
        lines.append(f"**Target Range:** ₹{_safe_float(info.get('targetLowPrice')):,.2f} — ₹{_safe_float(info.get('targetHighPrice')):,.2f}")
    lines.append("")

    if kb.get("fundamentalScore"):
        lines.append(f"**Screener Scores:**")
        lines.append(f"- Fundamental: {kb['fundamentalScore']:.1f}/100")
        if kb.get("technicalScore"):
            lines.append(f"- Technical: {kb['technicalScore']:.1f}/100")
        if kb.get("compositeScore"):
            lines.append(f"- Composite: {kb['compositeScore']:.1f}/100")

    return "\n".join(lines)


def _chat_guidance(kb, info, ratios):
    lines = [f"**Guidance & Track Record — {kb['name']}**", ""]
    lines.append("Specific management guidance data requires earnings call transcripts which are not available in our dataset.")
    lines.append("")
    lines.append("**What we know from metrics:**")
    rg = ratios.get("revenueGrowth")
    eg = ratios.get("earningsGrowth")
    if rg is not None:
        lines.append(f"- Recent revenue growth: {rg:+.1f}%")
    if eg is not None:
        lines.append(f"- Recent earnings growth: {eg:+.1f}%")
    rec = info.get("recommendationKey", "")
    if rec:
        lines.append(f"- Analyst consensus: {rec.upper()}")
    return "\n".join(lines)


def _chat_fundamentals(kb, ratios):
    lines = [f"**Fundamental Analysis — {kb['name']}**", ""]
    if ratios:
        lines.append("| Metric | Value |")
        lines.append("|--------|-------|")
        labels = {
            "pe": "P/E Ratio", "pb": "P/B Ratio", "roe": "ROE %",
            "roa": "ROA %", "debtToEquity": "Debt/Equity %",
            "currentRatio": "Current Ratio", "operatingMargin": "Operating Margin %",
            "profitMargin": "Net Profit Margin %", "dividendYield": "Dividend Yield %",
            "evToEbitda": "EV/EBITDA", "earningsGrowth": "Earnings Growth %",
            "revenueGrowth": "Revenue Growth %", "eps": "EPS",
        }
        for key, label in labels.items():
            val = ratios.get(key)
            if val is not None:
                lines.append(f"| {label} | {val:.2f} |")
    else:
        lines.append("Fundamental data not available.")
    return "\n".join(lines)


def _chat_technical(kb, screener_row):
    lines = [f"**Technical Analysis — {kb['name']}**", ""]
    if screener_row:
        ts = _safe_float(screener_row.get("technical_score"))
        lines.append(f"**Technical Score:** {ts:.1f}/100")
        trend = _safe_float(screener_row.get("tech_trend"))
        mom = _safe_float(screener_row.get("tech_momentum"))
        vol = _safe_float(screener_row.get("tech_volume"))
        rs = _safe_float(screener_row.get("tech_relative_strength"))
        lines.append("")
        lines.append("| Component | Score |")
        lines.append("|-----------|-------|")
        lines.append(f"| Trend (35%) | {trend:.1f} |")
        lines.append(f"| Momentum (30%) | {mom:.1f} |")
        lines.append(f"| Volume (20%) | {vol:.1f} |")
        lines.append(f"| Rel. Strength (15%) | {rs:.1f} |")
    else:
        lines.append(f"Technical analysis data not available for {kb['symbol']} in the screener database. Run the screener pipeline first.")
    return "\n".join(lines)


def _chat_peers(kb, info, composite):
    peers = _get_peers(info, composite) if composite else []
    lines = [f"**Peer Comparison — {kb['name']}**", ""]
    if peers:
        lines.append("| Company | CMP | MCap (Cr) | P/E | ROE | Score |")
        lines.append("|---------|-----|-----------|-----|-----|-------|")
        for p in peers[:8]:
            lines.append(f"| {p['symbol']} | ₹{p['cmp']:,.2f} | {p['marketCap']/1e7:,.0f} | {p['pe']:.1f} | {p['roe']:.1f} | {p['compositeScore']:.1f} |")
    else:
        lines.append("No peer data available. Run the screener pipeline first.")
    return "\n".join(lines)


def _chat_dividend(kb, info, ratios):
    lines = [f"**Dividend Analysis — {kb['name']}**", ""]
    dy = ratios.get("dividendYield")
    pr = ratios.get("payoutRatio")
    if dy is not None:
        lines.append(f"**Dividend Yield:** {dy:.2f}%")
    if pr is not None:
        lines.append(f"**Payout Ratio:** {pr:.1f}%")
    div_rate = _safe_float(info.get("dividendRate"), None)
    if div_rate:
        lines.append(f"**Annual Dividend:** ₹{div_rate:.2f} per share")
    ex_date = info.get("exDividendDate")
    if ex_date:
        lines.append(f"**Ex-Dividend Date:** {ex_date}")
    if not dy and not pr and not div_rate:
        lines.append("No dividend data available for this stock.")
    return "\n".join(lines)


def _chat_general(kb, info, ratios):
    lines = [f"**{kb['name']}** ({kb['symbol']})", ""]
    lines.append(f"**Sector:** {kb['sector']} | **Industry:** {kb['industry']}")
    cmp = kb.get("cmp")
    if cmp:
        lines.append(f"**CMP:** ₹{cmp:,.2f} | **MCap:** {kb.get('marketCapCr', 0):,.0f} Cr")
    lines.append("")

    if kb.get("about"):
        lines.append(kb["about"][:300])
        lines.append("")

    pros = kb.get("pros", [])
    cons = kb.get("cons", [])
    if pros:
        lines.append("**Strengths:**")
        for p in pros[:3]:
            lines.append(f"- {p}")
    if cons:
        lines.append("**Concerns:**")
        for c in cons[:3]:
            lines.append(f"- {c}")

    if ratios:
        lines.append("")
        pe = ratios.get("pe")
        roe = ratios.get("roe")
        de = ratios.get("debtToEquity")
        if pe:
            lines.append(f"P/E: {pe:.1f} | ", )
        summary_parts = []
        if pe:
            summary_parts.append(f"P/E: {pe:.1f}")
        if roe:
            summary_parts.append(f"ROE: {roe:.1f}%")
        if de:
            summary_parts.append(f"D/E: {de:.1f}%")
        if summary_parts:
            lines.append(" | ".join(summary_parts))

    return "\n".join(lines)


@app.route("/api/stock-future-results/<symbol>", methods=["GET"])
def stock_future_results(symbol):
    """
    Future results & analyst forecasts for AI Stock Analyzer.
    Returns: quarterly history, analyst EPS/revenue estimates, growth estimates,
             earnings calendar, analyst price targets, YoY projections.
    """
    import yfinance as yf
    import math

    sym = symbol.strip().upper()
    sym_ns = sym if sym.endswith(".NS") else sym + ".NS"
    ticker = yf.Ticker(sym_ns)

    def sf(v):
        try:
            f = float(v)
            return None if math.isnan(f) or math.isinf(f) else f
        except Exception:
            return None

    def fmt_df(df):
        """Convert yfinance DataFrame to list-of-dicts."""
        if df is None or df.empty:
            return None
        rows = []
        for idx, row in df.iterrows():
            d = {"period": str(idx)}
            for col in df.columns:
                val = row[col]
                try:
                    fv = float(val)
                    d[str(col)] = None if math.isnan(fv) or math.isinf(fv) else round(fv, 4)
                except Exception:
                    d[str(col)] = str(val) if val is not None else None
            rows.append(d)
        return rows

    def fmt_quarterly(df, key_rows=None):
        """Format quarterly financials, picking key rows only."""
        if df is None or df.empty:
            return None
        # Key rows to display
        want = key_rows or [
            "Total Revenue", "Gross Profit", "Operating Income",
            "Net Income", "EBITDA", "Basic EPS", "Diluted EPS",
            "Operating Expense", "Tax Provision",
        ]
        result = {"periods": [], "rows": []}
        # periods = column headers (dates)
        result["periods"] = [c.strftime("%b '%y") if hasattr(c, "strftime") else str(c) for c in df.columns]
        for label in want:
            if label in df.index:
                vals = []
                for col in df.columns:
                    v = sf(df.loc[label, col])
                    # Convert to Cr if large number
                    if v is not None and abs(v) > 1e6:
                        v = round(v / 1e7, 2)  # to Crore
                    vals.append(v)
                result["rows"].append({"label": label, "values": vals})
        return result

    try:
        info = ticker.info or {}
    except Exception:
        info = {}

    # ── 1. Quarterly financial history ──────────────────────────────
    try:
        q_income = ticker.quarterly_income_stmt
        quarterly = fmt_quarterly(q_income)
    except Exception:
        quarterly = None

    # ── 2. Annual financial history (last 4 years) ──────────────────
    try:
        a_income = ticker.income_stmt
        annual = fmt_quarterly(a_income, key_rows=[
            "Total Revenue", "Gross Profit", "Operating Income",
            "Net Income", "EBITDA", "Basic EPS",
        ])
    except Exception:
        annual = None

    # ── 3. Analyst estimates ────────────────────────────────────────
    earnings_est = None
    revenue_est = None
    eps_trend = None
    growth_est = None
    try:
        earnings_est = fmt_df(ticker.earnings_estimate)
    except Exception:
        pass
    try:
        revenue_est = fmt_df(ticker.revenue_estimate)
    except Exception:
        pass
    try:
        eps_trend = fmt_df(ticker.eps_trend)
    except Exception:
        pass
    try:
        growth_est = fmt_df(ticker.growth_estimates)
    except Exception:
        pass

    # ── 4. Earnings calendar ────────────────────────────────────────
    calendar = None
    try:
        cal = ticker.calendar
        if isinstance(cal, dict):
            calendar = {k: str(v) for k, v in cal.items() if v is not None}
        elif cal is not None and not (hasattr(cal, 'empty') and cal.empty):
            calendar = str(cal)
    except Exception:
        pass

    # ── 5. Analyst price targets ────────────────────────────────────
    analyst_targets = {
        "targetMeanPrice":  sf(info.get("targetMeanPrice")),
        "targetHighPrice":  sf(info.get("targetHighPrice")),
        "targetLowPrice":   sf(info.get("targetLowPrice")),
        "recommendationKey": info.get("recommendationKey", ""),
        "recommendationMean": sf(info.get("recommendationMean")),
        "numberOfAnalysts": sf(info.get("numberOfAnalystOpinions")),
        "currentPrice":     sf(info.get("currentPrice") or info.get("regularMarketPrice")),
    }
    if analyst_targets["targetMeanPrice"] and analyst_targets["currentPrice"]:
        cmp = analyst_targets["currentPrice"]
        analyst_targets["upsidePct"] = round((analyst_targets["targetMeanPrice"] / cmp - 1) * 100, 1)

    # ── 6. Simple YoY projection (last 4Q trend → next 2Q) ─────────
    projections = None
    try:
        if q_income is not None and not q_income.empty and "Total Revenue" in q_income.index:
            revs = [sf(v) for v in q_income.loc["Total Revenue"].values[:4]]
            revs = [r for r in revs if r]
            if len(revs) >= 2:
                growth = (revs[0] / revs[-1]) ** (1 / (len(revs) - 1)) - 1 if revs[-1] else 0
                # last quarter date
                last_col = q_income.columns[0]
                import pandas as pd
                next_q1 = last_col + pd.DateOffset(months=3)
                next_q2 = last_col + pd.DateOffset(months=6)
                projections = {
                    "revenueGrowthQoQ": round(growth * 100, 1),
                    "projectedRevQ1": round(revs[0] * (1 + growth) / 1e7, 2),  # Crore
                    "projectedRevQ2": round(revs[0] * (1 + growth) ** 2 / 1e7, 2),
                    "nextQ1Label": next_q1.strftime("%b '%y"),
                    "nextQ2Label": next_q2.strftime("%b '%y"),
                    "note": "Projection based on recent QoQ revenue trend; not analyst consensus.",
                }
    except Exception:
        pass

    # ── 7. Key metrics from info ────────────────────────────────────
    key_metrics = {
        "forwardPE":       sf(info.get("forwardPE")),
        "trailingPE":      sf(info.get("trailingPE")),
        "forwardEps":      sf(info.get("forwardEps")),
        "trailingEps":     sf(info.get("trailingEps")),
        "earningsGrowth":  round(sf(info.get("earningsGrowth")) * 100, 1) if sf(info.get("earningsGrowth")) is not None else None,
        "revenueGrowth":   round(sf(info.get("revenueGrowth")) * 100, 1) if sf(info.get("revenueGrowth")) is not None else None,
        "profitMargins":   round(sf(info.get("profitMargins")) * 100, 1) if sf(info.get("profitMargins")) is not None else None,
        "operatingMargins": round(sf(info.get("operatingMargins")) * 100, 1) if sf(info.get("operatingMargins")) is not None else None,
        "pegRatio":        sf(info.get("pegRatio")),
        "nextEarningsDate": str(info.get("earningsTimestamp", "")) if info.get("earningsTimestamp") else None,
    }
    # Format earnings timestamp to readable date
    if info.get("earningsTimestamp"):
        try:
            import datetime
            ts = int(info["earningsTimestamp"])
            key_metrics["nextEarningsDate"] = datetime.datetime.utcfromtimestamp(ts).strftime("%d %b %Y")
        except Exception:
            pass

    return jsonify(_deep_sanitize({
        "symbol": sym,
        "name": info.get("longName") or info.get("shortName") or sym,
        "quarterly": quarterly,
        "annual": annual,
        "earningsEstimate": earnings_est,
        "revenueEstimate": revenue_est,
        "epsTrend": eps_trend,
        "growthEstimates": growth_est,
        "calendar": calendar,
        "analystTargets": analyst_targets,
        "projections": projections,
        "keyMetrics": key_metrics,
    }))


def _detect_candlestick_patterns(df):
    """
    Detect candlestick patterns on an OHLCV DataFrame.
    df must have columns: Open, High, Low, Close (float).
    Returns list of dicts: { date, pattern, type ('bullish'|'bearish'|'neutral'), strength (1|2|3) }
    """
    import numpy as np

    patterns = []
    o = df["Open"].astype(float).values
    h = df["High"].astype(float).values
    l = df["Low"].astype(float).values
    c = df["Close"].astype(float).values
    dates = df.index

    n = len(c)
    if n < 3:
        return patterns

    # Pre-compute per-candle metrics
    body       = np.abs(c - o)
    rng        = h - l
    avg_body   = np.convolve(body, np.ones(10) / 10, mode='same')  # rolling avg body
    upper_shad = h - np.maximum(o, c)
    lower_shad = np.minimum(o, c) - l
    is_bull    = c > o
    is_bear    = c < o

    def _trend(i, lookback=5):
        """Simple prior trend: positive = uptrend, negative = downtrend."""
        if i < lookback:
            return 0
        return c[i - 1] - c[i - lookback]

    def _add(i, name, kind, strength=1):
        patterns.append({
            "date":     dates[i].strftime("%Y-%m-%d"),
            "pattern":  name,
            "type":     kind,
            "strength": strength,
        })

    for i in range(2, n):
        rng_i    = rng[i]     if rng[i] > 0 else 0.0001
        body_i   = body[i]
        avg_i    = avg_body[i] if avg_body[i] > 0 else 0.0001
        us_i     = upper_shad[i]
        ls_i     = lower_shad[i]
        trend    = _trend(i)

        # ── 1-CANDLE PATTERNS ──────────────────────────────────────

        # Doji (body < 10% of range and range > 0)
        if body_i < 0.1 * rng_i and rng_i > 0:
            if ls_i > 2 * us_i and ls_i > 0.6 * rng_i:
                _add(i, "Dragonfly Doji", "bullish", 2)
            elif us_i > 2 * ls_i and us_i > 0.6 * rng_i:
                _add(i, "Gravestone Doji", "bearish", 2)
            else:
                _add(i, "Doji", "neutral", 1)

        # Hammer / Hanging Man (body in upper third, long lower shadow)
        elif (ls_i >= 2 * body_i and us_i <= 0.3 * body_i and
              body_i >= 0.1 * rng_i and body_i <= 0.35 * rng_i):
            if trend < 0:
                _add(i, "Hammer", "bullish", 2)
            else:
                _add(i, "Hanging Man", "bearish", 2)

        # Inverted Hammer / Shooting Star (body in lower third, long upper shadow)
        elif (us_i >= 2 * body_i and ls_i <= 0.3 * body_i and
              body_i >= 0.1 * rng_i and body_i <= 0.35 * rng_i):
            if trend < 0:
                _add(i, "Inverted Hammer", "bullish", 2)
            else:
                _add(i, "Shooting Star", "bearish", 2)

        # Marubozu (strong full-body candle, shadows < 5% of body)
        elif body_i >= 0.85 * rng_i:
            if is_bull[i]:
                _add(i, "Bullish Marubozu", "bullish", 2)
            else:
                _add(i, "Bearish Marubozu", "bearish", 2)

        # ── 2-CANDLE PATTERNS ──────────────────────────────────────
        prev = i - 1
        body_p = body[prev]
        avg_p  = avg_body[prev] if avg_body[prev] > 0 else 0.0001

        # Bullish Engulfing
        if (is_bear[prev] and is_bull[i] and
                o[i] <= c[prev] and c[i] >= o[prev] and
                body_i > body_p and body_p > 0.5 * avg_p):
            _add(i, "Bullish Engulfing", "bullish", 3)

        # Bearish Engulfing
        elif (is_bull[prev] and is_bear[i] and
              o[i] >= c[prev] and c[i] <= o[prev] and
              body_i > body_p and body_p > 0.5 * avg_p):
            _add(i, "Bearish Engulfing", "bearish", 3)

        # Bullish Harami
        elif (is_bear[prev] and is_bull[i] and
              o[i] > c[prev] and c[i] < o[prev] and
              body_i < 0.5 * body_p and body_p > avg_p):
            _add(i, "Bullish Harami", "bullish", 2)

        # Bearish Harami
        elif (is_bull[prev] and is_bear[i] and
              o[i] < c[prev] and c[i] > o[prev] and
              body_i < 0.5 * body_p and body_p > avg_p):
            _add(i, "Bearish Harami", "bearish", 2)

        # Piercing Line
        elif (is_bear[prev] and is_bull[i] and
              o[i] < l[prev] and
              c[i] > (o[prev] + c[prev]) / 2 and c[i] < o[prev] and
              body_p > avg_p):
            _add(i, "Piercing Line", "bullish", 2)

        # Dark Cloud Cover
        elif (is_bull[prev] and is_bear[i] and
              o[i] > h[prev] and
              c[i] < (o[prev] + c[prev]) / 2 and c[i] > o[prev] and
              body_p > avg_p):
            _add(i, "Dark Cloud Cover", "bearish", 2)

        # ── 3-CANDLE PATTERNS ──────────────────────────────────────
        if i >= 2:
            pp = i - 2
            p  = i - 1

            # Morning Star
            if (is_bear[pp] and body[pp] > avg_body[pp] and
                    body[p] < 0.35 * body[pp] and
                    is_bull[i] and body_i > 0.5 * body[pp] and
                    c[i] > (o[pp] + c[pp]) / 2):
                _add(i, "Morning Star", "bullish", 3)

            # Evening Star
            elif (is_bull[pp] and body[pp] > avg_body[pp] and
                  body[p] < 0.35 * body[pp] and
                  is_bear[i] and body_i > 0.5 * body[pp] and
                  c[i] < (o[pp] + c[pp]) / 2):
                _add(i, "Evening Star", "bearish", 3)

            # Three White Soldiers
            elif (is_bull[pp] and is_bull[p] and is_bull[i] and
                  c[pp] > o[pp] * 1.005 and c[p] > o[p] * 1.005 and c[i] > o[i] * 1.005 and
                  c[p] > c[pp] and c[i] > c[p] and
                  o[p] >= o[pp] and o[i] >= o[p] and
                  body[pp] > 0.5 * avg_body[pp] and
                  body[p]  > 0.5 * avg_body[p] and
                  body_i   > 0.5 * avg_i):
                _add(i, "Three White Soldiers", "bullish", 3)

            # Three Black Crows
            elif (is_bear[pp] and is_bear[p] and is_bear[i] and
                  c[p] < c[pp] and c[i] < c[p] and
                  o[p] <= o[pp] and o[i] <= o[p] and
                  body[pp] > 0.5 * avg_body[pp] and
                  body[p]  > 0.5 * avg_body[p] and
                  body_i   > 0.5 * avg_i):
                _add(i, "Three Black Crows", "bearish", 3)

    # Keep only last 60 candles' patterns and deduplicate per date
    # (strongest pattern wins if multiple on same candle)
    seen = {}
    for pat in patterns:
        d = pat["date"]
        if d not in seen or pat["strength"] > seen[d]["strength"]:
            seen[d] = pat
    return list(seen.values())


@app.route("/api/stock-chart/<symbol>", methods=["GET"])
def stock_chart(symbol):
    """
    Returns OHLCV + indicator data for charting.
    ?period=1mo|3mo|6mo|1y  (default: 3mo)
    """
    period = request.args.get("period", "3mo")
    sym = symbol.strip().upper()
    if not sym.endswith(".NS"):
        sym_ns = sym + ".NS"
    else:
        sym_ns = sym

    try:
        import yfinance as yf
        import math

        ticker = yf.Ticker(sym_ns)
        hist = ticker.history(period=period, interval="1d", auto_adjust=True)
        if hist.empty:
            return jsonify({"error": f"No chart data for {sym}"}), 404

        hist = hist.dropna(subset=["Close"])

        # Compute DMAs
        hist["dma20"]  = hist["Close"].rolling(20).mean()
        hist["dma50"]  = hist["Close"].rolling(50).mean()
        hist["dma200"] = hist["Close"].rolling(200).mean()

        # Build candles
        candles = []
        for dt, row in hist.iterrows():
            def sf(v):
                try:
                    f = float(v)
                    return None if math.isnan(f) or math.isinf(f) else round(f, 2)
                except Exception:
                    return None

            candles.append({
                "date":   dt.strftime("%Y-%m-%d"),
                "open":   sf(row["Open"]),
                "high":   sf(row["High"]),
                "low":    sf(row["Low"]),
                "close":  sf(row["Close"]),
                "volume": int(row["Volume"]) if not math.isnan(float(row.get("Volume", 0))) else 0,
                "dma20":  sf(row["dma20"]),
                "dma50":  sf(row["dma50"]),
                "dma200": sf(row["dma200"]),
            })

        # Detect candlestick patterns
        try:
            patterns = _detect_candlestick_patterns(hist)
        except Exception:
            patterns = []

        # Summary stats
        closes = hist["Close"]
        first_close = float(closes.iloc[0]) if len(closes) > 0 else None
        last_close  = float(closes.iloc[-1]) if len(closes) > 0 else None
        chg_pct = round((last_close - first_close) / first_close * 100, 2) if first_close else None

        return jsonify({
            "symbol":   sym,
            "period":   period,
            "candles":  candles,
            "patterns": patterns,
            "summary": {
                "cmp":        round(last_close, 2) if last_close else None,
                "change_pct": chg_pct,
                "high":       round(float(hist["High"].max()), 2),
                "low":        round(float(hist["Low"].min()), 2),
            }
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=config.API_PORT)
    parser.add_argument("--host", default=config.API_HOST)
    args = parser.parse_args()

    print(f"\n  Stock Screener API: http://{args.host}:{args.port}")
    print(f"  Endpoints: /api/summary, /api/top20, /api/signals, /api/stock/<symbol>")
    print(f"  Data dir: {config.DATA_DIR}\n")

    app.run(host=args.host, port=args.port, debug=True)
