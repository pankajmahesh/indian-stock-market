"""
Portfolio Insights — Growth Trend & Valuation Trend analysis.

Growth Trend: Weighted-average revenue/earnings CAGR across portfolio,
              identifying growth leaders and laggards.

Valuation Trend: Long-term PE using average EPS over multiple years,
                 a safer measure that smooths out cyclical fluctuations.
"""
import math

import numpy as np

from modules.data_fetcher import DataFetcher
from utils.helpers import compute_cagr, safe_get, safe_divide
from utils.logger import log


# ETF keywords — skip these for fundamental analysis
_ETF_KEYWORDS = [
    "NIFTYBEES", "EBBETF", "HDFCNEXT50", "HDFCMOMENT", "LOWVOL",
    "MAFANG", "MOM100", "MON100", "HDFCSILVER", "TMCV",
    "JUNIORBEES", "BANKBEES", "GOLDBEES", "SILVERBEES",
]


def _is_etf(symbol):
    name = symbol.replace(".NS", "").upper()
    return any(kw in name for kw in _ETF_KEYWORDS)


def _safe_float(val):
    """Convert a value to float, return None if not possible."""
    if val is None:
        return None
    try:
        v = float(val)
        if math.isnan(v) or math.isinf(v):
            return None
        return v
    except (TypeError, ValueError):
        return None


def _extract_row(df, row_names):
    """Extract first matching row from a DataFrame (income_stmt rows vary)."""
    if df is None or df.empty:
        return None
    for name in row_names:
        if name in df.index:
            return df.loc[name]
    return None


