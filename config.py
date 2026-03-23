"""
Central configuration for the Indian Stock Screener.
All tunable constants, weights, thresholds, and scoring brackets.
"""
import os

# ============================================================
# PROJECT PATHS
# ============================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
CACHE_DIR = os.path.join(DATA_DIR, "cache")
OUTPUT_DIR = os.path.join(DATA_DIR, "output")
NSE_EQUITY_CSV = os.path.join(DATA_DIR, "nse_equity_list.csv")

# ============================================================
# UNIVERSE FILTERS (Step 1)
# ============================================================
MIN_MARKET_CAP = 500_00_00_000          # Rs 500 Crore = 5,000,000,000
MIN_AVG_DAILY_VOLUME_VALUE = 5_00_000   # Rs 5 Lakh per day
MIN_PRICE = 10                          # Rs 10

# ============================================================
# CACHE SETTINGS
# ============================================================
CACHE_EXPIRY_HOURS = 24
FINANCIALS_CACHE_EXPIRY_HOURS = 168     # 7 days for financials
PRICE_HISTORY_PERIOD = "1y"
ML_PRICE_HISTORY_PERIOD = "3y"         # Longer window for ML training (3x more samples)
ML_CROSS_STOCK_MODEL_DIR = os.path.join(CACHE_DIR, "ml_cross_stock")
ML_CROSS_STOCK_MODEL_MAX_AGE_HOURS = 24  # Retrain cross-stock model every 24h
BATCH_SIZE = 50                         # Tickers per yf.download batch
BATCH_DELAY_SECONDS = 2                 # Delay between batches
MAX_WORKERS = 3                         # Thread pool (lower avoids rate limits)
MAX_RETRIES = 3                         # API call retries

# ============================================================
# RED FLAG THRESHOLDS (Step 2)
# ============================================================
RED_FLAGS = {
    "debt_to_equity_max": 500.0,        # yfinance reports D/E as % (500 = 5.0x)
    "negative_ocf_years": 3,            # 3 consecutive years negative OCF
    "promoter_pledge_pct_max": 80.0,    # >80% promoter shares pledged
    "current_ratio_min": 0.3,           # Severe liquidity crisis
    "continuous_loss_years": 4,         # 4+ years of net losses
    "revenue_decline_years": 3,         # 3+ years continuous revenue decline
    "price_drop_from_high_pct": 70,     # >70% drop from 52-week high
}

# ============================================================
# FUNDAMENTAL SCORING (Step 3)
# ============================================================
# Category weights (must sum to 1.0)
FUNDAMENTAL_WEIGHTS = {
    "profitability":    0.25,
    "growth":           0.25,
    "valuation":        0.20,
    "financial_health": 0.20,
    "dividend_quality": 0.10,
}

# Scoring thresholds: list of (threshold, score) pairs, ascending order
# The score is assigned if value >= threshold (for ascending metrics)
# For descending metrics (lower is better), scoring is inverted in code

PROFITABILITY_THRESHOLDS = {
    "roe": [(-999, 0), (0, 3), (8, 5), (15, 7), (22, 9), (30, 10)],
    "roa": [(-999, 0), (0, 3), (3, 5), (7, 7), (12, 9), (18, 10)],
    "operating_margin": [(-999, 0), (0, 2), (5, 4), (12, 6), (20, 8), (30, 10)],
    "net_profit_margin": [(-999, 0), (0, 2), (3, 4), (8, 6), (15, 8), (25, 10)],
    "ebitda_margin": [(-999, 1), (5, 3), (12, 5), (20, 7), (30, 9)],
}

GROWTH_THRESHOLDS = {
    "revenue_growth": [(-999, 1), (0, 3), (5, 5), (12, 7), (20, 9), (35, 10)],
    "earnings_growth": [(-999, 1), (0, 3), (5, 5), (15, 7), (25, 9), (40, 10)],
    "revenue_cagr_3y": [(-999, 0), (0, 3), (5, 5), (12, 7), (20, 9), (30, 10)],
    "profit_cagr_3y": [(-999, 0), (0, 3), (5, 5), (12, 7), (20, 9), (30, 10)],
}

