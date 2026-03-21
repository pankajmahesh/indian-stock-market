"""
Defense Mode & Alpha Discovery Screener (Skill 12)

Implements 4 rules:
  Rule 1: Away from high beta — flag stocks with beta > 1.2
  Rule 2: Opportunity in panic — detect quality stocks oversold in market panic
  Rule 3: Preserve cash — flag war/geopolitical-risk stocks by sector
  Rule 4: Find alpha — 2-3 year compounder screen
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd
import numpy as np

import config
from utils.logger import log


# ── Sector classification ────────────────────────────────────────────────────

# Sectors that are defensive (low beta, low war risk)
DEFENSIVE_SECTORS = {
    "Pharmaceuticals", "Healthcare", "FMCG", "Consumer Staples",
    "IT Services", "Information Technology", "Utilities", "Power",
    "Telecom", "Insurance",
}

# Sectors with elevated war / geopolitical risk
WAR_RISK_SECTORS = {
    "Aviation": "high",           # oil cost spike
    "Airlines": "high",
    "Paints": "high",             # crude-derived inputs
    "Chemicals": "high",          # global supply chain
    "Tyres": "high",              # rubber + crude
    "Shipping": "high",           # freight rate volatility
    "Logistics": "medium",
    "Oil & Gas": "medium",        # global pricing
    "Metals": "medium",           # global demand / sanctions
    "Mining": "medium",
    "Auto": "medium",             # supply chain + export exposure
    "Auto Components": "medium",
    "Electronics": "medium",      # China import dependency
    "Consumer Electronics": "medium",
    "Capital Goods": "medium",    # order-driven, capex delays in uncertainty
    "Real Estate": "medium",
    "Fertilizers": "medium",      # natural gas feedstock
}

# Safe haven sectors in geopolitical crisis
SAFE_HAVEN_SECTORS = {
    "Pharmaceuticals", "Healthcare", "FMCG", "Consumer Staples",
    "Defence", "Defense", "Aerospace", "Utilities", "Power",
    "Agriculture", "Agri Inputs", "Telecom",
}

# India 2030 structural themes for alpha hunt
INDIA_THEME_SECTORS = {
    "Capital Goods", "Infrastructure", "Defence", "Defense", "Power",
    "Renewable Energy", "Solar", "Semiconductors", "Electronics Manufacturing",
    "Pharmaceuticals", "Healthcare", "Hospitals", "CDMO",
    "IT Services", "Information Technology", "Fintech",
    "Insurance", "Microfinance", "Small Finance Bank",
}


def _safe(v, default=None):
    if v is None:
        return default
    try:
        f = float(v)
        return default if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return default


class DefenseAlphaScreener:
    """
    Runs all 4 defense/alpha rules on a list of stocks.
    Uses yfinance for live beta + fundamentals.
    Falls back gracefully when data is unavailable.
    """

    def __init__(self):
        pass

    def screen(self, symbols: list, fundamental_df: pd.DataFrame = None) -> list:
        """
        Screen symbols through all 4 rules.

        Args:
            symbols: list of NSE ticker strings (e.g. ['RELIANCE', 'TCS'])
            fundamental_df: optional DataFrame with pre-fetched fundamental scores

        Returns:
            list of dicts, one per symbol
        """
        import yfinance as yf

        results = []
        fund_map = {}
        if fundamental_df is not None and not fundamental_df.empty:
            for _, row in fundamental_df.iterrows():
                sym = str(row.get("symbol", "")).replace(".NS", "").upper()
                fund_map[sym] = row.to_dict()

        # Fetch yfinance info for all symbols
        for raw_sym in symbols:
            sym = raw_sym.replace(".NS", "").upper()
            sym_ns = sym + ".NS"
            fund = fund_map.get(sym, {})
            result = self._screen_one(sym, sym_ns, fund, yf)
            results.append(result)

        return results

    def _screen_one(self, sym: str, sym_ns: str, fund: dict, yf) -> dict:
        """Run all 4 rules for a single stock."""
        info = {}
        try:
            ticker = yf.Ticker(sym_ns)
            info = ticker.info or {}
        except Exception:
            pass

        sector = str(info.get("sector") or info.get("industry") or fund.get("sector") or "Unknown")
        name = str(info.get("longName") or info.get("shortName") or fund.get("name") or sym)
        cmp = _safe(info.get("regularMarketPrice") or info.get("currentPrice"))
        beta = _safe(info.get("beta"), default=1.0)

        # Fundamental fields (prefer yfinance, fall back to our CSV scores)
        roe = _safe(info.get("returnOnEquity"))
        if roe is not None:
            roe = roe * 100  # yfinance returns as decimal
        trailing_pe = _safe(info.get("trailingPE"))
        pb = _safe(info.get("priceToBook"))
        de = _safe(info.get("debtToEquity"))
        fcf = _safe(info.get("freeCashflow"))
        revenue_growth = _safe(info.get("revenueGrowth"))
        if revenue_growth is not None:
            revenue_growth = revenue_growth * 100
        mcap = _safe(info.get("marketCap"))
        fund_score = _safe(fund.get("fundamental_score"), default=50)
        rsi = _safe(fund.get("rsi_value"))
        signal = str(fund.get("signal") or "HOLD")

        # ── Rule 1: Beta Risk ────────────────────────────────────────────────
        beta_risk = self._rule1_beta(beta, sector)

        # ── Rule 2: Panic Opportunity ────────────────────────────────────────
        panic_opportunity = self._rule2_panic(fund_score, rsi, signal, beta)

        # ── Rule 3: War/Geopolitical Risk ────────────────────────────────────
        war_risk = self._rule3_war_risk(sector)

        # ── Rule 4: Alpha Hunt (2-3 year) ────────────────────────────────────
        alpha_score = self._rule4_alpha(
            roe, de, fcf, revenue_growth, trailing_pe, pb, fund_score, sector, mcap
        )

        # ── Overall defense verdict ──────────────────────────────────────────
        verdict, action, action_color = self._compute_verdict(
            beta_risk, panic_opportunity, war_risk, alpha_score
        )

        return {
            "symbol": sym,
            "name": name,
            "sector": sector,
            "cmp": cmp,
            "beta": round(beta, 2) if beta is not None else None,
            "fundamental_score": round(fund_score, 1) if fund_score else None,
            "rsi": round(rsi, 1) if rsi else None,
            "signal": signal,
            "roe": round(roe, 1) if roe is not None else None,
            "trailing_pe": round(trailing_pe, 1) if trailing_pe is not None else None,
            "revenue_growth": round(revenue_growth, 1) if revenue_growth is not None else None,
            # Rule results
            "beta_risk_level": beta_risk["level"],
            "beta_risk_reason": beta_risk["reason"],
            "panic_opportunity": panic_opportunity["is_opportunity"],
            "panic_score": panic_opportunity["score"],
            "panic_reason": panic_opportunity["reason"],
            "war_risk_level": war_risk["level"],
            "war_risk_reason": war_risk["reason"],
            "is_safe_haven": war_risk["is_safe_haven"],
            "alpha_score": alpha_score["score"],
            "alpha_tier": alpha_score["tier"],
            "alpha_reason": alpha_score["reason"],
            # Summary
            "verdict": verdict,
            "action": action,
            "action_color": action_color,
        }

    # ── Rule implementations ─────────────────────────────────────────────────

    def _rule1_beta(self, beta, sector) -> dict:
        if beta is None:
            return {"level": "UNKNOWN", "reason": "Beta data unavailable"}

        if sector in DEFENSIVE_SECTORS:
            return {"level": "LOW", "reason": f"Defensive sector ({sector}), beta {beta:.2f}"}

        if beta < 0.8:
            return {"level": "LOW", "reason": f"Low beta ({beta:.2f}) — capital protection"}
        elif beta < 1.2:
            return {"level": "MEDIUM", "reason": f"Moderate beta ({beta:.2f}) — acceptable"}
        elif beta < 1.5:
            return {"level": "HIGH", "reason": f"High beta ({beta:.2f}) — avoid in uncertainty"}
        else:
            return {"level": "VERY_HIGH", "reason": f"Very high beta ({beta:.2f}) — exit in bear/war mode"}

    def _rule2_panic(self, fund_score, rsi, signal, beta) -> dict:
        score = 0
        reasons = []

        # Quality filter (fundamentals must be decent)
        if fund_score and fund_score >= 65:
            score += 40
            reasons.append(f"Quality stock (fund score {fund_score:.0f})")
        elif fund_score and fund_score >= 50:
            score += 20
            reasons.append(f"Decent fundamentals ({fund_score:.0f})")
        else:
            return {
                "is_opportunity": False,
                "score": score,
                "reason": f"Poor fundamentals (score {fund_score:.0f}) — not a panic buy",
            }

        # RSI oversold
        if rsi and rsi < 35:
            score += 35
            reasons.append(f"RSI oversold ({rsi:.0f})")
        elif rsi and rsi < 45:
            score += 15
            reasons.append(f"RSI weak ({rsi:.0f})")

        # Low beta = panic is macro-driven, not stock-specific
        if beta and beta < 1.0:
            score += 15
            reasons.append("Low beta — fall likely macro-driven")
        elif beta and beta < 1.3:
            score += 5

        # Signal
        if signal == "BUY":
            score += 10
            reasons.append("BUY signal active")

        is_opp = score >= 60
        return {
            "is_opportunity": is_opp,
            "score": min(100, score),
            "reason": "; ".join(reasons) if reasons else "Insufficient data",
        }

    def _rule3_war_risk(self, sector) -> dict:
        is_safe = sector in SAFE_HAVEN_SECTORS
        war_level = WAR_RISK_SECTORS.get(sector)

        if is_safe:
            return {
                "level": "SAFE_HAVEN",
                "reason": f"{sector} is a safe haven in geopolitical crisis",
                "is_safe_haven": True,
            }
        elif war_level == "high":
            return {
                "level": "HIGH",
                "reason": f"{sector} sector faces direct war/geopolitical risk (oil/supply chain)",
                "is_safe_haven": False,
            }
        elif war_level == "medium":
            return {
                "level": "MEDIUM",
                "reason": f"{sector} has moderate geopolitical exposure",
                "is_safe_haven": False,
            }
        else:
            return {
                "level": "LOW",
                "reason": f"{sector} has low direct geopolitical risk",
                "is_safe_haven": False,
            }

    def _rule4_alpha(self, roe, de, fcf, revenue_growth, pe, pb, fund_score, sector, mcap) -> dict:
        score = 0
        reasons = []

        # ROE > 18% → strong compounder quality
        if roe and roe >= 20:
            score += 25
            reasons.append(f"ROE {roe:.1f}% — excellent")
        elif roe and roe >= 15:
            score += 15
            reasons.append(f"ROE {roe:.1f}% — good")

        # D/E < 50 → not leveraged
        if de is not None and de < 50:
            score += 15
            reasons.append(f"Low leverage (D/E {de:.0f})")
        elif de is not None and de < 100:
            score += 8

        # Positive FCF
        if fcf and fcf > 0:
            score += 15
            reasons.append("Positive FCF")

        # Revenue growth
        if revenue_growth and revenue_growth >= 18:
            score += 20
            reasons.append(f"Revenue growth {revenue_growth:.1f}%")
        elif revenue_growth and revenue_growth >= 10:
            score += 10
            reasons.append(f"Revenue growth {revenue_growth:.1f}%")

        # Valuation not crazy
        if pe and 0 < pe < 40:
            score += 10
            reasons.append(f"P/E {pe:.1f} — reasonable")
        elif pe and pe < 60:
            score += 5

        # India theme alignment
        if sector in INDIA_THEME_SECTORS:
            score += 10
            reasons.append(f"India 2030 theme: {sector}")

        # Mid-cap sweet spot (500 Cr – 15000 Cr)
        if mcap:
            mcap_cr = mcap / 1e7
            if 500 <= mcap_cr <= 15000:
                score += 5
                reasons.append("Mid-cap alpha zone")

        # Fundamental score backing
        if fund_score and fund_score >= 70:
            score += 10

        score = min(100, score)
        if score >= 75:
            tier = "STRONG"
        elif score >= 55:
            tier = "MODERATE"
        elif score >= 35:
            tier = "WEAK"
        else:
            tier = "NONE"

        return {
            "score": score,
            "tier": tier,
            "reason": "; ".join(reasons) if reasons else "Insufficient data for alpha assessment",
        }

    def _compute_verdict(self, beta_risk, panic_opp, war_risk, alpha) -> tuple:
        beta_level = beta_risk["level"]
        war_level = war_risk["level"]
        is_safe_haven = war_risk["is_safe_haven"]
        alpha_tier = alpha["tier"]
        is_panic_opp = panic_opp["is_opportunity"]
        alpha_score = alpha["score"]

        # Priority 1: Safe haven in war + strong alpha = top pick
        if is_safe_haven and alpha_tier in ("STRONG", "MODERATE"):
            return "STRONG BUY", "BUY — Safe Haven + Alpha", "#22c55e"

        # Priority 2: Panic opportunity (quality stock, oversold)
        if is_panic_opp and beta_level in ("LOW", "MEDIUM") and war_level != "HIGH":
            return "PANIC BUY", "BUY — Panic Opportunity", "#3b82f6"

        # Priority 3: Exit high war risk
        if war_level == "HIGH" and beta_level in ("HIGH", "VERY_HIGH"):
            return "SELL", "SELL — War Risk + High Beta", "#ef4444"

        # Priority 4: Reduce high beta in uncertainty
        if beta_level == "VERY_HIGH":
            return "REDUCE", "REDUCE — Very High Beta", "#f97316"

        if beta_level == "HIGH" and war_level in ("HIGH", "MEDIUM"):
            return "REDUCE", "REDUCE — High Beta + War Risk", "#f97316"

        # Priority 5: Strong alpha compounder = accumulate
        if alpha_tier == "STRONG" and beta_level in ("LOW", "MEDIUM") and war_level != "HIGH":
            return "ACCUMULATE", "ACCUMULATE — 2-3Y Alpha Candidate", "#4ade80"

        if alpha_tier == "MODERATE" and beta_level == "LOW":
            return "ACCUMULATE", "ACCUMULATE — Moderate Alpha + Safe", "#4ade80"

        # Priority 6: War risk alone = watch
        if war_level == "HIGH":
            return "WATCH", "WATCH — Geopolitical Risk", "#eab308"

        # Default: hold
        return "HOLD", "HOLD — Neutral", "#94a3b8"


def screen_portfolio(portfolio_name: str) -> list:
    """Convenience function to screen a named portfolio."""
    from modules.defense_alpha_screener import DefenseAlphaScreener

    pf_config = config.PORTFOLIOS.get(portfolio_name, {})
    symbols = pf_config.get("stocks", [])
    if not symbols:
        return []

    # Try to load fundamental scores for enrichment
    fund_df = pd.DataFrame()
    fund_path = os.path.join(config.DATA_DIR, "fundamental_scores.csv")
    if os.path.exists(fund_path):
        try:
            fund_df = pd.read_csv(fund_path)
        except Exception:
            pass

    screener = DefenseAlphaScreener()
    return screener.screen(symbols, fund_df)


def screen_watchlist(symbols: list) -> list:
    """Screen an arbitrary list of symbols."""
    fund_df = pd.DataFrame()
    fund_path = os.path.join(config.DATA_DIR, "fundamental_scores.csv")
    if os.path.exists(fund_path):
        try:
            fund_df = pd.read_csv(fund_path)
        except Exception:
            pass

    screener = DefenseAlphaScreener()
    return screener.screen(symbols, fund_df)
