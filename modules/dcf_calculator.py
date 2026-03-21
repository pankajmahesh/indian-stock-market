"""
DCF (Discounted Cash Flow) Intrinsic Value Calculator.

Computes intrinsic value per share using:
  1. Historical Free Cash Flow from financial statements
  2. Projected FCF growth (from historical CAGR or earnings growth)
  3. WACC as discount rate (India default ~11%)
  4. Terminal value using Gordon Growth Model
  5. Net debt adjustment (total debt - cash)

Formula:
  Intrinsic Value = (PV of projected FCFs + PV of Terminal Value - Net Debt)
                    / Shares Outstanding
"""
import math
import numpy as np
import yfinance as yf

from utils.logger import log


# Defaults tuned for Indian market
DEFAULT_WACC = 0.11              # 11% — typical for Indian mid/large caps
DEFAULT_TERMINAL_GROWTH = 0.03   # 3% perpetual growth (≈ India long-term GDP growth)
PROJECTION_YEARS = 5
MIN_FCF_FOR_DCF = 1e6           # Min Rs 10 lakh FCF to attempt DCF
MAX_GROWTH_RATE = 0.35          # Cap FCF growth at 35%
MIN_GROWTH_RATE = -0.05         # Floor at -5%
MARGIN_OF_SAFETY = 0.0          # 0% — show raw intrinsic value, let UI show margin


