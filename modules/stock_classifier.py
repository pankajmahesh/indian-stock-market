"""
Bandhan AMC Strategy: Stock Quality Classification (L1/L2/L3)

L1: High-quality structural businesses — strong moat, asset-light, consistent ROE
    e.g., HDFC Bank, DMart, HUL, Asian Paints
L2: Medium quality, cyclical/transitional — decent metrics, some earnings variability
    e.g., Cummins, Eicher Motors, L&T
L3: Lower quality, highly cyclical or capital-intensive
    e.g., SAIL, Bank of Baroda, Ashok Leyland, BPCL

Philosophy (Bandhan AMC):
- Maintain balanced exposure across buckets; avoid over-concentration in L1 or L3
- 70-80% alpha from stock selection (bottom-up), 20-30% from sector tilts
"""

import config
from utils.logger import log


class StockClassifier:
    """Classify stocks into L1/L2/L3 quality buckets and compute sector preference."""

    def classify_dataframe(self, df):
        """
        Add `l_category` and `sector_preference_mult` columns to the DataFrame.
        Expects columns: sector, industry, roe, operating_margin, debt_to_equity
        """
        df = df.copy()
        df["l_category"] = df.apply(self._classify_row, axis=1)
        df["sector_preference_mult"] = df.apply(self._sector_multiplier, axis=1)

        counts = df["l_category"].value_counts().to_dict()
        log.info(f"L-category distribution: {counts}")
        return df

    def _classify_row(self, row):
        sector = (row.get("sector") or "Unknown").strip()
        industry = (row.get("industry") or "").strip().lower()

        # Raw values: roe is decimal (0.20 = 20%), de is %, op_margin is decimal
        roe_raw = row.get("roe")
        roe = (roe_raw * 100) if roe_raw is not None else None

        op_raw = row.get("operating_margin")
        op_margin = (op_raw * 100) if op_raw is not None else None

        de = row.get("debt_to_equity")  # already in % from yfinance

        # Financial Services: sub-classify by industry and quality
        if sector == "Financial Services":
            is_bank = any(x in industry for x in ["bank", "banking"])
            is_premium = any(x in industry for x in [
                "insurance", "asset management", "exchange",
                "broker", "capital market", "financial data"
            ])
            if is_premium:
                base = "L1"
            elif is_bank:
                # ROE > 15% → private-quality bank (L1), else PSU-style (L3)
                base = "L1" if (roe is not None and roe > 15) else "L3"
            else:
                # NBFCs, housing finance, etc. — use quality metrics
                base = "L2"
        else:
            base = config.SECTOR_L_CATEGORY.get(sector, "L2")

        # --- Quality-based upgrades / downgrades ---
        up = config.L_CATEGORY_UPGRADE_THRESHOLDS
        dn = config.L_CATEGORY_DOWNGRADE_THRESHOLDS

        # Upgrade L2 → L1 if metrics are clearly strong
        if base == "L2":
            roe_ok = roe is not None and roe >= up["roe_min"]
            margin_ok = op_margin is not None and op_margin >= up["operating_margin_min"]
            de_ok = de is None or de <= up["de_max"]
            if roe_ok and margin_ok and de_ok:
                return "L1"

        # Downgrade if metrics are weak
        weak_roe = roe is not None and roe < dn["roe_max"]
        high_de = de is not None and de > dn["de_min"]
        if weak_roe or high_de:
            if base == "L1":
                return "L2"
            if base == "L2":
                return "L3"

        return base

    def _sector_multiplier(self, row):
        sector = (row.get("sector") or "Unknown").strip()
        return config.SECTOR_PREFERENCE_MULTIPLIER.get(sector, 1.0)
