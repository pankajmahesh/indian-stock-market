"""
Multibagger Screener — Identifies high-potential stocks from the NSE universe
that could deliver exceptional long-term returns.

Criteria:
  - Strong growth (revenue + earnings growth scores)
  - High profitability (ROE, margins)
  - Reasonable valuation (not extremely overvalued)
  - Good financial health (low debt, healthy cash flow)
  - Positive technical momentum
  - Passes red flag audit

Also generates portfolio rebalance suggestions by comparing
top screener picks against current portfolio holdings.
"""
import math
import os

import numpy as np
import pandas as pd
import yfinance as yf

import config
from modules.data_fetcher import DataFetcher
from modules.risk_analyzer import RiskAnalyzer
from utils.helpers import safe_get
from utils.logger import log


class MultibaggerScreener:
    """Screen NSE universe for multibagger candidates."""

    # Minimum thresholds for multibagger candidacy
    MIN_FUNDAMENTAL = 50       # Fundamental score >= 50/100
    MIN_GROWTH = 50            # Growth sub-score >= 50/100
    MIN_PROFITABILITY = 50     # Profitability sub-score >= 50/100
    MIN_COMPOSITE = 45         # Composite (fund + tech) >= 45/100
    MAX_DEBT_TO_EQUITY = 150   # D/E < 150% (avoid over-leveraged)

    def __init__(self, skip_cache=False):
        self.fetcher = DataFetcher(skip_cache=skip_cache)
        self.risk_analyzer = RiskAnalyzer()

    def screen(self, output_filename="multibagger_candidates.csv"):
        """
        Screen for multibagger candidates from Midcap 150, LargeMidcap 250,
        and Smallcap 250 indices. Falls back to composite_ranked.csv if
        index data is not available.
        """
        log.info("=" * 60)
        log.info("MULTIBAGGER SCREENER")
        log.info("=" * 60)

        # Source stocks from index portfolios
        index_keys = ["midcap150", "largemidcap250", "smallcap250"]
        index_symbols = set()
        for key in index_keys:
            pf = config.PORTFOLIOS.get(key, {})
            stocks = pf.get("stocks", [])
            for s in stocks:
                sym = s.strip().upper()
                if not sym.endswith(".NS"):
                    sym += ".NS"
                index_symbols.add(sym)

        log.info(f"Index universe: {len(index_symbols)} unique stocks from {', '.join(index_keys)}")

        # Load screener data (composite_ranked.csv) for scoring
        composite_path = os.path.join(config.DATA_DIR, "composite_ranked.csv")
        if not os.path.exists(composite_path):
            log.error("composite_ranked.csv not found. Run the screener pipeline first.")
            return pd.DataFrame()

        df = pd.read_csv(composite_path)

        # Filter to only include stocks from the index universe
        if index_symbols:
            df_indexed = df[df["symbol"].isin(index_symbols)]
            if len(df_indexed) >= 20:
                df = df_indexed
                log.info(f"Filtered to {len(df)} stocks from index universe")
            else:
                log.info(f"Only {len(df_indexed)} index stocks in screener data, using full universe ({len(df)} stocks)")
        else:
            log.info(f"No index stocks configured, using full universe ({len(df)} stocks)")

        # Collect all portfolio symbols for cross-reference
        all_portfolio_syms = set()
        for pf in config.PORTFOLIOS.values():
            for s in pf["stocks"]:
                all_portfolio_syms.add(s.strip().upper() + ".NS")

        # Step 1: Filter for multibagger candidates
        candidates = self._filter_candidates(df)
        log.info(f"After initial filters: {len(candidates)} candidates")

        if candidates.empty:
            log.warning("No multibagger candidates found")
            return pd.DataFrame()

        # Step 2: Enrich top candidates with live data
        top_symbols = candidates["symbol"].tolist()[:80]  # Limit to top 80
        log.info(f"Enriching top {len(top_symbols)} candidates with live data...")

        enriched = self._enrich_candidates(top_symbols, all_portfolio_syms)
        log.info(f"Enriched {len(enriched)} candidates")

        if not enriched:
            return pd.DataFrame()

        # Step 3: Score and rank
        result_df = pd.DataFrame(enriched)
        result_df = self._compute_multibagger_score(result_df)
        result_df = result_df.sort_values("mb_score", ascending=False)
        result_df = result_df.reset_index(drop=True)
        result_df["mb_rank"] = range(1, len(result_df) + 1)

        # Save
        out_path = os.path.join(config.DATA_DIR, output_filename)
        result_df.to_csv(out_path, index=False)
        log.info(f"Multibagger candidates saved to {out_path}")
        log.info(f"Top candidates: {len(result_df)}")

        return result_df

    def _filter_candidates(self, df):
        """Apply multibagger filters to screener universe."""
        # Must pass red flag audit
        mask = df["red_flag_status"] == "PASS"

        # Minimum fundamental score
        mask &= df["fundamental_score"] >= self.MIN_FUNDAMENTAL

        # Strong growth
        mask &= df["fund_growth"] >= self.MIN_GROWTH

        # Good profitability
        mask &= df["fund_profitability"] >= self.MIN_PROFITABILITY

        # Reasonable composite score
        mask &= df["composite_score"] >= self.MIN_COMPOSITE

        # Not over-leveraged (handle NaN)
        de = df["debt_to_equity"].fillna(0)
        mask &= de < self.MAX_DEBT_TO_EQUITY

        # High data quality preferred
        mask &= df["data_quality"].isin(["HIGH", "MEDIUM"])

        filtered = df[mask].copy()

        # Sort by a combined growth + profitability + valuation score
        filtered["_growth_prof"] = (
            filtered["fund_growth"] * 0.35 +
            filtered["fund_profitability"] * 0.25 +
            filtered["fund_valuation"] * 0.15 +
            filtered["fundamental_score"] * 0.15 +
            filtered["technical_score"] * 0.10
        )
        filtered = filtered.sort_values("_growth_prof", ascending=False)

        return filtered

    def _enrich_candidates(self, symbols, portfolio_syms):
        """Fetch live data for top candidates."""
        # Batch fetch info and prices
        all_info = self.fetcher.batch_fetch_info(symbols)
        all_prices = self.fetcher.batch_download_prices(symbols)

        results = []
        for sym in symbols:
            info = all_info.get(sym, {})
            prices = all_prices.get(sym)

            if not info:
                continue

            name = safe_get(info, "shortName") or safe_get(info, "longName") or sym.replace(".NS", "")
            sector = safe_get(info, "sector") or "Unknown"
            industry = safe_get(info, "industry") or ""
            cmp = safe_get(info, "currentPrice") or safe_get(info, "regularMarketPrice")
            mcap = safe_get(info, "marketCap")
            mcap_cr = round(mcap / 1e7, 1) if mcap else None

            # Valuation
            pe = safe_get(info, "trailingPE")
            pb = safe_get(info, "priceToBook")
            peg = safe_get(info, "pegRatio")
            ev_ebitda = safe_get(info, "enterpriseToEbitda")

            # Growth
            rev_growth = safe_get(info, "revenueGrowth")
            if rev_growth is not None:
                rev_growth = round(rev_growth * 100, 1)
            earn_growth = safe_get(info, "earningsGrowth")
            if earn_growth is not None:
                earn_growth = round(earn_growth * 100, 1)

            # Profitability
            roe = safe_get(info, "returnOnEquity")
            if roe is not None:
                roe = round(roe * 100, 1)
            roa = safe_get(info, "returnOnAssets")
            if roa is not None:
                roa = round(roa * 100, 1)
            op_margin = safe_get(info, "operatingMargins")
            if op_margin is not None:
                op_margin = round(op_margin * 100, 1)

            # Financial health
            de = safe_get(info, "debtToEquity")
            current_ratio = safe_get(info, "currentRatio")
            fcf = safe_get(info, "freeCashflow")

            # 52-week
            high_52w = safe_get(info, "fiftyTwoWeekHigh")
            low_52w = safe_get(info, "fiftyTwoWeekLow")
            pct_from_high = None
            if cmp and high_52w and high_52w > 0:
                pct_from_high = round((cmp - high_52w) / high_52w * 100, 1)

            # Analyst target
            target_price = safe_get(info, "targetMeanPrice")
            analyst_upside = None
            if target_price and cmp and cmp > 0:
                analyst_upside = round((target_price - cmp) / cmp * 100, 1)

            # Price change %
            prev_close = safe_get(info, "previousClose") or safe_get(info, "regularMarketPreviousClose")
            change_pct = None
            if cmp and prev_close and prev_close > 0:
                change_pct = round((cmp - prev_close) / prev_close * 100, 2)

            # Promoter / insider holding
            promoter_holding = safe_get(info, "heldPercentInsiders")
            if promoter_holding is not None:
                promoter_holding = round(promoter_holding * 100, 1)

            # Risk analysis
            risk = self.risk_analyzer.analyze(prices, cmp)

            # Market cap category
            if mcap_cr:
                if mcap_cr > 100000:
                    cap_cat = "Large Cap"
                elif mcap_cr > 20000:
                    cap_cat = "Mid Cap"
                else:
                    cap_cat = "Small Cap"
            else:
                cap_cat = "Unknown"

            # In portfolio?
            in_portfolio = sym in portfolio_syms

            # Build multibagger rationale
            reasons = []
            if rev_growth and rev_growth > 15:
                reasons.append(f"Revenue growing {rev_growth}%")
            if earn_growth and earn_growth > 20:
                reasons.append(f"Earnings surging {earn_growth}%")
            if roe and roe > 15:
                reasons.append(f"High ROE {roe}%")
            if pe and 0 < pe < 25:
                reasons.append(f"Reasonable PE {pe:.1f}")
            elif peg and 0 < peg < 1.5:
                reasons.append(f"Attractive PEG {peg:.1f}")
            if de is not None and de < 30:
                reasons.append("Low debt")
            if analyst_upside and analyst_upside > 15:
                reasons.append(f"Analysts see {analyst_upside:.0f}% upside")
            if risk["risk_level"] == "LOW":
                reasons.append("Low risk profile")

            results.append({
                "symbol": sym,
                "name": name,
                "sector": sector,
                "industry": industry,
                "cap_category": cap_cat,
                "cmp": cmp,
                "change_pct": change_pct,
                "market_cap_cr": mcap_cr,
                "promoter_holding_pct": promoter_holding,
                "pe_ratio": round(pe, 1) if pe else None,
                "pb_ratio": round(pb, 2) if pb else None,
                "peg_ratio": round(peg, 2) if peg else None,
                "ev_to_ebitda": round(ev_ebitda, 1) if ev_ebitda else None,
                "roe_pct": roe,
                "roa_pct": roa,
                "operating_margin_pct": op_margin,
                "debt_to_equity": round(de, 1) if de else None,
                "current_ratio": round(current_ratio, 2) if current_ratio else None,
                "revenue_growth_pct": rev_growth,
                "earnings_growth_pct": earn_growth,
                "fcf_cr": round(fcf / 1e7, 1) if fcf else None,
                "52w_high": high_52w,
                "52w_low": low_52w,
                "pct_from_52w_high": pct_from_high,
                "target_price": target_price,
                "analyst_upside_pct": analyst_upside,
                "risk_level": risk["risk_level"],
                "risk_score": risk["risk_score"],
                "volatility_ann": risk["volatility_ann"],
                "max_drawdown_pct": risk["max_drawdown_pct"],
                "current_drawdown_pct": risk["current_drawdown_pct"],
                "in_portfolio": in_portfolio,
                "buy_rationale": ". ".join(reasons) if reasons else "Screener top pick",
            })

        return results

    def _compute_multibagger_score(self, df):
        """
        Compute a multibagger score 0-100.
        Weights: Growth (35%), Profitability (25%), Valuation (20%),
                 Financial Health (10%), Risk (10%)
        """
        scores = []
        for _, row in df.iterrows():
            s = 0

            # Growth component (0-35)
            rg = row.get("revenue_growth_pct")
            eg = row.get("earnings_growth_pct")
            growth_pts = 0
            if rg is not None and not (isinstance(rg, float) and math.isnan(rg)):
                if rg > 30: growth_pts += 18
                elif rg > 20: growth_pts += 14
                elif rg > 10: growth_pts += 10
                elif rg > 0: growth_pts += 6
            if eg is not None and not (isinstance(eg, float) and math.isnan(eg)):
                if eg > 40: growth_pts += 17
                elif eg > 25: growth_pts += 14
                elif eg > 10: growth_pts += 10
                elif eg > 0: growth_pts += 6
            s += min(35, growth_pts)

            # Profitability component (0-25)
            roe = row.get("roe_pct")
            opm = row.get("operating_margin_pct")
            prof_pts = 0
            if roe is not None and not (isinstance(roe, float) and math.isnan(roe)):
                if roe > 25: prof_pts += 13
                elif roe > 18: prof_pts += 10
                elif roe > 12: prof_pts += 7
                elif roe > 0: prof_pts += 4
            if opm is not None and not (isinstance(opm, float) and math.isnan(opm)):
                if opm > 25: prof_pts += 12
                elif opm > 15: prof_pts += 9
                elif opm > 8: prof_pts += 6
                elif opm > 0: prof_pts += 3
            s += min(25, prof_pts)

            # Valuation component (0-20) — lower PE/PEG = higher score
            pe = row.get("pe_ratio")
            peg = row.get("peg_ratio")
            val_pts = 0
            if pe is not None and not (isinstance(pe, float) and math.isnan(pe)) and pe > 0:
                if pe < 15: val_pts += 10
                elif pe < 25: val_pts += 7
                elif pe < 40: val_pts += 4
                else: val_pts += 1
            if peg is not None and not (isinstance(peg, float) and math.isnan(peg)) and peg > 0:
                if peg < 0.8: val_pts += 10
                elif peg < 1.2: val_pts += 7
                elif peg < 2.0: val_pts += 4
                else: val_pts += 1
            s += min(20, val_pts)

            # Financial health (0-10)
            de = row.get("debt_to_equity")
            cr = row.get("current_ratio")
            health_pts = 0
            if de is not None and not (isinstance(de, float) and math.isnan(de)):
                if de < 10: health_pts += 5
                elif de < 30: health_pts += 4
                elif de < 60: health_pts += 3
                elif de < 100: health_pts += 1
            else:
                health_pts += 3  # No debt reported
            if cr is not None and not (isinstance(cr, float) and math.isnan(cr)):
                if cr > 2: health_pts += 5
                elif cr > 1.5: health_pts += 4
                elif cr > 1: health_pts += 3
                elif cr > 0.5: health_pts += 1
            s += min(10, health_pts)

            # Risk (0-10) — lower risk = higher score
            risk = row.get("risk_score")
            if risk is not None and not (isinstance(risk, float) and math.isnan(risk)):
                if risk < 30: s += 10
                elif risk < 45: s += 7
                elif risk < 60: s += 4
                else: s += 1
            else:
                s += 5

            scores.append(min(100, s))

        df["mb_score"] = scores
        return df

    def get_rebalance_suggestions(self, portfolio_name="main"):
        """
        Compare portfolio holdings against screener universe,
        adjusted for the current broad market condition.
        Returns: { market_condition: {...}, add: [...], trim: [...], keep: [...] }
        """
        log.info(f"Generating market-aware rebalance suggestions for '{portfolio_name}'")

        # ── Assess current market condition ───────────────────────────────
        try:
            from modules.market_condition_analyzer import MarketConditionAnalyzer
            mc = MarketConditionAnalyzer().analyze()
        except Exception as e:
            log.warning(f"Market condition analysis failed: {e}; defaulting to NEUTRAL")
            mc = {
                "regime": "NEUTRAL",
                "regime_score": 0,
                "add_score_threshold": 68,
                "add_risk_allowed": ["LOW", "MEDIUM"],
                "hold_risk_action": {"HIGH": "WATCH", "MEDIUM": "WATCH"},
                "equity_allocation_min": 65,
                "equity_allocation_max": 75,
                "error": str(e),
            }

        regime = mc.get("regime", "NEUTRAL")
        add_threshold = mc.get("add_score_threshold", 68)
        add_risk_allowed = set(mc.get("add_risk_allowed", ["LOW", "MEDIUM", "HIGH"]))
        hold_risk_action = mc.get("hold_risk_action", {})

        log.info(f"Market regime: {regime} (score {mc.get('regime_score', 0)}) | ADD threshold: {add_threshold}")

        # Load screener data
        composite_path = os.path.join(config.DATA_DIR, "composite_ranked.csv")
        if not os.path.exists(composite_path):
            return {"market_condition": mc, "add": [], "trim": [], "keep": [], "error": "Run screener first"}

        composite = pd.read_csv(composite_path)

        # Load portfolio data
        pf_csv = "portfolio_analysis.csv" if portfolio_name == "main" else f"portfolio_analysis_{portfolio_name}.csv"
        pf_path = os.path.join(config.DATA_DIR, pf_csv)
        if not os.path.exists(pf_path):
            return {"market_condition": mc, "add": [], "trim": [], "keep": [], "error": "Run portfolio scan first"}

        pf = pd.read_csv(pf_path)

        # Load multibagger data if available
        mb_path = os.path.join(config.DATA_DIR, "multibagger_candidates.csv")
        mb_df = pd.read_csv(mb_path) if os.path.exists(mb_path) else None

        # Current portfolio symbols
        pf_syms = set(pf["symbol"].tolist())

        # Get portfolio config
        pf_config = config.PORTFOLIOS.get(portfolio_name, {})
        pf_label = pf_config.get("label", portfolio_name)

        add_suggestions = []
        trim_suggestions = []
        keep_suggestions = []

        # ── TRIM / KEEP: evaluate existing holdings ────────────────────────
        for _, row in pf.iterrows():
            sym = row["symbol"]
            rec = row.get("recommendation", "HOLD")
            risk_level = row.get("risk_level", "UNKNOWN")
            fund_score = row.get("fundamental_score")
            trend = row.get("trend", "")
            signal = row.get("signal", "")

            # Always exit / trim on SELL or REDUCE
            if rec in ("SELL", "REDUCE"):
                # In bear/strong-bear markets upgrade REDUCE → EXIT
                action = "EXIT"
                if rec == "REDUCE" and regime not in ("BEAR", "STRONG_BEAR"):
                    action = "TRIM"
                trim_suggestions.append({
                    "symbol": sym.replace(".NS", ""),
                    "name": row.get("name", ""),
                    "cmp": row.get("cmp"),
                    "action": action,
                    "reason": row.get("rationale", "Weak fundamentals / unfavorable conditions"),
                    "recommendation": rec,
                    "risk_level": risk_level,
                    "risk_score": row.get("risk_score"),
                    "fundamental_score": fund_score,
                    "trend": trend,
                    "market_context": f"Market is {regime} — {action.lower()} recommended",
                })

            elif rec == "HOLD":
                # Consult regime-specific hold-risk-action table
                override_action = hold_risk_action.get(risk_level)
                if override_action:
                    reason = (
                        f"HOLD but {risk_level} risk in a {regime} market "
                        f"— {override_action.lower()} position"
                    )
                    trim_suggestions.append({
                        "symbol": sym.replace(".NS", ""),
                        "name": row.get("name", ""),
                        "cmp": row.get("cmp"),
                        "action": override_action,
                        "reason": reason,
                        "recommendation": rec,
                        "risk_level": risk_level,
                        "risk_score": row.get("risk_score"),
                        "fundamental_score": fund_score,
                        "trend": trend,
                        "market_context": f"Market regime: {regime}",
                    })
                else:
                    # Standard HOLD — keep as-is
                    keep_suggestions.append({
                        "symbol": sym.replace(".NS", ""),
                        "name": row.get("name", ""),
                        "cmp": row.get("cmp"),
                        "action": "HOLD",
                        "reason": row.get("rationale", "Neutral fundamentals; maintain position"),
                        "recommendation": rec,
                        "risk_level": risk_level,
                        "fundamental_score": fund_score,
                        "market_context": f"Market: {regime}",
                    })

            elif rec in ("STRONG BUY", "ACCUMULATE"):
                # In strong bear even good stocks should be held, not added aggressively
                if regime == "STRONG_BEAR":
                    action = "HOLD"
                    reason = f"Strong fundamentals but {regime} market — hold, don't add"
                else:
                    action = "KEEP" if rec == "ACCUMULATE" else "ADD MORE"
                    reason = row.get("rationale", "Strong position")
                keep_suggestions.append({
                    "symbol": sym.replace(".NS", ""),
                    "name": row.get("name", ""),
                    "cmp": row.get("cmp"),
                    "action": action,
                    "reason": reason,
                    "recommendation": rec,
                    "risk_level": risk_level,
                    "fundamental_score": fund_score,
                    "market_context": f"Market: {regime}",
                })

        # ── ADD: top screener picks NOT in portfolio ───────────────────────
        if mb_df is not None and len(mb_df) > 0:
            source = mb_df
            source_col = "mb_score"
        else:
            source = composite.head(120)
            source_col = "composite_score"

        for _, row in source.iterrows():
            sym = row["symbol"]
            if sym in pf_syms:
                continue

            score = row.get(source_col, 0)
            if isinstance(score, float) and math.isnan(score):
                continue

            # ── Market-condition filter ──────────────────────────────────
            # Score threshold
            if score < add_threshold:
                continue

            # Risk filter
            stock_risk = row.get("risk_level", "UNKNOWN")
            if add_risk_allowed and stock_risk not in add_risk_allowed and stock_risk != "UNKNOWN":
                # Allow UNKNOWN to pass through in most regimes
                if regime in ("BEAR", "STRONG_BEAR"):
                    continue  # strict in bear markets

            name = row.get("name", sym.replace(".NS", ""))
            sector = row.get("sector", "")

            reason_parts = []
            if mb_df is not None:
                br = row.get("buy_rationale", "")
                if br:
                    reason_parts.append(br)
                reason_parts.append(f"Multibagger score: {score:.0f}/100")
            else:
                reason_parts.append(f"Composite rank #{int(row.get('composite_rank', 0))}")
                fs = row.get("fundamental_score", 0)
                if not (isinstance(fs, float) and math.isnan(fs)):
                    reason_parts.append(f"Fundamental: {fs:.0f}/100")

            reason_parts.append(f"Market: {regime} (threshold ≥{add_threshold})")

            add_suggestions.append({
                "symbol": sym.replace(".NS", ""),
                "name": name,
                "sector": sector,
                "cmp": row.get("cmp") or row.get("last_price"),
                "action": "BUY",
                "reason": ". ".join(reason_parts),
                "score": round(score, 1),
                "market_cap_cr": row.get("market_cap_cr"),
                "pe_ratio": row.get("pe_ratio"),
                "risk_level": stock_risk,
                "market_context": f"Passes {regime} filter (score ≥{add_threshold}, risk allowed: {', '.join(sorted(add_risk_allowed))})",
            })

            if len(add_suggestions) >= 20:
                break

        # ── AUTO-REBALANCE: score-proportional target weights ─────────
        auto_rebalance = []
        n = len(pf)
        if n > 0:
            # Prefer composite_score > fundamental_score > default 50
            def _score(row):
                cs = row.get("composite_score")
                fs = row.get("fundamental_score")
                for v in (cs, fs):
                    if v is not None and not (isinstance(v, float) and math.isnan(v)):
                        return float(v)
                return 50.0

            scored = [(row, _score(row)) for _, row in pf.iterrows()]
            total_score = sum(s for _, s in scored)
            equal_w = round(100.0 / n, 1)
            TOLERANCE = 5.0  # ±5% tolerance before suggesting action

            for row, score in scored:
                target_w = round(score / total_score * 100, 1) if total_score > 0 else equal_w
                diff = round(target_w - equal_w, 1)

                if diff > TOLERANCE:
                    action = "INCREASE"
                    action_color = "green"
                elif diff < -TOLERANCE:
                    action = "REDUCE"
                    action_color = "red"
                else:
                    action = "MAINTAIN"
                    action_color = "neutral"

                sym_clean = str(row["symbol"]).replace(".NS", "")
                rec = row.get("recommendation", "")
                # Override: if SELL signal, always reduce regardless of score
                if rec in ("SELL", "REDUCE"):
                    action = "REDUCE"
                    action_color = "red"
                elif rec in ("STRONG BUY",) and action == "MAINTAIN":
                    action = "INCREASE"
                    action_color = "green"

                auto_rebalance.append({
                    "symbol": sym_clean,
                    "name": row.get("name", ""),
                    "sector": row.get("sector", ""),
                    "cmp": row.get("cmp"),
                    "score": round(score, 1),
                    "equal_weight_pct": equal_w,
                    "target_weight_pct": target_w,
                    "weight_diff_pct": diff,
                    "action": action,
                    "action_color": action_color,
                    "recommendation": rec,
                    "risk_level": row.get("risk_level", ""),
                    "fundamental_score": row.get("fundamental_score"),
                    "composite_score": row.get("composite_score"),
                })

            # Sort: INCREASE first, then MAINTAIN, then REDUCE
            order = {"INCREASE": 0, "MAINTAIN": 1, "REDUCE": 2}
            auto_rebalance.sort(key=lambda x: (order.get(x["action"], 99), -x["score"]))

        return {
            "portfolio": pf_label,
            "total_holdings": len(pf),
            "market_condition": mc,
            "add": add_suggestions,
            "trim": trim_suggestions,
            "keep": keep_suggestions,
            "auto_rebalance": auto_rebalance,
        }
