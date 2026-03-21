"""
Step 2: Red Flag Elimination
Auto-reject stocks hitting any of the red flag criteria.
"""
import os

import numpy as np
import pandas as pd

import config
from modules.data_fetcher import DataFetcher
from utils.helpers import safe_get
from utils.logger import log


class RedFlagFilter:
    def __init__(self, data_fetcher: DataFetcher):
        self.fetcher = data_fetcher

    def filter(self, universe_df):
        """
        Apply red flag rules and remove stocks that fail.
        Returns filtered DataFrame with red_flag columns.
        """
        log.info("=" * 60)
        log.info("STEP 2: RED FLAG ELIMINATION")
        log.info("=" * 60)

        symbols = universe_df["symbol"].tolist()

        # Fetch info and financials
        log.info("Fetching financial data for red flag checks...")
        all_info = self.fetcher.batch_fetch_info(symbols)
        all_financials = self.fetcher.batch_fetch_financials(symbols)

        results = []
        pass_count = 0
        reject_count = 0

        for _, row in universe_df.iterrows():
            sym = row["symbol"]
            info = all_info.get(sym, {})
            fin = all_financials.get(sym, {})
            prices = self.fetcher.get_price_history(sym)

            flags = []

            # 1. Extreme leverage: D/E > threshold
            de = safe_get(info, "debtToEquity")
            if de is not None and de > config.RED_FLAGS["debt_to_equity_max"]:
                flags.append(f"High D/E: {de:.0f}%")

            # 2. Chronic negative operating cash flow
            ocf_flag = self._check_negative_ocf(fin)
            if ocf_flag:
                flags.append(ocf_flag)

            # 3. Severe liquidity crisis
            cr = safe_get(info, "currentRatio")
            if cr is not None and cr < config.RED_FLAGS["current_ratio_min"]:
                flags.append(f"Low current ratio: {cr:.2f}")

            # 4. Persistent net losses
            loss_flag = self._check_continuous_losses(fin)
            if loss_flag:
                flags.append(loss_flag)

            # 5. Continuous revenue decline
            rev_flag = self._check_revenue_decline(fin)
            if rev_flag:
                flags.append(rev_flag)

            # 6. Price collapse (>70% from 52-week high)
            price_flag = self._check_price_collapse(prices)
            if price_flag:
                flags.append(price_flag)

            status = "REJECTED" if flags else "PASS"
            if flags:
                reject_count += 1
            else:
                pass_count += 1

            results.append({
                **row.to_dict(),
                "red_flag_status": status,
                "red_flag_reasons": "; ".join(flags) if flags else "",
            })

        result_df = pd.DataFrame(results)
        passed = result_df[result_df["red_flag_status"] == "PASS"].copy()
        passed = passed.reset_index(drop=True)

        log.info(f"Red flag results: {pass_count} PASS, {reject_count} REJECTED")

        # Save full results (including rejected) for audit
        full_path = os.path.join(config.DATA_DIR, "post_redflag_full.csv")
        result_df.to_csv(full_path, index=False)

        # Save filtered results
        out_path = os.path.join(config.DATA_DIR, "post_redflag.csv")
        passed.to_csv(out_path, index=False)
        log.info(f"Saved to {out_path}")

        return passed

    def _check_negative_ocf(self, fin):
        """Check for consecutive years of negative operating cash flow."""
        cashflow = fin.get("cashflow")
        if cashflow is None or cashflow.empty:
            return None

        try:
            # Look for Operating Cash Flow row
            ocf_row = None
            for label in ["Operating Cash Flow", "Total Cash From Operating Activities",
                          "Cash Flow From Continuing Operating Activities"]:
                if label in cashflow.index:
                    ocf_row = cashflow.loc[label]
                    break

            if ocf_row is None:
                return None

            # Check consecutive negative years (most recent first)
            values = ocf_row.dropna().values
            threshold = config.RED_FLAGS["negative_ocf_years"]
            if len(values) >= threshold:
                consecutive = sum(1 for v in values[:threshold] if v < 0)
                if consecutive >= threshold:
                    return f"Negative OCF for {threshold}+ years"
        except Exception:
            pass
        return None

    def _check_continuous_losses(self, fin):
        """Check for continuous years of net losses."""
        income = fin.get("income_stmt")
        if income is None or income.empty:
            return None

        try:
            ni_row = None
            for label in ["Net Income", "Net Income Common Stockholders",
                          "Net Income From Continuing Operations"]:
                if label in income.index:
                    ni_row = income.loc[label]
                    break

            if ni_row is None:
                return None

            values = ni_row.dropna().values
            threshold = config.RED_FLAGS["continuous_loss_years"]
            if len(values) >= threshold:
                consecutive = sum(1 for v in values[:threshold] if v < 0)
                if consecutive >= threshold:
                    return f"Net losses for {threshold}+ years"
        except Exception:
            pass
        return None

    def _check_revenue_decline(self, fin):
        """Check for continuous years of revenue decline."""
        income = fin.get("income_stmt")
        if income is None or income.empty:
            return None

        try:
            rev_row = None
            for label in ["Total Revenue", "Revenue", "Operating Revenue"]:
                if label in income.index:
                    rev_row = income.loc[label]
                    break

            if rev_row is None:
                return None

            values = rev_row.dropna().values
            threshold = config.RED_FLAGS["revenue_decline_years"]
            if len(values) > threshold:
                # Check if each year is lower than the previous
                declining = all(
                    values[i] < values[i + 1]  # columns are newest-first
                    for i in range(threshold)
                )
                if declining:
                    return f"Revenue declining for {threshold}+ years"
        except Exception:
            pass
        return None

    def _check_price_collapse(self, prices):
        """Check if price dropped >70% from 52-week high."""
        if prices is None or prices.empty:
            return None

        try:
            high_52w = prices["Close"].max()
            current = prices["Close"].iloc[-1]
            if high_52w > 0:
                drop_pct = ((high_52w - current) / high_52w) * 100
                if drop_pct > config.RED_FLAGS["price_drop_from_high_pct"]:
                    return f"Price drop {drop_pct:.0f}% from 52w high"
        except Exception:
            pass
        return None

    @staticmethod
    def load_saved():
        """Load previously saved post-redflag data."""
        path = os.path.join(config.DATA_DIR, "post_redflag.csv")
        if os.path.exists(path):
            return pd.read_csv(path)
        return None
