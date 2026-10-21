"""Fine-tune a pinned MuRIL checkpoint on the grouped synthetic training split.

This is an optional CPU-only experiment; it does not replace the shipped model.
Weights and Hugging Face cache are written under /tmp and are not committed.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import random
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

import hb_ml as hb
from phase_b import ece, render_report

MODEL_ID = "google/muril-base-cased"
MODEL_REVISION = "afd9f36c7923d54e97903922ff1b260d091d202f"
SEED = 20261021


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", type=Path, default=hb.REPORTS_DIR / "phase_b")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--max-length", type=int, default=64)
    parser.add_argument("--unfreeze-last-layers", type=int, default=1,
                        help="fine-tune only the top encoder block(s) plus classification head for CPU feasibility")
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    args = parser.parse_args()

    os.environ.setdefault("HF_HOME", "/tmp/hb-huggingface-cache")
    import torch
    from torch.utils.data import DataLoader, Dataset
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    torch.use_deterministic_algorithms(True, warn_only=True)
    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
    device = torch.device("cpu")

    train_rows, val_rows, test_rows = hb.split_by_scenario(hb.load_dataset())
    labels = list(hb.LABELS)
    label_to_id = {label: index for index, label in enumerate(labels)}
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, revision=MODEL_REVISION)

    class EncodedRows(Dataset):
        def __init__(self, rows):
            self.rows = rows
            self.encoded = tokenizer([row.text for row in rows], truncation=True,
                                     padding="max_length", max_length=args.max_length,
                                     return_tensors="pt")
            self.targets = torch.tensor([label_to_id[row.label] for row in rows], dtype=torch.long)

        def __len__(self):
            return len(self.rows)

        def __getitem__(self, index):
            item = {key: value[index] for key, value in self.encoded.items()}
            item["labels"] = self.targets[index]
            return item

    train_set, val_set, test_set = map(EncodedRows, (train_rows, val_rows, test_rows))
    generator = torch.Generator().manual_seed(SEED)
    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True,
                              generator=generator, num_workers=0)
    val_loader = DataLoader(val_set, batch_size=args.batch_size, shuffle=False, num_workers=0)
    test_loader = DataLoader(test_set, batch_size=args.batch_size, shuffle=False, num_workers=0)

    model = AutoModelForSequenceClassification.from_pretrained(
        MODEL_ID, revision=MODEL_REVISION, num_labels=len(labels),
        id2label={i: label for i, label in enumerate(labels)},
        label2id=label_to_id,
    ).to(device)
    # Full MuRIL backpropagation exceeded a practical CPU budget on this host.
    # Keep embeddings and lower layers frozen, and fine-tune the top encoder block
    # and classification head. This is still transformer fine-tuning, but the
    # restricted trainable parameter set must be reported explicitly.
    for parameter in model.parameters():
        parameter.requires_grad_(False)
    encoder_layers = model.bert.encoder.layer
    unfreeze_count = min(max(0, args.unfreeze_last_layers), len(encoder_layers))
    for layer in encoder_layers[-unfreeze_count:] if unfreeze_count else []:
        for parameter in layer.parameters():
            parameter.requires_grad_(True)
    for parameter in model.classifier.parameters():
        parameter.requires_grad_(True)
    encoder_parameters = [parameter for name, parameter in model.named_parameters()
                          if parameter.requires_grad and not name.startswith("classifier.")]
    head_parameters = [parameter for name, parameter in model.named_parameters()
                       if parameter.requires_grad and name.startswith("classifier.")]
    trainable_parameters = encoder_parameters + head_parameters
    optimizer = torch.optim.AdamW([
        {"params": encoder_parameters, "lr": args.learning_rate},
        {"params": head_parameters, "lr": 5e-4},
    ])
    class_counts = torch.bincount(train_set.targets, minlength=len(labels)).float()
    class_weights = (class_counts.sum() / (len(labels) * class_counts)).to(device)

    def infer(loader):
        model.eval()
        all_logits, all_targets = [], []
        with torch.no_grad():
            for batch in loader:
                batch = {key: value.to(device) for key, value in batch.items()}
                labels_batch = batch.pop("labels")
                logits = model(**batch).logits
                all_logits.append(logits.cpu())
                all_targets.append(labels_batch.cpu())
        return torch.cat(all_logits), torch.cat(all_targets)

    best_f1 = -1.0
    best_weights = None
    epoch_log = []
    started = time.perf_counter()
    for epoch in range(1, args.epochs + 1):
        model.train()
        running_loss = 0.0
        seen = 0
        for batch in train_loader:
            batch = {key: value.to(device) for key, value in batch.items()}
            optimizer.zero_grad(set_to_none=True)
            labels_batch = batch.pop("labels")
            logits = model(**batch).logits
            loss = torch.nn.functional.cross_entropy(logits, labels_batch, weight=class_weights)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            running_loss += float(loss.detach()) * len(labels_batch)
            seen += len(labels_batch)
            if seen % 160 < args.batch_size:
                print(f"epoch {epoch}/{args.epochs}: trained {seen}/{len(train_set)} rows", flush=True)
        val_logits, val_targets = infer(val_loader)
        val_pred = val_logits.argmax(dim=1).numpy()
        val_true = val_targets.numpy()
        from sklearn.metrics import f1_score
        val_f1 = float(f1_score(val_true, val_pred, average="macro", zero_division=0))
        epoch_log.append({"epoch": epoch, "mean_training_loss": running_loss / seen,
                          "validation_macro_f1": val_f1})
        print(f"epoch {epoch}/{args.epochs}: loss={running_loss / seen:.4f} val_macro_f1={val_f1:.4f}", flush=True)
        if val_f1 > best_f1:
            best_f1 = val_f1
            best_weights = {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}

    train_seconds = time.perf_counter() - started
    if best_weights is None:
        raise RuntimeError("No checkpoint selected; training did not complete an epoch.")
    model.load_state_dict(best_weights)
    test_logits, test_targets = infer(test_loader)
    probs = torch.softmax(test_logits, dim=1).numpy()
    y_true_ids = test_targets.numpy()
    y_pred_ids = probs.argmax(axis=1)
    from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
    y_true = [labels[index] for index in y_true_ids]
    y_pred = [labels[index] for index in y_pred_ids]
    report = classification_report(y_true, y_pred, labels=labels, output_dict=True, zero_division=0)
    reliability_ece, bins = ece(y_true, probs, labels)

    def slices(predicate):
        indices = [i for i, row in enumerate(test_rows) if predicate(row)]
        if not indices:
            return {"support": 0, "macro_f1": None, "accuracy": None}
        from sklearn.metrics import f1_score
        truth = [y_true[i] for i in indices]
        pred = [y_pred[i] for i in indices]
        return {"support": len(indices), "accuracy": float(accuracy_score(truth, pred)),
                "macro_f1": float(f1_score(truth, pred, labels=labels, average="macro", zero_division=0))}

    result = {
        "model": MODEL_ID,
        "revision": MODEL_REVISION,
        "model_card": "https://huggingface.co/google/muril-base-cased",
        "selection": "highest validation macro-F1 across the fixed epoch budget",
        "training_method": "partial fine-tuning: classification head and top encoder block(s); lower MuRIL layers frozen to fit CPU budget",
        "hyperparameters": {"epochs": args.epochs, "batch_size": args.batch_size,
                            "max_length": args.max_length, "learning_rate": args.learning_rate,
                            "unfreeze_last_layers": unfreeze_count,
                            "classifier_head_learning_rate": 5e-4,
                            "loss": "class-weighted cross entropy",
                            "trainable_parameters": sum(p.numel() for p in trainable_parameters),
                            "total_parameters": sum(p.numel() for p in model.parameters()),
                            "seed": SEED, "device": "CPU", "threads": torch.get_num_threads()},
        "train_seconds": train_seconds,
        "validation_best_macro_f1": best_f1,
        "test": {"accuracy": float(accuracy_score(y_true, y_pred)),
                 "macro_f1": float(report["macro avg"]["f1-score"]),
                 "macro_precision": float(report["macro avg"]["precision"]),
                 "macro_recall": float(report["macro avg"]["recall"]),
                 "per_class": {label: report[label] for label in labels},
                 "confusion_matrix": confusion_matrix(y_true, y_pred, labels=labels).tolist()},
        "calibration": {"method": "raw softmax; 10 equal-width bins", "ece": reliability_ece,
                        "bins": bins, "threshold_045_coverage": float((probs.max(axis=1) >= hb.UNCERTAINTY_THRESHOLD).mean())},
        "by_language": {language: slices(lambda row, language=language: row.language == language)
                        for language in sorted({row.language for row in test_rows})},
        "by_label": {label: slices(lambda row, label=label: row.label == label) for label in labels},
        "epochs": epoch_log,
        "split": {"train": len(train_rows), "validation": len(val_rows), "test": len(test_rows),
                  "strategy": "grouped by scenario_id"},
        "environment": {"python": platform.python_version(), "torch": torch.__version__,
                        "transformers": __import__("transformers").__version__,
                        "platform": platform.platform(), "device": "CPU"},
        "weight_artifact": "not persisted; only metrics are saved",
        "notice": "Synthetic-data learnability only; no clinical validity claim.",
    }
    out = args.out_dir
    out.mkdir(parents=True, exist_ok=True)
    (out / "transformer_metrics.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    metrics_path = out / "metrics.json"
    if metrics_path.exists():
        phase = json.loads(metrics_path.read_text(encoding="utf-8"))
        phase["transformer"] = result
        transformer_name = f"MuRIL fine-tuned CPU ({MODEL_REVISION[:8]})"
        phase["models_grouped"] = [row for row in phase.get("models_grouped", [])
                                    if row.get("model") != transformer_name]
        phase.setdefault("models_grouped", []).append({
            "model": transformer_name,
            "validation_macro_f1": best_f1,
            "test": {"accuracy": result["test"]["accuracy"],
                     "macro_f1": result["test"]["macro_f1"]},
            "train_seconds": train_seconds,
        })
        metrics_path.write_text(json.dumps(phase, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        (out / "report.md").write_text(render_report(phase), encoding="utf-8")
    print(f"MuRIL test accuracy={result['test']['accuracy']:.4f}, macro-F1={result['test']['macro_f1']:.4f}", flush=True)
    print(f"Wrote {out / 'transformer_metrics.json'}", flush=True)


if __name__ == "__main__":
    main()