class PortfolioInsights:
    def __init__(self, skip_cache=False):
        self.fetcher = DataFetcher(skip_cache=skip_cache)

    # =================================================================
    # GROWTH TREND
    # =================================================================

    def growth_trend(self, symbols_raw):
        """
        Compute revenue & earnings CAGR for each stock in the portfolio.
        Returns portfolio-level weighted averages and per-stock breakdown.
        """
        symbols = self._normalize(symbols_raw)
        stock_syms = [s for s in symbols if not _is_etf(s)]

        log.info(f"Growth Trend: analysing {len(stock_syms)} stocks")

        all_info = self.fetcher.batch_fetch_info(stock_syms)
        all_fin = self.fetcher.batch_fetch_financials(stock_syms)

        stocks = []
        for sym in stock_syms:
            info = all_info.get(sym, {})
            fin = all_fin.get(sym, {})
            income = fin.get("income_stmt")

            name = safe_get(info, "shortName") or safe_get(info, "longName") or sym
            mcap = safe_get(info, "marketCap")
            mcap_cr = round(mcap / 1e7, 1) if mcap else None

            # Extract revenue and net income rows
            rev_row = _extract_row(income, ["Total Revenue", "Operating Revenue"])
            ni_row = _extract_row(income, ["Net Income", "Net Income Common Stockholders"])

            if rev_row is None and ni_row is None:
                continue

            # Sort columns chronologically (oldest first)
            def _cagr_from_row(row):
                if row is None:
                    return None, None, None, None
                vals = [(col, _safe_float(row[col])) for col in sorted(row.index)]
                vals = [(c, v) for c, v in vals if v is not None and v != 0]
                if len(vals) < 2:
                    return None, None, None, None
                earliest_val = vals[0][1]
                latest_val = vals[-1][1]
                years = (vals[-1][0] - vals[0][0]).days / 365.25 if hasattr(vals[-1][0], 'days') else len(vals) - 1
                if years < 0.5:
                    years = len(vals) - 1
                cagr = compute_cagr(earliest_val, latest_val, max(years, 1))
                return cagr, earliest_val, latest_val, max(years, 1)

            rev_cagr, rev_earliest, rev_latest, rev_years = _cagr_from_row(rev_row)
            ni_cagr, ni_earliest, ni_latest, ni_years = _cagr_from_row(ni_row)

            years = rev_years or ni_years or 0
            if rev_cagr is None and ni_cagr is None:
                continue

            stocks.append({
                "symbol": sym.replace(".NS", ""),
                "name": str(name),
                "market_cap_cr": mcap_cr,
                "revenue_cagr": round(rev_cagr, 1) if rev_cagr is not None else None,
                "earnings_cagr": round(ni_cagr, 1) if ni_cagr is not None else None,
                "revenue_latest_cr": round(rev_latest / 1e7, 1) if rev_latest else None,
                "revenue_earliest_cr": round(rev_earliest / 1e7, 1) if rev_earliest else None,
                "years": round(years, 1),
            })

        # Compute portfolio weighted averages
        total_mcap = sum(s["market_cap_cr"] for s in stocks if s["market_cap_cr"])
        for s in stocks:
            s["weight_pct"] = round(s["market_cap_cr"] / total_mcap * 100, 1) if s["market_cap_cr"] and total_mcap else 0

        w_rev_cagr = 0
        w_earn_cagr = 0
        w_rev_total = 0
        w_earn_total = 0
        for s in stocks:
            w = s["weight_pct"] / 100
            if s["revenue_cagr"] is not None:
                w_rev_cagr += s["revenue_cagr"] * w
                w_rev_total += w
            if s["earnings_cagr"] is not None:
                w_earn_cagr += s["earnings_cagr"] * w
                w_earn_total += w

        portfolio_rev_cagr = round(w_rev_cagr / w_rev_total, 1) if w_rev_total > 0 else None
        portfolio_earn_cagr = round(w_earn_cagr / w_earn_total, 1) if w_earn_total > 0 else None

        # Classify: LEADER / AVERAGE / LAGGARD
        avg_growth = portfolio_rev_cagr or 0
        for s in stocks:
            rc = s["revenue_cagr"]
            if rc is None:
                s["category"] = "AVERAGE"
            elif rc > avg_growth + 5:
                s["category"] = "LEADER"
            elif rc < avg_growth - 5:
                s["category"] = "LAGGARD"
            else:
                s["category"] = "AVERAGE"

        # Sort by revenue CAGR descending
        stocks.sort(key=lambda s: s["revenue_cagr"] if s["revenue_cagr"] is not None else -999, reverse=True)

        return {
            "portfolio": {
                "weighted_revenue_cagr": portfolio_rev_cagr,
                "weighted_earnings_cagr": portfolio_earn_cagr,
                "stock_count": len(stocks),
                "total_count": len(symbols_raw),
            },
            "stocks": stocks,
        }

    # =================================================================
    # VALUATION TREND (Long-term PE)
    # =================================================================

    def valuation_trend(self, symbols_raw):
        """
        Compute long-term PE (price / avg EPS over multiple years) for each stock.
        Compares with current trailing PE to assess whether earnings are improving.
        """
        symbols = self._normalize(symbols_raw)
        stock_syms = [s for s in symbols if not _is_etf(s)]

        log.info(f"Valuation Trend: analysing {len(stock_syms)} stocks")

        all_info = self.fetcher.batch_fetch_info(stock_syms)
        all_fin = self.fetcher.batch_fetch_financials(stock_syms)

        stocks = []
        for sym in stock_syms:
            info = all_info.get(sym, {})
            fin = all_fin.get(sym, {})
            income = fin.get("income_stmt")

            name = safe_get(info, "shortName") or safe_get(info, "longName") or sym
            cmp = safe_get(info, "currentPrice") or safe_get(info, "regularMarketPrice")
            current_pe = safe_get(info, "trailingPE")
            shares = safe_get(info, "sharesOutstanding")

            if cmp is None:
                continue

            # Extract EPS history from financials
            eps_row = _extract_row(income, ["Basic EPS", "Diluted EPS"])
            ni_row = _extract_row(income, ["Net Income", "Net Income Common Stockholders"])

            eps_history = []

            if eps_row is not None:
                for col in sorted(eps_row.index):
                    val = _safe_float(eps_row[col])
                    if val is not None:
                        year_label = col.strftime("FY%Y") if hasattr(col, "strftime") else str(col)
                        eps_history.append({"year": year_label, "eps": round(val, 2)})
            elif ni_row is not None and shares:
                # Fallback: compute EPS from Net Income / Shares
                for col in sorted(ni_row.index):
                    ni_val = _safe_float(ni_row[col])
                    if ni_val is not None:
                        eps = ni_val / shares
                        year_label = col.strftime("FY%Y") if hasattr(col, "strftime") else str(col)
                        eps_history.append({"year": year_label, "eps": round(eps, 2)})

            if not eps_history:
                continue

            eps_values = [e["eps"] for e in eps_history if e["eps"] > 0]
            if not eps_values:
                continue

            avg_eps = sum(eps_values) / len(eps_values)
            latest_eps = eps_history[-1]["eps"] if eps_history else None
            longterm_pe = safe_divide(cmp, avg_eps) if avg_eps > 0 else None

            # Assessment
            if current_pe is not None and longterm_pe is not None:
                diff = longterm_pe - current_pe
                if diff > 3:
                    assessment = "IMPROVING"
                elif diff < -3:
                    assessment = "DETERIORATING"
                else:
                    assessment = "STABLE"
            else:
                assessment = "STABLE"

            stocks.append({
                "symbol": sym.replace(".NS", ""),
                "name": str(name),
                "cmp": round(cmp, 2),
                "current_pe": round(current_pe, 1) if current_pe else None,
                "longterm_pe": round(longterm_pe, 1) if longterm_pe else None,
                "avg_eps": round(avg_eps, 2),
                "latest_eps": round(latest_eps, 2) if latest_eps else None,
                "eps_years": len(eps_values),
                "eps_history": eps_history,
                "assessment": assessment,
            })

        # Portfolio weighted averages (weight by 1/PE for PE, or just equal-weight)
        valid_pe = [s for s in stocks if s["current_pe"] and s["current_pe"] > 0]
        valid_lt = [s for s in stocks if s["longterm_pe"] and s["longterm_pe"] > 0]

        # Market-cap weighted PE: sum(mcap) / sum(earnings) equivalent → use median as simpler proxy
        w_current_pe = round(np.median([s["current_pe"] for s in valid_pe]), 1) if valid_pe else None
        w_longterm_pe = round(np.median([s["longterm_pe"] for s in valid_lt]), 1) if valid_lt else None

        if w_current_pe and w_longterm_pe:
            if w_longterm_pe > w_current_pe + 2:
                summary = "Portfolio earnings have improved relative to historical average"
            elif w_longterm_pe < w_current_pe - 2:
                summary = "Portfolio earnings have deteriorated relative to historical average"
            else:
                summary = "Portfolio earnings are broadly in line with historical average"
        else:
            summary = "Insufficient data for portfolio-level assessment"

        # Sort by PE differential (most improving first)
        def _sort_key(s):
            if s["longterm_pe"] and s["current_pe"]:
                return s["longterm_pe"] - s["current_pe"]
            return 0
        stocks.sort(key=_sort_key, reverse=True)

        return {
            "portfolio": {
                "median_current_pe": w_current_pe,
                "median_longterm_pe": w_longterm_pe,
                "assessment": summary,
                "stock_count": len(stocks),
                "total_count": len(symbols_raw),
            },
            "stocks": stocks,
        }

    # =================================================================
    # HELPERS
    # =================================================================

    def _normalize(self, symbols_raw):
        """Normalize symbols: uppercase, add .NS suffix."""
        symbols = []
        for s in symbols_raw:
            s = s.strip().upper()
            if not s:
                continue
            if not s.endswith(".NS"):
                s += ".NS"
            symbols.append(s)
        return symbols
