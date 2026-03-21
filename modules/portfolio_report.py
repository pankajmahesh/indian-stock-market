"""
Portfolio Report — Performance, diversification, benchmark comparison, and risk.

Compares portfolio vs Nifty50 benchmark, analyses sector allocation,
concentration risk, and generates a diversification score.
"""
import math
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict

import numpy as np
import pandas as pd
import yfinance as yf

import config
from utils.helpers import safe_get
from utils.logger import log


class PortfolioReport:

    def generate(self, symbols_raw):
        """Generate a comprehensive portfolio report."""
        symbols = self._normalize(symbols_raw)
        log.info(f"Portfolio Report: analysing {len(symbols)} stocks")

        # Fetch Nifty50 benchmark
        nifty_sym = config.NIFTY50_TICKER
        try:
            nifty_hist = yf.Ticker(nifty_sym).history(period="1y", auto_adjust=True)
        except Exception:
            nifty_hist = pd.DataFrame()

        nifty_returns = {}
        if nifty_hist is not None and not nifty_hist.empty:
            nifty_close = nifty_hist["Close"]
            now_price = float(nifty_close.iloc[-1])
            for label, days in [("1m", 21), ("3m", 63), ("6m", 126), ("1y", 252)]:
                if len(nifty_close) >= days:
                    old = float(nifty_close.iloc[-days])
                    nifty_returns[label] = round((now_price / old - 1) * 100, 1) if old > 0 else None
                else:
                    nifty_returns[label] = None

        # Fetch stock data in parallel
        stock_data = {}

        def fetch_one(sym):
            try:
                ticker = yf.Ticker(sym)
                hist = ticker.history(period="1y", auto_adjust=True)
                info = ticker.info or {}
                return sym, hist, info
            except Exception:
                return sym, pd.DataFrame(), {}

        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = {pool.submit(fetch_one, s): s for s in symbols}
            for future in as_completed(futures):
                try:
                    sym, hist, info = future.result(timeout=60)
                    stock_data[sym] = (hist, info)
                except Exception:
                    pass

        stocks = []
        sector_map = defaultdict(lambda: {"count": 0, "mcap": 0, "returns": []})
        total_mcap = 0
        all_returns = {"1m": [], "3m": [], "6m": [], "1y": []}
        all_weights = []
        volatilities = []
        drawdowns = []

        for sym in symbols:
            if sym not in stock_data:
                continue
            hist, info = stock_data[sym]
            clean_sym = sym.replace(".NS", "")
            name = safe_get(info, "shortName") or safe_get(info, "longName") or clean_sym
            mcap = safe_get(info, "marketCap")
            cmp = safe_get(info, "currentPrice") or safe_get(info, "regularMarketPrice")
            sector = safe_get(info, "sector") or "Unknown"
            pe = safe_get(info, "trailingPE")
            div_yield = safe_get(info, "dividendYield")

            mcap_cr = round(mcap / 1e7, 1) if mcap else 0
            if mcap:
                total_mcap += mcap

            # Compute period returns
            stock_returns = {}
            if hist is not None and not hist.empty and cmp:
                close = hist["Close"]
                for label, days in [("1m", 21), ("3m", 63), ("6m", 126), ("1y", 252)]:
                    if len(close) >= days:
                        old = float(close.iloc[-days])
                        ret = round((cmp / old - 1) * 100, 1) if old > 0 else None
                        stock_returns[label] = ret
                    else:
                        stock_returns[label] = None

                # Volatility (annualized)
                daily_ret = close.pct_change().dropna()
                if len(daily_ret) > 20:
                    vol = float(daily_ret.std() * np.sqrt(252) * 100)
                    volatilities.append(vol)
                else:
                    vol = None

                # Max drawdown
                cummax = close.cummax()
                dd = ((close - cummax) / cummax * 100)
                max_dd = float(dd.min()) if len(dd) > 0 else None
                if max_dd is not None:
                    drawdowns.append(max_dd)
            else:
                vol = None
                max_dd = None

            # Sector accumulation
            sector_map[sector]["count"] += 1
            sector_map[sector]["mcap"] += mcap or 0
            if stock_returns.get("1y") is not None:
                sector_map[sector]["returns"].append(stock_returns["1y"])

            # Accumulate weighted returns
            for label in ["1m", "3m", "6m", "1y"]:
                r = stock_returns.get(label)
                if r is not None:
                    all_returns[label].append((r, mcap or 0))

            stocks.append({
                "symbol": clean_sym,
                "name": str(name),
                "sector": sector,
                "cmp": round(cmp, 2) if cmp else None,
                "market_cap_cr": mcap_cr,
                "mcap_raw": mcap or 0,
                "pe": round(pe, 1) if pe else None,
                "dividend_yield": round(div_yield * 100, 1) if div_yield else None,
                "return_1m": stock_returns.get("1m"),
                "return_1y": stock_returns.get("1y"),
                "volatility": round(vol, 1) if vol else None,
                "max_drawdown": round(max_dd, 1) if max_dd else None,
            })

        if not stocks:
            return {"error": "No stocks with data"}

        # Weights
        for s in stocks:
            s["weight_pct"] = round(s["mcap_raw"] / total_mcap * 100, 1) if total_mcap > 0 else round(100 / len(stocks), 1)
            del s["mcap_raw"]

        # ---- Performance vs Nifty50 ----
        performance = {}
        for label in ["1m", "3m", "6m", "1y"]:
            if all_returns[label]:
                total_w = sum(w for _, w in all_returns[label])
                if total_w > 0:
                    w_ret = sum(r * w for r, w in all_returns[label]) / total_w
                else:
                    w_ret = np.mean([r for r, _ in all_returns[label]])
                pf_ret = round(float(w_ret), 1)
            else:
                pf_ret = None
            n_ret = nifty_returns.get(label)
            alpha = round(pf_ret - n_ret, 1) if pf_ret is not None and n_ret is not None else None
            performance[label] = {
                "portfolio_pct": pf_ret,
                "nifty_pct": n_ret,
                "alpha": alpha,
            }

        # ---- Sector Allocation ----
        sector_allocation = []
        for sector, data in sector_map.items():
            avg_ret = round(np.mean(data["returns"]), 1) if data["returns"] else None
            weight = round(data["mcap"] / total_mcap * 100, 1) if total_mcap > 0 else 0
            sector_allocation.append({
                "sector": sector,
                "count": data["count"],
                "weight_pct": weight,
                "avg_return_pct": avg_ret,
            })
        sector_allocation.sort(key=lambda x: x["weight_pct"], reverse=True)

        # ---- Risk Summary ----
        avg_vol = round(np.mean(volatilities), 1) if volatilities else None
        worst_dd = round(min(drawdowns), 1) if drawdowns else None

        risk_summary = {
            "avg_volatility": avg_vol,
            "max_drawdown_worst": worst_dd,
            "high_vol_count": sum(1 for v in volatilities if v > 35),
            "stock_count": len(stocks),
        }

        # ---- Concentration Risk ----
        sorted_by_weight = sorted(stocks, key=lambda s: s["weight_pct"], reverse=True)
        top5_weight = sum(s["weight_pct"] for s in sorted_by_weight[:5])
        # HHI = sum of squared weights (each as %)
        hhi = round(sum(s["weight_pct"] ** 2 for s in stocks), 0)
        if hhi > 1500:
            concentration_assessment = "HIGH"
        elif hhi > 600:
            concentration_assessment = "MODERATE"
        else:
            concentration_assessment = "LOW"

        concentration = {
            "top5_weight_pct": round(top5_weight, 1),
            "top5_stocks": [s["symbol"] for s in sorted_by_weight[:5]],
            "hhi_index": int(hhi),
            "assessment": concentration_assessment,
        }

        # ---- Diversification Score (0-100) ----
        # Based on: sector count, concentration, correlation diversity
        unique_sectors = len([s for s in sector_allocation if s["weight_pct"] > 2])
        sector_score = min(40, unique_sectors * 5)  # max 40 points for 8+ sectors
        conc_score = max(0, 30 - top5_weight * 0.4)  # max 30 points if top5 < 25%
        count_score = min(30, len(stocks) * 1.5)  # max 30 points for 20+ stocks
        diversification_score = round(min(100, sector_score + conc_score + count_score))

        # Sort stocks by weight
        stocks.sort(key=lambda s: s["weight_pct"], reverse=True)

        return {
            "performance": performance,
            "sector_allocation": sector_allocation,
            "risk_summary": risk_summary,
            "concentration": concentration,
            "diversification_score": diversification_score,
            "stock_count": len(stocks),
            "stocks": stocks,
        }

    def _normalize(self, symbols_raw):
        symbols = []
        for s in symbols_raw:
            s = s.strip().upper()
            if not s:
                continue
            if not s.endswith(".NS"):
                s += ".NS"
            symbols.append(s)
        return symbols
