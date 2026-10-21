"""Optional local-only SMM4H medication augmentation and external check.

Input TSVs must be obtained under the dataset/platform terms. This script never
copies the source text into the repository or reports individual posts.

Required columns: tweet_id, text, label (original Task 2 label: 1, 2, or 3).
Supply separate official training and evaluation TSVs; never sample evaluation
posts into training.
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

from sklearn.metrics import accuracy_score, classification_report, f1_score
import sklearn

import hb_ml as hb
import train as train_mod

SEED = 20261021
SAMPLE_SIZE = 2000


def load_tsv(path: Path) -> list[dict[str, str]]:
    rows = []
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        required = {"tweet_id", "text", "label"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError(f"{path} must contain TSV columns: {', '.join(sorted(required))}")
        seen = set()
        for row in reader:
            tweet_id, text, label = row["tweet_id"].strip(), row["text"].strip(), row["label"].strip()
            if not tweet_id or not text:
                continue
            if label not in {"1", "2", "3"}:
                raise ValueError(f"Unexpected Task 2 label in {path}; expected 1, 2, or 3")
            if tweet_id in seen:
                raise ValueError(f"Duplicate tweet_id in {path}")
            seen.add(tweet_id)
            rows.append({"tweet_id": tweet_id, "text": text, "label": label})
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train-tsv", type=Path, required=True,
                        help="locally obtained SMM4H training text; never commit this file")
    parser.add_argument("--evaluation-tsv", type=Path, required=True,
                        help="separate official evaluation text; never commit this file")
    parser.add_argument("--out", type=Path, default=hb.REPORTS_DIR / "phase_b" / "smm4h_augmentation_metrics.json")
    args = parser.parse_args()

    training = load_tsv(args.train_tsv)
    external_test = load_tsv(args.evaluation_tsv)
    if not external_test:
        raise ValueError("SMM4H evaluation TSV contains no rows")
    train_ids, test_ids = {r["tweet_id"] for r in training}, {r["tweet_id"] for r in external_test}
    if train_ids & test_ids:
        raise ValueError("SMM4H training and evaluation tweet IDs overlap")
    if len(training) < SAMPLE_SIZE:
        raise ValueError(f"Need at least {SAMPLE_SIZE} training texts; found {len(training)}")

    rng = random.Random(SEED)
    selected = rng.sample(training, SAMPLE_SIZE)
    synthetic_train, _validation, synthetic_test = hb.split_by_scenario(hb.load_dataset())
    original_model = train_mod.build_char_logreg()
    augmented_model = train_mod.build_char_logreg()
    synthetic_x = [row.text for row in synthetic_train]
    synthetic_y = [row.label for row in synthetic_train]
    started = time.perf_counter()
    original_model.fit(synthetic_x, synthetic_y)
    synthetic_fit_seconds = time.perf_counter() - started
    augmented_x = synthetic_x + [row["text"] for row in selected]
    augmented_y = synthetic_y + ["medication"] * SAMPLE_SIZE
    started = time.perf_counter()
    augmented_model.fit(augmented_x, augmented_y)
    augmented_fit_seconds = time.perf_counter() - started

    test_x = [row.text for row in synthetic_test]
    test_y = [row.label for row in synthetic_test]
    synthetic_results = {}
    for name, model in (("synthetic_only", original_model), ("synthetic_plus_2000_smm4h", augmented_model)):
        predictions = list(model.predict(test_x))
        report = classification_report(test_y, predictions, labels=hb.LABELS,
                                       output_dict=True, zero_division=0)
        synthetic_results[name] = {
            "accuracy": float(accuracy_score(test_y, predictions)),
            "macro_f1": float(f1_score(test_y, predictions, labels=hb.LABELS,
                                        average="macro", zero_division=0)),
            "per_class": {label: report[label] for label in hb.LABELS},
        }
    synthetic_results["synthetic_only"]["train_seconds"] = synthetic_fit_seconds
    synthetic_results["synthetic_plus_2000_smm4h"]["train_seconds"] = augmented_fit_seconds

    real_predictions = list(augmented_model.predict([row["text"] for row in external_test]))
    external_metrics = {
        "rows": len(external_test),
        "medication_recall": float(sum(p == "medication" for p in real_predictions) / len(real_predictions)) if real_predictions else None,
        "medication_predicted_count": int(sum(p == "medication" for p in real_predictions)),
        "original_task_label_counts": dict(Counter(row["label"] for row in external_test)),
        "interpretation": "positive-only medication-category recall; the corpus has no non-medication-category negatives, so precision/specificity cannot be estimated",
    }
    result = {
        "experiment": "smm4h-medication-augmentation",
        "run_at": datetime.now(timezone.utc).isoformat(),
        "source": "SMM4H-2017 Task 2, https://data.mendeley.com/datasets/rxwfb3tysd/2",
        "source_license_and_restrictions": "Dataset page identifies CC BY 4.0. Task README prohibits redistribution of tweets, annotations, and the resolved corpus. Inputs were read locally and are not copied into outputs.",
        "seed": SEED,
        "selected_training_rows": SAMPLE_SIZE,
        "available_training_rows": len(training),
        "original_training_label_counts": dict(Counter(row["label"] for row in selected)),
        "mapping": "All Task 2 posts map to the Health-Bridge medication information-type category; original intake certainty labels are retained only as aggregate counts, not treated as Health-Bridge categories.",
        "synthetic_grouped_test": {"rows": len(synthetic_test), "models": synthetic_results},
        "training_rows": {"synthetic_train": len(synthetic_train), "synthetic_plus_smm4h": len(augmented_y)},
        "official_external_evaluation": external_metrics,
        "limits": ["This task corpus contains medication-related posts only.",
                   "External evaluation estimates only positive medication-category recall.",
                   "Tweets are not patient intake statements; domain shift is substantial.",
                   "This is not evidence of clinical validity or real-patient performance."],
        "data_handling": "No tweet text, tweet IDs, usernames, or trained model artifacts are written by this script.",
        "environment": {"python": platform.python_version(), "scikit_learn": sklearn.__version__,
                        "platform": platform.platform(), "cpu_only": True},
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Selected {SAMPLE_SIZE} local training rows; external test rows={len(external_test)}")
    print(f"Synthetic test macro-F1: {synthetic_results['synthetic_only']['macro_f1']:.4f} -> {synthetic_results['synthetic_plus_2000_smm4h']['macro_f1']:.4f}")
    print(f"External medication-category recall: {external_metrics['medication_recall']}")
    print(f"Metrics written to {args.out}; text was not copied.")


if __name__ == "__main__":
    main()
