"""
Data fetcher: yfinance wrapper with caching, batching, and retry logic.
This is the core data layer — all other modules depend on it.
"""
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd
import yfinance as yf

import config
from utils.cache_manager import CacheManager
from utils.logger import log


class DataFetcher:
    def __init__(self, skip_cache=False):
        self.cache = CacheManager(
            config.CACHE_DIR, config.CACHE_EXPIRY_HOURS
        )
        self.skip_cache = skip_cache

    # ----------------------------------------------------------
    # Ticker info (fundamental data dict)
    # ----------------------------------------------------------
    def get_ticker_info(self, symbol):
        """Fetch ticker.info dict with caching and retry on rate limit."""
        if not self.skip_cache:
            cached = self.cache.read(symbol, "info")
            if cached is not None:
                return cached

        for attempt in range(config.MAX_RETRIES):
            try:
                ticker = yf.Ticker(symbol)
                info = ticker.info
                if info is None:
                    info = {}
                else:
                    info = dict(info)
                if info:
                    self.cache.write(symbol, "info", info)
                return info
            except Exception as e:
                err_msg = str(e)
                is_rate_limit = any(s in err_msg for s in [
                    "Too Many Requests", "429", "401",
                    "Invalid Crumb", "Unauthorized",
                ])
                if is_rate_limit:
                    wait = (attempt + 1) * 8  # 8s, 16s, 24s backoff
                    time.sleep(wait)
                    continue
                log.warning(f"Failed to fetch info for {symbol}: {e}")
                return {}
        log.warning(f"Rate limited after {config.MAX_RETRIES} retries: {symbol}")
        return {}

    # ----------------------------------------------------------
    # Price history (OHLCV DataFrame)
    # ----------------------------------------------------------
    def get_price_history(self, symbol, period=None):
        """Fetch daily OHLCV history with caching."""
        period = period or config.PRICE_HISTORY_PERIOD
        cache_key = f"history_{period}"

        if not self.skip_cache:
            cached = self.cache.read(symbol, cache_key)
            if cached is not None:
                return cached

        try:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period=period, auto_adjust=True)
            if hist is not None and not hist.empty:
                self.cache.write(symbol, cache_key, hist)
            return hist
        except Exception as e:
            log.warning(f"Failed to fetch history for {symbol}: {e}")
            return pd.DataFrame()

    # ----------------------------------------------------------
    # Financial statements
    # ----------------------------------------------------------
    def get_financials(self, symbol):
        """Fetch annual income statement, balance sheet, cashflow with retry."""
        if not self.skip_cache:
            cached = self.cache.read(
                symbol, "financials",
                expiry_hours=config.FINANCIALS_CACHE_EXPIRY_HOURS,
            )
            if cached is not None:
                return cached

        for attempt in range(config.MAX_RETRIES):
            try:
                ticker = yf.Ticker(symbol)
                data = {
                    "income_stmt": ticker.financials,
                    "balance_sheet": ticker.balance_sheet,
                    "cashflow": ticker.cashflow,
                }
                self.cache.write(
                    symbol, "financials", data,
                    expiry_hours=config.FINANCIALS_CACHE_EXPIRY_HOURS,
                )
                return data
            except Exception as e:
                err_msg = str(e)
                is_rate_limit = any(s in err_msg for s in [
                    "Too Many Requests", "429", "401",
                    "Invalid Crumb", "Unauthorized",
                ])
                if is_rate_limit:
                    wait = (attempt + 1) * 8
                    time.sleep(wait)
                    continue
                log.warning(f"Failed to fetch financials for {symbol}: {e}")
                return {"income_stmt": None, "balance_sheet": None, "cashflow": None}
        log.warning(f"Rate limited after {config.MAX_RETRIES} retries (financials): {symbol}")
        return {"income_stmt": None, "balance_sheet": None, "cashflow": None}

    # ----------------------------------------------------------
    # Batch price download (much faster than per-ticker)
    # ----------------------------------------------------------
    def batch_download_prices(self, symbols, period=None):
        """
        Download prices for multiple tickers in batches.
        Returns dict of {symbol: DataFrame}.
        """
        period = period or config.PRICE_HISTORY_PERIOD
        cache_key = f"history_{period}"
        results = {}
        to_fetch = []

        # Check cache first
        for sym in symbols:
            if not self.skip_cache:
                cached = self.cache.read(sym, cache_key)
                if cached is not None:
                    results[sym] = cached
                    continue
            to_fetch.append(sym)

        if not to_fetch:
            log.info(f"All {len(symbols)} price histories served from cache")
            return results

        log.info(f"Fetching prices for {len(to_fetch)} tickers in batches of {config.BATCH_SIZE}")

        for i in range(0, len(to_fetch), config.BATCH_SIZE):
            batch = to_fetch[i:i + config.BATCH_SIZE]
            batch_num = (i // config.BATCH_SIZE) + 1
            total_batches = (len(to_fetch) + config.BATCH_SIZE - 1) // config.BATCH_SIZE
            log.info(f"  Batch {batch_num}/{total_batches} ({len(batch)} tickers)...")

            try:
                data = yf.download(
                    tickers=batch,
                    period=period,
                    group_by="ticker",
                    threads=True,
                    progress=False,
                    auto_adjust=True,
                )

                if len(batch) == 1:
                    # Single ticker: data is a flat DataFrame
                    sym = batch[0]
                    if data is not None and not data.empty:
                        results[sym] = data
                        self.cache.write(sym, cache_key, data)
                else:
                    # Multiple tickers: multi-level columns
                    for sym in batch:
                        try:
                            if sym in data.columns.get_level_values(0):
                                df = data[sym].dropna(how="all")
                                if not df.empty:
                                    results[sym] = df
                                    self.cache.write(sym, cache_key, df)
                        except (KeyError, AttributeError):
                            pass

            except Exception as e:
                log.warning(f"  Batch download error: {e}")

            if i + config.BATCH_SIZE < len(to_fetch):
                time.sleep(config.BATCH_DELAY_SECONDS)

        log.info(f"Price download complete: {len(results)}/{len(symbols)} successful")
        return results

    # ----------------------------------------------------------
    # Batch ticker info (threaded)
    # ----------------------------------------------------------
    def batch_fetch_info(self, symbols):
        """
        Fetch ticker.info for multiple symbols using thread pool.
        Processes in chunks with pauses to avoid rate limiting.
        Returns dict of {symbol: info_dict}.
        """
        results = {}
        to_fetch = []

        for sym in symbols:
            if not self.skip_cache:
                cached = self.cache.read(sym, "info")
                if cached is not None:
                    results[sym] = cached
                    continue
            to_fetch.append(sym)

        if not to_fetch:
            log.info(f"All {len(symbols)} ticker info served from cache")
            return results

        log.info(f"Fetching info for {len(to_fetch)} tickers ({config.MAX_WORKERS} threads)...")
        completed = 0
        chunk_size = 100  # Process 100 at a time, then pause

        def fetch_one(sym):
            return sym, self.get_ticker_info(sym)

        for chunk_start in range(0, len(to_fetch), chunk_size):
            chunk = to_fetch[chunk_start:chunk_start + chunk_size]

            with ThreadPoolExecutor(max_workers=config.MAX_WORKERS) as pool:
                futures = {pool.submit(fetch_one, sym): sym for sym in chunk}
                for future in as_completed(futures):
                    try:
                        sym, info = future.result(timeout=60)
                        if info:
                            results[sym] = info
                        completed += 1
                        if completed % 50 == 0:
                            log.info(f"  Info progress: {completed}/{len(to_fetch)}")
                    except Exception as e:
                        sym = futures[future]
                        log.warning(f"  Info fetch failed for {sym}: {e}")
                        completed += 1

            # Pause between chunks to avoid rate limiting
            if chunk_start + chunk_size < len(to_fetch):
                log.info(f"  Pausing 5s to avoid rate limits...")
                time.sleep(5)

        log.info(f"Info fetch complete: {len(results)}/{len(symbols)} successful")
        return results

    # ----------------------------------------------------------
    # Batch financials (threaded)
    # ----------------------------------------------------------
    def batch_fetch_financials(self, symbols):
        """Fetch financials for multiple symbols using thread pool."""
        results = {}
        to_fetch = []

        for sym in symbols:
            if not self.skip_cache:
                cached = self.cache.read(
                    sym, "financials",
                    expiry_hours=config.FINANCIALS_CACHE_EXPIRY_HOURS,
                )
                if cached is not None:
                    results[sym] = cached
                    continue
            to_fetch.append(sym)

        if not to_fetch:
            log.info(f"All {len(symbols)} financials served from cache")
            return results

        log.info(f"Fetching financials for {len(to_fetch)} tickers...")
        completed = 0
        chunk_size = 100

        def fetch_one(sym):
            return sym, self.get_financials(sym)

        for chunk_start in range(0, len(to_fetch), chunk_size):
            chunk = to_fetch[chunk_start:chunk_start + chunk_size]

            with ThreadPoolExecutor(max_workers=config.MAX_WORKERS) as pool:
                futures = {pool.submit(fetch_one, sym): sym for sym in chunk}
                for future in as_completed(futures):
                    try:
                        sym, fin = future.result(timeout=60)
                        if fin:
                            results[sym] = fin
                        completed += 1
                        if completed % 50 == 0:
                            log.info(f"  Financials progress: {completed}/{len(to_fetch)}")
                    except Exception as e:
                        sym = futures[future]
                        log.warning(f"  Financials fetch failed for {sym}: {e}")
                        completed += 1

            if chunk_start + chunk_size < len(to_fetch):
                log.info(f"  Pausing 5s to avoid rate limits...")
                time.sleep(5)

        log.info(f"Financials fetch complete: {len(results)}/{len(symbols)} successful")
        return results
