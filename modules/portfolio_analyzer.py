"""
Portfolio Analyzer — Scans user-owned stocks and provides
long-term ACCUMULATE / HOLD / SELL recommendations.

Integrates:
  - FundamentalScorer (screener Step 3)
  - SignalGenerator (AI-Stock-Trader momentum strategy)
  - RiskAnalyzer (stock-risk-analyzer volatility/BB/drawdown model)
"""
import math
import os

import numpy as np
import pandas as pd
import ta
import yfinance as yf

import config
from modules.data_fetcher import DataFetcher
from modules.risk_analyzer import RiskAnalyzer
from utils.helpers import (
    safe_get, safe_divide, score_by_thresholds,
    compute_cagr, category_score, weighted_score,
)
from utils.logger import log


# ETF symbols (no fundamental data — only technicals + trend)
ETF_KEYWORDS = [
    "NIFTYBEES", "EBBETF", "HDFCNEXT50", "HDFCMOMENT", "LOWVOL",
    "MAFANG", "MOM100", "MON100", "HDFCSILVER", "TMCV",
    "JUNIORBEES", "BANKBEES", "GOLDBEES", "SILVERBEES",
]


def _is_etf(symbol):
    """Check if symbol is likely an ETF/index fund."""
    name = symbol.replace(".NS", "")
    return any(kw in name.upper() for kw in ETF_KEYWORDS)


