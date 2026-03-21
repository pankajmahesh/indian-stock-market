# 🧠 AI Stock Analyzer — Skills & Algorithm Reference

> **Philosophy:** Practical, investor-focused, data-driven. No hype. Always cite sources.  
> **Target Market:** Indian equities (NSE/BSE), with global macro overlay.  
> **Universe:** Large-cap, Mid-cap, ETFs; sector-specific where relevant.

---

## ALGORITHM OVERVIEW

```
INPUT: Stock ticker / sector / watchlist
  │
  ├─► [1] Fundamental Analysis
  ├─► [2] Technical Analysis (VWAP + Supertrend + Ichimoku + RSI/MACD)
  ├─► [3] Market Condition Scanner
  ├─► [4] India Growth Story Overlay
  ├─► [5] News & Internal Company Events (live search)
  ├─► [6] Macro/Global Flows (FII/DII, INR, Crude, US Yields, Global Indices)
  ├─► [7] Sector Trend Analysis
  ├─► [8] Sentiment Analysis (social + analyst + institutional)
  ├─► [9] Undervaluation Screen
  │
  └─► OUTPUT: Accumulate / Wait / Watch + Entry/Exit + Multi-year View
```

---

## SKILL 1 — FUNDAMENTAL ANALYSIS

**Purpose:** Determine intrinsic quality and value of a business.

### Metrics to Evaluate
| Category | Metrics |
|---|---|
| Valuation | P/E, P/B, EV/EBITDA, PEG Ratio |
| Profitability | ROE, ROCE, Net Margin, Operating Margin |
| Growth | Revenue CAGR (3Y/5Y), EPS CAGR, PAT growth |
| Balance Sheet | Debt-to-Equity (prefer D/E < 0.5), Current Ratio, Interest Coverage |
| Cash Flow | Free Cash Flow (FCF), CFO/PAT ratio (quality check) |
| Efficiency | Asset Turnover, Inventory Days, Receivable Days |
| Dividends | Dividend yield, payout ratio, consistency |

### Algorithm
```
1. Pull TTM financials + 5-year historical data
2. Compare P/E vs sector median and 5-year own average
3. Flag if FCF is positive AND D/E < 0.5 → quality filter
4. Check earnings revision trend (upgrades = positive signal)
5. Score: 1–10 composite fundamental score
6. Cite: Exchange filings, Screener.in, Trendlyne, Moneycontrol
```

---

## SKILL 2 — TECHNICAL ANALYSIS

**Purpose:** Identify current price structure, momentum, and optimal entry/exit zones.

### 2A — Technical State Engine (Primary Indicators)

#### VWAP (Volume Weighted Average Price)
- Price **above VWAP** → bullish intraday/short-term bias
- Price **below VWAP** → bearish / distribution phase
- Use anchored VWAP from last major swing low for positional trades

#### Supertrend (ATR-based trend filter)
- Default settings: Period = 10, Multiplier = 3
- **Green / price above** → uptrend confirmed
- **Red / price below** → downtrend / stay out
- Supertrend flip = potential trend reversal trigger

#### Ichimoku Cloud
| Component | Interpretation |
|---|---|
| Tenkan-sen | Short-term momentum (9-period) |
| Kijun-sen | Medium-term baseline (26-period) |
| Kumo (Cloud) | Support/resistance zone; thick = strong |
| Chikou Span | Lagging confirmation; above price = bullish |
| Senkou Span A > B | Bullish cloud; A < B = bearish cloud |

**Strong Buy Zone:** Price above cloud + Tenkan > Kijun + Chikou above price  
**Strong Sell Zone:** Price below cloud + Tenkan < Kijun

#### RSI / MACD (Supplementary — use only when divergences or extremes present)
- RSI > 60 in uptrend = momentum; RSI < 40 in downtrend = weakness
- Bullish divergence (price falling, RSI rising) = reversal watch
- MACD crossover above zero line = buy signal; below = sell signal
- **Do NOT use RSI/MACD in isolation; always confirm with VWAP + Supertrend**

### 2B — Chart Pattern Analysis

**Patterns to Identify:**
```
Bullish: Cup & Handle, Ascending Triangle, Bull Flag,  
         Inverse H&S, Double Bottom, Higher Highs/Lows
Bearish: Head & Shoulders, Descending Triangle, Bear Flag,  
         Double Top, Lower Highs/Lows
Neutral: Consolidation Range, Symmetrical Triangle (await breakout)
```

