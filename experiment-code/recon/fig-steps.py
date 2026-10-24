#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FIGURE 1 — the InstructGPT Fig. 2 skeleton, rebuilt after a six-critic review.

Three columns, one reading direction, a Step N tag, a bold headline, a light grey card, one
caption line. Only the content is ours. Two marks in the whole figure: a green tick and a red
cross, both taught in column 2 and reused unchanged in column 3.

WHAT THE REVIEW CHANGED, and why each mattered:

* The cross used to sit beside a PAIR of accounts, having been taught in column 2 as "the
  record refuses this". So the figure said the record refuses the pair. It does not: the paper
  is explicit that every one of the three belongs to Feas(F), so the evidence refutes none of
  them individually. The emptiness is an intersection of two argmax sets -- a fact about the
  OBJECTIVE, not about the constraint. Fixed by moving column 2's verdict off the record's rows
  and onto the ACCOUNT being judged, so the taught meaning is "this account is allowed / this
  account is refused" and transfers to column 3 without smuggling the record in.

* Column 2 used to grade the record itself: eleven rows, nine ticks, two crosses, inside a card
  titled "the record". That is a rubric with partial credit, it implies parts of the RECORD are
  wrong, and it is a picture of the losing baseline (the paper's prompted "self-check each
  fact" row). Feasibility here is all-or-nothing and involves no scoring. The record is now
  eleven plain rows -- a gate, not a scorer.

* The three accounts in column 3 were drawn byte-identically (one bar-width cycle, every call
  site), under a headline reading "No two can be true". Identical objects are obviously
  co-satisfiable. They now differ, and that visible difference -- not the cross -- is what
  carries the contradiction. It is also the cheapest way to get the objective into a figure
  that otherwise draws the constraint twice.

* "any two of them together" was ONE pair glyph. After an exhaustive upper half, one instance
  reads as "these two in particular" -- and by accident of position it named them: the front
  document was pixel-identical in x to the wife's, and the cross sat 3 px from vertical
  alignment under the priest's tick. There are exactly three pairs of three witnesses, so the
  lower half is now exhaustive, in the same three slots and at the same mark size as above.

* "serves him best", set directly above three labels reading husband / wife / priest, on a
  track whose theme is Agency. It is "them" now.

* The caption row ended on 0, which reads as "the method found nothing". It ends on 3 -- the
  paper's actual result -- and the headline above still delivers "No two can be true".

* Added on the panel's unanimous ruling: one line saying nobody was told to lie and that the
  agents never read one another. The headline result is that constrained optimization ALONE
  produces the split; a reader who assumes the three are arguing credits the disagreement to
  the contest instead of to the constraint.

* Deleted the connector arrows: they were bisected by the column rules and contradict them
  (a rule says "separate", an arrow says "flows through"). InstructGPT has rules and no arrows.

Numbers come from ring-figdata.json, emitted by ring-figdata.mjs from ring-magistrate-core.mjs.
Nothing is typed in, and the drawing asserts what it is about to claim.

Usage:  node recon/ring-figdata.mjs > recon/ring-figdata.json
        python3 recon/fig-steps.py
"""
import itertools
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

HERE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.path.join(HERE, "ring-figdata.json")))
CAST, ROLE, COUNTS = D["cast"], D["role"], D["counts"]

assert D["jointly"] == 0 and all(v == 0 for v in D["pairs"].values()), \
    "two accounts now share a feasible history; column 3's headline is false"
assert sum(COUNTS.values()) + D["nNone"] == D["nFeasible"], "the blocks no longer partition"
assert D["nBefore"] > D["nFeasible"] > 0, "the funnel no longer narrows"
assert D["nRecordItems"] > 0, "the record has no items to draw"

plt.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["DejaVu Sans"],
    "pdf.fonttype": 42,
})

INK, GREY, FAINT = "#1A1A1A", "#6B6B6B", "#C0C0C0"
CARD, BAR, PALE = "#F2F2F2", "#D6D6D6", "#EFEFEF"
OK, NO = "#12A06A", "#B03A2E"

fig = plt.figure(figsize=(5.5, 2.98))
ax = fig.add_axes([0, 0, 1, 1])
ax.set_xlim(0, 100)
ax.set_ylim(0, 51)
ax.axis("off")

COLW, COLGAP = 29.0, 5.0
COLX = [1.5, 1.5 + COLW + COLGAP, 1.5 + 2 * (COLW + COLGAP)]
CARD_TOP, CARD_BOT = 37.4, 9.6

for x in COLX[1:]:
    ax.plot([x - COLGAP / 2] * 2, [6.4, 48.9], color="#E8E8E8", lw=0.8, zorder=0)


def rrect(x, y, w, h, face, edge="none", lw=0.0, r=0.9, z=2, alpha=1.0):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle=f"round,pad=0,rounding_size={r}",
                                facecolor=face, edgecolor=edge, linewidth=lw, zorder=z,
                                alpha=alpha))


# Every account in the figure comes from this one function. `pattern` is what makes two
# accounts different OBJECTS rather than two copies of one; column 3's whole claim rests on
# the three being visibly distinct.
def account(x, y, w, h, pattern, z=3, dim=False):
    rrect(x, y, w, h, PALE if dim else "white", edge=FAINT, lw=0.7, r=0.7, z=z)
    for i, frac in enumerate(pattern):
        rrect(x + w * 0.13, y + h - 1.9 - i * 1.5, (w * 0.74) * frac, 0.68,
              "#E2E2E2" if dim else BAR, r=0.3, z=z + 1)


# One mark, one size, everywhere; weight scales with size so the small ones are not
# proportionally heavier.
def mark(x, y, ok, s=0.85):
    c, lw = (OK if ok else NO), 1.05 * s / 0.85
    if ok:
        ax.plot([x - s, x - s * 0.25, x + s], [y, y - s * 0.75, y + s * 0.8],
                color=c, lw=lw, solid_capstyle="round", zorder=6)
    else:
        for d in (1, -1):
            ax.plot([x - s * 0.72, x + s * 0.72], [y - s * 0.72 * d, y + s * 0.72 * d],
                    color=c, lw=lw, solid_capstyle="round", zorder=6)


PATTERNS = [(1.00, 0.55, 0.80), (0.62, 1.00, 0.44), (0.86, 0.38, 1.00)]

HEADS = [
    ("Step 1", "Enumerate every\naccount the domain\ncan produce."),
    ("Step 2", "Replay each one\nagainst the record.\nKeep what survives."),
    ("Step 3", "Each takes the account\nthat serves them best.\nNo two can be true."),
]
for x, (tag, head) in zip(COLX, HEADS):
    ax.text(x, 49.3, tag, fontsize=7, color=GREY, va="top", ha="left")
    ax.text(x, 47.0, head, fontsize=8, color=INK, va="top", ha="left",
            linespacing=1.5, fontweight="bold")

for x in COLX:
    rrect(x, CARD_BOT, COLW, CARD_TOP - CARD_BOT, CARD, r=1.4, z=1)

# ============================================================ 1: the candidates
x0 = COLX[0]
for k, top in enumerate((35.4, 28.4, 21.4)):
    account(x0 + 3.0 + k * 1.7, top - 6.4, 17.4, 6.4, PATTERNS[k])
ax.text(x0 + 3.0 + 2 * 1.7 + 19.6, 12.9, "⋮", fontsize=12, color=GREY,
        ha="center", va="center")

# ============================================================ 2: the record is a gate
x1 = COLX[1]
rrect(x1 + 2.0, 22.6, 25.0, 13.4, "white", edge=FAINT, lw=0.7, r=0.9, z=3)
ax.text(x1 + 4.0, 34.2, "the record", fontsize=7,
        color=GREY, ha="left", va="center", zorder=5)
# Named, not suggested. The eleven are what the magistrate actually files, in filing order,
# and they come from LADDER -- the same list the filtration figure sweeps.
NAMES = D["recordItems"]
half = (len(NAMES) + 1) // 2
for i, nm in enumerate(NAMES):
    col, row = divmod(i, half)
    ax.text(x1 + 4.6 + col * 12.9, 31.9 - row * 1.72, nm, fontsize=7, color=INK,
            ha="left", va="center", zorder=5)
    ax.plot([x1 + 3.9 + col * 12.9], [31.9 - row * 1.72], marker="o", ms=1.4,
            color=FAINT, zorder=5)

for k, (dx, ok) in enumerate(((3.6, True), (15.8, False))):
    account(x1 + dx, 14.0, 9.6, 6.2, PATTERNS[k], dim=not ok)
    mark(x1 + dx + 4.8, 11.9, ok)

# ============================================================ 3: allowed alone, never in pairs
x2 = COLX[2]
SLOT = [x2 + 5.9, x2 + 14.5, x2 + 23.1]
ax.text(x2 + COLW / 2, 35.7, "each account on its own",
        fontsize=7, color=INK, ha="center", va="center", zorder=5)
for k, T in enumerate(CAST):
    account(SLOT[k] - 3.4, 28.4, 6.8, 5.8, PATTERNS[k])
    mark(SLOT[k], 26.5, True)
    ax.text(SLOT[k], 24.4, ROLE[T].replace("the ", ""), fontsize=7, color=GREY,
            ha="center", va="center", zorder=5)

ax.plot([x2 + 2.6, x2 + COLW - 2.6], [22.4] * 2, color="#E0E0E0", lw=0.8, zorder=1)

PAIRS = list(itertools.combinations(range(len(CAST)), 2))
assert len(PAIRS) == len(D["pairs"]), "the pair count no longer matches the data"
ax.text(x2 + COLW / 2, 20.4, "any two of them together",
        fontsize=7, color=INK, ha="center", va="center", zorder=5)
for k, (i, j) in enumerate(PAIRS):
    account(SLOT[k] - 4.0, 13.9, 5.0, 5.0, PATTERNS[i], z=3)
    account(SLOT[k] - 1.0, 12.8, 5.0, 5.0, PATTERNS[j], z=5)
    mark(SLOT[k], 11.0, False)

# ============================================================ the caption row
maxPair = max(D["pairs"].values())
assert maxPair == 0, "some pair is now jointly satisfiable; the last caption is false"
for x, line in zip(COLX, [f"{D['nBefore']} possible accounts",
                          f"{D['nFeasible']} survive the record",
                          f"{len(CAST)} accounts, each possible alone"]):
    ax.text(x + COLW / 2, CARD_BOT - 2.2, line, fontsize=7.5, color=INK,
            ha="center", va="top")

# centred on the whole figure, not on column 3: at 7pt the line is wider than a column and
# was running off the right edge
ax.text(50.0, CARD_BOT - 5.0,
        "Nobody was told to lie, and they never read one another.",
        fontsize=7.5, color=GREY, ha="center", va="top", style="italic")

out = os.path.join(HERE, "fig-steps.pdf")
fig.savefig(out)
fig.savefig(out.replace(".pdf", ".png"), dpi=260)
print(f"wrote {out}")
print(f"  {D['nBefore']} -> {D['nFeasible']} -> {len(CAST)}; "
      f"all {len(PAIRS)} pairs jointly satisfiable in {maxPair} of the {D['nFeasible']}")