class PortfolioAnalyzer:
    def __init__(self, skip_cache=False):
        self.fetcher = DataFetcher(skip_cache=skip_cache)
        self.signal_cfg = config.SIGNAL_STRATEGY
        self.risk_analyzer = RiskAnalyzer()

    def analyze(self, symbols_raw, output_filename="portfolio_analysis.csv"):
        """
        Analyze a list of stock symbols for long-term hold decisions.
        Returns DataFrame with recommendation for each stock.
        """
        log.info("=" * 60)
        log.info("PORTFOLIO ANALYSIS")
        log.info(f"Analyzing {len(symbols_raw)} holdings")
        log.info("=" * 60)

        # Normalize and validate symbols → add .NS suffix
        # Skip anything that looks like an MF scheme name, SGB, or has spaces
        _MF_MARKERS = ("MF ", " ETF ", "BOND ETF", "SGB ", "FOF ", " SERIES ", "GROWTH", "DIRECT")
        symbols = []
        skipped = []
        for s in symbols_raw:
            s = s.strip().upper()
            if not s:
                continue
            # Skip multi-word entries — valid NSE symbols never have spaces
            if " " in s:
                skipped.append(s)
                continue
            # Skip obvious MF/SGB entries even if no space (shouldn't happen, but guard)
            if any(m in s for m in _MF_MARKERS):
                skipped.append(s)
                continue
            if not s.endswith(".NS"):
                s += ".NS"
            symbols.append(s)
        if skipped:
            log.warning(f"Skipped {len(skipped)} non-equity entries: {skipped[:5]}{'...' if len(skipped) > 5 else ''}")

        # Split ETFs vs stocks
        etf_syms = [s for s in symbols if _is_etf(s)]
        stock_syms = [s for s in symbols if not _is_etf(s)]

        log.info(f"Stocks: {len(stock_syms)}, ETFs: {len(etf_syms)}")

        # Batch fetch all data
        all_info = self.fetcher.batch_fetch_info(symbols)
        all_prices = self.fetcher.batch_download_prices(symbols)
        all_financials = self.fetcher.batch_fetch_financials(stock_syms)

        results = []

        # Analyze stocks
        for sym in stock_syms:
            info = all_info.get(sym, {})
            fin = all_financials.get(sym, {})
            prices = all_prices.get(sym)
            result = self._analyze_stock(sym, info, fin, prices)
            results.append(result)

        # Analyze ETFs
        for sym in etf_syms:
            info = all_info.get(sym, {})
            prices = all_prices.get(sym)
            result = self._analyze_etf(sym, info, prices)
            results.append(result)

        df = pd.DataFrame(results)
        df = df.sort_values("recommendation_rank", ascending=True)
        df = df.reset_index(drop=True)

        # Save
        out_path = os.path.join(config.DATA_DIR, output_filename)
        df.to_csv(out_path, index=False)
        log.info(f"Portfolio analysis saved to {out_path}")

        # Log summary
        rec_counts = df["recommendation"].value_counts().to_dict()
        log.info(f"Recommendations: {rec_counts}")

        return df

    def _analyze_stock(self, sym, info, fin, prices):
        """Full analysis for a regular stock."""
        name = safe_get(info, "shortName") or safe_get(info, "longName") or sym.replace(".NS", "")
        sector = safe_get(info, "sector") or "Unknown"
        industry = safe_get(info, "industry") or ""
        cmp = safe_get(info, "currentPrice") or safe_get(info, "regularMarketPrice")
        mcap = safe_get(info, "marketCap")
        mcap_cr = round(mcap / 1e7, 1) if mcap else None

        # --- Fundamental Analysis ---
        fund = self._score_fundamentals(info, fin)

        # --- Valuation Assessment ---
        valuation = self._assess_valuation(info)

        # --- Technical Analysis ---
        tech = self._analyze_technicals(prices)
        signal = self._generate_signal(prices, cmp, tech=tech)

        # --- Risk Analysis (from stock-risk-analyzer) ---
        risk = self.risk_analyzer.analyze(prices, cmp)

        # --- DCF Intrinsic Value ---
        dcf_data = None
        try:
            from modules.dcf_calculator import DCFCalculator
            dcf_data = DCFCalculator().calculate(sym, info=info, financials=fin)
        except Exception:
            pass

        # --- Determine long-term recommendation ---
        recommendation, rationale, rank = self._decide_recommendation(
            fund, valuation, tech, signal, info, risk
        )

        # Price change %
        prev_close = safe_get(info, "previousClose") or safe_get(info, "regularMarketPreviousClose")
        change_pct = None
        if cmp and prev_close and prev_close > 0:
            change_pct = round((cmp - prev_close) / prev_close * 100, 2)

        # Promoter / insider holding
        promoter_holding = safe_get(info, "heldPercentInsiders")
        if promoter_holding is not None:
            promoter_holding = round(promoter_holding * 100, 1)

        # Key metrics for display
        pe = safe_get(info, "trailingPE")
        pb = safe_get(info, "priceToBook")
        roe = safe_get(info, "returnOnEquity")
        if roe is not None:
            roe = round(roe * 100, 1)
        de = safe_get(info, "debtToEquity")
        div_yield = safe_get(info, "dividendYield")
        if div_yield is not None:
            div_yield = round(div_yield * 100, 2)
        rev_growth = safe_get(info, "revenueGrowth")
        if rev_growth is not None:
            rev_growth = round(rev_growth * 100, 1)
        earn_growth = safe_get(info, "earningsGrowth")
        if earn_growth is not None:
            earn_growth = round(earn_growth * 100, 1)
        fcf = safe_get(info, "freeCashflow")
        target_price = safe_get(info, "targetMeanPrice")

        # 52-week range
        high_52w = safe_get(info, "fiftyTwoWeekHigh")
        low_52w = safe_get(info, "fiftyTwoWeekLow")
        pct_from_high = None
        if cmp and high_52w and high_52w > 0:
            pct_from_high = round((cmp - high_52w) / high_52w * 100, 1)

        analyst_upside = None
        if target_price and cmp and cmp > 0:
            analyst_upside = round((target_price - cmp) / cmp * 100, 1)

        return {
            "symbol": sym,
            "name": name,
            "type": "STOCK",
            "sector": sector,
            "industry": industry,
            "cmp": cmp,
            "change_pct": change_pct,
            "market_cap_cr": mcap_cr,
            "promoter_holding_pct": promoter_holding,
            "pe_ratio": round(pe, 1) if pe else None,
            "pb_ratio": round(pb, 2) if pb else None,
            "roe_pct": roe,
            "debt_to_equity": round(de, 1) if de else None,
            "dividend_yield_pct": div_yield,
            "revenue_growth_pct": rev_growth,
            "earnings_growth_pct": earn_growth,
            "fcf_cr": round(fcf / 1e7, 1) if fcf else None,
            "52w_high": high_52w,
            "52w_low": low_52w,
            "pct_from_52w_high": pct_from_high,
            "target_price": target_price,
            "analyst_upside_pct": analyst_upside,
            "fundamental_score": fund["score"],
            "valuation_grade": valuation["grade"],
            "valuation_detail": valuation["detail"],
            "trend": tech["trend"],
            "rsi": tech["rsi"],
            "vwap": tech.get("vwap"),
            "supertrend": tech.get("supertrend"),
            "supertrend_signal": tech.get("supertrend_signal"),
            "signal": signal["signal"],
            "signal_strength": signal["strength"],
            "signal_details": signal["details"],
            # Risk metrics (from stock-risk-analyzer)
            "risk_level": risk["risk_level"],
            "risk_score": risk["risk_score"],
            "volatility_ann": risk["volatility_ann"],
            "volatility_percentile": risk["volatility_percentile"],
            "daily_return_pct": risk["daily_return_pct"],
            "bb_pct_b": risk["bb_pct_b"],
            "bb_width_pct": risk["bb_width_pct"],
            "atr_pct": risk["atr_pct"],
            "max_drawdown_pct": risk["max_drawdown_pct"],
            "current_drawdown_pct": risk["current_drawdown_pct"],
            "ma50_deviation_pct": risk["ma50_deviation_pct"],
            "ma200_deviation_pct": risk["ma200_deviation_pct"],
            # DCF Intrinsic Value
            "intrinsic_value": dcf_data["intrinsic_value"] if dcf_data else None,
            "dcf_upside_pct": dcf_data["dcf_upside_pct"] if dcf_data else None,
            "wacc_used": dcf_data["wacc_used"] if dcf_data else None,
            "fcf_growth_used": dcf_data["fcf_growth_used"] if dcf_data else None,
            # Recommendation
            "recommendation": recommendation,
            "recommendation_rank": rank,
            "rationale": rationale,
        }

    def _analyze_etf(self, sym, info, prices):
        """Simplified analysis for ETFs (no fundamentals)."""
        name = safe_get(info, "shortName") or safe_get(info, "longName") or sym.replace(".NS", "")
        cmp = safe_get(info, "currentPrice") or safe_get(info, "regularMarketPrice") or safe_get(info, "navPrice")

        tech = self._analyze_technicals(prices)
        signal = self._generate_signal(prices, cmp, tech=tech)
        risk = self.risk_analyzer.analyze(prices, cmp)

        high_52w = safe_get(info, "fiftyTwoWeekHigh")
        low_52w = safe_get(info, "fiftyTwoWeekLow")
        pct_from_high = None
        if cmp and high_52w and high_52w > 0:
            pct_from_high = round((cmp - high_52w) / high_52w * 100, 1)

        # ETFs: default recommendation based on trend
        if tech["trend"] == "BULLISH":
            recommendation = "ACCUMULATE"
            rationale = "Uptrend intact — continue SIP/accumulate on dips"
            rank = 1
        elif tech["trend"] == "NEUTRAL":
            recommendation = "HOLD"
            rationale = "Sideways trend — hold existing position"
            rank = 2
        else:
            recommendation = "HOLD"
            rationale = "Index ETF — hold for long-term; temporary weakness"
            rank = 2

        return {
            "symbol": sym,
            "name": name,
            "type": "ETF",
            "sector": "ETF/Index",
            "industry": "",
            "cmp": cmp,
            "market_cap_cr": None,
            "pe_ratio": None,
            "pb_ratio": None,
            "roe_pct": None,
            "debt_to_equity": None,
            "dividend_yield_pct": None,
            "revenue_growth_pct": None,
            "earnings_growth_pct": None,
            "fcf_cr": None,
            "52w_high": high_52w,
            "52w_low": low_52w,
            "pct_from_52w_high": pct_from_high,
            "target_price": None,
            "analyst_upside_pct": None,
            "fundamental_score": None,
            "valuation_grade": "N/A",
            "valuation_detail": "ETF — no valuation scoring",
            "trend": tech["trend"],
            "rsi": tech["rsi"],
            "vwap": tech.get("vwap"),
            "supertrend": tech.get("supertrend"),
            "supertrend_signal": tech.get("supertrend_signal"),
            "signal": signal["signal"],
            "signal_strength": signal["strength"],
            "signal_details": signal["details"],
            # Risk metrics
            "risk_level": risk["risk_level"],
            "risk_score": risk["risk_score"],
            "volatility_ann": risk["volatility_ann"],
            "volatility_percentile": risk["volatility_percentile"],
            "daily_return_pct": risk["daily_return_pct"],
            "bb_pct_b": risk["bb_pct_b"],
            "bb_width_pct": risk["bb_width_pct"],
            "atr_pct": risk["atr_pct"],
            "max_drawdown_pct": risk["max_drawdown_pct"],
            "current_drawdown_pct": risk["current_drawdown_pct"],
            "ma50_deviation_pct": risk["ma50_deviation_pct"],
            "ma200_deviation_pct": risk["ma200_deviation_pct"],
            # Recommendation
            "recommendation": recommendation,
            "recommendation_rank": rank,
            "rationale": rationale,
        }

    # ----------------------------------------------------------
    # Fundamental scoring (reuses screener logic)
    # ----------------------------------------------------------
    def _score_fundamentals(self, info, fin):
        """Score stock fundamentals 0-100."""
        from modules.fundamental_scorer import FundamentalScorer
        scorer = FundamentalScorer(self.fetcher)
        scores = scorer._score_stock(info, fin)
        return {"score": scores.get("fundamental_score", 0), "detail": scores}

    # ----------------------------------------------------------
    # Valuation assessment
    # ----------------------------------------------------------
    def _assess_valuation(self, info):
        """Grade the valuation: CHEAP / FAIR / EXPENSIVE / VERY_EXPENSIVE."""
        pe = safe_get(info, "trailingPE")
        pb = safe_get(info, "priceToBook")
        peg = safe_get(info, "pegRatio")

        scores = []

        if pe is not None and pe > 0:
            if pe < 15:
                scores.append(("PE", "cheap", 3))
            elif pe < 25:
                scores.append(("PE", "fair", 2))
            elif pe < 45:
                scores.append(("PE", "expensive", 1))
            else:
                scores.append(("PE", "very expensive", 0))

        if pb is not None and pb > 0:
            if pb < 2:
                scores.append(("PB", "cheap", 3))
            elif pb < 4:
                scores.append(("PB", "fair", 2))
            elif pb < 8:
                scores.append(("PB", "expensive", 1))
            else:
                scores.append(("PB", "very expensive", 0))

        if peg is not None and peg > 0:
            if peg < 1:
                scores.append(("PEG", "cheap", 3))
            elif peg < 1.5:
                scores.append(("PEG", "fair", 2))
            elif peg < 2.5:
                scores.append(("PEG", "expensive", 1))
            else:
                scores.append(("PEG", "very expensive", 0))

        if not scores:
            return {"grade": "UNKNOWN", "detail": "Insufficient valuation data"}

        avg_score = np.mean([s[2] for s in scores])
        details = ", ".join(f"{s[0]}: {s[1]}" for s in scores)

        if avg_score >= 2.5:
            return {"grade": "CHEAP", "detail": details}
        elif avg_score >= 1.5:
            return {"grade": "FAIR", "detail": details}
        elif avg_score >= 0.5:
            return {"grade": "EXPENSIVE", "detail": details}
        else:
            return {"grade": "VERY_EXPENSIVE", "detail": details}

    # ----------------------------------------------------------
    # Technical trend analysis
    # ----------------------------------------------------------
    def _compute_vwap(self, prices, period=20):
        """Compute rolling VWAP over given period."""
        try:
            high = prices["High"].astype(float)
            low = prices["Low"].astype(float)
            close = prices["Close"].astype(float)
            volume = prices["Volume"].astype(float)
            typical_price = (high + low + close) / 3
            cum_tp_vol = (typical_price * volume).rolling(window=period).sum()
            cum_vol = volume.rolling(window=period).sum()
            vwap = cum_tp_vol / cum_vol
            return round(float(vwap.iloc[-1]), 2) if not math.isnan(vwap.iloc[-1]) else None
        except Exception:
            return None

    def _compute_supertrend(self, prices, period=10, multiplier=3.0):
        """Compute Supertrend indicator."""
        try:
            high = prices["High"].astype(float)
            low = prices["Low"].astype(float)
            close = prices["Close"].astype(float)
            n = len(close)
            if n < period + 1:
                return None, None

            # ATR
            tr1 = high - low
            tr2 = (high - close.shift(1)).abs()
            tr3 = (low - close.shift(1)).abs()
            tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
            atr = tr.rolling(window=period).mean()

            hl2 = (high + low) / 2
            upper_basic = hl2 + multiplier * atr
            lower_basic = hl2 - multiplier * atr

            upper_band = upper_basic.copy()
            lower_band = lower_basic.copy()
            supertrend = pd.Series(index=close.index, dtype=float)
            direction = pd.Series(index=close.index, dtype=int)

            for i in range(period, n):
                if i == period:
                    upper_band.iloc[i] = upper_basic.iloc[i]
                    lower_band.iloc[i] = lower_basic.iloc[i]
                    direction.iloc[i] = -1 if close.iloc[i] > upper_band.iloc[i] else 1
                else:
                    # Upper band
                    if upper_basic.iloc[i] < upper_band.iloc[i - 1] or close.iloc[i - 1] > upper_band.iloc[i - 1]:
                        upper_band.iloc[i] = upper_basic.iloc[i]
                    else:
                        upper_band.iloc[i] = upper_band.iloc[i - 1]
                    # Lower band
                    if lower_basic.iloc[i] > lower_band.iloc[i - 1] or close.iloc[i - 1] < lower_band.iloc[i - 1]:
                        lower_band.iloc[i] = lower_basic.iloc[i]
                    else:
                        lower_band.iloc[i] = lower_band.iloc[i - 1]
                    # Direction
                    if direction.iloc[i - 1] == 1:  # was downtrend
                        if close.iloc[i] > upper_band.iloc[i]:
                            direction.iloc[i] = -1  # switch to uptrend
                        else:
                            direction.iloc[i] = 1
                    else:  # was uptrend
                        if close.iloc[i] < lower_band.iloc[i]:
                            direction.iloc[i] = 1  # switch to downtrend
                        else:
                            direction.iloc[i] = -1

                supertrend.iloc[i] = lower_band.iloc[i] if direction.iloc[i] == -1 else upper_band.iloc[i]

            st_value = round(float(supertrend.iloc[-1]), 2) if not math.isnan(supertrend.iloc[-1]) else None
            st_signal = "BUY" if direction.iloc[-1] == -1 else "SELL"
            return st_value, st_signal
        except Exception:
            return None, None

    def _analyze_technicals(self, prices):
        """Determine trend direction, RSI, VWAP and Supertrend."""
        if prices is None or prices.empty or len(prices) < 50:
            return {"trend": "UNKNOWN", "rsi": None, "vwap": None, "supertrend": None, "supertrend_signal": None}

        close = prices["Close"].astype(float)

        try:
            ema20 = close.ewm(span=20).mean().iloc[-1]
            ema50 = close.ewm(span=50).mean().iloc[-1]
            ema200 = close.ewm(span=200).mean().iloc[-1] if len(close) >= 200 else None
            current = close.iloc[-1]

            rsi_ind = ta.momentum.RSIIndicator(close, window=14)
            rsi = rsi_ind.rsi().iloc[-1]
            if math.isnan(rsi):
                rsi = None
            else:
                rsi = round(rsi, 1)

            # VWAP
            vwap = self._compute_vwap(prices)

            # Supertrend
            st_value, st_signal = self._compute_supertrend(prices)

            # Trend classification
            if ema200 is not None:
                if current > ema20 > ema50 > ema200:
                    trend = "BULLISH"
                elif current < ema20 < ema50 < ema200:
                    trend = "BEARISH"
                elif current > ema50:
                    trend = "NEUTRAL"
                else:
                    trend = "WEAK"
            else:
                if current > ema20 > ema50:
                    trend = "BULLISH"
                elif current < ema20 < ema50:
                    trend = "BEARISH"
                else:
                    trend = "NEUTRAL"

            return {"trend": trend, "rsi": rsi, "vwap": vwap, "supertrend": st_value, "supertrend_signal": st_signal}
        except Exception:
            return {"trend": "UNKNOWN", "rsi": None, "vwap": None, "supertrend": None, "supertrend_signal": None}

    # ----------------------------------------------------------
    # Signal generation (reuses AI-Stock-Trader logic)
    # ----------------------------------------------------------
    def _generate_signal(self, prices, cmp, tech=None):
        """Generate BUY/SELL/HOLD momentum signal with VWAP & Supertrend."""
        if prices is None or prices.empty or len(prices) < 30:
            return {"signal": "NO_DATA", "strength": 0, "details": ""}

        try:
            close = prices["Close"].astype(float)
            cfg = self.signal_cfg

            # RSI
            rsi_ind = ta.momentum.RSIIndicator(close, window=cfg["rsi_period"])
            rsi_series = rsi_ind.rsi()

            # StochRSI
            stoch_ind = ta.momentum.StochRSIIndicator(
                close, window=cfg["stochrsi_period"],
                smooth1=cfg["stochrsi_smooth_k"],
                smooth2=cfg["stochrsi_smooth_d"],
            )
            stochrsi_k = stoch_ind.stochrsi_k() * 100

            # MACD
            macd_ind = ta.trend.MACD(
                close, window_fast=cfg["macd_fast"],
                window_slow=cfg["macd_slow"],
                window_sign=cfg["macd_signal"],
            )
            macd_line = macd_ind.macd()
            macd_signal = macd_ind.macd_signal()
            macd_hist = macd_ind.macd_diff()

            if len(rsi_series.dropna()) < 2:
                return {"signal": "NO_DATA", "strength": 0, "details": ""}

            rsi = rsi_series.iloc[-1]
            rsi_prev = rsi_series.iloc[-2]
            sk = stochrsi_k.iloc[-1]
            sk_prev = stochrsi_k.iloc[-2]

            buy_sigs, sell_sigs = [], []
            strength = 0

            # Combined momentum
            if sk > sk_prev and rsi > rsi_prev and sk < cfg["stochrsi_overbought"] and rsi < cfg["rsi_overbought"]:
                buy_sigs.append("Momentum rising")
                strength += 3
            if sk < sk_prev and rsi < rsi_prev and sk > cfg["stochrsi_oversold"] and rsi > cfg["rsi_oversold"]:
                sell_sigs.append("Momentum falling")
                strength -= 3

            # MACD crossover
            if macd_line.iloc[-1] > macd_signal.iloc[-1] and macd_line.iloc[-2] <= macd_signal.iloc[-2]:
                buy_sigs.append("MACD bullish crossover")
                strength += 2
            if macd_line.iloc[-1] < macd_signal.iloc[-1] and macd_line.iloc[-2] >= macd_signal.iloc[-2]:
                sell_sigs.append("MACD bearish crossover")
                strength -= 2

            # RSI zones
            if rsi < 35:
                buy_sigs.append("RSI oversold")
                strength += 1
            elif rsi > 65:
                sell_sigs.append("RSI overbought")
                strength -= 1

            # MACD histogram
            if macd_hist.iloc[-1] > 0 and macd_line.iloc[-1] > macd_signal.iloc[-1]:
                buy_sigs.append("MACD positive")
                strength += 1
            elif macd_hist.iloc[-1] < 0 and macd_line.iloc[-1] < macd_signal.iloc[-1]:
                sell_sigs.append("MACD negative")
                strength -= 1

            # VWAP confirmation
            if tech and cmp:
                vwap = tech.get("vwap")
                if vwap and cmp > vwap:
                    buy_sigs.append(f"Price above VWAP ({vwap:.0f})")
                    strength += 1
                elif vwap and cmp < vwap:
                    sell_sigs.append(f"Price below VWAP ({vwap:.0f})")
                    strength -= 1

                # Supertrend confirmation
                st_signal = tech.get("supertrend_signal")
                if st_signal == "BUY":
                    buy_sigs.append("Supertrend BUY")
                    strength += 1
                elif st_signal == "SELL":
                    sell_sigs.append("Supertrend SELL")
                    strength -= 1

            if strength >= 3:
                return {"signal": "BUY", "strength": strength, "details": " | ".join(buy_sigs)}
            elif strength <= -3:
                return {"signal": "SELL", "strength": strength, "details": " | ".join(sell_sigs)}
            else:
                all_d = buy_sigs + sell_sigs
                return {"signal": "HOLD", "strength": strength, "details": " | ".join(all_d) if all_d else "No strong signal"}
        except Exception as e:
            log.warning(f"Signal calculation error: {e}")
            return {"signal": "NO_DATA", "strength": 0, "details": ""}

    # ----------------------------------------------------------
    # Final recommendation engine
    # ----------------------------------------------------------
    def _decide_recommendation(self, fund, valuation, tech, signal, info, risk=None):
        """
        Decide ACCUMULATE / HOLD / SELL for long-term investors.

        Factors:
        - Fundamentals (0-100 score)
        - Valuation (CHEAP/FAIR/EXPENSIVE/VERY_EXPENSIVE)
        - Trend (BULLISH/NEUTRAL/BEARISH/WEAK)
        - Risk level (LOW/MEDIUM/HIGH) from stock-risk-analyzer
        - Analyst targets
        """
        fscore = fund["score"] or 0
        vgrade = valuation["grade"]
        trend = tech["trend"]
        risk_level = (risk or {}).get("risk_level", "UNKNOWN")
        risk_score = (risk or {}).get("risk_score")

        reasons = []
        score = 0  # internal decision score: positive → accumulate, negative → sell

        # Fundamental contribution
        if fscore >= 70:
            score += 3
            reasons.append(f"Strong fundamentals ({fscore:.0f}/100)")
        elif fscore >= 55:
            score += 2
            reasons.append(f"Good fundamentals ({fscore:.0f}/100)")
        elif fscore >= 40:
            score += 1
            reasons.append(f"Average fundamentals ({fscore:.0f}/100)")
        elif fscore > 0:
            score -= 1
            reasons.append(f"Weak fundamentals ({fscore:.0f}/100)")
        else:
            reasons.append("No fundamental data")

        # Valuation contribution
        if vgrade == "CHEAP":
            score += 2
            reasons.append("Attractively valued")
        elif vgrade == "FAIR":
            score += 1
            reasons.append("Fairly valued")
        elif vgrade == "EXPENSIVE":
            score -= 1
            reasons.append("Expensively valued")
        elif vgrade == "VERY_EXPENSIVE":
            score -= 2
            reasons.append("Very expensive valuation")

        # Trend contribution
        if trend == "BULLISH":
            score += 1
            reasons.append("Bullish trend")
        elif trend == "BEARISH":
            score -= 1
            reasons.append("Bearish trend")
        elif trend == "WEAK":
            score -= 1
            reasons.append("Weak price trend")

        # Risk contribution (from stock-risk-analyzer model)
        if risk_level == "LOW":
            score += 1
            reasons.append(f"Low risk (score {risk_score}/100)")
        elif risk_level == "HIGH":
            score -= 1
            reasons.append(f"High risk (score {risk_score}/100)")
        elif risk_level == "MEDIUM" and risk_score is not None:
            reasons.append(f"Medium risk (score {risk_score}/100)")

        # Analyst upside
        target = safe_get(info, "targetMeanPrice")
        cmp = safe_get(info, "currentPrice") or safe_get(info, "regularMarketPrice")
        if target and cmp and cmp > 0:
            upside = (target - cmp) / cmp * 100
            if upside > 15:
                score += 1
                reasons.append(f"Analysts see {upside:.0f}% upside")
            elif upside < -10:
                score -= 1
                reasons.append(f"Analysts see {abs(upside):.0f}% downside")

        # Decision
        if score >= 4:
            rec = "STRONG BUY"
            rank = 0
        elif score >= 2:
            rec = "ACCUMULATE"
            rank = 1
        elif score >= 0:
            rec = "HOLD"
            rank = 2
        elif score >= -2:
            rec = "REDUCE"
            rank = 3
        else:
            rec = "SELL"
            rank = 4

        rationale = ". ".join(reasons)
        return rec, rationale, rank