# Valuation: INVERTED scoring (lower value = higher score)
VALUATION_THRESHOLDS = {
    "trailing_pe": [(0, 0), (0.01, 9), (10, 7), (18, 5), (30, 3), (50, 1)],
    "price_to_book": [(0, 9), (1, 7), (2, 5), (4, 3), (7, 1)],
    "peg_ratio": [(0, 10), (0.5, 8), (1, 6), (1.5, 4), (2.5, 2)],
    "ev_to_ebitda": [(0, 9), (5, 7), (10, 5), (18, 3), (30, 1)],
}

FINANCIAL_HEALTH_THRESHOLDS = {
    "debt_to_equity": [(0, 10), (10, 8), (30, 6), (60, 4), (100, 2), (200, 0)],
    "current_ratio": [(-999, 0), (0.5, 3), (1, 5), (1.5, 7), (2, 9), (3, 8)],
    "interest_coverage": [(-999, 0), (1, 2), (2, 5), (4, 7), (8, 10)],
    "fcf_yield": [(-999, 0), (0, 3), (2, 5), (5, 7), (8, 9)],
}

DIVIDEND_THRESHOLDS = {
    "dividend_yield": [(0, 2), (0.001, 4), (1, 6), (2.5, 8), (5, 7)],
    "payout_ratio": [(-999, 0), (0, 5), (20, 8), (40, 7), (60, 5), (80, 3)],
}

# ============================================================
# TECHNICAL SCORING (Step 4)
# ============================================================
TECHNICAL_WEIGHTS = {
    "trend":              0.35,
    "momentum":           0.30,
    "volume":             0.20,
    "relative_strength":  0.15,
}

# EMA windows
EMA_SHORT = 20
EMA_MEDIUM = 50
EMA_LONG = 200

# RSI scoring brackets
RSI_THRESHOLDS = [(0, 2), (30, 3), (40, 5), (50, 7), (60, 8), (70, 6), (80, 3)]

# ADX scoring brackets
ADX_THRESHOLDS = [(0, 2), (15, 5), (25, 8), (40, 10)]

# ROC scoring brackets (20-day rate of change in %)
ROC_THRESHOLDS = [(-999, 1), (-5, 3), (0, 5), (5, 7), (10, 9)]

# NIFTY 50 benchmark ticker
NIFTY50_TICKER = "^NSEI"

# Relative strength scoring
RS_THRESHOLDS = [(0, 2), (0.5, 4), (1.0, 6), (1.5, 8), (2.0, 10)]

# ============================================================
# COMPOSITE RANKING (Step 5)
# ============================================================
COMPOSITE_FUNDAMENTAL_WEIGHT = 0.80
COMPOSITE_TECHNICAL_WEIGHT = 0.20

# ============================================================
# DEEP DIVE (Step 6)
# ============================================================
QUALITATIVE_WEIGHTS = {
    "management_quality":  0.25,    # Reduced to accommodate strategy_alignment
    "competitive_moat":    0.25,    # Reduced to accommodate strategy_alignment
    "growth_catalysts":    0.20,    # Reduced to accommodate strategy_alignment
    "governance":          0.15,
    "strategy_alignment":  0.15,    # Bandhan AMC: sector fit, TAM, capital allocation
}

# Final ranking: composite + qualitative
FINAL_COMPOSITE_WEIGHT = 0.70
FINAL_QUALITATIVE_WEIGHT = 0.30

# ============================================================
# TRADING SIGNAL STRATEGY (from AI-Stock-Trader)
# ============================================================
SIGNAL_STRATEGY = {
    "take_profit_pct": 5.0,           # 5% profit target
    "stop_loss_pct": 1.0,             # 1% stop loss (tight)
    "trailing_stop_loss_pct": 3.0,    # 3% trailing stop for swing trades
    "rsi_period": 14,
    "stochrsi_period": 14,
    "stochrsi_smooth_k": 3,
    "stochrsi_smooth_d": 3,
    "macd_fast": 12,
    "macd_slow": 26,
    "macd_signal": 9,
    "rsi_overbought": 70,
    "rsi_oversold": 30,
    "stochrsi_overbought": 80,
    "stochrsi_oversold": 20,
}

