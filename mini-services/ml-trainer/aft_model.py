"""Weibull AFT model for goal timing prediction.

P2 (mid-term): goal-timing survival model. Predicts P(goal in next
`horizon` minutes | survived to `current_minute`) using a Weibull
Accelerated Failure Time model from the lifelines package.

Reference: Kleinbaum & Klein, "Survival Analysis" (2010) — AFT
parameterisation gives a closed-form survival curve, so goal
probability within an arbitrary window reduces to a single ratio
of survival-function values.
"""
from __future__ import annotations

from typing import Iterable

import numpy as np
import pandas as pd


def train_aft(df: pd.DataFrame):
    """Train Weibull AFT on (features, minutes_to_goal, goal_scored).

    Required columns:
      - ``minutes_to_goal`` — duration (clipped to [1, 120])
      - ``goal_scored`` — event indicator (1 = goal observed, 0 = censored)
      - feature columns prefixed ``f_`` (any other columns are ignored)
    """
    from lifelines import WeibullAFTFitter

    duration_col = "minutes_to_goal"
    event_col = "goal_scored"
    feature_cols = [c for c in df.columns if c.startswith("f_")]
    aft = WeibullAFTFitter(penalizer=0.1)
    aft.fit(
        df[[duration_col, event_col] + feature_cols],
        duration_col=duration_col,
        event_col=event_col,
    )
    return aft


def predict_goal_probability(
    aft,
    features: Iterable[float] | pd.DataFrame,
    current_minute: int,
    horizon: int = 10,
) -> float | np.ndarray:
    """P(goal in next ``horizon`` minutes | survived to ``current_minute``).

    Computes 1 - S(t+horizon)/S(t). Accepts either a 1-D feature
    vector (returns a scalar) or a 2-D DataFrame (returns an array).
    """
    if isinstance(features, pd.DataFrame):
        s_now = aft.predict_survival_function(features, times=[current_minute]).values
        s_future = aft.predict_survival_function(features, times=[current_minute + horizon]).values
        return 1.0 - (s_future / np.maximum(s_now, 1e-9))
    # 1-D path
    s_now = float(aft.predict_survival_function(pd.DataFrame([features]), times=[current_minute]).iloc[0, 0])
    s_future = float(aft.predict_survival_function(pd.DataFrame([features]), times=[current_minute + horizon]).iloc[0, 0])
    return max(0.0, min(1.0, 1.0 - s_future / max(s_now, 1e-9)))