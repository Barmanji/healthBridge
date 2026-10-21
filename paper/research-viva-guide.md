# Health-Bridge Classifier: Research and Viva Guide

Use this as a plain-English reference for explaining the project, its calculations, and the limits of the results. The numbers below describe a synthetic benchmark, not real patient performance.

## 30-second explanation

I built a small text classifier for Health-Bridge that sorts each short intake statement into one of six information categories: symptom, duration, medication, allergy, medical history, or other. It converts character fragments into TF-IDF features and uses logistic regression to choose a category. The data was authored for this project, and related examples were kept together during the train, validation, and test split. The classifier is a documentation aid only; it does not diagnose, triage, assess severity, or detect emergencies.

## What was evaluated

### Dataset and split

- **1,281 statements** in **427 scenario groups**, all synthetic and authored for this project.
- Languages: 411 English, 411 Devanagari Hindi, 411 Roman-script Hinglish, and 48 mixed-language statements.
- Labels: symptom (391), duration (197), medication (180), allergy (153), medical history (180), and other (180).
- Split by `scenario_id`, so paraphrases from one scenario cannot appear across multiple splits: train 822 statements / 274 groups; validation 204 / 68; test 255 / 85.
- Dataset-generation seed: `20261019`; split seed: `20261020`. The test set is used for final reporting, not model selection.

There are no patient records or scraped examples. One project annotator assigned the labels, and there was no clinician adjudication. This is a controlled test of whether the written examples teach the model the project's label scheme.

### Classifier and parameters

The main pipeline is:

1. **TF-IDF:** turn text into weighted features. Character n-grams are short sequences of characters, which can capture spelling fragments across Devanagari and Romanized Hindi.
2. **Logistic regression:** learn weights for those features and return a score/probability for each of the six categories.
3. **Prediction:** choose the category with the highest score. A maximum probability below `0.45` is marked uncertain for review; this cutoff is descriptive, not a validated safety or clinical rule.

| Setting | Selected character model |
|---|---|
| Vectorizer analyzer | `char_wb` (character n-grams within word boundaries) |
| N-gram range | 2–5 characters |
| Term frequency | Sublinear TF enabled |
| Minimum document frequency | 2 |
| Lowercase | Yes |
| Logistic regression `C` | 4.0 (regularization strength is inversely related to C) |
| Class weights | `balanced` |
| Maximum iterations | 2,000 |
| Random seed | `20261019` |

Word-model settings were word n-grams 1–2, sublinear TF, `min_df=1`, lowercase, and no accent stripping. The word-plus-character model combines those word and character features and uses the same logistic regression. The linear SVM baseline used word TF-IDF, `C=1.0`, and balanced class weights. The majority baseline always predicts the most common training label; the keyword baseline counts hand-selected cue words.

### How the scores are calculated

For each class, the confusion matrix counts correct and incorrect predictions. Rows are the true labels and columns are predicted labels.

- **Accuracy** = all correct predictions / all examples. For the selected model, the diagonal sums to 242, so `242 / 255 = 0.9490` (94.90%).
- **Precision for a class** = true positives / (true positives + false positives). Of the examples predicted as that class, how many were right?
- **Recall for a class** = true positives / (true positives + false negatives). Of the examples that really belonged to that class, how many were found?
- **F1 for a class** = `2 × precision × recall / (precision + recall)`.
- **Macro-F1** = the average of the six class F1 scores. Each category counts equally, so a large class cannot hide poor results on a smaller one.
- **ECE (expected calibration error)** = `Σ (bin_count / N) × |bin_accuracy − bin_mean_confidence|`. Predictions are put into ten confidence bins; ECE summarizes the weighted gap between confidence and observed accuracy.
- **NLL (negative log-likelihood)** penalizes assigning low probability to the true label. **Brier score** is the mean squared difference between predicted class probabilities and the one-hot true labels. Lower is better for these metrics.

Example: if a class has precision `0.8` and recall `0.5`, its F1 is `2 × 0.8 × 0.5 / (0.8 + 0.5) = 0.615`. Macro-F1 is then the mean of the F1 values for all six classes.

## Results to quote

### Grouped held-out test results

| Model | Validation macro-F1 | Test accuracy | Test macro-F1 |
|---|---:|---:|---:|
| Majority baseline | 0.0805 | 0.3098 | 0.0788 |
| Keyword baseline | 0.6309 | 0.6078 | 0.5645 |
| Word TF-IDF + logistic regression | 0.8887 | 0.9255 | 0.9248 |
| Word TF-IDF + linear SVM | 0.8975 | 0.9255 | 0.9248 |
| Character TF-IDF + logistic regression (selected) | **0.9718** | 0.9490 | 0.9404 |
| Word + character TF-IDF + logistic regression | 0.9684 | **0.9608** | **0.9575** |

The character model was selected using validation data: its validation macro-F1 was 0.9718 versus 0.9684 for word-plus-character, a 0.0034 difference within the documented 0.005 tie tolerance, with preference for the smaller model. Word-plus-character later scored higher on the test set. Do not use the test score to retroactively change the selection; that would tune the model to the final exam.

Selected character model: macro precision 0.9465, macro recall 0.9366, macro-F1 0.9404. Per-language test macro-F1: English 0.9469 (n=96), Hindi 0.9588 (n=63), Hinglish 0.8789 (n=84). The mixed-language subset has only 12 examples, so it is too small to summarize fairly.

### Additional experiments

