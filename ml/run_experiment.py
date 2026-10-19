"""Reproducible experiment runner (ML.md §10.A).

Trains and evaluates the baseline and candidate classifiers on one fixed, group-aware
split, then writes machine-readable metrics, graphs, and a Markdown report.

Usage:
    python ml/run_experiment.py                # full run, writes ml/reports/
    python ml/run_experiment.py --quick        # skip the optional feature comparison
    python ml/run_experiment.py --benchmark 300

Artifacts written to `ml/reports/`:
    metrics.json          all measured numbers
    metrics.csv           one row per model
    per_class_metrics.csv one row per model/class
    report.md             human-readable report
    *.png / *.svg         generated figures
"""

from __future__ import annotations

import argparse
import csv
import json
import platform
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.dummy import DummyClassifier
from sklearn.metrics import classification_report, confusion_matrix, precision_recall_fscore_support

import hb_ml as hb
import plots
import train as train_mod

REPORT_DIR_DEFAULT = hb.REPORTS_DIR


# --------------------------------------------------------------------------------------
# Baselines
# --------------------------------------------------------------------------------------

class KeywordBaseline:
    """Deliberately simple keyword-matching baseline for comparison.

    Scores each statement by counting curated cue words per category and predicting the
    highest-scoring category, falling back to the most frequent training label. It is
    intentionally naive — its purpose is to show how much the trained model adds over
    obvious surface cues.
    """

    MODEL_NAME = "keyword_baseline"

    KEYWORDS = {
        "symptom": [
            "pain", "ache", "hurt", "fever", "cough", "vomit", "nausea", "rash", "swelling",
            "burning", "bleeding", "dizzy", "breath", "dard", "khansi", "bukhar", "jalan",
            "sujan", "khujli", "ulti", "chakkar", "दर्द", "खांसी", "बुखार", "जलन", "सूजन",
        ],
        "duration": [
            "since", "ago", "days", "weeks", "months", "years", "hours", "started", "lasted",
            "din", "hafte", "mahine", "saal", "ghante", "shuru", "se", "दिन", "हफ्ते",
            "महीने", "साल", "घंटे", "शुरू", "पहले", "से",
        ],
        "medication": [
            "take", "taking", "tablet", "medicine", "dose", "mg", "prescribed", "inhaler",
            "insulin", "syrup", "drops", "cream", "dawa", "goli", "leti", "leta", "दवा",
            "गोली", "इंसुलिन", "मिलीग्राम", "क्रीम",
        ],
        "allergy": [
            "allergic", "allergy", "reaction", "avoid", "intolerance", "एलर्जी", "एलर्जी",
            "रिएक्शन", "प्रतिक्रिया",
        ],
        "medical_history": [
            "history", "diagnosed", "diagnosis", "chronic", "operation", "surgery", "past",
            "treated", "childhood", "इतिहास", "ऑपरेशन", "इलाज", "पुरानी", "बचपन",
        ],
        "other": [
            "insurance", "village", "travel", "video call", "network", "reminder", "job",
            "family", "बीमा", "गांव", "यात्रा", "परिवार", "नेटवर्क", "याद",
        ],
    }

    def fit(self, texts: list[str], labels: list[str]) -> "KeywordBaseline":
        import collections

        self.default_label = collections.Counter(labels).most_common(1)[0][0]
        return self

    def _score(self, text: str) -> str:
        lowered = text.casefold()
        scores = {label: 0 for label in hb.LABELS}
        for label, words in self.KEYWORDS.items():
            for word in words:
                if word in lowered:
                    scores[label] += 1
        best = max(scores, key=lambda label: scores[label])
        return best if scores[best] > 0 else self.default_label

    def predict(self, texts: list[str]) -> list[str]:
        return [self._score(text) for text in texts]


# --------------------------------------------------------------------------------------
# Evaluation helpers
# --------------------------------------------------------------------------------------

