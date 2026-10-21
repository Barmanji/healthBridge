"""Fit validation-only temperature scaling and report held-out calibration.

Run from the repository root with ml/.venv/bin/python ml/calibrate.py.
No model selection uses the test split. The fitted scalar temperature changes
probability sharpness only; predicted classes remain unchanged.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from scipy.optimize import minimize_scalar
from sklearn.metrics import accuracy_score, log_loss

import hb_ml as hb
import train
from phase_b import ece


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "ml/reports/phase_b/calibration_comparison.json"


def scaled_probabilities(probabilities: np.ndarray, temperature: float) -> np.ndarray:
    log_probabilities = np.log(np.clip(probabilities, 1e-15, 1.0))
    scaled = log_probabilities / temperature
    scaled -= scaled.max(axis=1, keepdims=True)
    exponentials = np.exp(scaled)
    return exponentials / exponentials.sum(axis=1, keepdims=True)


def summarize(y_true: list[str], probabilities: np.ndarray, labels: list[str]) -> dict:
    label_indices = {label: index for index, label in enumerate(labels)}
    target_indices = np.asarray([label_indices[label] for label in y_true])
    one_hot = np.eye(len(labels))[target_indices]
    predictions = np.asarray(labels)[probabilities.argmax(axis=1)]
    error, bins = ece(y_true, probabilities, labels, bins=10)
    return {
        "accuracy": float(accuracy_score(y_true, predictions)),
        "nll": float(log_loss(y_true, probabilities, labels=labels)),
        "multiclass_brier": float(np.mean(np.sum((probabilities - one_hot) ** 2, axis=1))),
        "ece_10_equal_width": error,
        "bins": bins,
    }


def main() -> None:
    train_rows, validation_rows, test_rows = hb.split_by_scenario(hb.load_dataset())
    model = train.build_char_logreg()
    model.fit([row.text for row in train_rows], [row.label for row in train_rows])
    labels = list(model.named_steps["clf"].classes_)

    validation_probabilities = model.predict_proba([row.text for row in validation_rows])
    validation_labels = [row.label for row in validation_rows]
    def validation_nll(log_temperature: float) -> float:
        temperature = float(np.exp(log_temperature))
        probabilities = scaled_probabilities(validation_probabilities, temperature)
        return float(log_loss(validation_labels, probabilities, labels=labels))

    fit = minimize_scalar(validation_nll, bounds=(-3.0, 3.0), method="bounded",
                          options={"xatol": 1e-10})
    temperature = float(np.exp(fit.x))
    test_labels = [row.label for row in test_rows]
    test_probabilities = model.predict_proba([row.text for row in test_rows])
    calibrated_probabilities = scaled_probabilities(test_probabilities, temperature)

    result = {
        "method": "scalar temperature scaling fitted by validation negative log-likelihood",
        "model": "char_logreg",
        "split": "fixed scenario-grouped split",
        "training_seed": hb.RANDOM_SEED,
        "split_seed": hb.SPLIT_SEED,
        "temperature": temperature,
        "train_rows": len(train_rows),
        "validation_rows": len(validation_rows),
        "test_rows": len(test_rows),
        "validation": {
            "raw_nll": validation_nll(0.0),
            "temperature_scaled_nll": float(fit.fun),
            "optimizer_success": bool(fit.success),
        },
        "test": {
            "raw": summarize(test_labels, test_probabilities, labels),
            "temperature_scaled": summarize(test_labels, calibrated_probabilities, labels),
        },
        "note": "Temperature is fitted on validation only. Test metrics are held out. This is a synthetic-data calibration analysis, not a clinical threshold or safety guarantee.",
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"temperature": temperature, "validation": result["validation"],
                      "test_raw": {k: v for k, v in result["test"]["raw"].items() if k != "bins"},
                      "test_temperature_scaled": {k: v for k, v in result["test"]["temperature_scaled"].items() if k != "bins"},
                      "output": str(OUTPUT.relative_to(ROOT))}, indent=2))


if __name__ == "__main__":
    main()
