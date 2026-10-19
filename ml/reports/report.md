# Health-Bridge statement classifier — experiment report

- Run at: `2026-10-19T17:28:56.859990+00:00`
- Dataset: `synthetic-statements-v1` — 1281 statements, 427 scenario groups
- Seed: `20261019` · split seed: `20261020`
- Selected model: **tfidf_char_logreg** (chosen on validation macro-F1)
- Selection rule: Candidates within SELECTION_TOLERANCE of the best validation macro-F1 are treated as tied; the least complex (smallest/fastest) of those is chosen, because a CPU-only documentation aid favours a smaller artifact and lower latency.
- Validation ranking: `tfidf_char_logreg`, `tfidf_word_char_logreg`, `tfidf_word_linear_svc`, `tfidf_word_logreg`, `keyword_baseline`, `majority_baseline`
- Model artifact size: 217.2 KiB

> **Synthetic benchmark only.** Every statement is synthetic and authored for this project. These numbers measure how learnable the labelling scheme is. They are not evidence of clinical validity, and this model must never be used for diagnosis, severity, or emergency detection.

## Dataset

Provenance: fully synthetic — authored for this project, no scraped or patient data

License: Authored for this repository; redistribute with the project.

| Category | Statements |
|---|---|
| `symptom` | 391 |
| `duration` | 197 |
| `medication` | 180 |
| `allergy` | 153 |
| `medical_history` | 180 |
| `other` | 180 |

| Language | Statements |
|---|---|
| `en` | 411 |
| `hi` | 411 |
| `hinglish` | 411 |
| `mixed` | 48 |

## Split

Strategy: grouped by scenario_id (no template leakage across splits)

| Split | Statements | Scenario groups |
|---|---|---|
| train | 822 | 274 |
| validation | 204 | 68 |
| test | 255 | 85 |

Training-set class balance: `symptom`=247, `duration`=104, `medication`=114, `allergy`=105, `medical_history`=126, `other`=126

## Model comparison (held-out test set)

| Model | Validation macro-F1 | Test accuracy | Test macro-F1 | Macro precision | Macro recall | Train time (s) |
|---|---|---|---|---|---|---|
| `majority_baseline` | 0.0805 | 0.3098 | 0.0788 | 0.0516 | 0.1667 | 0.006 |
| `keyword_baseline` | 0.6309 | 0.6078 | 0.5645 | 0.8304 | 0.5287 | 0.0 |
| `tfidf_word_logreg` | 0.8887 | 0.9255 | 0.9248 | 0.9489 | 0.9078 | 3.851 |
| `tfidf_word_linear_svc` | 0.8975 | 0.9255 | 0.9248 | 0.9506 | 0.9062 | 0.035 |
| `tfidf_char_logreg` | 0.9718 | 0.949 | 0.9404 | 0.9465 | 0.9366 | 5.086 |
| `tfidf_word_char_logreg` | 0.9684 | 0.9608 | 0.9575 | 0.9745 | 0.946 | 4.136 |

## Selected model — `tfidf_char_logreg`

- Accuracy: **0.949**
- Macro-F1: **0.9404**
- Macro precision / recall: 0.9465 / 0.9366

### Per-class metrics

| Category | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| `symptom` | 0.9398 | 0.9873 | 0.963 | 79 |
| `duration` | 0.9565 | 0.9362 | 0.9462 | 47 |
| `medication` | 1.0 | 0.9778 | 0.9888 | 45 |
| `allergy` | 0.931 | 1.0 | 0.9643 | 27 |
| `medical_history` | 1.0 | 0.8667 | 0.9286 | 30 |
| `other` | 0.8519 | 0.8519 | 0.8519 | 27 |

### Confusion matrix

Rows are the true category, columns the predicted category.

| true \ pred | symptom | duration | medication | allergy | medical_history | other |
|---|---|---|---|---|---|---|
| `symptom` | 78 | 0 | 0 | 1 | 0 | 0 |
| `duration` | 0 | 44 | 0 | 0 | 0 | 3 |
| `medication` | 1 | 0 | 44 | 0 | 0 | 0 |
| `allergy` | 0 | 0 | 0 | 27 | 0 | 0 |
| `medical_history` | 1 | 1 | 0 | 1 | 26 | 1 |
| `other` | 3 | 1 | 0 | 0 | 0 | 23 |

## Inference latency (local CPU)

Measured over 4000 single-statement predictions (40 distinct statements, ±100 repeats).

- Median: **0.824 ms**
- p95: **1.846 ms**
- Mean / min / max: 1.006 / 0.685 / 4.619 ms

## Performance by language

| Language | Support | Accuracy | Macro-F1 | Status |
|---|---|---|---|---|
| `en` | 96 | 0.9479 | 0.9469 | evaluated |
| `hi` | 63 | 0.9683 | 0.9588 | evaluated |
| `hinglish` | 84 | 0.9286 | 0.8789 | evaluated |
| `mixed` | 12 | — | — | only 12 held-out rows (< 15); too few to report |

## Error analysis

Showing 12 of the misclassified test statements.

| Statement | True | Predicted | Language |
|---|---|---|---|
| Mujhe dhundhla dikhna ki takleef hai. | `symptom` | `allergy` | `hinglish` |
| Mujhe ye dheere dheere chaar mahino mein se hai. | `duration` | `other` | `hinglish` |
| Maine ye dheere dheere chaar mahino mein dekha. | `duration` | `other` | `hinglish` |
| Ye dheere dheere chaar mahino mein se chal raha hai. | `duration` | `other` | `hinglish` |
| I am on painkillers only when needed. | `medication` | `symptom` | `en` |
| Mujhe dama hai. | `medical_history` | `symptom` | `hinglish` |
| I had childhood chickenpox. | `medical_history` | `duration` | `en` |
| I have childhood chickenpox. | `medical_history` | `other` | `en` |
| मुझे पिछले साल कलाई की हड्डी टूटी थी है। | `medical_history` | `allergy` | `hi` |
| I stopped smoking four months ago. | `other` | `duration` | `en` |
| I am vegetarian. | `other` | `symptom` | `en` |
| और, मुझे अपॉइंटमेंट की याद दिलानी है। | `other` | `symptom` | `hi` |

## Figures

- **confusion_matrix**: `confusion_matrix.png`, `confusion_matrix.svg`
- **per_class_f1**: `per_class_f1.png`, `per_class_f1.svg`
- **model_comparison**: `model_comparison.png`, `model_comparison.svg`
- **inference_latency**: `inference_latency.png`, `inference_latency.svg`
- **language_comparison**: `language_comparison.png`, `language_comparison.svg`

## Reproduce

```bash
python ml/generate_dataset.py
python ml/run_experiment.py
```

Environment: Python 3.14.7, scikit-learn 1.9.1, CPU-only.