def classifier_scores(pipeline, texts: list[str]) -> tuple[list[str], list[float] | None]:
    """Predict labels and, when available, the maximum class probability."""
    predictions = list(pipeline.predict(texts))
    if hasattr(pipeline, "predict_proba"):
        probabilities = pipeline.predict_proba(texts)
        return predictions, [float(row.max()) for row in probabilities]
    if hasattr(pipeline, "decision_function"):
        scores = np.asarray(pipeline.decision_function(texts), dtype=float)
        if scores.ndim == 2:
            # Softmax over margins gives a comparable, if not calibrated, confidence.
            exp = np.exp(scores - scores.max(axis=1, keepdims=True))
            probabilities = exp / exp.sum(axis=1, keepdims=True)
            return predictions, [float(row.max()) for row in probabilities]
    return predictions, None


def summarise(y_true: list[str], y_pred: list[str], labels: list[str]) -> dict:
    report = classification_report(y_true, y_pred, labels=labels, output_dict=True, zero_division=0)
    precision, recall, f1, support = precision_recall_fscore_support(
        y_true, y_pred, labels=labels, zero_division=0)
    macro = report["macro avg"]
    return {
        "accuracy": float(report["accuracy"]),
        "macro_precision": float(macro["precision"]),
        "macro_recall": float(macro["recall"]),
        "macro_f1": float(macro["f1-score"]),
        "weighted_f1": float(report["weighted avg"]["f1-score"]),
        "per_class": {
            label: {
                "precision": float(precision[i]),
                "recall": float(recall[i]),
                "f1": float(f1[i]),
                "support": int(support[i]),
            }
            for i, label in enumerate(labels)
        },
        "classification_report": report,
        "confusion_matrix": confusion_matrix(y_true, y_pred, labels=labels).tolist(),
    }


def measure_latency(pipeline, texts: list[str], repeats: int) -> dict:
    if repeats <= 0 or not texts:
        return {"status": "unavailable", "reason": "benchmark not requested"}
    samples: list[float] = []
    for _ in range(repeats):
        for text in texts:
            started = time.perf_counter()
            pipeline.predict([text])
            samples.append((time.perf_counter() - started) * 1000.0)
    samples.sort()
    index = min(len(samples) - 1, int(round(0.95 * (len(samples) - 1))))
    return {
        "status": "measured",
        "samples": len(samples),
        "statements": len(texts),
        "median_ms": round(statistics.median(samples), 3),
        "p95_ms": round(samples[index], 3),
        "mean_ms": round(statistics.fmean(samples), 3),
        "min_ms": round(samples[0], 3),
        "max_ms": round(samples[-1], 3),
        "samples_ms": [round(value, 4) for value in samples],
    }


def language_breakdown(test_ex, predictions: list[str], minimum_support: int = 15) -> dict:
    """Per-language metrics when a language has enough independently held-out rows."""
    languages = sorted({e.language for e in test_ex})
    out: dict[str, dict] = {}
    for language in languages:
        pairs = [(e.label, p) for e, p in zip(test_ex, predictions) if e.language == language]
        support = len(pairs)
        if support < minimum_support:
            out[language] = {
                "status": "unavailable",
                "support": support,
                "reason": f"only {support} held-out rows (< {minimum_support}); too few to report",
            }
            continue
        y_true = [label for label, _ in pairs]
        y_pred = [pred for _, pred in pairs]
        stats = summarise(y_true, y_pred, hb.LABELS)
        out[language] = {
            "status": "evaluated",
            "support": support,
            "accuracy": round(stats["accuracy"], 4),
            "macro_f1": round(stats["macro_f1"], 4),
            "macro_precision": round(stats["macro_precision"], 4),
            "macro_recall": round(stats["macro_recall"], 4),
        }
    return out


def error_examples(test_ex, predictions: list[str], limit: int = 12) -> list[dict]:
    mismatches = [
        {"text": example.text, "true": example.label, "predicted": prediction, "language": example.language}
        for example, prediction in zip(test_ex, predictions)
        if prediction != example.label
    ]
    return mismatches[:limit]


# --------------------------------------------------------------------------------------
# Main experiment
# --------------------------------------------------------------------------------------

