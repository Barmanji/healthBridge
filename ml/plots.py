"""Plot generation from real experiment results.

Every figure is drawn from the metrics JSON produced by `run_experiment.py`. Nothing
is hardcoded: if a comparison or language subgroup was not evaluated, the figure is
skipped and the report records it as unavailable (ML.md §10.C).
"""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # headless, no display needed on a laptop

import matplotlib.pyplot as plt
import numpy as np

from sklearn.metrics import confusion_matrix

FIGURE_DPI = 150


def _save(fig, out_dir: Path, name: str) -> list[str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[str] = []
    png = out_dir / f"{name}.png"
    fig.savefig(png, dpi=FIGURE_DPI, bbox_inches="tight")
    written.append(png.name)
    svg = out_dir / f"{name}.svg"
    try:
        fig.savefig(svg, bbox_inches="tight")
        written.append(svg.name)
    except Exception:
        pass
    plt.close(fig)
    return written


def confusion_heatmap(labels: list[str], matrix: list[list[int]], model_name: str, out_dir: Path) -> list[str]:
    data = np.asarray(matrix, dtype=float)
    fig, ax = plt.subplots(figsize=(8, 6.5))
    im = ax.imshow(data, cmap="Blues")
    ax.set_xticks(range(len(labels)), labels, rotation=45, ha="right")
    ax.set_yticks(range(len(labels)), labels)
    ax.set_xlabel("Predicted category")
    ax.set_ylabel("True category")
    ax.set_title(f"Confusion matrix — {model_name}\nheld-out test set, synthetic statements")
    for i in range(len(labels)):
        for j in range(len(labels)):
            value = int(data[i, j])
            if value == 0:
                continue
            ax.text(j, i, str(value), ha="center", va="center",
                    color="white" if value > data.max() * 0.55 else "black", fontsize=9)
    fig.colorbar(im, ax=ax, fraction=0.046, label="statements")
    return _save(fig, out_dir, "confusion_matrix")


def per_class_f1(report: dict, model_name: str, out_dir: Path) -> list[str]:
    labels = [label for label in report if label not in ("accuracy", "macro avg", "weighted avg")]
    f1s = [report[label]["f1-score"] for label in labels]
    fig, ax = plt.subplots(figsize=(8, 4.5))
    bars = ax.bar(labels, f1s, color="#2FA58E")
    ax.set_ylim(0, 1.05)
    ax.set_ylabel("F1 score")
    ax.set_title(f"Per-class F1 — {model_name}\nheld-out test set, synthetic statements")
    ax.set_xticks(range(len(labels)), labels, rotation=30, ha="right")
    for bar, value in zip(bars, f1s):
        ax.text(bar.get_x() + bar.get_width() / 2, value + 0.02, f"{value:.2f}",
                ha="center", fontsize=8)
    return _save(fig, out_dir, "per_class_f1")


def model_comparison(results: list[dict], out_dir: Path) -> list[str]:
    evaluated = [row for row in results if row.get("status") == "evaluated"]
    if len(evaluated) < 2:
        return []
    names = [row["model"] for row in evaluated]
    x = np.arange(len(names))
    width = 0.38
    fig, ax = plt.subplots(figsize=(9, 4.8))
    ax.bar(x - width / 2, [row["accuracy"] for row in evaluated], width, label="Accuracy", color="#5B9BD5")
    ax.bar(x + width / 2, [row["macro_f1"] for row in evaluated], width, label="Macro-F1", color="#2FA58E")
    ax.set_ylim(0, 1.05)
    ax.set_xticks(x, names, rotation=20, ha="right")
    ax.set_ylabel("Score")
    ax.set_title("Model comparison on the held-out test set")
    ax.legend()
    return _save(fig, out_dir, "model_comparison")


def confidence_distribution(confidences: list[float], out_dir: Path) -> list[str]:
    if not confidences:
        return []
    fig, ax = plt.subplots(figsize=(8, 4.5))
    ax.hist(confidences, bins=20, range=(0, 1), color="#8FD3C3", edgecolor="#1B6D5E")
    ax.set_xlabel("Maximum class probability")
    ax.set_ylabel("statements")
    ax.set_title("Confidence distribution — held-out test set")
    return _save(fig, out_dir, "confidence_distribution")


def language_comparison(by_language: dict, out_dir: Path) -> list[str]:
    usable = {
        code: stats for code, stats in by_language.items()
        if stats.get("status") == "evaluated" and stats.get("support", 0) >= 15
    }
    if len(usable) < 2:
        return []
    codes = list(usable)
    x = np.arange(len(codes))
    width = 0.38
    fig, ax = plt.subplots(figsize=(8.5, 4.8))
    ax.bar(x - width / 2, [usable[c]["accuracy"] for c in codes], width, label="Accuracy", color="#5B9BD5")
    ax.bar(x + width / 2, [usable[c]["macro_f1"] for c in codes], width, label="Macro-F1", color="#2FA58E")
    ax.set_ylim(0, 1.05)
    ax.set_xticks(x, [f"{c}\n(n={usable[c]['support']})" for c in codes])
    ax.set_ylabel("Score")
    ax.set_title("Performance by language on the held-out test set")
    ax.legend()
    return _save(fig, out_dir, "language_comparison")


def inference_latency(latency: dict, out_dir: Path) -> list[str]:
    if not latency or not latency.get("samples_ms"):
        return []
    samples = latency["samples_ms"]
    fig, ax = plt.subplots(figsize=(8, 4.5))
    ax.hist(samples, bins=25, color="#FCEBDD", edgecolor="#E8A27A")
    ax.axvline(latency["median_ms"], color="#1B6D5E", linestyle="--", label=f"median {latency['median_ms']:.1f} ms")
    ax.axvline(latency["p95_ms"], color="#D04B4B", linestyle=":", label=f"p95 {latency['p95_ms']:.1f} ms")
    ax.set_xlabel("Inference time (ms, single statement, CPU only)")
    ax.set_ylabel("requests")
    ax.set_title("Inference latency distribution — local CPU")
    ax.legend()
    return _save(fig, out_dir, "inference_latency")


def compute_confusion(y_true: list[str], y_pred: list[str], labels: list[str]) -> list[list[int]]:
    return confusion_matrix(y_true, y_pred, labels=labels).tolist()
