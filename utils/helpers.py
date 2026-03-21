"""Utility functions: scoring, safe math, formatting."""
import math
import numpy as np


def safe_get(d, key, default=None):
    """Get from dict handling None, NaN, string, and Infinity values."""
    if d is None:
        return default
    val = d.get(key, default)
    if val is None:
        return default
    # Convert strings to float where possible
    if isinstance(val, str):
        try:
            val = float(val)
        except (ValueError, OverflowError):
            return default
    try:
        if math.isnan(val) or math.isinf(val):
            return default
    except (TypeError, ValueError):
        pass
    return val


def safe_divide(numerator, denominator, default=0.0):
    """Safe division handling zero, None, and NaN."""
    if numerator is None or denominator is None:
        return default
    try:
        if denominator == 0 or math.isnan(denominator) or math.isnan(numerator):
            return default
    except (TypeError, ValueError):
        return default
    return numerator / denominator


def score_by_thresholds(value, thresholds, inverted=False):
    """
    Score a value using stepped thresholds.

    thresholds: list of (threshold, score) in ascending order of threshold.
    For normal metrics (higher is better): returns score of highest threshold <= value.
    For inverted metrics (lower is better): returns score of lowest threshold >= value.

    Returns None if value is None/NaN.
    """
    if value is None:
        return None
    try:
        if math.isnan(value):
            return None
    except (TypeError, ValueError):
        return None

    if inverted:
        # Lower value is better — find the highest threshold that value is still under
        result = thresholds[-1][1]  # worst score as default
        for threshold, score in thresholds:
            if value <= threshold:
                return score
            result = score
        return result
    else:
        # Higher value is better — find the highest threshold <= value
        result = thresholds[0][1]  # worst score as default
        for threshold, score in thresholds:
            if value >= threshold:
                result = score
            else:
                break
        return result


def compute_cagr(start_value, end_value, years):
    """Compute CAGR. Returns percentage (e.g., 15.0 for 15%)."""
    if start_value is None or end_value is None or years is None or years <= 0:
        return None
    try:
        if start_value <= 0 and end_value > 0:
            return 50.0  # turnaround score proxy
        if start_value <= 0:
            return None
        ratio = end_value / start_value
        if ratio <= 0:
            return None
        cagr = (ratio ** (1.0 / years) - 1) * 100
        return cagr
    except (ValueError, ZeroDivisionError, OverflowError):
        return None


def category_score(sub_scores, scale_to_100=True):
    """
    Average of non-None sub-scores.
    If scale_to_100, multiplies by 10 (since sub-scores are 0-10).
    """
    valid = [s for s in sub_scores.values() if s is not None]
    if not valid:
        return None, 0.0
    avg = np.mean(valid)
    coverage = len(valid) / len(sub_scores)
    if scale_to_100:
        return float(avg * 10), coverage
    return float(avg), coverage


def weighted_score(category_scores, weights):
    """
    Compute weighted score from category scores dict.
    Redistributes weight from missing categories proportionally.
    Returns (score, data_coverage_pct).
    """
    available = {}
    for cat, weight in weights.items():
        score = category_scores.get(cat)
        if score is not None:
            available[cat] = (score, weight)

    if not available:
        return 0.0, 0.0

    total_weight = sum(w for _, w in available.values())
    final = sum(score * (weight / total_weight) for score, weight in available.values())
    coverage = total_weight / sum(weights.values())
    return float(final), float(coverage)


def format_indian_crores(num):
    """Format number as Indian crores (e.g., 5,432.1 Cr)."""
    if num is None:
        return "N/A"
    crores = num / 1e7
    if crores >= 1000:
        return f"{crores:,.0f} Cr"
    return f"{crores:,.1f} Cr"


def format_pct(val, decimals=1):
    """Format as percentage string."""
    if val is None:
        return "N/A"
    return f"{val:.{decimals}f}%"
