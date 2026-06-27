"""ML Trainer sidecar for golradar2.

Endpoints:
    GET  /healthz                 — liveness probe
    POST /train                   — start a training job
    GET  /jobs/{job_id}           — poll job status + metrics
    POST /promote                 — flip a trained artifact to champion

Reads JSONL training data emitted by the TS exporter
(`src/lib/ml/exportTrainingData.ts`). Writes XGBoost JSON artifacts
that the TS runtime loads via `xgbLoader.ts`. The TS scheduler
calls `/train`; the TS backtest calls `/jobs/{id}` until
status=success, then loads the artifact from the recorded path.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

import numpy as np
import pandas as pd
import xgboost as xgb
try:
    import lightgbm as lgb
    _HAS_LGBM = True
except ImportError:
    _HAS_LGBM = False
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    log_loss,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split

# ── Paths ──────────────────────────────────────────────────────────
# Inside the container, /data is the volume mount that the app
# container shares (see docker-compose.yml).
DATA_ROOT = Path(os.environ.get("ML_DATA_ROOT", "/data"))
TRAINING_DIR = DATA_ROOT / "ml-training"
MODELS_DIR = DATA_ROOT / "ml-models"
TRAINING_DIR.mkdir(parents=True, exist_ok=True)
MODELS_DIR.mkdir(parents=True, exist_ok=True)

# ── In-process job registry ───────────────────────────────────────
# Threading-based since FastAPI runs the sync worker in a thread
# pool. A persistent store (SQLite/Redis) would let multiple
# trainer replicas share state; out of scope for v1.
_jobs: Dict[str, "JobState"] = {}
_jobs_lock = threading.Lock()


@dataclass
class JobState:
    job_id: str
    name: str
    version: str
    horizon_min: int
    dataset_path: str
    artifact_path: str
    status: Literal["queued", "running", "success", "failed"] = "queued"
    started_at: float = 0.0
    finished_at: float = 0.0
    metrics: Dict[str, float] = field(default_factory=dict)
    error: Optional[str] = None


# ── Schemas ───────────────────────────────────────────────────────
class TrainRequest(BaseModel):
    name: Literal["gbdt", "xgb", "inplay", "team-strength", "xt-grid", "lightgbm"]
    version: str = Field(..., description="semver, e.g. '1.0.0'")
    horizon_min: int = Field(..., ge=1, le=120)
    dataset_path: str = Field(..., description="Path to the JSONL file the TS exporter produced")
    n_estimators: int = 800
    max_depth: int = 6
    learning_rate: float = 0.03
    subsample: float = 0.8
    colsample_bytree: float = 0.7
    reg_lambda: float = 1.5
    reg_alpha: float = 0.1
    min_child_weight: int = 3
    test_size: float = 0.2
    early_stopping_rounds: int = 50
    random_state: int = 42


class JobHandle(BaseModel):
    jobId: str
    status: str
    name: str
    version: str
    horizonMin: int
    artifactPath: Optional[str] = None
    metrics: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None
    startedAt: float
    finishedAt: float


class NetscoresProxyRequest(BaseModel):
    url: str
    timeout_ms: int = 20000


class PromoteRequest(BaseModel):
    name: str
    version: str
    notes: Optional[str] = None


# ── App ───────────────────────────────────────────────────────────
app = FastAPI(title="golradar2-ml-trainer", version="0.1.0")


@app.get("/healthz")
def healthz() -> Dict[str, Any]:
    return {
        "ok": True,
        "uptimeSec": int(time.time() - _START_TIME),
        "trainingDir": str(TRAINING_DIR),
        "modelsDir": str(MODELS_DIR),
        "queuedJobs": sum(1 for j in _jobs.values() if j.status == "queued"),
        "runningJobs": sum(1 for j in _jobs.values() if j.status == "running"),
    }


_START_TIME = time.time()


# ── Training worker ───────────────────────────────────────────────
def _run_training_job(job: JobState, req: TrainRequest) -> None:
    """Run the actual training in a background thread."""
    job.status = "running"
    job.started_at = time.time()

    try:
        # Load JSONL dataset
        df = _load_dataset(req.dataset_path)
        if len(df) < 100:
            raise ValueError(f"dataset too small: {len(df)} rows (need >=100)")

        # The TS exporter writes rows with `features` (47-floats list)
        # and `label` (0/1). Defensive: accept column-name variants.
        if "features" not in df.columns or "label" not in df.columns:
            raise ValueError(f"dataset missing required columns: {df.columns.tolist()}")

        X = np.array(df["features"].tolist(), dtype=np.float32)
        y = np.array(df["label"].tolist(), dtype=np.int32)

        n_pos = int(y.sum())
        n_neg = int(len(y) - n_pos)

        if n_pos == 0 or n_neg == 0:
            raise ValueError(
                f"dataset has only one label class: {n_pos} positives, {n_neg} negatives. "
                "Need at least a few goals in the training window."
            )

        # Stratified split — fall back to random split if too few positives
        test_size = req.test_size
        min_test_pos = max(1, int(n_pos * test_size * 0.5))
        if n_pos >= 4 and n_neg >= 4:
            Xtr, Xte, ytr, yte = train_test_split(
                X, y, test_size=test_size, stratify=y, random_state=req.random_state
            )
        else:
            Xtr, Xte, ytr, yte = train_test_split(
                X, y, test_size=test_size, random_state=req.random_state
            )

        # Compute base_score from training label distribution
        # (default 0.5 causes the model to predict 0.5 for everything)
        pos_rate = float(ytr.mean())
        base_score = max(0.01, min(0.99, pos_rate))
        print(f"[trainer] {req.name}@{req.version}: n={len(df)}, pos_rate={pos_rate:.3f}, base_score={base_score:.3f}, features={X.shape[1]}")

	        # Train model
	        if req.name == 'lightgbm' and _HAS_LGBM:
	            model = lgb.LGBMClassifier(
	                n_estimators=req.n_estimators,
	                max_depth=req.max_depth,
	                learning_rate=req.learning_rate,
	                subsample=req.subsample,
	                colsample_bytree=req.colsample_bytree,
	                reg_lambda=req.reg_lambda,
	                reg_alpha=req.reg_alpha,
	                min_child_weight=req.min_child_weight,
	                objective="binary",
	                random_state=req.random_state,
	                n_jobs=-1,
	            )
	            model.fit(Xtr, ytr, eval_set=[(Xte, yte)], verbose=False)
	        else:
	            # XGBoost (default for xgb, inplay, team-strength, xt-grid)
	            model = xgb.XGBClassifier(
	                n_estimators=req.n_estimators,
	                max_depth=req.max_depth,
	                learning_rate=req.learning_rate,
	                subsample=req.subsample,
	                colsample_bytree=req.colsample_bytree,
	                reg_lambda=req.reg_lambda,
	                reg_alpha=req.reg_alpha,
	                min_child_weight=req.min_child_weight,
	                objective="binary:logistic",
	                eval_metric=["logloss", "error", "auc"],
	                early_stopping_rounds=req.early_stopping_rounds,
	                random_state=req.random_state,
	                base_score=base_score,
	                n_jobs=-1,
	            )
	            model.fit(Xtr, ytr, eval_set=[(Xte, yte)], verbose=False)

        # Predict + metrics
        p = model.predict_proba(Xte)[:, 1]
        p_clipped = np.clip(p, 1e-9, 1 - 1e-9)
        brier = brier_score_loss(yte, p)
        ll = log_loss(yte, p_clipped)
        acc = accuracy_score(yte, (p > 0.5).astype(int))
        try:
            auc = roc_auc_score(yte, p)
        except ValueError:
            auc = 0.5  # single class in test set
        # Calibration error (10-bin ECE)
        cal_err = _expected_calibration_error(yte, p, n_bins=10)

        # Feature importance (top 5)
        importance = model.feature_importances_
        top5_idx = importance.argsort()[-5:][::-1]
        print(f"[trainer] {req.name}@{req.version}: Brier={brier:.4f}, AUC={auc:.3f}, "
              f"Acc={acc:.3f}, top5={top5_idx.tolist()}, "
              f"imp={[round(importance[i], 4) for i in top5_idx]}")

        # Persist XGBoost JSON artifact
        artifact_path = MODELS_DIR / f"{req.name}-v{req.version}.json"
        model.save_model(artifact_path)

        # Compute SHA256 of the artifact for the registry
        sha = _sha256_file(artifact_path)
        artifact_size = artifact_path.stat().st_size

        job.artifact_path = str(artifact_path)
        job.metrics = {
            "brier": float(brier),
            "logLoss": float(ll),
            "accuracy": float(acc),
            "auc": float(auc),
            "calibrationError": float(cal_err),
            "n": int(len(df)),
            "trainRows": int(len(Xtr)),
            "testRows": int(len(Xte)),
            "artifactBytes": artifact_size,
            "sha256": sha,
        }
        job.status = "success"
    except Exception as exc:  # noqa: BLE001 — captured into job state
        job.status = "failed"
        job.error = f"{type(exc).__name__}: {exc}"
    finally:
        job.finished_at = time.time()


def _expected_calibration_error(
    y_true: np.ndarray, y_prob: np.ndarray, n_bins: int = 10
) -> float:
    """Equal-width binning ECE. Sums |avg_pred - avg_actual| weighted by bin count."""
    bins = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0
    n = len(y_true)
    for lo, hi in zip(bins[:-1], bins[1:]):
        mask = (y_prob >= lo) & (y_prob < hi)
        if not mask.any():
            continue
        bin_conf = float(y_prob[mask].mean())
        bin_acc = float(y_true[mask].mean())
        ece += (mask.sum() / n) * abs(bin_conf - bin_acc)
    return float(ece)


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _load_dataset(path_str: str) -> pd.DataFrame:
    path = Path(path_str)
    if not path.exists():
        raise FileNotFoundError(f"dataset not found: {path}")
    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                # Skip malformed lines but report count
                print(f"[trainer] skipping malformed line {i}: {exc}")
    return pd.DataFrame(rows)


# ── Endpoints ─────────────────────────────────────────────────────
@app.post("/train", response_model=JobHandle)
def train(req: TrainRequest) -> JobHandle:
    if req.name in ("team-strength", "xt-grid"):
        raise HTTPException(
            status_code=501,
            detail=(
                f"model name '{req.name}' is not implemented in the Python trainer. "
                "team-strength uses the TS Kalman module; xt-grid is built offline "
                "and shipped as JSON. Use 'gbdt', 'xgb', or 'inplay' here."
            ),
        )

    job = JobState(
        job_id=str(uuid.uuid4()),
        name=req.name,
        version=req.version,
        horizon_min=req.horizon_min,
        dataset_path=req.dataset_path,
        artifact_path="",
    )
    with _jobs_lock:
        _jobs[job.job_id] = job

    # Spin off the actual training in a daemon thread (FastAPI's
    # thread pool will reuse this thread when the request returns,
    # so the training must NOT be awaited here).
    threading.Thread(
        target=_run_training_job,
        args=(job, req),
        daemon=True,
        name=f"trainer-{req.name}-{req.version}",
    ).start()

    return JobHandle(
        jobId=job.job_id,
        status=job.status,
        name=job.name,
        version=job.version,
        horizonMin=job.horizon_min,
        artifactPath=None,
        metrics={},
        error=None,
        startedAt=job.started_at or time.time(),
        finishedAt=0.0,
    )


@app.get("/jobs/{job_id}", response_model=JobHandle)
def get_job(job_id: str) -> JobHandle:
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"job {job_id} not found")
    return JobHandle(
        jobId=job.job_id,
        status=job.status,
        name=job.name,
        version=job.version,
        horizonMin=job.horizon_min,
        artifactPath=job.artifact_path or None,
        metrics=job.metrics,
        error=job.error,
        startedAt=job.started_at,
        finishedAt=job.finished_at,
    )


@app.post("/netscores-proxy")
def netscores_proxy(req: NetscoresProxyRequest) -> Dict[str, Any]:
    """Fetch a URL via curl_cffi to bypass Cloudflare.

    curl_cffi impersonates a real browser TLS fingerprint. Used when
    direct Node.js fetch hits a CF challenge and the Alpine main
    container has no Python runtime.
    """
    try:
        from curl_cffi import requests

        result = requests.get(
            req.url,
            impersonate="chrome124",
            timeout=req.timeout_ms / 1000,
            headers={
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Accept-Language": "en-US,en;q=0.9",
                "Referer": "https://www.netscores.com/",
                "Origin": "https://www.netscores.com",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
            },
        )
        if result.status_code != 200:
            return {"ok": False, "status": result.status_code, "error": f"HTTP {result.status_code}"}
        return {"ok": True, "data": result.json()}
    except ImportError:
        return {"ok": False, "error": "curl_cffi not installed on trainer"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/promote")
def promote(req: PromoteRequest) -> Dict[str, Any]:
    """Mark an artifact's JSON sidecar file as 'ready to be champion'.

    The actual DB flag flip happens TS-side (modelRouter.ts) since
    the registry lives in PostgreSQL. This endpoint just confirms
    the artifact file exists and writes a tiny `.ready` marker so
    the TS scheduler can pick it up.
    """
    artifact = MODELS_DIR / f"{req.name}-v{req.version}.json"
    if not artifact.exists():
        raise HTTPException(
            status_code=404,
            detail=f"artifact not found: {artifact}",
        )
    marker = MODELS_DIR / f"{req.name}-v{req.version}.ready"
    marker.write_text(
        json.dumps(
            {
                "name": req.name,
                "version": req.version,
                "markedAt": time.time(),
                "notes": req.notes,
            }
        )
    )
    return {"ok": True, "marker": str(marker), "artifact": str(artifact)}
