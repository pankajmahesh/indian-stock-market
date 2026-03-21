"""
Daily Market Report Generator.

Produces a comprehensive daily Indian stock market brief:
  1) Market Dashboard — indices, sectors, macro, global cues
  2) Global Impact News — news that can move Indian markets
  3) Watchlist Digest — technicals + fundamentals + signals
  4) Screener Picks — undervalued / momentum / growth
  5) Sector Outlook — momentum & trend analysis
  6) Actionable Takeaways
  7) Learning Questions

Report is generated once daily, cached as JSON, and served via API.
"""
import json
import math
import os
import pickle
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime

import numpy as np
import pandas as pd
import yfinance as yf

import config

WATCHLIST = [
    "ABB", "APOLLOHOSP", "BRITANNIA", "BSE", "CDSL", "CHOLAFIN", "CUMMINSIND",
    "DELHIVERY", "EBBETF0433", "EICHERMOT", "GRSE", "GODFRYPHLP", "HCLTECH",
    "HDFCAMC", "HDFCNEXT50", "HDFCMOMENT", "DIXON", "HEROMOTOCO", "HAL",
    "ICICIBANK", "INDHOTEL", "NAUKRI", "INDIGO", "ITC", "JIOFIN", "KEI", "LT",
    "M&M", "MAZDOCK", "LOWVOL", "MAFANG", "MOM100", "MON100", "NETWEB",
    "NIFTYBEES", "NTPC", "POLICYBZR", "PERSISTENT", "RATEGAIN", "RELIANCE",
    "SAFARI", "SBIN", "TMCV", "TITAGARH", "TITAN", "TRENT",
]

ETFS = {
    "EBBETF0433", "HDFCNEXT50", "HDFCMOMENT", "LOWVOL", "MAFANG",
    "MOM100", "MON100", "NIFTYBEES", "TMCV",
}

INDIAN_INDICES = [
    ("Nifty 50", "^NSEI"),
    ("Sensex", "^BSESN"),
    ("Bank Nifty", "^NSEBANK"),
]

SECTOR_INDICES = [
    ("IT", "^CNXIT"),
    ("Bank", "^CNXBANK"),
    ("Pharma", "^CNXPHARMA"),
    ("Auto", "^CNXAUTO"),
    ("Metal", "^CNXMETAL"),
    ("Realty", "^CNXREALTY"),
    ("Energy", "^CNXENERGY"),
    ("FMCG", "^CNXFMCG"),
    ("Infra", "^CNXINFRA"),
    ("PSE", "^CNXPSE"),
]

GLOBAL_INDICES = [
    ("S&P 500", "^GSPC"),
    ("Nasdaq", "^IXIC"),
    ("Dow Jones", "^DJI"),
    ("FTSE 100", "^FTSE"),
    ("Nikkei 225", "^N225"),
    ("Hang Seng", "^HSI"),
]

MACRO_TICKERS = [
    ("USD/INR", "USDINR=X"),
    ("Crude WTI", "CL=F"),
    ("Gold", "GC=F"),
    ("US 10Y Yield", "^TNX"),
]

# Stocks to deep-dive per day (rotate through watchlist)
DEEP_DIVE_COUNT = 10

REPORT_DIR = os.path.join(config.DATA_DIR, "daily_reports")