# ============================================================
# OUTPUT SETTINGS
# ============================================================
TOP_N_DEEP_DIVE = 50
TOP_N_FINAL = 20

# ============================================================
# ============================================================
# AUTH — single-user login gate
# Password is stored as a PBKDF2-SHA256 hash (never plaintext).
# To change password: run scripts/gen_auth_hash.py and update AUTH_PW_HASH.
# ============================================================
AUTH_EMAIL    = os.environ.get("AUTH_EMAIL",    "pankaj.mahesh@gmail.com")
AUTH_PW_HASH  = os.environ.get("AUTH_PW_HASH",  "ce96d12c5bc362ec896648af27b547917c545b5f9fc98322db7df853c14f34ba")
AUTH_PW_SALT  = os.environ.get("AUTH_PW_SALT",  "screener_2024_salt")
AUTH_SECRET   = os.environ.get("AUTH_SECRET",   "c4921a47a6b20aca541733033a7c74fd980ae0752241f8d086a5a4da4372e071")

# ============================================================
# EMAIL NOTIFICATIONS
# Leave SMTP_HOST empty to disable email delivery silently.
# ============================================================
SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USERNAME = os.environ.get("SMTP_USERNAME", "").strip()
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_USE_TLS = os.environ.get("SMTP_USE_TLS", "true").strip().lower() in {"1", "true", "yes", "on"}
SMTP_FROM_EMAIL = os.environ.get("SMTP_FROM_EMAIL", SMTP_USERNAME or AUTH_EMAIL).strip()
ADMIN_NOTIFY_EMAIL = os.environ.get("ADMIN_NOTIFY_EMAIL", AUTH_EMAIL).strip()

# ============================================================
# NSE PROXY (real-time data via stock-market-india)
# ============================================================
NSE_PROXY_URL = "http://127.0.0.1:3100"
NSE_PROXY_TIMEOUT = 15

# ============================================================
# GROWW API (primary real-time data source)
# ============================================================
# Generate your access token at: groww.in/user/profile/trading-apis
# Token expires daily at 6:00 AM IST — refresh via Groww profile.
GROWW_API_URL = "https://api.groww.in/v1"
GROWW_API_TOKEN = os.environ.get("GROWW_API_TOKEN", "eyJraWQiOiJaTUtjVXciLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjI1NjIzOTcxMDIsImlhdCI6MTc3Mzk5NzEwMiwibmJmIjoxNzczOTk3MTAyLCJzdWIiOiJ7XCJ0b2tlblJlZklkXCI6XCJhOWZkMjA2OC04YmQzLTQzZTMtOWU4MS1jZGZiNDU4YmFhNTVcIixcInZlbmRvckludGVncmF0aW9uS2V5XCI6XCJlMzFmZjIzYjA4NmI0MDZjODg3NGIyZjZkODQ5NTMxM1wiLFwidXNlckFjY291bnRJZFwiOlwiOWM4MzViZGQtOWFiOS00YmYxLWJkOWYtNDZjYjQyNzA1OWQzXCIsXCJkZXZpY2VJZFwiOlwiMTYwN2Q0ZjQtZTA0OS01NGI3LTlhYzAtZTMwZmFlNjQyYTkxXCIsXCJzZXNzaW9uSWRcIjpcIjE1OWQ2MDI4LTZkZWQtNDZjMy1hYTZlLTVlNzdjNDQ1YmJhNlwiLFwiYWRkaXRpb25hbERhdGFcIjpcIno1NC9NZzltdjE2WXdmb0gvS0EwYkV0Yi9BQUwzZWtMQzVjMHV2UVM3dWhSTkczdTlLa2pWZDNoWjU1ZStNZERhWXBOVi9UOUxIRmtQejFFQisybTdRPT1cIixcInJvbGVcIjpcImF1dGgtdG90cFwiLFwic291cmNlSXBBZGRyZXNzXCI6XCIyNDA1OjIwMTo0MDE4OmExYmM6ZjAyMDplMzcxOjZhMjk6ODMyZCwxNjIuMTU5LjEyNi4xNTcsMzUuMjQxLjIzLjEyM1wiLFwidHdvRmFFeHBpcnlUc1wiOjI1NjIzOTcxMDIxNzMsXCJ2ZW5kb3JOYW1lXCI6XCJncm93d0FwaVwifSIsImlzcyI6ImFwZXgtYXV0aC1wcm9kLWFwcCJ9.MYF4jm8ZfhQpq_B0hVQgYMbolFatN8P0GlP3i9TKUZz_bFbAASHOI2Uxjs66EVgaE1ENHglpnekswLM36v3e3w")
GROWW_API_SECRET = os.environ.get("GROWW_API_SECRET", "n&9HWQfxyrbCC3_NAoz@sMBpeTl^MQv-")
GROWW_EXCHANGE = "NSE"
GROWW_SEGMENT = "CASH"

