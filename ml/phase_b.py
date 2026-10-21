"""Phase B evaluations beyond the original benchmark.

The fixed grouped-by-scenario synthetic split remains the primary comparison.
This script adds calibration, English-to-Indic transfer, and a row-random split
ablation. It does not overwrite the original report or selected model.

Run from the repository root:
    ml/.venv/bin/python ml/phase_b.py
"""

from __future__ import annotations

import argparse
import csv
import json
import platform
import random
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import sklearn
from sklearn.dummy import DummyClassifier
from sklearn.metrics import accuracy_score, classification_report, f1_score
from sklearn.model_selection import train_test_split

import hb_ml as hb
import train as train_mod
from run_experiment import KeywordBaseline, summarise

SEED = 20261021
OUT_DEFAULT = hb.REPORTS_DIR / "phase_b"


def score(y_true: list[str], y_pred: list[str]) -> dict:
    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "macro_f1": float(f1_score(y_true, y_pred, labels=hb.LABELS,
                                    average="macro", zero_division=0)),
        "classification_report": classification_report(
            y_true, y_pred, labels=hb.LABELS, output_dict=True, zero_division=0),
    }


def ece(y_true: list[str], probabilities: np.ndarray, labels: list[str], bins: int = 10) -> tuple[float, list[dict]]:
    confidence = probabilities.max(axis=1)
    prediction = np.asarray(labels)[probabilities.argmax(axis=1)]
    correct = (prediction == np.asarray(y_true)).astype(float)
    edges = np.linspace(0.0, 1.0, bins + 1)
    rows = []
    total = len(y_true)
    error = 0.0
    for i in range(bins):
        included = ((confidence >= edges[i]) & (confidence < edges[i + 1]))
        if i == bins - 1:
            included |= confidence == 1.0
        count = int(included.sum())
        mean_conf = float(confidence[included].mean()) if count else None
        accuracy = float(correct[included].mean()) if count else None
        if count:
            error += count / total * abs(accuracy - mean_conf)
        rows.append({"lower": float(edges[i]), "upper": float(edges[i + 1]),
                     "count": count, "mean_confidence": mean_conf, "accuracy": accuracy})
    return float(error), rows


def reliability_plot(rows: list[dict], path: Path) -> None:
    present = [row for row in rows if row["count"]]
    fig, ax = plt.subplots(figsize=(6.2, 5.2))
    ax.plot([0, 1], [0, 1], linestyle="--", color="#7d8795", label="Perfect calibration")
    if present:
        sizes = [24 + 4 * row["count"] for row in present]
        ax.scatter([row["mean_confidence"] for row in present],
                   [row["accuracy"] for row in present], s=sizes,
                   color="#2764d8", edgecolor="white", linewidth=0.8,
                   label="Test bins (size = count)")
        ax.plot([row["mean_confidence"] for row in present],
                [row["accuracy"] for row in present], color="#2764d8", alpha=0.45)
    ax.set(xlim=(0, 1), ylim=(0, 1), xlabel="Mean predicted confidence",
           ylabel="Observed accuracy", title="Reliability diagram — grouped synthetic test")
    ax.grid(alpha=0.18)
    ax.legend(loc="upper left", fontsize=8)
    fig.tight_layout()
    fig.savefig(path, dpi=160)
    plt.close(fig)


def evaluate_model(name: str, model, train_rows, test_rows) -> dict:
    texts_train = [row.text for row in train_rows]
    labels_train = [row.label for row in train_rows]
    texts_test = [row.text for row in test_rows]
    labels_test = [row.label for row in test_rows]
    started = time.perf_counter()
    model.fit(texts_train, labels_train)
    train_seconds = time.perf_counter() - started
    predictions = list(model.predict(texts_test))
    result = {"model": name, "train_rows": len(train_rows), "test_rows": len(test_rows),
              "train_seconds": train_seconds, **score(labels_test, predictions)}
    result["per_class"] = result.pop("classification_report")
    result["predictions"] = predictions
    return result


