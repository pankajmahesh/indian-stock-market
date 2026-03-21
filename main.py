#!/usr/bin/env python3
"""
Indian Stock Screener — Main Pipeline Orchestrator

7-Step screening process:
  1. Universe Creation    — Pull and filter NSE stocks
  2. Red Flag Elimination — Auto-reject on critical failures
  3. Fundamental Scoring  — Score on profitability, growth, valuation, health, dividends
  4. Technical Scoring    — Score on trend, momentum, volume, relative strength
  5. Composite Ranking    — 80% fundamental + 20% technical
  6. Deep Dive (Top 50)   — Qualitative proxy analysis
  7. Final Top 20 Output  — Ranked report with thesis, risks, entry/stop-loss

Usage:
  python3 main.py                     # Run full pipeline
  python3 main.py --step 3            # Resume from step 3
  python3 main.py --skip-cache        # Force re-fetch all data
  python3 main.py --top-n 30          # Deep dive top 30 instead of 50
"""
import argparse
import os
import sys
import time

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config
from modules.data_fetcher import DataFetcher
from modules.universe import UniverseBuilder
from modules.red_flags import RedFlagFilter
from modules.fundamental_scorer import FundamentalScorer
from modules.technical_scorer import TechnicalScorer
from modules.composite_ranker import CompositeRanker
from modules.deep_dive import DeepDive
from modules.final_output import FinalOutput
from modules.signal_generator import SignalGenerator
from utils.logger import log


def parse_args():
    parser = argparse.ArgumentParser(description="Indian Stock Screener")
    parser.add_argument(
        "--step", type=int, default=1,
        help="Start from step N (1-7). Previous steps loaded from saved files.",
    )
    parser.add_argument(
        "--skip-cache", action="store_true",
        help="Force re-fetch all data (ignore cache).",
    )
    parser.add_argument(
        "--top-n", type=int, default=None,
        help=f"Number of stocks for deep dive (default: {config.TOP_N_DEEP_DIVE}).",
    )
    parser.add_argument(
        "--final-n", type=int, default=None,
        help=f"Number of final picks (default: {config.TOP_N_FINAL}).",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    start_step = args.step

    if args.top_n:
        config.TOP_N_DEEP_DIVE = args.top_n
    if args.final_n:
        config.TOP_N_FINAL = args.final_n

    # Ensure directories exist
    os.makedirs(config.CACHE_DIR, exist_ok=True)
    os.makedirs(config.OUTPUT_DIR, exist_ok=True)

    log.info("=" * 60)
    log.info("  INDIAN STOCK SCREENER")
    log.info(f"  Starting from Step {start_step}")
    log.info(f"  Cache: {'DISABLED' if args.skip_cache else 'ENABLED'}")
    log.info("=" * 60)

    pipeline_start = time.time()
    fetcher = DataFetcher(skip_cache=args.skip_cache)

    # ----------------------------------------------------------
    # STEP 1: Universe Creation
    # ----------------------------------------------------------
    universe_df = None
    if start_step <= 1:
        universe_df = UniverseBuilder(fetcher).create()
    else:
        universe_df = UniverseBuilder.load_saved()
        if universe_df is None:
            log.error("No saved universe found. Run from step 1.")
            sys.exit(1)
        log.info(f"Loaded saved universe: {len(universe_df)} stocks")

    # ----------------------------------------------------------
    # STEP 2: Red Flag Elimination
    # ----------------------------------------------------------
    clean_df = None
    if start_step <= 2:
        clean_df = RedFlagFilter(fetcher).filter(universe_df)
    else:
        clean_df = RedFlagFilter.load_saved()
        if clean_df is None:
            log.error("No saved red-flag data. Run from step 2.")
            sys.exit(1)
        log.info(f"Loaded saved post-redflag: {len(clean_df)} stocks")

    # ----------------------------------------------------------
    # STEP 3: Fundamental Scoring
    # ----------------------------------------------------------
    fund_df = None
    if start_step <= 3:
        fund_df = FundamentalScorer(fetcher).score(clean_df)
    else:
        fund_df = FundamentalScorer.load_saved()
        if fund_df is None:
            log.error("No saved fundamental scores. Run from step 3.")
            sys.exit(1)
        log.info(f"Loaded saved fundamental scores: {len(fund_df)} stocks")

    # ----------------------------------------------------------
    # STEP 4: Technical Scoring
    # ----------------------------------------------------------
    tech_df = None
    if start_step <= 4:
        tech_df = TechnicalScorer(fetcher).score(clean_df)
    else:
        tech_df = TechnicalScorer.load_saved()
        if tech_df is None:
            log.error("No saved technical scores. Run from step 4.")
            sys.exit(1)
        log.info(f"Loaded saved technical scores: {len(tech_df)} stocks")

    # ----------------------------------------------------------
    # STEP 5: Composite Ranking
    # ----------------------------------------------------------
    ranked_df = None
    if start_step <= 5:
        ranked_df = CompositeRanker().rank(fund_df, tech_df)
    else:
        ranked_df = CompositeRanker.load_saved()
        if ranked_df is None:
            log.error("No saved composite ranking. Run from step 5.")
            sys.exit(1)
        log.info(f"Loaded saved composite ranking: {len(ranked_df)} stocks")

    # ----------------------------------------------------------
    # STEP 6: Deep Dive (Top 50)
    # ----------------------------------------------------------
    deep_df = None
    if start_step <= 6:
        deep_df = DeepDive(fetcher).analyze(ranked_df)
    else:
        deep_df = DeepDive.load_saved()
        if deep_df is None:
            log.error("No saved deep dive data. Run from step 6.")
            sys.exit(1)
        log.info(f"Loaded saved deep dive: {len(deep_df)} stocks")

    # ----------------------------------------------------------
    # STEP 7: Final Top 20 Output
    # ----------------------------------------------------------
    final_df = None
    if start_step <= 7:
        final_df = FinalOutput(fetcher).generate(deep_df)
    else:
        final_df = FinalOutput.load_saved()

    # ----------------------------------------------------------
    # SIGNAL GENERATION (AI-Stock-Trader Strategy)
    # ----------------------------------------------------------
    if final_df is not None:
        signal_df = SignalGenerator(fetcher).generate(final_df)
        log.info("Trading signals generated for final picks")

    # ----------------------------------------------------------
    # Pipeline complete
    # ----------------------------------------------------------
    elapsed = time.time() - pipeline_start
    minutes = int(elapsed // 60)
    seconds = int(elapsed % 60)

    log.info("=" * 60)
    log.info(f"  PIPELINE COMPLETE in {minutes}m {seconds}s")
    log.info(f"  Cache stats: {fetcher.cache.get_stats()}")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
