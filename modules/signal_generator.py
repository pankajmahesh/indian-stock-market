"""
Signal Generator — Adapted from AI-Stock-Trader
Generates BUY/SELL/HOLD signals using combined momentum strategy:
  - RSI + StochRSI combined momentum confirmation
  - MACD crossover signals
  - Take profit and stop-loss levels
"""
import os

import numpy as np
import pandas as pd
import ta

import config
from modules.data_fetcher import DataFetcher
from utils.logger import log


class SignalGenerator:
    def __init__(self, data_fetcher: DataFetcher = None):
        self.fetcher = data_fetcher
        self.cfg = config.SIGNAL_STRATEGY

    def _get_market_regime(self):
        """Load cached market regime from data dir. Returns None if unavailable."""
        try:
            import json
            path = os.path.join(config.DATA_DIR, "market_condition.json")
            if os.path.exists(path):
                with open(path) as f:
                    mc = json.load(f)
                return mc.get("regime")
        except Exception:
            pass
        return None

    def generate(self, stocks_df):
        """
        Generate trading signals for all stocks.
        Returns DataFrame with signal columns added.
        """
        log.info("=" * 60)
        log.info("SIGNAL GENERATION (AI-Stock-Trader Strategy)")
        log.info("=" * 60)

        # Market regime gate (Minervini rule: never buy in a downtrend)
        regime = self._get_market_regime()
        bear_market = regime in ("BEAR", "STRONG_BEAR")
        if bear_market:
            log.warning(f"Market regime: {regime} — BUY signals will be downgraded to HOLD")
        elif regime:
            log.info(f"Market regime: {regime}")

        symbols = stocks_df["symbol"].tolist()
        all_prices = self.fetcher.batch_download_prices(symbols)

        results = []
        signals_summary = {"BUY": 0, "SELL": 0, "HOLD": 0, "NO_DATA": 0}

        for _, row in stocks_df.iterrows():
            sym = row["symbol"]
            prices = all_prices.get(sym)

            if prices is None or prices.empty or len(prices) < 30:
                results.append({
                    **row.to_dict(),
                    "signal": "NO_DATA",
                    "signal_strength": 0,
                    "rsi_value": None,
                    "stochrsi_k": None,
                    "stochrsi_d": None,
                    "macd_value": None,
                    "macd_signal_line": None,
                    "macd_histogram": None,
                    "take_profit_price": None,
                    "stop_loss_price": None,
                    "signal_details": "",
                })
                signals_summary["NO_DATA"] += 1
                continue

            signal_data = self._analyze_stock(prices, row.get("last_price"))

            # Market regime gate: suppress BUY in bear markets
            if bear_market and signal_data["signal"] == "BUY":
                signal_data["signal"] = "HOLD"
                signal_data["signal_details"] = (
                    f"[{regime} — regime gate] " + (signal_data.get("signal_details") or "")
                ).strip()

            results.append({**row.to_dict(), **signal_data})
            signals_summary[signal_data["signal"]] += 1

        result_df = pd.DataFrame(results)

        log.info(f"Signal summary: {signals_summary}")

        out_path = os.path.join(config.DATA_DIR, "signals.csv")
        result_df.to_csv(out_path, index=False)
        log.info(f"Saved to {out_path}")

        return result_df

    def _compute_vwap(self, prices, period=20):
        """Compute rolling VWAP."""
        try:
            high = prices["High"].astype(float)
            low = prices["Low"].astype(float)
            close = prices["Close"].astype(float)
            volume = prices["Volume"].astype(float)
            tp = (high + low + close) / 3
            vwap = (tp * volume).rolling(window=period).sum() / volume.rolling(window=period).sum()
            val = float(vwap.iloc[-1])
            return round(val, 2) if not (val != val) else None  # NaN check
        except Exception:
            return None

    def _compute_supertrend(self, prices, period=10, multiplier=3.0):
        """Compute Supertrend. Returns (value, signal_str)."""
        try:
            high = prices["High"].astype(float)
            low = prices["Low"].astype(float)
            close = prices["Close"].astype(float)
            n = len(close)
            if n < period + 1:
                return None, None

            tr = pd.concat([high - low, (high - close.shift(1)).abs(), (low - close.shift(1)).abs()], axis=1).max(axis=1)
            atr = tr.rolling(window=period).mean()
            hl2 = (high + low) / 2
            ub = hl2 + multiplier * atr
            lb = hl2 - multiplier * atr
            upper_band, lower_band = ub.copy(), lb.copy()
            direction = pd.Series(index=close.index, dtype=int)

            for i in range(period, n):
                if i == period:
                    direction.iloc[i] = -1 if close.iloc[i] > ub.iloc[i] else 1
                else:
                    upper_band.iloc[i] = ub.iloc[i] if (ub.iloc[i] < upper_band.iloc[i-1] or close.iloc[i-1] > upper_band.iloc[i-1]) else upper_band.iloc[i-1]
                    lower_band.iloc[i] = lb.iloc[i] if (lb.iloc[i] > lower_band.iloc[i-1] or close.iloc[i-1] < lower_band.iloc[i-1]) else lower_band.iloc[i-1]
                    if direction.iloc[i-1] == 1:
                        direction.iloc[i] = -1 if close.iloc[i] > upper_band.iloc[i] else 1
                    else:
                        direction.iloc[i] = 1 if close.iloc[i] < lower_band.iloc[i] else -1

            st_val = lower_band.iloc[-1] if direction.iloc[-1] == -1 else upper_band.iloc[-1]
            st_val = round(float(st_val), 2) if not (float(st_val) != float(st_val)) else None
            return st_val, ("BUY" if direction.iloc[-1] == -1 else "SELL")
        except Exception:
            return None, None

    def _analyze_stock(self, prices, cmp):
        """Analyze a single stock using the combined momentum strategy."""
        close = prices["Close"].astype(float)
        high = prices["High"].astype(float) if "High" in prices else close
        low = prices["Low"].astype(float) if "Low" in prices else close

        # Calculate indicators
        indicators = self._calculate_indicators(close)

        if indicators is None:
            return self._empty_signal()

        # VWAP and Supertrend
        vwap = self._compute_vwap(prices)
        st_value, st_signal = self._compute_supertrend(prices)

        # Generate signal using AI-Stock-Trader logic + VWAP/Supertrend
        signal, strength, details = self._evaluate_signal(indicators, vwap=vwap, st_signal=st_signal, cmp=cmp or float(close.iloc[-1]))

        # Calculate TP/SL levels
        current_price = cmp or close.iloc[-1]
        tp = round(current_price * (1 + self.cfg["take_profit_pct"] / 100), 2)
        sl = round(current_price * (1 - self.cfg["stop_loss_pct"] / 100), 2)

        return {
            "signal": signal,
            "signal_strength": strength,
            "rsi_value": round(indicators["rsi"], 2),
            "stochrsi_k": round(indicators["stochrsi_k"], 2),
            "stochrsi_d": round(indicators["stochrsi_d"], 2),
            "macd_value": round(indicators["macd"], 4),
            "macd_signal_line": round(indicators["macd_signal"], 4),
            "macd_histogram": round(indicators["macd_hist"], 4),
            "vwap": vwap,
            "supertrend": st_value,
            "supertrend_signal": st_signal,
            "take_profit_price": tp if signal == "BUY" else None,
            "stop_loss_price": sl if signal == "BUY" else None,
            "signal_details": details,
        }

    def _calculate_indicators(self, close):
        """Calculate RSI, StochRSI, and MACD indicators."""
        try:
            # RSI
            rsi_ind = ta.momentum.RSIIndicator(close, window=self.cfg["rsi_period"])
            rsi_series = rsi_ind.rsi()

            # StochRSI
            stoch_ind = ta.momentum.StochRSIIndicator(
                close,
                window=self.cfg["stochrsi_period"],
                smooth1=self.cfg["stochrsi_smooth_k"],
                smooth2=self.cfg["stochrsi_smooth_d"],
            )
            stochrsi_k = stoch_ind.stochrsi_k() * 100
            stochrsi_d = stoch_ind.stochrsi_d() * 100

            # MACD
            macd_ind = ta.trend.MACD(
                close,
                window_fast=self.cfg["macd_fast"],
                window_slow=self.cfg["macd_slow"],
                window_sign=self.cfg["macd_signal"],
            )
            macd_line = macd_ind.macd()
            macd_signal = macd_ind.macd_signal()
            macd_hist = macd_ind.macd_diff()

            # Get current and previous values
            if len(rsi_series.dropna()) < 2 or len(stochrsi_k.dropna()) < 2:
                return None

            return {
                "rsi": rsi_series.iloc[-1],
                "rsi_prev": rsi_series.iloc[-2],
                "stochrsi_k": stochrsi_k.iloc[-1],
                "stochrsi_k_prev": stochrsi_k.iloc[-2],
                "stochrsi_d": stochrsi_d.iloc[-1],
                "macd": macd_line.iloc[-1],
                "macd_prev": macd_line.iloc[-2],
                "macd_signal": macd_signal.iloc[-1],
                "macd_signal_prev": macd_signal.iloc[-2],
                "macd_hist": macd_hist.iloc[-1],
            }
        except Exception as e:
            log.warning(f"Indicator calculation error: {e}")
            return None

    def _evaluate_signal(self, ind, vwap=None, st_signal=None, cmp=None):
        """
        Evaluate buy/sell/hold using AI-Stock-Trader combined strategy + VWAP & Supertrend.

        BUY when EITHER:
          1. StochRSI increasing + RSI increasing + both below overbought
          2. MACD crosses above signal line
          3. Price above VWAP (confirmation)
          4. Supertrend in BUY mode (confirmation)

        SELL when EITHER:
          1. StochRSI decreasing + RSI decreasing + both above oversold
          2. MACD crosses below signal line
          3. Price below VWAP (confirmation)
          4. Supertrend in SELL mode (confirmation)
        """
        buy_signals = []
        sell_signals = []
        strength = 0

        # --- Combined Momentum Confirmation ---
        stochrsi_increasing = ind["stochrsi_k"] > ind["stochrsi_k_prev"]
        rsi_increasing = ind["rsi"] > ind["rsi_prev"]
        stochrsi_below_ob = ind["stochrsi_k"] < self.cfg["stochrsi_overbought"]
        rsi_below_ob = ind["rsi"] < self.cfg["rsi_overbought"]

        stochrsi_decreasing = ind["stochrsi_k"] < ind["stochrsi_k_prev"]
        rsi_decreasing = ind["rsi"] < ind["rsi_prev"]
        stochrsi_above_os = ind["stochrsi_k"] > self.cfg["stochrsi_oversold"]
        rsi_above_os = ind["rsi"] > self.cfg["rsi_oversold"]

        if stochrsi_increasing and rsi_increasing and stochrsi_below_ob and rsi_below_ob:
            buy_signals.append("Momentum rising (RSI+StochRSI)")
            strength += 3

        if stochrsi_decreasing and rsi_decreasing and stochrsi_above_os and rsi_above_os:
            sell_signals.append("Momentum falling (RSI+StochRSI)")
            strength -= 3

        # --- MACD Crossover ---
        macd_cross_up = (ind["macd"] > ind["macd_signal"] and
                         ind["macd_prev"] <= ind["macd_signal_prev"])
        macd_cross_down = (ind["macd"] < ind["macd_signal"] and
                           ind["macd_prev"] >= ind["macd_signal_prev"])

        if macd_cross_up:
            buy_signals.append("MACD bullish crossover")
            strength += 2

        if macd_cross_down:
            sell_signals.append("MACD bearish crossover")
            strength -= 2

        # --- Additional context signals ---
        # RSI zone bonus
        if ind["rsi"] < 35:
            buy_signals.append("RSI oversold zone")
            strength += 1
        elif ind["rsi"] > 65:
            sell_signals.append("RSI overbought zone")
            strength -= 1

        # MACD histogram expansion
        if ind["macd_hist"] > 0 and ind["macd"] > ind["macd_signal"]:
            buy_signals.append("MACD histogram positive")
            strength += 1
        elif ind["macd_hist"] < 0 and ind["macd"] < ind["macd_signal"]:
            sell_signals.append("MACD histogram negative")
            strength -= 1

        # VWAP confirmation
        if vwap and cmp:
            if cmp > vwap:
                buy_signals.append("Price above VWAP")
                strength += 1
            elif cmp < vwap:
                sell_signals.append("Price below VWAP")
                strength -= 1

        # Supertrend confirmation
        if st_signal == "BUY":
            buy_signals.append("Supertrend BUY")
            strength += 1
        elif st_signal == "SELL":
            sell_signals.append("Supertrend SELL")
            strength -= 1

        # Determine final signal
        if strength >= 3:
            signal = "BUY"
            details = " | ".join(buy_signals)
        elif strength <= -3:
            signal = "SELL"
            details = " | ".join(sell_signals)
        else:
            signal = "HOLD"
            all_details = buy_signals + sell_signals
            details = " | ".join(all_details) if all_details else "No strong signal"

        return signal, strength, details

    def _empty_signal(self):
        return {
            "signal": "NO_DATA",
            "signal_strength": 0,
            "rsi_value": None,
            "stochrsi_k": None,
            "stochrsi_d": None,
            "macd_value": None,
            "macd_signal_line": None,
            "macd_histogram": None,
            "take_profit_price": None,
            "stop_loss_price": None,
            "signal_details": "",
        }
