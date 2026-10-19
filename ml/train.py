"""Training pipeline for the Health-Bridge statement classifier.

Trains candidate models on the synthetic statement dataset, selects the best on the
**validation** split, and writes the chosen pipeline plus metadata to `ml/models/`.

Usage:
    python ml/train.py
    python ml/train.py --no-char          # skip the word+char feature variant

The test split is deliberately not touched here. `evaluate.py` / `run_experiment.py`
run the single final evaluation on it.
"""

from __future__ import annotations

import argparse
import json
import platform
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.metrics import accuracy_score, f1_score
from sklearn.pipeline import Pipeline, FeatureUnion

import hb_ml as hb

MODEL_VERSION = "statement-classifier-lr-v1"
ARTIFACT_NAME = "statement_classifier.joblib"
METADATA_NAME = "statement_classifier.meta.json"


def build_word_logreg() -> Pipeline:
    return Pipeline([
        ("tfidf", hb.make_word_tfidf()),
        ("clf", hb.make_logistic_regression()),
    ])


def build_char_logreg() -> Pipeline:
    return Pipeline([
        ("tfidf", hb.make_char_tfidf()),
        ("clf", hb.make_logistic_regression()),
    ])


def build_word_char_logreg() -> Pipeline:
    """Word and character features combined (ML.md §10.F comparison)."""
    return Pipeline([
        ("features", FeatureUnion([
            ("word", hb.make_word_tfidf()),
            ("char", hb.make_char_tfidf()),
        ])),
        ("clf", hb.make_logistic_regression()),
    ])


def build_word_svm() -> Pipeline:
    return Pipeline([
        ("tfidf", hb.make_word_tfidf()),
        ("clf", hb.make_linear_svc()),
    ])


def macro_f1(model: Pipeline, texts: list[str], labels: list[str]) -> float:
    return float(f1_score(labels, model.predict(texts), average="macro", zero_division=0))


def accuracy(model: Pipeline, texts: list[str], labels: list[str]) -> float:
    return float(accuracy_score(labels, model.predict(texts)))


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the Health-Bridge statement classifier.")
    parser.add_argument("--no-char", action="store_true", help="Skip the word+char and char-only variants.")
    parser.add_argument("--out-dir", default=str(hb.MODELS_DIR))
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    examples = hb.load_dataset()
    manifest = hb.load_manifest()
    train_ex, val_ex, _test_ex = hb.split_by_scenario(examples)

    X_train = [e.text for e in train_ex]
    y_train = [e.label for e in train_ex]
    X_val = [e.text for e in val_ex]
    y_val = [e.label for e in val_ex]

    candidates: list[tuple[str, Pipeline]] = [
        ("tfidf_word_logreg", build_word_logreg()),
        ("tfidf_word_linear_svc", build_word_svm()),
    ]
    if not args.no_char:
        candidates.append(("tfidf_char_logreg", build_char_logreg()))
        candidates.append(("tfidf_word_char_logreg", build_word_char_logreg()))

    results: list[dict] = []
    for name, pipeline in candidates:
        started = time.perf_counter()
        pipeline.fit(X_train, y_train)
        train_seconds = time.perf_counter() - started
        val_macro_f1 = macro_f1(pipeline, X_val, y_val)
        val_accuracy = accuracy(pipeline, X_val, y_val)
        results.append({
            "model": name,
            "validation_macro_f1": round(val_macro_f1, 4),
            "validation_accuracy": round(val_accuracy, 4),
            "train_seconds": round(train_seconds, 3),
        })
        print(f"{name:26s} val macro-F1 {val_macro_f1:.4f}  val acc {val_accuracy:.4f}  {train_seconds:.2f}s")

    # Baseline for context: the majority class predicted for everything.
    majority_label = max(set(y_train), key=y_train.count)
    baseline_accuracy = float(np.mean([label == majority_label for label in y_val]))
    baseline_macro_f1 = float(f1_score(
        y_val, [majority_label] * len(y_val), average="macro", zero_division=0))
    print(f"{'majority_baseline':26s} val macro-F1 {baseline_macro_f1:.4f}  val acc {baseline_accuracy:.4f}")

    # Model selection happens on validation data only.
    best = max(results, key=lambda row: (row["validation_macro_f1"], row["validation_accuracy"]))
    selected_name = best["model"]
    selected = dict(candidates)[selected_name]

    artifact_path = out_dir / ARTIFACT_NAME
    joblib.dump(selected, artifact_path, compress=3)

    metadata = {
        "model_version": MODEL_VERSION,
        "selected_model": selected_name,
        "artifact": artifact_path.name,
        "dataset_version": manifest["dataset_version"],
        "dataset_row_count": manifest["row_count"],
        "dataset_synthetic_only": True,
        "labels": hb.LABELS,
        "random_seed": hb.RANDOM_SEED,
        "split_seed": hb.SPLIT_SEED,
        "uncertainty_threshold": hb.UNCERTAINTY_THRESHOLD,
        "selection_metric": "validation_macro_f1",
        "candidate_results": results,
        "majority_baseline": {
            "label": majority_label,
            "validation_macro_f1": round(baseline_macro_f1, 4),
            "validation_accuracy": round(baseline_accuracy, 4),
        },
        "split_sizes": {"train": len(train_ex), "validation": len(val_ex)},
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "environment": {
            "python": platform.python_version(),
            "scikit_learn": sklearn.__version__,
            "platform": platform.platform(),
        },
        "warning": (
            "Experimental documentation aid. Not a diagnosis, not an emergency detector, "
            "and not connected to the intake HALT logic."
        ),
    }
    (out_dir / METADATA_NAME).write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print()
    print(f"selected: {selected_name} (validation macro-F1 {best['validation_macro_f1']:.4f})")
    print(f"artifact: {artifact_path} ({artifact_path.stat().st_size / 1024:.1f} KiB)")
    print(f"metadata: {out_dir / METADATA_NAME}")


if __name__ == "__main__":
    main()
