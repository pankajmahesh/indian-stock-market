"""
Intrinsic Valuation — DCF + Relative Valuation composite model.

Auto-fetches all inputs from yfinance and computes:
  Part 1: DCF Valuation (FCFF, FCFE, or Net Income model)
  Part 2: Relative Valuation (P/E, EV/EBITDA, EV/EBIT, EV/Sales, P/FCFE)
  Part 3: Composite Intrinsic Value = average of both methods

Adapted from AlphaSpread-style intrinsic valuation algorithm.
"""
import math
import yfinance as yf
from utils.helpers import safe_get
from utils.logger import log


# India-specific defaults
DEFAULT_DISCOUNT_RATE = 0.12      # 12% for Indian equities
DEFAULT_TERMINAL_GROWTH = 0.04    # 4% (India long-term nominal GDP growth)
FORECAST_YEARS = 5
DEFAULT_TAX_RATE = 0.25           # 25% Indian corporate tax
DEFAULT_BEAR_ADJ = -25
DEFAULT_BULL_ADJ = 25

# Morgan Stanley DCF defaults
DEFAULT_RISK_FREE_RATE = 7.0       # India 10Y yield %
DEFAULT_ERP = 6.0                  # Equity risk premium %
DEFAULT_COST_OF_DEBT = 9.0         # Avg Indian borrowing cost %
DEFAULT_EXIT_EV_EBITDA = 12.0      # Exit multiple for terminal value

# Scenario weights (probability %)
BULL_WEIGHT = 25
BASE_WEIGHT = 50
BEAR_WEIGHT = 25

# Sensitivity ranges
WACC_RANGE = (8, 18, 1)           # 8% to 18%, step 1%
TG_RANGE = (2.0, 6.5, 0.5)       # 2% to 6.5%, step 0.5%

# Margin of safety zones: (threshold_pct, zone_name)
MOS_ZONES = [(30, "Strong Buy"), (15, "Buy"), (0, "Hold"), (-999, "Sell")]