# ============================================================
# PORTFOLIOS
# ============================================================
PORTFOLIOS = {
    "main": {
        "label": "My Portfolio",
        "stocks": [
            "ABB", "APOLLOHOSP", "BRITANNIA", "BSE", "CDSL", "CHOLAFIN",
            "CUMMINSIND", "DELHIVERY", "DIXON", "EBBETF0433", "EICHERMOT",
            "GRSE", "GODFRYPHLP", "HCLTECH", "HDFCAMC", "HDFCNEXT50",
            "HDFCMOMENT", "HEROMOTOCO", "HAL", "ICICIBANK", "INDHOTEL",
            "NAUKRI", "INDIGO", "ITC", "JIOFIN", "KEI", "LT", "M&M",
            "MAZDOCK", "LOWVOL", "MAFANG", "MOM100", "MON100", "NETWEB",
            "NIFTYBEES", "NTPC", "POLICYBZR", "PERSISTENT", "RATEGAIN",
            "RELIANCE", "SAFARI", "SBIN", "TMCV", "TITAGARH", "TITAN",
            "HDFCSILVER", "SIEMENS", "CIPLA", "ARE&M",
        ],
    },
    "sharekhan": {
        "label": "Sharekhan",
        "stocks": [
            "ANANTRAJ", "BHARTIHEXA", "BLSE", "CDSL", "CGPOWER",
            "DAMCAPITAL", "GRAVITA", "GRSE", "HBLENGINE", "INDHOTEL",
            "INDRAMEDCO", "MAXHEALTH", "MTARTECH", "NSDL", "PIXTRANS",
            "QPOWER", "UNIECOM", "URBANCO", "WAAREEENER", "ZAGGLE",
        ],
    },
    "midcap150": {
        "label": "Nifty Midcap 150",
        "stocks": [
            "360ONE", "3MINDIA", "ACC", "AIAENG", "APLAPOLLO", "AUBANK",
            "AWL", "ABBOTINDIA", "ATGL", "ABCAPITAL", "AJANTPHARM", "ALKEM",
            "APARINDS", "APOLLOTYRE", "ASHOKLEY", "ASTRAL", "AUROPHARMA",
            "BSE", "BALKRISIND", "BANKINDIA", "MAHABANK", "BERGEPAINT",
            "BDL", "BHARATFORG", "BHEL", "BHARTIHEXA", "BIOCON", "BLUESTARCO",
            "CRISIL", "COCHINSHIP", "COFORGE", "COLPAL", "CONCOR", "COROMANDEL",
            "CUMMINSIND", "DABUR", "DALBHARAT", "DEEPAKNTR", "DIXON",
            "ENDURANCE", "ESCORTS", "EXIDEIND", "NYKAA", "FEDERALBNK", "FACT",
            "FORTIS", "GMRAIRPORT", "GICRE", "GLAXO", "GLENMARK", "MEDANTA",
            "GODFRYPHLP", "GODREJIND", "GODREJPROP", "FLUOROCHEM", "GUJGASLTD",
            "HDFCAMC", "HEROMOTOCO", "HEXT", "HINDPETRO", "POWERINDIA",
            "HONAUT", "HUDCO", "ICICIPRULI", "IDBI", "IDFCFIRSTB", "IRB",
            "ITCHOTELS", "INDIANB", "IOB", "IRCTC", "IREDA", "IGL",
            "INDUSTOWER", "INDUSINDBK", "IPCALAB", "JKCEMENT", "JSWINFRA",
            "JSL", "JUBLFOOD", "KPRMILL", "KEI", "KPITTECH", "KALYANKJIL",
            "LTF", "LTTS", "LICHSGFIN", "LINDEINDIA", "LLOYDSME", "LUPIN",
            "MRF", "MANKIND", "MARICO", "MFSL", "MOTILALOFS", "MPHASIS",
            "MUTHOOTFIN", "NHPC", "NLCINDIA", "NMDC", "NTPCGREEN", "NATIONALUM",
            "OBEROIRLTY", "OIL", "PAYTM", "OFSS", "POLICYBZR", "PIIND",
            "PAGEIND", "PATANJALI", "PERSISTENT", "PETRONET", "PHOENIXLTD",
            "POLYCAB", "PREMIERENE", "PRESTIGE", "PGHH", "RVNL", "SBICARD",
            "SJVN", "SRF", "SCHAEFFLER", "SONACOMS", "SAIL", "SUNDARMFIN",
            "SUPREMEIND", "SUZLON", "SWIGGY", "SYNGENE", "TATACOMM",
            "TATAELXSI", "TATAINVEST", "TATATECH", "NIACL", "THERMAX",
            "TORNTPOWER", "TIINDIA", "UCOBANK", "UNOMINDA", "UPL", "UNIONBANK",
            "UBL", "VMM", "IDEA", "VOLTAS", "WAAREEENER", "YESBANK",
        ],
    },
    "largemidcap250": {
        "label": "Nifty LargeMidcap 250",
        "stocks": [
            "360ONE", "3MINDIA", "ABB", "ACC", "AIAENG", "APLAPOLLO", "AUBANK",
            "AWL", "ABBOTINDIA", "ADANIENSOL", "ADANIENT", "ADANIGREEN",
            "ADANIPORTS", "ADANIPOWER", "ATGL", "ABCAPITAL", "AJANTPHARM",
            "ALKEM", "AMBUJACEM", "APARINDS", "APOLLOHOSP", "APOLLOTYRE",
            "ASHOKLEY", "ASIANPAINT", "ASTRAL", "AUROPHARMA", "DMART",
            "AXISBANK", "BSE", "BAJAJ-AUTO", "BAJFINANCE", "BAJAJFINSV",
            "BAJAJHLDNG", "BAJAJHFL", "BALKRISIND", "BANKBARODA", "BANKINDIA",
            "MAHABANK", "BERGEPAINT", "BDL", "BEL", "BHARATFORG", "BHEL",
            "BPCL", "BHARTIARTL", "BHARTIHEXA", "BIOCON", "BLUESTARCO",
            "BOSCHLTD", "BRITANNIA", "CGPOWER", "CRISIL", "CANBK", "CHOLAFIN",
            "CIPLA", "COALINDIA", "COCHINSHIP", "COFORGE", "COLPAL", "CONCOR",
            "COROMANDEL", "CUMMINSIND", "DLF", "DABUR", "DALBHARAT",
            "DEEPAKNTR", "DIVISLAB", "DIXON", "DRREDDY", "EICHERMOT",
            "ENDURANCE", "ESCORTS", "ETERNAL", "EXIDEIND", "NYKAA",
            "FEDERALBNK", "FACT", "FORTIS", "GAIL", "GVT&D", "GMRAIRPORT",
            "GICRE", "GLAXO", "GLENMARK", "MEDANTA", "GODFRYPHLP", "GODREJCP",
            "GODREJIND", "GODREJPROP", "GRASIM", "FLUOROCHEM", "GUJGASLTD",
            "HCLTECH", "HDFCAMC", "HDFCBANK", "HDFCLIFE", "HAVELLS",
            "HEROMOTOCO", "HEXT", "HINDALCO", "HAL", "HINDPETRO", "HINDUNILVR",
            "HINDZINC", "POWERINDIA", "HONAUT", "HUDCO", "HYUNDAI",
            "ICICIBANK", "ICICIGI", "ICICIPRULI", "IDBI", "IDFCFIRSTB", "IRB",
            "ITCHOTELS", "ITC", "INDIANB", "INDHOTEL", "IOC", "IOB", "IRCTC",
            "IRFC", "IREDA", "IGL", "INDUSTOWER", "INDUSINDBK", "NAUKRI",
            "INFY", "INDIGO", "IPCALAB", "JKCEMENT", "JSWENERGY", "JSWINFRA",
            "JSWSTEEL", "JSL", "JINDALSTEL", "JIOFIN", "JUBLFOOD", "KPRMILL",
            "KEI", "KPITTECH", "KALYANKJIL", "KOTAKBANK", "LTF", "LTTS",
            "LICHSGFIN", "LTIM", "LT", "LICI", "LINDEINDIA", "LLOYDSME",
            "LODHA", "LUPIN", "MRF", "M&MFIN", "M&M", "MANKIND", "MARICO",
            "MARUTI", "MFSL", "MAXHEALTH", "MAZDOCK", "MOTILALOFS", "MPHASIS",
            "MUTHOOTFIN", "NHPC", "NLCINDIA", "NMDC", "NTPCGREEN", "NTPC",
            "NATIONALUM", "NESTLEIND", "NAM-INDIA", "OBEROIRLTY", "ONGC",
            "OIL", "PAYTM", "OFSS", "POLICYBZR", "PIIND", "PAGEIND",
            "PATANJALI", "PERSISTENT", "PETRONET", "PHOENIXLTD", "PIDILITIND",
            "POLYCAB", "PFC", "POWERGRID", "PREMIERENE", "PRESTIGE", "PGHH",
            "PNB", "RECLTD", "RVNL", "RELIANCE", "SBICARD", "SBILIFE",
            "SJVN", "SRF", "MOTHERSON", "SCHAEFFLER", "SHREECEM", "SHRIRAMFIN",
            "ENRIN", "SIEMENS", "SOLARINDS", "SONACOMS", "SBIN", "SAIL",
            "SUNPHARMA", "SUNDARMFIN", "SUPREMEIND", "SUZLON", "SWIGGY",
            "SYNGENE", "TVSMOTOR", "TATACOMM", "TCS", "TATACONSUM",
            "TATAELXSI", "TATAINVEST", "TMPV", "TATAPOWER", "TATASTEEL",
            "TATATECH", "TECHM", "NIACL", "THERMAX", "TITAN", "TORNTPHARM",
            "TORNTPOWER", "TRENT", "TIINDIA", "UCOBANK", "UNOMINDA", "UPL",
            "ULTRACEMCO", "UNIONBANK", "UBL", "UNITDSPR", "VBL", "VEDL",
            "VMM", "IDEA", "VOLTAS", "WAAREEENER", "WIPRO", "YESBANK",
            "ZYDUSLIFE",
        ],
    },
    "smallcap250": {
        "label": "Nifty Smallcap 250",
        "stocks": [
            "ACMESOLAR", "AADHARHFC", "AARTIIND", "AAVAS", "ACE", "ABFRL",
            "ABLBL", "ABREL", "ABSLAMC", "AEGISLOG", "AEGISVOPAK", "AFCONS",
            "AFFLE", "AKUMS", "AKZOINDIA", "APLLTD", "ALKYLAMINE", "ALOKINDS",
            "ARE&M", "AMBER", "ANANDRATHI", "ANANTRAJ", "ANGELONE", "APTUS",
            "ASAHIINDIA", "ASTERDM", "ASTRAZEN", "ATHERENERG", "ATUL", "AIIL",
            "BASF", "BEML", "BLS", "BALRAMCHIN", "BANDHANBNK", "BATAINDIA",
            "BAYERCROP", "BIKAJI", "BSOFT", "BLUEDART", "BLUEJET", "BBTC",
            "FIRSTCRY", "BRIGADE", "MAPMYINDIA", "CCL", "CESC", "CAMPUS",
            "CANFINHOME", "CAPLIPOINT", "CGCL", "CARBORUNIV", "CASTROLIND",
            "CEATLTD", "CENTRALBK", "CDSL", "CENTURYPLY", "CERA", "CHALET",
            "CHAMBLFERT", "CHENNPETRO", "CHOICEIN", "CHOLAHLDNG", "CUB",
            "CLEAN", "COHANCE", "CAMS", "CONCORDBIO", "CRAFTSMAN", "CREDITACC",
            "CROMPTON", "CYIENT", "DCMSHRIRAM", "DOMS", "DATAPATTNS",
            "DEEPAKFERT", "DELHIVERY", "DEVYANI", "AGARWALEYE", "LALPATHLAB",
            "EIDPARRY", "EIHOTEL", "ELECON", "ELGIEQUIP", "EMAMILTD", "EMCURE",
            "ENGINERSIN", "ERIS", "FINCABLES", "FINPIPE", "FSL", "FIVESTAR",
            "FORCEMOT", "GRSE", "GILLETTE", "GLAND", "GODIGIT", "GPIL",
            "GODREJAGRO", "GRANULES", "GRAPHITE", "GRAVITA", "GESHIP",
            "GMDCLTD", "GSPL", "HEG", "HBLENGINE", "HFCL", "HAPPSTMNDS",
            "HSCL", "HINDCOPPER", "HOMEFIRST", "HONASA", "IFCI", "IIFL",
            "INOXINDIA", "IRCON", "ITI", "INDGN", "INDIACEM", "INDIAMART",
            "IEX", "INOXWIND", "INTELLECT", "IGIL", "IKS", "JBCHEPHARM",
            "JBMA", "JKTYRE", "JMFINANCIL", "JSWCEMENT", "JPPOWER", "J&KBANK",
            "JINDALSAW", "JUBLINGREA", "JUBLPHARMA", "JWL", "JYOTHYLAB",
            "JYOTICNC", "KSB", "KAJARIACER", "KPIL", "KARURVYSYA", "KAYNES",
            "KEC", "KFINTECH", "KIRLOSBROS", "KIRLOSENG", "KIMS", "LTFOODS",
            "LATENTVIEW", "LAURUSLABS", "THELEELA", "LEMONTREE", "MMTC", "MGL",
            "MAHSCOOTER", "MAHSEAMLES", "MANAPPURAM", "MRPL", "METROPOLIS",
            "MINDACORP", "MSUMI", "MCX", "NATCOPHARM", "NBCC", "NCC",
            "NSLNISP", "NH", "NAVA", "NAVINFLUOR", "NETWEB", "NEULANDLAB",
            "NEWGEN", "NIVABUPA", "NUVAMA", "NUVOCO", "OLAELEC", "OLECTRA",
            "ONESOURCE", "PCBL", "PGEL", "PNBHOUSING", "PTCIL", "PVRINOX",
            "PFIZER", "PPLPHARMA", "POLYMED", "POONAWALLA", "PRAJIND",
            "RRKABEL", "RBLBANK", "RHIM", "RITES", "RADICO", "RAILTEL",
            "RAINBOW", "RKFORGE", "RCF", "REDINGTON", "RELINFRA", "RPOWER",
            "SBFC", "SAGILITY", "SAILIFE", "SAMMAANCAP", "SAPPHIRE", "SARDAEN",
            "SAREGAMA", "SCHNEIDER", "SCI", "SHYAMMETL", "SIGNATURE", "SOBHA",
            "SONATSOFTW", "STARHEALTH", "SUMICHEM", "SUNTV", "SUNDRMFAST",
            "SWANCORP", "SYRMA", "TBOTEK", "TATACHEM", "TTML", "TECHNOE",
            "TEJASNET", "RAMCOCEM", "TIMKEN", "TITAGARH", "TARIL", "TRIDENT",
            "TRIVENI", "TRITURBINE", "UTIAMC", "USHAMART", "VGUARD",
            "DBREALTY", "VTL", "MANYAVAR", "VENTIVE", "VIJAYA", "WELCORP",
            "WELSPUNLIV", "WHIRLPOOL", "WOCKPHARMA", "ZFCVINDIA", "ZEEL",
            "ZENTEC", "ZENSARTECH", "ECLERX",
        ],
    },
}
# Backward compat
MY_PORTFOLIO = PORTFOLIOS["main"]["stocks"]

