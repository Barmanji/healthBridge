"""Shared helpers for the Health-Bridge statement classifier.

Holds the label set, dataset loading, group-aware splitting, and the estimator
factories so `train.py`, `evaluate.py`, `run_experiment.py`, `api.py` and the tests
all agree on one definition.

Nothing here touches patient data. The only inputs are the synthetic dataset and
trained artifacts on disk.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.svm import LinearSVC

ML_DIR = Path(__file__).resolve().parent
DATA_DIR = ML_DIR / "data"
MODELS_DIR = ML_DIR / "models"
REPORTS_DIR = ML_DIR / "reports"

DATASET_PATH = DATA_DIR / "dataset.jsonl"
MANIFEST_PATH = DATA_DIR / "data_manifest.json"

# Documentation categories only. These are never diagnoses, and no output from this
# package may be used for emergency detection or clinical severity (ML.md §5).
LABELS = ["symptom", "duration", "medication", "allergy", "medical_history", "other"]

RANDOM_SEED = 20261019
SPLIT_SEED = 20261020
TEST_FRACTION = 0.2
VALIDATION_FRACTION = 0.2  # of the remainder after the test split

# A prediction below this maximum class probability is reported as uncertain so the
# clinician is asked to review it instead of trusting it. This is NOT a clinical
# confidence and must never be treated as a safety guarantee.
UNCERTAINTY_THRESHOLD = 0.45


@dataclass(frozen=True)
class Example:
    text: str
    label: str
    language: str
    scenario_id: str
    source: str


def load_dataset(path: Path | None = None) -> list[Example]:
    """Load the synthetic dataset. Raises if the file is missing rather than inventing rows."""
    source_path = path or DATASET_PATH
    if not source_path.exists():
        raise FileNotFoundError(
            f"Dataset not found at {source_path}. Run: python ml/generate_dataset.py"
        )
    examples: list[Example] = []
    with source_path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            raw = json.loads(line)
            if raw["label"] not in LABELS:
                raise ValueError(f"Unknown label {raw['label']!r} in {source_path}")
            examples.append(Example(
                text=raw["text"],
                label=raw["label"],
                language=raw["language"],
                scenario_id=raw["scenario_id"],
                source=raw["source"],
            ))
    if not examples:
        raise ValueError(f"Dataset at {source_path} is empty.")
    return examples


def load_manifest(path: Path | None = None) -> dict:
    manifest_path = path or MANIFEST_PATH
    if not manifest_path.exists():
        raise FileNotFoundError(
            f"Manifest not found at {manifest_path}. Run: python ml/generate_dataset.py"
        )
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def split_by_scenario(
    examples: Iterable[Example],
    test_fraction: float = TEST_FRACTION,
    validation_fraction: float = VALIDATION_FRACTION,
    seed: int = SPLIT_SEED,
) -> tuple[list[Example], list[Example], list[Example]]:
    """Split on `scenario_id`, never on individual rows.

    Statements generated from the same scenario share wording and vocabulary, so a
    row-level split would leak near-duplicates into the test set and inflate the score.
    Returns (train, validation, test).
    """
    import random

    grouped: dict[str, list[Example]] = {}
    for example in examples:
        grouped.setdefault(example.scenario_id, []).append(example)

    scenario_ids = sorted(grouped)
    rng = random.Random(seed)
    rng.shuffle(scenario_ids)

    test_count = max(1, round(len(scenario_ids) * test_fraction))
    val_count = max(1, round((len(scenario_ids) - test_count) * validation_fraction))

    test_ids = set(scenario_ids[:test_count])
    validation_ids = set(scenario_ids[test_count:test_count + val_count])

    train: list[Example] = []
    validation: list[Example] = []
    test: list[Example] = []
    for scenario, rows in grouped.items():
        target = test if scenario in test_ids else validation if scenario in validation_ids else train
        target.extend(rows)
    return train, validation, test


# --------------------------------------------------------------------------------------
# Estimators
# --------------------------------------------------------------------------------------

# `sublinear_tf` damps repeated words, which matters because short statements repeat
# symptom nouns. `min_df=1` keeps rare clinical terms such as a single drug name.
WORD_VECTORIZER_KWARGS = dict(
    analyzer="word",
    ngram_range=(1, 2),
    sublinear_tf=True,
    min_df=1,
    strip_accents=None,
    lowercase=True,
)

CHAR_VECTORIZER_KWARGS = dict(
    analyzer="char_wb",
    ngram_range=(2, 5),
    sublinear_tf=True,
    min_df=2,
    lowercase=True,
)


def make_logistic_regression() -> LogisticRegression:
    return LogisticRegression(
        max_iter=2000,
        C=4.0,
        class_weight="balanced",
        random_state=RANDOM_SEED,
    )


def make_word_tfidf():
    return TfidfVectorizer(**WORD_VECTORIZER_KWARGS)


def make_char_tfidf():
    return TfidfVectorizer(**CHAR_VECTORIZER_KWARGS)


def make_linear_svc():
    return LinearSVC(C=1.0, class_weight="balanced", random_state=RANDOM_SEED)
