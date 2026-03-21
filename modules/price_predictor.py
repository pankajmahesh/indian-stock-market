"""
Price Predictor v3 — ML Ensemble Price Forecasting.

Based on: Sonkavde et al. (2023) "Forecasting Stock Market Prices Using
Machine Learning and Deep Learning Models" (IJFS, Vol. 11, No. 94).

Architecture:
  Stage 1: Stacked ML Ensemble (Random Forest + Gradient Boosting + MLP)
           - 15 engineered features (lagged returns, RSI, MACD, ADX, BB, EMAs, vol)
           - Target: Forward return % (7d / 30d / 90d)
           - Ensemble: Inverse-MAE weighted predictions on validation set
  Stage 2: Technical Analysis (multi-signal ensemble from v2)
           - Dampened regression, EMA tracking, mean reversion, momentum
  Final:   Blended prediction = ML × weight + Technical × (1 − weight)

Paper results: RF+XGBoost+LSTM ensemble achieved R²=0.9921, RMSE=2.02
(best among all individual and ensemble models tested).
"""
import math
import os
import pickle
import threading
import warnings
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

# ML imports — graceful fallback to technical-only if unavailable
try:
    from sklearn.ensemble import (
        HistGradientBoostingClassifier,
        HistGradientBoostingRegressor,
        RandomForestClassifier,
        RandomForestRegressor,
    )
    from sklearn.linear_model import LinearRegression
    from sklearn.neural_network import MLPRegressor
    from sklearn.preprocessing import StandardScaler

    ML_AVAILABLE = True
except ImportError:
    ML_AVAILABLE = False

# LightGBM — preferred over HistGBM when available (faster, more accurate)
try:
    import lightgbm as lgb
    LGBM_AVAILABLE = True
except Exception:
    LGBM_AVAILABLE = False

# XGBoost — additional ensemble member when available
try:
    import xgboost as xgb
    XGBM_AVAILABLE = True
except Exception:
    XGBM_AVAILABLE = False

from sklearn.calibration import CalibratedClassifierCV

# jugaad-data for NSE delivery volume (Gap G)
try:
    from jugaad_data.nse import NSELive as _NSELive
    JUGAAD_AVAILABLE = True
except Exception:
    JUGAAD_AVAILABLE = False

import config
from utils.logger import log


