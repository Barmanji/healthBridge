# Statement classifier (experimental)

A small local model that labels each patient statement with the *type* of clinical
information it contains — symptom, duration, medication, allergy, medical history, or
other context — so a clinician skimming an intake sees structure instead of a wall of
text.

It runs entirely on this machine. No API keys, no GPU, no network calls to a vendor.

> **This is a documentation aid, not a clinical tool.** It does not diagnose, does not
> score severity, and is not connected to the emergency HALT path in any way. Its output
> is a suggestion a clinician can override. Every number below was measured on
> **synthetic statements written for this project** — they say how learnable the labelling
> scheme is, not whether the model is clinically valid.

## What it does

Intake turns are split into short statements, and each statement gets one category:

| Category | Example statement |
|---|---|
| `symptom` | I have a headache since yesterday. |
| `duration` | It started three days ago. |
| `medication` | I take insulin every morning. |
| `allergy` | I am allergic to penicillin. |
| `medical_history` | I have had asthma for years. |
| `other` | I work night shifts at a factory. |

Statements are always stored and shown **verbatim**. The model never rewrites, summarises,
or discards what a patient said.

## Measured results

Run on a Lenovo IdeaPad 5 (i5-1235U, 16 GB RAM, CPU only), Python 3.14.7,
scikit-learn 1.9.1. Full output in [`reports/report.md`](reports/report.md).

Held-out test set (255 statements, never seen during training or model selection):

| Model | Validation macro-F1 | Test accuracy | Test macro-F1 |
|---|---|---|---|
| Majority-class baseline | 0.0805 | 0.3098 | 0.0788 |
| Keyword baseline | 0.6309 | 0.6078 | 0.5645 |
| TF-IDF char n-grams + logistic regression | **0.9718** | 0.9490 | 0.9404 |
| TF-IDF word+char n-grams + logistic regression | 0.9684 | **0.9608** | **0.9575** |
| TF-IDF word + linear SVM | 0.8975 | 0.9255 | 0.9248 |
| TF-IDF word + logistic regression | 0.8887 | 0.9255 | 0.9248 |

The shipped model is the char-only one, selected on **validation** macro-F1 (0.9718 vs
0.9684) with a documented tie-break toward the simpler model. The word+char model
subsequently scored higher on the test set. That is a real consequence of selecting on a
68-group validation split and evaluating once on 255 rows — the gap is within the noise of
a split this size, and tuning the choice to the test score would make that score
meaningless. Both models are trained by the same script, so the comparison is reproducible;
`run_experiment.py` ships whichever one validation picks.

Per language for the shipped model (each language is a real held-out subset, not an
estimate):

| Language | Support | Accuracy | Macro-F1 |
|---|---|---|---|
| English | 96 | 0.9479 | 0.9469 |
| Hindi (Devanagari) | 63 | 0.9683 | 0.9588 |
| Hinglish (Roman script) | 84 | 0.9286 | 0.8789 |
| Code-switched | 12 | — | too few to report fairly (<15 rows) |

Inference latency on this CPU, from the committed run in `reports/report.md`:

- In-process, single statement: **0.475 ms median**, 0.64 ms p95 (8,000 predictions).
- Full HTTP round trip through the FastAPI service: **4.19 ms average** over 50 calls.
- Trained artifact: 217 KiB, loaded once at service startup.

Latency was measured across several runs and varied between roughly 0.5 ms and 0.8 ms
median on this shared laptop, so treat the figure as an order of magnitude rather than a
precise benchmark.

15.7% of test statements fall below the uncertainty threshold and are flagged for review.
That proportion is deliberate: the flag exists so ambiguous statements surface to a
clinician instead of being silently guessed at.

Character n-grams winning on validation was not the expected result — word features are the
usual default for this kind of task. They generalise better across the Devanagari and
Roman-script spelling variants here, which is also why code-switched statements score
lowest: those mix both scripts in a single sentence.

### Where it fails

The error analysis in `reports/report.md` lists every misclassification. The pattern:

- Statements that genuinely span two categories. *"I have had asthma since childhood"* is
  both history and duration, and *"I stopped smoking four months ago"* is both context and
  duration. The model splits its probability between the two (0.38 vs 0.31 in the first
  case) and reports those as `uncertain` rather than asserting a label. That is the
  intended behaviour, and it is the honest outcome for an ambiguous input.
