#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FIGURE (v4) — ROUGH DRAFT. Standard form, not yet polished.

Form chosen by the user: (a) a sequential block diagram of the method, (b) one small plot
underneath carrying a real result. This is the compound Figure 1 that ML papers actually use.

Conventions being followed deliberately (sources checked before drawing):
  * (a) is the InstructGPT Fig. 2 pattern -- sequential steps, ONE arrow direction, one noun
    phrase per box. Research found this is the only multi-panel design that reliably survives;
    "three aspects side by side" is the pattern that fails, and is what v1/v2 were.
  * Label budget 5-8, not 40. Canonical constrained-optimization figures use ~5.
  * Direct labels on the marks; no legend box.
  * One accent colour, reserved for the constraint. Everything else grey.
  * Minimum 7pt type (Nature's floor is 5pt, working floor 7-8pt).
  * The numbers and the argument go in the CAPTION, not on the drawing.

Rough means: structure and content are the point here; fonts, exact spacing and final
proportions come after the form is agreed.

Numbers from fig-data.json (fig-data.mjs -> grove-core.mjs). Nothing typed in.

Usage:  node recon/fig-data.mjs > recon/fig-data.json
        python3 recon/fig-method4.py
"""
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

HERE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.path.join(HERE, "fig-data.json")))
A = D["agents"]

assert D["checks"]["onlyOneAgentIsBitten"], "panel (b)'s point is gone: more than one is bitten"

plt.rcParams.update({
    "font.family": "serif",
    "font.serif": ["STIXGeneral", "DejaVu Serif"],
    "mathtext.fontset": "stix",
    "font.size": 8,
    "axes.linewidth": 0.6,
    "pdf.fonttype": 42,
})

INK, GREY, FAINT = "#111111", "#777777", "#CCCCCC"
ACCENT = "#B03A2E"                       # reserved for the constraint, and nothing else
COLOUR = {"bandit": "#2A78D6", "wife": "#EB6834", "samurai": "#1BAF7A"}

fig = plt.figure(figsize=(5.5, 3.15))
gs = fig.add_gridspec(2, 1, height_ratios=[1.0, 1.5], hspace=0.42,
                      left=0.10, right=0.98, top=0.95, bottom=0.13)

# ============================================================== (a) the method, as steps
ax = fig.add_subplot(gs[0])
ax.set_xlim(0, 100)
ax.set_ylim(0, 26)
ax.axis("off")

STEPS = [
    ("candidate\nhistories", f"{D['nAssertions']}", GREY),
    ("replay\nagainst $F$", "", ACCENT),
    ("what survives\n$\\mathrm{Feasible}(F)$", f"{D['nFeasible']}", ACCENT),
    ("$\\arg\\max\\; J$", "", GREY),
]
BW, BH, GAPX = 19.0, 13.0, 7.0
x = 2.0
centres = []
for i, (label, count, col) in enumerate(STEPS):
    ax.add_patch(FancyBboxPatch((x, 7), BW, BH, boxstyle="round,pad=0,rounding_size=1.4",
                                linewidth=0.9, edgecolor=col, facecolor="white", zorder=2))
    ax.text(x + BW / 2, 7 + BH / 2, label, ha="center", va="center",
            fontsize=8, color=INK, zorder=3, linespacing=1.35)
    if count:
        ax.text(x + BW / 2, 5.4, count, ha="center", va="top", fontsize=7.5, color=GREY)
    centres.append(x + BW / 2)
    if i < len(STEPS) - 1:
        ax.add_patch(FancyArrowPatch((x + BW + 0.8, 7 + BH / 2), (x + BW + GAPX - 0.8, 7 + BH / 2),
                                     arrowstyle="-|>", mutation_scale=8, color=GREY,
                                     linewidth=0.9, zorder=1))
    x += BW + GAPX

ax.text(centres[1], 7 + BH + 1.4, "the evidence acts here, and only here",
        ha="center", va="bottom", fontsize=7.5, color=ACCENT)

# ============================================================== (b) one result
ax = fig.add_subplot(gs[1])
ORDER = ["bandit", "wife", "samurai"]
for i, who in enumerate(ORDER):
    a, c = A[who], COLOUR[who]
    if a["bites"]:
        ax.plot([i, i], [a["maxFeas"], a["maxAll"]], color=ACCENT, lw=1.0, zorder=2)
        ax.plot(i, a["maxAll"], "*", ms=11, mfc="white", mec=ACCENT, mew=1.1, zorder=3)
        ax.text(i + 0.10, a["maxAll"], f"  {a['maxAll']}", fontsize=7.5, color=ACCENT,
                va="center", ha="left")
    ax.plot(i, a["maxFeas"], "o", ms=6, mfc=c, mec="white", mew=0.8, zorder=3)
    ax.text(i + 0.10, a["maxFeas"], f"  {a['maxFeas']}", fontsize=7.5, color=INK,
            va="center", ha="left")

bit = [w for w in ORDER if A[w]["bites"]][0]
ax.text(ORDER.index(bit) + 0.30, (A[bit]["maxAll"] + A[bit]["maxFeas"]) / 2,
        "the story he wants,\nwhich the record forbids",
        fontsize=7.5, color=ACCENT, va="center", ha="left", linespacing=1.3)

ax.set_xlim(-0.55, 2.9)
ax.set_ylim(50, 86)
ax.set_xticks(range(len(ORDER)))
ax.set_xticklabels(ORDER, fontsize=8)
for t, who in zip(ax.get_xticklabels(), ORDER):
    t.set_color(COLOUR[who])
ax.set_yticks([60, 70, 80])
ax.set_ylabel("best account available", fontsize=8, color=INK)
for s in ("top", "right"):
    ax.spines[s].set_visible(False)
for s in ("left", "bottom"):
    ax.spines[s].set_color(GREY)
ax.tick_params(colors=GREY, labelsize=7.5, length=2.5, width=0.6)

out = os.path.join(HERE, "fig-method4.pdf")
fig.savefig(out)
fig.savefig(out.replace(".pdf", ".png"), dpi=250)
print(f"wrote {out}  (ROUGH)")
print("  labels on the page:", 4, "box +", 1, "step note +", 3, "agent +", 1, "axis +",
      4, "value +", 1, "call-out")
for w in ORDER:
    print(f"  {w:8s} wants {A[w]['maxAll']:3d}  can have {A[w]['maxFeas']:3d}"
          f"  {'<-- bitten' if A[w]['bites'] else ''}")
