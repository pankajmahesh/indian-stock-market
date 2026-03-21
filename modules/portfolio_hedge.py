"""
Portfolio Hedge — Beta calculation and hedging recommendations.

Computes portfolio beta vs Nifty50, and recommends three levels
of protection (Light 30%, Moderate 60%, Full 100%).
"""
import math
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import pandas as pd
import yfinance as yf

import config
from utils.helpers import safe_get
from utils.logger import log


# Nifty50 futures lot size
NIFTY_LOT_SIZE = 25


class PortfolioHedge:

    def analyze(self, symbols_raw, portfolio_value=None):
        """
        Compute portfolio beta vs Nifty50 and recommend hedge strategies.

        Args:
            symbols_raw: list of stock symbols (without .NS)
            portfolio_value: optional total portfolio value in INR;
                             if None, uses sum of market caps as proxy.
        """
        symbols = self._normalize(symbols_raw)
        log.info(f"Portfolio Hedge: analysing {len(symbols)} stocks")

        # Fetch Nifty50 price history
        nifty_sym = config.NIFTY50_TICKER
        try:
            nifty_hist = yf.Ticker(nifty_sym).history(period="1y", auto_adjust=True)
        except Exception:
            nifty_hist = pd.DataFrame()

        if nifty_hist is None or nifty_hist.empty:
            return {"error": "Could not fetch Nifty50 data"}

        nifty_returns = nifty_hist["Close"].pct_change().dropna()
        nifty_price = float(nifty_hist["Close"].iloc[-1])

        # Fetch stock price histories + info in parallel
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
        total_mcap = 0

        for sym in symbols:
            if sym not in stock_data:
                continue
            hist, info = stock_data[sym]
            if hist is None or hist.empty or len(hist) < 30:
                continue

            clean_sym = sym.replace(".NS", "")
            name = safe_get(info, "shortName") or safe_get(info, "longName") or clean_sym
            mcap = safe_get(info, "marketCap")
            cmp = safe_get(info, "currentPrice") or safe_get(info, "regularMarketPrice")

            stock_returns = hist["Close"].pct_change().dropna()

            # Align returns on common dates
            aligned = pd.DataFrame({
                "stock": stock_returns,
                "nifty": nifty_returns,
            }).dropna()

            if len(aligned) < 20:
                continue

            # Compute beta = cov(stock, market) / var(market)
            cov = np.cov(aligned["stock"].values, aligned["nifty"].values)
            var_market = cov[1][1]
            if var_market == 0:
                continue
            beta = float(cov[0][1] / var_market)

            # Correlation
            corr = float(np.corrcoef(aligned["stock"].values, aligned["nifty"].values)[0][1])

            mcap_cr = round(mcap / 1e7, 1) if mcap else None
            if mcap:
                total_mcap += mcap

            stocks.append({
                "symbol": clean_sym,
                "name": str(name),
                "beta": round(beta, 2),
                "correlation": round(corr, 2),
                "cmp": round(cmp, 2) if cmp else None,
                "market_cap_cr": mcap_cr,
                "mcap_raw": mcap or 0,
            })

        if not stocks:
            return {"error": "No stocks with sufficient data for beta calculation"}

        # Compute weights and portfolio beta
        for s in stocks:
            s["weight_pct"] = round(s["mcap_raw"] / total_mcap * 100, 1) if total_mcap > 0 else round(100 / len(stocks), 1)

        portfolio_beta = sum(s["beta"] * s["weight_pct"] / 100 for s in stocks)
        portfolio_corr = sum(s["correlation"] * s["weight_pct"] / 100 for s in stocks)

        # Beta contribution
        for s in stocks:
            s["contribution_to_beta"] = round(s["beta"] * s["weight_pct"] / 100, 3)
            del s["mcap_raw"]

        # Risk assessment
        if portfolio_beta > 1.2:
            risk_assessment = "HIGH"
        elif portfolio_beta > 0.8:
            risk_assessment = "MODERATE"
        else:
            risk_assessment = "LOW"

        # Portfolio value: use provided or estimate from market cap
        pf_value = portfolio_value or total_mcap

        # Protection levels
        protection_levels = []
        for level_name, hedge_pct, desc in [
            ("Light", 30, "Mild correction protection — covers 30% downside"),
            ("Moderate", 60, "Significant downturn protection — covers 60% downside"),
            ("Full", 100, "Complete downside protection — full portfolio hedge"),
        ]:
            hedge_value = pf_value * (hedge_pct / 100) * portfolio_beta
            nifty_lots = max(1, round(hedge_value / (nifty_price * NIFTY_LOT_SIZE)))
            notional = nifty_lots * nifty_price * NIFTY_LOT_SIZE
            # Estimated monthly cost: ~0.8-1.2% of notional for ATM Nifty Puts (rough)
            est_monthly_cost_pct = round(hedge_pct / 100 * 1.0, 1)

            protection_levels.append({
                "level": level_name,
                "hedge_pct": hedge_pct,
                "description": desc,
                "nifty_lots": nifty_lots,
                "notional_value": round(notional / 1e7, 1),
                "estimated_monthly_cost_pct": est_monthly_cost_pct,
            })

        # Sort stocks by beta descending
        stocks.sort(key=lambda s: s["beta"], reverse=True)

        return {
            "portfolio_beta": round(portfolio_beta, 2),
            "portfolio_correlation": round(portfolio_corr, 2),
            "nifty_price": round(nifty_price, 2),
            "risk_assessment": risk_assessment,
            "stock_count": len(stocks),
            "protection_levels": protection_levels,
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