class DCFCalculator:
    """Calculate intrinsic value of a stock using Discounted Cash Flow."""

    def calculate(self, symbol, info=None, financials=None):
        """
        Compute DCF intrinsic value for a single stock.

        Args:
            symbol: NSE symbol (with or without .NS suffix)
            info: yfinance ticker.info dict (fetched if None)
            financials: dict with 'cashflow', 'balance_sheet' keys (fetched if None)

        Returns:
            dict with intrinsic_value, dcf_upside_pct, and breakdown, or None on failure
        """
        if not symbol.endswith(".NS"):
            symbol += ".NS"

        try:
            ticker = None
            if info is None or financials is None:
                ticker = yf.Ticker(symbol)

            if info is None:
                info = ticker.info or {}

            if financials is None:
                financials = {
                    "cashflow": ticker.cashflow,
                    "balance_sheet": ticker.balance_sheet,
                }

            cmp = info.get("currentPrice") or info.get("regularMarketPrice")
            shares = info.get("sharesOutstanding")
            if not cmp or not shares or shares <= 0:
                return None

            # --- Currency conversion (some Indian stocks report financials in USD) ---
            fx_rate = 1.0
            fin_currency = (info.get("financialCurrency") or "INR").upper()
            price_currency = (info.get("currency") or "INR").upper()
            if fin_currency != price_currency:
                if fin_currency == "USD" and price_currency == "INR":
                    fx_rate = 84.0  # Approximate USD/INR rate
                elif fin_currency == "INR" and price_currency == "USD":
                    fx_rate = 1.0 / 84.0

            # --- Extract historical FCF ---
            fcf_values = self._get_historical_fcf(financials.get("cashflow"), info)
            if not fcf_values or fcf_values[-1] <= MIN_FCF_FOR_DCF:
                return None

            # Apply currency conversion to FCF values
            if fx_rate != 1.0:
                fcf_values = [v * fx_rate for v in fcf_values]

            # --- FCF growth rate ---
            fcf_growth = self._estimate_fcf_growth(fcf_values, info)

            # --- WACC estimate ---
            wacc = self._estimate_wacc(info)

            # --- Project future FCFs ---
            current_fcf = fcf_values[-1]  # Most recent year
            projected_fcfs = []
            for year in range(1, PROJECTION_YEARS + 1):
                projected = current_fcf * ((1 + fcf_growth) ** year)
                projected_fcfs.append(projected)

            # --- Terminal Value (Gordon Growth Model) ---
            terminal_fcf = projected_fcfs[-1] * (1 + DEFAULT_TERMINAL_GROWTH)
            if wacc <= DEFAULT_TERMINAL_GROWTH:
                return None  # Model breaks down
            terminal_value = terminal_fcf / (wacc - DEFAULT_TERMINAL_GROWTH)

            # --- Present Value calculation ---
            pv_fcfs = sum(
                fcf / ((1 + wacc) ** year)
                for year, fcf in enumerate(projected_fcfs, 1)
            )
            pv_terminal = terminal_value / ((1 + wacc) ** PROJECTION_YEARS)

            enterprise_value = pv_fcfs + pv_terminal

            # --- Net debt adjustment (convert if needed) ---
            net_debt = self._get_net_debt(financials.get("balance_sheet"), info)
            net_debt *= fx_rate

            equity_value = enterprise_value - net_debt
            if equity_value <= 0:
                return None

            intrinsic_per_share = equity_value / shares
            intrinsic_per_share = round(intrinsic_per_share, 2)

            dcf_upside = round((intrinsic_per_share - cmp) / cmp * 100, 1)

            return {
                "intrinsic_value": intrinsic_per_share,
                "dcf_upside_pct": dcf_upside,
                "wacc_used": round(wacc * 100, 1),
                "fcf_growth_used": round(fcf_growth * 100, 1),
                "terminal_growth": round(DEFAULT_TERMINAL_GROWTH * 100, 1),
                "current_fcf_cr": round(current_fcf / 1e7, 1),
                "projection_years": PROJECTION_YEARS,
            }

        except Exception as e:
            log.debug(f"DCF failed for {symbol}: {e}")
            return None

    def _get_historical_fcf(self, cashflow_df, info):
        """Extract historical FCF values from cashflow statement (oldest to newest)."""
        fcf_values = []

        if cashflow_df is not None and not cashflow_df.empty:
            # yfinance cashflow: rows are line items, columns are years (newest first)
            fcf_row = None
            for label in ["Free Cash Flow", "FreeCashFlow"]:
                if label in cashflow_df.index:
                    fcf_row = cashflow_df.loc[label]
                    break

            if fcf_row is None:
                # Compute: Operating Cash Flow - Capital Expenditure
                ocf_row = None
                capex_row = None
                for label in ["Operating Cash Flow", "Total Cash From Operating Activities"]:
                    if label in cashflow_df.index:
                        ocf_row = cashflow_df.loc[label]
                        break
                for label in ["Capital Expenditure", "Capital Expenditures"]:
                    if label in cashflow_df.index:
                        capex_row = cashflow_df.loc[label]
                        break
                if ocf_row is not None and capex_row is not None:
                    fcf_row = ocf_row + capex_row  # capex is negative

            if fcf_row is not None:
                for val in reversed(fcf_row.values):  # Reverse to get oldest first
                    if val is not None and not (isinstance(val, float) and math.isnan(val)):
                        fcf_values.append(float(val))

        # Fallback: use info freeCashflow as single data point
        if not fcf_values:
            fcf_info = info.get("freeCashflow")
            if fcf_info and not (isinstance(fcf_info, float) and math.isnan(fcf_info)):
                fcf_values = [float(fcf_info)]

        return fcf_values

    def _estimate_fcf_growth(self, fcf_values, info):
        """Estimate FCF growth rate from historical data or earnings growth."""
        growth = None

        # Method 1: Historical FCF CAGR (if 2+ years of data)
        if len(fcf_values) >= 2 and fcf_values[0] > 0 and fcf_values[-1] > 0:
            years = len(fcf_values) - 1
            cagr = (fcf_values[-1] / fcf_values[0]) ** (1.0 / years) - 1
            if not math.isnan(cagr) and not math.isinf(cagr):
                growth = cagr

        # Method 2: Blend with earnings growth from yfinance
        earnings_growth = info.get("earningsGrowth")
        revenue_growth = info.get("revenueGrowth")

        if growth is not None and earnings_growth is not None:
            # Blend: 60% historical FCF CAGR, 40% earnings growth
            growth = 0.6 * growth + 0.4 * earnings_growth
        elif growth is None:
            # Use earnings growth or revenue growth as proxy
            if earnings_growth is not None:
                growth = earnings_growth
            elif revenue_growth is not None:
                growth = revenue_growth * 0.8  # Discount revenue growth
            else:
                growth = 0.08  # Conservative default: 8%

        # Clamp to reasonable range
        growth = max(MIN_GROWTH_RATE, min(MAX_GROWTH_RATE, growth))
        return growth

    def _estimate_wacc(self, info):
        """
        Estimate WACC based on company characteristics.

        Simplified approach for Indian stocks:
        - Base risk-free rate: ~7% (India 10Y govt bond)
        - Equity risk premium: ~6%
        - Beta adjustment
        - Size premium for smaller companies
        """
        beta = info.get("beta") or 1.0
        if isinstance(beta, float) and (math.isnan(beta) or math.isinf(beta)):
            beta = 1.0
        beta = max(0.5, min(2.0, beta))  # Clamp beta

        risk_free = 0.07    # India 10Y bond yield ~7%
        equity_premium = 0.06  # Equity risk premium for India

        # Cost of equity (CAPM)
        cost_of_equity = risk_free + beta * equity_premium

        # Simple WACC — approximate debt cost and weight
        de_ratio = info.get("debtToEquity")
        if de_ratio is not None and not (isinstance(de_ratio, float) and math.isnan(de_ratio)):
            de_ratio = de_ratio / 100.0  # yfinance reports as percentage
            de_ratio = max(0, min(5.0, de_ratio))  # Cap
            cost_of_debt = 0.09  # ~9% average borrowing cost in India
            tax_rate = 0.25      # ~25% corporate tax
            weight_debt = de_ratio / (1 + de_ratio)
            weight_equity = 1 - weight_debt
            wacc = weight_equity * cost_of_equity + weight_debt * cost_of_debt * (1 - tax_rate)
        else:
            wacc = cost_of_equity

        # Size premium for smaller companies
        mcap = info.get("marketCap") or 0
        if mcap < 5000e7:       # < 5000 Cr
            wacc += 0.02        # +2% small cap premium
        elif mcap < 20000e7:    # < 20000 Cr
            wacc += 0.01        # +1% mid cap premium

        return max(0.08, min(0.20, wacc))  # Floor 8%, cap 20%

    def _get_net_debt(self, balance_sheet_df, info):
        """Calculate net debt = total debt - cash & equivalents."""
        total_debt = info.get("totalDebt") or 0
        total_cash = info.get("totalCash") or 0

        if isinstance(total_debt, float) and math.isnan(total_debt):
            total_debt = 0
        if isinstance(total_cash, float) and math.isnan(total_cash):
            total_cash = 0

        # Try balance sheet for more accurate numbers
        if balance_sheet_df is not None and not balance_sheet_df.empty:
            try:
                latest = balance_sheet_df.iloc[:, 0]  # Most recent year
                for label in ["Total Debt", "Long Term Debt", "Total Non Current Liabilities Net Minority Interest"]:
                    if label in latest.index:
                        val = latest[label]
                        if val is not None and not (isinstance(val, float) and math.isnan(val)):
                            total_debt = float(val)
                            break
                for label in ["Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments"]:
                    if label in latest.index:
                        val = latest[label]
                        if val is not None and not (isinstance(val, float) and math.isnan(val)):
                            total_cash = float(val)
                            break
            except Exception:
                pass

        return max(0, total_debt - total_cash)