def row_random_split(rows):
    train_val, test = train_test_split(rows, test_size=0.2, random_state=SEED,
                                       stratify=[row.label for row in rows])
    train_rows, val_rows = train_test_split(train_val, test_size=0.2, random_state=SEED + 1,
                                             stratify=[row.label for row in train_val])
    return list(train_rows), list(val_rows), list(test)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", type=Path, default=OUT_DEFAULT)
    parser.add_argument("--transformer", action="store_true",
                        help="run the separately documented CPU MuRIL fine-tuning script after this")
    args = parser.parse_args()
    out = args.out_dir
    out.mkdir(parents=True, exist_ok=True)
    examples = hb.load_dataset()
    train_rows, val_rows, test_rows = hb.split_by_scenario(examples)
    y_train = [row.label for row in train_rows]
    y_test = [row.label for row in test_rows]

    candidates = [
        ("majority", DummyClassifier(strategy="most_frequent")),
        ("keyword", KeywordBaseline()),
        ("word_logreg", train_mod.build_word_logreg()),
        ("char_logreg", train_mod.build_char_logreg()),
        ("word_char_logreg", train_mod.build_word_char_logreg()),
        ("word_linear_svm", train_mod.build_word_svm()),
    ]
    grouped = []
    selected = None
    selected_name = None
    selected_val = -1.0
    for name, model in candidates:
        started = time.perf_counter()
        model.fit([row.text for row in train_rows], y_train)
        train_seconds = time.perf_counter() - started
        val_f1 = f1_score([r.label for r in val_rows], model.predict([r.text for r in val_rows]),
                          labels=hb.LABELS, average="macro", zero_division=0)
        prediction = list(model.predict([r.text for r in test_rows]))
        summary = summarise(y_test, prediction, hb.LABELS)
        grouped.append({"model": name, "validation_macro_f1": float(val_f1),
                        "test": summary, "train_seconds": train_seconds})
        if val_f1 > selected_val:
            selected_val, selected, selected_name = float(val_f1), model, name

    # Calibration and the existing .45 confidence cutoff are measured only on held-out test.
    model_builders = {
        "word_logreg": train_mod.build_word_logreg,
        "char_logreg": train_mod.build_char_logreg,
        "word_char_logreg": train_mod.build_word_char_logreg,
        "word_linear_svm": train_mod.build_word_svm,
    }
    calibration_model = model_builders.get(selected_name, train_mod.build_char_logreg)()
    calibration_model.fit([r.text for r in train_rows], y_train)
    probability_matrix = calibration_model.predict_proba([r.text for r in test_rows])
    probability_labels = list(calibration_model.named_steps["clf"].classes_)
    confidence = probability_matrix.max(axis=1)
    predictions = np.asarray(probability_labels)[probability_matrix.argmax(axis=1)]
    calibration_ece, bins = ece(y_test, probability_matrix, probability_labels)
    threshold = hb.UNCERTAINTY_THRESHOLD
    covered = confidence >= threshold
    threshold_result = {
        "threshold": threshold,
        "covered_count": int(covered.sum()),
        "coverage": float(covered.mean()),
        "accuracy_on_covered": float((predictions[covered] == np.asarray(y_test)[covered]).mean()) if covered.any() else None,
        "error_rate_on_covered": float((predictions[covered] != np.asarray(y_test)[covered]).mean()) if covered.any() else None,
        "accuracy_on_all": float((predictions == np.asarray(y_test)).mean()),
        "interpretation": "descriptive operating point only; threshold is not validated as a clinical rule",
    }
    reliability_plot(bins, out / "reliability_diagram.png")
    with (out / "reliability_bins.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(bins[0]))
        writer.writeheader()
        writer.writerows(bins)

    # Transfer: train on English training rows only; test each target language separately.
    english_train = [row for row in train_rows if row.language == "en"]
    transfer_model = train_mod.build_char_logreg()
    transfer_model.fit([r.text for r in english_train], [r.label for r in english_train])
    transfer = {"training_language": "en", "training_rows": len(english_train), "targets": {}}
    for language in ("hi", "hinglish"):
        target = [row for row in test_rows if row.language == language]
        transfer["targets"][language] = {"support": len(target), **score(
            [r.label for r in target], list(transfer_model.predict([r.text for r in target])))}

    # Ablation: compare same char model under the fixed grouped and row-random splits.
    random_train, random_val, random_test = row_random_split(examples)
    row_model = train_mod.build_char_logreg()
    row_model.fit([r.text for r in random_train], [r.label for r in random_train])
    row_predictions = list(row_model.predict([r.text for r in random_test]))
    row_ablation = {
        "random_split_seed": SEED,
        "train_rows": len(random_train), "validation_rows": len(random_val),
        "test_rows": len(random_test),
        "grouped_char_test_macro_f1": next(r["test"]["macro_f1"] for r in grouped if r["model"] == "char_logreg"),
        "random_char_test": summarise([r.label for r in random_test], row_predictions, hb.LABELS),
        "warning": "random split permits scenario templates to occur in multiple splits; this is leakage-prone by design",
    }

    selected_errors = []
    for row, predicted, conf in zip(test_rows, predictions.tolist(), confidence.tolist()):
        if row.label != predicted:
            selected_errors.append({"true": row.label, "predicted": predicted,
                                    "language": row.language, "source": row.source,
                                    "confidence": float(conf), "text": row.text})
    language_slices = {}
    label_slices = {}
    for language in sorted({row.language for row in test_rows}):
        idx = [i for i, row in enumerate(test_rows) if row.language == language]
        language_slices[language] = {"support": len(idx), **score(
            [y_test[i] for i in idx], [str(predictions[i]) for i in idx])}
    for label in hb.LABELS:
        idx = [i for i, row in enumerate(test_rows) if row.label == label]
        label_slices[label] = {"support": len(idx),
                               "correct": sum(predictions[i] == label for i in idx),
                               "recall": (sum(predictions[i] == label for i in idx) / len(idx)) if idx else None,
                               "predicted_as": dict(Counter(str(predictions[i]) for i in idx))}

    try:
        import torch
        torch_version = torch.__version__
    except ImportError:
        torch_version = None
    try:
        import transformers
        transformers_version = transformers.__version__
    except ImportError:
        transformers_version = None

    payload = {
        "experiment": "health-bridge-phase-b",
        "run_at": datetime.now(timezone.utc).isoformat(),
        "seed": SEED,
        "split_seed": hb.SPLIT_SEED,
        "data": {"dataset_version": hb.load_manifest()["dataset_version"],
                 "row_count": len(examples), "source": "synthetic authored scenario templates",
                 "grouped_split_sizes": {"train": len(train_rows), "validation": len(val_rows), "test": len(test_rows)}},
        "models_grouped": grouped,
        "calibration": {"model": selected_name, "method": "raw logistic-regression predict_proba; 10 equal-width bins",
                        "ece": calibration_ece, "bins": bins, "threshold_045": threshold_result,
                        "note": "ECE is sample-size dependent and is not a clinical safety guarantee"},
        "cross_lingual_transfer": transfer,
        "split_ablation": row_ablation,
        "error_analysis": {"by_language": language_slices, "by_label": label_slices,
                           "misclassified_examples": selected_errors},
        "external_dataset": {
            "status": "not_trained",
            "dataset": "SMM4H-2017 Task 2",
            "reason": "The public release contains tweet IDs, user IDs, and labels only; its README prohibits redistributing tweets, annotations, or the resulting corpus. Text is not available in this environment under a non-paid, compliant route.",
            "source": "https://data.mendeley.com/datasets/rxwfb3tysd/2",
            "next_step": "A lawful locally obtained text TSV is required before real-data training/evaluation; do not commit it or derived corpus rows.",
        },
        "environment": {"python": platform.python_version(), "scikit_learn": sklearn.__version__,
                        "numpy": np.__version__, "matplotlib": matplotlib.__version__,
                        "torch": torch_version, "transformers": transformers_version,
                        "platform": platform.platform(), "cpu_only": True},
        "limitations": ["Synthetic metrics measure learnability of the authored label scheme.",
                        "No clinician adjudication; single-annotator labels; no real patient data.",
                        "Mixed-language held-out subset is small.",
                        "No clinical, diagnostic, triage, severity, or emergency performance claim."],
    }
    (out / "metrics.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (out / "report.md").write_text(render_report(payload), encoding="utf-8")
    print(f"Wrote {out / 'metrics.json'}")
    print(f"Grouped char model test macro-F1: {next(r['test']['macro_f1'] for r in grouped if r['model'] == 'char_logreg'):.4f}")
    print(f"Calibration ECE: {calibration_ece:.4f}; .45 coverage {threshold_result['coverage']:.3f}")
    print(f"SMM4H status: {payload['external_dataset']['status']} (source restriction; see report)")


def render_report(data: dict) -> str:
    lines = ["# Phase B experiment report", "", f"Run: `{data['run_at']}`", "",
             "> All core metrics below use the existing synthetic dataset. They measure learnability of the project’s label scheme, not real-world clinical performance.", "",
             "## Grouped-split baselines", "", "| Model | Validation macro-F1 | Test accuracy | Test macro-F1 |", "|---|---:|---:|---:|"]
    for row in data["models_grouped"]:
        lines.append(f"| {row['model']} | {row['validation_macro_f1']:.4f} | {row['test']['accuracy']:.4f} | {row['test']['macro_f1']:.4f} |")
    lines += ["", "## Calibration", "", f"Ten-bin expected calibration error: **{data['calibration']['ece']:.4f}**.",
              f"At confidence threshold 0.45, coverage was {data['calibration']['threshold_045']['coverage']:.1%} and accuracy among covered examples was {data['calibration']['threshold_045']['accuracy_on_covered']:.1%}.",
              "This is a descriptive operating point, not evidence that 0.45 is a clinically justified threshold.", "",
              "![Reliability diagram](reliability_diagram.png)", "", "## Cross-lingual transfer", "",
              f"A character n-gram model trained on {data['cross_lingual_transfer']['training_rows']} English-only examples was evaluated on Hindi and Hinglish held-out examples:", ""]
    for lang, metrics in data["cross_lingual_transfer"]["targets"].items():
        lines.append(f"- `{lang}` (n={metrics['support']}): macro-F1 {metrics['macro_f1']:.4f}; accuracy {metrics['accuracy']:.4f}.")
    ablation = data["split_ablation"]
    lines += ["", "## Split ablation", "", f"Grouped char-model test macro-F1: {ablation['grouped_char_test_macro_f1']:.4f}; row-random test macro-F1: {ablation['random_char_test']['macro_f1']:.4f}.",
              "The random split allows statements from the same scenario template into multiple partitions and is included only to quantify leakage sensitivity.", "",
              "## SMM4H real-data experiment", "", data["external_dataset"]["reason"], "",
              "The SMM4H-trained comparison is therefore not reported. No real-world efficacy claim can be made from this run.", "",
              "## Error slices", "", "Per-language, per-label, and example-level errors are in `metrics.json`.", ""]
    if data.get("transformer"):
        transformer = data["transformer"]
        lines += ["## Multilingual transformer", "",
                  f"MuRIL (`{transformer['revision']}`) was partially fine-tuned on CPU for {transformer['hyperparameters']['epochs']} epochs. The task head and top encoder block were trainable; lower layers were frozen.",
                  f"Best validation macro-F1: {transformer['validation_best_macro_f1']:.4f}. Grouped held-out test accuracy: {transformer['test']['accuracy']:.4f}; macro-F1: {transformer['test']['macro_f1']:.4f}.",
                  "This run collapsed to the majority label and did not outperform the TF-IDF baseline. It is included as a transparent negative result; it is not evidence that MuRIL is generally unsuitable.", ""]
    lines += ["## Limitations", ""]
    lines += [f"- {item}" for item in data["limitations"]]
    lines += [""]
    return "\n".join(lines)


if __name__ == "__main__":
    main()
