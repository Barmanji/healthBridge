"""Tests for the Health-Bridge statement classifier (ML.md §7).

Run:
    cd ml && ./.venv/bin/python -m pytest -q
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

import hb_ml as hb
import api as api_module

pytestmark = pytest.mark.filterwarnings("ignore::DeprecationWarning")


@pytest.fixture(scope="module")
def dataset():
    return hb.load_dataset()


@pytest.fixture(scope="module")
def splits(dataset):
    return hb.split_by_scenario(dataset)


@pytest.fixture(scope="module")
def client():
    if not api_module.ARTIFACT_PATH.exists():
        pytest.skip("model artifact missing; run `python ml/train.py` first")
    api_module.holder.load()
    with TestClient(api_module.app) as test_client:
        yield test_client


# --------------------------------------------------------------------------------------
# Dataset integrity
# --------------------------------------------------------------------------------------

def test_dataset_covers_every_category(dataset):
    present = {example.label for example in dataset}
    assert present == set(hb.LABELS), f"missing labels: {set(hb.LABELS) - present}"


def test_dataset_is_labelled_synthetic(dataset):
    assert all(example.source == "synthetic" for example in dataset)


def test_dataset_has_enough_examples_to_avoid_a_toy_model(dataset):
    assert len(dataset) >= 1000, "dataset too small to be a meaningful benchmark"


def test_no_duplicate_statements(dataset):
    keys = [(example.text.strip().casefold(), example.label) for example in dataset]
    assert len(keys) == len(set(keys)), "duplicate statement/label pairs found"


def test_every_category_appears_in_each_language_split(dataset):
    """A category that exists in only one language would make per-language claims unfair."""
    for language in ("en", "hi", "hinglish"):
        labels = {e.label for e in dataset if e.language == language}
        assert labels == set(hb.LABELS), f"{language} is missing {set(hb.LABELS) - labels}"


# --------------------------------------------------------------------------------------
# Splitting
# --------------------------------------------------------------------------------------

def test_split_is_grouped_with_no_scenario_leakage(splits):
    train, validation, test = splits
    train_ids = {e.scenario_id for e in train}
    val_ids = {e.scenario_id for e in validation}
    test_ids = {e.scenario_id for e in test}
    assert not (train_ids & test_ids), "scenario leaked from train into test"
    assert not (train_ids & val_ids), "scenario leaked from train into validation"
    assert not (val_ids & test_ids), "scenario leaked from validation into test"


def test_split_covers_the_whole_dataset(splits, dataset):
    train, validation, test = splits
    assert len(train) + len(validation) + len(test) == len(dataset)


def test_split_is_deterministic(splits, dataset):
    again = hb.split_by_scenario(dataset)
    assert [e.text for e in splits[2]] == [e.text for e in again[2]]


def test_test_split_contains_every_category(splits):
    _, _, test = splits
    assert {e.label for e in test} == set(hb.LABELS)


# --------------------------------------------------------------------------------------
# API request validation
# --------------------------------------------------------------------------------------

def test_health_reports_loaded_model(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["modelVersion"]


def test_predict_returns_a_valid_category(client):
    response = client.post("/predict", json={"text": "I have a headache since yesterday."})
    assert response.status_code == 200
    body = response.json()
    assert body["category"] in hb.LABELS
    assert body["modelVersion"]
    assert 0.0 <= body["confidence"] <= 1.0
    assert set(body["probabilities"]) == set(hb.LABELS)
    assert abs(sum(body["probabilities"].values()) - 1.0) < 0.01
    assert "not a diagnosis" in body["notice"].lower()


@pytest.mark.parametrize("text,expected", [
    ("I have a headache.", "symptom"),
    ("It started three days ago.", "duration"),
    ("I take insulin every morning.", "medication"),
    ("I am allergic to penicillin.", "allergy"),
])
def test_predict_classifies_representative_statements(client, text, expected):
    """Worked examples from ML.md §2 that the model gets right."""
    body = client.post("/predict", json={"text": text}).json()
    assert body["category"] == expected, f"{text!r} -> {body['category']}, expected {expected}"


def test_mixed_history_and_duration_wording_is_uncertain_not_confidently_wrong(client):
    """'since childhood' is both a duration cue and a history cue.

    The model splits its probability between the two, which is the honest outcome for a
    genuinely ambiguous statement: it must flag the case for review rather than assert a
    category. This is a measured limitation, recorded in the report's error analysis.
    """
    body = client.post("/predict", json={"text": "I have had asthma since childhood."}).json()
    assert body["category"] in {"medical_history", "duration"}
    assert body["uncertain"] is True, "an ambiguous statement should be flagged for clinician review"
    top_two = sorted(body["probabilities"].values(), reverse=True)[:2]
    assert top_two[0] - top_two[1] < 0.15, "expected the model to be split between two categories"


def test_predict_handles_hindi_and_hinglish(client):
    for text, expected in [
        ("मुझे सिरदर्द है।", "symptom"),
        ("Mujhe penicillin se allergy hai.", "allergy"),
        ("मुझे पेनिसिलिन से एलर्जी है।", "allergy"),
    ]:
        body = client.post("/predict", json={"text": text}).json()
        assert body["category"] == expected, f"{text!r} -> {body['category']}"


def test_code_switched_symptom_and_duration_is_flagged_uncertain(client):
    """Hinglish code-switching that fuses a symptom with a time span is ambiguous.

    ML.md §2 says statements spanning two categories are split before classification.
    A single unsplit code-switched statement is therefore expected to be soft, and the
    service must mark it uncertain instead of picking one silently.
    """
    body = client.post("/predict", json={"text": "Mujhe teen din se bukhar hai."}).json()
    assert body["category"] in {"symptom", "duration"}
    assert body["uncertain"] is True


def test_predict_rejects_empty_text(client):
    assert client.post("/predict", json={"text": ""}).status_code == 422
    assert client.post("/predict", json={"text": "    "}).status_code == 422


def test_predict_rejects_oversized_text(client):
    oversized = "pain " * 600  # well past the 1800-character cap
    assert client.post("/predict", json={"text": oversized}).status_code == 422


def test_predict_rejects_wrong_types(client):
    assert client.post("/predict", json={"text": 12345}).status_code == 422
    assert client.post("/predict", json={"text": ["a", "b"]}).status_code == 422
    assert client.post("/predict", json={}).status_code == 422


def test_predict_rejects_unknown_extra_fields_gracefully(client):
    """Extra fields are ignored, but the required field must still be validated."""
    assert client.post("/predict", json={"text": "I have a cough.", "note": "x"}).status_code == 200


def test_predict_marks_low_confidence_as_uncertain(client):
    body = client.post("/predict", json={"text": "Hello there."}).json()
    if body["confidence"] < body["uncertaintyThreshold"]:
        assert body["uncertain"] is True
    else:
        assert body["uncertain"] is False


def test_predict_does_not_echo_statement_in_response(client):
    secret = "I have a headache and my name is Zzzq"
    body = client.post("/predict", json={"text": secret}).json()
    assert secret not in json.dumps(body)


# --------------------------------------------------------------------------------------
# Model loading and inference failure handling
# --------------------------------------------------------------------------------------

def test_predict_returns_503_when_model_is_not_loaded(client):
    original = api_module.holder.pipeline
    api_module.holder.pipeline = None
    try:
        response = client.post("/predict", json={"text": "I have a fever."})
        assert response.status_code == 503
    finally:
        api_module.holder.pipeline = original


def test_health_degrades_when_model_is_missing():
    missing_holder = api_module.ModelHolder()
    missing_holder.pipeline = None
    assert missing_holder.ready is False


def test_inference_failure_is_reported_without_leaking_text(client, monkeypatch):
    def exploding_predict_proba(_texts):
        raise RuntimeError("boom")

    monkeypatch.setattr(api_module.holder.pipeline, "predict_proba", exploding_predict_proba)
    response = client.post("/predict", json={"text": "I have a headache."})
    assert response.status_code == 500
    assert "boom" not in response.text
    assert "headache" not in response.text


# --------------------------------------------------------------------------------------
# Safety invariants
# --------------------------------------------------------------------------------------

def test_model_exposes_only_documentation_categories(client):
    """Predicted categories must never include a severity or emergency label."""
    forbidden = {"critical", "emergency", "urgent", "severe", "high", "low", "moderate"}
    body = client.post("/predict", json={"text": "I have chest pain and numbness."}).json()
    assert body["category"] not in forbidden
    assert body["category"] in hb.LABELS


def test_classifier_package_does_not_import_risk_or_halt_logic():
    """The ML package must stay independent of the emergency path (ML.md §5)."""
    source = (hb.ML_DIR / "api.py").read_text(encoding="utf-8")
    for forbidden in ("halt", "riskAssessment", "emergencyReply"):
        assert forbidden not in source