- Long-range context. A statement that only makes sense given the previous turn
  (*"and it's worse at night"*) is classified in isolation, because the app splits turns
  before classifying.

Neither weakness is hidden: both are covered by tests that assert the *uncertain* flag
fires instead of the model guessing confidently.

## Running it

```bash
# One-time setup
python3 -m venv ml/.venv
ml/.venv/bin/pip install -r ml/requirements.txt

# Regenerate the dataset and run the full experiment suite
ml/.venv/bin/python ml/generate_dataset.py
ml/.venv/bin/python ml/run_experiment.py

# Train the artifact the service loads
ml/.venv/bin/python ml/train.py

# Serve it (the Next.js app calls this)
ml/.venv/bin/uvicorn api:app --app-dir ml --host 127.0.0.1 --port 8000
```

The app reads `ML_SERVICE_URL` (default `http://127.0.0.1:8000`). If the service is not
running, intake works normally and the doctor just sees no categories — see below.

## Tests

```bash
# Python: dataset integrity, splitting, API validation, containment
cd ml && ./.venv/bin/python -m pytest -q          # 29 passed

# TypeScript: fail-open paths, statement splitting, response validation
pnpm test                                          # 22 passed

# Live integration: needs Postgres and the service running
pnpm vitest run --config vitest.live.config.ts     # 14 passed
```

The live suite creates and then deletes its own throwaway patient, so it leaves no rows
behind.

## How it is wired into the app

```
patient turn → risk assessment + reply committed (transaction)
             → response sent
             → after() → POST /predict → statement_classifications rows
             → doctor queue shows statements with categories
             → clinician can correct a category (recorded as authoritative)
```

Three properties matter more than the accuracy numbers:

**It fails open.** Classification happens in a Next.js `after()` hook, strictly after the
conversation turn is committed and the response is sent. The HTTP timeout is 1.2 s. If the
service is down, slow, or returns anything unexpected, no rows are written and intake is
unaffected. Nothing in this path can block a patient.

**It never touches the safety path.** Halted (emergency) turns are skipped entirely — an
emergency must not wait on an experimental model, however briefly. The classifier cannot
read or write risk assessments, and a test asserts the module imports nothing from the
triage or risk code.

**It keeps the clinician in charge.** The model's category is stored alongside the
clinician's correction, which is what the UI treats as authoritative. The doctor-facing
block is labelled as experimental and states that categories describe the *type* of
information, never a diagnosis.

## Dataset

1,281 synthetic statements across 427 scenario groups, versioned in `ml/data/`.

- Hand-authored and templated in English, Devanagari Hindi, Roman-script Hinglish, and
  code-switched forms. `data_manifest.json` records counts by category and language.
- Every row is tagged `source: synthetic`. Nothing is scraped and no patient data is used.
- Splitting is **grouped by scenario**, so paraphrases of the same underlying scenario
  never appear in both training and test. A row-level split would leak near-duplicates and
  inflate the score; there is a test asserting zero scenario overlap between splits.

Because it is synthetic-only, no claim about real-world performance is made anywhere. A
clinically meaningful evaluation would need de-identified real intake data under an
appropriate agreement — that is out of scope here, and pretending otherwise would be the
dishonest part of a project like this.

## Layout

```
ml/
  generate_dataset.py   Synthetic dataset generator (seeded, reproducible)
  hb_ml.py              Shared labels, loading, group-aware splitting, estimators
  train.py              Training and validation-based model selection
  run_experiment.py     Baselines, comparison, metrics, report generation
  evaluate.py           Standalone evaluation helper
  plots.py              Figure generation from real metrics only
  api.py                FastAPI service (POST /predict, GET /health)
  test_ml.py            Python test suite
  data/                 Synthetic dataset, ambiguous-case set, manifest
  models/               Trained artifact + metadata (generated, gitignored)
  reports/              metrics.json, metrics.csv, report.md, figures (committed)

lib/ml/classifier.ts    Server-side adapter (split, classify, validate, fail open)
lib/ml/store.ts         Persists classifications after the turn is committed
```

`lib/ml/` is the only part the application imports. The Python side is self-contained and
can be worked on without touching the Next.js app.