**For each stock, output:**
```
- Key Support Levels:     ₹___  /  ₹___
- Key Resistance Levels:  ₹___  /  ₹___
- Pattern Identified:     [pattern name]
- Breakout Level:         ₹___ (confirm with volume)
- Entry Zone:             ₹___ – ₹___
- Stop Loss:              ₹___ (below support / Supertrend)
- Short-term Target:      ₹___ (1–3 months)
- Long-term Target:       ₹___ (12–36 months)
- Signal Confluence Score: X/5 indicators aligned
```

---

## SKILL 3 — MARKET CONDITION SCANNER

**Purpose:** Assess whether the broad market favors risk-on or risk-off positioning.

### Inputs
- Nifty 50 / Sensex trend (above/below 200 DMA?)
- India VIX level (< 14 = calm; > 20 = fear; > 25 = panic)
- Nifty Bank, Midcap 150, Smallcap 250 relative strength
- Advance-Decline ratio (breadth health)
- FII activity in index futures (net long/short)

### Market Regime Output
```
BULL MARKET:    Deploy capital; prefer growth + momentum
CORRECTION:     Accumulate quality in tranches; tighten stops
BEAR MARKET:    Preserve capital; only defensives/cash/gold
SIDEWAYS:       Sector rotation; focus on relative strength
```

---

## SKILL 4 — INDIA GROWTH STORY OVERLAY

**Purpose:** Align stock picks with India's structural multi-year themes.

### Core Themes (2024–2030)
| Theme | Key Sectors/Stocks |
|---|---|
| Infrastructure & CapEx supercycle | Capital goods, cement, steel, roads |
| Digital & AI adoption | IT services, SaaS, fintech, semiconductors |
| PLI-driven manufacturing | Electronics, pharma API, auto components, textiles |
| Energy transition | Green hydrogen, solar EPC, wind, power T&D |
| Financial inclusion | Microfinance, small finance banks, insurance |
| Consumption upgrade | QSR, FMCG premiumization, luxury, travel |
| Defence indigenization | HAL, BEL, DRDO-linked companies |
| Healthcare & diagnostics | Hospitals, medtech, CDMO pharma |

### Algorithm
```
1. Map stock to one or more India growth themes
2. Check if company is direct/indirect beneficiary
3. Assess government policy tailwinds (PLI, NIP, PM schemes)
4. Assign theme alignment score: Strong / Moderate / Weak
```

---

## SKILL 5 — NEWS & INTERNAL COMPANY EVENTS

**Purpose:** Surface material events that could re-rate or de-rate a stock.

### Search Protocol (Run every query — no cached data)
```
Search queries to run:
- "[Company] latest news 2025"
- "[Company] quarterly results earnings"
- "[Company] management guidance outlook"
- "[Company] promoter shareholding pledge"
- "[Company] order wins contracts"
- "[Company] regulatory SEBI CCI action"
- "[Company] merger acquisition stake sale"
```

### Events Checklist
- ✅ Earnings beats/misses vs estimates
- ✅ Management commentary (guidance raised/cut)
- ✅ Promoter buying/selling + pledge %
- ✅ Institutional block deals
- ✅ Board changes, auditor qualifications
- ✅ Regulatory approvals / rejections
- ✅ Major order wins or contract cancellations
- ✅ Litigation / scam / fraud alerts

> **Rule:** All news claims must include citation (source + date). No uncited claims.

---

## SKILL 6 — MACRO & GLOBAL FLOWS

**Purpose:** Understand the liquidity and risk environment driving stock prices.

### Dashboard Inputs
| Factor | Bullish Signal | Bearish Signal |
|---|---|---|
| FII Flows | Net buyers in cash market | Sustained sellers / futures short |
| DII Flows | Buying on FII dip (support) | Both selling = danger zone |
| INR/USD | INR strengthening < 83 | INR weakening > 85+ |
| Crude Oil (Brent) | Below $80/barrel | Above $90/barrel |
| US 10Y Yield | Falling / below 4% | Rising / above 4.5% |
| US Dollar Index (DXY) | DXY falling (EM positive) | DXY rising > 105 |
| Nikkei / Hang Seng | Stable / rising | Sharp fall = risk-off |
| S&P 500 trend | Above 200 DMA | Break below 200 DMA |
| China stimulus | Positive spillover to metals | Slowdown = commodity drag |

### Decision Rule
```
If ≥ 4/8 macro factors = Bearish → Reduce exposure, raise cash
If ≥ 5/8 macro factors = Bullish → Increase exposure, add to winners
Mixed → Stock-specific; prefer large-cap, avoid high-beta
```

