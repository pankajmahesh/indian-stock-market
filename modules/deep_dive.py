"""
Step 6: Top 50 Deep Dive
Qualitative analysis using quantifiable proxies:
- Management quality (promoter/institutional holding)
- Competitive moat (margin consistency, ROE stability)
- Growth catalysts (analyst targets, revenue acceleration)
- Governance (pledge levels, dividend consistency)
"""
import os

import numpy as np
import pandas as pd

import config
from modules.data_fetcher import DataFetcher
from utils.helpers import safe_get, category_score, weighted_score
from utils.logger import log


class DeepDive:
    def __init__(self, data_fetcher: DataFetcher):
        self.fetcher = data_fetcher

    def analyze(self, ranked_df):
        """
        Perform qualitative proxy analysis on top N stocks.
        Returns DataFrame with qualitative scores added.
        """
        log.info("=" * 60)
        log.info("STEP 6: TOP 50 DEEP DIVE")
        log.info("=" * 60)

        top_n = ranked_df.head(config.TOP_N_DEEP_DIVE).copy()
        symbols = top_n["symbol"].tolist()

        log.info(f"Deep diving into top {len(symbols)} stocks...")
        all_info = self.fetcher.batch_fetch_info(symbols)
        all_financials = self.fetcher.batch_fetch_financials(symbols)

        # Collect sector data for peer comparison
        sector_mcaps = {}
        for sym in symbols:
            info = all_info.get(sym, {})
            sector = info.get("sector", "Unknown")
            mcap = info.get("marketCap", 0)
            if sector not in sector_mcaps:
                sector_mcaps[sector] = []
            sector_mcaps[sector].append(mcap)

        results = []
        for _, row in top_n.iterrows():
            sym = row["symbol"]
            info = all_info.get(sym, {})
            fin = all_financials.get(sym, {})

            scores = self._analyze_stock(info, fin, sector_mcaps)
            results.append({**row.to_dict(), **scores})

        result_df = pd.DataFrame(results)
        result_df = result_df.sort_values("qualitative_score", ascending=False)
        result_df = result_df.reset_index(drop=True)

        log.info(f"Deep dive complete for {len(result_df)} stocks")
        valid = result_df[result_df["qualitative_score"] > 0]
        if not valid.empty:
            log.info(f"Qualitative score range: {valid['qualitative_score'].min():.1f} - {valid['qualitative_score'].max():.1f}")

        out_path = os.path.join(config.DATA_DIR, "top50_deep_dive.csv")
        result_df.to_csv(out_path, index=False)
        log.info(f"Saved to {out_path}")

        return result_df

    def _analyze_stock(self, info, fin, sector_mcaps):
        """Compute qualitative proxy scores for a single stock."""

        # Management Quality
        mgmt = self._score_management(info)

        # Competitive Moat
        moat = self._score_moat(info, fin, sector_mcaps)

        # Growth Catalysts
        catalysts = self._score_catalysts(info)

        # Governance
        gov = self._score_governance(info)

        # Strategy Alignment (Bandhan AMC: sector fit, TAM/MCap, growth acceleration, capital allocation)
        strategy = self._score_strategy_alignment(info, fin)

        # Aggregate
        cat_scores = {}
        for name, sub in [("management_quality", mgmt), ("competitive_moat", moat),
                          ("growth_catalysts", catalysts), ("governance", gov),
                          ("strategy_alignment", strategy)]:
            sc, _ = category_score(sub, scale_to_100=True)
            cat_scores[name] = sc

        qual_score, _ = weighted_score(cat_scores, config.QUALITATIVE_WEIGHTS)

        return {
            "qual_management": cat_scores.get("management_quality"),
            "qual_moat": cat_scores.get("competitive_moat"),
            "qual_catalysts": cat_scores.get("growth_catalysts"),
            "qual_governance": cat_scores.get("governance"),
            "qual_strategy_alignment": cat_scores.get("strategy_alignment"),
            "qualitative_score": qual_score,
        }

    # ----------------------------------------------------------
    # Management Quality (30%)
    # ----------------------------------------------------------
    def _score_management(self, info):
        scores = {}

        # Promoter / insider holding
        insiders = safe_get(info, "heldPercentInsiders")
        if insiders is not None:
            pct = insiders * 100
            if pct > 60:
                scores["insider_holding"] = 8
            elif pct > 40:
                scores["insider_holding"] = 6
            elif pct > 20:
                scores["insider_holding"] = 4
            else:
                scores["insider_holding"] = 2

        # Institutional holding (smart money confidence)
        institutions = safe_get(info, "heldPercentInstitutions")
        if institutions is not None:
            pct = institutions * 100
            if pct > 30:
                scores["institutional_holding"] = 8
            elif pct > 15:
                scores["institutional_holding"] = 6
            else:
                scores["institutional_holding"] = 4

        return scores

    # ----------------------------------------------------------
    # Competitive Moat (30%)
    # ----------------------------------------------------------
    def _score_moat(self, info, fin, sector_mcaps):
        scores = {}

        # Gross/operating margin consistency over available years
        income = fin.get("income_stmt")
        if income is not None and not income.empty:
            try:
                for label in ["Gross Profit", "Operating Income"]:
                    if label in income.index:
                        margin_row = income.loc[label].dropna()
                        rev_label = None
                        for rl in ["Total Revenue", "Revenue"]:
                            if rl in income.index:
                                rev_label = rl
                                break
                        if rev_label and len(margin_row) >= 3:
                            rev = income.loc[rev_label].dropna()
                            # Align indices
                            common = margin_row.index.intersection(rev.index)
                            if len(common) >= 3:
                                margins = (margin_row[common] / rev[common] * 100).values
                                std = np.std(margins)
                                avg = np.mean(margins)
                                if std < 3 and avg > 15:
                                    scores["margin_consistency"] = 9
                                elif std < 5:
                                    scores["margin_consistency"] = 7
                                elif std < 8:
                                    scores["margin_consistency"] = 5
                                else:
                                    scores["margin_consistency"] = 3
                        break
            except Exception:
                pass

        # ROE consistency (use from info — proxy via returnOnEquity)
        roe = safe_get(info, "returnOnEquity")
        if roe is not None:
            roe_pct = roe * 100
            if roe_pct > 20:
                scores["roe_quality"] = 9
            elif roe_pct > 15:
                scores["roe_quality"] = 7
            elif roe_pct > 10:
                scores["roe_quality"] = 5
            else:
                scores["roe_quality"] = 3

        # Market cap rank in sector
        sector = info.get("sector", "Unknown")
        mcap = info.get("marketCap", 0)
        peers = sorted(sector_mcaps.get(sector, [mcap]), reverse=True)
        if peers:
            rank_pct = (peers.index(mcap) + 1) / len(peers) if mcap in peers else 0.5
            if rank_pct <= 0.25:
                scores["sector_dominance"] = 8
            elif rank_pct <= 0.5:
                scores["sector_dominance"] = 6
            elif rank_pct <= 0.75:
                scores["sector_dominance"] = 4
            else:
                scores["sector_dominance"] = 2

        return scores

    # ----------------------------------------------------------
    # Growth Catalysts (25%)
    # ----------------------------------------------------------
    def _score_catalysts(self, info):
        scores = {}

        # Analyst target upside
        target = safe_get(info, "targetMeanPrice")
        current = safe_get(info, "currentPrice") or safe_get(info, "regularMarketPrice")
        if target is not None and current is not None and current > 0:
            upside = ((target - current) / current) * 100
            if upside > 30:
                scores["analyst_upside"] = 9
            elif upside > 15:
                scores["analyst_upside"] = 7
            elif upside > 0:
                scores["analyst_upside"] = 5
            else:
                scores["analyst_upside"] = 2

        # Analyst coverage (number of opinions)
        n_analysts = safe_get(info, "numberOfAnalystOpinions")
        if n_analysts is not None:
            if n_analysts > 15:
                scores["analyst_coverage"] = 8
            elif n_analysts > 5:
                scores["analyst_coverage"] = 6
            else:
                scores["analyst_coverage"] = 4

        # Revenue growth momentum (recent quarter vs annual)
        rev_growth = safe_get(info, "revenueGrowth")
        if rev_growth is not None:
            rg = rev_growth * 100
            if rg > 20:
                scores["revenue_momentum"] = 8
            elif rg > 10:
                scores["revenue_momentum"] = 6
            elif rg > 0:
                scores["revenue_momentum"] = 4
            else:
                scores["revenue_momentum"] = 2

        return scores

    # ----------------------------------------------------------
    # Governance (15%)
    # ----------------------------------------------------------
    def _score_governance(self, info):
        scores = {}

        # Dividend consistency (use yield as proxy)
        div_yield = safe_get(info, "dividendYield")
        if div_yield is not None:
            yield_pct = div_yield * 100
            if yield_pct > 1:
                scores["dividend_track"] = 8
            elif yield_pct > 0:
                scores["dividend_track"] = 6
            else:
                scores["dividend_track"] = 3
        else:
            scores["dividend_track"] = 3  # No dividend info

        # Recommendation score (from analysts — proxy for governance perception)
        rec = safe_get(info, "recommendationMean")
        if rec is not None:
            # 1=Strong Buy, 5=Strong Sell
            if rec <= 1.5:
                scores["analyst_sentiment"] = 9
            elif rec <= 2.5:
                scores["analyst_sentiment"] = 7
            elif rec <= 3.5:
                scores["analyst_sentiment"] = 5
            else:
                scores["analyst_sentiment"] = 3

        return scores

    # ----------------------------------------------------------
    # Strategy Alignment — Bandhan AMC (15%)
    # Scores: sector preference, TAM/MCap proxy, growth acceleration, capital allocation
    # ----------------------------------------------------------
    def _score_strategy_alignment(self, info, fin):
        scores = {}

        sector = info.get("sector", "Unknown") or "Unknown"

        # 1. Sector preference (preferred sectors for 3-5yr per Bandhan thesis)
        multiplier = config.SECTOR_PREFERENCE_MULTIPLIER.get(sector, 1.0)
        if multiplier >= 1.10:
            scores["sector_preference"] = 10
        elif multiplier >= 1.05:
            scores["sector_preference"] = 8
        elif multiplier >= 1.0:
            scores["sector_preference"] = 6
        elif multiplier >= 0.95:
            scores["sector_preference"] = 4
        else:
            scores["sector_preference"] = 2

        # 2. TAM/MCap proxy: low Price-to-Sales + high growth = large runway ahead
        ps_ratio = safe_get(info, "priceToSalesTrailing12Months")
        rev_growth = safe_get(info, "revenueGrowth")
        rg = (rev_growth * 100) if rev_growth is not None else None

        if ps_ratio is not None and rg is not None:
            if ps_ratio < 1.0 and rg > 20:
                scores["tam_mcap_proxy"] = 10
            elif ps_ratio < 2.0 and rg > 15:
                scores["tam_mcap_proxy"] = 8
            elif ps_ratio < 3.0 and rg > 10:
                scores["tam_mcap_proxy"] = 7
            elif ps_ratio < 5.0 and rg > 5:
                scores["tam_mcap_proxy"] = 5
            else:
                scores["tam_mcap_proxy"] = 3
        elif ps_ratio is not None:
            # No growth data: score purely on P/S (low P/S = larger TAM coverage)
            if ps_ratio < 1.0:
                scores["tam_mcap_proxy"] = 7
            elif ps_ratio < 3.0:
                scores["tam_mcap_proxy"] = 5
            else:
                scores["tam_mcap_proxy"] = 3

        # 3. Growth non-linearity: accelerating > stable > decelerating
        income = fin.get("income_stmt")
        if income is not None and not income.empty:
            try:
                rev_label = next(
                    (rl for rl in ["Total Revenue", "Revenue"] if rl in income.index), None
                )
                if rev_label:
                    rev = income.loc[rev_label].dropna().sort_index(ascending=False)
                    if len(rev) >= 3:
                        recent_yoy = (
                            (rev.iloc[0] - rev.iloc[1]) / abs(rev.iloc[1]) * 100
                            if rev.iloc[1] != 0 else 0
                        )
                        prior_yoy = (
                            (rev.iloc[1] - rev.iloc[2]) / abs(rev.iloc[2]) * 100
                            if rev.iloc[2] != 0 else 0
                        )
                        acceleration = recent_yoy - prior_yoy
                        if acceleration > 10 and recent_yoy > 15:
                            scores["growth_nonlinearity"] = 9
                        elif acceleration > 5 and recent_yoy > 10:
                            scores["growth_nonlinearity"] = 7
                        elif acceleration > 0 and recent_yoy > 5:
                            scores["growth_nonlinearity"] = 6
                        elif recent_yoy > 0:
                            scores["growth_nonlinearity"] = 4
                        else:
                            scores["growth_nonlinearity"] = 2
            except Exception:
                pass

        # 4. Capital allocation quality: high ROE + positive FCF generation
        roe = safe_get(info, "returnOnEquity")
        fcf = safe_get(info, "freeCashflow")
        if roe is not None:
            roe_pct = roe * 100
            fcf_positive = fcf is not None and fcf > 0
            if roe_pct > 20 and fcf_positive:
                scores["capital_allocation"] = 10
            elif roe_pct > 20:
                scores["capital_allocation"] = 8
            elif roe_pct > 15 and fcf_positive:
                scores["capital_allocation"] = 8
            elif roe_pct > 15:
                scores["capital_allocation"] = 6
            elif roe_pct > 10 and fcf_positive:
                scores["capital_allocation"] = 6
            elif roe_pct > 10:
                scores["capital_allocation"] = 5
            else:
                scores["capital_allocation"] = 3

        return scores

    @staticmethod
    def load_saved():
        path = os.path.join(config.DATA_DIR, "top50_deep_dive.csv")
        if os.path.exists(path):
            return pd.read_csv(path)
        return None
