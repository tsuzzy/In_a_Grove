#!/usr/bin/env python3
"""Plot median/IQR best-feasible utility gaps for the Ring solver comparison."""

import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

HERE = Path(__file__).resolve().parent
DATA = json.loads((HERE / "ring-learning-curves-data.json").read_text())
WITNESSES = ["Guido", "Pompilia", "Caponsacchi"]

plt.rcParams.update({
    "font.family": "serif",
    "font.serif": ["Times New Roman", "Times", "DejaVu Serif"],
    "mathtext.fontset": "stix",
    "font.size": 8.0,
    "axes.titlesize": 8.5,
    "axes.labelsize": 8.0,
    "xtick.labelsize": 7.0,
    "ytick.labelsize": 7.0,
    "legend.fontsize": 7.0,
    "axes.linewidth": 0.6,
    "pdf.fonttype": 42,  # embed TrueType, not Type 3 (NeurIPS forbids Type 3)
    "ps.fonttype": 42,
})


def cleaned(points):
    """Sort points and keep the last value at a repeated x coordinate."""
    by_x = {}
    for p in points:
        by_x[int(p["x"])] = float(p["gap"])
    return sorted(by_x.items())


def value_at(points, x):
    xs = [p[0] for p in points]
    idx = np.searchsorted(xs, x, side="right") - 1
    return points[max(0, idx)][1]


def stats(traces):
    all_points = [cleaned(t["trace"]) for t in traces]
    xmax = max(points[-1][0] for points in all_points)
    grid = np.unique(np.geomspace(1, max(2, xmax), 180).astype(int))
    vals = np.array([[value_at(points, x) for x in grid] for points in all_points])
    return grid, np.percentile(vals, 25, axis=0), np.median(vals, axis=0), np.percentile(vals, 75, axis=0)


fig, axes = plt.subplots(2, 3, figsize=(7.15, 4.25), sharey=True)
colors = {"GA": "#b35c2e", "Qlearning": "#2f638d"}
labels = {"GA": "genetic search", "Qlearning": "tabular Q-learning"}

for row, method in enumerate(["GA", "Qlearning"]):
    for col, witness in enumerate(WITNESSES):
        ax = axes[row, col]
        x, q25, med, q75 = stats(DATA["runs"][method][witness])
        color = colors[method]
        ax.fill_between(x, q25, q75, color=color, alpha=0.20, linewidth=0)
        ax.plot(x, med, color=color, linewidth=1.15, drawstyle="steps-post", label=labels[method])
        ax.axhline(0, color="black", linewidth=0.55, linestyle=(0, (2, 2)))
        ax.set_xscale("log")
        ax.set_ylim(-2, 102)
        ax.set_yticks([0, 25, 50, 75, 100])
        ax.grid(axis="y", color="#d7d7d7", linewidth=0.35)
        ax.set_title(witness)
        ax.set_xlabel("replay calls" if method == "GA" else "episodes")
        if col == 0:
            ax.set_ylabel("optimality gap")
        if row == 0:
            ax.tick_params(labelbottom=False)
        ax.legend(loc="upper right", frameon=False, handlelength=1.8)

fig.text(0.008, 0.71, "GA", rotation=90, va="center", ha="left", fontsize=8.5)
fig.text(0.008, 0.29, "Q-learning", rotation=90, va="center", ha="left", fontsize=8.5)
fig.subplots_adjust(left=0.095, right=0.995, bottom=0.13, top=0.88, wspace=0.18, hspace=0.30)
fig.suptitle("Replay learning on The Ring and the Book", fontsize=9.5, y=0.97)
fig.text(0.54, 0.015, "Best-feasible utility gap to the exact enumerated optimum (median; shaded IQR over 8 seeds)",
         ha="center", va="bottom", fontsize=7.4)
fig.savefig(HERE / "fig-ring-curves.pdf", bbox_inches="tight")