---

## SKILL 7 — SECTOR TREND ANALYZER

**Purpose:** Identify which sectors are in leadership and which are lagging.

### Algorithm
```
1. Calculate 1M / 3M / 6M sector returns (Nifty sector indices)
2. Relative strength vs Nifty 50 → rank sectors
3. Identify sectors breaking out vs sectors in distribution
4. Map to macro regime (rate cycle, commodity cycle, budget themes)
5. Output: Top 3 sectors to overweight; Bottom 3 to avoid/underweight
```

### Sector Rotation Matrix
```
Economic Expansion:  Tech, Industrials, Consumer Discretionary
Peak:                Energy, Materials, Healthcare
Contraction:         Utilities, Staples, Healthcare  
Recovery:            Financials, Real Estate, Consumer Discretionary
```

---

## SKILL 8 — ACCUMULATION CUE ENGINE

**Purpose:** Determine whether to act now or wait for a better setup.

### Output Format (Always)
```
VERDICT: [ ACCUMULATE ✅ | WAIT ⏳ | WATCH 👁 ]

ACCUMULATE if:
  - Fundamentals score ≥ 7/10
  - Price above Supertrend + in/above Ichimoku cloud
  - Macro: ≥ 5/8 factors bullish
  - News: No material negative events
  
WAIT if:
  - Price in no-man's land (between support and resistance)
  - Macro mixed; INR weak or crude elevated
  - Earnings results pending (avoid pre-result entry)
  
WATCH if:
  - Fundamentally strong but technically broken
  - Awaiting catalyst (policy, order win, results)
  - Market in correction; wait for VIX to cool

WHAT WOULD CHANGE THE VIEW:
  → Accumulate if: [specific trigger e.g., price holds ₹X support + FII buying resumes]
  → Exit if: [specific stop e.g., close below ₹X / earnings miss > 10%]
```

### Tranche Strategy
```
Tranche 1 (30%): At current levels if ACCUMULATE verdict
Tranche 2 (40%): On dip to next support or after catalyst confirmation
Tranche 3 (30%): On breakout with volume confirmation
```

---

## SKILL 9 — UNDERVALUATION SCREEN

**Purpose:** Identify fundamentally strong stocks trading below fair value.

### Filter Criteria
```
Quantitative Filters:
  - P/E < sector median OR P/E < own 5Y average
  - EPS growth CAGR (3Y) > 15%
  - ROE > 15% consistently
  - D/E < 0.5 (or zero debt preferred)
  - FCF positive for ≥ 3 consecutive years
  - CFO/PAT > 0.8 (earnings quality)
  - Revenue growth > 12% CAGR (3Y)

Qualitative Filters:
  - Promoter holding ≥ 50% (and not pledged)
  - No auditor qualification / SEBI action
  - Moat: brand / distribution / IP / switching cost
  - Addressable market growing (TAM expansion)

Output:
  - Fair Value Estimate (DCF / Graham Number / EV/EBITDA method)
  - Margin of Safety = (Fair Value - CMP) / Fair Value × 100
  - Target: Stocks with Margin of Safety > 20%
```

---

## SKILL 10 — SENTIMENT ANALYSIS

**Purpose:** Gauge market psychology around a stock before making a decision.

### Data Sources
| Source | Signal |
|---|---|
| Social media (X/Twitter, Reddit, Telegram) | Retail buzz; contrarian at extremes |
| Analyst ratings (Bloomberg, Kotak, Motilal) | Consensus direction + target price |
| Institutional activity | FII/DII holding change QoQ |
| Options data | PCR > 1.2 = bullish; < 0.8 = bearish |
| Short interest / F&O OI | Rising OI + price fall = bearish |
| News sentiment score | Positive / Neutral / Negative ratio |

### Sentiment Score Output
```
SENTIMENT: [Strongly Bullish | Mildly Bullish | Neutral | Mildly Bearish | Strongly Bearish]

Components:
  Social Buzz:       [score/10]
  Analyst Consensus: [Buy X | Hold X | Sell X] — Avg Target ₹___
  Institutional:     [Accumulating | Stable | Reducing]
  Options Sentiment: PCR = ___ → [Bullish/Bearish]
  News Score:        [% positive articles last 30 days]

RECOMMENDATION: [ BUY | HOLD | SELL ]
RATIONALE: [2–3 sentence data-driven summary with citations]
```

---

## SKILL 11 — PERSONALIZATION LAYER

**Purpose:** Tailor recommendations to investor profile.

