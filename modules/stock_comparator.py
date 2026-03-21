"""
Stock Comparator — Multi-factor weighted comparison of two stocks.

Computes scores across 10 categories, normalizes them, and produces
a verdict with radar-chart data, category breakdowns, and warnings.
"""
import math
import numpy as np
import yfinance as yf

from utils.helpers import safe_get, safe_divide
from utils.logger import log
from modules.dcf_calculator import DCFCalculator
from modules.risk_analyzer import RiskAnalyzer
from modules.data_fetcher import DataFetcher

# ── Category weights (must sum to 1.0) ──────────────────────────
CATEGORY_WEIGHTS = {
    "Intrinsic Valuation": 0.16,
    "Relative Valuation":  0.13,
    "Profitability":       0.16,
    "Cash Flow":           0.13,
    "Growth":              0.11,
    "Financial Health":    0.11,
    "Price Performance":   0.05,
    "Risk":                0.05,
    "Momentum":            0.03,
    "Analyst Sentiment":   0.07,
}

# Direction: True = higher is better, False = lower is better
METRIC_DIRECTION = {
    # Intrinsic Valuation
    "dcf_upside_pct": True,
    "margin_of_safety": True,
    # Relative Valuation (lower is better for value metrics)
    "pe_ratio": False,
    "pb_ratio": False,
    "ps_ratio": False,
    "peg_ratio": False,
    "ev_ebitda": False,
    # Profitability
    "roe": True,
    "roa": True,
    "operating_margin": True,
    "profit_margin": True,
    "gross_margin": True,
    # Cash Flow
    "fcf_yield": True,
    "fcf_to_net_income": True,
    "ocf_growth": True,
    # Growth
    "revenue_growth": True,
    "earnings_growth": True,
    "eps_growth": True,
    # Financial Health
    "debt_to_equity": False,
    "current_ratio": True,
    "interest_coverage": True,
    "altman_z": True,
    # Price Performance
    "52w_return": True,
    "vs_52w_high": True,  # closer to 0 (i.e. near high) is better
    # Risk (lower is better for risk metrics)
    "beta": False,
    "volatility": False,
    "max_drawdown": False,
    "sharpe_ratio": True,
    # Momentum
    "rsi": True,  # moderate RSI is good, handled specially
    "price_vs_sma50": True,
    "price_vs_sma200": True,
    # Analyst Sentiment
    "target_upside": True,
    "recommendation_score": False,  # lower = stronger buy (1=strong buy,5=sell)
    "analyst_count": True,
}

# Metric → category mapping
METRIC_CATEGORIES = {
    "dcf_upside_pct": "Intrinsic Valuation",
    "margin_of_safety": "Intrinsic Valuation",
    "pe_ratio": "Relative Valuation",
    "pb_ratio": "Relative Valuation",
    "ps_ratio": "Relative Valuation",
    "peg_ratio": "Relative Valuation",
    "ev_ebitda": "Relative Valuation",
    "roe": "Profitability",
    "roa": "Profitability",
    "operating_margin": "Profitability",
    "profit_margin": "Profitability",
    "gross_margin": "Profitability",
    "fcf_yield": "Cash Flow",
    "fcf_to_net_income": "Cash Flow",
    "ocf_growth": "Cash Flow",
    "revenue_growth": "Growth",
    "earnings_growth": "Growth",
    "eps_growth": "Growth",
    "debt_to_equity": "Financial Health",
    "current_ratio": "Financial Health",
    "interest_coverage": "Financial Health",
    "altman_z": "Financial Health",
    "52w_return": "Price Performance",
    "vs_52w_high": "Price Performance",
    "beta": "Risk",
    "volatility": "Risk",
    "max_drawdown": "Risk",
    "sharpe_ratio": "Risk",
    "rsi": "Momentum",
    "price_vs_sma50": "Momentum",
    "price_vs_sma200": "Momentum",
    "target_upside": "Analyst Sentiment",
    "recommendation_score": "Analyst Sentiment",
    "analyst_count": "Analyst Sentiment",
}

# Human readable metric labels
METRIC_LABELS = {
    "dcf_upside_pct": "DCF Upside %",
    "margin_of_safety": "Margin of Safety %",
    "pe_ratio": "P/E Ratio",
    "pb_ratio": "P/B Ratio",
    "ps_ratio": "P/S Ratio",
    "peg_ratio": "PEG Ratio",
    "ev_ebitda": "EV/EBITDA",
    "roe": "ROE %",
    "roa": "ROA %",
    "operating_margin": "Operating Margin %",
    "profit_margin": "Profit Margin %",
    "gross_margin": "Gross Margin %",
    "fcf_yield": "FCF Yield %",
    "fcf_to_net_income": "FCF / Net Income",
    "ocf_growth": "OCF Growth %",
    "revenue_growth": "Revenue Growth %",
    "earnings_growth": "Earnings Growth %",
    "eps_growth": "EPS Growth %",
    "debt_to_equity": "Debt/Equity",
    "current_ratio": "Current Ratio",
    "interest_coverage": "Interest Coverage",
    "altman_z": "Altman Z-Score",
    "52w_return": "52-Week Return %",
    "vs_52w_high": "% From 52W High",
    "beta": "Beta",
    "volatility": "Volatility %",
    "max_drawdown": "Max Drawdown %",
    "sharpe_ratio": "Sharpe Ratio",
    "rsi": "RSI",
    "price_vs_sma50": "Price vs SMA50 %",
    "price_vs_sma200": "Price vs SMA200 %",
    "target_upside": "Target Upside %",
    "recommendation_score": "Analyst Rating",
    "analyst_count": "# Analysts",
}