class PricePredictor:
    """
    ML Ensemble price prediction engine.

    Stacked ensemble: Random Forest + Gradient Boosting + MLP Neural Network,
    combined with technical analysis for multi-horizon price targets.
    """

    HORIZONS = [7, 30, 90]
    MIN_ML_SAMPLES = 50  # minimum training rows for ML

    # Cross-stock model cache (shared across all instances)
    _cross_stock_models = {}    # {horizon: {models, scaler, weights, feature_cols}}
    _cross_stock_lock = threading.Lock()
    _nifty_cache = {}           # {close: pd.Series, fetched_at: datetime}
    _earnings_cache = {}        # {symbol: {days_to_earnings, next_date, fetched_at}}
    _delivery_cache = {}        # {symbol: {delivery_pct, fetched_at}}
    _sector_models = {}         # {sector: {horizon: bundle}} — Gap B
    _sector_lock = threading.Lock()
    _sector_map = {}            # {stock_dir_key: sector_name} — loaded from composite_ranked.csv
    _sector_map_lock = threading.Lock()

    # --- ML Model Configurations ---
    RF_PARAMS = dict(
        n_estimators=200, max_depth=8, max_features="sqrt",
        random_state=42, n_jobs=-1, min_samples_leaf=5,
    )
    # HistGradientBoostingRegressor: sklearn's LightGBM-equivalent (fallback)
    HGB_PARAMS = dict(
        max_iter=300, learning_rate=0.05, max_depth=6,
        min_samples_leaf=20, l2_regularization=0.1,
        random_state=42,
    )
    # LightGBM — preferred primary booster when available
    LGBM_PARAMS = dict(
        n_estimators=500, learning_rate=0.03, num_leaves=63,
        max_depth=7, min_child_samples=30, reg_lambda=0.1,
        n_jobs=-1, random_state=42, verbose=-1,
    )
    # XGBoost — additional ensemble member when available
    XGBM_PARAMS = dict(
        n_estimators=400, learning_rate=0.03, max_depth=6,
        min_child_weight=5, reg_lambda=0.1, subsample=0.8,
        colsample_bytree=0.8, n_jobs=-1, random_state=42,
        verbosity=0,
    )
    LGBM_CLF_PARAMS = dict(
        n_estimators=300, learning_rate=0.03, num_leaves=63,
        max_depth=6, min_child_samples=30, n_jobs=-1,
        random_state=42, verbose=-1, class_weight="balanced",
    )
    MLP_PARAMS = dict(
        hidden_layer_sizes=(128, 64, 32), activation="relu", solver="adam",
        alpha=0.001, max_iter=400, early_stopping=True,
        validation_fraction=0.15, random_state=42,
    )
    LR_PARAMS = {}  # OLS baseline

    # Direction classifier params (Gap 3)
    RFC_PARAMS = dict(
        n_estimators=200, max_depth=8, max_features="sqrt",
        random_state=42, n_jobs=-1, min_samples_leaf=5,
        class_weight="balanced",
    )
    HGB_CLF_PARAMS = dict(
        max_iter=300, learning_rate=0.05, max_depth=6,
        min_samples_leaf=20, l2_regularization=0.1,
        random_state=42, class_weight="balanced",
    )
    # Classification threshold: label as UP if return > threshold, DOWN if < -threshold
    DIRECTION_THRESHOLD = {7: 1.5, 30: 3.0, 90: 6.0}  # %

    # How much to trust ML vs technical (per horizon)
    ML_BLEND = {7: 0.55, 30: 0.65, 90: 0.55}

    # --- Technical constants (from v2) ---
    DAMPENING = {7: 0.85, 30: 0.55, 90: 0.25}
    REVERSION_BASE = {7: 0.08, 30: 0.25, 90: 0.50}
    TECH_WEIGHTS = {
        7:  (0.40, 0.25, 0.10, 0.25),
        30: (0.35, 0.25, 0.20, 0.20),
        90: (0.20, 0.20, 0.45, 0.15),
    }

    # =====================================================================
    # PUBLIC API
    # =====================================================================

    def predict_stock(self, symbol, prices=None):
        """Generate price prediction using ML ensemble + technical analysis."""
        if prices is None:
            cache_key = symbol.replace(".", "_")
            cache_dir = os.path.join(config.CACHE_DIR, cache_key)
            # Prefer 3y history for richer ML training; fall back to 1y
            for period_key in ("history_3y.pkl", "history_1y.pkl"):
                hist_path = os.path.join(cache_dir, period_key)
                if os.path.exists(hist_path):
                    with open(hist_path, "rb") as f:
                        prices = pickle.load(f)
                    break
            if prices is None:
                return None

        if prices is None or prices.empty or len(prices) < 30:
            return None

        # Gap D: fetch earnings info and Gap G: delivery volume upfront (non-blocking)
        earnings_info  = self.get_earnings_info(symbol)
        days_to_earn   = earnings_info.get("days_to_earnings") if earnings_info else None
        next_earn_date = earnings_info.get("next_earnings_date") if earnings_info else None
        delivery_pct   = self.get_delivery_pct(symbol)

        try:
            close = prices["Close"].astype(float).dropna()
            high = prices["High"].astype(float).dropna() if "High" in prices.columns else close
            low = prices["Low"].astype(float).dropna() if "Low" in prices.columns else close
            volume = (
                prices["Volume"].astype(float)
                if "Volume" in prices.columns
                else pd.Series(np.ones(len(close)), index=close.index)
            )

            if len(close) < 30:
                return None

            cmp = float(close.iloc[-1])

            # === Technical Indicators (same as v2) ===
            ema_20 = float(close.ewm(span=20).mean().iloc[-1])
            ema_50 = float(close.ewm(span=50).mean().iloc[-1])
            ema_200 = float(close.ewm(span=200).mean().iloc[-1]) if len(close) >= 200 else None
            ema_trend = "BULLISH" if ema_20 > ema_50 else "BEARISH"

            ema_20_series = close.ewm(span=20).mean()
            ema_momentum = (
                (ema_20_series.iloc[-1] - ema_20_series.iloc[-5])
                / ema_20_series.iloc[-5] * 100
            ) if len(ema_20_series) >= 5 else 0.0
            ema_momentum = float(ema_momentum)

            lr_short = self._linear_regression(close, lookback=30)
            lr_medium = self._linear_regression(close, lookback=60)
            lr_long = self._linear_regression(close, lookback=min(120, len(close)))
            r_squared = lr_medium["r_squared"]
            slope_pct = lr_medium["slope_pct"]

            macd_hist, macd_trend = self._compute_macd(close)
            adx = self._compute_adx(high, low, close)
            rsi = self._compute_rsi(close)
            bb_upper, bb_lower, bb_mid = self._bollinger_bands(close)
            bb_width_pct = ((bb_upper - bb_lower) / bb_mid * 100) if bb_mid > 0 else 0
            support, resistance = self._support_resistance(close)
            daily_vol = self._compute_volatility(close)
            ann_vol = daily_vol * math.sqrt(252) * 100
            vwap = self._compute_vwap(high, low, close, volume)
            st_value, st_signal = self._compute_supertrend(high, low, close)

            # === ML Ensemble Predictions ===
            ml_predictions = {}
            ml_accuracy = {}
            ml_used = False

            if ML_AVAILABLE and len(close) >= 100:
                nifty_close = self.get_nifty_data()
                features_df = self._build_ml_features(close, high, low, volume, nifty_close)
                # Try cross-stock pretrained models first (more data = higher accuracy)
                cross_models = self._load_cross_stock_models()
                # Gap B: prefer sector-specific model when available (captures sector patterns)
                sector_models = self._load_sector_models()
                stock_sector  = self._get_stock_sector(symbol)
                for horizon in self.HORIZONS:
                    sector_bundle = sector_models.get(stock_sector, {}).get(horizon) if stock_sector else None
                    ml_result = self._ml_ensemble_predict(
                        features_df, close, horizon,
                        cross_stock_bundle=sector_bundle or cross_models.get(horizon),
                    )
                    if ml_result is not None:
                        ml_predictions[horizon] = ml_result["prediction"]
                        ml_accuracy[horizon] = {
                            "mae": ml_result["val_mae"],
                            "direction_accuracy": ml_result["val_dir_acc"],
                            "within_5pct": ml_result["val_within_5pct"],
                            "samples": ml_result["val_n"],
                            "cross_stock": ml_result.get("cross_stock", False),
                            "sector_model": sector_bundle is not None,
                            "sector": stock_sector if sector_bundle is not None else None,
                            "dir_prob_up": ml_result.get("dir_prob_up"),
                        }
                        ml_used = True

            # === Generate Targets (Blend ML + Technical) ===
            ema_anchors = {7: ema_20, 30: ema_50, 90: ema_200 or ema_50}
            targets = {}

            for days in self.HORIZONS:
                # Technical prediction (v2 logic)
                tech_target, _, _ = self._generate_technical_target(
                    cmp=cmp, days=days,
                    lr_short=lr_short, lr_medium=lr_medium, lr_long=lr_long,
                    ema_anchor=ema_anchors[days], ema_momentum=ema_momentum,
                    macd_hist=macd_hist, rsi=rsi, adx=adx,
                    daily_vol=daily_vol, support=support, resistance=resistance,
                )

                # Blend ML + Technical
                if days in ml_predictions:
                    ml_target = cmp * (1 + ml_predictions[days] / 100)
                    w_ml = self.ML_BLEND[days]
                    final_target = ml_target * w_ml + tech_target * (1 - w_ml)
                else:
                    final_target = tech_target

                # Volatility cone: cap within 2-sigma, compute 1-sigma bands
                if daily_vol > 0.001:
                    sigma = daily_vol * math.sqrt(days)
                    vol_upper = cmp * math.exp(2 * sigma)
                    vol_lower = cmp * math.exp(-2 * sigma)
                    final_target = max(vol_lower, min(vol_upper, final_target))
                    low_bound = cmp * math.exp(-sigma)
                    high_bound = cmp * math.exp(sigma)
                else:
                    low_bound = final_target * 0.95
                    high_bound = final_target * 1.05

                final_target = max(final_target, cmp * 0.5)
                low_bound = max(low_bound, cmp * 0.5)
                targets[days] = (final_target, low_bound, high_bound)

            target_7d, t7_low, t7_high = targets[7]
            target_30d, t30_low, t30_high = targets[30]
            target_90d, t90_low, t90_high = targets[90]

            # 1-day target (regime-aware momentum model)
            above_vwap = vwap is not None and cmp > vwap
            target_1d, t1d_low, t1d_high = self._generate_1day_target(
                cmp=cmp, rsi=rsi, macd_hist=macd_hist, adx=adx,
                daily_vol=daily_vol, supertrend_signal=st_signal or "SELL",
                above_vwap=above_vwap, support=support, resistance=resistance,
                ema_trend=ema_trend,
            )
            upside_1d = round((target_1d - cmp) / cmp * 100, 1)

            # === Scoring ===
            confidence = self._compute_confidence(
                r_squared=r_squared, ema_trend=ema_trend,
                rsi=rsi, bb_width_pct=bb_width_pct,
                slope_pct=slope_pct, adx=adx,
                macd_trend=macd_trend, ann_vol=ann_vol,
                support=support, resistance=resistance, cmp=cmp,
            )
            direction_score = self._compute_direction_score(
                rsi=rsi, ema_trend=ema_trend, slope_pct=slope_pct,
                macd_trend=macd_trend, adx=adx,
                supertrend_signal=st_signal or "SELL",
                above_vwap=vwap is not None and cmp > vwap,
                support=support, resistance=resistance, cmp=cmp,
            )
            trend_strength = self._trend_strength(close, adx)

            # Gap D: Earnings proximity penalty
            earnings_warning = False
            if days_to_earn is not None:
                if days_to_earn <= 3:
                    confidence = max(0, confidence - 35)  # very close: prediction unreliable
                    earnings_warning = True
                elif days_to_earn <= 7:
                    confidence = max(0, confidence - 20)
                    earnings_warning = True
                elif days_to_earn <= 14:
                    confidence = max(0, confidence - 10)
                    earnings_warning = True

            # Gap G: Delivery volume adjustment
            # High delivery % = institutional conviction; boost/suppress direction score
            delivery_signal = None
            if delivery_pct is not None:
                # NSE average delivery % is ~40%; >60% = strong institutional buying
                if delivery_pct > 65:
                    direction_score = min(100, direction_score + 6)
                    delivery_signal = "HIGH"
                elif delivery_pct > 55:
                    direction_score = min(100, direction_score + 3)
                    delivery_signal = "ABOVE_AVG"
                elif delivery_pct < 25:
                    direction_score = max(0, direction_score - 6)
                    delivery_signal = "LOW"
                else:
                    delivery_signal = "NORMAL"

            upside_7d = (target_7d - cmp) / cmp * 100
            upside_30d = (target_30d - cmp) / cmp * 100
            upside_90d = (target_90d - cmp) / cmp * 100

            if upside_30d > 3:
                direction = "BULLISH"
            elif upside_30d < -3:
                direction = "BEARISH"
            else:
                direction = "SIDEWAYS"

            # ── Gap 4: Confidence Gate ────────────────────────────────────────
            # Count how many independent signals agree on direction.
            # Only emit a high-conviction signal when 5+ of 7 signals align.
            # This dramatically improves precision (fewer but much more reliable calls).
            nifty_close_latest = self.get_nifty_data()
            nifty_bull = False
            if nifty_close_latest is not None and len(nifty_close_latest) >= 200:
                n_ema200 = float(nifty_close_latest.ewm(span=200).mean().iloc[-1])
                nifty_bull = float(nifty_close_latest.iloc[-1]) > n_ema200

            # Collect directional signals
            bull_signals, bear_signals = [], []

            if direction_score > 65:          bull_signals.append("ml_direction")
            elif direction_score < 35:         bear_signals.append("ml_direction")

            if rsi > 58:                       bull_signals.append("rsi_momentum")
            elif rsi < 42:                     bear_signals.append("rsi_momentum")

            if adx > 25:
                if ema_trend == "BULLISH":     bull_signals.append("adx_trend")
                else:                          bear_signals.append("adx_trend")

            if ema_trend == "BULLISH":         bull_signals.append("ema_aligned")
            else:                              bear_signals.append("ema_aligned")

            if st_signal == "BUY":             bull_signals.append("supertrend")
            elif st_signal == "SELL":          bear_signals.append("supertrend")

            if macd_trend in ("BULLISH", "FADING_BEAR"):    bull_signals.append("macd")
            elif macd_trend in ("BEARISH", "FADING_BULL"):  bear_signals.append("macd")

            if nifty_bull:                     bull_signals.append("nifty_regime")
            else:                              bear_signals.append("nifty_regime")

            # Classifier probability boost (Gap 3)
            dir_prob_7d = None
            for h_res in [ml_accuracy.get(7, {}), ml_accuracy.get(30, {})]:
                if "cross_stock" in h_res or True:
                    break
            for horizon_key in [7, 30]:
                hr = ml_accuracy.get(horizon_key, {})
                if hr.get("dir_prob_up") is not None:
                    dir_prob_7d = hr["dir_prob_up"]
                    break
            if dir_prob_7d is not None:
                if dir_prob_7d > 0.65:  bull_signals.append("clf_prob")
                elif dir_prob_7d < 0.35: bear_signals.append("clf_prob")

            n_bull = len(bull_signals)
            n_bear = len(bear_signals)
            max_signals = 8

            if n_bull >= 6:    gated_signal = "STRONG_BUY";  gate_score = n_bull
            elif n_bull >= 5:  gated_signal = "BUY";         gate_score = n_bull
            elif n_bull >= 4:  gated_signal = "WATCH";       gate_score = n_bull
            elif n_bear >= 6:  gated_signal = "STRONG_SELL"; gate_score = -n_bear
            elif n_bear >= 5:  gated_signal = "SELL";        gate_score = -n_bear
            elif n_bear >= 4:  gated_signal = "AVOID";       gate_score = -n_bear
            else:              gated_signal = "NEUTRAL";     gate_score = n_bull - n_bear

            gate_passed = gated_signal in ("STRONG_BUY", "BUY", "STRONG_SELL", "SELL")

            return {
                "symbol": symbol,
                "cmp": round(cmp, 2),
                "target_1d":      target_1d,
                "target_1d_low":  t1d_low,
                "target_1d_high": t1d_high,
                "upside_1d_pct":  upside_1d,
                "target_7d": round(target_7d, 2),
                "target_30d": round(target_30d, 2),
                "target_90d": round(target_90d, 2),
                "upside_7d_pct": round(upside_7d, 1),
                "upside_30d_pct": round(upside_30d, 1),
                "upside_90d_pct": round(upside_90d, 1),
                "target_7d_low": round(t7_low, 2),
                "target_7d_high": round(t7_high, 2),
                "target_30d_low": round(t30_low, 2),
                "target_30d_high": round(t30_high, 2),
                "target_90d_low": round(t90_low, 2),
                "target_90d_high": round(t90_high, 2),
                "direction": direction,
                "ema_trend": ema_trend,
                "macd_trend": macd_trend,
                "ema_20": round(ema_20, 2),
                "ema_50": round(ema_50, 2),
                "ema_200": round(ema_200, 2) if ema_200 else None,
                "rsi": round(rsi, 1),
                "adx": round(adx, 1),
                "volatility_ann": round(ann_vol, 1),
                "support": round(support, 2),
                "resistance": round(resistance, 2),
                "bb_upper": round(bb_upper, 2),
                "bb_lower": round(bb_lower, 2),
                "bb_width_pct": round(bb_width_pct, 1),
                "r_squared": round(r_squared, 3),
                "slope_pct_per_day": round(slope_pct, 3),
                "trend_strength": round(trend_strength, 1),
                "confidence": confidence,
                "direction_score": direction_score,
                "vwap": vwap,
                "supertrend": st_value,
                "supertrend_signal": st_signal,
                "algo_version": "v3-ML" if ml_used else "v3",
                "accuracy": ml_accuracy if ml_accuracy else None,
                # Gap 4: Confidence gate
                "gated_signal":  gated_signal,
                "gate_score":    gate_score,
                "gate_passed":   gate_passed,
                "bull_signals":  bull_signals,
                "bear_signals":  bear_signals,
                # Gap D: Earnings awareness
                "earnings_warning":   earnings_warning,
                "days_to_earnings":   days_to_earn,
                "next_earnings_date": next_earn_date,
                # Gap G: Delivery volume
                "delivery_pct":    delivery_pct,
                "delivery_signal": delivery_signal,
            }
        except Exception:
            return None

    def predict_batch(self, symbols):
        """Generate predictions for a list of symbols, sorted by upside_30d desc."""
        results = []
        for sym in symbols:
            pred = self.predict_stock(sym)
            if pred:
                results.append(pred)
        results.sort(key=lambda x: x["upside_30d_pct"], reverse=True)
        return results

    # =====================================================================
    # ML FEATURE ENGINEERING
    # =====================================================================

    def _build_ml_features(self, close, high, low, volume, nifty_close=None):
        """
        Build feature matrix from OHLCV data + optional Nifty regime features.
        Returns DataFrame with 18-23 features, NaN in early rows.
        """
        df = pd.DataFrame(index=close.index)

        # 1-5: Lagged returns (%)
        for lag in [1, 3, 5, 10, 20]:
            df[f"ret_{lag}d"] = close.pct_change(lag) * 100

        # 6: RSI (14-period)
        delta = close.diff()
        gain = delta.clip(lower=0).rolling(14).mean()
        loss = (-delta).clip(lower=0).rolling(14).mean()
        rs = gain / loss.replace(0, np.nan)
        df["rsi"] = 100 - (100 / (1 + rs))

        # 7: MACD histogram (normalized by price)
        ema12 = close.ewm(span=12).mean()
        ema26 = close.ewm(span=26).mean()
        macd_line = ema12 - ema26
        signal_line = macd_line.ewm(span=9).mean()
        df["macd_norm"] = (macd_line - signal_line) / close * 100

        # 8-9: Bollinger Band position and width
        sma20 = close.rolling(20).mean()
        std20 = close.rolling(20).std()
        bb_upper = sma20 + 2 * std20
        bb_lower = sma20 - 2 * std20
        bb_range = (bb_upper - bb_lower).replace(0, np.nan)
        df["bb_pos"] = (close - bb_lower) / bb_range
        df["bb_width"] = bb_range / sma20 * 100

        # 10-12: EMA ratios
        ema20 = close.ewm(span=20).mean()
        ema50 = close.ewm(span=50).mean()
        df["p_ema20"] = close / ema20
        df["p_ema50"] = close / ema50
        df["ema20_50"] = ema20 / ema50

        # 13: Volume ratio (vs 20-day average)
        vol_ma20 = volume.rolling(20).mean().replace(0, np.nan)
        df["vol_ratio"] = volume / vol_ma20

        # 14: 20-day rolling annualized volatility
        log_ret = np.log(close / close.shift(1))
        df["volatility"] = log_ret.rolling(20).std() * np.sqrt(252) * 100

        # 15: ADX (simplified rolling computation)
        n = min(len(high), len(low), len(close))
        h = high.iloc[-n:]
        l_ser = low.iloc[-n:]
        c_ser = close.iloc[-n:]

        tr = pd.concat([
            h - l_ser,
            (h - c_ser.shift(1)).abs(),
            (l_ser - c_ser.shift(1)).abs(),
        ], axis=1).max(axis=1)
        atr14 = tr.rolling(14).mean().replace(0, np.nan)

        up_move = h - h.shift(1)
        down_move = l_ser.shift(1) - l_ser
        plus_dm = pd.Series(
            np.where((up_move > down_move) & (up_move > 0), up_move, 0.0),
            index=h.index,
        )
        minus_dm = pd.Series(
            np.where((down_move > up_move) & (down_move > 0), down_move, 0.0),
            index=h.index,
        )
        plus_di = (plus_dm.rolling(14).mean() / atr14) * 100
        minus_di = (minus_dm.rolling(14).mean() / atr14) * 100
        di_sum = (plus_di + minus_di).replace(0, np.nan)
        dx = ((plus_di - minus_di).abs() / di_sum) * 100
        adx_series = dx.rolling(14).mean()

        # Align ADX to the features index
        df["adx"] = adx_series.reindex(df.index)

        # 16: Stochastic %K (14-period)
        low14  = close.rolling(14).min()
        high14 = close.rolling(14).max()
        stoch_range = (high14 - low14).replace(0, np.nan)
        df["stoch_k"] = (close - low14) / stoch_range * 100

        # 17: OBV momentum (OBV 5-day rate of change, normalized)
        obv = (np.sign(close.diff()) * volume).cumsum()
        obv_ma5 = obv.rolling(5).mean()
        obv_prev10 = obv.shift(10)
        df["obv_momentum"] = (obv_ma5 - obv_prev10) / (close.abs() + 1e-6)

        # 18: Volume surge (current vol vs 5-day avg — spike detection)
        vol_ma5 = volume.rolling(5).mean().replace(0, np.nan)
        df["vol_surge"] = (volume / vol_ma5).clip(0, 5)

        # 19-23: Nifty regime features (market context — improves cross-stock accuracy)
        if nifty_close is not None and len(nifty_close) > 0:
            try:
                # Align Nifty to stock dates
                nifty_aligned = nifty_close.reindex(close.index, method="ffill")
                # Market momentum features
                df["nifty_5d_ret"]  = nifty_aligned.pct_change(5) * 100
                df["nifty_10d_ret"] = nifty_aligned.pct_change(10) * 100
                df["nifty_20d_ret"] = nifty_aligned.pct_change(20) * 100
                # Bull/bear regime: 1 if Nifty above its 200-day EMA
                nifty_ema200 = nifty_aligned.ewm(span=200, min_periods=50).mean()
                df["nifty_bull_regime"] = (nifty_aligned > nifty_ema200).astype(float)
                # Relative strength: stock vs Nifty over 5 days
                stock_5d = close.pct_change(5) * 100
                df["stock_rs_5d"] = stock_5d - df["nifty_5d_ret"]
            except Exception:
                pass  # If Nifty alignment fails, skip — don't break prediction

        return df

    # =====================================================================
    # ML ENSEMBLE TRAINING & PREDICTION
    # =====================================================================

    def _ml_ensemble_predict(self, features_df, close, horizon, cross_stock_bundle=None):
        """
        Train RF + GradientBoosting + MLP ensemble, predict forward return.

        If cross_stock_bundle is provided (pretrained models from train_cross_stock_models),
        skips per-stock training and uses those directly — much higher accuracy due to
        100,000+ training samples vs ~200 per-stock samples.

        Falls back to chronological 80/20 per-stock training if no cross-stock models.
        Ensemble weights = inverse MAE on validation set.

        Returns: predicted forward return % or None if insufficient data.
        """
        # --- Use pretrained cross-stock models if available ---
        if cross_stock_bundle is not None:
            try:
                bundle_models   = cross_stock_bundle["models"]
                bundle_scaler   = cross_stock_bundle["scaler"]
                bundle_weights  = cross_stock_bundle["weights"]
                all_cols        = cross_stock_bundle.get("all_feature_cols", cross_stock_bundle["feature_cols"])
                feature_mask    = cross_stock_bundle.get("feature_mask")  # bool mask for pruning

                # Align features to the cross-stock column order
                latest_row = features_df.reindex(columns=all_cols).iloc[-1:]
                if latest_row.isnull().any(axis=1).iloc[0]:
                    clean = features_df.reindex(columns=all_cols).dropna()
                    latest_row = clean.iloc[-1:] if len(clean) > 0 else None

                if latest_row is not None:
                    X_latest = latest_row.values
                    if feature_mask is not None:
                        X_latest = X_latest[:, np.array(feature_mask)]
                    latest_s = bundle_scaler.transform(X_latest)

                    ensemble_pred = sum(
                        float(m.predict(latest_s)[0]) * bundle_weights[name]
                        for name, m in bundle_models.items()
                        if name in bundle_weights
                    )
                    max_cap = {7: 15, 30: 30, 90: 50}
                    cap = max_cap.get(horizon, 50)
                    ensemble_pred = max(-cap, min(cap, ensemble_pred))

                    # Gap 3: direction probability from classifier
                    dir_prob_up = None
                    clf_bundle = cross_stock_bundle.get("classifier")
                    if clf_bundle and clf_bundle.get("model"):
                        try:
                            proba = clf_bundle["model"].predict_proba(latest_s)
                            classes = list(clf_bundle["model"].classes_)
                            if 1 in classes:
                                dir_prob_up = float(proba[0][classes.index(1)])
                        except Exception:
                            pass

                    return {
                        "prediction":      ensemble_pred,
                        "val_mae":         cross_stock_bundle.get("val_mae", 0.0),
                        "val_dir_acc":     cross_stock_bundle.get("val_dir_acc", 0.0),
                        "val_within_5pct": cross_stock_bundle.get("val_within_5pct", 0.0),
                        "val_n":           cross_stock_bundle.get("val_n", 0),
                        "cross_stock":     True,
                        "dir_prob_up":     round(dir_prob_up, 3) if dir_prob_up is not None else None,
                    }
            except Exception:
                pass  # fall through to per-stock training

        # --- Per-stock training fallback ---
        # Target: forward return %
        fwd_return = (close.shift(-horizon) / close - 1) * 100

        combined = features_df.copy()
        combined["target"] = fwd_return
        combined = combined.dropna()

        if len(combined) < self.MIN_ML_SAMPLES:
            return None

        feature_cols = [c for c in combined.columns if c != "target"]
        X = combined[feature_cols].values
        y = combined["target"].values
        n = len(X)

        # Gap 2: Walk-forward CV — 3 expanding windows for per-stock data
        # Each window adds ~15% more training data; report avg accuracy across windows
        wf_mae, wf_dir, wf_w5 = [], [], []
        n_folds = min(3, max(1, n // 60))  # 1-3 folds depending on data size
        for fold in range(n_folds):
            t_end = int(n * (0.6 + fold * 0.13))
            v_end = min(n, t_end + max(10, n // 6))
            if t_end < 20 or v_end - t_end < 5:
                continue
            Xtr, Xvl = X[:t_end], X[t_end:v_end]
            ytr, yvl = y[:t_end], y[t_end:v_end]
            sc_fold = StandardScaler()
            Xtr_s = sc_fold.fit_transform(Xtr)
            Xvl_s = sc_fold.transform(Xvl)
            fold_preds = []
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                _fold_mdls = [RandomForestRegressor(**self.RF_PARAMS)]
                if LGBM_AVAILABLE:
                    _fold_mdls.append(lgb.LGBMRegressor(**self.LGBM_PARAMS))
                else:
                    _fold_mdls.append(HistGradientBoostingRegressor(**self.HGB_PARAMS))
                for mdl in _fold_mdls:
                    try:
                        if LGBM_AVAILABLE and isinstance(mdl, lgb.LGBMRegressor):
                            mdl.fit(Xtr_s, ytr, eval_set=[(Xvl_s, yvl)],
                                    callbacks=[lgb.early_stopping(30, verbose=False),
                                               lgb.log_evaluation(-1)])
                        else:
                            mdl.fit(Xtr_s, ytr)
                        fold_preds.append(mdl.predict(Xvl_s))
                    except Exception:
                        pass
            if fold_preds:
                vp = np.mean(fold_preds, axis=0)
                wf_mae.append(float(np.mean(np.abs(vp - yvl))))
                nz = yvl != 0
                wf_dir.append(float(np.mean(np.sign(vp[nz]) == np.sign(yvl[nz]))) * 100 if nz.sum() > 0 else 50.0)
                wf_w5.append(float(np.mean(np.abs(vp - yvl) <= 5)) * 100)

        avg_mae = float(np.mean(wf_mae)) if wf_mae else 0.0
        avg_dir = float(np.mean(wf_dir)) if wf_dir else 50.0
        avg_w5  = float(np.mean(wf_w5))  if wf_w5  else 0.0

        # Final model: train on full data for prediction
        scaler = StandardScaler()
        X_all_s = scaler.fit_transform(X)

        # Final validation window for ensemble weighting
        split_idx = int(n * 0.8)
        X_train_s = X_all_s[:split_idx]
        X_val_s   = X_all_s[split_idx:]
        y_train   = y[:split_idx]
        y_val     = y[split_idx:]

        models = {}
        mae_scores = {}

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")

            # --- Random Forest ---
            try:
                rf = RandomForestRegressor(**self.RF_PARAMS)
                rf.fit(X_train_s, y_train)
                rf_pred = rf.predict(X_val_s)
                mae_scores["rf"] = float(np.mean(np.abs(rf_pred - y_val)))
                models["rf"] = rf
            except Exception:
                pass

            # --- LightGBM (preferred) or HistGBM fallback ---
            try:
                if LGBM_AVAILABLE:
                    booster = lgb.LGBMRegressor(**self.LGBM_PARAMS)
                    booster.fit(X_train_s, y_train,
                                eval_set=[(X_val_s, y_val)],
                                callbacks=[lgb.early_stopping(30, verbose=False),
                                           lgb.log_evaluation(-1)])
                else:
                    booster = HistGradientBoostingRegressor(**self.HGB_PARAMS)
                    booster.fit(X_train_s, y_train)
                booster_pred = booster.predict(X_val_s)
                mae_scores["lgbm"] = float(np.mean(np.abs(booster_pred - y_val)))
                models["lgbm"] = booster
            except Exception:
                pass

            # --- XGBoost (additional ensemble member) ---
            if XGBM_AVAILABLE:
                try:
                    xgb_model = xgb.XGBRegressor(**self.XGBM_PARAMS)
                    xgb_model.fit(X_train_s, y_train,
                                  eval_set=[(X_val_s, y_val)],
                                  early_stopping_rounds=30,
                                  verbose=False)
                    xgb_pred = xgb_model.predict(X_val_s)
                    mae_scores["xgb"] = float(np.mean(np.abs(xgb_pred - y_val)))
                    models["xgb"] = xgb_model
                except Exception:
                    pass

            # --- MLP Neural Network ---
            try:
                mlp = MLPRegressor(**self.MLP_PARAMS)
                mlp.fit(X_train_s, y_train)
                mlp_pred = mlp.predict(X_val_s)
                mae_scores["mlp"] = float(np.mean(np.abs(mlp_pred - y_val)))
                models["mlp"] = mlp
            except Exception:
                pass

            # --- OLS baseline ---
            try:
                lr_model = LinearRegression()
                lr_model.fit(X_train_s, y_train)
                lr_pred = lr_model.predict(X_val_s)
                mae_scores["lr"] = float(np.mean(np.abs(lr_pred - y_val)))
                models["lr"] = lr_model
            except Exception:
                pass

        if not models:
            return None

        # Inverse-MAE ensemble weights
        inv_mae = {k: 1.0 / (v + 1e-6) for k, v in mae_scores.items()}
        total = sum(inv_mae.values())
        weights = {k: v / total for k, v in inv_mae.items()}

        # Predict on latest features
        latest_row = features_df.iloc[-1:]
        if latest_row.isnull().any(axis=1).iloc[0]:
            clean = features_df.dropna()
            if len(clean) == 0:
                return None
            latest_row = clean.iloc[-1:]

        latest_s = scaler.transform(latest_row.values)
        ensemble_pred = sum(float(m.predict(latest_s)[0]) * weights[k] for k, m in models.items())
        max_cap = {7: 15, 30: 30, 90: 50}
        cap = max_cap.get(horizon, 50)
        ensemble_pred = max(-cap, min(cap, ensemble_pred))

        # Gap 3: Direction classifier (classifies UP / DOWN with threshold filtering)
        dir_prob_up = None
        thresh = self.DIRECTION_THRESHOLD.get(horizon, 2.0)
        y_class = np.where(y > thresh, 1, np.where(y < -thresh, 0, -1))  # -1 = neutral
        mask = y_class != -1
        if mask.sum() >= 40:
            Xc_train = X_all_s[:split_idx][mask[:split_idx]]
            yc_train = y_class[:split_idx][mask[:split_idx]]
            Xc_val   = X_all_s[split_idx:][mask[split_idx:]]
            yc_val   = y_class[split_idx:][mask[split_idx:]]
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                try:
                    clf = HistGradientBoostingClassifier(**self.HGB_CLF_PARAMS)
                    clf.fit(Xc_train, yc_train)
                    proba = clf.predict_proba(latest_s)
                    classes = list(clf.classes_)
                    if 1 in classes:
                        dir_prob_up = float(proba[0][classes.index(1)])
                except Exception:
                    pass

        # Use walk-forward accuracy as the reported metric (more honest than single split)
        return {
            "prediction": ensemble_pred,
            "val_mae":         round(avg_mae if avg_mae else float(np.mean(list(mae_scores.values()))), 2),
            "val_dir_acc":     round(avg_dir, 1),
            "val_within_5pct": round(avg_w5, 1),
            "val_n":           len(y_val),
            "cross_stock":     False,
            "dir_prob_up":     round(dir_prob_up, 3) if dir_prob_up is not None else None,
        }

    def _generate_1day_target(self, cmp, rsi, macd_hist, adx, daily_vol,
                               supertrend_signal, above_vwap, support, resistance, ema_trend):
        """
        1-day price target using regime-aware momentum model.

        Logic: Score bullish/bearish signals → scale by daily volatility → clamp to S/R.
        Caps at ±2σ daily move (realistic intraday/next-day range).
        """
        score = 0.0  # -1.0 (max bearish) to +1.0 (max bullish)

        # RSI regime (strongest signal for 1-day)
        if rsi >= 80:     score -= 0.50  # extreme overbought, mean reversion expected
        elif rsi >= 70:   score -= 0.30  # overbought
        elif rsi >= 60:   score += 0.20  # bullish momentum
        elif rsi >= 50:   score += 0.10  # mild bullish
        elif rsi >= 40:   score -= 0.10  # mild bearish
        elif rsi >= 30:   score -= 0.20  # bearish
        else:             score += 0.30  # oversold, reversal likely

        # Supertrend (high-weight directional signal)
        if supertrend_signal == "BUY":   score += 0.30
        elif supertrend_signal == "SELL": score -= 0.30

        # VWAP position
        if above_vwap:  score += 0.15
        else:           score -= 0.15

        # MACD histogram direction
        if macd_hist > 0:  score += 0.10
        else:              score -= 0.10

        # EMA trend
        if ema_trend == "BULLISH": score += 0.10
        else:                      score -= 0.10

        # ADX: weak trend means less conviction
        if adx < 15:
            score *= 0.5  # range-bound, compress signal
        elif adx > 30:
            score *= 1.2  # strong trend, amplify slightly

        # Proximity to S/R: near resistance suppresses upside; near support suppresses downside
        if resistance > cmp:
            dist_to_res = (resistance - cmp) / cmp
            if dist_to_res < 0.01:   # within 1% of resistance
                score = min(score, -0.10)  # strong cap — likely to reject
            elif dist_to_res < 0.02: # within 2% of resistance
                score = min(score, 0.05)
        if support < cmp:
            dist_to_sup = (cmp - support) / cmp
            if dist_to_sup < 0.01:   # within 1% of support
                score = max(score, 0.05)  # likely to bounce

        # Clamp final score
        score = max(-1.0, min(1.0, score))

        # Scale by daily volatility (1 sigma = 1 std dev of daily log return)
        sigma = daily_vol  # already daily volatility as fraction
        if sigma < 0.005:
            sigma = 0.010  # minimum 1% daily vol

        expected_move_pct = score * sigma * 100  # as percentage

        # Cap at ±2σ
        max_move = sigma * 2 * 100
        expected_move_pct = max(-max_move, min(max_move, expected_move_pct))

        target_1d = cmp * (1 + expected_move_pct / 100)

        # 1-sigma confidence bands (±1 daily std dev)
        t1d_low  = cmp * (1 - sigma)
        t1d_high = cmp * (1 + sigma)

        # Don't predict above resistance or below support
        target_1d = min(target_1d, resistance * 1.005) if resistance > cmp else target_1d
        target_1d = max(target_1d, support * 0.995)   if support < cmp  else target_1d

        return round(target_1d, 2), round(t1d_low, 2), round(t1d_high, 2)

    # =====================================================================
    # TECHNICAL INDICATOR CALCULATIONS (from v2)
    # =====================================================================

    def _linear_regression(self, close, lookback=60):
        """Fit OLS linear regression on recent prices."""
        data = close.iloc[-lookback:].values
        n = len(data)
        x = np.arange(n, dtype=float)
        y = data.astype(float)

        x_mean = x.mean()
        y_mean = y.mean()
        ss_xy = np.sum((x - x_mean) * (y - y_mean))
        ss_xx = np.sum((x - x_mean) ** 2)

        if ss_xx == 0:
            return {"slope": 0.0, "r_squared": 0.0, "slope_pct": 0.0, "cmp": float(data[-1])}

        slope = float(ss_xy / ss_xx)
        intercept = float(y_mean - slope * x_mean)

        y_pred = slope * x + intercept
        ss_res = np.sum((y - y_pred) ** 2)
        ss_tot = np.sum((y - y_mean) ** 2)
        r_sq = max(0.0, min(1.0, 1 - (ss_res / ss_tot) if ss_tot > 0 else 0))

        cmp = float(data[-1])
        slope_pct = (slope / cmp * 100) if cmp > 0 else 0.0

        return {"slope": slope, "r_squared": r_sq, "slope_pct": slope_pct, "cmp": cmp}

    def _compute_macd(self, close, fast=12, slow=26, signal=9):
        """Calculate MACD histogram and trend direction."""
        ema_fast = close.ewm(span=fast).mean()
        ema_slow = close.ewm(span=slow).mean()
        macd_line = ema_fast - ema_slow
        signal_line = macd_line.ewm(span=signal).mean()
        histogram = macd_line - signal_line

        hist_val = float(histogram.iloc[-1])
        hist_prev = float(histogram.iloc[-2]) if len(histogram) >= 2 else 0.0

        if hist_val > 0 and hist_val > hist_prev:
            trend = "BULLISH"
        elif hist_val < 0 and hist_val < hist_prev:
            trend = "BEARISH"
        elif hist_val > 0:
            trend = "FADING_BULL"
        elif hist_val < 0:
            trend = "FADING_BEAR"
        else:
            trend = "NEUTRAL"

        return hist_val, trend

    def _compute_adx(self, high, low, close, period=14):
        """Calculate ADX (Average Directional Index)."""
        try:
            n = min(len(high), len(low), len(close))
            h = high.iloc[-n:].values.astype(float)
            l = low.iloc[-n:].values.astype(float)
            c = close.iloc[-n:].values.astype(float)

            if n < period + 2:
                return 25.0

            tr = np.zeros(n)
            plus_dm = np.zeros(n)
            minus_dm = np.zeros(n)
            for i in range(1, n):
                tr[i] = max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1]))
                up = h[i] - h[i - 1]
                down = l[i - 1] - l[i]
                if up > down and up > 0:
                    plus_dm[i] = up
                if down > up and down > 0:
                    minus_dm[i] = down

            atr = np.zeros(n)
            s_plus = np.zeros(n)
            s_minus = np.zeros(n)
            atr[period] = np.mean(tr[1:period + 1])
            s_plus[period] = np.mean(plus_dm[1:period + 1])
            s_minus[period] = np.mean(minus_dm[1:period + 1])

            for i in range(period + 1, n):
                atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period
                s_plus[i] = (s_plus[i - 1] * (period - 1) + plus_dm[i]) / period
                s_minus[i] = (s_minus[i - 1] * (period - 1) + minus_dm[i]) / period

            dx_vals = []
            for i in range(period, n):
                if atr[i] == 0:
                    continue
                pdi = (s_plus[i] / atr[i]) * 100
                mdi = (s_minus[i] / atr[i]) * 100
                di_sum = pdi + mdi
                if di_sum > 0:
                    dx_vals.append(abs(pdi - mdi) / di_sum * 100)

            if len(dx_vals) < period:
                return 25.0

            adx = np.mean(dx_vals[-period:])
            return max(0.0, min(100.0, float(adx)))
        except Exception:
            return 25.0

    def _compute_rsi(self, close, period=14):
        """Calculate RSI (Relative Strength Index)."""
        delta = close.diff()
        gain = delta.clip(lower=0)
        loss = (-delta).clip(lower=0)

        avg_gain = gain.iloc[-period:].mean()
        avg_loss = loss.iloc[-period:].mean()

        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return 100 - (100 / (1 + rs))

    def _bollinger_bands(self, close, period=20, std_dev=2):
        """Calculate Bollinger Bands."""
        sma = close.iloc[-period:].mean()
        std = close.iloc[-period:].std()
        upper = sma + std_dev * std
        lower = sma - std_dev * std
        return float(upper), float(lower), float(sma)

    def _support_resistance(self, close, lookback=60):
        """Find recent support and resistance from swing highs/lows."""
        recent = close.iloc[-lookback:]
        lows, highs = [], []
        vals = recent.values
        for i in range(2, len(vals) - 2):
            if vals[i] <= min(vals[i - 1], vals[i - 2], vals[i + 1], vals[i + 2]):
                lows.append(float(vals[i]))
            if vals[i] >= max(vals[i - 1], vals[i - 2], vals[i + 1], vals[i + 2]):
                highs.append(float(vals[i]))

        support = max(lows[-3:]) if lows else float(recent.min())
        resistance = min(highs[-3:]) if highs else float(recent.max())

        cmp = float(close.iloc[-1])
        if support >= cmp:
            support = float(recent.min())
        if resistance <= cmp:
            resistance = float(recent.max())

        return support, resistance

    def _compute_volatility(self, close, lookback=30):
        """Daily volatility = std dev of log returns."""
        prices = close.iloc[-lookback:]
        log_returns = np.log(prices / prices.shift(1)).dropna()
        if len(log_returns) < 5:
            return 0.02
        return float(log_returns.std())

    def _compute_vwap(self, high, low, close, volume, period=20):
        """Compute rolling VWAP over given period."""
        try:
            typical_price = (high + low + close) / 3
            cum_tp_vol = (typical_price * volume).rolling(window=period).sum()
            cum_vol = volume.rolling(window=period).sum()
            vwap = cum_tp_vol / cum_vol
            val = float(vwap.iloc[-1])
            return round(val, 2) if not math.isnan(val) else None
        except Exception:
            return None

    def _compute_supertrend(self, high, low, close, period=10, multiplier=3.0):
        """Compute Supertrend indicator. Returns (value, signal)."""
        try:
            n = len(close)
            if n < period + 1:
                return None, None

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
                    if upper_basic.iloc[i] < upper_band.iloc[i - 1] or close.iloc[i - 1] > upper_band.iloc[i - 1]:
                        upper_band.iloc[i] = upper_basic.iloc[i]
                    else:
                        upper_band.iloc[i] = upper_band.iloc[i - 1]
                    if lower_basic.iloc[i] > lower_band.iloc[i - 1] or close.iloc[i - 1] < lower_band.iloc[i - 1]:
                        lower_band.iloc[i] = lower_basic.iloc[i]
                    else:
                        lower_band.iloc[i] = lower_band.iloc[i - 1]
                    if direction.iloc[i - 1] == 1:
                        direction.iloc[i] = -1 if close.iloc[i] > upper_band.iloc[i] else 1
                    else:
                        direction.iloc[i] = 1 if close.iloc[i] < lower_band.iloc[i] else -1

                supertrend.iloc[i] = lower_band.iloc[i] if direction.iloc[i] == -1 else upper_band.iloc[i]

            st_value = float(supertrend.iloc[-1])
            st_value = round(st_value, 2) if not math.isnan(st_value) else None
            st_signal = "BUY" if direction.iloc[-1] == -1 else "SELL"
            return st_value, st_signal
        except Exception:
            return None, None

    # =====================================================================
    # TECHNICAL TARGET GENERATION (v2 multi-signal ensemble)
    # =====================================================================

    def _generate_technical_target(self, cmp, days, lr_short, lr_medium, lr_long,
                                   ema_anchor, ema_momentum, macd_hist, rsi, adx,
                                   daily_vol, support, resistance):
        """
        Generate price target using 4 technical sub-models.
        Returns: (target, low_bound, high_bound)
        """
        if days <= 7:
            lr = lr_short
        elif days <= 30:
            lr = lr_medium
        else:
            lr = lr_long

        # Sub-model 1: Dampened Regression
        base_damp = self.DAMPENING.get(days, 0.25)
        if adx > 30:
            adx_factor = 1.3
        elif adx > 20:
            adx_factor = 1.0
        else:
            adx_factor = 0.6

        dampened_slope = lr["slope"] * base_damp * adx_factor
        reg_target = cmp + dampened_slope * days
        r_sq = lr["r_squared"]
        reg_target = cmp + (reg_target - cmp) * max(0.5, r_sq)

        # Sub-model 2: Trend Continuation
        ema_days_cap = min(days, 25)
        future_ema = ema_anchor * (1 + ema_momentum / 100 * ema_days_cap / 5)
        rel_pos = cmp / ema_anchor if ema_anchor > 0 else 1.0
        fade = {7: 0.85, 30: 0.60, 90: 0.35}.get(days, 0.35)
        faded_pos = 1 + (rel_pos - 1) * fade
        trend_target = future_ema * faded_pos

        # Sub-model 3: Mean Reversion
        base_reversion = self.REVERSION_BASE.get(days, 0.50)
        if adx > 30:
            rev_factor = 0.2
        elif adx > 20:
            rev_factor = 0.6
        else:
            rev_factor = 1.0
        reversion_pct = base_reversion * rev_factor
        rev_target = cmp + (ema_anchor - cmp) * reversion_pct

        # Sub-model 4: Momentum (MACD + RSI)
        macd_pct = (macd_hist / cmp * 100) if cmp > 0 else 0.0
        if days <= 7:
            macd_scale = 1.5
        elif days <= 30:
            macd_scale = 1.0
        else:
            macd_scale = 0.3

        if rsi > 70:
            rsi_adj = -(rsi - 70) / 100
        elif rsi < 30:
            rsi_adj = (30 - rsi) / 100
        else:
            rsi_adj = 0.0

        momentum_pct = macd_pct * macd_scale + rsi_adj * 5
        momentum_pct = max(-8, min(8, momentum_pct))
        mom_target = cmp * (1 + momentum_pct / 100)

        # Weighted ensemble
        w_reg, w_trend, w_rev, w_mom = self.TECH_WEIGHTS.get(days, self.TECH_WEIGHTS[90])
        target = reg_target * w_reg + trend_target * w_trend + rev_target * w_rev + mom_target * w_mom

        # S/R gravity
        if target > cmp and resistance > cmp:
            target += (resistance - target) * 0.08
        elif target < cmp and support < cmp:
            target += (support - target) * 0.08

        # Volatility cone cap
        if daily_vol > 0.001:
            sigma = daily_vol * math.sqrt(days)
            vol_upper = cmp * math.exp(2 * sigma)
            vol_lower = cmp * math.exp(-2 * sigma)
            target = max(vol_lower, min(vol_upper, target))
            low_bound = cmp * math.exp(-sigma)
            high_bound = cmp * math.exp(sigma)
        else:
            low_bound = target * 0.95
            high_bound = target * 1.05

        target = max(target, cmp * 0.5)
        low_bound = max(low_bound, cmp * 0.5)

        return target, low_bound, high_bound

    # =====================================================================
    # SCORING
    # =====================================================================

    def _compute_confidence(self, r_squared, ema_trend, rsi, bb_width_pct,
                            slope_pct, adx, macd_trend, ann_vol,
                            support=None, resistance=None, cmp=None):
        """
        Confidence score 0-100 — measures PREDICTION RELIABILITY, not direction.

        High confidence = prediction is likely accurate (strong trend, aligned signals,
        clean R², low noise). Direction-neutral: a strong bearish trend and a strong
        bullish trend both get high confidence if signals align.
        """
        score = 0.0

        # R² — how well price fits a trend line (0-20 pts)
        score += min(20, r_squared * 25)

        # ADX — trend strength (0-20 pts)
        if adx > 30:
            score += 20
        elif adx > 25:
            score += 16
        elif adx > 20:
            score += 12
        elif adx > 15:
            score += 8
        else:
            score += 4

        # Signal alignment (do all signals agree on direction?) (0-20 pts)
        # Direction-neutral: counts alignment in either direction
        bullish = bearish = 0
        if ema_trend == "BULLISH":
            bullish += 1
        else:
            bearish += 1
        if slope_pct > 0.02:
            bullish += 1
        elif slope_pct < -0.02:
            bearish += 1
        if macd_trend in ("BULLISH", "FADING_BEAR"):
            bullish += 1
        elif macd_trend in ("BEARISH", "FADING_BULL"):
            bearish += 1

        alignment = max(bullish, bearish)
        score += {3: 20, 2: 12, 1: 5, 0: 3}.get(alignment, 5)

        # RSI — direction-neutral reliability penalty (0-15 pts)
        # Extreme RSI = higher mean-reversion risk = lower prediction reliability
        # RSI 40-65: cleanest zone, signals are reliable
        # RSI extremes: higher reversal risk, lower confidence in continuation
        if 40 <= rsi <= 65:
            score += 15   # clean momentum zone, high reliability
        elif 30 <= rsi < 40 or 65 < rsi <= 75:
            score += 10   # mild extreme, slightly lower reliability
        elif rsi > 75 or rsi < 30:
            score += 5    # extreme zone — mean-reversion risk, lower reliability

        # Volatility — lower vol = more predictable = higher confidence (0-15 pts)
        if ann_vol < 20:
            score += 15
        elif ann_vol < 30:
            score += 12
        elif ann_vol < 40:
            score += 9
        elif ann_vol < 60:
            score += 5
        else:
            score += 2

        # Slope magnitude — very flat or very steep both reduce reliability (0-10 pts)
        abs_slope = abs(slope_pct)
        if 0.05 <= abs_slope <= 0.3:
            score += 10   # healthy trend speed
        elif abs_slope < 0.05:
            score += 6    # very flat — hard to predict direction
        elif abs_slope <= 0.5:
            score += 7
        else:
            score += 3    # very steep — unsustainable, likely to revert

        # Penalty: at resistance/support extreme (reversal risk regardless of direction)
        if cmp is not None and resistance is not None and rsi is not None:
            dist_res = (resistance - cmp) / cmp if cmp > 0 else 1.0
            if rsi > 70 and dist_res < 0.02:
                score -= 12  # overbought at resistance = high reversal risk

        if cmp is not None and support is not None and rsi is not None:
            dist_sup = (cmp - support) / cmp if cmp > 0 else 1.0
            if rsi < 30 and dist_sup < 0.02:
                score += 5  # oversold at support = clean reversal setup

        return min(100, round(score))

    def _compute_direction_score(self, rsi, ema_trend, slope_pct, macd_trend, adx,
                                  supertrend_signal, above_vwap, support, resistance, cmp):
        """
        Direction score 0-100 measuring BULLISH CONVICTION.

        50 = neutral/sideways, >60 = bullish, >75 = strongly bullish,
        <40 = bearish, <25 = strongly bearish.

        Unlike confidence, this DIRECTLY encodes direction — high score means
        multiple bullish signals are aligned. This fixes the inverted-confidence bug
        where high confidence correlated with bearish predictions.
        """
        # Start at 50 (neutral)
        score = 50.0

        # === RSI (+/- 20 pts) ===
        # Maps RSI linearly: RSI=70 → +16, RSI=50 → 0, RSI=30 → -16
        rsi_contribution = (rsi - 50.0) * 0.4
        rsi_contribution = max(-20.0, min(20.0, rsi_contribution))
        score += rsi_contribution

        # === EMA trend (+/- 10 pts) ===
        if ema_trend == "BULLISH":
            score += 10
        else:
            score -= 10

        # === Slope direction (+/- 8 pts) ===
        if slope_pct > 0.05:
            score += 8
        elif slope_pct > 0.01:
            score += 4
        elif slope_pct < -0.05:
            score -= 8
        elif slope_pct < -0.01:
            score -= 4

        # === MACD trend (+/- 8 pts) ===
        if macd_trend == "BULLISH":
            score += 8
        elif macd_trend == "FADING_BEAR":
            score += 3
        elif macd_trend == "BEARISH":
            score -= 8
        elif macd_trend == "FADING_BULL":
            score -= 3

        # === Supertrend (+/- 10 pts) ===
        if supertrend_signal == "BUY":
            score += 10
        elif supertrend_signal == "SELL":
            score -= 10

        # === VWAP position (+/- 6 pts) ===
        if above_vwap:
            score += 6
        else:
            score -= 6

        # === ADX amplifier — strong trends amplify conviction ===
        if adx > 30:
            deviation = score - 50.0
            score = 50.0 + deviation * 1.25
        elif adx < 15:
            # Weak trend — compress toward neutral (sideways market)
            deviation = score - 50.0
            score = 50.0 + deviation * 0.5

        # === S/R proximity adjustment ===
        if cmp is not None and resistance is not None and resistance > cmp:
            dist_res = (resistance - cmp) / cmp
            if dist_res < 0.01:
                score -= 8   # at resistance ceiling
            elif dist_res < 0.02:
                score -= 4

        if cmp is not None and support is not None and support < cmp:
            dist_sup = (cmp - support) / cmp
            if dist_sup < 0.01:
                score += 5   # sitting on support floor

        return max(0.0, min(100.0, round(score, 1)))

    def _trend_strength(self, close, adx):
        """Trend strength 0-100 combining EMA position and ADX."""
        cmp = float(close.iloc[-1])
        ema_20 = float(close.ewm(span=20).mean().iloc[-1])
        ema_50 = float(close.ewm(span=50).mean().iloc[-1])

        score = 50.0

        if cmp > ema_20:
            score += 10
        else:
            score -= 10

        if cmp > ema_50:
            score += 10
        else:
            score -= 10

        if ema_20 > ema_50:
            score += 8
        else:
            score -= 8

        pct_from_ema20 = (cmp - ema_20) / ema_20 * 100 if ema_20 > 0 else 0
        if pct_from_ema20 > 5:
            score += 7
        elif pct_from_ema20 > 0:
            score += 3
        elif pct_from_ema20 < -5:
            score -= 7
        else:
            score -= 3

        if adx > 25:
            if score > 50:
                score += min(15, (adx - 25) * 0.5)
            else:
                score -= min(15, (adx - 25) * 0.5)

        return max(0.0, min(100.0, score))

    # =====================================================================
    # CROSS-STOCK MODEL TRAINING (Step B — much larger training set)
    # =====================================================================

    def get_nifty_data(self):
        """
        Fetch and cache Nifty 50 close prices (^NSEI) for regime features.
        Cached in-memory for 1 hour; returns None if unavailable.
        """
        try:
            import yfinance as yf
            cache = PricePredictor._nifty_cache
            now = datetime.now()
            if cache and (now - cache.get("fetched_at", datetime.min)) < timedelta(hours=1):
                return cache.get("close")

            ticker = yf.Ticker("^NSEI")
            hist = ticker.history(period=config.ML_PRICE_HISTORY_PERIOD, auto_adjust=True)
            if hist is None or hist.empty:
                return None
            close = hist["Close"].astype(float).dropna()
            PricePredictor._nifty_cache = {"close": close, "fetched_at": now}
            return close
        except Exception:
            return None

    # =====================================================================
    # GAP D: EARNINGS DATE AWARENESS
    # =====================================================================

    def get_earnings_info(self, symbol):
        """
        Fetch next earnings date for a symbol and compute days_to_earnings.
        Cached per symbol for 24h. Returns dict or None.
        """
        cache = PricePredictor._earnings_cache
        now   = datetime.now()
        if symbol in cache and (now - cache[symbol].get("fetched_at", datetime.min)) < timedelta(hours=24):
            return cache[symbol]
        try:
            import yfinance as yf
            ticker  = yf.Ticker(symbol)
            cal     = ticker.calendar
            days_to = None
            next_dt = None
            if cal is not None:
                # yfinance calendar: dict with 'Earnings Date' key (list of Timestamps)
                ed = None
                if isinstance(cal, dict):
                    ed = cal.get("Earnings Date") or cal.get("earnings_date")
                elif hasattr(cal, "get"):
                    ed = cal.get("Earnings Date")
                if ed is not None:
                    dates = ed if isinstance(ed, list) else [ed]
                    future = [d for d in dates if pd.Timestamp(d).date() >= now.date()]
                    if future:
                        next_dt    = pd.Timestamp(future[0]).date()
                        days_to    = (next_dt - now.date()).days
            info = {"days_to_earnings": days_to, "next_earnings_date": str(next_dt) if next_dt else None,
                    "fetched_at": now}
            cache[symbol] = info
            return info
        except Exception:
            info = {"days_to_earnings": None, "next_earnings_date": None, "fetched_at": now}
            cache[symbol] = info
            return info

    # =====================================================================
    # GAP G: NSE DELIVERY VOLUME
    # =====================================================================

    def get_delivery_pct(self, symbol_ns):
        """
        Fetch latest NSE delivery volume % for a stock (Gap G).
        Uses jugaad-data if available; cached per symbol for 6h.
        Returns float (delivery%) or None.
        """
        sym = symbol_ns.replace(".NS", "")
        cache = PricePredictor._delivery_cache
        now   = datetime.now()
        if sym in cache and (now - cache[sym].get("fetched_at", datetime.min)) < timedelta(hours=6):
            return cache[sym].get("delivery_pct")
        if not JUGAAD_AVAILABLE:
            return None
        try:
            nse  = _NSELive()
            data = nse.equities_traded_info(sym)
            dvol = float(data.get("deliveryToTradedQuantity", 0) or 0)
            cache[sym] = {"delivery_pct": dvol, "fetched_at": now}
            return dvol
        except Exception:
            cache[sym] = {"delivery_pct": None, "fetched_at": now}
            return None

    # =====================================================================
    # GAP H: MODEL STALENESS DETECTION
    # =====================================================================

    def get_model_staleness(self):
        """
        Returns dict with model age and whether models should be retrained.
        Triggers auto-invalidation if Nifty moved >2% today (volatile regime).
        """
        model_dir = config.ML_CROSS_STOCK_MODEL_DIR
        result = {"model_age_hours": None, "stale": False, "reason": None,
                  "nifty_volatile": False, "nifty_move_pct": None}
        try:
            path = os.path.join(model_dir, "model_7d.pkl")
            if os.path.exists(path):
                age_h = (datetime.now() - datetime.fromtimestamp(os.path.getmtime(path))).total_seconds() / 3600
                result["model_age_hours"] = round(age_h, 1)
                if age_h > config.ML_CROSS_STOCK_MODEL_MAX_AGE_HOURS:
                    result["stale"] = True
                    result["reason"] = f"Model is {age_h:.1f}h old (max {config.ML_CROSS_STOCK_MODEL_MAX_AGE_HOURS}h)"

            # Check Nifty intraday move (Gap H: auto-invalidate on high volatility)
            nifty = self.get_nifty_data()
            if nifty is not None and len(nifty) >= 2:
                move = abs(float(nifty.iloc[-1]) - float(nifty.iloc[-2])) / float(nifty.iloc[-2]) * 100
                result["nifty_move_pct"] = round(move, 2)
                if move > 2.0:
                    result["nifty_volatile"] = True
                    # Invalidate in-memory model cache — force reload/retrain
                    with PricePredictor._cross_stock_lock:
                        PricePredictor._cross_stock_models = {}
                    if not result["stale"]:
                        result["stale"] = True
                        result["reason"] = f"Nifty moved {move:.1f}% — volatile regime, models invalidated"
        except Exception:
            pass
        return result

    def _load_cross_stock_models(self):
        """
        Load pretrained cross-stock models from disk if they exist and are fresh.
        Gap H: Also attaches model_age_hours to each bundle for frontend display.
        Returns dict {horizon: bundle} or {} if not available.
        """
        with PricePredictor._cross_stock_lock:
            if PricePredictor._cross_stock_models:
                return PricePredictor._cross_stock_models

            model_dir = config.ML_CROSS_STOCK_MODEL_DIR
            if not os.path.isdir(model_dir):
                return {}

            max_age = timedelta(hours=config.ML_CROSS_STOCK_MODEL_MAX_AGE_HOURS)
            loaded = {}
            for horizon in self.HORIZONS:
                path = os.path.join(model_dir, f"model_{horizon}d.pkl")
                if not os.path.exists(path):
                    continue
                mtime = os.path.getmtime(path)
                age   = datetime.now() - datetime.fromtimestamp(mtime)
                if age > max_age:
                    log.info(f"Cross-stock model {horizon}d is {age.total_seconds()/3600:.1f}h old — skipping (stale)")
                    continue
                try:
                    with open(path, "rb") as f:
                        bundle = pickle.load(f)
                    bundle["model_age_hours"] = round(age.total_seconds() / 3600, 1)
                    loaded[horizon] = bundle
                except Exception:
                    pass

            if loaded:
                PricePredictor._cross_stock_models = loaded
            return loaded

    def train_cross_stock_models(self, symbols=None):
        """
        Train one shared ML ensemble per horizon across all available cached stocks.

        Aggregates history_3y.pkl (or history_1y.pkl) for every symbol in the
        cache directory, builds a unified feature + target matrix, trains RF +
        GBM + MLP, evaluates on a chronological 20% hold-out, and saves each
        horizon model to ML_CROSS_STOCK_MODEL_DIR.

        Returns dict with training summary (samples, horizons trained, accuracy).
        """
        if not ML_AVAILABLE:
            return {"error": "sklearn not available"}

        import yfinance as yf

        cache_dir = config.CACHE_DIR
        model_dir = config.ML_CROSS_STOCK_MODEL_DIR
        os.makedirs(model_dir, exist_ok=True)

        # Discover all cached stock directories
        if symbols:
            stock_dirs = [s.replace(".", "_") for s in symbols]
        else:
            try:
                stock_dirs = [
                    d for d in os.listdir(cache_dir)
                    if os.path.isdir(os.path.join(cache_dir, d))
                    and d not in ("ml_cross_stock",)
                ]
            except Exception:
                return {"error": "Cannot list cache directory"}

        nifty_close = self.get_nifty_data()
        log.info(f"Cross-stock training: loading histories for {len(stock_dirs)} stocks...")

        all_X = {h: [] for h in self.HORIZONS}
        all_y = {h: [] for h in self.HORIZONS}
        loaded_count = 0

        for stock_key in stock_dirs:
            sd = os.path.join(cache_dir, stock_key)
            prices = None
            for fname in ("history_3y.pkl", "history_1y.pkl"):
                fpath = os.path.join(sd, fname)
                if os.path.exists(fpath):
                    try:
                        with open(fpath, "rb") as f:
                            prices = pickle.load(f)
                        break
                    except Exception:
                        pass

            if prices is None or prices.empty or len(prices) < 100:
                continue

            try:
                close  = prices["Close"].astype(float).dropna()
                high   = prices["High"].astype(float).dropna() if "High" in prices.columns else close
                low    = prices["Low"].astype(float).dropna() if "Low" in prices.columns else close
                volume = prices["Volume"].astype(float) if "Volume" in prices.columns else pd.Series(
                    np.ones(len(close)), index=close.index)

                if len(close) < 100:
                    continue

                feat_df = self._build_ml_features(close, high, low, volume, nifty_close)

                for horizon in self.HORIZONS:
                    fwd = (close.shift(-horizon) / close - 1) * 100
                    combined = feat_df.copy()
                    combined["target"] = fwd
                    combined = combined.dropna()
                    if len(combined) < 30:
                        continue
                    feature_cols = [c for c in combined.columns if c != "target"]
                    all_X[horizon].append(combined[feature_cols].values)
                    all_y[horizon].append(combined["target"].values)
                loaded_count += 1
            except Exception:
                continue

        log.info(f"Cross-stock training: loaded {loaded_count} stocks successfully")

        # Determine full feature col list once (all stocks share the same schema)
        sample_feat_df = self._build_ml_features(
            pd.Series([1.0] * 300), pd.Series([1.0] * 300),
            pd.Series([1.0] * 300), pd.Series([1.0] * 300), nifty_close,
        )
        all_feature_cols = list(sample_feat_df.columns)

        summary = {"stocks_used": loaded_count, "horizons": {}}
        trained_bundles = {}

        for horizon in self.HORIZONS:
            if not all_X[horizon]:
                log.warning(f"Cross-stock: no data for {horizon}d horizon, skipping")
                continue

            X_raw = np.vstack(all_X[horizon])
            y_raw = np.concatenate(all_y[horizon])
            total_samples = len(X_raw)

            if total_samples < 200:
                log.warning(f"Cross-stock: only {total_samples} samples for {horizon}d — skipping")
                continue

            log.info(f"Cross-stock training {horizon}d: {total_samples} samples from {loaded_count} stocks")

            # ── Gap 2: Walk-forward CV with 5 expanding windows ──────────────────
            # Window k: train on first (50 + k*10)% of data, validate on next 10%
            # Final reported accuracy = average across all 5 windows (honest estimate)
            wf_mae_list, wf_dir_list, wf_w5_list = [], [], []
            n = total_samples
            for fold in range(5):
                t_end = int(n * (0.50 + fold * 0.10))
                v_end = int(n * (0.60 + fold * 0.10))
                if t_end < 100 or v_end - t_end < 20:
                    continue
                Xtr_f, Xvl_f = X_raw[:t_end], X_raw[t_end:v_end]
                ytr_f, yvl_f = y_raw[:t_end], y_raw[t_end:v_end]
                sc_f = StandardScaler()
                Xtr_fs = sc_f.fit_transform(Xtr_f)
                Xvl_fs = sc_f.transform(Xvl_f)
                fold_preds_f = []
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    _cs_fold_mdls = [RandomForestRegressor(**self.RF_PARAMS)]
                    if LGBM_AVAILABLE:
                        _cs_fold_mdls.append(lgb.LGBMRegressor(**self.LGBM_PARAMS))
                    else:
                        _cs_fold_mdls.append(HistGradientBoostingRegressor(**self.HGB_PARAMS))
                    for mdl in _cs_fold_mdls:
                        try:
                            if LGBM_AVAILABLE and isinstance(mdl, lgb.LGBMRegressor):
                                mdl.fit(Xtr_fs, ytr_f, eval_set=[(Xvl_fs, yvl_f)],
                                        callbacks=[lgb.early_stopping(30, verbose=False),
                                                   lgb.log_evaluation(-1)])
                            else:
                                mdl.fit(Xtr_fs, ytr_f)
                            fold_preds_f.append(mdl.predict(Xvl_fs))
                        except Exception:
                            pass
                if fold_preds_f:
                    vp_f = np.mean(fold_preds_f, axis=0)
                    wf_mae_list.append(float(np.mean(np.abs(vp_f - yvl_f))))
                    nz_f = yvl_f != 0
                    wf_dir_list.append(
                        float(np.mean(np.sign(vp_f[nz_f]) == np.sign(yvl_f[nz_f]))) * 100
                        if nz_f.sum() > 0 else 50.0
                    )
                    wf_w5_list.append(float(np.mean(np.abs(vp_f - yvl_f) <= 5)) * 100)

            wf_mae = float(np.mean(wf_mae_list)) if wf_mae_list else 0.0
            wf_dir = float(np.mean(wf_dir_list)) if wf_dir_list else 50.0
            wf_w5  = float(np.mean(wf_w5_list))  if wf_w5_list  else 0.0
            log.info(f"Walk-forward CV {horizon}d: dir_acc={wf_dir:.1f}% mae={wf_mae:.3f}")

            # ── Final model: train on full data ──────────────────────────────────
            split_idx = int(total_samples * 0.8)
            X_train, X_val = X_raw[:split_idx], X_raw[split_idx:]
            y_train, y_val = y_raw[:split_idx], y_raw[split_idx:]

            scaler = StandardScaler()
            X_tr_s = scaler.fit_transform(X_train)
            X_va_s = scaler.transform(X_val)

            models = {}
            mae_scores = {}
            feature_importances = None  # Gap 8: populated by HGB

            with warnings.catch_warnings():
                warnings.simplefilter("ignore")

                try:
                    rf = RandomForestRegressor(**self.RF_PARAMS)
                    rf.fit(X_tr_s, y_train)
                    mae_scores["rf"] = float(np.mean(np.abs(rf.predict(X_va_s) - y_val)))
                    models["rf"] = rf
                except Exception as e:
                    log.warning(f"RF failed {horizon}d: {e}")

                try:
                    # LightGBM preferred; fall back to HistGBM if unavailable
                    if LGBM_AVAILABLE:
                        booster = lgb.LGBMRegressor(**self.LGBM_PARAMS)
                        booster.fit(X_tr_s, y_train,
                                    eval_set=[(X_va_s, y_val)],
                                    callbacks=[lgb.early_stopping(50, verbose=False),
                                               lgb.log_evaluation(-1)])
                        feature_importances = booster.feature_importances_
                    else:
                        booster = HistGradientBoostingRegressor(**self.HGB_PARAMS)
                        booster.fit(X_tr_s, y_train)
                        if hasattr(rf, "feature_importances_"):
                            feature_importances = rf.feature_importances_
                    mae_scores["lgbm"] = float(np.mean(np.abs(booster.predict(X_va_s) - y_val)))
                    models["lgbm"] = booster
                except Exception as e:
                    log.warning(f"LightGBM/HGB failed {horizon}d: {e}")
                    if hasattr(rf, "feature_importances_"):
                        feature_importances = rf.feature_importances_

                # XGBoost — additional ensemble member
                if XGBM_AVAILABLE:
                    try:
                        xgb_model = xgb.XGBRegressor(**self.XGBM_PARAMS)
                        xgb_model.fit(X_tr_s, y_train,
                                      eval_set=[(X_va_s, y_val)],
                                      early_stopping_rounds=50,
                                      verbose=False)
                        mae_scores["xgb"] = float(np.mean(np.abs(xgb_model.predict(X_va_s) - y_val)))
                        models["xgb"] = xgb_model
                    except Exception as e:
                        log.warning(f"XGBoost failed {horizon}d: {e}")

                try:
                    mlp = MLPRegressor(**self.MLP_PARAMS)
                    mlp.fit(X_tr_s, y_train)
                    mae_scores["mlp"] = float(np.mean(np.abs(mlp.predict(X_va_s) - y_val)))
                    models["mlp"] = mlp
                except Exception as e:
                    log.warning(f"MLP failed {horizon}d: {e}")

                # Gap 3: Direction classifier (HistGBM classifier)
                clf_bundle = None
                thresh = self.DIRECTION_THRESHOLD.get(horizon, 2.0)
                y_cls = np.where(y_train > thresh, 1, np.where(y_train < -thresh, 0, -1))
                mask_cls = y_cls != -1
                if mask_cls.sum() >= 100:
                    try:
                        if LGBM_AVAILABLE:
                            clf = lgb.LGBMClassifier(**self.LGBM_CLF_PARAMS)
                        else:
                            clf = HistGradientBoostingClassifier(**self.HGB_CLF_PARAMS)
                        clf.fit(X_tr_s[mask_cls], y_cls[mask_cls])
                        # Validate classifier
                        y_cls_val = np.where(y_val > thresh, 1, np.where(y_val < -thresh, 0, -1))
                        mask_val = y_cls_val != -1
                        if mask_val.sum() > 20:
                            # Gap E: Calibrate probabilities with Platt scaling
                            # Raw LightGBM probs are overconfident; calibration makes
                            # predict_proba(0.72) actually mean ~72% empirical accuracy
                            try:
                                calibrated = CalibratedClassifierCV(clf, method="sigmoid", cv="prefit")
                                calibrated.fit(X_va_s[mask_val], y_cls_val[mask_val])
                                clf_to_use = calibrated
                                log.info(f"Classifier {horizon}d: Platt scaling applied")
                            except Exception:
                                clf_to_use = clf  # fall back to uncalibrated
                            clf_pred = clf_to_use.predict(X_va_s[mask_val])
                            clf_acc  = float(np.mean(clf_pred == y_cls_val[mask_val])) * 100
                            clf_bundle = {"model": clf_to_use, "accuracy": round(clf_acc, 1),
                                          "calibrated": clf_to_use is not clf}
                            log.info(f"Classifier {horizon}d: accuracy={clf_acc:.1f}% on {mask_val.sum()} samples")
                    except Exception as e:
                        log.warning(f"Classifier failed {horizon}d: {e}")

            if not models:
                continue

            # ── Gap 8: Feature importance pruning ───────────────────────────────
            # Use RF importances to identify and flag low-importance features
            # (don't drop them from X — would break alignment — but save the mask)
            important_feature_mask = None
            important_feature_cols = all_feature_cols  # default: use all
            if feature_importances is not None and len(feature_importances) == len(all_feature_cols):
                max_imp = feature_importances.max()
                threshold_imp = max_imp * 0.01  # keep features with >1% of max importance
                important_mask = feature_importances >= threshold_imp
                kept = int(important_mask.sum())
                log.info(f"Feature pruning {horizon}d: keeping {kept}/{len(all_feature_cols)} features "
                         f"(dropping {len(all_feature_cols)-kept} low-importance features)")
                important_feature_mask = important_mask.tolist()
                important_feature_cols = [c for c, keep in zip(all_feature_cols, important_mask) if keep]

                # Retrain on pruned feature set if we actually removed features
                if kept < len(all_feature_cols) and kept >= 5:
                    X_tr_pruned = X_tr_s[:, important_mask]
                    X_va_pruned = X_va_s[:, important_mask]
                    pruned_models = {}
                    pruned_mae    = {}
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore")
                        _pruned_candidates = [("rf", RandomForestRegressor, self.RF_PARAMS)]
                        if LGBM_AVAILABLE:
                            _pruned_candidates.append(("lgbm", lgb.LGBMRegressor, self.LGBM_PARAMS))
                        else:
                            _pruned_candidates.append(("hgb", HistGradientBoostingRegressor, self.HGB_PARAMS))
                        for name, cls_type, params in _pruned_candidates:
                            try:
                                m = cls_type(**params)
                                m.fit(X_tr_pruned, y_train)
                                pruned_mae[name] = float(np.mean(np.abs(m.predict(X_va_pruned) - y_val)))
                                pruned_models[name] = m
                            except Exception:
                                pass
                    # Use pruned models only if they're better
                    if pruned_models:
                        avg_pruned = np.mean(list(pruned_mae.values()))
                        avg_full   = np.mean([mae_scores[k] for k in pruned_mae if k in mae_scores])
                        if avg_pruned <= avg_full * 1.02:  # accept pruned if ≤2% worse
                            models.update(pruned_models)
                            mae_scores.update(pruned_mae)
                            scaler_pruned = StandardScaler()
                            scaler_pruned.fit(X_raw[:split_idx][:, important_mask])
                            scaler = scaler_pruned  # swap scaler to pruned version
                            log.info(f"Using pruned feature set for {horizon}d (mae {avg_pruned:.3f} vs {avg_full:.3f})")

            inv_mae = {k: 1.0 / (v + 1e-6) for k, v in mae_scores.items()}
            total_w = sum(inv_mae.values())
            weights = {k: v / total_w for k, v in inv_mae.items()}

            # Final validation metrics (on held-out 20%)
            val_ensemble = sum(models[name].predict(X_va_s[:, important_feature_mask] if important_feature_mask else X_va_s) * weights[name]
                               for name in models if name in weights)
            val_mae   = float(np.mean(np.abs(val_ensemble - y_val)))
            nz_v = y_val != 0
            dir_acc  = float(np.mean(np.sign(val_ensemble[nz_v]) == np.sign(y_val[nz_v]))) * 100 if nz_v.sum() > 0 else 50.0
            within_5 = float(np.mean(np.abs(val_ensemble - y_val) <= 5)) * 100

            bundle = {
                "models":               models,
                "scaler":               scaler,
                "weights":              weights,
                "feature_cols":         important_feature_cols,
                "feature_mask":         important_feature_mask,
                "all_feature_cols":     all_feature_cols,
                "classifier":           clf_bundle,
                # Use walk-forward accuracy (honest) as the primary metric
                "val_mae":              round(wf_mae if wf_mae else val_mae, 3),
                "val_dir_acc":          round(wf_dir if wf_dir else dir_acc, 1),
                "val_within_5pct":      round(wf_w5  if wf_w5  else within_5, 1),
                "val_n":                len(y_val),
                "wf_folds":             len(wf_mae_list),
                "trained_at":           datetime.now().isoformat(),
                "stocks_used":          loaded_count,
                "total_samples":        total_samples,
            }
            trained_bundles[horizon] = bundle
            summary["horizons"][horizon] = {
                "samples":        total_samples,
                "val_mae":        bundle["val_mae"],
                "val_dir_acc":    bundle["val_dir_acc"],
                "val_within_5pct":bundle["val_within_5pct"],
                "wf_folds":       bundle["wf_folds"],
                "classifier_acc": clf_bundle["accuracy"] if clf_bundle else None,
                "features_used":  len(important_feature_cols),
            }

            model_path = os.path.join(model_dir, f"model_{horizon}d.pkl")
            try:
                with open(model_path, "wb") as f:
                    pickle.dump(bundle, f)
                log.info(
                    f"Cross-stock model saved: {horizon}d | {total_samples} samples | "
                    f"wf_dir={wf_dir:.1f}% | wf_mae={wf_mae:.3f} | "
                    f"features={len(important_feature_cols)}"
                )
            except Exception as e:
                log.warning(f"Failed to save cross-stock model {horizon}d: {e}")

        # Update in-memory cache
        with PricePredictor._cross_stock_lock:
            PricePredictor._cross_stock_models = trained_bundles

        # ── Gap B: Sector-specific models ────────────────────────────────────
        # Train a separate RF+LightGBM ensemble per major sector.
        # More relevant than global model for sector-specific patterns (IT momentum,
        # Pharma regulatory cycles, FMCG defensive behaviour, etc.).
        # Falls back to global model for small sectors (< 15 stocks).
        import csv
        comp_path = os.path.join(config.DATA_DIR, "composite_ranked.csv")
        sector_dir_map = {}  # {stock_dir_key: sector}
        try:
            with open(comp_path, "r") as _cf:
                for _row in csv.DictReader(_cf):
                    sym_key = str(_row.get("symbol", "")).strip().replace(".", "_")
                    sec     = str(_row.get("sector", "")).strip()
                    if sym_key and sec and sec.upper() not in ("", "N/A", "NONE"):
                        sector_dir_map[sym_key] = sec
            log.info(f"Sector training: {len(sector_dir_map)} symbols across "
                     f"{len(set(sector_dir_map.values()))} sectors")
        except Exception as _se:
            log.warning(f"Could not load sector map for sector training: {_se}")

        if sector_dir_map:
            # Group stock_dirs by sector
            sector_groups: dict = {}
            for _sd in stock_dirs:
                _sec = sector_dir_map.get(_sd)
                if _sec:
                    sector_groups.setdefault(_sec, []).append(_sd)

            for _sector, _s_dirs in sector_groups.items():
                if len(_s_dirs) < 15:  # need at least 15 stocks for meaningful sector model
                    continue
                _safe = _sector.replace(" ", "_").replace("/", "_")[:20]
                _sX = {h: [] for h in self.HORIZONS}
                _sy = {h: [] for h in self.HORIZONS}
                _s_loaded = 0

                for _sd in _s_dirs:
                    _d = os.path.join(cache_dir, _sd)
                    _prices = None
                    for _fn in ("history_3y.pkl", "history_1y.pkl"):
                        _fp = os.path.join(_d, _fn)
                        if os.path.exists(_fp):
                            try:
                                with open(_fp, "rb") as _f:
                                    _prices = pickle.load(_f)
                                break
                            except Exception:
                                pass
                    if _prices is None or _prices.empty or len(_prices) < 100:
                        continue
                    try:
                        _cl  = _prices["Close"].astype(float).dropna()
                        _hi  = _prices["High"].astype(float).dropna() if "High" in _prices.columns else _cl
                        _lo  = _prices["Low"].astype(float).dropna() if "Low" in _prices.columns else _cl
                        _vol = (_prices["Volume"].astype(float) if "Volume" in _prices.columns
                                else pd.Series(np.ones(len(_cl)), index=_cl.index))
                        if len(_cl) < 100:
                            continue
                        _fdf = self._build_ml_features(_cl, _hi, _lo, _vol, nifty_close)
                        for _h in self.HORIZONS:
                            _fwd = (_cl.shift(-_h) / _cl - 1) * 100
                            _comb = _fdf.copy()
                            _comb["target"] = _fwd
                            _comb = _comb.dropna()
                            if len(_comb) < 30:
                                continue
                            _fcols = [c for c in _comb.columns if c != "target"]
                            _sX[_h].append(_comb[_fcols].values)
                            _sy[_h].append(_comb["target"].values)
                        _s_loaded += 1
                    except Exception:
                        continue

                for _h in self.HORIZONS:
                    if not _sX[_h]:
                        continue
                    _Xs = np.vstack(_sX[_h])
                    _ys = np.concatenate(_sy[_h])
                    if len(_Xs) < 500:
                        continue  # too few samples for a reliable sector model

                    _split = int(len(_Xs) * 0.8)
                    _sc_s = StandardScaler()
                    _Xtr = _sc_s.fit_transform(_Xs[:_split])
                    _Xva = _sc_s.transform(_Xs[_split:])
                    _ytr = _ys[:_split]
                    _yva = _ys[_split:]

                    _s_models, _s_mae = {}, {}
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore")
                        try:
                            _rf_s = RandomForestRegressor(**self.RF_PARAMS)
                            _rf_s.fit(_Xtr, _ytr)
                            _s_mae["rf"] = float(np.mean(np.abs(_rf_s.predict(_Xva) - _yva)))
                            _s_models["rf"] = _rf_s
                        except Exception:
                            pass
                        try:
                            if LGBM_AVAILABLE:
                                _b_s = lgb.LGBMRegressor(**self.LGBM_PARAMS)
                                _b_s.fit(_Xtr, _ytr, eval_set=[(_Xva, _yva)],
                                         callbacks=[lgb.early_stopping(30, verbose=False),
                                                    lgb.log_evaluation(-1)])
                            else:
                                _b_s = HistGradientBoostingRegressor(**self.HGB_PARAMS)
                                _b_s.fit(_Xtr, _ytr)
                            _s_mae["lgbm"] = float(np.mean(np.abs(_b_s.predict(_Xva) - _yva)))
                            _s_models["lgbm"] = _b_s
                        except Exception:
                            pass

                    if not _s_models:
                        continue

                    _inv = {k: 1.0 / (v + 1e-6) for k, v in _s_mae.items()}
                    _tot = sum(_inv.values())
                    _s_w = {k: v / _tot for k, v in _inv.items()}
                    _ens_s = sum(_s_models[k].predict(_Xva) * _s_w[k] for k in _s_models if k in _s_w)
                    _nz_s  = _yva != 0
                    _dir_s = (float(np.mean(np.sign(_ens_s[_nz_s]) == np.sign(_yva[_nz_s]))) * 100
                              if _nz_s.sum() > 0 else 50.0)
                    _mae_s = float(np.mean(np.abs(_ens_s - _yva)))
                    _w5_s  = float(np.mean(np.abs(_ens_s - _yva) <= 5)) * 100

                    _s_bundle = {
                        "models": _s_models, "scaler": _sc_s, "weights": _s_w,
                        "feature_cols": all_feature_cols, "feature_mask": None,
                        "all_feature_cols": all_feature_cols, "classifier": None,
                        "val_mae": round(_mae_s, 3), "val_dir_acc": round(_dir_s, 1),
                        "val_within_5pct": round(_w5_s, 1), "val_n": len(_yva),
                        "sector": _sector, "stocks_used": _s_loaded,
                        "total_samples": len(_Xs), "trained_at": datetime.now().isoformat(),
                    }
                    _sp = os.path.join(model_dir, f"model_{_h}d_{_safe}.pkl")
                    try:
                        with open(_sp, "wb") as _f:
                            pickle.dump(_s_bundle, _f)
                        log.info(f"Sector model saved: {_sector} {_h}d | {_s_loaded} stocks | "
                                 f"{len(_Xs)} samples | dir={_dir_s:.1f}%")
                        summary.setdefault("sector_models", {})[f"{_sector}_{_h}d"] = {
                            "stocks": _s_loaded, "samples": len(_Xs),
                            "val_dir_acc": round(_dir_s, 1), "val_mae": round(_mae_s, 3),
                        }
                    except Exception as _e:
                        log.warning(f"Failed to save sector model {_sector} {_h}d: {_e}")

            # Clear sector model cache so next prediction loads fresh models
            with PricePredictor._sector_lock:
                PricePredictor._sector_models = {}

        return summary

    # =====================================================================
    # GAP B: SECTOR MODEL LOADING & SYMBOL→SECTOR LOOKUP
    # =====================================================================

    def _load_sector_models(self):
        """
        Load sector-specific pretrained models from disk.
        Pattern: model_{horizon}d_{SafeSectorName}.pkl
        Returns {sector: {horizon: bundle}} dict.
        Cached in-memory until invalidated by train_cross_stock_models().
        """
        with PricePredictor._sector_lock:
            if PricePredictor._sector_models:
                return PricePredictor._sector_models

            model_dir = config.ML_CROSS_STOCK_MODEL_DIR
            if not os.path.isdir(model_dir):
                return {}

            max_age = timedelta(hours=config.ML_CROSS_STOCK_MODEL_MAX_AGE_HOURS)
            loaded: dict = {}
            try:
                for fname in os.listdir(model_dir):
                    if not fname.startswith("model_") or not fname.endswith(".pkl"):
                        continue
                    # Strip "model_" prefix and ".pkl" suffix → e.g. "7d_Information_Technology"
                    inner = fname[6:-4]
                    # Split on first "_" after the horizon part "Nd_"
                    under = inner.find("d_")
                    if under == -1:
                        continue  # global model (no sector suffix)
                    try:
                        horizon = int(inner[:under])
                    except ValueError:
                        continue
                    if horizon not in self.HORIZONS:
                        continue
                    sector_safe = inner[under + 2:]  # everything after "d_"
                    if not sector_safe:
                        continue

                    path = os.path.join(model_dir, fname)
                    age  = datetime.now() - datetime.fromtimestamp(os.path.getmtime(path))
                    if age > max_age:
                        continue
                    try:
                        with open(path, "rb") as f:
                            bundle = pickle.load(f)
                        # Use the sector name stored inside the bundle (original, not safe version)
                        sector_key = bundle.get("sector", sector_safe)
                        if sector_key not in loaded:
                            loaded[sector_key] = {}
                        loaded[sector_key][horizon] = bundle
                    except Exception:
                        pass
            except Exception:
                pass

            if loaded:
                PricePredictor._sector_models = loaded
            return loaded

    def _get_stock_sector(self, symbol):
        """
        Return sector string for a symbol, or None if unknown.
        Loads composite_ranked.csv lazily and caches in _sector_map.
        """
        # Normalize to the directory key format (e.g. "RELIANCE.NS" → "RELIANCE_NS")
        sym_key = symbol.replace(".", "_")
        with PricePredictor._sector_map_lock:
            if PricePredictor._sector_map:
                return PricePredictor._sector_map.get(sym_key)
            # Load once from composite_ranked.csv
            try:
                import csv
                comp_path = os.path.join(config.DATA_DIR, "composite_ranked.csv")
                _m: dict = {}
                with open(comp_path, "r") as f:
                    for row in csv.DictReader(f):
                        s  = str(row.get("symbol", "")).strip().replace(".", "_")
                        sc = str(row.get("sector", "")).strip()
                        if s and sc and sc.upper() not in ("", "N/A", "NONE"):
                            _m[s] = sc
                PricePredictor._sector_map = _m
                return _m.get(sym_key)
            except Exception:
                PricePredictor._sector_map = {}
                return None