class IntrinsicValuator:
    """Compute intrinsic valuation for a single stock."""

    def valuate(self, symbol, overrides=None):
        """
        Run full valuation and return structured result.

        Args:
            symbol: NSE symbol (with or without .NS)
            overrides: optional dict to override auto-fetched inputs

        Returns:
            dict with inputs, dcf, relative, composite results, or error
        """
        if not symbol.endswith(".NS"):
            symbol += ".NS"

        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info or {}
            if not info:
                return {"error": f"No data found for {symbol.replace('.NS', '')}"}

            cmp = safe_get(info, "currentPrice") or safe_get(info, "regularMarketPrice")
            if not cmp:
                return {"error": f"No price data for {symbol.replace('.NS', '')}"}

            # Fetch financial statements
            financials = ticker.financials
            balance_sheet = ticker.balance_sheet
            cashflow = ticker.cashflow

            # Auto-derive all inputs
            inputs = self._derive_inputs(info, financials, balance_sheet, cashflow)

            # Apply user overrides
            if overrides:
                for k, v in overrides.items():
                    if v is not None and k in inputs:
                        inputs[k] = v

            # Run valuation
            result = self._compute_valuation(inputs)
            if result is None:
                return {"error": "Valuation computation failed — insufficient data"}

            result["symbol"] = symbol.replace(".NS", "")
            result["name"] = info.get("longName") or info.get("shortName") or symbol.replace(".NS", "")
            result["sector"] = info.get("sector") or "N/A"
            result["industry"] = info.get("industry") or "N/A"
            result["inputs"] = inputs

            return result

        except Exception as e:
            log.warning(f"Intrinsic valuation failed for {symbol}: {e}")
            return {"error": str(e)}

    def _derive_inputs(self, info, financials, balance_sheet, cashflow):
        """Auto-derive all valuation inputs from yfinance data."""
        cmp = safe_get(info, "currentPrice") or safe_get(info, "regularMarketPrice") or 0
        shares = safe_get(info, "sharesOutstanding") or 0
        shares_m = shares / 1e6 if shares else 0  # in millions

        # Revenue
        ttm_revenue = safe_get(info, "totalRevenue") or 0
        ttm_revenue_m = ttm_revenue / 1e6 if ttm_revenue else 0

        # Revenue growth
        rev_growth = safe_get(info, "revenueGrowth") or 0
        rev_growth_pct = rev_growth * 100 if rev_growth else 8
        # Decay growth over 5 years
        g1 = rev_growth_pct
        g2 = g1 * 0.85
        g3 = g2 * 0.85
        g4 = g3 * 0.85
        g5 = g4 * 0.85

        # Margins
        ebit_margin = (safe_get(info, "operatingMargins") or 0) * 100
        net_margin = (safe_get(info, "profitMargins") or 0) * 100
        gross_margin = (safe_get(info, "grossMargins") or 0) * 100

        # FCF margin from actual FCF/Revenue
        fcf = safe_get(info, "freeCashflow") or 0
        fcf_margin = (fcf / ttm_revenue * 100) if ttm_revenue > 0 else (net_margin * 0.9)

        # Balance sheet
        total_debt = safe_get(info, "totalDebt") or 0
        total_debt_m = total_debt / 1e6
        cash = safe_get(info, "totalCash") or 0
        cash_m = cash / 1e6

        # D&A and CapEx from cashflow
        depreciation_m = 0
        capex_m = 0
        change_wc_m = 0
        if cashflow is not None and not cashflow.empty:
            depreciation_m = self._get_cf_item(cashflow, [
                "Depreciation And Amortization",
                "Depreciation",
            ]) / 1e6
            capex_raw = self._get_cf_item(cashflow, [
                "Capital Expenditure",
                "Capital Expenditures",
            ])
            capex_m = abs(capex_raw) / 1e6  # capex is typically negative
            change_wc_m = self._get_cf_item(cashflow, [
                "Change In Working Capital",
                "Changes In Account Receivables",
            ]) / 1e6

        # Tax rate
        tax_rate = DEFAULT_TAX_RATE * 100  # 25%

        # ── WACC (Morgan Stanley-style) ──────────────────────────
        beta = safe_get(info, "beta") or 1.0
        beta = max(0.5, min(2.0, beta))
        risk_free = DEFAULT_RISK_FREE_RATE
        equity_premium = DEFAULT_ERP
        cost_of_equity = risk_free + beta * equity_premium

        # Cost of Debt: Interest Expense / Total Debt
        interest_expense_m = 0
        if financials is not None and not financials.empty:
            interest_expense_m = abs(self._get_cf_item(financials, [
                "Interest Expense", "Interest Expense Non Operating",
                "Net Interest Income", "Interest Income",
            ])) / 1e6
        if total_debt_m > 0 and interest_expense_m > 0:
            cost_of_debt = (interest_expense_m / total_debt_m) * 100
            cost_of_debt = max(5.0, min(15.0, cost_of_debt))
        else:
            cost_of_debt = DEFAULT_COST_OF_DEBT

        # Capital structure weights
        mcap_m = cmp * shares_m
        total_capital = mcap_m + total_debt_m
        equity_weight = (mcap_m / total_capital * 100) if total_capital > 0 else 100
        debt_weight = 100 - equity_weight

        # Full WACC
        wacc = (equity_weight / 100 * cost_of_equity) + \
               (debt_weight / 100 * cost_of_debt * (1 - DEFAULT_TAX_RATE))
        discount_rate = round(wacc, 1)

        # Current multiples
        mcap = cmp * shares if shares else 0
        ev = mcap + total_debt - cash
        ebit = ttm_revenue * (ebit_margin / 100) if ebit_margin else 0
        ebitda = ebit + (depreciation_m * 1e6) if ebit else 0
        net_income = ttm_revenue * (net_margin / 100) if net_margin else 0
        fcfe = ttm_revenue * (fcf_margin / 100) if fcf_margin else 0
        book_value = safe_get(info, "bookValue") or 0

        current_pe = safe_get(info, "trailingPE") or (cmp / (net_income / shares) if net_income > 0 and shares > 0 else 0)
        current_ev_ebitda = safe_get(info, "enterpriseToEbitda") or (ev / ebitda if ebitda > 0 else 0)
        current_ev_ebit = ev / ebit if ebit > 0 else 0
        current_ev_sales = safe_get(info, "enterpriseToRevenue") or (ev / ttm_revenue if ttm_revenue > 0 else 0)
        current_pb = safe_get(info, "priceToBook") or (cmp / book_value if book_value > 0 else 0)
        current_p_fcfe = mcap / fcfe if fcfe > 0 else 0

        # Target multiples (conservative: 85% of current or sector median proxy)
        target_pe = current_pe * 0.85 if current_pe > 0 else 20
        target_ev_ebitda = current_ev_ebitda * 0.85 if current_ev_ebitda > 0 else 15
        target_ev_ebit = current_ev_ebit * 0.85 if current_ev_ebit > 0 else 18
        target_ev_sales = current_ev_sales * 0.85 if current_ev_sales > 0 else 3
        target_pb = current_pb * 0.85 if current_pb > 0 else 3
        target_p_fcfe = current_p_fcfe * 0.85 if current_p_fcfe > 0 else 18

        # Exit EV/EBITDA for dual terminal value
        exit_ev_ebitda = current_ev_ebitda * 0.85 if current_ev_ebitda > 3 else DEFAULT_EXIT_EV_EBITDA

        return {
            "currentPrice": round(cmp, 2),
            "sharesOutstanding": round(shares_m, 1),
            "ttmRevenue": round(ttm_revenue_m, 1),
            "revenueGrowthY1": round(g1, 1),
            "revenueGrowthY2": round(g2, 1),
            "revenueGrowthY3": round(g3, 1),
            "revenueGrowthY4": round(g4, 1),
            "revenueGrowthY5": round(g5, 1),
            "ebitMargin": round(ebit_margin, 1),
            "netIncomeMargin": round(net_margin, 1),
            "fcfMargin": round(fcf_margin, 1),
            "grossMargin": round(gross_margin, 1),
            "taxRate": round(tax_rate, 1),
            "totalDebt": round(total_debt_m, 1),
            "cashAndEquiv": round(cash_m, 1),
            "depreciation": round(depreciation_m, 1),
            "capex": round(capex_m, 1),
            "changeInWC": round(change_wc_m, 1),
            "discountRate": round(discount_rate, 1),
            "terminalGrowthRate": DEFAULT_TERMINAL_GROWTH * 100,
            "forecastYears": FORECAST_YEARS,
            "dcfModel": "FCFF",
            "currentPE": round(current_pe, 1) if current_pe else 0,
            "currentEVEBITDA": round(current_ev_ebitda, 1) if current_ev_ebitda else 0,
            "currentEVEBIT": round(current_ev_ebit, 1) if current_ev_ebit else 0,
            "currentEVSales": round(current_ev_sales, 1) if current_ev_sales else 0,
            "currentPB": round(current_pb, 1) if current_pb else 0,
            "currentPFCFE": round(current_p_fcfe, 1) if current_p_fcfe else 0,
            "targetPE": round(target_pe, 1),
            "targetEVEBITDA": round(target_ev_ebitda, 1),
            "targetEVEBIT": round(target_ev_ebit, 1),
            "targetEVSales": round(target_ev_sales, 1),
            "targetPB": round(target_pb, 1),
            "targetPFCFE": round(target_p_fcfe, 1),
            "bearAdj": DEFAULT_BEAR_ADJ,
            "bullAdj": DEFAULT_BULL_ADJ,
            # WACC components (overridable)
            "riskFreeRate": round(risk_free, 1),
            "equityRiskPremium": round(equity_premium, 1),
            "beta": round(beta, 2),
            "costOfEquity": round(cost_of_equity, 1),
            "interestExpense": round(interest_expense_m, 1),
            "costOfDebt": round(cost_of_debt, 1),
            "equityWeight": round(equity_weight, 1),
            "debtWeight": round(debt_weight, 1),
            # Terminal value
            "exitEvEbitda": round(exit_ev_ebitda, 1),
            # Scenario adjustments (overridable)
            "bullGrowthMult": 1.20,
            "bearGrowthMult": 0.70,
            "bullMarginAdj": 2.0,
            "bearMarginAdj": -3.0,
            "bullDiscountAdj": -1.0,
            "bearDiscountAdj": 2.0,
            "scenarioWeightBull": BULL_WEIGHT,
            "scenarioWeightBase": BASE_WEIGHT,
            "scenarioWeightBear": BEAR_WEIGHT,
        }

    # ── Single DCF scenario (parameterized) ─────────────────────
    def _run_single_dcf(self, inp, growth_mult=1.0, margin_adj=0.0, discount_adj=0.0):
        """
        Run one DCF scenario with adjusted growth/margin/discount parameters.
        Returns dict with revenues, cashFlows, terminal breakdown, fcfBridge, dcfPerShare.
        """
        r = (inp["discountRate"] + discount_adj) / 100
        g = inp["terminalGrowthRate"] / 100
        years = int(inp["forecastYears"])
        shares = inp["sharesOutstanding"]
        debt = inp["totalDebt"]
        cash = inp["cashAndEquiv"]

        if r <= 0:
            r = 0.12
        if r <= g:
            g = max(r - 0.02, 0.01)

        # Step 1: Revenue forecast with adjusted growth
        rev_growth = [
            (inp[f"revenueGrowthY{i+1}"] * growth_mult) / 100
            for i in range(years)
        ]
        revenues = []
        rev = inp["ttmRevenue"]
        if not rev or rev <= 0:
            return None
        for i in range(years):
            gr = rev_growth[i] if i < len(rev_growth) else rev_growth[-1]
            rev *= (1 + gr)
            revenues.append(round(rev, 1))

        # Step 2: Cash flow forecast with adjusted margin
        ebit_m = (inp["ebitMargin"] + margin_adj) / 100
        net_m = inp["netIncomeMargin"] / 100
        tax_r = inp["taxRate"] / 100
        depr = inp["depreciation"]
        capx = inp["capex"]
        dwc = inp["changeInWC"]
        model = inp.get("dcfModel", "FCFF")
        base_rev = inp["ttmRevenue"]

        cash_flows = []
        fcf_bridge = []

        for i in range(years):
            scale = revenues[i] / base_rev if base_rev > 0 else 1
            da_yr = depr * scale
            capex_yr = capx * scale
            dwc_yr = dwc * scale

            if model == "FCFF":
                ebit_yr = revenues[i] * ebit_m
                ebitda_yr = ebit_yr + da_yr
                nopat_yr = ebit_yr * (1 - tax_r)
                fcf = nopat_yr + da_yr - capex_yr - dwc_yr
            elif model == "FCFE":
                ebit_yr = revenues[i] * ebit_m
                ebitda_yr = ebit_yr + da_yr
                ni_yr = revenues[i] * net_m
                nopat_yr = ni_yr
                fcf = ni_yr + da_yr - capex_yr - dwc_yr
            else:
                ebit_yr = revenues[i] * ebit_m
                ebitda_yr = ebit_yr + da_yr
                nopat_yr = revenues[i] * net_m
                fcf = nopat_yr

            cash_flows.append(round(fcf, 1))
            fcf_bridge.append({
                "year": i + 1,
                "revenue": round(revenues[i], 1),
                "ebitda": round(ebitda_yr, 1),
                "ebit": round(ebit_yr, 1),
                "nopat": round(nopat_yr, 1),
                "da": round(da_yr, 1),
                "capex": round(capex_yr, 1),
                "changeWC": round(dwc_yr, 1),
                "fcff": round(fcf, 1),
            })

        # Step 3: Discount cash flows
        pv_cash_flows = [round(cf / ((1 + r) ** (i + 1)), 1) for i, cf in enumerate(cash_flows)]
        total_pv_cf = round(sum(pv_cash_flows), 1)

        # Step 4: Dual Terminal Value
        terminal_cf = cash_flows[-1] * (1 + g)
        tv_gordon = terminal_cf / (r - g) if r > g else 0
        terminal_ebitda = fcf_bridge[-1]["ebitda"] if fcf_bridge else 0
        exit_mult = inp.get("exitEvEbitda", DEFAULT_EXIT_EV_EBITDA)
        tv_exit = terminal_ebitda * exit_mult
        tv_blended = (tv_gordon + tv_exit) / 2 if (tv_gordon > 0 and tv_exit > 0) else max(tv_gordon, tv_exit)
        pv_terminal = round(tv_blended / ((1 + r) ** years), 1)

        # Step 5: Enterprise → Equity → Per Share
        total_pv = total_pv_cf + pv_terminal
        if model == "FCFF":
            equity_value = total_pv - debt + cash
        else:
            equity_value = total_pv
        dcf_per_share = round(max(equity_value / shares, 0), 2) if shares > 0 else 0

        return {
            "revenues": revenues,
            "cashFlows": cash_flows,
            "pvCashFlows": pv_cash_flows,
            "totalPVCF": total_pv_cf,
            "terminalValueGordon": round(tv_gordon, 1),
            "terminalValueExit": round(tv_exit, 1),
            "terminalValueBlended": round(tv_blended, 1),
            "pvTerminal": pv_terminal,
            "totalPV": round(total_pv, 1),
            "equityValue": round(equity_value, 1),
            "dcfPerShare": dcf_per_share,
            "discountRateUsed": round(r * 100, 1),
            "ebitMarginUsed": round(ebit_m * 100, 1),
            "fcfBridge": fcf_bridge,
            "model": model,
        }

    # ── Sensitivity matrix (WACC vs Terminal Growth) ──────────
    def _compute_sensitivity(self, inp, base_cash_flows):
        """Generate WACC vs Terminal Growth sensitivity table."""
        shares = inp["sharesOutstanding"]
        debt = inp["totalDebt"]
        cash = inp["cashAndEquiv"]
        model = inp.get("dcfModel", "FCFF")
        years = len(base_cash_flows)

        wacc_start, wacc_end, wacc_step = WACC_RANGE
        tg_start, tg_end, tg_step = TG_RANGE

        wacc_values = []
        w = wacc_start
        while w <= wacc_end + 0.001:
            wacc_values.append(w)
            w += wacc_step
        tg_values = []
        t = tg_start
        while t <= tg_end + 0.001:
            tg_values.append(round(t, 1))
            t += tg_step

        matrix = []
        for wacc_pct in wacc_values:
            wacc = wacc_pct / 100
            row = {"wacc": wacc_pct, "values": []}
            for tg_pct in tg_values:
                tg = tg_pct / 100
                if wacc <= tg:
                    row["values"].append(None)
                    continue
                pv_cf = sum(cf / ((1 + wacc) ** (i + 1)) for i, cf in enumerate(base_cash_flows))
                tv = base_cash_flows[-1] * (1 + tg) / (wacc - tg)
                pv_tv = tv / ((1 + wacc) ** years)
                ev = pv_cf + pv_tv
                eq = ev - debt + cash if model == "FCFF" else ev
                per_share = round(max(eq / shares, 0), 2) if shares > 0 else 0
                row["values"].append(per_share)
            matrix.append(row)

        return {
            "waccRange": wacc_values,
            "tgRange": tg_values,
            "matrix": matrix,
        }

    # ── Main valuation orchestrator ───────────────────────────
    def _compute_valuation(self, inp):
        """Run MS-style DCF (3 scenarios) + Relative valuation."""
        try:
            shares = inp["sharesOutstanding"]
            debt = inp["totalDebt"]
            cash = inp["cashAndEquiv"]
            price = inp["currentPrice"]

            if not shares or shares <= 0 or not price or price <= 0:
                return None
            if not inp["ttmRevenue"] or inp["ttmRevenue"] <= 0:
                return None

            # ═══ PART 1: THREE-SCENARIO DCF ═══
            base = self._run_single_dcf(inp)
            bull = self._run_single_dcf(
                inp,
                growth_mult=inp.get("bullGrowthMult", 1.2),
                margin_adj=inp.get("bullMarginAdj", 2.0),
                discount_adj=inp.get("bullDiscountAdj", -1.0),
            )
            bear = self._run_single_dcf(
                inp,
                growth_mult=inp.get("bearGrowthMult", 0.7),
                margin_adj=inp.get("bearMarginAdj", -3.0),
                discount_adj=inp.get("bearDiscountAdj", 2.0),
            )

            if not base:
                return None

            base_val = base["dcfPerShare"]
            bull_val = bull["dcfPerShare"] if bull else base_val
            bear_val = bear["dcfPerShare"] if bear else base_val

            # Probability-weighted target price
            w_bull = inp.get("scenarioWeightBull", BULL_WEIGHT) / 100
            w_base = inp.get("scenarioWeightBase", BASE_WEIGHT) / 100
            w_bear = inp.get("scenarioWeightBear", BEAR_WEIGHT) / 100
            weighted_dcf = round(w_bull * bull_val + w_base * base_val + w_bear * bear_val, 2)

            # ═══ PART 2: RELATIVE VALUATION ═══
            ebit_m = inp["ebitMargin"] / 100
            net_m = inp["netIncomeMargin"] / 100
            fcf_m = inp["fcfMargin"] / 100
            ttm_rev = inp["ttmRevenue"]
            depr = inp["depreciation"]
            ebit = ttm_rev * ebit_m
            ebitda = ebit + depr
            net_income = ttm_rev * net_m
            fcfe = ttm_rev * fcf_m
            mcap = price * shares
            ev = mcap + debt - cash

            multiples = []

            t_pe = inp["targetPE"]
            if net_income > 0 and t_pe > 0:
                implied = round((t_pe * net_income) / shares, 2)
                multiples.append({"name": "P/E", "current": inp["currentPE"], "target": t_pe, "implied": implied})

            t_eveb = inp["targetEVEBITDA"]
            if ebitda > 0 and t_eveb > 0:
                implied = round((t_eveb * ebitda - debt + cash) / shares, 2)
                multiples.append({"name": "EV/EBITDA", "current": inp["currentEVEBITDA"], "target": t_eveb, "implied": implied})

            t_evebit = inp["targetEVEBIT"]
            if ebit > 0 and t_evebit > 0:
                implied = round((t_evebit * ebit - debt + cash) / shares, 2)
                multiples.append({"name": "EV/EBIT", "current": inp["currentEVEBIT"], "target": t_evebit, "implied": implied})

            t_evs = inp["targetEVSales"]
            if ttm_rev > 0 and t_evs > 0:
                implied = round((t_evs * ttm_rev - debt + cash) / shares, 2)
                multiples.append({"name": "EV/Sales", "current": inp["currentEVSales"], "target": t_evs, "implied": implied})

            t_pfcfe = inp["targetPFCFE"]
            if fcfe > 0 and t_pfcfe > 0:
                implied = round((t_pfcfe * fcfe) / shares, 2)
                multiples.append({"name": "P/FCFE", "current": inp["currentPFCFE"], "target": t_pfcfe, "implied": implied})

            valid_multiples = [m for m in multiples if m["implied"] > 0 and math.isfinite(m["implied"])]
            relative_value = 0
            if valid_multiples:
                relative_value = round(sum(m["implied"] for m in valid_multiples) / len(valid_multiples), 2)

            # ═══ PART 3: COMPOSITE (uses weighted DCF) ═══
            if weighted_dcf > 0 and relative_value > 0:
                intrinsic_value = round((weighted_dcf + relative_value) / 2, 2)
            elif weighted_dcf > 0:
                intrinsic_value = weighted_dcf
            elif relative_value > 0:
                intrinsic_value = relative_value
            else:
                intrinsic_value = 0

            upside = round((intrinsic_value - price) / price * 100, 1) if price > 0 else 0

            if upside > 10:
                verdict = "Undervalued"
            elif upside < -10:
                verdict = "Overvalued"
            else:
                verdict = "Fairly Valued"

            # Margin of Safety
            mos = round((intrinsic_value - price) / intrinsic_value * 100, 1) if intrinsic_value > 0 else 0
            mos_zone = "Sell"
            for threshold, zone in MOS_ZONES:
                if mos >= threshold:
                    mos_zone = zone
                    break

            # Sensitivity table
            sensitivity = self._compute_sensitivity(inp, base["cashFlows"])

            # WACC breakdown
            wacc_breakdown = {
                "riskFreeRate": inp.get("riskFreeRate", DEFAULT_RISK_FREE_RATE),
                "equityRiskPremium": inp.get("equityRiskPremium", DEFAULT_ERP),
                "beta": inp.get("beta", 1.0),
                "costOfEquity": inp.get("costOfEquity", 13.0),
                "costOfDebt": inp.get("costOfDebt", DEFAULT_COST_OF_DEBT),
                "equityWeight": inp.get("equityWeight", 100.0),
                "debtWeight": inp.get("debtWeight", 0.0),
                "taxRate": inp.get("taxRate", 25.0),
                "wacc": inp.get("discountRate", 12.0),
            }

            return {
                "dcf": {
                    # Backward-compatible fields (base scenario)
                    "revenues": base["revenues"],
                    "cashFlows": base["cashFlows"],
                    "pvCashFlows": base["pvCashFlows"],
                    "totalPVCF": base["totalPVCF"],
                    "pvTerminal": base["pvTerminal"],
                    "totalPV": base["totalPV"],
                    "equityValue": base["equityValue"],
                    "dcfPerShare": base_val,
                    "dcfBear": bear_val,
                    "dcfBull": bull_val,
                    "model": base["model"],
                    # New MS-DCF fields
                    "weightedDcfPerShare": weighted_dcf,
                    "terminalValueGordon": base["terminalValueGordon"],
                    "terminalValueExit": base["terminalValueExit"],
                    "terminalValueBlended": base["terminalValueBlended"],
                    "fcfBridge": base["fcfBridge"],
                },
                "scenarios": {
                    "bull": {
                        "dcfPerShare": bull_val,
                        "weight": round(w_bull * 100),
                        "discountRateUsed": bull["discountRateUsed"] if bull else None,
                        "ebitMarginUsed": bull["ebitMarginUsed"] if bull else None,
                        "revenues": bull["revenues"] if bull else None,
                        "cashFlows": bull["cashFlows"] if bull else None,
                    },
                    "base": {
                        "dcfPerShare": base_val,
                        "weight": round(w_base * 100),
                        "discountRateUsed": base["discountRateUsed"],
                        "ebitMarginUsed": base["ebitMarginUsed"],
                        "revenues": base["revenues"],
                        "cashFlows": base["cashFlows"],
                    },
                    "bear": {
                        "dcfPerShare": bear_val,
                        "weight": round(w_bear * 100),
                        "discountRateUsed": bear["discountRateUsed"] if bear else None,
                        "ebitMarginUsed": bear["ebitMarginUsed"] if bear else None,
                        "revenues": bear["revenues"] if bear else None,
                        "cashFlows": bear["cashFlows"] if bear else None,
                    },
                    "weightedTargetPrice": weighted_dcf,
                },
                "sensitivity": sensitivity,
                "waccBreakdown": wacc_breakdown,
                "marginOfSafety": {
                    "pct": mos,
                    "zone": mos_zone,
                },
                "relative": {
                    "multiples": valid_multiples,
                    "relativeValue": relative_value,
                },
                "composite": {
                    "intrinsicValue": intrinsic_value,
                    "upside": upside,
                    "verdict": verdict,
                    "marginOfSafety": mos,
                    "marginOfSafetyZone": mos_zone,
                },
                "meta": {
                    "ev": round(ev, 1),
                    "marketCap": round(mcap, 1),
                    "ebitda": round(ebitda, 1),
                    "ebit": round(ebit, 1),
                    "netIncome": round(net_income, 1),
                },
            }

        except Exception as e:
            log.warning(f"Valuation compute error: {e}")
            return None

    def _get_cf_item(self, df, labels):
        """Get latest value for a cashflow line item."""
        if df is None or df.empty:
            return 0
        for label in labels:
            if label in df.index:
                val = df.loc[label].iloc[0]
                if val is not None and not (isinstance(val, float) and math.isnan(val)):
                    return float(val)
        return 0