# ============================================================
# BANDHAN AMC STRATEGY: STOCK QUALITY CLASSIFICATION (L1/L2/L3)
# L1: High-quality structural businesses (HDFC Bank, DMart, HUL)
# L2: Medium quality, cyclical/transitional (Cummins, Eicher)
# L3: Lower quality, highly cyclical (SAIL, Bank of Baroda, Ashok Leyland)
# ============================================================

# Sector → base L-category mapping (from yfinance sector names)
SECTOR_L_CATEGORY = {
    "Consumer Defensive":       "L1",   # FMCG: HUL, Nestlé, ITC
    "Healthcare":               "L1",   # Branded pharma, hospitals
    "Consumer Cyclical":        "L2",   # Auto, Consumer Durables
    "Industrials":              "L2",   # Engineering, Capital Goods
    "Technology":               "L2",   # IT (refined by quality)
    "Communication Services":   "L2",   # Telecom, Media
    "Real Estate":              "L2",   # Capital-intensive
    "Basic Materials":          "L3",   # Steel, Metals, Bulk Chemicals
    "Energy":                   "L3",   # Oil & Gas, Refiners
    "Utilities":                "L3",   # Power (linear growth)
    # Financial Services classified by sub-sector quality
}

# Metric thresholds to upgrade L2 → L1 (strong quality)
L_CATEGORY_UPGRADE_THRESHOLDS = {
    "roe_min": 20.0,                # ROE > 20%
    "operating_margin_min": 15.0,  # Op margin > 15%
    "de_max": 50.0,                 # D/E < 50%
}

