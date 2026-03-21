"""
Step 4: Technical Scoring
Score stocks on trend, momentum, volume, and relative strength.
Uses the 'ta' library for indicator computation.
"""
import os

import numpy as np
import pandas as pd
import ta

import config
from modules.data_fetcher import DataFetcher
from utils.helpers import score_by_thresholds, category_score, weighted_score
from utils.logger import log


class TechnicalScorer:
    def __init__(self, data_fetcher: DataFetcher):
        self.fetcher = data_fetcher
        self._nifty_data = None

    def score(self, stocks_df):
        """
        Score all stocks on technical parameters.
        Returns DataFrame with technical scores.
        """
        log.info("=" * 60)
        log.info("STEP 4: TECHNICAL SCORING")
        log.info("=" * 60)

        symbols = stocks_df["symbol"].tolist()

        # Fetch NIFTY 50 benchmark for relative strength
        self._load_nifty_benchmark()

        # Fetch price histories
        log.info("Fetching price histories for technical analysis...")
        all_prices = self.fetcher.batch_download_prices(symbols)

        results = []
        scored = 0
        for _, row in stocks_df.iterrows():
            sym = row["symbol"]
            prices = all_prices.get(sym)

            if prices is None or prices.empty or len(prices) < 50:
                results.append({
                    **row.to_dict(),
                    "technical_score": 0,
                    "tech_data_coverage": 0,
                    "tech_trend": None,
                    "tech_momentum": None,
                    "tech_volume": None,
                    "tech_relative_strength": None,
                })
                continue

            scores = self._score_stock(prices)
            results.append({**row.to_dict(), **scores})
            scored += 1

        result_df = pd.DataFrame(results)
        result_df = result_df.sort_values("technical_score", ascending=False)
        result_df = result_df.reset_index(drop=True)

        log.info(f"Technical scoring complete: {scored}/{len(symbols)} stocks scored")
        valid = result_df[result_df["technical_score"] > 0]
        if not valid.empty:
            log.info(f"Score range: {valid['technical_score'].min():.1f} - {valid['technical_score'].max():.1f}")

        out_path = os.path.join(config.DATA_DIR, "technical_scores.csv")
        result_df.to_csv(out_path, index=False)
        log.info(f"Saved to {out_path}")

        return result_df

    def _load_nifty_benchmark(self):
        """Load NIFTY 50 price data for relative strength calculation."""
        log.info("Loading NIFTY 50 benchmark data...")
        self._nifty_data = self.fetcher.get_price_history(config.NIFTY50_TICKER)
        if self._nifty_data is None or self._nifty_data.empty:
            log.warning("Could not load NIFTY 50 data — relative strength will be skipped")

    def _score_stock(self, prices):
        """Score a single stock on all technical categories."""
        close = prices["Close"].astype(float)
        high = prices["High"].astype(float) if "High" in prices else close
        low = prices["Low"].astype(float) if "Low" in prices else close
        volume = prices["Volume"].astype(float) if "Volume" in prices else None

        self._last_tt_conditions = None  # reset before scoring

        # Category A: Trend
        trend = self._score_trend(close, high, low)

        # Category B: Momentum
        momentum = self._score_momentum(close)

        # Category C: Volume
        vol_scores = self._score_volume(close, high, low, volume) if volume is not None else {}

        # Category D: Relative Strength
        rs = self._score_relative_strength(close)

        # Aggregate
        cat_scores = {}
        coverages = {}
        for name, sub in [("trend", trend), ("momentum", momentum),
                          ("volume", vol_scores), ("relative_strength", rs)]:
            sc, cov = category_score(sub, scale_to_100=True)
            cat_scores[name] = sc
            coverages[name] = cov

        tech_score, data_coverage = weighted_score(cat_scores, config.TECHNICAL_WEIGHTS)

        return {
            "tech_trend": cat_scores.get("trend"),
            "tech_momentum": cat_scores.get("momentum"),
            "tech_volume": cat_scores.get("volume"),
            "tech_relative_strength": cat_scores.get("relative_strength"),
            "technical_score": tech_score,
            "tech_data_coverage": data_coverage,
            # Exposed for UI badges
            "tech_trend_template": self._last_tt_conditions,  # 0–8 conditions met
            "tech_vcp": trend.get("vcp"),                     # 0–10 VCP score
        }

    # ----------------------------------------------------------
    # Category A: Trend (35%)
    # ----------------------------------------------------------
    def _score_trend(self, close, high, low):
        scores = {}

        # Minervini Trend Template (8 conditions) — highest-weight trend factor
        scores["trend_template"] = self._score_trend_template(close)

        # VCP (Volatility Contraction Pattern) — signals base completion
        scores["vcp"] = self._detect_vcp(close)

        try:
            # EMAs
            ema20 = ta.trend.EMAIndicator(close, window=config.EMA_SHORT).ema_indicator()
            ema50 = ta.trend.EMAIndicator(close, window=config.EMA_MEDIUM).ema_indicator()

            ema200 = None
            if len(close) >= config.EMA_LONG:
                ema200 = ta.trend.EMAIndicator(close, window=config.EMA_LONG).ema_indicator()

            # EMA Alignment scoring
            last_close = close.iloc[-1]
            last_ema20 = ema20.iloc[-1]
            last_ema50 = ema50.iloc[-1]

            if ema200 is not None:
                last_ema200 = ema200.iloc[-1]
                if last_close > last_ema20 > last_ema50 > last_ema200:
                    scores["ema_alignment"] = 10
                elif last_close > last_ema20 > last_ema50:
                    scores["ema_alignment"] = 7
                elif last_close > last_ema50:
                    scores["ema_alignment"] = 5
                elif last_close > last_ema200:
                    scores["ema_alignment"] = 3
                else:
                    scores["ema_alignment"] = 1
            else:
                if last_close > last_ema20 > last_ema50:
                    scores["ema_alignment"] = 8
                elif last_close > last_ema50:
                    scores["ema_alignment"] = 5
                else:
                    scores["ema_alignment"] = 2
        except Exception:
            scores["ema_alignment"] = None

        try:
            # ADX (trend strength)
            adx_ind = ta.trend.ADXIndicator(high, low, close, window=14)
            adx = adx_ind.adx().iloc[-1]
            di_pos = adx_ind.adx_pos().iloc[-1]
            di_neg = adx_ind.adx_neg().iloc[-1]

            adx_score = score_by_thresholds(adx, config.ADX_THRESHOLDS)
            # If bearish direction, cap the score
            if di_neg > di_pos and adx_score is not None:
                adx_score = min(adx_score, 3)
            scores["adx"] = adx_score
        except Exception:
            scores["adx"] = None

        try:
            # MACD
            macd_ind = ta.trend.MACD(close)
            macd_line = macd_ind.macd().iloc[-1]
            signal_line = macd_ind.macd_signal().iloc[-1]
            histogram = macd_ind.macd_diff().iloc[-1]

            if macd_line > signal_line and macd_line > 0:
                scores["macd"] = 10
            elif macd_line > signal_line and macd_line < 0:
                scores["macd"] = 6
            elif macd_line < signal_line and macd_line > 0:
                scores["macd"] = 4
            else:
                scores["macd"] = 2

            # Bonus for expanding histogram
            if histogram > 0:
                prev_hist = macd_ind.macd_diff().iloc[-2] if len(close) > 1 else 0
                if histogram > prev_hist:
                    scores["macd"] = min(scores["macd"] + 2, 10)
        except Exception:
            scores["macd"] = None

        try:
            # Price vs 200-DMA
            if ema200 is not None:
                last_ema200 = ema200.iloc[-1]
                if last_ema200 > 0:
                    pct_above = ((close.iloc[-1] / last_ema200) - 1) * 100
                    if pct_above > 20:
                        scores["price_vs_200dma"] = 8
                    elif pct_above > 5:
                        scores["price_vs_200dma"] = 9
                    elif pct_above > 0:
                        scores["price_vs_200dma"] = 7
                    elif pct_above > -10:
                        scores["price_vs_200dma"] = 4
                    else:
                        scores["price_vs_200dma"] = 2
        except Exception:
            scores["price_vs_200dma"] = None

        return scores

    def _score_trend_template(self, close):
        """
        Minervini's 8-condition Trend Template.
        Each condition met adds 1 point (max 8), scaled to 0–10.
        Stocks meeting 6+ are in the Stage 2 buy zone.
        Also saves raw conditions count to self._last_tt_conditions for output.
        """
        try:
            if len(close) < 200:
                self._last_tt_conditions = None
                return None

            c = close.iloc[-1]
            ma50  = close.rolling(50).mean().iloc[-1]
            ma150 = close.rolling(150).mean().iloc[-1]
            ma200 = close.rolling(200).mean().iloc[-1]
            ma200_20ago = close.rolling(200).mean().iloc[-21] if len(close) >= 221 else None

            lookback = min(252, len(close))
            high52 = close.iloc[-lookback:].max()
            low52  = close.iloc[-lookback:].min()

            met = 0
            # 1. Price above both 150MA and 200MA
            if c > ma150 and c > ma200:
                met += 1
            # 2. 150MA above 200MA
            if ma150 > ma200:
                met += 1
            # 3. 200MA trending up (higher than ~4 weeks ago)
            if ma200_20ago is not None and ma200 > ma200_20ago:
                met += 1
            # 4. 50MA above 150MA and 200MA
            if ma50 > ma150 and ma50 > ma200:
                met += 1
            # 5. Price above 50MA
            if c > ma50:
                met += 1
            # 6. Price ≥25% above 52-week low (not a beaten-down stock)
            if low52 > 0 and c >= low52 * 1.25:
                met += 1
            # 7. Price within 25% of 52-week high (near highs, momentum intact)
            if high52 > 0 and c >= high52 * 0.75:
                met += 1
            # 8. Relative strength vs Nifty — stock outperforming in last 3 months
            if self._nifty_data is not None and len(self._nifty_data) >= 63 and len(close) >= 63:
                nifty_close = self._nifty_data["Close"].astype(float)
                stock_ret = (close.iloc[-1] / close.iloc[-63] - 1)
                nifty_ret = (nifty_close.iloc[-1] / nifty_close.iloc[-63] - 1)
                if stock_ret > nifty_ret:
                    met += 1

            self._last_tt_conditions = met  # expose raw count for output
            # Scale: 0→1, 1→2, 2→3, 3→4, 4→6, 5→7, 6→8, 7→9, 8→10
            score_map = {0: 1, 1: 2, 2: 3, 3: 4, 4: 6, 5: 7, 6: 8, 7: 9, 8: 10}
            return score_map.get(met, 1)
        except Exception:
            self._last_tt_conditions = None
            return None

    def _detect_vcp(self, close, volume=None):
        """
        Detect Volatility Contraction Pattern (Minervini).
        Looks for progressively tighter price swings — indicates supply exhaustion.
        Returns 0–10 score.
        """
        try:
            if len(close) < 50:
                return None

            # Analyse last 4 two-week windows (8 weeks total)
            window = 10
            n = 4
            amplitudes = []

            for i in range(n):
                start = -(n - i) * window
                end   = -(n - i - 1) * window if i < n - 1 else len(close)
                seg = close.iloc[start:end]
                if len(seg) < 3:
                    continue
                seg_low = seg.min()
                amp = (seg.max() - seg_low) / seg_low * 100 if seg_low > 0 else 0
                amplitudes.append(amp)

            if len(amplitudes) < 3:
                return None

            # Contracting = each period narrower than previous
            contracting = all(amplitudes[i] > amplitudes[i + 1] for i in range(len(amplitudes) - 1))
            partial     = sum(1 for i in range(len(amplitudes) - 1) if amplitudes[i] > amplitudes[i + 1]) >= 2
            tight_base  = amplitudes[-1] < 10  # Latest swing < 10%

            if contracting and tight_base:
                return 10
            elif contracting:
                return 7
            elif partial and tight_base:
                return 6
            elif tight_base:
                return 4
            else:
                return 2
        except Exception:
            return None

    # ----------------------------------------------------------
    # Category B: Momentum (30%) — Enhanced with AI-Stock-Trader logic
    # ----------------------------------------------------------
    def _score_momentum(self, close):
        scores = {}
        cfg = config.SIGNAL_STRATEGY

        try:
            # RSI(14)
            rsi_series = ta.momentum.RSIIndicator(close, window=cfg["rsi_period"]).rsi()
            rsi = rsi_series.iloc[-1]
            scores["rsi"] = score_by_thresholds(rsi, config.RSI_THRESHOLDS)
        except Exception:
            scores["rsi"] = None
            rsi_series = None

        try:
            # Stochastic RSI (from AI-Stock-Trader: smoothK=3, smoothD=3)
            stoch_rsi = ta.momentum.StochRSIIndicator(
                close, window=cfg["stochrsi_period"],
                smooth1=cfg["stochrsi_smooth_k"],
                smooth2=cfg["stochrsi_smooth_d"],
            )
            k = stoch_rsi.stochrsi_k().iloc[-1] * 100
            d = stoch_rsi.stochrsi_d().iloc[-1] * 100
            k_prev = stoch_rsi.stochrsi_k().iloc[-2] * 100

            if k < cfg["stochrsi_oversold"] and k > d:
                scores["stoch_rsi"] = 9  # Oversold buy signal
            elif k < cfg["stochrsi_oversold"]:
                scores["stoch_rsi"] = 7  # Oversold
            elif cfg["stochrsi_oversold"] <= k <= cfg["stochrsi_overbought"]:
                if k > k_prev:
                    scores["stoch_rsi"] = 7  # Rising in neutral zone
                else:
                    scores["stoch_rsi"] = 5  # Falling in neutral zone
            elif k > cfg["stochrsi_overbought"]:
                scores["stoch_rsi"] = 3  # Overbought
            else:
                scores["stoch_rsi"] = 5
        except Exception:
            scores["stoch_rsi"] = None

        try:
            # Combined momentum confirmation (AI-Stock-Trader strategy)
            # Bonus score when RSI and StochRSI are both rising below overbought
            if rsi_series is not None and len(rsi_series.dropna()) >= 2:
                rsi_curr = rsi_series.iloc[-1]
                rsi_prev = rsi_series.iloc[-2]
                rsi_increasing = rsi_curr > rsi_prev
                stoch_k_increasing = k > k_prev if 'k' in dir() and 'k_prev' in dir() else False

                if (rsi_increasing and stoch_k_increasing and
                        rsi_curr < cfg["rsi_overbought"] and k < cfg["stochrsi_overbought"]):
                    scores["combined_momentum"] = 9  # Strong bullish confirmation
                elif rsi_increasing and rsi_curr < cfg["rsi_overbought"]:
                    scores["combined_momentum"] = 7
                elif not rsi_increasing and rsi_curr > cfg["rsi_oversold"]:
                    scores["combined_momentum"] = 4  # Weakening
                else:
                    scores["combined_momentum"] = 2  # Bearish
        except Exception:
            scores["combined_momentum"] = None

        try:
            # Rate of Change (20-day)
            roc = ta.momentum.ROCIndicator(close, window=20).roc().iloc[-1]
            scores["roc"] = score_by_thresholds(roc, config.ROC_THRESHOLDS)
        except Exception:
            scores["roc"] = None

        return scores

    # ----------------------------------------------------------
    # Category C: Volume (20%)
    # ----------------------------------------------------------
    def _score_volume(self, close, high, low, volume):
        scores = {}

        try:
            # OBV trend
            obv = ta.volume.OnBalanceVolumeIndicator(close, volume).on_balance_volume()
            obv_sma = obv.rolling(window=20).mean()

            obv_rising = obv.iloc[-1] > obv_sma.iloc[-1]
            price_rising = close.iloc[-1] > close.iloc[-20] if len(close) >= 20 else True

            if obv_rising and price_rising:
                scores["obv_trend"] = 10
            elif obv_rising and not price_rising:
                scores["obv_trend"] = 8  # Accumulation
            elif not obv_rising and price_rising:
                scores["obv_trend"] = 3  # Distribution
            else:
                scores["obv_trend"] = 1
        except Exception:
            scores["obv_trend"] = None

        try:
            # Volume vs 20-day average
            vol_sma20 = volume.rolling(window=20).mean().iloc[-1]
            current_vol = volume.iloc[-1]

            if vol_sma20 > 0:
                vol_ratio = current_vol / vol_sma20
                price_up = close.iloc[-1] > close.iloc[-2] if len(close) >= 2 else True

                if vol_ratio > 2 and price_up:
                    scores["volume_vs_avg"] = 10
                elif vol_ratio > 1.5:
                    scores["volume_vs_avg"] = 7
                elif vol_ratio > 1:
                    scores["volume_vs_avg"] = 5
                elif vol_ratio > 0.5:
                    scores["volume_vs_avg"] = 3
                else:
                    scores["volume_vs_avg"] = 1
        except Exception:
            scores["volume_vs_avg"] = None

        try:
            # VWAP position (intraday proxy using daily data)
            vwap = ta.volume.VolumeWeightedAveragePrice(
                high, low, close, volume, window=14
            ).volume_weighted_average_price()
            if close.iloc[-1] > vwap.iloc[-1]:
                scores["vwap_position"] = 7
            else:
                scores["vwap_position"] = 3
        except Exception:
            scores["vwap_position"] = None

        return scores

    # ----------------------------------------------------------
    # Category D: Relative Strength (15%)
    # ----------------------------------------------------------
    def _score_relative_strength(self, close):
        scores = {}

        if self._nifty_data is None or self._nifty_data.empty:
            return scores

        try:
            nifty_close = self._nifty_data["Close"].astype(float)

            # 3-month relative strength
            if len(close) >= 63 and len(nifty_close) >= 63:
                stock_ret_3m = (close.iloc[-1] / close.iloc[-63] - 1) * 100
                nifty_ret_3m = (nifty_close.iloc[-1] / nifty_close.iloc[-63] - 1) * 100

                if nifty_ret_3m != 0:
                    rs_3m = stock_ret_3m / nifty_ret_3m if nifty_ret_3m > 0 else 2.0
                    scores["rs_3month"] = score_by_thresholds(rs_3m, config.RS_THRESHOLDS)

            # 1-month relative strength
            if len(close) >= 21 and len(nifty_close) >= 21:
                stock_ret_1m = (close.iloc[-1] / close.iloc[-21] - 1) * 100
                nifty_ret_1m = (nifty_close.iloc[-1] / nifty_close.iloc[-21] - 1) * 100

                if nifty_ret_1m != 0:
                    rs_1m = stock_ret_1m / nifty_ret_1m if nifty_ret_1m > 0 else 2.0
                    scores["rs_1month"] = score_by_thresholds(rs_1m, config.RS_THRESHOLDS)

            # RS Line at new high (leading indicator — Brad Koteshwar / Minervini)
            # When the RS line itself makes a new 52-week high it often leads the price
            scores["rs_line_high"] = self._rs_line_new_high(close, nifty_close)

        except Exception:
            pass

        return scores

    def _rs_line_new_high(self, close, nifty_close):
        """
        Score based on where the RS line sits relative to its own 52-week range.
        RS at new high = 10 (stock outperforming before breakout — leading indicator).
        """
        try:
            min_len = min(len(close), len(nifty_close))
            if min_len < 63:
                return None

            rs_line = (close.iloc[-min_len:].values /
                       nifty_close.iloc[-min_len:].values)

            current_rs   = rs_line[-1]
            lookback     = min(252, len(rs_line))
            rs_52w_high  = rs_line[-lookback:].max()
            rs_52w_low   = rs_line[-lookback:].min()
            rs_range     = rs_52w_high - rs_52w_low

            if rs_range <= 0:
                return 5

            rs_pctile = (current_rs - rs_52w_low) / rs_range  # 0–1

            if rs_pctile >= 0.90:
                return 10   # RS line at/near new high — very bullish
            elif rs_pctile >= 0.75:
                return 8
            elif rs_pctile >= 0.50:
                return 6
            elif rs_pctile >= 0.25:
                return 4
            else:
                return 2
        except Exception:
            return None

    @staticmethod
    def load_saved():
        path = os.path.join(config.DATA_DIR, "technical_scores.csv")
        if os.path.exists(path):
            return pd.read_csv(path)
        return None