- **Split ablation:** character-model macro-F1 was 0.9404 with scenario grouping and 0.9931 with a row-random split, a 0.0527 absolute increase for the leakage-prone split. Related template examples can cross partitions in a row-random split, making the test easier than genuinely unseen scenarios.
- **English-only transfer:** training on 264 English examples and testing on separate language subsets gave Hindi macro-F1 0.2870 (n=63) and Hinglish macro-F1 0.4908 (n=84). This shows that English-only training did not transfer reliably to these subsets.
- **Calibration:** raw probabilities had ECE 0.2756, NLL 0.4619, and Brier score 0.1866. A scalar temperature `T=0.2522`, fitted by validation NLL, changed test ECE to 0.0119, NLL to 0.1548, and Brier to 0.0802; accuracy stayed 0.9490. The scaled predictions concentrate heavily in the top confidence bin (223 of 255), so the small test set and bin counts matter when interpreting ECE.
- **0.45 uncertainty cutoff:** on the raw test probabilities it retained 215/255 examples (84.3% coverage); accuracy among retained examples was 99.5%. This is an observed operating point on synthetic examples, not proof that the threshold is safe or suitable for clinical decisions.
- **MuRIL CPU experiment:** pinned `google/muril-base-cased` revision `afd9f36c7923d54e97903922ff1b260d091d202f`; 3 epochs, batch size 16, max length 64, encoder learning rate `2e-5`, classifier-head rate `5e-4`, one top encoder block unfrozen, class-weighted cross-entropy, seed `20261021`, CPU with 4 threads. It trained 7,092,486 of 237,560,838 parameters. It predicted only the majority class: accuracy 0.3098, macro-F1 0.0788. This reports what happened in this constrained run; it does not show that MuRIL is generally unsuitable.
- **SMM4H medication corpus:** no result is reported. The available release did not provide usable tweet text through the documented compliant, non-paid route, and its instructions restrict redistribution. Do not describe this as a completed real-data experiment.

The CPU report measured 0.475 ms median and 0.637 ms p95 for one in-process prediction over 8,000 predictions. The reported environment was Python 3.14.7 and scikit-learn 1.9.1 on an i5-1235U laptop CPU. Treat this as a local benchmark, not a universal speed claim.

## Likely teacher or interview questions

**What problem does your model solve?**  It organizes short intake statements by information type so a clinician can review them more easily. It does not determine what condition a patient has.

**Why use TF-IDF and logistic regression?**  They are lightweight, fast, and easy to inspect. Character fragments can tolerate spelling variation, including Romanized Hindi. This project compares them with a small CPU fine-tuning attempt rather than claiming they are universally best.

**Why macro-F1 instead of accuracy alone?**  Accuracy can hide weak performance on smaller categories. Macro-F1 gives every category equal weight.

**Why split by scenario instead of by sentence?**  Sentences from one scenario share wording. Keeping each scenario in one partition reduces near-duplicate leakage into the test set.

**Why does the row-random score look better?**  Related template examples can occur in both training and test data, so the model can recognize familiar patterns. The higher score is evidence that the split method changes the result, not evidence of better generalization.

**Why did you select the character model if word-plus-character scored higher on test?**  Selection was made on validation data before using the test results. The character model had the best validation score and was smaller; choosing based on test performance would leak information from the held-out evaluation.

**Does 94.04% macro-F1 mean it works on patients?**  No. It measures performance on authored synthetic examples only. Real patient wording, clinician labels, and clinical settings were not evaluated.

**What does calibration tell you?**  It compares predicted confidence with observed correctness. Temperature scaling improved the measured calibration scores on this split, but small bins and a synthetic test set limit the conclusion.

**Is 0.45 a medically safe threshold?**  No. It is a descriptive review cutoff from this analysis, not a validated clinical or safety threshold.

**Why did the transformer perform poorly?**  This particular partial fine-tuning run predicted one class throughout. CPU limits, a small synthetic dataset, and this setup are possible factors, but the experiment does not prove which caused the collapse or that the model family cannot work.

**What are the main limitations?**  The data is fully synthetic and template-generated, labels came from one annotator without clinician adjudication, and the mixed-language test subset is small. The high scores show the label scheme is learnable from these examples; they do not establish real-world usefulness.

**What would you do next?**  Obtain an ethically and legally usable real-language dataset, have qualified annotators review labels, preserve a speaker/scenario-separated test set, and evaluate prospectively before making any real-world performance claim.

## Reproduction commands

Run from the repository root after installing `ml/requirements.txt` into the project environment:

```bash
python ml/generate_dataset.py
python ml/run_experiment.py
python ml/phase_b.py
python ml/calibrate.py
```

The optional MuRIL run also needs `ml/requirements-transformer.txt` and access to the pinned model checkpoint:

```bash
python ml/phase_b_transformer.py
```

The scripts write reports under `ml/reports/`. Do not regenerate data before reproducing the reported numbers unless you intend to rerun the full experiment.

## Source files for checking details

- Dataset and split: `ml/data/data_manifest.json`, `ml/hb_ml.py`, `ml/generate_dataset.py`
- Baselines and headline scores: `ml/reports/report.md`, `ml/reports/metrics.json`, `ml/models/statement_classifier.meta.json`
- Calibration, transfer, split ablation, and MuRIL: `ml/reports/phase_b/report.md`, `ml/reports/phase_b/metrics.json`, `ml/reports/phase_b/calibration_comparison.json`, `ml/reports/phase_b/transformer_metrics.json`
- Implementations: `ml/train.py`, `ml/run_experiment.py`, `ml/phase_b.py`, `ml/calibrate.py`, `ml/phase_b_transformer.py`
