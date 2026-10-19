"""Inference service for the Health-Bridge statement classifier (ML.md §4).

Loads the trained pipeline once at startup and answers `POST /predict`.

Run:
    ml/.venv/bin/uvicorn api:app --app-dir ml --host 127.0.0.1 --port 8000

Safety notes:
* The service binds to localhost by default. It is an internal component, not a public API.
* Statement text is never logged. Only lengths and category labels appear in logs.
* Output is a documentation category. It is not a diagnosis, not a severity, and must
  never be wired into the intake HALT path.
"""

from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

import joblib
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

import hb_ml as hb

logger = logging.getLogger("health_bridge.ml")

# The statement cap matches the application's own message limit (1800 characters).
MAX_STATEMENT_CHARS = 1800
MODEL_VERSION_FALLBACK = "statement-classifier-lr-v1"

ARTIFACT_PATH = Path(os.environ.get("HB_ML_MODEL_PATH", hb.MODELS_DIR / "statement_classifier.joblib"))
METADATA_PATH = Path(os.environ.get(
    "HB_ML_METADATA_PATH", hb.MODELS_DIR / "statement_classifier.meta.json"))


class PredictRequest(BaseModel):
    text: str = Field(..., description="A single patient statement.")
    language: str | None = Field(default=None, max_length=35)

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("text must be a string")
        stripped = value.strip()
        if not stripped:
            raise ValueError("text must not be empty")
        if len(stripped) > MAX_STATEMENT_CHARS:
            raise ValueError(f"text must be at most {MAX_STATEMENT_CHARS} characters")
        return stripped


class PredictResponse(BaseModel):
    category: str
    modelVersion: str
    confidence: float
    probabilities: dict[str, float]
    uncertain: bool
    uncertaintyThreshold: float
    notice: str


class ModelHolder:
    """Holds the loaded pipeline so the model is read from disk exactly once."""

    def __init__(self) -> None:
        self.pipeline = None
        self.model_version = MODEL_VERSION_FALLBACK
        self.labels: list[str] = list(hb.LABELS)

    def load(self) -> None:
        if not ARTIFACT_PATH.exists():
            raise RuntimeError(
                f"Model artifact not found at {ARTIFACT_PATH}. "
                "Train it first: python ml/train.py"
            )
        self.pipeline = joblib.load(ARTIFACT_PATH)
        if METADATA_PATH.exists():
            import json

            metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
            self.model_version = metadata.get("model_version", MODEL_VERSION_FALLBACK)
            self.labels = metadata.get("labels", list(hb.LABELS))
        logger.info("loaded model %s from %s", self.model_version, ARTIFACT_PATH.name)

    @property
    def ready(self) -> bool:
        return self.pipeline is not None


holder = ModelHolder()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # A missing artifact must not kill the process: surface it through /health and a 503
    # on /predict so the Node adapter can fail open and keep intake running.
    try:
        holder.load()
    except Exception as exc:  # noqa: BLE001 - reported, never swallowed
        logger.error("model load failed: %s", exc)
    yield


app = FastAPI(
    title="Health-Bridge statement classifier",
    version="1.0.0",
    lifespan=lifespan,
    description=(
        "Experimental clinical information-type classifier. Documentation aid only — "
        "not a diagnosis, not a severity score, and not connected to emergency logic."
    ),
)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok" if holder.ready else "model_unavailable",
        "modelVersion": holder.model_version if holder.ready else None,
        "loadError": None if holder.ready else f"artifact missing at {ARTIFACT_PATH.name}",
    }


@app.post("/predict", response_model=PredictResponse)
def predict(request: PredictRequest) -> PredictResponse:
    if not holder.ready:
        raise HTTPException(status_code=503, detail="Classifier model is not loaded.")
    pipeline = holder.pipeline
    started = time.perf_counter()
    try:
        probabilities = pipeline.predict_proba([request.text])[0]
    except Exception:  # noqa: BLE001
        # Never echo statement content back to the caller or into logs.
        logger.error("inference failed for a %d-character statement", len(request.text))
        raise HTTPException(status_code=500, detail="Classification failed.") from None
    elapsed_ms = (time.perf_counter() - started) * 1000.0

    classes = list(pipeline.classes_)
    probability_map = {label: round(float(value), 6) for label, value in zip(classes, probabilities)}
    best_index = int(probabilities.argmax())
    confidence = float(probabilities[best_index])

    logger.info(
        "predicted %s (confidence %.2f, %.2f ms, %d chars) — statement text not logged",
        classes[best_index], confidence, elapsed_ms, len(request.text),
    )

    return PredictResponse(
        category=classes[best_index],
        modelVersion=holder.model_version,
        confidence=round(confidence, 6),
        probabilities=probability_map,
        uncertain=confidence < hb.UNCERTAINTY_THRESHOLD,
        uncertaintyThreshold=hb.UNCERTAINTY_THRESHOLD,
        notice=(
            "Documentation category only. Not a diagnosis, not a severity, and not used "
            "for emergency decisions. A clinician must review it."
        ),
    )
