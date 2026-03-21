"""
Step 3: Fundamental Scoring
Score stocks on profitability, growth, valuation, financial health, and dividends.
Each sub-metric scored 0-10, weighted by category, scaled to 0-100.
"""
import os

import numpy as np
import pandas as pd

import config
from modules.data_fetcher import DataFetcher
from utils.helpers import (
    safe_get, safe_divide, score_by_thresholds,
    compute_cagr, category_score, weighted_score,
)
from utils.logger import log


class FundamentalScorer:
    def __init__(self, data_fetcher: DataFetcher):
        self.fetcher = data_fetcher

    def score(self, stocks_df):
        """
        Score all stocks on fundamental parameters.
        Returns DataFrame with fundamental scores and sub-scores.
        """
        log.info("=" * 60)
        log.info("STEP 3: FUNDAMENTAL SCORING")
        log.info("=" * 60)

        symbols = stocks_df["symbol"].tolist()
        all_info = self.fetcher.batch_fetch_info(symbols)
        all_financials = self.fetcher.batch_fetch_financials(symbols)

        results = []
        for _, row in stocks_df.iterrows():
            sym = row["symbol"]
            info = all_info.get(sym, {})
            fin = all_financials.get(sym, {})

            scores = self._score_stock(info, fin)
            results.append({**row.to_dict(), **scores})

        result_df = pd.DataFrame(results)
        result_df = result_df.sort_values("fundamental_score", ascending=False)
        result_df = result_df.reset_index(drop=True)

        log.info(f"Fundamental scoring complete for {len(result_df)} stocks")
        log.info(f"Score range: {result_df['fundamental_score'].min():.1f} - {result_df['fundamental_score'].max():.1f}")

        out_path = os.path.join(config.DATA_DIR, "fundamental_scores.csv")
        result_df.to_csv(out_path, index=False)
        log.info(f"Saved to {out_path}")

        return result_df

    def _score_stock(self, info, fin):
        """Score a single stock on all fundamental categories."""

        # Category A: Profitability (pass fin for ROCE calculation)
        prof = self._score_profitability(info, fin)

        # Category B: Growth
        growth = self._score_growth(info, fin)

        # Category C: Valuation
        val = self._score_valuation(info)

        # Category D: Financial Health
        health = self._score_financial_health(info, fin)

        # Category E: Dividend Quality
        div = self._score_dividends(info)

        # Aggregate category scores
        cat_scores = {}
        coverages = {}
        for name, sub in [("profitability", prof), ("growth", growth),
                          ("valuation", val), ("financial_health", health),
                          ("dividend_quality", div)]:
            sc, cov = category_score(sub, scale_to_100=True)
            cat_scores[name] = sc
            coverages[name] = cov

        # Weighted composite
        fund_score, data_coverage = weighted_score(cat_scores, config.FUNDAMENTAL_WEIGHTS)

        return {
            # Category scores
            "fund_profitability": cat_scores.get("profitability"),
            "fund_growth": cat_scores.get("growth"),
            "fund_valuation": cat_scores.get("valuation"),
            "fund_financial_health": cat_scores.get("financial_health"),
            "fund_dividend": cat_scores.get("dividend_quality"),
            # Composite
            "fundamental_score": fund_score,
            "fund_data_coverage": data_coverage,
            # Key sub-scores for reporting and L1/L2/L3 classification
            "roe": safe_get(info, "returnOnEquity"),
            "pe_ratio": safe_get(info, "trailingPE"),
            "debt_to_equity": safe_get(info, "debtToEquity"),
            "operating_margin": safe_get(info, "operatingMargins"),
        }

    # ----------------------------------------------------------
    # Category A: Profitability
    # ----------------------------------------------------------
    def _score_profitability(self, info, fin=None):
        thresholds = config.PROFITABILITY_THRESHOLDS

        roe = safe_get(info, "returnOnEquity")
        if roe is not None:
            roe *= 100  # Convert from decimal

        roa = safe_get(info, "returnOnAssets")
        if roa is not None:
            roa *= 100

        op_margin = safe_get(info, "operatingMargins")
        if op_margin is not None:
            op_margin *= 100

        net_margin = safe_get(info, "profitMargins")
        if net_margin is not None:
            net_margin *= 100

        ebitda_margin = safe_get(info, "ebitdaMargins")
        if ebitda_margin is not None:
            ebitda_margin *= 100

        # ROCE (Return on Capital Employed) — Prasenjit Paul key metric
        # High ROCE (>20%) separates quality compounders from average businesses
        roce = self._compute_roce(fin) if fin else None

        return {
            "roe": score_by_thresholds(roe, thresholds["roe"]),
            "roa": score_by_thresholds(roa, thresholds["roa"]),
            "operating_margin": score_by_thresholds(op_margin, thresholds["operating_margin"]),
            "net_profit_margin": score_by_thresholds(net_margin, thresholds["net_profit_margin"]),
            "ebitda_margin": score_by_thresholds(ebitda_margin, thresholds["ebitda_margin"]),
            "roce": score_by_thresholds(roce, config.PROFITABILITY_THRESHOLDS.get(
                "roce", [(-999, 0), (0, 2), (8, 4), (15, 6), (20, 8), (30, 10)]
            )),
        }

    def _compute_roce(self, fin):
        """
        Return on Capital Employed = EBIT / (Total Assets - Current Liabilities).
        High ROCE (>20%) is a hallmark of quality compounders (Prasenjit Paul criterion).
        """
        if not fin:
            return None
        try:
            income  = fin.get("income_stmt")
            balance = fin.get("balance_sheet")
            if income is None or income.empty or balance is None or balance.empty:
                return None

            ebit = None
            for label in ["EBIT", "Operating Income"]:
                if label in income.index:
                    ebit = income.loc[label].dropna().iloc[0]
                    break
            if ebit is None:
                return None

            total_assets = None
            for label in ["Total Assets"]:
                if label in balance.index:
                    total_assets = balance.loc[label].dropna().iloc[0]
                    break

            current_liabilities = None
            for label in ["Current Liabilities", "Total Current Liabilities"]:
                if label in balance.index:
                    current_liabilities = balance.loc[label].dropna().iloc[0]
                    break

            if total_assets is None or current_liabilities is None:
                return None

            capital_employed = total_assets - current_liabilities
            if capital_employed <= 0:
                return None

            return (ebit / capital_employed) * 100
        except Exception:
            return None

    # ----------------------------------------------------------
    # Category B: Growth
    # ----------------------------------------------------------
    def _score_growth(self, info, fin):
        thresholds = config.GROWTH_THRESHOLDS

        rev_growth = safe_get(info, "revenueGrowth")
        if rev_growth is not None:
            rev_growth *= 100

        earn_growth = safe_get(info, "earningsGrowth")
        if earn_growth is not None:
            earn_growth *= 100

        # Compute 3-year CAGRs from financials
        rev_cagr = self._compute_revenue_cagr(fin)
        profit_cagr = self._compute_profit_cagr(fin)

        # EPS Acceleration — Minervini key criterion (accelerating > flat > decelerating)
        eps_accel = self._compute_eps_acceleration(fin)

        return {
            "revenue_growth": score_by_thresholds(rev_growth, thresholds["revenue_growth"]),
            "earnings_growth": score_by_thresholds(earn_growth, thresholds["earnings_growth"]),
            "revenue_cagr_3y": score_by_thresholds(rev_cagr, thresholds["revenue_cagr_3y"]),
            "profit_cagr_3y": score_by_thresholds(profit_cagr, thresholds["profit_cagr_3y"]),
            "eps_acceleration": eps_accel,
        }

    def _compute_revenue_cagr(self, fin):
        income = fin.get("income_stmt")
        if income is None or income.empty:
            return None
        try:
            for label in ["Total Revenue", "Revenue", "Operating Revenue"]:
                if label in income.index:
                    values = income.loc[label].dropna()
                    if len(values) >= 3:
                        latest = values.iloc[0]
                        oldest = values.iloc[min(3, len(values) - 1)]
                        years = min(3, len(values) - 1)
                        return compute_cagr(oldest, latest, years)
        except Exception:
            pass
        return None

    def _compute_profit_cagr(self, fin):
        income = fin.get("income_stmt")
        if income is None or income.empty:
            return None
        try:
            for label in ["Net Income", "Net Income Common Stockholders"]:
                if label in income.index:
                    values = income.loc[label].dropna()
                    if len(values) >= 3:
                        latest = values.iloc[0]
                        oldest = values.iloc[min(3, len(values) - 1)]
                        years = min(3, len(values) - 1)
                        return compute_cagr(oldest, latest, years)
        except Exception:
            pass
        return None

    def _compute_eps_acceleration(self, fin):
        """
        Compute EPS acceleration score from annual data (Minervini criterion).
        Checks if YoY profit growth rate is accelerating over the last 3 years.
        Accelerating growth = institutions will pay up → price follows.
        Returns 0–10 score or None.
        """
        try:
            income = fin.get("income_stmt")
            if income is None or income.empty:
                return None

            ni_row = None
            for label in ["Net Income", "Net Income Common Stockholders",
                          "Net Income From Continuing Operations"]:
                if label in income.index:
                    ni_row = income.loc[label].dropna()
                    break

            if ni_row is None or len(ni_row) < 3:
                return None

            values = ni_row.values  # newest first

            # Compute YoY growth rates for the last 3 periods
            growths = []
            for i in range(min(3, len(values) - 1)):
                base = values[i + 1]
                if base is not None and base != 0:
                    g = ((values[i] - base) / abs(base)) * 100
                    growths.append(g)

            if len(growths) < 2:
                return None

            latest_growth = growths[0]
            # Accelerating = most recent growth faster than prior year
            accelerating = growths[0] > growths[1]
            # Count consecutive acceleration periods
            accel_streak = sum(1 for i in range(len(growths) - 1) if growths[i] > growths[i + 1])

            if latest_growth > 40 and accelerating:
                return 10
            elif latest_growth > 25 and accelerating:
                return 9
            elif latest_growth > 15 and accelerating:
                return 8
            elif latest_growth > 25:
                return 7   # High but not accelerating
            elif latest_growth > 15:
                return 6
            elif latest_growth > 5:
                return 5
            elif latest_growth > 0:
                return 4
            else:
                return 2
        except Exception:
            return None

    # ----------------------------------------------------------
    # Category C: Valuation (lower is better)
    # ----------------------------------------------------------
    def _score_valuation(self, info):
        thresholds = config.VALUATION_THRESHOLDS

        pe = safe_get(info, "trailingPE")
        pb = safe_get(info, "priceToBook")
        peg = safe_get(info, "pegRatio")

        # Compute PEG manually if not available
        if peg is None:
            earn_growth = safe_get(info, "earningsGrowth")
            if pe is not None and earn_growth is not None and earn_growth > 0:
                peg = pe / (earn_growth * 100)

        # EV/EBITDA
        ev = safe_get(info, "enterpriseValue")
        ebitda = safe_get(info, "ebitda")
        ev_ebitda = safe_divide(ev, ebitda) if ev and ebitda else None

        return {
            "trailing_pe": score_by_thresholds(pe, thresholds["trailing_pe"], inverted=True),
            "price_to_book": score_by_thresholds(pb, thresholds["price_to_book"], inverted=True),
            "peg_ratio": score_by_thresholds(peg, thresholds["peg_ratio"], inverted=True),
            "ev_to_ebitda": score_by_thresholds(ev_ebitda, thresholds["ev_to_ebitda"], inverted=True),
        }

    # ----------------------------------------------------------
    # Category D: Financial Health
    # ----------------------------------------------------------
    def _score_financial_health(self, info, fin):
        thresholds = config.FINANCIAL_HEALTH_THRESHOLDS

        de = safe_get(info, "debtToEquity")
        cr = safe_get(info, "currentRatio")

        # Interest coverage from financials
        ic = self._compute_interest_coverage(fin)

        # FCF yield
        fcf = safe_get(info, "freeCashflow")
        mcap = safe_get(info, "marketCap")
        fcf_yield = None
        if fcf is not None and mcap is not None and mcap > 0:
            fcf_yield = (fcf / mcap) * 100

        return {
            "debt_to_equity": score_by_thresholds(de, thresholds["debt_to_equity"], inverted=True),
            "current_ratio": score_by_thresholds(cr, thresholds["current_ratio"]),
            "interest_coverage": score_by_thresholds(ic, thresholds["interest_coverage"]),
            "fcf_yield": score_by_thresholds(fcf_yield, thresholds["fcf_yield"]),
        }

    def _compute_interest_coverage(self, fin):
        income = fin.get("income_stmt")
        if income is None or income.empty:
            return None
        try:
            ebit = None
            for label in ["EBIT", "Operating Income"]:
                if label in income.index:
                    ebit = income.loc[label].dropna().iloc[0]
                    break
            interest = None
            for label in ["Interest Expense", "Interest Expense Non Operating"]:
                if label in income.index:
                    val = income.loc[label].dropna().iloc[0]
                    interest = abs(val)
                    break
            if ebit is not None and interest is not None and interest > 0:
                return ebit / interest
        except Exception:
            pass
        return None

    # ----------------------------------------------------------
    # Category E: Dividend Quality
    # ----------------------------------------------------------
    def _score_dividends(self, info):
        thresholds = config.DIVIDEND_THRESHOLDS

        div_yield = safe_get(info, "dividendYield")
        if div_yield is not None:
            div_yield *= 100  # Convert from decimal

        payout = safe_get(info, "payoutRatio")
        if payout is not None:
            payout *= 100

        return {
            "dividend_yield": score_by_thresholds(div_yield, thresholds["dividend_yield"]),
            "payout_ratio": score_by_thresholds(payout, thresholds["payout_ratio"]),
        }

    @staticmethod
    def load_saved():
        path = os.path.join(config.DATA_DIR, "fundamental_scores.csv")
        if os.path.exists(path):
            return pd.read_csv(path)
        return None