# Metric thresholds to downgrade toward L3 (weak quality)
L_CATEGORY_DOWNGRADE_THRESHOLDS = {
    "roe_max": 8.0,                 # ROE < 8%
    "de_min": 100.0,                # D/E > 100%
}

# ─── Sector Preference Multipliers (Bandhan 3-5yr view) ──────────────────────
# Preferred: Manufacturing, Auto, Chemicals, Financial Services (non-PSU)
# Cautious: Traditional IT, Oil/Gas, PSU Utilities
SECTOR_PREFERENCE_MULTIPLIER = {
    "Industrials":              1.10,   # Manufacturing, Engineering — MOST PREFERRED
    "Consumer Cyclical":        1.07,   # Auto, Consumer Durables
    "Financial Services":       1.05,   # Capital markets, NBFCs, AMCs, Insurance
    "Basic Materials":          1.03,   # Specialty Chemicals (selective)
    "Healthcare":               1.02,   # Stable
    "Consumer Defensive":       1.00,   # Neutral — quality but slower growth
    "Real Estate":              0.97,   # Wait for right price
    "Communication Services":   0.97,   # Neutral-cautious
    "Technology":               0.93,   # Cautious — IT services automation risk
    "Energy":                   0.90,   # Cautious — oil refiners
    "Utilities":                0.88,   # Avoid — linear growth only
}

# ============================================================
# API SERVER
# ============================================================
API_HOST = "127.0.0.1"
API_PORT = 5001
