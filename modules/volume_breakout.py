"""
Volume Breakout Scanner — Detects stocks with unusual volume spikes.

Scans the screener universe using cached price histories (no API calls needed).
Identifies:
  - Volume spikes (current vs 20-day average)
  - Price-volume confirmation (bullish/bearish breakout)
  - Delivery volume context when available
"""
import math
import os
import pickle

import numpy as np
import pandas as pd

import config
from utils.logger import log


class VolumeBreakoutScanner:
    """Scan all stocks for volume breakouts using cached data."""

    # Minimum volume multiplier to qualify as breakout
    MIN_VOLUME_RATIO = 1.5    # 1.5x average
    HIGH_VOLUME_RATIO = 2.5   # 2.5x = strong breakout
    EXTREME_VOLUME_RATIO = 4.0  # 4x = extreme breakout

    def scan(self):
        """
        Scan all stocks for volume breakouts.
        Uses cached 1y price histories — fast, no API calls.
        Returns list of breakout dicts sorted by volume_ratio desc.
        """
        log.info("=" * 60)
        log.info("VOLUME BREAKOUT SCANNER")
        log.info("=" * 60)

        # Load screener universe for metadata
        composite_path = os.path.join(config.DATA_DIR, "composite_ranked.csv")
        if not os.path.exists(composite_path):
            log.error("composite_ranked.csv not found. Run the screener pipeline first.")
            return []

        universe = pd.read_csv(composite_path)
        sym_meta = {}
        for _, row in universe.iterrows():
            sym_meta[row["symbol"]] = {
                "name": row.get("name", ""),
                "sector": row.get("sector", ""),
                "industry": row.get("industry", ""),
                "market_cap": row.get("market_cap"),
                "composite_score": row.get("composite_score"),
                "fundamental_score": row.get("fundamental_score"),
                "technical_score": row.get("technical_score"),
                "composite_rank": row.get("composite_rank"),
            }

        # Collect all portfolio symbols
        all_portfolio_syms = set()
        for pf in config.PORTFOLIOS.values():
            for s in pf["stocks"]:
                all_portfolio_syms.add(s.strip().upper() + ".NS")

        log.info(f"Scanning {len(sym_meta)} stocks for volume breakouts...")

        breakouts = []
        scanned = 0
        errors = 0

        for sym, meta in sym_meta.items():
            cache_key = sym.replace(".", "_")
            hist_path = os.path.join(config.CACHE_DIR, cache_key, "history_1y.pkl")

            if not os.path.exists(hist_path):
                continue

            try:
                with open(hist_path, "rb") as f:
                    prices = pickle.load(f)

                result = self._analyze_volume(sym, prices, meta, all_portfolio_syms)
                if result:
                    breakouts.append(result)
                scanned += 1
            except Exception:
                errors += 1

        # Sort by volume ratio (strongest breakouts first)
        breakouts.sort(key=lambda x: x["volume_ratio"], reverse=True)

        log.info(f"Scanned: {scanned}, Errors: {errors}")
        log.info(f"Volume breakouts found: {len(breakouts)}")

        # Save to CSV
        if breakouts:
            df = pd.DataFrame(breakouts)
            out_path = os.path.join(config.DATA_DIR, "volume_breakouts.csv")
            df.to_csv(out_path, index=False)
            log.info(f"Saved to {out_path}")

        return breakouts

    def _analyze_volume(self, sym, prices, meta, portfolio_syms):
        """
        Analyze a single stock's volume pattern.
        Returns breakout dict if qualifies, else None.
        """
        if prices is None or prices.empty or len(prices) < 25:
            return None

        if "Volume" not in prices.columns:
            return None

        vol = prices["Volume"].astype(float)
        close = prices["Close"].astype(float)

        # Current (latest day) volume
        current_vol = vol.iloc[-1]
        if current_vol <= 0 or math.isnan(current_vol):
            return None

        # 20-day average volume (excluding today)
        avg_vol_20 = vol.iloc[-21:-1].mean()
        if avg_vol_20 <= 0 or math.isnan(avg_vol_20):
            return None

        # 5-day average (recent trend)
        avg_vol_5 = vol.iloc[-6:-1].mean()

        # Volume ratio
        vol_ratio = current_vol / avg_vol_20

        if vol_ratio < self.MIN_VOLUME_RATIO:
            return None

        # --- Price action analysis ---
        current_price = close.iloc[-1]
        prev_close = close.iloc[-2] if len(close) >= 2 else current_price
        price_change_pct = ((current_price - prev_close) / prev_close * 100) if prev_close > 0 else 0

        # 5-day and 20-day price change
        price_5d = close.iloc[-6] if len(close) >= 6 else close.iloc[0]
        price_change_5d_pct = ((current_price - price_5d) / price_5d * 100) if price_5d > 0 else 0

        price_20d = close.iloc[-21] if len(close) >= 21 else close.iloc[0]
        price_change_20d_pct = ((current_price - price_20d) / price_20d * 100) if price_20d > 0 else 0

        # 52-week high/low
        high_52w = close.max()
        low_52w = close.min()
        pct_from_high = ((current_price - high_52w) / high_52w * 100) if high_52w > 0 else 0

        # Volume trend (is volume increasing over recent days?)
        vol_trend_ratio = avg_vol_5 / avg_vol_20 if avg_vol_20 > 0 else 1

        # Breakout classification
        if vol_ratio >= self.EXTREME_VOLUME_RATIO:
            breakout_strength = "EXTREME"
        elif vol_ratio >= self.HIGH_VOLUME_RATIO:
            breakout_strength = "STRONG"
        else:
            breakout_strength = "MODERATE"

        # Direction
        if price_change_pct > 1.5:
            breakout_type = "BULLISH"
        elif price_change_pct < -1.5:
            breakout_type = "BEARISH"
        else:
            breakout_type = "NEUTRAL"

        # Pattern detection
        pattern = self._detect_pattern(close, vol, current_price, high_52w, low_52w)

        # Conviction score (0-100)
        conviction = self._compute_conviction(
            vol_ratio, price_change_pct, price_change_5d_pct,
            breakout_type, pct_from_high, meta
        )

        # Market cap in crores
        mcap = meta.get("market_cap")
        mcap_cr = round(mcap / 1e7, 1) if mcap and not (isinstance(mcap, float) and math.isnan(mcap)) else None

        return {
            "symbol": sym,
            "name": meta.get("name", sym.replace(".NS", "")),
            "sector": meta.get("sector", ""),
            "industry": meta.get("industry", ""),
            "cmp": round(current_price, 2),
            "market_cap_cr": mcap_cr,
            "volume_today": int(current_vol),
            "avg_volume_20d": int(avg_vol_20),
            "avg_volume_5d": int(avg_vol_5),
            "volume_ratio": round(vol_ratio, 2),
            "vol_trend_ratio": round(vol_trend_ratio, 2),
            "price_change_pct": round(price_change_pct, 2),
            "price_change_5d_pct": round(price_change_5d_pct, 2),
            "price_change_20d_pct": round(price_change_20d_pct, 2),
            "52w_high": round(high_52w, 2),
            "52w_low": round(low_52w, 2),
            "pct_from_52w_high": round(pct_from_high, 1),
            "breakout_strength": breakout_strength,
            "breakout_type": breakout_type,
            "pattern": pattern,
            "conviction": conviction,
            "composite_score": meta.get("composite_score"),
            "fundamental_score": meta.get("fundamental_score"),
            "composite_rank": meta.get("composite_rank"),
            "in_portfolio": sym in portfolio_syms,
        }

    def _detect_pattern(self, close, vol, cmp, high_52w, low_52w):
        """Detect common volume-price patterns."""
        if len(close) < 20:
            return "N/A"

        # Near 52-week high with high volume = potential breakout
        if high_52w > 0 and (cmp / high_52w) > 0.95:
            return "52W HIGH BREAKOUT"

        # Near 52-week low with high volume = potential reversal
        if low_52w > 0 and low_52w > 0 and (cmp / low_52w) < 1.10:
            return "REVERSAL FROM LOW"

        # Price consolidation then volume spike
        recent_range = (close.iloc[-10:].max() - close.iloc[-10:].min()) / close.iloc[-10:].mean() * 100
        if recent_range < 5:
            return "RANGE BREAKOUT"

        # Accumulation: price up slowly, volume rising
        price_trend = (close.iloc[-1] - close.iloc[-10]) / close.iloc[-10] * 100 if close.iloc[-10] > 0 else 0
        vol_trend = (vol.iloc[-5:].mean() - vol.iloc[-15:-5].mean()) / vol.iloc[-15:-5].mean() * 100 if vol.iloc[-15:-5].mean() > 0 else 0

        if price_trend > 3 and vol_trend > 30:
            return "ACCUMULATION"
        if price_trend < -3 and vol_trend > 30:
            return "DISTRIBUTION"

        return "VOLUME SPIKE"

    def _compute_conviction(self, vol_ratio, price_chg, price_chg_5d,
                            breakout_type, pct_from_high, meta):
        """
        Conviction score 0-100 for the breakout.
        Higher = more likely to be a meaningful move.
        """
        score = 0

        # Volume ratio contribution (0-30)
        if vol_ratio >= 5:
            score += 30
        elif vol_ratio >= 3:
            score += 24
        elif vol_ratio >= 2:
            score += 18
        elif vol_ratio >= 1.5:
            score += 10

        # Price-volume confirmation (0-25)
        # Bullish breakout with volume = strong confirmation
        if breakout_type == "BULLISH":
            if price_chg > 5:
                score += 25
            elif price_chg > 3:
                score += 20
            elif price_chg > 1.5:
                score += 14
        elif breakout_type == "BEARISH":
            # Bearish with volume = distribution, still notable
            if abs(price_chg) > 5:
                score += 20
            elif abs(price_chg) > 3:
                score += 15
            elif abs(price_chg) > 1.5:
                score += 10
        else:
            score += 5

        # 5-day momentum confirmation (0-15)
        if breakout_type == "BULLISH" and price_chg_5d > 5:
            score += 15
        elif breakout_type == "BULLISH" and price_chg_5d > 0:
            score += 10
        elif breakout_type == "BEARISH" and price_chg_5d < -5:
            score += 12
        else:
            score += 5

        # Proximity to 52W high (0-15)
        if pct_from_high is not None:
            if abs(pct_from_high) < 3:
                score += 15  # Near all-time high = strong
            elif abs(pct_from_high) < 10:
                score += 10
            elif abs(pct_from_high) < 20:
                score += 5

        # Fundamental quality bonus (0-15)
        fs = meta.get("fundamental_score")
        if fs and not (isinstance(fs, float) and math.isnan(fs)):
            if fs >= 60:
                score += 15
            elif fs >= 45:
                score += 10
            elif fs >= 30:
                score += 5

        return min(100, score)
