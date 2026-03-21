"""
Step 5: Composite Ranking
Combine Fundamental Score (80%) + Technical Score (20%).
Apply Bandhan AMC sector preference multiplier.
Classify stocks into L1/L2/L3 quality buckets.
"""
import os

import pandas as pd

import config
from modules.stock_classifier import StockClassifier
from utils.logger import log


class CompositeRanker:
    def __init__(self):
        self.classifier = StockClassifier()

    def rank(self, fundamental_df, technical_df):
        """
        Merge fundamental and technical scores, compute composite,
        apply sector preference multiplier, classify into L1/L2/L3,
        and rank all stocks.
        """
        log.info("=" * 60)
        log.info("STEP 5: COMPOSITE RANKING")
        log.info("=" * 60)

        # Merge on symbol
        tech_cols = [
            "symbol", "technical_score", "tech_data_coverage",
            "tech_trend", "tech_momentum", "tech_volume", "tech_relative_strength",
        ]
        tech_subset = technical_df[[c for c in tech_cols if c in technical_df.columns]]

        merged = fundamental_df.merge(tech_subset, on="symbol", how="left")

        # Fill missing technical scores with 0
        merged["technical_score"] = merged["technical_score"].fillna(0)
        merged["fundamental_score"] = merged["fundamental_score"].fillna(0)

        # Base composite score (80% fundamental + 20% technical)
        merged["composite_score_raw"] = (
            config.COMPOSITE_FUNDAMENTAL_WEIGHT * merged["fundamental_score"]
            + config.COMPOSITE_TECHNICAL_WEIGHT * merged["technical_score"]
        )

        # Classify stocks into L1/L2/L3 and add sector preference multiplier
        merged = self.classifier.classify_dataframe(merged)

        # Apply sector preference multiplier (±5-10% tilt, not a dramatic override)
        merged["composite_score"] = (
            merged["composite_score_raw"] * merged["sector_preference_mult"]
        ).clip(upper=100)

        # Add ranks
        merged["composite_rank"] = merged["composite_score"].rank(ascending=False, method="min").astype(int)
        merged["fundamental_rank"] = merged["fundamental_score"].rank(ascending=False, method="min").astype(int)
        merged["technical_rank"] = merged["technical_score"].rank(ascending=False, method="min").astype(int)

        # Data quality label
        merged["data_quality"] = merged.apply(self._data_quality_label, axis=1)

        # Sort by composite score
        merged = merged.sort_values("composite_score", ascending=False).reset_index(drop=True)

        log.info(f"Composite ranking complete: {len(merged)} stocks ranked")
        log.info(f"Top 5: {merged['symbol'].head().tolist()}")
        log.info(f"Score range: {merged['composite_score'].min():.1f} - {merged['composite_score'].max():.1f}")

        # Log L-category distribution among top stocks
        top50 = merged.head(50)
        l_dist = top50["l_category"].value_counts().to_dict()
        log.info(f"Top-50 L-category distribution: {l_dist}")

        out_path = os.path.join(config.DATA_DIR, "composite_ranked.csv")
        merged.to_csv(out_path, index=False)
        log.info(f"Saved to {out_path}")

        return merged

    @staticmethod
    def _data_quality_label(row):
        fund_cov = row.get("fund_data_coverage", 0) or 0
        tech_cov = row.get("tech_data_coverage", 0) or 0
        avg_cov = (fund_cov + tech_cov) / 2
        if avg_cov > 0.8:
            return "HIGH"
        elif avg_cov > 0.5:
            return "MEDIUM"
        return "LOW"

    @staticmethod
    def load_saved():
        path = os.path.join(config.DATA_DIR, "composite_ranked.csv")
        if os.path.exists(path):
            return pd.read_csv(path)
        return None