def run(report_dir: Path, benchmark: int, quick: bool) -> dict:
    report_dir.mkdir(parents=True, exist_ok=True)
    examples = hb.load_dataset()
    manifest = hb.load_manifest()
    train_ex, val_ex, test_ex = hb.split_by_scenario(examples)

    X_train, y_train = [e.text for e in train_ex], [e.label for e in train_ex]
    X_val, y_val = [e.text for e in val_ex], [e.label for e in val_ex]
    X_test, y_test = [e.text for e in test_ex], [e.label for e in test_ex]

    candidates: list[tuple[str, object]] = [
        ("majority_baseline", DummyClassifier(strategy="most_frequent")),
        (KeywordBaseline.MODEL_NAME, KeywordBaseline()),
        ("tfidf_word_logreg", train_mod.build_word_logreg()),
        ("tfidf_word_linear_svc", train_mod.build_word_svm()),
    ]
    if not quick:
        candidates.append(("tfidf_char_logreg", train_mod.build_char_logreg()))
        candidates.append(("tfidf_word_char_logreg", train_mod.build_word_char_logreg()))

    results: list[dict] = []
    fitted: dict[str, object] = {}
    for name, model in candidates:
        started = time.perf_counter()
        model.fit(X_train, y_train)
        train_seconds = time.perf_counter() - started
        val_pred, _ = classifier_scores(model, X_val)
        val_stats = summarise(y_val, val_pred, hb.LABELS)
        fitted[name] = model
        results.append({
            "model": name,
            "status": "fitted",
            "train_seconds": round(train_seconds, 3),
            "validation_accuracy": round(val_stats["accuracy"], 4),
            "validation_macro_f1": round(val_stats["macro_f1"], 4),
        })
        print(f"trained {name:26s} val macro-F1 {val_stats['macro_f1']:.4f}")

    # Selection happens on validation macro-F1 only; the test set is untouched until now.
    # The validation split holds 68 scenario groups, so top candidates can land within
    # noise of each other. Ties within SELECTION_TOLERANCE prefer the cheaper model
    # (fewer features -> faster inference -> smaller artifact), which is the right
    # trade-off for a CPU-only clinical-documentation aid.
    SELECTION_TOLERANCE = 0.005
    ranked = sorted(results, key=lambda row: (row["validation_macro_f1"], row["validation_accuracy"]), reverse=True)
    best_score = ranked[0]["validation_macro_f1"]
    tied = [row for row in ranked if best_score - row["validation_macro_f1"] <= SELECTION_TOLERANCE]
    complexity = {
        "majority_baseline": 0,
        "keyword_baseline": 0,
        "tfidf_word_linear_svc": 1,
        "tfidf_word_logreg": 2,
        "tfidf_char_logreg": 3,
        "tfidf_word_char_logreg": 4,
    }
    selected_row = min(tied, key=lambda row: complexity.get(row["model"], 99))
    selected_name = selected_row["model"]
    selected = fitted[selected_name]
    print(f"\nvalidation ranking: {[row['model'] for row in ranked]}")
    print(f"within {SELECTION_TOLERANCE} of the best: {[row['model'] for row in tied]}")
    print(f"selected: {selected_name}")

    # ---- single final evaluation of every fitted model on the held-out test set ----
    test_predictions: dict[str, list[str]] = {}
    for row in results:
        name = row["model"]
        model = fitted[name]
        predictions, confidences = classifier_scores(model, X_test)
        test_predictions[name] = predictions
        stats = summarise(y_test, predictions, hb.LABELS)
        row["status"] = "evaluated"
        row["accuracy"] = round(stats["accuracy"], 4)
        row["macro_f1"] = round(stats["macro_f1"], 4)
        row["macro_precision"] = round(stats["macro_precision"], 4)
        row["macro_recall"] = round(stats["macro_recall"], 4)
        row["per_class"] = {
            label: {k: (round(v, 4) if isinstance(v, float) else v) for k, v in values.items()}
            for label, values in stats["per_class"].items()
        }
        row["confusion_matrix"] = stats["confusion_matrix"]
        if confidences is not None:
            uncertain = [value for value in confidences if value < hb.UNCERTAINTY_THRESHOLD]
            row["confidence"] = {
                "available": True,
                "uncertainty_threshold": hb.UNCERTAINTY_THRESHOLD,
                "uncertain_count": len(uncertain),
                "uncertain_fraction": round(len(uncertain) / len(confidences), 4),
                "mean_confidence": round(float(np.mean(confidences)), 4),
            }
        else:
            row["confidence"] = {"available": False}

    artifact_path = report_dir / "selected_model.joblib"
    joblib.dump(selected, artifact_path, compress=3)
    artifact_size_kib = round(artifact_path.stat().st_size / 1024, 1)

    latency_texts = [e.text for e in test_ex[: min(40, len(test_ex))]]
    latency = measure_latency(selected, latency_texts, benchmark)

    by_language = language_breakdown(test_ex, test_predictions[selected_name])
    selected_errors = error_examples(test_ex, test_predictions[selected_name])

    confusion_files = plots.confusion_heatmap(
        hb.LABELS, [row for row in results if row["model"] == selected_name][0]["confusion_matrix"],
        selected_name, report_dir)
    f1_files = plots.per_class_f1(
        [row for row in results if row["model"] == selected_name][0]["classification_report"]
        if "classification_report" in [row for row in results if row["model"] == selected_name][0]
        else classification_report(y_test, test_predictions[selected_name], labels=hb.LABELS, output_dict=True, zero_division=0),
        selected_name, report_dir)
    comparison_files = plots.model_comparison(results, report_dir)
    latency_files = plots.inference_latency(latency, report_dir)
    language_files = plots.language_comparison(by_language, report_dir)

    payload = {
        "experiment": "health-bridge-statement-classifier",
        "run_at": datetime.now(timezone.utc).isoformat(),
        "random_seed": hb.RANDOM_SEED,
        "split_seed": hb.SPLIT_SEED,
        "uncertainty_threshold": hb.UNCERTAINTY_THRESHOLD,
        "selection_metric": "validation_macro_f1",
        "selection_tolerance": SELECTION_TOLERANCE,
        "selection_note": (
            "Candidates within SELECTION_TOLERANCE of the best validation macro-F1 are treated as "
            "tied; the least complex (smallest/fastest) of those is chosen, because a CPU-only "
            "documentation aid favours a smaller artifact and lower latency."
        ),
        "selection_ranking": [row["model"] for row in ranked],
        "selection_tied_candidates": [row["model"] for row in tied],
        "selected_model": selected_name,
        "model_artifact_size_kib": artifact_size_kib,
        "dataset": {
            "version": manifest["dataset_version"],
            "rows": manifest["row_count"],
            "scenarios": manifest["scenario_count"],
            "synthetic_only": True,
            "real_world_validation": False,
            "counts_by_label": manifest["counts_by_label"],
            "counts_by_language": manifest["counts_by_language"],
            "provenance": manifest["provenance"],
            "license": manifest["license"],
        },
        "split": {
            "strategy": "grouped by scenario_id (no template leakage across splits)",
            "train_rows": len(train_ex),
            "validation_rows": len(val_ex),
            "test_rows": len(test_ex),
            "train_scenarios": len({e.scenario_id for e in train_ex}),
            "validation_scenarios": len({e.scenario_id for e in val_ex}),
            "test_scenarios": len({e.scenario_id for e in test_ex}),
            "class_imbalance_train": {
                label: sum(1 for e in train_ex if e.label == label) for label in hb.LABELS
            },
        },
        "models": results,
        "selected_metrics": {
            key: value for key, value in
            [row for row in results if row["model"] == selected_name][0].items()
            if key != "classification_report"
        },
        "by_language": by_language,
        "latency": latency,
        "error_examples": selected_errors,
        "environment": {
            "python": platform.python_version(),
            "scikit_learn": sklearn.__version__,
            "platform": platform.platform(),
            "cpu_only": True,
        },
        "figures": {
            "confusion_matrix": confusion_files,
            "per_class_f1": f1_files,
            "model_comparison": comparison_files,
            "inference_latency": latency_files,
            "language_comparison": language_files,
        },
        "notice": (
            "All metrics are measured on synthetic statements authored for this project. "
            "They describe how well the labelling scheme is learnable, not clinical validity."
        ),
    }

    (report_dir / "metrics.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    write_csv(report_dir, results)
    write_report(report_dir, payload)
    return payload


def write_csv(report_dir: Path, results: list[dict]) -> None:
    with (report_dir / "metrics.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["model", "status", "train_seconds", "val_accuracy", "val_macro_f1",
                         "test_accuracy", "test_macro_f1", "test_macro_precision", "test_macro_recall"])
        for row in results:
            writer.writerow([
                row["model"], row["status"], row.get("train_seconds", ""),
                row.get("validation_accuracy", ""), row.get("validation_macro_f1", ""),
                row.get("accuracy", ""), row.get("macro_f1", ""),
                row.get("macro_precision", ""), row.get("macro_recall", ""),
            ])

    with (report_dir / "per_class_metrics.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["model", "category", "precision", "recall", "f1", "support"])
        for row in results:
            for label, values in (row.get("per_class") or {}).items():
                writer.writerow([row["model"], label, values["precision"], values["recall"],
                                 values["f1"], values["support"]])


def write_report(report_dir: Path, payload: dict) -> None:
    selected = payload["selected_metrics"]
    lines: list[str] = []
    add = lines.append

    add("# Health-Bridge statement classifier — experiment report")
    add("")
    add(f"- Run at: `{payload['run_at']}`")
    add(f"- Dataset: `{payload['dataset']['version']}` — {payload['dataset']['rows']} statements, "
        f"{payload['dataset']['scenarios']} scenario groups")
    add(f"- Seed: `{payload['random_seed']}` · split seed: `{payload['split_seed']}`")
    add(f"- Selected model: **{payload['selected_model']}** (chosen on validation macro-F1)")
    add(f"- Selection rule: {payload['selection_note']}")
    add("- Validation ranking: " + ", ".join(f"`{name}`" for name in payload["selection_ranking"]))
    add(f"- Model artifact size: {payload['model_artifact_size_kib']} KiB")
    add("")
    add("> **Synthetic benchmark only.** Every statement is synthetic and authored for this"
        " project. These numbers measure how learnable the labelling scheme is. They are not"
        " evidence of clinical validity, and this model must never be used for diagnosis,"
        " severity, or emergency detection.")
    add("")

    add("## Dataset")
    add("")
    add(f"Provenance: {payload['dataset']['provenance']}")
    add("")
    add(f"License: {payload['dataset']['license']}")
    add("")
    add("| Category | Statements |")
    add("|---|---|")
    for label, count in payload["dataset"]["counts_by_label"].items():
        add(f"| `{label}` | {count} |")
    add("")
    add("| Language | Statements |")
    add("|---|---|")
    for code, count in payload["dataset"]["counts_by_language"].items():
        add(f"| `{code}` | {count} |")
    add("")

    add("## Split")
    add("")
    add(f"Strategy: {payload['split']['strategy']}")
    add("")
    add("| Split | Statements | Scenario groups |")
    add("|---|---|---|")
    for name in ("train", "validation", "test"):
        add(f"| {name} | {payload['split'][f'{name}_rows']} | {payload['split'][f'{name}_scenarios']} |")
    add("")
    add("Training-set class balance: "
        + ", ".join(f"`{k}`={v}" for k, v in payload["split"]["class_imbalance_train"].items()))
    add("")

    add("## Model comparison (held-out test set)")
    add("")
    add("| Model | Validation macro-F1 | Test accuracy | Test macro-F1 | Macro precision | Macro recall | Train time (s) |")
    add("|---|---|---|---|---|---|---|")
    for row in payload["models"]:
        if row.get("status") != "evaluated":
            continue
        add(f"| `{row['model']}` | {row.get('validation_macro_f1', '—')} | {row.get('accuracy', '—')} "
            f"| {row.get('macro_f1', '—')} | {row.get('macro_precision', '—')} | {row.get('macro_recall', '—')} "
            f"| {row.get('train_seconds', '—')} |")
    add("")

    add(f"## Selected model — `{payload['selected_model']}`")
    add("")
    add(f"- Accuracy: **{selected['accuracy']}**")
    add(f"- Macro-F1: **{selected['macro_f1']}**")
    add(f"- Macro precision / recall: {selected['macro_precision']} / {selected['macro_recall']}")
    add("")
    add("### Per-class metrics")
    add("")
    add("| Category | Precision | Recall | F1 | Support |")
    add("|---|---|---|---|---|")
    for label, values in selected["per_class"].items():
        add(f"| `{label}` | {values['precision']} | {values['recall']} | {values['f1']} | {values['support']} |")
    add("")

    add("### Confusion matrix")
    add("")
    add("Rows are the true category, columns the predicted category.")
    add("")
    add("| true \\ pred | " + " | ".join(hb.LABELS) + " |")
    add("|---" * (len(hb.LABELS) + 1) + "|")
    for label, row in zip(hb.LABELS, selected["confusion_matrix"]):
        add(f"| `{label}` | " + " | ".join(str(value) for value in row) + " |")
    add("")

    add("## Inference latency (local CPU)")
    add("")
    latency = payload["latency"]
    if latency.get("status") == "measured":
        add(f"Measured over {latency['samples']} single-statement predictions "
            f"({latency['statements']} distinct statements, ±{latency['samples'] // max(1, latency['statements'])} repeats).")
        add("")
        add(f"- Median: **{latency['median_ms']} ms**")
        add(f"- p95: **{latency['p95_ms']} ms**")
        add(f"- Mean / min / max: {latency['mean_ms']} / {latency['min_ms']} / {latency['max_ms']} ms")
    else:
        add(f"Unavailable: {latency.get('reason', 'not measured')}")
    add("")

    add("## Performance by language")
    add("")
    add("| Language | Support | Accuracy | Macro-F1 | Status |")
    add("|---|---|---|---|---|")
    for code, stats in payload["by_language"].items():
        if stats.get("status") == "evaluated":
            add(f"| `{code}` | {stats['support']} | {stats['accuracy']:.4f} | {stats['macro_f1']:.4f} | evaluated |")
        else:
            add(f"| `{code}` | {stats['support']} | — | — | {stats.get('reason', 'unavailable')} |")
    add("")

    add("## Error analysis")
    add("")
    errors = payload["error_examples"]
    if errors:
        add(f"Showing {len(errors)} of the misclassified test statements.")
        add("")
        add("| Statement | True | Predicted | Language |")
        add("|---|---|---|---|")
        for item in errors:
            safe = item["text"].replace("|", "\\|")
            add(f"| {safe} | `{item['true']}` | `{item['predicted']}` | `{item['language']}` |")
    else:
        add("No misclassifications on the held-out test set.")
    add("")

    add("## Figures")
    add("")
    for name, files in payload["figures"].items():
        if files:
            add(f"- **{name}**: " + ", ".join(f"`{f}`" for f in files))
        else:
            add(f"- **{name}**: unavailable (not enough data to plot fairly)")
    add("")

    add("## Reproduce")
    add("")
    add("```bash")
    add("python ml/generate_dataset.py")
    add("python ml/run_experiment.py")
    add("```")
    add("")
    add(f"Environment: Python {payload['environment']['python']}, "
        f"scikit-learn {payload['environment']['scikit_learn']}, CPU-only.")
    add("")

    (report_dir / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the statement-classifier experiment suite.")
    parser.add_argument("--report-dir", default=str(REPORT_DIR_DEFAULT))
    parser.add_argument("--benchmark", type=int, default=200,
                        help="Number of latency measurement repeats (0 to skip).")
    parser.add_argument("--quick", action="store_true", help="Skip char n-gram feature variants.")
    args = parser.parse_args()
    payload = run(Path(args.report_dir), args.benchmark, args.quick)
    print()
    print(f"selected: {payload['selected_model']}")
    print(f"test macro-F1: {payload['selected_metrics']['macro_f1']}  "
          f"accuracy: {payload['selected_metrics']['accuracy']}")
    print(f"reports written to {args.report_dir}")


if __name__ == "__main__":
    main()
