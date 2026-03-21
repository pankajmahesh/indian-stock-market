"""
NSE Client — HTTP bridge to the Node.js NSE proxy server.
Fetches real-time NSE data via the stock-market-india npm package.
"""
from datetime import datetime

import requests
import pandas as pd

import config
from utils.logger import log


class NSEClient:

    def __init__(self, base_url=None):
        self.base = (base_url or config.NSE_PROXY_URL).rstrip("/")
        self.timeout = config.NSE_PROXY_TIMEOUT

    def _get(self, path, params=None):
        """GET request to the NSE proxy with error handling."""
        try:
            r = requests.get(f"{self.base}{path}", params=params, timeout=self.timeout)
            r.raise_for_status()
            data = r.json()
            if isinstance(data, dict) and "error" in data:
                log.warning("NSE proxy error on %s: %s", path, data["error"])
                return None
            return data
        except requests.exceptions.ConnectionError:
            log.warning("NSE proxy not reachable at %s", self.base)
            return None
        except Exception as e:
            log.warning("NSE client error on %s: %s", path, e)
            return None

    # ── availability ────────────────────────────────────────────
    def is_available(self):
        """Check if the NSE proxy is running."""
        return self._get("/health") is not None

    # ── quotes ──────────────────────────────────────────────────
    def get_quote(self, symbol):
        """Real-time quote for a single symbol (without .NS)."""
        return self._get(f"/nse/quote/{symbol}")

    def get_quotes(self, symbols):
        """Real-time quotes for multiple symbols."""
        return self._get("/nse/quotes", params={"symbols": ",".join(symbols)})

    # ── chart / OHLC history ────────────────────────────────────
    def get_chart_data(self, symbol, time="year"):
        """OHLC history.  time: 1,5,15,30,60,'week','month','year'."""
        return self._get(f"/nse/chart/{symbol}", params={"time": time})

    def get_intraday(self, symbol, time=5):
        """Intraday candle data."""
        return self._get(f"/nse/intraday/{symbol}", params={"time": time})

    # ── market movers ───────────────────────────────────────────
    def get_gainers(self):
        return self._get("/nse/gainers")

    def get_losers(self):
        return self._get("/nse/losers")

    def get_52w_high(self):
        return self._get("/nse/52w-high")

    def get_52w_low(self):
        return self._get("/nse/52w-low")

    def get_top_volume(self):
        return self._get("/nse/top-volume")

    def get_top_value(self):
        return self._get("/nse/top-value")

    def get_market_status(self):
        return self._get("/nse/market-status")

    def get_index_stocks(self, slug):
        return self._get(f"/nse/index-stocks/{slug}")

    # ── data conversion ─────────────────────────────────────────
    def chart_to_dataframe(self, chart_data):
        """
        Convert the proxy's normalized chart JSON into a pandas DataFrame
        with columns [Open, High, Low, Close, Volume] matching yfinance output.
        """
        if not chart_data or not isinstance(chart_data, list) or len(chart_data) == 0:
            return pd.DataFrame()

        df = pd.DataFrame(chart_data)

        # Rename to yfinance-style column names
        rename_map = {}
        for col in df.columns:
            lc = col.lower()
            if lc == "open":
                rename_map[col] = "Open"
            elif lc == "high":
                rename_map[col] = "High"
            elif lc == "low":
                rename_map[col] = "Low"
            elif lc == "close":
                rename_map[col] = "Close"
            elif lc == "volume":
                rename_map[col] = "Volume"
            elif lc == "date":
                rename_map[col] = "Date"
        df = df.rename(columns=rename_map)

        # Ensure numeric types
        for col in ["Open", "High", "Low", "Close", "Volume"]:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")

        # Set date index if available
        if "Date" in df.columns:
            try:
                df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
                df = df.dropna(subset=["Date"])
                df = df.set_index("Date").sort_index()
            except Exception:
                pass

        # Drop rows with no close price
        if "Close" in df.columns:
            df = df.dropna(subset=["Close"])

        required = ["Open", "High", "Low", "Close"]
        if not all(c in df.columns for c in required):
            return pd.DataFrame()

        if "Volume" not in df.columns:
            df["Volume"] = 0

        return df
