#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FIGURE — the paper's headline, drawn.

Five earlier versions drew the wrong thing. They were all about one agent losing his best
account to the evidence. That is a true fact and it is not what the abstract claims. The
abstract claims: three self-interested objectives over ONE shared feasible set are driven to
three distinct accounts, and in the richer domain no feasible history satisfies even two of
the three. That is the paper, and it is a Rashomon picture, and it had been left out of a
paper named after Rashomon.

It is drawn on the second domain (Browning's *The Ring and the Book* / the 1698 Franceschini
trial), because that is where the claim is rigorous. In the first domain the utilities are
heavily tied and one account maximizes all three at once, so the three CAN agree there; the
paper is careful about this and so is this figure.

Everything on the page, recomputed by ring-figdata.mjs from ring-magistrate-core.mjs:

    576 candidate accounts  ->  36 the record still permits
    the husband's account is true in  3 of those 36
    the wife's                     in  3
    the priest's                   in  6
    any two of them together       in  0      <- the whole point
    none of the three              in 24

Each witness is separately deniable; the deniability does not compose. At least two of the
three must be false, and no two can be true together -- and no agent was ever instructed to
deceive.

Usage:  node recon/ring-figdata.mjs > recon/ring-figdata.json
        python3 recon/fig-rashomon.py
"""
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

HERE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.path.join(HERE, "ring-figdata.json")))

CAST = D["cast"]
ROLE = D["role"]
N = D["nFeasible"]
COUNTS = D["counts"]

# The one claim the picture makes. If it ever stops holding, do not draw it.
assert D["jointly"] == 0 and all(v == 0 for v in D["pairs"].values()), \
    "two accounts now share a feasible history; this figure's headline is false"
assert sum(COUNTS.values()) + D["nNone"] == N, "the blocks no longer partition Feasible(F)"

plt.rcParams.update({
    "font.family": "serif",
    "font.serif": ["STIXGeneral", "DejaVu Serif"],
    "mathtext.fontset": "stix",
    "pdf.fonttype": 42,
})

INK, GREY, HAIR = "#141414", "#6E6E6E", "#D8D8D8"
TILE, TILE_EDGE = "#EFEFEF", "#DCDCDC"
HUE = {"Guido": "#2A6FD0", "Pompilia": "#E0662B", "Caponsacchi": "#12A06A"}

fig = plt.figure(figsize=(5.5, 2.62))
ax = fig.add_axes([0, 0, 1, 1])
ax.set_xlim(0, 100)
ax.set_ylim(0, 47)
ax.axis("off")

# ------------------------------------------------------------------ the record narrows
ax.text(4.0, 44.0, f"{D['nBefore']} accounts of the killing", fontsize=8, color=GREY,
        va="center", ha="left")
ax.annotate("", xy=(41.5, 44.0), xytext=(33.0, 44.0),
            arrowprops=dict(arrowstyle="-|>", color=GREY, lw=0.9, shrinkA=0, shrinkB=0))
ax.text(37.2, 44.9, "the record", fontsize=7, color=GREY, va="bottom", ha="center")
ax.text(43.0, 44.0, f"{N} it still permits", fontsize=8, color=INK, va="center", ha="left")

# ------------------------------------------------------------------ the field of survivors
TW, TH, TGAP = 4.9, 4.9, 1.25
BLOCKGAP = 4.2


def tile(x, y, face, edge, lw=0.7):
    ax.add_patch(FancyBboxPatch((x, y), TW, TH, boxstyle="round,pad=0,rounding_size=0.9",
                                linewidth=lw, facecolor=face, edgecolor=edge, zorder=2))


# top band: the twelve accounts somebody actually claims, in three groups that do not touch
x = 5.0
ytop = 28.0
lassos = []
for T in CAST:
    n = COUNTS[T]
    x0 = x
    for k in range(n):
        tile(x, ytop, HUE[T] + "33", HUE[T], lw=0.9)
        x += TW + TGAP
    x1 = x - TGAP
    ax.add_patch(FancyBboxPatch((x0 - 1.5, ytop - 1.5), (x1 - x0) + 3.0, TH + 3.0,
                                boxstyle="round,pad=0,rounding_size=1.6",
                                linewidth=1.1, facecolor="none", edgecolor=HUE[T], zorder=3))
    ax.text((x0 + x1) / 2, ytop - 3.4, f"{ROLE[T]} — true in {n}",
            fontsize=7.5, color=HUE[T], ha="center", va="top")
    lassos.append(((x0 + x1) / 2, x0 - 1.5, x1 + 1.5))
    x += BLOCKGAP

ax.text(5.0, ytop + TH + 2.6,
        "each of the three tells an account the record cannot refute",
        fontsize=8.5, color=INK, ha="left", va="bottom")

# bottom band: the twenty-four nobody claims
x, y = 5.0, 11.0
for i in range(D["nNone"]):
    if i and i % 12 == 0:
        y -= TH + TGAP
        x = 5.0
    tile(x, y, TILE, TILE_EDGE)
    x += TW + TGAP
ax.text(5.0, y - 2.6, f"the other {D['nNone']} permitted accounts, which none of them claims",
        fontsize=7.5, color=GREY, ha="left", va="top")

# ------------------------------------------------------------------ the claim
mid = (lassos[0][1] + lassos[2][2]) / 2
ax.text(mid, ytop - 7.6, "\u2014  and no account satisfies any two of them  \u2014",
        fontsize=8.5, color=INK, ha="center", va="center", style="italic")

out = os.path.join(HERE, "fig-rashomon.pdf")
fig.savefig(out)
fig.savefig(out.replace(".pdf", ".png"), dpi=250)
print(f"wrote {out}")
print(f"  {D['nBefore']} -> {N} permitted; "
      + ", ".join(f"{ROLE[T]} {COUNTS[T]}" for T in CAST)
      + f", none {D['nNone']}; every pairwise intersection {list(set(D['pairs'].values()))}")
