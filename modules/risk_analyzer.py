"""
Real-time Risk Analyzer — Adapted from stock-risk-analyzer project.

Computes per-stock risk metrics using:
  - Annualized volatility (21-day rolling std * sqrt(252))
  - Bollinger Band position (% distance from bands)
  - MA50/MA200 deviation
  - Risk classification: LOW / MEDIUM / HIGH
  - Risk score 0-100 (higher = riskier)

Combined with live momentum signals for real-time BUY/SELL/HOLD.
"""
import math

import numpy as np
import pandas as pd
import ta

from utils.logger import log


class RiskAnalyzer:
    """Compute risk metrics for a single stock from its price DataFrame."""

    def analyze(self, prices, current_price=None):
        """
        Compute risk metrics from OHLCV price DataFrame.
        Returns dict with risk_level, risk_score, volatility, bollinger, etc.
        """
        if prices is None or prices.empty or len(prices) < 30:
            return self._empty()

        try:
            close = prices["Close"].astype(float)
            high = prices["High"].astype(float) if "High" in prices else close
            low = prices["Low"].astype(float) if "Low" in prices else close
            cmp = current_price or close.iloc[-1]

            # --- Volatility (annualized, 21-day rolling) ---
            daily_ret = close.pct_change()
            vol_series = daily_ret.rolling(window=21).std() * np.sqrt(252)
            volatility = vol_series.iloc[-1]
            if math.isnan(volatility):
                volatility = None

            # Volatility percentile (vs own history)
            vol_pct = None
            if volatility is not None and len(vol_series.dropna()) > 20:
                vol_pct = round(
                    (vol_series.dropna() <= volatility).mean() * 100, 1
                )

            # --- Moving averages ---
            ma50 = close.rolling(50).mean().iloc[-1] if len(close) >= 50 else None
            ma200 = close.rolling(200).mean().iloc[-1] if len(close) >= 200 else None

            ma50_dev = None
            if ma50 is not None and ma50 > 0:
                ma50_dev = round((cmp - ma50) / ma50 * 100, 2)

            ma200_dev = None
            if ma200 is not None and ma200 > 0:
                ma200_dev = round((cmp - ma200) / ma200 * 100, 2)

            # --- Bollinger Bands (20, 2) ---
            bb = ta.volatility.BollingerBands(close, window=20, window_dev=2)
            bb_upper = bb.bollinger_hband().iloc[-1]
            bb_lower = bb.bollinger_lband().iloc[-1]
            bb_mid = bb.bollinger_mavg().iloc[-1]
            bb_width = None
            bb_pct_b = None
            if bb_upper and bb_lower and bb_mid and bb_mid > 0:
                bb_width = round((bb_upper - bb_lower) / bb_mid * 100, 2)
                if (bb_upper - bb_lower) > 0:
                    bb_pct_b = round((cmp - bb_lower) / (bb_upper - bb_lower) * 100, 1)

            # --- ATR (Average True Range, 14-day) ---
            atr_ind = ta.volatility.AverageTrueRange(high, low, close, window=14)
            atr = atr_ind.average_true_range().iloc[-1]
            atr_pct = None
            if atr is not None and cmp > 0 and not math.isnan(atr):
                atr_pct = round(atr / cmp * 100, 2)

            # --- Daily return ---
            daily_return = daily_ret.iloc[-1]
            if daily_return is not None and not math.isnan(daily_return):
                daily_return = round(daily_return * 100, 2)
            else:
                daily_return = None

            # --- Max drawdown (rolling 252 days) ---
            window = min(252, len(close))
            rolling_max = close.rolling(window, min_periods=1).max()
            drawdown = (close - rolling_max) / rolling_max
            max_drawdown = round(drawdown.min() * 100, 1)
            current_drawdown = round(drawdown.iloc[-1] * 100, 1)

            # --- Risk Score (0-100, higher = riskier) ---
            risk_score = self._compute_risk_score(
                volatility, vol_pct, bb_pct_b, ma50_dev, ma200_dev,
                atr_pct, current_drawdown
            )

            # --- Risk Level ---
            risk_level = self._classify_risk(risk_score)

            return {
                "risk_level": risk_level,
                "risk_score": risk_score,
                "volatility_ann": round(volatility * 100, 1) if volatility else None,
                "volatility_percentile": vol_pct,
                "daily_return_pct": daily_return,
                "ma50": round(ma50, 2) if ma50 else None,
                "ma200": round(ma200, 2) if ma200 else None,
                "ma50_deviation_pct": ma50_dev,
                "ma200_deviation_pct": ma200_dev,
                "bb_upper": round(bb_upper, 2) if bb_upper else None,
                "bb_lower": round(bb_lower, 2) if bb_lower else None,
                "bb_width_pct": bb_width,
                "bb_pct_b": bb_pct_b,
                "atr_pct": atr_pct,
                "max_drawdown_pct": max_drawdown,
                "current_drawdown_pct": current_drawdown,
            }

        except Exception as e:
            log.warning(f"Risk analysis error: {e}")
            return self._empty()

    def _compute_risk_score(self, vol, vol_pct, bb_pct_b, ma50_dev, ma200_dev,
                            atr_pct, current_dd):
        """
        Composite risk score 0-100.
        Uses weighted combination of volatility, BB position, MA deviation, ATR, drawdown.
        Adapted from stock-risk-analyzer's α formula:
          α = w₁σ + w₂|deviation_MA50| + w₃|deviation_MA200| + w₄|drawdown|
        """
        score = 0
        weights_used = 0

        # Volatility component (0-30 points) — weight 0.30
        if vol is not None:
            vol_pct_val = vol * 100  # annualized %
            if vol_pct_val > 60:
                score += 30
            elif vol_pct_val > 40:
                score += 22
            elif vol_pct_val > 30:
                score += 15
            elif vol_pct_val > 20:
                score += 10
            else:
                score += 5
            weights_used += 0.30

        # Bollinger position component (0-20 points) — weight 0.15
        if bb_pct_b is not None:
            if bb_pct_b > 100:  # above upper band
                score += 18
            elif bb_pct_b > 80:
                score += 14
            elif bb_pct_b < 0:  # below lower band
                score += 20
            elif bb_pct_b < 20:
                score += 16
            else:
                score += 5  # in normal range
            weights_used += 0.15

        # MA50 deviation (0-15 points) — weight 0.15
        if ma50_dev is not None:
            dev = abs(ma50_dev)
            if dev > 15:
                score += 15
            elif dev > 10:
                score += 10
            elif dev > 5:
                score += 6
            else:
                score += 3
            weights_used += 0.15

        # MA200 deviation (0-15 points) — weight 0.15
        if ma200_dev is not None:
            dev = abs(ma200_dev)
            if dev > 25:
                score += 15
            elif dev > 15:
                score += 10
            elif dev > 8:
                score += 6
            else:
                score += 3
            weights_used += 0.15

        # ATR component (0-10 points) — weight 0.10
        if atr_pct is not None:
            if atr_pct > 4:
                score += 10
            elif atr_pct > 3:
                score += 7
            elif atr_pct > 2:
                score += 5
            else:
                score += 2
            weights_used += 0.10

        # Drawdown component (0-10 points) — weight 0.15
        if current_dd is not None:
            dd = abs(current_dd)
            if dd > 30:
                score += 10
            elif dd > 20:
                score += 8
            elif dd > 10:
                score += 5
            else:
                score += 2
            weights_used += 0.15

        # Normalize to 0-100
        if weights_used > 0:
            score = round(score / weights_used * (1 / 100) * 100)
            score = max(0, min(100, score))
        else:
            score = 50  # unknown

        return score

    def _classify_risk(self, score):
        """Classify risk level from score."""
        if score is None:
            return "UNKNOWN"
        if score >= 65:
            return "HIGH"
        elif score >= 35:
            return "MEDIUM"
        else:
            return "LOW"

    def _empty(self):
        return {
            "risk_level": "UNKNOWN",
            "risk_score": None,
            "volatility_ann": None,
            "volatility_percentile": None,
            "daily_return_pct": None,
            "ma50": None,
            "ma200": None,
            "ma50_deviation_pct": None,
            "ma200_deviation_pct": None,
            "bb_upper": None,
            "bb_lower": None,
            "bb_width_pct": None,
            "bb_pct_b": None,
            "atr_pct": None,
            "max_drawdown_pct": None,
            "current_drawdown_pct": None,
        }