### Configurable Inputs
```yaml
investor_profile:
  risk_appetite: conservative | moderate | aggressive
  holding_period: short (< 6M) | medium (6M–2Y) | long (> 2Y)
  tranche_preference: lump_sum | SIP-style | opportunistic
  sector_tilts:
    overweight: [e.g., infrastructure, pharma]
    underweight: [e.g., PSU banks, real estate]
  vehicle_preference: direct_stocks | ETFs | both
  exclusions: [e.g., tobacco, gambling, high-debt companies]
  tax_constraints:
    ltcg_threshold: ₹1,25,000 (FY2025)
    stcg_preference: minimize short-term churn
  portfolio_size: small (< ₹10L) | medium (₹10L–₹50L) | large (> ₹50L)
```

### Output Customization
- Small portfolio → prefer 5–8 stocks + 1–2 ETFs
- Large portfolio → 15–20 stocks across 6–8 sectors
- Conservative → Weight defensives + dividends; avoid F&O
- Aggressive → Include momentum plays + sector rotators

---

## MULTI-YEAR PERSPECTIVE + NEAR-TERM RISK TRIGGERS

### Long-Term View (2–5 Years)
```
- Business quality score (durable moat?)
- India macro tailwind alignment
- Management track record (10Y ROE consistency)
- Reinvestment rate and capital allocation quality
- Fair Value vs Current Price (% upside to 3Y target)
```

### Near-Term Risk Triggers (Monitor Monthly)
```
Macro:       US recession, Fed pivot reversal, China slowdown
Earnings:    Margin compression, revenue miss, guidance cut
Liquidity:   FII sustained outflow, INR depreciation spiral
Geopolitics: Oil supply shock, India-border tensions, sanctions
Regulatory:  SEBI action, sector-specific policy reversal
Company:     Promoter pledge increase, auditor change, fraud
```

---

## OUTPUT TEMPLATE (Per Stock)

```
══════════════════════════════════════════════
STOCK: [Name] | [NSE: TICKER] | ₹[CMP]
Date: [DD-MM-YYYY] | Sector: [Sector]
══════════════════════════════════════════════

1. FUNDAMENTAL SCORE:     ___/10
   Key Metrics: P/E ___ | ROE ___% | D/E ___ | FCF ₹___Cr

2. TECHNICAL STATE:
   VWAP:        Above ✅ / Below ❌
   Supertrend:  Buy ✅ / Sell ❌
   Ichimoku:    Above cloud ✅ / In cloud ⚠️ / Below ❌
   RSI:         ___ | MACD: Bullish ✅ / Bearish ❌
   Pattern:     [Name] | Support: ₹___ | Resistance: ₹___

3. MARKET CONDITION:      Bull/Correction/Bear/Sideways
   VIX: ___ | Nifty vs 200DMA: Above/Below

4. INDIA GROWTH THEME:    [Theme] | Alignment: Strong/Moderate/Weak

5. NEWS (Cited):
   - [News headline] — [Source, Date]
   - [News headline] — [Source, Date]

6. MACRO SCORE:           ___/8 Bullish
   FII: ___ | DII: ___ | INR: ___ | Crude: $___

7. SECTOR TREND:          Leader / Laggard / Neutral

8. SENTIMENT:             [Rating] | Analyst TP: ₹___
   PCR: ___ | Institutional: Accumulating/Reducing

9. UNDERVALUATION:        Margin of Safety: ___%
   Fair Value: ₹___ | CMP: ₹___

10. VERDICT:
    [ ACCUMULATE ✅ | WAIT ⏳ | WATCH 👁 ]
    Entry Zone:  ₹___ – ₹___
    Stop Loss:   ₹___
    Target 12M:  ₹___
    Target 3Y:   ₹___
    Tranche Plan: T1 __% now | T2 __% at ₹___ | T3 __% on breakout
    What changes view: [Specific trigger]
    Near-term risks: [Top 2-3 risks]
══════════════════════════════════════════════
```

---

## CITATION RULES

> All factual claims, news references, macro data, and analyst targets **must** include:
> `[Source Name] — [URL or publication] — [Date]`

**Preferred Sources:**
- NSE/BSE exchange filings
- SEBI disclosures
- RBI bulletins
- Screener.in, Trendlyne, Tickertape
- Economic Times, Mint, Business Standard, Reuters India
- Kotak, Motilal Oswal, ICICI Securities research reports
- Bloomberg, CNBC TV18

---

*Last updated: March 2026 | Version 1.0*
