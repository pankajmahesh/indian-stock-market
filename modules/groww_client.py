"""
Groww Client — Direct HTTP client for the Groww Trade API.
Provides real-time quotes, batch LTP, OHLC, and historical candle data.

Auth: Bearer token generated at groww.in/user/profile/trading-apis
Token expires daily at 6:00 AM IST.
"""
from datetime import datetime, timedelta

import requests
import pandas as pd

import config
from utils.logger import log


class GrowwClient:

    def __init__(self, token=None):
        self.base = config.GROWW_API_URL.rstrip("/")
        self.token = token or config.GROWW_API_TOKEN
        self.exchange = config.GROWW_EXCHANGE
        self.segment = config.GROWW_SEGMENT
        self.timeout = 15

    def _headers(self):
        return {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/json",
            "X-API-VERSION": "1.0",
        }

    def _get(self, path, params=None):
        if not self.token:
            return None
        try:
            r = requests.get(
                f"{self.base}{path}",
                params=params,
                headers=self._headers(),
                timeout=self.timeout,
            )
            r.raise_for_status()
            data = r.json()
            if data.get("status") == "FAILURE":
                log.warning("Groww API error on %s: %s", path, data)
                return None
            return data.get("payload", data)
        except requests.exceptions.ConnectionError:
            log.warning("Groww API not reachable")
            return None
        except requests.exceptions.HTTPError as e:
            if e.response is not None and e.response.status_code == 401:
                log.warning("Groww API token expired or invalid")
            else:
                log.warning("Groww API HTTP error on %s: %s", path, e)
            return None
        except Exception as e:
            log.warning("Groww client error on %s: %s", path, e)
            return None

    # ── availability ─────────────────────────────────────────────
    def is_available(self):
        """Check if Groww API is configured and reachable."""
        if not self.token:
            return False
        # Quick check with a single LTP call
        result = self.get_ltp(["RELIANCE"])
        return result is not None

    # ── quotes ───────────────────────────────────────────────────
    def get_quote(self, symbol):
        """Full quote for a single symbol."""
        return self._get("/live-data/quote", params={
            "exchange": self.exchange,
            "segment": self.segment,
            "trading_symbol": symbol,
        })

    def get_ltp(self, symbols):
        """
        Batch LTP for up to 50 symbols.
        symbols: list of NSE symbols like ["TCS", "RELIANCE"]
        Returns dict mapping symbol → price.
        """
        if not symbols:
            return {}
        exchange_symbols = [f"{self.exchange}_{s}" for s in symbols[:50]]
        data = self._get("/live-data/ltp", params={
            "segment": self.segment,
            "exchange_symbols": ",".join(exchange_symbols),
        })
        if not data:
            return {}
        # Normalize response: extract symbol → ltp mapping
        result = {}
        if isinstance(data, dict):
            for key, val in data.items():
                # key might be "NSE_TCS", extract symbol after _
                sym = key.split("_", 1)[-1] if "_" in key else key
                if isinstance(val, dict):
                    result[sym] = val.get("ltp") or val.get("last_traded_price")
                else:
                    result[sym] = val
        return result

    def get_ohlc(self, symbols):
        """
        Batch OHLC snapshot for up to 50 symbols.
        Returns dict mapping symbol → {open, high, low, close}.
        """
        if not symbols:
            return {}
        exchange_symbols = [f"{self.exchange}_{s}" for s in symbols[:50]]
        data = self._get("/live-data/ohlc", params={
            "segment": self.segment,
            "exchange_symbols": ",".join(exchange_symbols),
        })
        if not data:
            return {}
        result = {}
        if isinstance(data, dict):
            for key, val in data.items():
                sym = key.split("_", 1)[-1] if "_" in key else key
                result[sym] = val
        return result

    # ── historical candles ───────────────────────────────────────
    def get_historical_candles(self, symbol, interval_minutes=1440, days=365):
        """
        Fetch historical OHLCV candle data.

        interval_minutes:
            1    → 1-min candles (max 7 days, last 3 months)
            5    → 5-min candles (max 15 days, last 3 months)
            60   → 1-hour candles (max 150 days, last 3 months)
            1440 → daily candles (max 1080 days)
        days: how many days back from today
        """
        end = datetime.now()
        start = end - timedelta(days=days)
        params = {
            "exchange": self.exchange,
            "segment": self.segment,
            "trading_symbol": symbol,
            "start_time": start.strftime("%Y-%m-%d %H:%M:%S"),
            "end_time": end.strftime("%Y-%m-%d %H:%M:%S"),
            "interval_in_minutes": interval_minutes,
        }
        return self._get("/historical/candle/range", params=params)

    # ── data conversion ──────────────────────────────────────────
    def candles_to_dataframe(self, candle_data):
        """
        Convert Groww candle response to pandas DataFrame with columns
        [Open, High, Low, Close, Volume] + DatetimeIndex.
        Matches yfinance output format.

        Groww candle format: [timestamp, open, high, low, close, volume]
        """
        if not candle_data:
            return pd.DataFrame()

        # Handle nested payload structures
        candles = candle_data
        if isinstance(candle_data, dict):
            candles = candle_data.get("candles") or candle_data.get("data") or []

        if not candles or not isinstance(candles, list):
            return pd.DataFrame()

        rows = []
        for c in candles:
            if not isinstance(c, (list, tuple)) or len(c) < 5:
                continue
            ts, o, h, l, cl = c[0], c[1], c[2], c[3], c[4]
            vol = c[5] if len(c) > 5 else 0
            # ts can be epoch seconds or epoch millis
            try:
                if isinstance(ts, (int, float)):
                    if ts > 1e12:
                        ts = ts / 1000
                    dt = datetime.fromtimestamp(ts)
                else:
                    dt = pd.to_datetime(ts)
            except Exception:
                continue
            rows.append({
                "Date": dt, "Open": o, "High": h, "Low": l,
                "Close": cl, "Volume": vol,
            })

        if not rows:
            return pd.DataFrame()

        df = pd.DataFrame(rows)
        for col in ["Open", "High", "Low", "Close", "Volume"]:
            df[col] = pd.to_numeric(df[col], errors="coerce")
        df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
        df = df.dropna(subset=["Date", "Close"])
        df = df.set_index("Date").sort_index()
        return df