class DailyReportGenerator:
    def __init__(self):
        os.makedirs(REPORT_DIR, exist_ok=True)

    def get_report_path(self, dt=None):
        dt = dt or date.today()
        return os.path.join(REPORT_DIR, f"daily_{dt.isoformat()}.json")

    def get_latest_report(self):
        """Return today's report if exists, else most recent."""
        path = self.get_report_path()
        if os.path.exists(path):
            with open(path) as f:
                return json.load(f)
        # Try to find most recent report
        try:
            files = sorted(
                [f for f in os.listdir(REPORT_DIR) if f.startswith("daily_") and f.endswith(".json")],
                reverse=True,
            )
            if files:
                with open(os.path.join(REPORT_DIR, files[0])) as f:
                    return json.load(f)
        except Exception:
            pass
        return None

    def generate(self, callback=None):
        """Generate fresh daily report. callback(msg) for progress updates."""
        def log(msg):
            if callback:
                callback(msg)

        report = {
            "date": date.today().isoformat(),
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M IST"),
        }

        log("Fetching market dashboard data...")
        report["market_dashboard"] = self._fetch_market_dashboard(log)

        log("Fetching global/market news...")
        report["global_news"] = self._fetch_news(log)

        log("Analyzing watchlist stocks...")
        report["watchlist"] = self._analyze_watchlist(log)

        log("Analyzing sector trends...")
        report["sector_outlook"] = self._analyze_sectors(log)

        log("Running value screener...")
        report["screener_picks"] = self._run_screener(log)

        log("Generating takeaways...")
        report["takeaways"] = self._generate_takeaways(report)
        report["learning_questions"] = self._get_learning_questions()

        # Save
        path = self.get_report_path()
        with open(path, "w") as f:
            json.dump(report, f, indent=2, default=str)

        log("Daily report complete!")
        return report

    # =================================================================
    # MARKET DASHBOARD
    # =================================================================

    def _fetch_market_dashboard(self, log):
        dashboard = {"indices": [], "sectors": [], "global_indices": [], "macro": {}}

        # --- Indian Indices ---
        for name, ticker in INDIAN_INDICES:
            data = self._get_ticker_summary(ticker)
            if data:
                dashboard["indices"].append({"name": name, **data})

        # --- Sector Performance ---
        for name, ticker in SECTOR_INDICES:
            data = self._get_ticker_summary(ticker)
            if data:
                dashboard["sectors"].append({"name": name, **data})
        dashboard["sectors"].sort(key=lambda x: x.get("change_pct", 0), reverse=True)

        # --- Global Indices ---
        for name, ticker in GLOBAL_INDICES:
            data = self._get_ticker_summary(ticker)
            if data:
                dashboard["global_indices"].append({"name": name, **data})

        # --- Macro ---
        for name, ticker in MACRO_TICKERS:
            data = self._get_ticker_summary(ticker)
            if data:
                dashboard["macro"][name] = data

        log(f"Market data: {len(dashboard['indices'])} indices, {len(dashboard['sectors'])} sectors")
        return dashboard

    def _get_ticker_summary(self, ticker_str):
        """Fetch close price and % change for a ticker."""
        try:
            tk = yf.Ticker(ticker_str)
            hist = tk.history(period="5d")
            if hist is None or hist.empty or len(hist) < 1:
                return None
            close = float(hist["Close"].iloc[-1])
            prev = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else close
            change_pct = ((close - prev) / prev * 100) if prev > 0 else 0
            return {
                "close": round(close, 2),
                "change_pct": round(change_pct, 2),
                "prev_close": round(prev, 2),
            }
        except Exception:
            return None

    # =================================================================
    # GLOBAL / MARKET NEWS
    # =================================================================

    def _fetch_news(self, log):
        """Fetch recent news from major tickers."""
        news_items = []
        news_tickers = ["^NSEI", "^BSESN", "RELIANCE.NS", "INFY.NS", "HDFCBANK.NS"]

        for ticker_str in news_tickers:
            try:
                tk = yf.Ticker(ticker_str)
                raw = getattr(tk, "news", None)
                if raw and isinstance(raw, list):
                    for item in raw[:3]:
                        title = item.get("title") or item.get("headline", "")
                        link = item.get("link") or item.get("url", "")
                        publisher = item.get("publisher") or item.get("source", "")
                        if title and title not in [n["headline"] for n in news_items]:
                            news_items.append({
                                "headline": title,
                                "source": publisher,
                                "url": link,
                                "impact": "",  # Will be enriched if possible
                            })
            except Exception:
                pass

        log(f"Collected {len(news_items)} news items")
        return news_items[:15]

    # =================================================================
    # WATCHLIST ANALYSIS
    # =================================================================

    def _analyze_watchlist(self, log):
        """Analyze all watchlist stocks with rotation for deep dives."""
        # Determine today's deep-dive stocks (rotate by day of year)
        day_of_year = date.today().timetuple().tm_yday
        start_idx = (day_of_year * DEEP_DIVE_COUNT) % len(WATCHLIST)
        deep_dive_names = set()
        for i in range(DEEP_DIVE_COUNT):
            idx = (start_idx + i) % len(WATCHLIST)
            deep_dive_names.add(WATCHLIST[idx])

        # Batch download prices for all watchlist stocks
        symbols_ns = [f"{s}.NS" for s in WATCHLIST]
        log(f"Fetching prices for {len(WATCHLIST)} watchlist stocks...")

        live_prices = {}
        prev_prices = {}
        try:
            data = yf.download(symbols_ns, period="5d", progress=False, group_by="ticker")
            if data is not None and not data.empty:
                for sym_ns in symbols_ns:
                    try:
                        if len(symbols_ns) == 1:
                            col = data["Close"]
                        else:
                            col = data[sym_ns]["Close"] if sym_ns in data.columns.get_level_values(0) else None
                        if col is not None:
                            vals = col.dropna()
                            if len(vals) >= 1:
                                live_prices[sym_ns] = float(vals.iloc[-1])
                            if len(vals) >= 2:
                                prev_prices[sym_ns] = float(vals.iloc[-2])
                    except Exception:
                        pass
        except Exception as e:
            log(f"Batch download warning: {e}")

        log(f"Got prices for {len(live_prices)} stocks")

        # Analyze each stock
        results = []

        def analyze_one(name):
            sym_ns = f"{name}.NS"
            is_etf = name in ETFS
            is_deep = name in deep_dive_names

            item = {
                "symbol": name,
                "symbol_ns": sym_ns,
                "is_etf": is_etf,
                "is_deep_dive": is_deep,
                "cmp": live_prices.get(sym_ns),
                "prev_close": prev_prices.get(sym_ns),
                "change_pct": None,
                "fundamentals": {},
                "technicals": {},
                "news": [],
                "signal": "WATCH",
                "signal_reasons": [],
                "risk_note": "",
            }

            if item["cmp"] and item["prev_close"] and item["prev_close"] > 0:
                item["change_pct"] = round(
                    (item["cmp"] - item["prev_close"]) / item["prev_close"] * 100, 2
                )

            # Technicals from price predictor (uses cached history)
            try:
                from modules.price_predictor import PricePredictor
                pred = PricePredictor().predict_stock(sym_ns)
                if pred:
                    item["technicals"] = {
                        "rsi": pred.get("rsi"),
                        "adx": pred.get("adx"),
                        "macd_trend": pred.get("macd_trend"),
                        "ema_trend": pred.get("ema_trend"),
                        "direction": pred.get("direction"),
                        "confidence": pred.get("confidence"),
                        "support": pred.get("support"),
                        "resistance": pred.get("resistance"),
                        "target_7d": pred.get("target_7d"),
                        "target_30d": pred.get("target_30d"),
                        "target_90d": pred.get("target_90d"),
                        "upside_7d_pct": pred.get("upside_7d_pct"),
                        "upside_30d_pct": pred.get("upside_30d_pct"),
                        "upside_90d_pct": pred.get("upside_90d_pct"),
                        "volatility_ann": pred.get("volatility_ann"),
                        "algo_version": pred.get("algo_version"),
                    }
            except Exception:
                pass

            # Deep dive: fundamentals + news
            if is_deep and not is_etf:
                try:
                    tk = yf.Ticker(sym_ns)
                    info = tk.info or {}
                    item["fundamentals"] = {
                        "pe": _safe_round(info.get("trailingPE")),
                        "forward_pe": _safe_round(info.get("forwardPE")),
                        "pb": _safe_round(info.get("priceToBook")),
                        "earnings_growth": _safe_pct(info.get("earningsGrowth")),
                        "revenue_growth": _safe_pct(info.get("revenueGrowth")),
                        "roe": _safe_pct(info.get("returnOnEquity")),
                        "roce": _safe_pct(info.get("returnOnAssets")),
                        "debt_equity": _safe_round(info.get("debtToEquity"), 1),
                        "profit_margin": _safe_pct(info.get("profitMargins")),
                        "market_cap_cr": _fmt_market_cap(info.get("marketCap")),
                        "dividend_yield": _safe_pct(info.get("dividendYield")),
                        "sector": info.get("sector", ""),
                        "industry": info.get("industry", ""),
                    }
                    # News
                    raw_news = getattr(tk, "news", None)
                    if raw_news and isinstance(raw_news, list):
                        for n in raw_news[:3]:
                            title = n.get("title") or n.get("headline", "")
                            link = n.get("link") or n.get("url", "")
                            pub = n.get("publisher") or n.get("source", "")
                            if title:
                                item["news"].append({
                                    "headline": title, "source": pub, "url": link,
                                })
                except Exception:
                    pass

            # Generate signal
            item["signal"], item["signal_reasons"] = self._generate_signal(item)
            item["risk_note"] = self._risk_note(item)

            return item

        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = {pool.submit(analyze_one, name): name for name in WATCHLIST}
            done = 0
            for future in as_completed(futures):
                try:
                    result = future.result()
                    results.append(result)
                except Exception:
                    pass
                done += 1
                if done % 10 == 0:
                    log(f"Analyzed {done}/{len(WATCHLIST)} watchlist stocks...")

        # Sort: deep dives first, then by signal strength
        signal_order = {"ACCUMULATE": 0, "ACCUMULATE (STAGED)": 1, "WATCH": 2, "WAIT": 3}
        results.sort(key=lambda x: (
            0 if x["is_deep_dive"] else 1,
            signal_order.get(x["signal"], 2),
        ))

        log(f"Watchlist analysis complete: {len(results)} stocks")
        return results

    def _generate_signal(self, item):
        """Generate accumulate/wait/watch signal from technicals + fundamentals."""
        score = 0
        reasons = []
        tech = item.get("technicals", {})
        fund = item.get("fundamentals", {})

        # --- Technical signals ---
        upside_30 = tech.get("upside_30d_pct")
        if upside_30 is not None:
            if upside_30 > 8:
                score += 3
                reasons.append(f"Strong 30D upside ({upside_30:+.1f}%)")
            elif upside_30 > 3:
                score += 2
                reasons.append(f"Positive 30D upside ({upside_30:+.1f}%)")
            elif upside_30 > 0:
                score += 1
            elif upside_30 < -5:
                score -= 2
                reasons.append(f"Negative 30D outlook ({upside_30:+.1f}%)")

        rsi = tech.get("rsi")
        if rsi is not None:
            if rsi < 35:
                score += 2
                reasons.append(f"RSI oversold ({rsi:.0f})")
            elif rsi < 45:
                score += 1
            elif rsi > 72:
                score -= 2
                reasons.append(f"RSI overbought ({rsi:.0f})")
            elif rsi > 65:
                score -= 1

        direction = tech.get("direction")
        if direction == "BULLISH":
            score += 1
        elif direction == "BEARISH":
            score -= 1

        macd = tech.get("macd_trend")
        if macd == "BULLISH":
            score += 1
            reasons.append("MACD bullish")
        elif macd == "BEARISH":
            score -= 1

        # --- Fundamental signals (if available) ---
        pe = fund.get("pe")
        if pe is not None:
            if 0 < pe < 20:
                score += 1
                reasons.append(f"Attractive P/E ({pe:.1f})")
            elif pe > 60:
                score -= 1
                reasons.append(f"Expensive P/E ({pe:.1f})")

        roe = fund.get("roe")
        if roe is not None and roe > 15:
            score += 1
            reasons.append(f"Strong ROE ({roe:.1f}%)")

        eg = fund.get("earnings_growth")
        if eg is not None and eg > 15:
            score += 1
            reasons.append(f"Earnings growth {eg:.0f}%")

        de = fund.get("debt_equity")
        if de is not None and de < 50:
            score += 1
        elif de is not None and de > 150:
            score -= 1
            reasons.append(f"High leverage (D/E {de:.0f})")

        if score >= 4:
            signal = "ACCUMULATE"
        elif score >= 2:
            signal = "ACCUMULATE (STAGED)"
        elif score <= -2:
            signal = "WAIT"
        else:
            signal = "WATCH"

        return signal, reasons[:5]

    def _risk_note(self, item):
        """Position sizing note aligned to 6% max rule."""
        tech = item.get("technicals", {})
        vol = tech.get("volatility_ann")
        signal = item.get("signal", "WATCH")

        if signal.startswith("ACCUMULATE"):
            if vol and vol > 40:
                return "High volatility — limit to 3-4% position; build in 2-3 tranches over dips."
            elif vol and vol > 25:
                return "Moderate volatility — build up to 5% in 2 tranches; add on dips toward support."
            else:
                return "Low volatility — can size up to 6% max; add in 2 tranches."
        elif signal == "WAIT":
            return "Avoid fresh entry; wait for trend reversal or support confirmation."
        else:
            return "Monitor for better entry; no fresh allocation recommended yet."

    # =================================================================
    # SECTOR OUTLOOK
    # =================================================================

    def _analyze_sectors(self, log):
        """Sector momentum and outlook analysis."""
        sectors = []
        for name, ticker in SECTOR_INDICES:
            try:
                tk = yf.Ticker(ticker)
                hist = tk.history(period="1mo")
                if hist is None or hist.empty or len(hist) < 5:
                    continue
                close = hist["Close"]
                current = float(close.iloc[-1])
                week_ago = float(close.iloc[-5]) if len(close) >= 5 else current
                month_start = float(close.iloc[0])

                week_chg = ((current - week_ago) / week_ago * 100) if week_ago > 0 else 0
                month_chg = ((current - month_start) / month_start * 100) if month_start > 0 else 0

                # Simple momentum classification
                if month_chg > 3 and week_chg > 0:
                    outlook = "STRONG MOMENTUM"
                elif month_chg > 0:
                    outlook = "POSITIVE"
                elif month_chg > -3:
                    outlook = "NEUTRAL"
                else:
                    outlook = "WEAK"

                sectors.append({
                    "name": name,
                    "close": round(current, 1),
                    "week_change_pct": round(week_chg, 2),
                    "month_change_pct": round(month_chg, 2),
                    "outlook": outlook,
                })
            except Exception:
                pass

        sectors.sort(key=lambda x: x.get("month_change_pct", 0), reverse=True)
        log(f"Analyzed {len(sectors)} sectors")
        return sectors

    # =================================================================
    # SCREENER PICKS
    # =================================================================

    def _run_screener(self, log):
        """Identify undervalued / strong growth stocks from existing data."""
        picks = {"undervalued": [], "momentum": [], "quality": []}

        # Load composite data
        csv_path = os.path.join(config.DATA_DIR, "composite_ranked.csv")
        if not os.path.exists(csv_path):
            log("No composite data for screener")
            return picks

        try:
            df = pd.read_csv(csv_path)
        except Exception:
            return picks

        if df.empty:
            return picks

        # Undervalued: low composite rank + positive technical
        for _, row in df.head(50).iterrows():
            sym = row.get("symbol", "")
            comp = row.get("composite_score")
            fund = row.get("fundamental_score")
            tech = row.get("technical_score")
            if comp and fund and tech:
                if fund > 60 and tech > 50:
                    picks["undervalued"].append({
                        "symbol": sym.replace(".NS", ""),
                        "composite_score": round(float(comp), 1),
                        "fundamental_score": round(float(fund), 1),
                        "technical_score": round(float(tech), 1),
                        "sector": row.get("sector", ""),
                    })
            if len(picks["undervalued"]) >= 8:
                break

        # Momentum: highest technical score
        tech_sorted = df.sort_values("technical_score", ascending=False)
        for _, row in tech_sorted.head(8).iterrows():
            sym = row.get("symbol", "")
            picks["momentum"].append({
                "symbol": sym.replace(".NS", ""),
                "technical_score": round(float(row.get("technical_score", 0)), 1),
                "composite_score": round(float(row.get("composite_score", 0)), 1),
                "sector": row.get("sector", ""),
            })

        # Quality: highest fundamental score
        fund_sorted = df.sort_values("fundamental_score", ascending=False)
        for _, row in fund_sorted.head(8).iterrows():
            sym = row.get("symbol", "")
            picks["quality"].append({
                "symbol": sym.replace(".NS", ""),
                "fundamental_score": round(float(row.get("fundamental_score", 0)), 1),
                "composite_score": round(float(row.get("composite_score", 0)), 1),
                "sector": row.get("sector", ""),
            })

        log(f"Screener: {len(picks['undervalued'])} undervalued, "
            f"{len(picks['momentum'])} momentum, {len(picks['quality'])} quality")
        return picks

    # =================================================================
    # TAKEAWAYS & QUESTIONS
    # =================================================================

    def _generate_takeaways(self, report):
        """Generate 3-6 actionable takeaway bullets."""
        takeaways = []
        dash = report.get("market_dashboard", {})
        watchlist = report.get("watchlist", [])
        sectors = report.get("sector_outlook", [])

        # Market direction
        nifty = next((i for i in dash.get("indices", []) if i["name"] == "Nifty 50"), None)
        if nifty:
            chg = nifty.get("change_pct", 0)
            if chg > 0.5:
                takeaways.append(
                    f"Market positive today (Nifty {chg:+.2f}%). "
                    "Continue SIP accumulation on watchlist names near support levels."
                )
            elif chg < -0.5:
                takeaways.append(
                    f"Market declined (Nifty {chg:+.2f}%). "
                    "Look for opportunities in quality stocks with strong fundamentals — "
                    "dips are for accumulating, not panicking."
                )
            else:
                takeaways.append(
                    f"Market flat (Nifty {chg:+.2f}%). "
                    "Range-bound action — stick to staged buying plan on conviction names."
                )

        # Sector insights
        if sectors:
            top = sectors[0]
            bottom = sectors[-1]
            takeaways.append(
                f"Sector rotation: {top['name']} leads ({top['month_change_pct']:+.1f}% month), "
                f"{bottom['name']} lags ({bottom['month_change_pct']:+.1f}%). "
                "Consider tilting new allocation toward sectors with strong momentum."
            )

        # Watchlist accumulate count
        acc = [w for w in watchlist if w.get("signal", "").startswith("ACCUMULATE")]
        wait = [w for w in watchlist if w.get("signal") == "WAIT"]
        if acc:
            names = ", ".join(w["symbol"] for w in acc[:5])
            takeaways.append(
                f"{len(acc)} watchlist stocks show accumulate signals: {names}. "
                "Build positions in 2-3 tranches; max 6% per name."
            )
        if wait:
            names = ", ".join(w["symbol"] for w in wait[:3])
            takeaways.append(
                f"{len(wait)} watchlist stocks on wait: {names}. "
                "Avoid catching falling knives — wait for trend reversal confirmation."
            )

        # Macro note
        macro = dash.get("macro", {})
        crude = macro.get("Crude WTI", {})
        usd = macro.get("USD/INR", {})
        if crude and usd:
            takeaways.append(
                f"Macro watch: Crude at ${crude.get('close', 'N/A')}, "
                f"USD/INR at {usd.get('close', 'N/A')}. "
                "Rising crude or weakening INR can pressure IT/pharma margins short-term "
                "but often creates accumulation opportunities in exporters."
            )

        # Risk reminder
        takeaways.append(
            "Position sizing: Max 6% in any single name. Multi-year horizon — "
            "don't chase momentum; buy quality on weakness. Tax-efficient if held > 1 year."
        )

        return takeaways[:6]

    def _get_learning_questions(self):
        """Rotating personalization questions."""
        all_questions = [
            ["Do you prefer SIP-style tranches (e.g., 2% each month) or lump-sum on dips?",
             "Any sectors you want to overweight or avoid completely?",
             "What's your tax situation — long-term (>1yr) or shorter holding period?"],
            ["Would you like more ETF coverage vs individual stocks?",
             "Any upcoming capital needs that affect your investment horizon?",
             "Do you track FII/DII flows? Should we highlight this more?"],
            ["Are there specific technical levels you use (e.g., VWAP, Supertrend)?",
             "Would you like inclusion of small-cap opportunities or stick to large/mid?",
             "Any stocks you want added to or removed from the watchlist?"],
            ["Do you follow earnings season closely? Want per-stock earnings calendar?",
             "Preference for dividend-paying stocks vs pure growth?",
             "Would weekly portfolio review summaries be useful?"],
        ]
        day_idx = date.today().timetuple().tm_yday % len(all_questions)
        return all_questions[day_idx]


# =====================================================================
# HELPERS
# =====================================================================

def _safe_round(val, decimals=2):
    if val is None or (isinstance(val, float) and (math.isnan(val) or math.isinf(val))):
        return None
    try:
        return round(float(val), decimals)
    except (TypeError, ValueError):
        return None


def _safe_pct(val):
    """Convert a ratio (0.15) to percentage (15.0), or return None."""
    if val is None or (isinstance(val, float) and (math.isnan(val) or math.isinf(val))):
        return None
    try:
        return round(float(val) * 100, 1)
    except (TypeError, ValueError):
        return None


def _fmt_market_cap(val):
    """Format market cap to crores (INR)."""
    if val is None:
        return None
    try:
        cr = float(val) / 1e7  # 1 crore = 10 million
        if cr > 100000:
            return f"{cr / 100000:.1f}L Cr"
        elif cr > 1000:
            return f"{cr / 1000:.1f}K Cr"
        else:
            return f"{cr:.0f} Cr"
    except (TypeError, ValueError):
        return None
