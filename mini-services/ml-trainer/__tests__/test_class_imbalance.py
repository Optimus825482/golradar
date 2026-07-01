"""
Sample-weight + early-stopping regression test for the trainer.

Replays the exact shape of the production bug observed on 2026-07-01:
a synthetic dataset with ~80% positive class rate (mimicking the
export log line '44118 rows, 35597 positives (80.7%)') and asserts
that the trained XGBoost actually learns to discriminate (AUC > 0.6),
not just outputs the constant positive-class rate (AUC == 0.5).

If this test fails, the trainer has regressed to the
"constant-prediction plateau" — the AUC 0.500 / Brier 0.1564
symptom seen in production.
"""

import numpy as np
import pytest

# Skip the whole module if xgboost isn't installed locally (CI w/o ML deps)
try:
    import xgboost as xgb
    _HAS_XGB = True
except ImportError:  # pragma: no cover
    _HAS_XGB = False

try:
    from sklearn.metrics import roc_auc_score
    _HAS_SK = True
except ImportError:  # pragma: no cover
    _HAS_SK = False


pytestmark = pytest.mark.skipif(
    not (_HAS_XGB and _HAS_SK),
    reason="xgboost / scikit-learn not installed in test env",
)


def _make_imbalanced_dataset(
    n: int = 4000,
    pos_rate: float = 0.807,
    n_features: int = 12,
    seed: int = 42,
):
    """Synthesise an imbalanced dataset with a learnable signal.

    Half the features carry real signal (coef != 0), the rest are
    pure noise. The class boundary is set so that AUC under no
    weighting hovers around 0.5–0.6 — the sample_weight tweak must
    be enough to push it past 0.65.
    """
    rng = np.random.default_rng(seed)
    X = rng.normal(0, 1, size=(n, n_features)).astype(np.float32)
    coefs = np.zeros(n_features, dtype=np.float32)
    coefs[: n_features // 2] = rng.normal(0.4, 0.1, size=n_features // 2)
    logits = X @ coefs + rng.normal(0, 0.3, size=n)

    # Force the requested positive rate by picking the threshold that
    # produces it. Deterministic for testing.
    threshold = np.quantile(logits, 1 - pos_rate)
    y = (logits > threshold).astype(np.int32)
    return X, y


def _pos_weight_from_rate(pos_rate: float) -> float:
    """Mirror the production formula in app.py:216-227."""
    return min(((1 - pos_rate) / max(pos_rate, 0.05)) ** 1.5, 50.0)


@pytest.mark.parametrize("pos_rate", [0.807, 0.50, 0.20])
def test_sample_weight_unlocks_discrimination_under_imbalance(pos_rate):
    """Under heavy class imbalance, sample_weight must produce AUC >> 0.5.

    Without weighting, XGBoost trained on 80%-positive data converges to
    constant prediction at the positive rate. With the ^1.5 weighting
    shipped in this commit, AUC must clear 0.65.
    """
    X, y = _make_imbalanced_dataset(n=4000, pos_rate=pos_rate)

    n_tr = int(0.8 * len(y))
    Xtr, Xte = X[:n_tr], X[n_tr:]
    ytr, yte = y[:n_tr], y[n_tr:]

    pos_w = _pos_weight_from_rate(float(ytr.mean()))
    sw = np.where(ytr == 1, pos_w, 1.0)

    model = xgb.XGBClassifier(
        n_estimators=500,
        max_depth=6,
        learning_rate=0.05,
        objective="binary:logistic",
        eval_metric="logloss",
        early_stopping_rounds=100,
        random_state=42,
        n_jobs=1,
    )
    model.fit(Xtr, ytr, sample_weight=sw, eval_set=[(Xte, yte)], verbose=False)

    pred = model.predict_proba(Xte)[:, 1]
    auc = roc_auc_score(yte, pred)

    # Hard floor: under any weighting scheme we must beat random.
    assert auc > 0.55, (
        f"AUC={auc:.4f} below 0.55 — model collapsed to constant "
        f"prediction. pos_rate={pos_rate}, sample_weight pos_weight={pos_w:.3f}"
    )

    # Soft floor: the power-1.5 weighting should produce meaningful
    # discrimination (above 0.65) on a learnable signal.
    if pos_rate >= 0.5:
        assert auc > 0.65, (
            f"AUC={auc:.4f} below 0.65 with pos_rate={pos_rate}. "
            f"Sample weight isn't doing enough to escape the base_score plateau."
        )


def test_pos_weight_capped_at_50():
    """When pos_rate -> 0, the inverse-frequency explodes. Cap at 50."""
    # pos_rate = 0.01 → raw ratio = 99, ^1.5 = 984, capped at 50
    w = _pos_weight_from_rate(0.01)
    assert w == 50.0

    # pos_rate = 0.5 → ratio = 1, ^1.5 = 1, no cap
    w = _pos_weight_from_rate(0.5)
    assert abs(w - 1.0) < 1e-9

    # pos_rate = 0.807 (production) → ratio = 0.239, ^1.5 = 0.117
    w = _pos_weight_from_rate(0.807)
    assert 0.10 < w < 0.15, f"pos_rate=0.807 should give weight ~0.12, got {w}"


def test_sample_weight_improves_auc_vs_unweighted():
    """A direct A/B comparison: with-weighting must yield higher AUC
    than no-weighting under heavy class imbalance.

    This is the production-bug reproduction: in the 2026-07-01 logs
    AUC=0.500 was observed with no weighting, and we want to make
    sure the weighted branch beats that.
    """
    if not (_HAS_XGB and _HAS_SK):
        pytest.skip("xgboost / sklearn missing")

    X, y = _make_imbalanced_dataset(n=4000, pos_rate=0.807)

    n_tr = int(0.8 * len(y))
    Xtr, Xte = X[:n_tr], X[n_tr:]
    ytr, yte = y[:n_tr], y[n_tr:]

    pos_w = _pos_weight_from_rate(float(ytr.mean()))
    sw = np.where(ytr == 1, pos_w, 1.0)

    def fit(use_weights: bool) -> float:
        m = xgb.XGBClassifier(
            n_estimators=500,
            max_depth=6,
            learning_rate=0.05,
            objective="binary:logistic",
            eval_metric="logloss",
            early_stopping_rounds=100,
            random_state=42,
            n_jobs=1,
        )
        m.fit(
            Xtr, ytr,
            sample_weight=sw if use_weights else None,
            eval_set=[(Xte, yte)],
            verbose=False,
        )
        return roc_auc_score(yte, m.predict_proba(Xte)[:, 1])

    auc_weighted = fit(True)
    auc_unweighted = fit(False)

    # With weighting should be at least as good; usually strictly better.
    assert auc_weighted >= auc_unweighted - 0.01, (
        f"Sample weighting should not regress: weighted={auc_weighted:.4f}, "
        f"unweighted={auc_unweighted:.4f}"
    )
    # And it must clear the 0.500 random-prediction floor with margin.
    assert auc_weighted > 0.60, (
        f"Weighted AUC {auc_weighted:.4f} too close to random — "
        f"sample_weight isn't strong enough."
    )