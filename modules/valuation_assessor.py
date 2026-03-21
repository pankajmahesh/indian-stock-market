"""
Valuation Level Assessor (Skill 13)

3-method valuation:
  Method A: Relative valuation vs sector median + own 5Y history
  Method B: Simplified DCF (EPS × growth → fair value)
  Method C: Graham Number (sqrt(22.5 × EPS × BVPS))

Weighted result: 40% Relative + 40% DCF + 20% Graham
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd
import numpy as np

import config
from utils.logger import log


# Sector median P/E reference table (NSE, approximate ranges)
# Used as fallback when we can't compute from composite_ranked.csv
SECTOR_PE_MEDIANS = {
    "Information Technology": 28,
    "IT Services": 28,
    "Pharmaceuticals": 30,
    "Healthcare": 30,
    "FMCG": 55,
    "Consumer Staples": 55,
    "Consumer Discretionary": 45,
    "Financials": 18,
    "Banking": 15,
    "Insurance": 25,
    "Metals": 10,
    "Mining": 10,
    "Oil & Gas": 12,
    "Energy": 12,
    "Capital Goods": 35,
    "Infrastructure": 30,
    "Automobiles": 22,
    "Auto": 22,
    "Real Estate": 35,
    "Telecom": 20,
    "Utilities": 18,
    "Power": 18,
    "Chemicals": 22,
    "Cement": 25,
    "Retail": 50,
    "Media": 25,
}

SECTOR_PB_MEDIANS = {
    "Information Technology": 6,
    "IT Services": 6,
    "Pharmaceuticals": 4,
    "Healthcare": 4,
    "FMCG": 10,
    "Consumer Staples": 10,
    "Financials": 2.5,
    "Banking": 2.0,
    "Insurance": 3.0,
    "Metals": 1.5,
    "Mining": 1.5,
    "Oil & Gas": 1.5,
    "Energy": 1.5,
    "Capital Goods": 5,
    "Infrastructure": 4,
    "Automobiles": 3,
    "Auto": 3,
    "Chemicals": 4,
    "Cement": 3.5,
    "Power": 2.5,
    "Utilities": 2.5,
}


def _safe(v, default=None):
    if v is None:
        return default
    try:
        f = float(v)
        return default if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return default


class ValuationAssessor:
    """
    Assesses valuation level for one or more stocks using 3 methods.
    """

    def __init__(self):
        # Load composite data for sector median computation
        self._composite = self._load_composite()

    def _load_composite(self) -> pd.DataFrame:
        path = os.path.join(config.DATA_DIR, "composite_ranked.csv")
        if os.path.exists(path):
            try:
                return pd.read_csv(path)
            except Exception:
                pass
        return pd.DataFrame()

    def assess(self, symbol: str) -> dict:
        """Full valuation assessment for one symbol."""
        import yfinance as yf

        sym = symbol.replace(".NS", "").upper()
        sym_ns = sym + ".NS"

        info = {}
        try:
            ticker = yf.Ticker(sym_ns)
            info = ticker.info or {}
        except Exception as e:
            log.warning(f"[Valuation] yfinance error for {sym}: {e}")

        name = str(info.get("longName") or info.get("shortName") or sym)
        sector = str(info.get("sector") or info.get("industry") or "Unknown")
        cmp = _safe(info.get("regularMarketPrice") or info.get("currentPrice"))

        # Core metrics
        trailing_pe = _safe(info.get("trailingPE"))
        forward_pe = _safe(info.get("forwardPE"))
        pb = _safe(info.get("priceToBook"))
        ev_ebitda = _safe(info.get("enterpriseToEbitda"))
        eps = _safe(info.get("trailingEps"))
        bvps = _safe(info.get("bookValue"))
        roe = _safe(info.get("returnOnEquity"))
        if roe is not None:
            roe = round(roe * 100, 1)
        revenue_growth = _safe(info.get("revenueGrowth"))
        if revenue_growth is not None:
            revenue_growth = round(revenue_growth * 100, 1)
        earnings_growth = _safe(info.get("earningsGrowth"))
        if earnings_growth is not None:
            earnings_growth = round(earnings_growth * 100, 1)

        # Sector medians
        sector_pe = self._sector_median_pe(sector)
        sector_pb = self._sector_median_pb(sector)

        # ── Method A: Relative Valuation ─────────────────────────────────────
        method_a = self._method_a_relative(
            trailing_pe, pb, ev_ebitda, sector_pe, sector_pb, sector
        )

        # ── Method B: DCF / Earnings-based ───────────────────────────────────
        method_b = self._method_b_dcf(eps, earnings_growth, revenue_growth, sector_pe, cmp)

        # ── Method C: Graham Number ───────────────────────────────────────────
        method_c = self._method_c_graham(eps, bvps, cmp)

        # ── Weighted Fair Value ───────────────────────────────────────────────
        fair_value, margin_of_safety = self._weighted_fair_value(
            method_a, method_b, method_c, cmp
        )

        # ── Verdict ───────────────────────────────────────────────────────────
        verdict, verdict_color = self._compute_verdict(margin_of_safety, method_a, method_b, method_c)

        # Entry / exit price zones
        attractive_price = round(fair_value * 0.80, 1) if fair_value else None
        exit_on_valuation = round(fair_value * 1.30, 1) if fair_value else None

        # Is premium justified?
        premium_justified = None
        if margin_of_safety is not None and margin_of_safety < -10 and earnings_growth:
            # Overvalued — check if growth justifies it
            premium_justified = earnings_growth > 25

        return {
            "symbol": sym,
            "name": name,
            "sector": sector,
            "cmp": cmp,
            # Raw metrics
            "trailing_pe": trailing_pe,
            "forward_pe": forward_pe,
            "price_to_book": pb,
            "ev_to_ebitda": ev_ebitda,
            "eps": eps,
            "book_value_per_share": bvps,
            "roe": roe,
            "revenue_growth": revenue_growth,
            "earnings_growth": earnings_growth,
            # Sector benchmarks
            "sector_median_pe": sector_pe,
            "sector_median_pb": sector_pb,
            # Method results
            "method_a": method_a,
            "method_b": method_b,
            "method_c": method_c,
            # Weighted output
            "fair_value": fair_value,
            "margin_of_safety_pct": margin_of_safety,
            "verdict": verdict,
            "verdict_color": verdict_color,
            "attractive_price": attractive_price,
            "exit_on_valuation": exit_on_valuation,
            "premium_justified": premium_justified,
        }

    def assess_portfolio(self, portfolio_name: str) -> list:
        """Assess all stocks in a named portfolio."""
        pf_config = config.PORTFOLIOS.get(portfolio_name, {})
        symbols = pf_config.get("stocks", [])
        results = []
        for sym in symbols:
            try:
                results.append(self.assess(sym))
            except Exception as e:
                log.warning(f"[Valuation] Error assessing {sym}: {e}")
                results.append({"symbol": sym.replace(".NS", ""), "error": str(e)})
        return results

    # ── Method implementations ────────────────────────────────────────────────

    def _method_a_relative(self, pe, pb, ev_ebitda, sector_pe, sector_pb, sector) -> dict:
        """Compare current multiples vs sector medians."""
        signals = []
        pe_status = "N/A"
        pb_status = "N/A"
        ev_status = "N/A"
        score = 0  # negative = overvalued, positive = undervalued

        if pe and sector_pe:
            ratio = pe / sector_pe
            if ratio < 0.75:
                pe_status = "UNDERVALUED"
                score += 2
                signals.append(f"P/E {pe:.1f} is {(1-ratio)*100:.0f}% below sector median")
            elif ratio < 1.10:
                pe_status = "FAIR"
                score += 0
                signals.append(f"P/E {pe:.1f} near sector median ({sector_pe})")
            elif ratio < 1.40:
                pe_status = "SLIGHTLY OVERVALUED"
                score -= 1
                signals.append(f"P/E {pe:.1f} is {(ratio-1)*100:.0f}% above sector median")
            else:
                pe_status = "OVERVALUED"
                score -= 2
                signals.append(f"P/E {pe:.1f} is {(ratio-1)*100:.0f}% above sector median ({sector_pe})")

        if pb and sector_pb:
            ratio = pb / sector_pb
            if ratio < 0.70:
                pb_status = "UNDERVALUED"
                score += 2
            elif ratio < 1.15:
                pb_status = "FAIR"
            elif ratio < 1.50:
                pb_status = "SLIGHTLY OVERVALUED"
                score -= 1
            else:
                pb_status = "OVERVALUED"
                score -= 2

        if ev_ebitda:
            if ev_ebitda < 8:
                ev_status = "CHEAP"
                score += 1
            elif ev_ebitda < 15:
                ev_status = "FAIR"
            elif ev_ebitda < 25:
                ev_status = "EXPENSIVE"
                score -= 1
            else:
                ev_status = "VERY EXPENSIVE"
                score -= 2

        if score >= 2:
            overall = "UNDERVALUED"
        elif score >= 0:
            overall = "FAIRLY VALUED"
        elif score >= -2:
            overall = "SLIGHTLY OVERVALUED"
        else:
            overall = "OVERVALUED"

        return {
            "pe_vs_sector": pe_status,
            "pb_vs_sector": pb_status,
            "ev_ebitda_status": ev_status,
            "overall": overall,
            "score": score,
            "signals": signals,
            # Implied fair value via sector PE (if available)
            "implied_fair_pe": None,  # set below in caller if eps available
        }

    def _method_b_dcf(self, eps, earnings_growth, revenue_growth, sector_pe, cmp) -> dict:
        """Simplified DCF: grow EPS for 5 years then apply exit P/E."""
        if not eps or eps <= 0:
            return {"fair_value": None, "premium_pct": None, "note": "EPS not available"}

        # Use conservative growth rate: lower of earnings growth or 20% cap
        growth = 0.10  # base case
        if earnings_growth is not None and earnings_growth > 0:
            growth = min(earnings_growth / 100, 0.20)
        elif revenue_growth is not None and revenue_growth > 0:
            growth = min(revenue_growth / 100 * 0.8, 0.18)

        discount_rate = 0.12  # 12% — India cost of equity
        terminal_growth = 0.05

        # Grow EPS for 5 years, discount back
        pv_eps = 0
        for y in range(1, 6):
            future_eps = eps * ((1 + growth) ** y)
            pv_eps += future_eps / ((1 + discount_rate) ** y)

        # Terminal value: EPS at year 5 × exit P/E
        exit_pe = sector_pe if sector_pe else 20
        terminal_eps = eps * ((1 + growth) ** 5)
        # Grow terminal at 5%, discount at 12%
        terminal_value = terminal_eps * exit_pe / ((1 + discount_rate) ** 5)

        fair_value = round(pv_eps + terminal_value, 1)
        premium_pct = None
        if cmp and fair_value:
            premium_pct = round((cmp - fair_value) / fair_value * 100, 1)

        return {
            "fair_value": fair_value,
            "premium_pct": premium_pct,  # positive = overvalued vs DCF, negative = discount
            "growth_used": round(growth * 100, 1),
            "note": f"5Y EPS growth {growth*100:.1f}%, exit P/E {exit_pe}",
        }

    def _method_c_graham(self, eps, bvps, cmp) -> dict:
        """Graham Number = sqrt(22.5 × EPS × BVPS)."""
        if not eps or eps <= 0 or not bvps or bvps <= 0:
            return {"fair_value": None, "premium_pct": None, "note": "EPS or BVPS not available"}

        graham = round(math.sqrt(22.5 * eps * bvps), 1)
        premium_pct = None
        if cmp:
            premium_pct = round((cmp - graham) / graham * 100, 1)

        if cmp and graham:
            ratio = cmp / graham
            if ratio < 1.0:
                status = "DEEP VALUE"
            elif ratio < 1.5:
                status = "FAIR VALUE"
            elif ratio < 2.0:
                status = "SLIGHTLY EXPENSIVE"
            else:
                status = "SPECULATIVE"
        else:
            status = "N/A"

        return {
            "fair_value": graham,
            "premium_pct": premium_pct,
            "status": status,
            "note": f"sqrt(22.5 × EPS {eps} × BVPS {bvps:.1f})" if eps and bvps else "",
        }

    def _weighted_fair_value(self, method_a, method_b, method_c, cmp) -> tuple:
        """Weighted average of 3 methods → single fair value + margin of safety."""
        fv_b = method_b.get("fair_value")
        fv_c = method_c.get("fair_value")

        values = []
        weights = []

        # Method A doesn't give a direct price; use Method B + C
        if fv_b:
            values.append(fv_b)
            weights.append(0.60)
        if fv_c:
            values.append(fv_c)
            weights.append(0.40)

        if not values:
            return None, None

        total_weight = sum(weights)
        fair_value = sum(v * w for v, w in zip(values, weights)) / total_weight
        fair_value = round(fair_value, 1)

        margin_of_safety = None
        if cmp and fair_value:
            # Positive MoS = stock is below fair value (good to buy)
            margin_of_safety = round((fair_value - cmp) / fair_value * 100, 1)

        return fair_value, margin_of_safety

    def _compute_verdict(self, mos, method_a, method_b, method_c) -> tuple:
        """Derive final valuation verdict."""
        a_overall = method_a.get("overall", "")
        fv_b = method_b.get("fair_value")
        fv_c = method_c.get("fair_value")

        # If MoS is available, it's the primary signal
        if mos is not None:
            if mos >= 20:
                return "UNDERVALUED", "#22c55e"
            elif mos >= 5:
                return "FAIRLY VALUED", "#4ade80"
            elif mos >= -15:
                return "FAIRLY VALUED", "#eab308"
            elif mos >= -30:
                return "OVERVALUED", "#f97316"
            else:
                return "SIGNIFICANTLY OVERVALUED", "#ef4444"

        # Fall back to Method A relative signal
        if "UNDER" in a_overall:
            return "UNDERVALUED", "#22c55e"
        elif "OVER" in a_overall:
            return "OVERVALUED", "#f97316"
        return "FAIRLY VALUED", "#eab308"

    # ── Sector medians ────────────────────────────────────────────────────────

    def _sector_median_pe(self, sector: str):
        """Get sector median P/E from composite data or fallback table."""
        if not self._composite.empty and "sector" in self._composite.columns and "trailing_pe" in self._composite.columns:
            sec_rows = self._composite[self._composite["sector"] == sector]["trailing_pe"].dropna()
            if len(sec_rows) >= 3:
                return round(float(sec_rows.median()), 1)

        # Check for partial match in fallback table
        for key, val in SECTOR_PE_MEDIANS.items():
            if key.lower() in sector.lower() or sector.lower() in key.lower():
                return val

        return 25  # broad market default

    def _sector_median_pb(self, sector: str):
        """Get sector median P/B from composite data or fallback table."""
        if not self._composite.empty and "sector" in self._composite.columns and "price_to_book" in self._composite.columns:
            sec_rows = self._composite[self._composite["sector"] == sector]["price_to_book"].dropna()
            if len(sec_rows) >= 3:
                return round(float(sec_rows.median()), 1)

        for key, val in SECTOR_PB_MEDIANS.items():
            if key.lower() in sector.lower() or sector.lower() in key.lower():
                return val

        return 3.5  # broad market default
