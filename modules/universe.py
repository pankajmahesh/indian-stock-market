"""
Step 1: Universe Creation
- Load NSE equity list CSV
- Filter by series (EQ only)
- Apply market cap, volume, and price filters
"""
import os

import numpy as np
import pandas as pd

import config
from modules.data_fetcher import DataFetcher
from utils.logger import log


class UniverseBuilder:
    def __init__(self, data_fetcher: DataFetcher):
        self.fetcher = data_fetcher

    def create(self):
        """Build the filtered universe of stocks."""
        # Step 1a: Load NSE equity list
        log.info("=" * 60)
        log.info("STEP 1: UNIVERSE CREATION")
        log.info("=" * 60)

        df = self._load_nse_list()
        # Strip whitespace from column names (NSE CSV has leading spaces)
        df.columns = df.columns.str.strip()
        log.info(f"Loaded {len(df)} stocks from NSE equity list")

        # Step 1b: Filter EQ series only
        df = df[df["SERIES"].str.strip() == "EQ"]
        log.info(f"After EQ series filter: {len(df)} stocks")

        # Step 1c: Create yfinance symbols
        symbols = [f"{sym.strip()}.NS" for sym in df["SYMBOL"].tolist()]
        symbol_to_name = dict(
            zip(symbols, df["NAME OF COMPANY"].tolist())
        )

        # Step 1d: Batch fetch info for filtering
        log.info("Fetching market data for universe filtering...")
        all_info = self.fetcher.batch_fetch_info(symbols)

        # Step 1e: Also batch download recent price history for volume calculation
        log.info("Fetching price history for volume calculation...")
        all_prices = self.fetcher.batch_download_prices(symbols, period="3mo")

        # Step 1f: Apply filters
        universe = []
        rejected = {"no_data": 0, "low_mcap": 0, "low_price": 0, "low_volume": 0}

        for sym in symbols:
            info = all_info.get(sym, {})
            prices = all_prices.get(sym)

            # Market cap
            mcap = info.get("marketCap")
            if mcap is None:
                # Try computing from price * shares
                price = info.get("currentPrice") or info.get("regularMarketPrice")
                shares = info.get("sharesOutstanding")
                if price and shares:
                    mcap = price * shares

            if mcap is None:
                rejected["no_data"] += 1
                continue

            if mcap < config.MIN_MARKET_CAP:
                rejected["low_mcap"] += 1
                continue

            # Price filter
            price = info.get("currentPrice") or info.get("regularMarketPrice")
            if price is None and prices is not None and not prices.empty:
                price = prices["Close"].iloc[-1]
            if price is None or price < config.MIN_PRICE:
                rejected["low_price"] += 1
                continue

            # Average daily volume value (last 30 trading days)
            avg_vol_value = 0
            if prices is not None and not prices.empty and "Close" in prices.columns and "Volume" in prices.columns:
                recent = prices.tail(30)
                daily_values = recent["Close"] * recent["Volume"]
                avg_vol_value = daily_values.mean()
                if np.isnan(avg_vol_value):
                    avg_vol_value = 0

            if avg_vol_value < config.MIN_AVG_DAILY_VOLUME_VALUE:
                rejected["low_volume"] += 1
                continue

            universe.append({
                "symbol": sym,
                "name": symbol_to_name.get(sym, info.get("shortName", "")),
                "market_cap": mcap,
                "last_price": price,
                "avg_daily_volume_value": avg_vol_value,
                "sector": info.get("sector", ""),
                "industry": info.get("industry", ""),
            })

        result = pd.DataFrame(universe)
        result = result.sort_values("market_cap", ascending=False).reset_index(drop=True)

        log.info(f"Universe created: {len(result)} stocks")
        log.info(f"Rejected: {rejected}")

        # Save intermediate output
        out_path = os.path.join(config.DATA_DIR, "universe.csv")
        result.to_csv(out_path, index=False)
        log.info(f"Saved to {out_path}")

        return result

    def _load_nse_list(self):
        """Load the NSE equity list CSV."""
        csv_path = config.NSE_EQUITY_CSV
        if not os.path.exists(csv_path):
            raise FileNotFoundError(
                f"NSE equity list not found at {csv_path}. "
                "Please place EQUITY_L.csv in the data/ folder."
            )
        return pd.read_csv(csv_path)

    @staticmethod
    def load_saved():
        """Load previously saved universe from CSV."""
        path = os.path.join(config.DATA_DIR, "universe.csv")
        if os.path.exists(path):
            return pd.read_csv(path)
        return None
