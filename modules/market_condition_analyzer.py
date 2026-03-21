"""
Market Condition Analyzer
Assesses the current broad market regime (Nifty 50) to inform
portfolio rebalancing decisions.

Regime scoring (total -100 to +100):
  Price vs 200 DMA  : ±25 pts
  Price vs 50 DMA   : ±20 pts
  50 DMA vs 200 DMA : ±20 pts  (golden/death cross)
  20-day ROC        : ±20 pts  (short-term momentum)
  India VIX         : ±15 pts  (fear gauge)

Thresholds:
  >= 55  → STRONG_BULL
  20-54  → BULL
  -19-19 → NEUTRAL
  -20 to -54 → BEAR
  <= -55 → STRONG_BEAR
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
import pandas as pd

try:
    import yfinance as yf
except ImportError:
    yf = None

from utils.logger import log


# ── Sector bias per regime ────────────────────────────────────────────────────
SECTOR_BIAS = {
    "STRONG_BULL": {
        "favour": ["Capital Goods", "Realty", "Metals", "Auto", "Midcap", "Smallcap"],
        "avoid":  ["FMCG", "Utilities", "Pharma"],
        "note":   "Rotate into cyclicals and high-beta sectors; momentum favoured.",
    },
    "BULL": {
        "favour": ["IT", "Auto", "BFSI", "Capital Goods", "Consumer Discretionary"],
        "avoid":  [],
        "note":   "Broad participation; add quality-growth stocks on dips.",
    },
    "NEUTRAL": {
        "favour": ["IT", "Pharma", "FMCG", "Quality Financials"],
        "avoid":  ["Realty", "Metals", "High-debt Smallcaps"],
        "note":   "Stay selective; prefer large-cap quality over speculative bets.",
    },
    "BEAR": {
        "favour": ["FMCG", "Pharma", "IT (export)", "Gold ETF"],
        "avoid":  ["Realty", "Metals", "Midcap", "Smallcap"],
        "note":   "Reduce high-beta; build cash; defensive rotation.",
    },
    "STRONG_BEAR": {
        "favour": ["Cash", "Gold ETF", "Govt-bond funds", "Pharma"],
        "avoid":  ["Cyclicals", "Smallcap", "High-debt companies"],
        "note":   "Capital preservation mode. Exit losers aggressively.",
    },
}

# ── Recommended equity allocation per regime (%) ─────────────────────────────
EQUITY_ALLOCATION = {
    "STRONG_BULL": (90, 100),
    "BULL":        (80, 90),
    "NEUTRAL":     (65, 75),
    "BEAR":        (45, 60),
    "STRONG_BEAR": (25, 40),
}

# ── Score thresholds for ADD suggestions per regime ──────────────────────────
ADD_SCORE_THRESHOLD = {
    "STRONG_BULL": 55,
    "BULL":        60,
    "NEUTRAL":     68,
    "BEAR":        75,
    "STRONG_BEAR": 82,
}

# ── Risk filter for ADD suggestions per regime ───────────────────────────────
ADD_RISK_ALLOWED = {
    "STRONG_BULL": {"LOW", "MEDIUM", "HIGH"},
    "BULL":        {"LOW", "MEDIUM", "HIGH"},
    "NEUTRAL":     {"LOW", "MEDIUM"},
    "BEAR":        {"LOW", "MEDIUM"},
    "STRONG_BEAR": {"LOW"},
}

# ── Trim aggressiveness per regime ───────────────────────────────────────────
# (action overrides for HOLD stocks in different market conditions)
HOLD_RISK_ACTION = {
    "STRONG_BULL": {"HIGH": "WATCH"},
    "BULL":        {"HIGH": "WATCH"},
    "NEUTRAL":     {"HIGH": "WATCH", "MEDIUM": "WATCH"},
    "BEAR":        {"HIGH": "TRIM",  "MEDIUM": "WATCH"},
    "STRONG_BEAR": {"HIGH": "EXIT",  "MEDIUM": "TRIM", "LOW": "WATCH"},
}


class MarketConditionAnalyzer:
    """Analyse Nifty 50 to derive current market regime."""

    NIFTY_TICKER  = "^NSEI"
    VIX_TICKER    = "^INDIAVIX"
    HISTORY_DAYS  = 300   # enough for 200 DMA

    def analyze(self) -> dict:
        """
        Fetch Nifty + VIX data and return a market-condition dict.

        Returns
        -------
        dict with keys:
          regime, regime_score, nifty_price, nifty_change_pct,
          nifty_vs_50dma_pct, nifty_vs_200dma_pct,
          dma50, dma200, vix, trend_direction,
          equity_allocation_min, equity_allocation_max,
          add_score_threshold, add_risk_allowed,
          sector_bias, hold_risk_action,
          error (optional)
        """
        try:
            if yf is None:
                return self._fallback("yfinance not installed")

            nifty_hist = self._fetch(self.NIFTY_TICKER)
            if nifty_hist is None or len(nifty_hist) < 50:
                return self._fallback("Insufficient Nifty data")

            score = 0
            details = {}

            closes = nifty_hist["Close"].dropna()
            latest = float(closes.iloc[-1])
            prev   = float(closes.iloc[-2]) if len(closes) >= 2 else latest

            nifty_change_pct = round((latest - prev) / prev * 100, 2)

            # ── 1. Price vs 200 DMA (±25 pts) ─────────────────────────────
            if len(closes) >= 200:
                dma200 = float(closes.iloc[-200:].mean())
                vs_200 = (latest - dma200) / dma200 * 100
                if   vs_200 >  5: score += 25
                elif vs_200 >  2: score += 15
                elif vs_200 >  0: score += 8
                elif vs_200 > -2: score -= 8
                elif vs_200 > -5: score -= 15
                else:             score -= 25
                details["vs_200dma_pct"] = round(vs_200, 2)
            else:
                dma200 = None
                details["vs_200dma_pct"] = None

            # ── 2. Price vs 50 DMA (±20 pts) ──────────────────────────────
            if len(closes) >= 50:
                dma50 = float(closes.iloc[-50:].mean())
                vs_50 = (latest - dma50) / dma50 * 100
                if   vs_50 >  3: score += 20
                elif vs_50 >  1: score += 12
                elif vs_50 >  0: score += 6
                elif vs_50 > -1: score -= 6
                elif vs_50 > -3: score -= 12
                else:            score -= 20
                details["vs_50dma_pct"] = round(vs_50, 2)
            else:
                dma50 = None
                details["vs_50dma_pct"] = None

            # ── 3. 50 DMA vs 200 DMA — golden / death cross (±20 pts) ─────
            if dma50 is not None and dma200 is not None:
                cross_pct = (dma50 - dma200) / dma200 * 100
                if   cross_pct >  2: score += 20
                elif cross_pct >  0: score += 10
                elif cross_pct > -2: score -= 10
                else:                score -= 20
                details["50_vs_200_pct"] = round(cross_pct, 2)
            else:
                details["50_vs_200_pct"] = None

            # ── 4. 20-day Rate of Change — short-term momentum (±20 pts) ──
            if len(closes) >= 21:
                roc20 = (float(closes.iloc[-1]) - float(closes.iloc[-21])) / float(closes.iloc[-21]) * 100
                if   roc20 >  5: score += 20
                elif roc20 >  2: score += 12
                elif roc20 >  0: score += 5
                elif roc20 > -2: score -= 5
                elif roc20 > -5: score -= 12
                else:            score -= 20
                details["roc_20d_pct"] = round(roc20, 2)
            else:
                details["roc_20d_pct"] = None

            # ── 5. India VIX (±15 pts) ─────────────────────────────────────
            vix = self._fetch_vix()
            if vix is not None:
                if   vix < 12: score += 15
                elif vix < 16: score += 8
                elif vix < 20: score += 0
                elif vix < 25: score -= 8
                elif vix < 30: score -= 12
                else:          score -= 15
                details["vix"] = round(vix, 2)
            else:
                details["vix"] = None

            # ── Derive regime ──────────────────────────────────────────────
            score = max(-100, min(100, score))
            regime = self._score_to_regime(score)

            # ── Trend direction ────────────────────────────────────────────
            roc = details.get("roc_20d_pct") or 0
            vs50 = details.get("vs_50dma_pct") or 0
            if roc > 1 and vs50 > 0:
                trend_direction = "UPTREND"
            elif roc < -1 and vs50 < 0:
                trend_direction = "DOWNTREND"
            else:
                trend_direction = "SIDEWAYS"

            eq_min, eq_max = EQUITY_ALLOCATION[regime]

            return {
                "regime":               regime,
                "regime_score":         score,
                "nifty_price":          round(latest, 2),
                "nifty_change_pct":     nifty_change_pct,
                "nifty_vs_50dma_pct":   details.get("vs_50dma_pct"),
                "nifty_vs_200dma_pct":  details.get("vs_200dma_pct"),
                "dma50":                round(dma50, 2) if dma50 else None,
                "dma200":               round(dma200, 2) if dma200 else None,
                "vix":                  details.get("vix"),
                "roc_20d_pct":          details.get("roc_20d_pct"),
                "trend_direction":      trend_direction,
                "equity_allocation_min": eq_min,
                "equity_allocation_max": eq_max,
                "add_score_threshold":  ADD_SCORE_THRESHOLD[regime],
                "add_risk_allowed":     list(ADD_RISK_ALLOWED[regime]),
                "sector_bias":          SECTOR_BIAS[regime],
                "hold_risk_action":     HOLD_RISK_ACTION[regime],
            }

        except Exception as exc:
            log.warning(f"MarketConditionAnalyzer error: {exc}")
            return self._fallback(str(exc))

    # ── helpers ───────────────────────────────────────────────────────────────

    def _fetch(self, ticker: str):
        try:
            t = yf.Ticker(ticker)
            hist = t.history(period="1y")
            if hist.empty:
                return None
            return hist
        except Exception as e:
            log.warning(f"Failed to fetch {ticker}: {e}")
            return None

    def _fetch_vix(self):
        try:
            hist = self._fetch(self.VIX_TICKER)
            if hist is not None and len(hist) > 0:
                return float(hist["Close"].dropna().iloc[-1])
        except Exception:
            pass
        return None

    @staticmethod
    def _score_to_regime(score: int) -> str:
        if   score >= 55: return "STRONG_BULL"
        elif score >= 20: return "BULL"
        elif score > -20: return "NEUTRAL"
        elif score > -55: return "BEAR"
        else:             return "STRONG_BEAR"

    @staticmethod
    def _fallback(reason: str) -> dict:
        """Return a NEUTRAL regime when data is unavailable."""
        regime = "NEUTRAL"
        eq_min, eq_max = EQUITY_ALLOCATION[regime]
        log.warning(f"Market condition fallback (NEUTRAL) — reason: {reason}")
        return {
            "regime":               regime,
            "regime_score":         0,
            "nifty_price":          None,
            "nifty_change_pct":     None,
            "nifty_vs_50dma_pct":   None,
            "nifty_vs_200dma_pct":  None,
            "dma50":                None,
            "dma200":               None,
            "vix":                  None,
            "roc_20d_pct":          None,
            "trend_direction":      "UNKNOWN",
            "equity_allocation_min": eq_min,
            "equity_allocation_max": eq_max,
            "add_score_threshold":  ADD_SCORE_THRESHOLD[regime],
            "add_risk_allowed":     list(ADD_RISK_ALLOWED[regime]),
            "sector_bias":          SECTOR_BIAS[regime],
            "hold_risk_action":     HOLD_RISK_ACTION[regime],
            "error":                reason,
        }