def _clean(val):
    """Return None for NaN/Inf/non-finite, otherwise the value."""
    if val is None:
        return None
    try:
        if isinstance(val, (float, np.floating)):
            if math.isnan(val) or math.isinf(val):
                return None
            return float(val)
        if isinstance(val, (np.integer,)):
            return int(val)
    except (TypeError, ValueError):
        return None
    return val


class StockComparator:
    """Compare two stocks across multiple fundamental & technical categories."""

    def __init__(self):
        self.fetcher = DataFetcher()
        self.dcf = DCFCalculator()
        self.risk = RiskAnalyzer()

    def compare(self, symbol1, symbol2):
        """
        Run full comparison and return structured result dict.

        Args:
            symbol1, symbol2: NSE symbols (with or without .NS)

        Returns:
            dict with stock data, scores, radar_data, verdict, warnings
        """
        if not symbol1.endswith(".NS"):
            symbol1 += ".NS"
        if not symbol2.endswith(".NS"):
            symbol2 += ".NS"

        data1 = self._fetch_stock_data(symbol1)
        data2 = self._fetch_stock_data(symbol2)

        if not data1 or not data2:
            missing = []
            if not data1:
                missing.append(symbol1.replace(".NS", ""))
            if not data2:
                missing.append(symbol2.replace(".NS", ""))
            return {"error": f"Could not fetch data for: {', '.join(missing)}"}

        try:
            metrics1 = self._extract_metrics(data1)
            metrics2 = self._extract_metrics(data2)

            scores1, scores2 = self._score_stocks(metrics1, metrics2)

            composite1 = self._composite_score(scores1)
            composite2 = self._composite_score(scores2)

            # Per-stock signal assessment (trend, risk, action)
            signals1 = self._assess_signals(data1, metrics1, scores1, composite1)
            signals2 = self._assess_signals(data2, metrics2, scores2, composite2)

            piotroski1 = self._piotroski_f_score(data1)
            piotroski2 = self._piotroski_f_score(data2)

            verdict = self._generate_verdict(
                data1, data2, composite1, composite2, scores1, scores2,
                metrics1, metrics2, signals1, signals2, piotroski1, piotroski2,
            )
            warnings = self._generate_warnings(data1, data2, metrics1, metrics2)

            radar_data = self._build_radar_data(scores1, scores2, data1, data2)
            category_breakdown = self._build_category_breakdown(scores1, scores2, data1, data2)
            metrics_comparison = self._build_metrics_comparison(metrics1, metrics2)

            altman1 = metrics1.get("altman_z")
            altman2 = metrics2.get("altman_z")

            return {
                "stock1": self._stock_summary(data1, scores1, composite1, metrics1, signals1),
                "stock2": self._stock_summary(data2, scores2, composite2, metrics2, signals2),
                "radar_data": radar_data,
                "verdict": verdict,
                "category_breakdown": category_breakdown,
                "metrics_comparison": metrics_comparison,
                "warnings": warnings,
                "piotroski": {"stock1": piotroski1, "stock2": piotroski2},
                "altman_z": {
                    "stock1": round(altman1, 2) if altman1 is not None else None,
                    "stock2": round(altman2, 2) if altman2 is not None else None,
                },
            }
        except Exception as e:
            log.error(f"Comparison failed for {symbol1} vs {symbol2}: {e}")
            return {"error": f"Comparison failed: {str(e)}"}

    # ── Data fetching ────────────────────────────────────────────

    def _fetch_stock_data(self, symbol):
        """Fetch all data needed for comparison."""
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info or {}
            if not info or not info.get("currentPrice"):
                return None

            financials = {
                "income": ticker.financials,
                "balance_sheet": ticker.balance_sheet,
                "cashflow": ticker.cashflow,
            }

            prices = self.fetcher.get_price_history(symbol, period="1y")

            dcf_result = None
            try:
                dcf_result = self.dcf.calculate(
                    symbol, info=info,
                    financials={
                        "cashflow": financials["cashflow"],
                        "balance_sheet": financials["balance_sheet"],
                    }
                )
            except Exception:
                pass

            risk_result = {}
            try:
                cmp = info.get("currentPrice") or info.get("regularMarketPrice")
                risk_result = self.risk.analyze(prices, current_price=cmp)
            except Exception:
                pass

            return {
                "symbol": symbol,
                "info": info,
                "financials": financials,
                "prices": prices,
                "dcf": dcf_result,
                "risk": risk_result,
            }
        except Exception as e:
            log.warning(f"Failed to fetch data for {symbol}: {e}")
            return None

    # ── Metric extraction ────────────────────────────────────────

    def _extract_metrics(self, data):
        """Extract all raw metric values from stock data."""
        info = data["info"]
        dcf = data.get("dcf") or {}
        risk = data.get("risk") or {}
        prices = data.get("prices")
        financials = data.get("financials") or {}

        cmp = safe_get(info, "currentPrice") or safe_get(info, "regularMarketPrice")
        mcap = safe_get(info, "marketCap")

        # FCF yield
        fcf = safe_get(info, "freeCashflow")
        fcf_yield = None
        if fcf is not None and mcap and mcap > 0:
            fcf_yield = round(fcf / mcap * 100, 2)

        # FCF / Net Income
        net_income = safe_get(info, "netIncomeToCommon")
        fcf_to_ni = None
        if fcf is not None and net_income and net_income > 0:
            fcf_to_ni = round(fcf / net_income, 2)

        # Operating cash flow growth (from cashflow statements)
        ocf_growth = self._compute_ocf_growth(financials.get("cashflow"))

        # 52-week return
        w52_high = safe_get(info, "fiftyTwoWeekHigh")
        w52_low = safe_get(info, "fiftyTwoWeekLow")
        w52_return = None
        vs_52w_high = None
        if cmp and w52_low and w52_low > 0:
            w52_return = round((cmp - w52_low) / w52_low * 100, 1)
        if cmp and w52_high and w52_high > 0:
            vs_52w_high = round((cmp - w52_high) / w52_high * 100, 1)

        # RSI (14-day)
        rsi = self._compute_rsi(prices)

        # SMA deviations
        price_vs_sma50 = risk.get("ma50_deviation_pct")
        price_vs_sma200 = risk.get("ma200_deviation_pct")

        # Interest coverage from financials
        interest_coverage = self._compute_interest_coverage(financials, info)

        # Altman Z-Score
        altman_z = self._compute_altman_z(financials, info)

        # Sharpe ratio from risk data
        sharpe = self._compute_sharpe(prices)

        metrics = {
            # Intrinsic Valuation
            "dcf_upside_pct": dcf.get("dcf_upside_pct"),
            "margin_of_safety": dcf.get("dcf_upside_pct"),  # same concept

            # Relative Valuation
            "pe_ratio": safe_get(info, "trailingPE"),
            "pb_ratio": safe_get(info, "priceToBook"),
            "ps_ratio": safe_get(info, "priceToSalesTrailing12Months"),
            "peg_ratio": safe_get(info, "pegRatio"),
            "ev_ebitda": safe_get(info, "enterpriseToEbitda"),

            # Profitability
            "roe": self._to_pct(safe_get(info, "returnOnEquity")),
            "roa": self._to_pct(safe_get(info, "returnOnAssets")),
            "operating_margin": self._to_pct(safe_get(info, "operatingMargins")),
            "profit_margin": self._to_pct(safe_get(info, "profitMargins")),
            "gross_margin": self._to_pct(safe_get(info, "grossMargins")),

            # Cash Flow
            "fcf_yield": fcf_yield,
            "fcf_to_net_income": fcf_to_ni,
            "ocf_growth": ocf_growth,

            # Growth
            "revenue_growth": self._to_pct(safe_get(info, "revenueGrowth")),
            "earnings_growth": self._to_pct(safe_get(info, "earningsGrowth")),
            "eps_growth": self._to_pct(safe_get(info, "earningsQuarterlyGrowth")),

            # Financial Health
            "debt_to_equity": self._de_ratio(safe_get(info, "debtToEquity")),
            "current_ratio": safe_get(info, "currentRatio"),
            "interest_coverage": interest_coverage,
            "altman_z": altman_z,

            # Price Performance
            "52w_return": w52_return,
            "vs_52w_high": vs_52w_high,

            # Risk
            "beta": safe_get(info, "beta"),
            "volatility": risk.get("volatility_ann"),
            "max_drawdown": abs(risk.get("max_drawdown_pct") or 0) if risk.get("max_drawdown_pct") is not None else None,
            "sharpe_ratio": sharpe,

            # Momentum
            "rsi": rsi,
            "price_vs_sma50": price_vs_sma50,
            "price_vs_sma200": price_vs_sma200,

            # Analyst Sentiment
            "target_upside": self._target_upside(info, cmp),
            "recommendation_score": safe_get(info, "recommendationMean"),
            "analyst_count": safe_get(info, "numberOfAnalystOpinions"),
        }
        # Sanitize all values — replace NaN/Inf with None
        return {k: _clean(v) for k, v in metrics.items()}

    # ── Normalization & Scoring ──────────────────────────────────

    def _score_stocks(self, metrics1, metrics2):
        """Normalize and score both stocks across all categories."""
        scores1 = {}
        scores2 = {}

        for category in CATEGORY_WEIGHTS:
            cat_metrics = [m for m, c in METRIC_CATEGORIES.items() if c == category]
            s1_vals = []
            s2_vals = []

            for metric in cat_metrics:
                v1 = metrics1.get(metric)
                v2 = metrics2.get(metric)
                higher_better = METRIC_DIRECTION.get(metric, True)

                n1, n2 = self._normalize_pair(v1, v2, higher_better, metric)
                s1_vals.append(n1)
                s2_vals.append(n2)

            valid1 = [v for v in s1_vals if v is not None]
            valid2 = [v for v in s2_vals if v is not None]

            scores1[category] = round(np.mean(valid1), 1) if valid1 else 50.0
            scores2[category] = round(np.mean(valid2), 1) if valid2 else 50.0

        return scores1, scores2

    def _normalize_pair(self, v1, v2, higher_better, metric=None):
        """
        Normalize a pair of values to 0-100 scale.
        Uses relative comparison: better value gets higher score.
        """
        if v1 is None and v2 is None:
            return None, None
        if v1 is None:
            return 50.0, 50.0  # neutral when one is missing
        if v2 is None:
            return 50.0, 50.0

        # Special handling for RSI: closer to 50-60 is ideal
        if metric == "rsi":
            ideal = 55
            dist1 = abs(v1 - ideal)
            dist2 = abs(v2 - ideal)
            total = dist1 + dist2
            if total == 0:
                return 50.0, 50.0
            # Lower distance from ideal = better
            n1 = round((1 - dist1 / total) * 100, 1)
            n2 = round((1 - dist2 / total) * 100, 1)
            return n1, n2

        # General min-max normalization between the two values
        vals = [v1, v2]
        vmin = min(vals)
        vmax = max(vals)

        if vmax == vmin:
            return 50.0, 50.0

        span = vmax - vmin
        if higher_better:
            n1 = (v1 - vmin) / span * 100
            n2 = (v2 - vmin) / span * 100
        else:
            # Lower is better → invert
            n1 = (vmax - v1) / span * 100
            n2 = (vmax - v2) / span * 100

        # Scale to 25-75 range to avoid extreme scores from single pair comparison
        n1 = 25 + n1 * 0.5
        n2 = 25 + n2 * 0.5

        return round(n1, 1), round(n2, 1)

    def _composite_score(self, scores):
        """Weighted average composite score."""
        total = 0
        weight_sum = 0
        for category, weight in CATEGORY_WEIGHTS.items():
            s = scores.get(category)
            if s is not None:
                total += s * weight
                weight_sum += weight
        if weight_sum == 0:
            return 50.0
        return round(total / weight_sum, 1)

    # ── Signal Assessment (per-stock) ──────────────────────────

    def _assess_signals(self, data, metrics, scores, composite):
        """
        Derive technical/fundamental signals for a single stock.
        Returns: trend, risk_level, st_signal, action, and reasoning.
        """
        risk_data = data.get("risk") or {}
        info = data["info"]

        rsi = metrics.get("rsi")
        ma50_dev = metrics.get("price_vs_sma50")
        ma200_dev = metrics.get("price_vs_sma200")
        beta = metrics.get("beta")
        volatility = metrics.get("volatility")
        max_dd = metrics.get("max_drawdown")
        de = safe_get(info, "debtToEquity")
        fcf = safe_get(info, "freeCashflow")
        pe = metrics.get("pe_ratio")

        # ── Trend ──
        trend_score = 0  # -3 (strong bearish) to +3 (strong bullish)
        if ma50_dev is not None:
            if ma50_dev > 5:
                trend_score += 1
            elif ma50_dev < -5:
                trend_score -= 1
        if ma200_dev is not None:
            if ma200_dev > 5:
                trend_score += 1
            elif ma200_dev < -5:
                trend_score -= 1
        if rsi is not None:
            if rsi > 60:
                trend_score += 1
            elif rsi < 40:
                trend_score -= 1

        if trend_score >= 2:
            trend = "Bullish"
        elif trend_score == 1:
            trend = "Mildly Bullish"
        elif trend_score == 0:
            trend = "Neutral"
        elif trend_score == -1:
            trend = "Mildly Bearish"
        else:
            trend = "Bearish"

        # ── Risk Level ──
        risk_points = 0  # 0-10 scale
        if beta is not None:
            if beta > 1.5:
                risk_points += 3
            elif beta > 1.2:
                risk_points += 2
            elif beta > 0.8:
                risk_points += 1
        if volatility is not None:
            if volatility > 40:
                risk_points += 3
            elif volatility > 30:
                risk_points += 2
            elif volatility > 20:
                risk_points += 1
        if max_dd is not None:
            if max_dd > 30:
                risk_points += 2
            elif max_dd > 20:
                risk_points += 1
        if de is not None and de > 200:
            risk_points += 2

        if risk_points >= 7:
            risk_level = "High"
        elif risk_points >= 4:
            risk_level = "Medium"
        else:
            risk_level = "Low"

        # ── Short-term Signal ──
        st_score = 0  # -3 to +3
        if rsi is not None:
            if rsi > 70:
                st_score -= 1  # overbought
            elif rsi < 30:
                st_score += 1  # oversold (potential bounce)
            elif 50 < rsi < 65:
                st_score += 1  # healthy momentum
        if ma50_dev is not None:
            if ma50_dev > 3:
                st_score += 1
            elif ma50_dev < -3:
                st_score -= 1
        # Recent price momentum from risk data
        daily_ret = risk_data.get("daily_return_pct")
        if daily_ret is not None:
            if daily_ret > 2:
                st_score += 1
            elif daily_ret < -2:
                st_score -= 1

        if st_score >= 2:
            st_signal = "Strong"
        elif st_score == 1:
            st_signal = "Moderate"
        elif st_score == 0:
            st_signal = "Neutral"
        elif st_score == -1:
            st_signal = "Weak"
        else:
            st_signal = "Very Weak"

        # ── Fundamental Health Check ──
        fundamental_flags = 0  # negative flags count
        if pe is not None and pe < 0:
            fundamental_flags += 1
        if fcf is not None and fcf < 0:
            fundamental_flags += 1
        if de is not None and de > 200:
            fundamental_flags += 1
        cr = metrics.get("current_ratio")
        if cr is not None and cr < 1:
            fundamental_flags += 1

        # ── Absolute Fundamental Score ──
        # Use ABSOLUTE metrics (not relative composite which is always 25-75)
        fund_score = 0  # -4 to +4
        roe = metrics.get("roe")
        if roe is not None:
            if roe > 15:
                fund_score += 1
            elif roe < 5:
                fund_score -= 1
        profit_margin = metrics.get("profit_margin")
        if profit_margin is not None:
            if profit_margin > 10:
                fund_score += 1
            elif profit_margin < 0:
                fund_score -= 1
        rev_growth = metrics.get("revenue_growth")
        if rev_growth is not None:
            if rev_growth > 10:
                fund_score += 1
            elif rev_growth < 0:
                fund_score -= 1
        fcf_yield = metrics.get("fcf_yield")
        if fcf_yield is not None:
            if fcf_yield > 3:
                fund_score += 1
            elif fcf_yield < 0:
                fund_score -= 1

        # ── Action (uses ABSOLUTE signals, not relative scores) ──
        # Start from fundamentals (absolute, not relative comparison)
        if fund_score >= 3:
            action_base = 2    # strong fundamentals
        elif fund_score >= 1:
            action_base = 1    # decent fundamentals
        elif fund_score >= 0:
            action_base = 0    # neutral fundamentals
        else:
            action_base = -1   # weak fundamentals

        # Trend is the biggest driver of action
        if trend == "Bullish":
            action_base += 2
        elif trend == "Mildly Bullish":
            action_base += 1
        elif trend == "Mildly Bearish":
            action_base -= 1
        elif trend == "Bearish":
            action_base -= 2

        # Risk adjustment
        if risk_level == "High":
            action_base -= 1
        elif risk_level == "Low":
            action_base += 1

        # ST signal
        if st_signal in ("Very Weak",):
            action_base -= 1
        elif st_signal in ("Strong",):
            action_base += 1

        # Fundamental red flags are hard negatives
        action_base -= fundamental_flags

        # Hard ceiling: NEVER Strong Buy if trend is bearish
        if trend in ("Bearish", "Mildly Bearish"):
            action_base = min(action_base, 0)  # cap at Hold
        # NEVER Buy if risk is high and trend is not bullish
        if risk_level == "High" and trend not in ("Bullish",):
            action_base = min(action_base, 0)  # cap at Hold

        # Map to action
        if action_base >= 4:
            action = "Strong Buy"
        elif action_base >= 2:
            action = "Buy"
        elif action_base >= 1:
            action = "Accumulate"
        elif action_base >= 0:
            action = "Hold"
        elif action_base >= -1:
            action = "Reduce"
        else:
            action = "Sell"

        # Build reasoning
        reasons = []
        if trend in ("Bearish", "Mildly Bearish"):
            reasons.append(f"trend is {trend.lower()}")
        elif trend in ("Bullish", "Mildly Bullish"):
            reasons.append(f"trend is {trend.lower()}")
        if risk_level == "High":
            reasons.append("risk is high")
        elif risk_level == "Low":
            reasons.append("risk is low")
        if st_signal in ("Weak", "Very Weak"):
            reasons.append(f"short-term signal is {st_signal.lower()}")
        elif st_signal in ("Strong",):
            reasons.append("strong short-term momentum")
        if fundamental_flags >= 2:
            reasons.append(f"{fundamental_flags} fundamental red flags")
        if fund_score >= 3:
            reasons.append("strong fundamentals (ROE, margin, growth)")
        elif fund_score <= -1:
            reasons.append("weak fundamentals")

        return {
            "trend": trend,
            "trend_score": trend_score,
            "risk_level": risk_level,
            "risk_points": risk_points,
            "st_signal": st_signal,
            "st_score": st_score,
            "action": action,
            "fundamental_flags": fundamental_flags,
            "reasoning": "; ".join(reasons) if reasons else "balanced signals",
        }

    # ── Verdict ──────────────────────────────────────────────────

    def _generate_verdict(self, data1, data2, comp1, comp2, scores1, scores2,
                          metrics1, metrics2, signals1, signals2,
                          piotroski1, piotroski2):
        """Generate intelligent comparison verdict considering signals."""
        name1 = self._display_name(data1)
        name2 = self._display_name(data2)
        sym1 = data1["symbol"].replace(".NS", "")
        sym2 = data2["symbol"].replace(".NS", "")
        margin = abs(comp1 - comp2)

        # Determine score-based winner
        if margin < 3:
            score_category = "TIE"
            score_winner = None
        elif comp1 > comp2:
            score_winner = sym1
            score_category = "SLIGHT_EDGE" if margin < 10 else ("CLEAR_WINNER" if margin < 25 else "DOMINANT")
        else:
            score_winner = sym2
            score_category = "SLIGHT_EDGE" if margin < 10 else ("CLEAR_WINNER" if margin < 25 else "DOMINANT")

        # Build per-stock intelligence summary
        action1 = signals1["action"]
        action2 = signals2["action"]
        trend1 = signals1["trend"]
        trend2 = signals2["trend"]
        risk1 = signals1["risk_level"]
        risk2 = signals2["risk_level"]

        # Build narrative — the key intelligence
        parts = []

        # Relative comparison
        if score_category == "TIE":
            parts.append(f"{sym1} and {sym2} are virtually tied on fundamentals (margin: {margin:.1f} pts).")
        else:
            leader = sym1 if comp1 > comp2 else sym2
            laggard = sym2 if comp1 > comp2 else sym1
            strength = "slightly" if margin < 10 else ("clearly" if margin < 25 else "significantly")
            parts.append(f"{leader} {strength} outscores {laggard} on fundamentals ({margin:.1f}-pt lead).")

        # Individual action context — this is the key intelligence the user wants
        if action1 == action2:
            parts.append(f"Both stocks are rated '{action1}'.")
        else:
            parts.append(f"{sym1} is rated '{action1}' while {sym2} is rated '{action2}'.")

        # Flag contradictions (the Zaggle-type scenario)
        for sym, action, trend, risk, st, signals in [
            (sym1, action1, trend1, risk1, signals1["st_signal"], signals1),
            (sym2, action2, trend2, risk2, signals2["st_signal"], signals2),
        ]:
            if action in ("Buy", "Strong Buy", "Accumulate") and trend in ("Bearish", "Mildly Bearish"):
                parts.append(f"Caution on {sym}: fundamentals suggest {action.lower()} but trend is {trend.lower()}.")
            if action in ("Buy", "Strong Buy", "Accumulate") and risk == "High":
                parts.append(f"Note: {sym} carries high risk despite positive fundamentals — position sizing matters.")
            if trend == "Bearish" and risk == "High" and st in ("Weak", "Very Weak"):
                parts.append(f"{sym} shows bearish trend + high risk + weak ST signal — wait for reversal signals before entry.")

        # Timing advice
        bearish_count = sum(1 for s in (signals1, signals2) if s["trend"] in ("Bearish", "Mildly Bearish"))
        if bearish_count == 2:
            parts.append("Both stocks are in downtrends — consider waiting for trend reversal or use SIP approach.")

        summary = " ".join(parts)

        # Find strongest categories for each
        best_cats1 = sorted(scores1.items(), key=lambda x: x[1], reverse=True)[:3]
        best_cats2 = sorted(scores2.items(), key=lambda x: x[1], reverse=True)[:3]

        # Determine overall pick considering signals
        # Score winner may be overridden if their signals are much worse
        action_rank = {"Strong Buy": 5, "Buy": 4, "Accumulate": 3, "Hold": 2, "Reduce": 1, "Sell": 0}
        r1 = action_rank.get(action1, 2)
        r2 = action_rank.get(action2, 2)

        if abs(r1 - r2) >= 2:
            # Signals strongly disagree — let signals override
            overall_pick = sym1 if r1 > r2 else sym2
        elif score_category == "TIE":
            # Tie on score — use signals as tiebreaker
            overall_pick = sym1 if r1 >= r2 else sym2 if r2 > r1 else None
        else:
            overall_pick = score_winner

        return {
            "winner": overall_pick,
            "margin": round(margin, 1),
            "category": score_category,
            "summary": summary,
            "stock1_composite": comp1,
            "stock2_composite": comp2,
            "stock1_action": action1,
            "stock2_action": action2,
            "stock1_strengths": [c[0] for c in best_cats1],
            "stock2_strengths": [c[0] for c in best_cats2],
        }

    # ── Warnings ─────────────────────────────────────────────────

    def _generate_warnings(self, data1, data2, metrics1, metrics2):
        """Detect and return warning flags."""
        warnings = []
        for data, metrics, label in [(data1, metrics1, self._display_name(data1)),
                                     (data2, metrics2, self._display_name(data2))]:
            info = data["info"]
            pe = metrics.get("pe_ratio")
            if pe is not None and pe < 0:
                warnings.append(f"{label}: Negative P/E ratio ({pe:.1f}) — company is loss-making")

            de = safe_get(info, "debtToEquity")
            if de is not None and de > 200:
                warnings.append(f"{label}: High Debt/Equity ({de:.0f}%) — elevated leverage risk")

            cr = metrics.get("current_ratio")
            if cr is not None and cr < 1:
                warnings.append(f"{label}: Current Ratio below 1 ({cr:.2f}) — potential liquidity risk")

            fcf = safe_get(info, "freeCashflow")
            if fcf is not None and fcf < 0:
                warnings.append(f"{label}: Negative Free Cash Flow — burning cash")

            beta = metrics.get("beta")
            if beta is not None and beta > 1.5:
                warnings.append(f"{label}: High Beta ({beta:.2f}) — significantly more volatile than the market")

            promoter = safe_get(info, "heldPercentInsiders")
            if promoter is not None and promoter < 0.25:
                warnings.append(f"{label}: Low promoter/insider holding ({promoter*100:.1f}%)")

        # Market cap disparity
        mcap1 = safe_get(data1["info"], "marketCap") or 0
        mcap2 = safe_get(data2["info"], "marketCap") or 0
        if mcap1 > 0 and mcap2 > 0:
            ratio = max(mcap1, mcap2) / min(mcap1, mcap2)
            if ratio > 10:
                warnings.append(f"Large market cap disparity ({ratio:.0f}x) — comparison may be less meaningful across different size segments")

        return warnings

    # ── Output builders ──────────────────────────────────────────

    def _build_radar_data(self, scores1, scores2, data1, data2):
        """Build radar chart data for frontend."""
        name1 = self._display_name(data1)
        name2 = self._display_name(data2)
        radar = []
        for category in CATEGORY_WEIGHTS:
            radar.append({
                "category": category.replace("Analyst Sentiment", "Analyst").replace("Price Performance", "Price Perf"),
                "fullCategory": category,
                name1: scores1.get(category, 50),
                name2: scores2.get(category, 50),
            })
        return radar

    def _build_category_breakdown(self, scores1, scores2, data1, data2):
        """Build category-level comparison table."""
        name1 = self._display_name(data1)
        name2 = self._display_name(data2)
        breakdown = []
        for category, weight in CATEGORY_WEIGHTS.items():
            s1 = scores1.get(category, 50)
            s2 = scores2.get(category, 50)
            diff = s1 - s2
            if abs(diff) < 2:
                winner = "Tie"
            elif diff > 0:
                winner = name1
            else:
                winner = name2
            breakdown.append({
                "category": category,
                "weight": round(weight * 100),
                "stock1_score": round(s1, 1),
                "stock2_score": round(s2, 1),
                "winner": winner,
            })
        return breakdown

    def _build_metrics_comparison(self, metrics1, metrics2):
        """Build grouped metric-by-metric comparison."""
        comparison = {}
        for metric, category in METRIC_CATEGORIES.items():
            if category not in comparison:
                comparison[category] = []
            v1 = metrics1.get(metric)
            v2 = metrics2.get(metric)
            higher_better = METRIC_DIRECTION.get(metric, True)

            better = None
            if v1 is not None and v2 is not None:
                if higher_better:
                    better = "stock1" if v1 > v2 else ("stock2" if v2 > v1 else "tie")
                else:
                    better = "stock1" if v1 < v2 else ("stock2" if v2 < v1 else "tie")

            comparison[category].append({
                "metric": metric,
                "label": METRIC_LABELS.get(metric, metric),
                "stock1_value": self._fmt_metric(v1, metric),
                "stock2_value": self._fmt_metric(v2, metric),
                "stock1_raw": v1,
                "stock2_raw": v2,
                "better": better,
                "higher_is_better": higher_better,
            })
        return comparison

    def _stock_summary(self, data, scores, composite, metrics, signals=None):
        """Build summary for a single stock."""
        info = data["info"]
        cmp = safe_get(info, "currentPrice") or safe_get(info, "regularMarketPrice")
        mcap = safe_get(info, "marketCap")
        mcap_cr = round(mcap / 1e7, 1) if mcap else None

        prev_close = safe_get(info, "previousClose") or safe_get(info, "regularMarketPreviousClose")
        change_pct = None
        if cmp and prev_close and prev_close > 0:
            change_pct = round((cmp - prev_close) / prev_close * 100, 2)

        result = {
            "symbol": data["symbol"].replace(".NS", ""),
            "name": info.get("longName") or info.get("shortName") or data["symbol"].replace(".NS", ""),
            "sector": info.get("sector") or "N/A",
            "industry": info.get("industry") or "N/A",
            "cmp": round(cmp, 2) if cmp else None,
            "change_pct": change_pct,
            "market_cap_cr": mcap_cr,
            "scores": scores,
            "composite": composite,
        }
        if signals:
            result["signals"] = signals
        return result

    # ── Piotroski F-Score ────────────────────────────────────────

    def _piotroski_f_score(self, data):
        """Compute Piotroski F-Score (0-9) from financials."""
        info = data["info"]
        financials = data.get("financials") or {}
        income = financials.get("income")
        bs = financials.get("balance_sheet")
        cf = financials.get("cashflow")

        score = 0
        try:
            # 1. Positive net income
            ni = safe_get(info, "netIncomeToCommon")
            if ni is not None and ni > 0:
                score += 1

            # 2. Positive operating cash flow
            ocf = self._get_latest_item(cf, ["Operating Cash Flow", "Total Cash From Operating Activities"])
            if ocf is not None and ocf > 0:
                score += 1

            # 3. ROA increasing (approximate: positive ROA as proxy)
            roa = safe_get(info, "returnOnAssets")
            if roa is not None and roa > 0:
                score += 1

            # 4. OCF > Net Income (quality of earnings)
            if ocf is not None and ni is not None and ocf > ni:
                score += 1

            # 5. Decreasing leverage (approximate: D/E < 1)
            de = safe_get(info, "debtToEquity")
            if de is not None and de < 100:  # D/E < 1 (yfinance reports as %)
                score += 1

            # 6. Increasing current ratio (approximate: CR > 1.5)
            cr = safe_get(info, "currentRatio")
            if cr is not None and cr > 1.5:
                score += 1

            # 7. No dilution (approximate: check shares outstanding stability)
            # Simplified: give point if float shares exist
            shares = safe_get(info, "sharesOutstanding")
            if shares is not None and shares > 0:
                score += 1

            # 8. Increasing gross margin
            gm = safe_get(info, "grossMargins")
            if gm is not None and gm > 0.3:  # >30% as proxy for healthy margin
                score += 1

            # 9. Increasing asset turnover (approximate: revenue/totalAssets)
            revenue = safe_get(info, "totalRevenue")
            total_assets = self._get_latest_item(bs, ["Total Assets"])
            if revenue and total_assets and total_assets > 0:
                at = revenue / total_assets
                if at > 0.5:  # Reasonable turnover
                    score += 1

        except Exception:
            pass

        return score

    # ── Altman Z-Score ───────────────────────────────────────────

    def _compute_altman_z(self, financials, info):
        """Compute Altman Z-Score from financial statements."""
        try:
            bs = financials.get("balance_sheet")
            income = financials.get("income")
            if bs is None or bs.empty:
                return None

            latest = bs.iloc[:, 0]

            total_assets = self._safe_item(latest, ["Total Assets"])
            if not total_assets or total_assets <= 0:
                return None

            # Working Capital = Current Assets - Current Liabilities
            current_assets = self._safe_item(latest, ["Current Assets"])
            current_liabilities = self._safe_item(latest, ["Current Liabilities"])
            working_capital = 0
            if current_assets is not None and current_liabilities is not None:
                working_capital = current_assets - current_liabilities

            # Retained Earnings
            retained_earnings = self._safe_item(latest, ["Retained Earnings"])
            if retained_earnings is None:
                retained_earnings = 0

            # EBIT
            ebit = None
            if income is not None and not income.empty:
                ebit = self._safe_item(income.iloc[:, 0], ["EBIT", "Operating Income"])
            if ebit is None:
                ebit = safe_get(info, "ebitda") or 0  # fallback

            # Market Value of Equity
            mcap = safe_get(info, "marketCap") or 0

            # Total Liabilities
            total_liabilities = self._safe_item(latest, [
                "Total Liabilities Net Minority Interest",
                "Total Liab",
            ])
            if total_liabilities is None or total_liabilities <= 0:
                return None

            # Revenue
            revenue = safe_get(info, "totalRevenue") or 0

            z = (1.2 * (working_capital / total_assets)
                 + 1.4 * (retained_earnings / total_assets)
                 + 3.3 * (ebit / total_assets)
                 + 0.6 * (mcap / total_liabilities)
                 + 1.0 * (revenue / total_assets))

            if math.isnan(z) or math.isinf(z):
                return None
            return round(z, 2)

        except Exception:
            return None

    # ── Helper methods ───────────────────────────────────────────

    def _compute_interest_coverage(self, financials, info):
        """Compute interest coverage ratio from financials."""
        try:
            income = financials.get("income")
            if income is None or income.empty:
                return None
            latest = income.iloc[:, 0]
            ebit = self._safe_item(latest, ["EBIT", "Operating Income"])
            interest = self._safe_item(latest, ["Interest Expense"])
            if ebit is not None and interest is not None and interest != 0:
                # Interest expense is typically negative
                coverage = abs(ebit / interest)
                return round(coverage, 1)
        except Exception:
            pass
        return None

    def _compute_ocf_growth(self, cashflow_df):
        """Compute operating cash flow growth from cashflow statement."""
        try:
            if cashflow_df is None or cashflow_df.empty or cashflow_df.shape[1] < 2:
                return None
            for label in ["Operating Cash Flow", "Total Cash From Operating Activities"]:
                if label in cashflow_df.index:
                    row = cashflow_df.loc[label]
                    latest = float(row.iloc[0])
                    prev = float(row.iloc[1])
                    if prev and prev != 0 and not math.isnan(prev) and not math.isnan(latest):
                        return round((latest - prev) / abs(prev) * 100, 1)
        except Exception:
            pass
        return None

    def _compute_rsi(self, prices, period=14):
        """Compute RSI from price history."""
        try:
            if prices is None or prices.empty or len(prices) < period + 1:
                return None
            close = prices["Close"].astype(float)
            delta = close.diff()
            gain = delta.where(delta > 0, 0).rolling(window=period).mean()
            loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
            rs = gain / loss
            rsi = 100 - (100 / (1 + rs))
            val = rsi.iloc[-1]
            if math.isnan(val):
                return None
            return round(val, 1)
        except Exception:
            return None

    def _compute_sharpe(self, prices, risk_free_annual=0.07):
        """Compute annualized Sharpe ratio from price history."""
        try:
            if prices is None or prices.empty or len(prices) < 30:
                return None
            close = prices["Close"].astype(float)
            daily_ret = close.pct_change().dropna()
            if len(daily_ret) < 20:
                return None
            rf_daily = (1 + risk_free_annual) ** (1/252) - 1
            excess = daily_ret - rf_daily
            mean_excess = excess.mean()
            std = excess.std()
            if std == 0 or math.isnan(std):
                return None
            sharpe = (mean_excess / std) * np.sqrt(252)
            if math.isnan(sharpe) or math.isinf(sharpe):
                return None
            return round(sharpe, 2)
        except Exception:
            return None

    def _target_upside(self, info, cmp):
        """Compute analyst target upside %."""
        target = safe_get(info, "targetMeanPrice")
        if target and cmp and cmp > 0:
            return round((target - cmp) / cmp * 100, 1)
        return None

    def _to_pct(self, val):
        """Convert decimal ratio to percentage."""
        if val is None:
            return None
        return round(val * 100, 2)

    def _de_ratio(self, val):
        """Convert yfinance D/E (reported as %) to ratio."""
        if val is None:
            return None
        return round(val / 100, 2)

    def _display_name(self, data):
        """Get short display name for a stock."""
        info = data["info"]
        return info.get("shortName") or info.get("longName") or data["symbol"].replace(".NS", "")

    def _get_latest_item(self, df, labels):
        """Get latest value for a financial line item."""
        if df is None or df.empty:
            return None
        for label in labels:
            if label in df.index:
                val = df.loc[label].iloc[0]
                if val is not None and not (isinstance(val, float) and math.isnan(val)):
                    return float(val)
        return None

    def _safe_item(self, series, labels):
        """Get a value from a pandas Series by trying multiple labels."""
        for label in labels:
            if label in series.index:
                val = series[label]
                if val is not None and not (isinstance(val, float) and math.isnan(val)):
                    return float(val)
        return None

    def _fmt_metric(self, val, metric):
        """Format a metric value for display."""
        if val is None:
            return "N/A"
        try:
            if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
                return "N/A"
        except (TypeError, ValueError):
            return "N/A"
        # Percentage metrics
        pct_metrics = {
            "dcf_upside_pct", "margin_of_safety", "roe", "roa",
            "operating_margin", "profit_margin", "gross_margin",
            "fcf_yield", "ocf_growth", "revenue_growth", "earnings_growth",
            "eps_growth", "52w_return", "vs_52w_high", "volatility",
            "max_drawdown", "price_vs_sma50", "price_vs_sma200", "target_upside",
        }
        if metric in pct_metrics:
            return f"{val:.1f}%"
        # Ratio metrics
        ratio_metrics = {"pe_ratio", "pb_ratio", "ps_ratio", "peg_ratio",
                         "ev_ebitda", "debt_to_equity", "current_ratio",
                         "fcf_to_net_income", "interest_coverage", "altman_z",
                         "beta", "sharpe_ratio"}
        if metric in ratio_metrics:
            return f"{val:.2f}"
        if metric == "rsi":
            return f"{val:.1f}"
        if metric == "recommendation_score":
            return f"{val:.1f}"
        if metric == "analyst_count":
            return str(int(val))
        return f"{val:.2f}"
