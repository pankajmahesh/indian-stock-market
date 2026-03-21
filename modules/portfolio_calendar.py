"""
Portfolio Calendar — Track dividends, splits, and corporate actions.

Uses yfinance historical dividend/split data to show recent events
and estimate upcoming dividend dates based on historical patterns.
"""
import math
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import yfinance as yf

import config
from utils.helpers import safe_get
from utils.logger import log


class PortfolioCalendar:

    def get_events(self, symbols_raw):
        """Fetch dividend/split events for portfolio stocks."""
        symbols = self._normalize(symbols_raw)
        log.info(f"Portfolio Calendar: fetching events for {len(symbols)} stocks")

        results = {"upcoming": [], "recent": [], "summary": {}}
        now = datetime.now()
        six_months_ago = now - timedelta(days=180)

        stock_data = {}

        def fetch_one(sym):
            try:
                ticker = yf.Ticker(sym)
                info = ticker.info or {}
                dividends = ticker.dividends
                splits = ticker.splits
                return sym, info, dividends, splits
            except Exception:
                return sym, {}, None, None

        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = {pool.submit(fetch_one, s): s for s in symbols}
            for future in as_completed(futures):
                try:
                    sym, info, dividends, splits = future.result(timeout=60)
                    stock_data[sym] = (info, dividends, splits)
                except Exception:
                    pass

        total_yield = 0
        yield_count = 0

        for sym in symbols:
            if sym not in stock_data:
                continue

            info, dividends, splits = stock_data[sym]
            clean_sym = sym.replace(".NS", "")
            name = safe_get(info, "shortName") or safe_get(info, "longName") or clean_sym
            div_yield = safe_get(info, "dividendYield")
            cmp = safe_get(info, "currentPrice") or safe_get(info, "regularMarketPrice")

            if div_yield:
                total_yield += div_yield * 100
                yield_count += 1

            # Process dividends
            if dividends is not None and len(dividends) > 0:
                div_dates = dividends.index.to_pydatetime()
                div_values = dividends.values

                # Recent dividends (last 6 months)
                for dt, val in zip(div_dates, div_values):
                    dt_naive = dt.replace(tzinfo=None) if dt.tzinfo else dt
                    if dt_naive >= six_months_ago:
                        results["recent"].append({
                            "symbol": clean_sym,
                            "name": str(name),
                            "event": "DIVIDEND",
                            "date": dt_naive.strftime("%Y-%m-%d"),
                            "amount": round(float(val), 2),
                            "yield_pct": round(div_yield * 100, 1) if div_yield else None,
                        })

                # Estimate next dividend
                if len(div_dates) >= 2:
                    # Calculate average interval between dividends
                    intervals = []
                    for i in range(1, min(len(div_dates), 6)):
                        d1 = div_dates[-(i + 1)].replace(tzinfo=None) if div_dates[-(i + 1)].tzinfo else div_dates[-(i + 1)]
                        d2 = div_dates[-i].replace(tzinfo=None) if div_dates[-i].tzinfo else div_dates[-i]
                        intervals.append((d2 - d1).days)

                    if intervals:
                        avg_interval = int(np.mean(intervals))
                        last_div_date = div_dates[-1].replace(tzinfo=None) if div_dates[-1].tzinfo else div_dates[-1]
                        estimated_next = last_div_date + timedelta(days=avg_interval)

                        # Only show if estimated next is in the future (or within 30 days past)
                        if estimated_next >= now - timedelta(days=30):
                            last_amount = float(div_values[-1])
                            confidence = "REGULAR" if len(intervals) >= 3 and np.std(intervals) < avg_interval * 0.3 else "ESTIMATED"

                            results["upcoming"].append({
                                "symbol": clean_sym,
                                "name": str(name),
                                "event": "DIVIDEND",
                                "estimated_date": estimated_next.strftime("%Y-%m"),
                                "amount": round(last_amount, 2),
                                "yield_pct": round(div_yield * 100, 1) if div_yield else None,
                                "confidence": confidence,
                                "cmp": round(cmp, 2) if cmp else None,
                            })

            # Process splits
            if splits is not None and len(splits) > 0:
                split_dates = splits.index.to_pydatetime()
                split_values = splits.values

                for dt, val in zip(split_dates, split_values):
                    dt_naive = dt.replace(tzinfo=None) if dt.tzinfo else dt
                    if dt_naive >= six_months_ago:
                        ratio = f"1:{int(val)}" if val > 1 else f"{int(1/val)}:1"
                        results["recent"].append({
                            "symbol": clean_sym,
                            "name": str(name),
                            "event": "SPLIT",
                            "date": dt_naive.strftime("%Y-%m-%d"),
                            "amount": None,
                            "ratio": ratio,
                        })

        # Sort
        results["upcoming"].sort(key=lambda x: x["estimated_date"])
        results["recent"].sort(key=lambda x: x["date"], reverse=True)

        results["summary"] = {
            "total_dividend_stocks": yield_count,
            "avg_portfolio_yield": round(total_yield / yield_count, 1) if yield_count > 0 else 0,
            "upcoming_count": len(results["upcoming"]),
            "recent_count": len(results["recent"]),
        }

        return results

    def _normalize(self, symbols_raw):
        symbols = []
        for s in symbols_raw:
            s = s.strip().upper()
            if not s:
                continue
            if not s.endswith(".NS"):
                s += ".NS"
            symbols.append(s)
        return symbols
