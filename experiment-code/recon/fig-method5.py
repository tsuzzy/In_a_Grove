#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FIGURE (v5) — the standard compound form, as decided by the model panel.

Form: (a) sequential blocks, (b) one result plot. Chosen by the author.
The three open questions inside that form went to the three-family panel (decide.py):

  * THREE boxes, not four (3-0). Replay and its surviving set merge: the survivors ARE the
    output of the replay, so a separate box spends a concept on a restatement.
  * Panel (b) carries the BLAME split, not "the constraint is selective" (3-0, one model
    changing its mind in round 2). The rejected option plotted three agents of whom two do not
    move; two motionless dots are not a conclusion a reader can see.
  * ONE accent colour, spent in (a) on where the evidence acts; (b) goes neutral (2-1).
    Recorded dissent (Google): the accent belongs on the punchline -- desire against evidence --
    not on boxes in a process flow. If the figure later reads as flat, that dissent is the
    first thing to try.

What (b) says: inside what the record still allows, the bandit's best accounts all put the
blade in somebody else's hand. Owning the killing caps him at 48; blaming another pays 58, on
seven tied accounts. Self-interest and self-incrimination come apart, and nobody was told to
lie -- that is the whole paper in one panel.

Not drawn, deliberately: the other two agents' maximizer sets. Exactly one account maximizes
all three utilities in this domain, so drawing the sets would show the three agreeing -- the
opposite of the paper's headline, which is carried on the richer second domain.

Numbers from fig-data.json (fig-data.mjs -> grove-core.mjs). Nothing typed in; the drawing
asserts what it is about to claim.

Usage:  node recon/fig-data.mjs > recon/fig-data.json
        python3 recon/fig-method5.py
"""
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

HERE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.path.join(HERE, "fig-data.json")))
BANDIT = D["agents"]["bandit"]

OWNS, BLAMES = BANDIT["bestWhileOwningIt"], BANDIT["maxFeas"]
assert OWNS < BLAMES, "owning the killing is no longer worse: panel (b) has no point"
assert BANDIT["nTiedNamingSelf"] == 0, "one of his surviving optima now names him"

plt.rcParams.update({
    "font.family": "serif",
    "font.serif": ["STIXGeneral", "DejaVu Serif"],
    "mathtext.fontset": "stix",
    "font.size": 8,
    "axes.linewidth": 0.6,
    "pdf.fonttype": 42,
})

INK, GREY, MID = "#111111", "#7A7A7A", "#B8B8B8"
ACCENT = "#B03A2E"                          # (a) only: where the evidence acts
COLOUR = {"bandit": "#2A78D6", "wife": "#EB6834", "samurai": "#1BAF7A"}
ORDER = ["bandit", "wife", "samurai"]

fig = plt.figure(figsize=(5.5, 3.35))
gs = fig.add_gridspec(2, 1, height_ratios=[0.62, 1.0], hspace=0.30,
                      left=0.115, right=0.985, top=0.99, bottom=0.115)

# ==================================================== (a) the method, three sequential steps
ax = fig.add_subplot(gs[0])
ax.set_xlim(0, 100)
ax.set_ylim(0, 34)
ax.axis("off")
ax.text(-6.5, 30, "a", fontsize=8, fontweight="bold", color=INK, va="top", ha="left")

STEPS = [
    (f"candidate accounts\nof the event", f"all {D['nAssertions']}", MID),
    (f"replay each against\nthe record $F$", f"{D['nFeasible']} survive", ACCENT),
    (f"$\\arg\\max$ the agent's\nown objective $J$", "", MID),
]
BW, BH, GAPX = 27.0, 15.0, 6.5
x, mids = 1.0, []
for i, (label, count, col) in enumerate(STEPS):
    ax.add_patch(FancyBboxPatch((x, 11), BW, BH, boxstyle="round,pad=0,rounding_size=1.5",
                                linewidth=1.0, edgecolor=col, facecolor="white", zorder=2))
    ax.text(x + BW / 2, 11 + BH / 2, label, ha="center", va="center",
            fontsize=8, color=INK, zorder=3, linespacing=1.4)
    if count:
        ax.text(x + BW / 2, 9.4, count, ha="center", va="top", fontsize=7.5,
                color=ACCENT if col is ACCENT else GREY)
    mids.append(x + BW / 2)
    if i < len(STEPS) - 1:
        ax.add_patch(FancyArrowPatch((x + BW + 0.6, 11 + BH / 2), (x + BW + GAPX - 0.6, 11 + BH / 2),
                                     arrowstyle="-|>", mutation_scale=8, color=MID,
                                     linewidth=0.9, zorder=1))
    x += BW + GAPX

ax.text(mids[1], 11 + BH + 1.6, "the evidence acts here, and only here",
        ha="center", va="bottom", fontsize=7.5, color=ACCENT)

# ==================================================== (b) what is left, and whom it blames
ax = fig.add_subplot(gs[1])
rows = sorted([a for a in D["assertions"] if a["feasible"]],
              key=lambda a: (ORDER.index(a["blames"]), -a["u"]["bandit"], a["manner"]))
N = len(rows)

i0 = 0
while i0 < N:
    i1 = i0
    while i1 + 1 < N and rows[i1 + 1]["blames"] == rows[i0]["blames"]:
        i1 += 1
    who = rows[i0]["blames"]
    for i in range(i0, i1 + 1):
        ax.plot(i, rows[i]["u"]["bandit"], "o", ms=6.2,
                mfc=COLOUR[who], mec="white", mew=0.8, zorder=3)
    ax.text((i0 + i1) / 2, 38.4, "himself" if who == "bandit" else f"the {who}",
            ha="center", va="top", fontsize=7.5, color=COLOUR[who])
    i0 = i1 + 1

own_x = [i for i, a in enumerate(rows) if a["blames"] == "bandit"]
oth_x = [i for i, a in enumerate(rows) if a["blames"] != "bandit"]
ax.hlines(OWNS, min(own_x) - 0.45, max(own_x) + 0.45, color=MID, lw=1.0, zorder=2)
ax.hlines(BLAMES, min(oth_x) - 0.45, max(oth_x) + 0.45, color=INK, lw=1.2, zorder=2)

ax.annotate("", xy=(max(own_x) + 0.55, BLAMES), xytext=(max(own_x) + 0.55, OWNS),
            arrowprops=dict(arrowstyle="<->", color=GREY, lw=0.8, shrinkA=0, shrinkB=0))
ax.text(max(own_x) + 0.80, (OWNS + BLAMES) / 2, f"+{BLAMES - OWNS}",
        fontsize=7.5, color=GREY, va="center", ha="left")

ax.text(min(own_x) - 0.45, OWNS - 1.4, f"if he owns the killing: {OWNS}",
        fontsize=7.5, color=GREY, va="top", ha="left")
ax.text(max(oth_x) + 0.45, BLAMES + 1.0,
        f"if he blames another: {BLAMES}, on {BANDIT['nTiedAtMax']} tied accounts",
        fontsize=7.5, color=INK, va="bottom", ha="right")

ax.text(-2.35, 61.5, "b", fontsize=8, fontweight="bold", color=INK, va="top", ha="left",
        clip_on=False)
ax.set_ylabel("what the account is worth to the bandit", fontsize=8, color=INK)
ax.set_xlabel("each of the surviving accounts, by whom it blames", fontsize=8, color=GREY,
              labelpad=14)
ax.set_xlim(-1.0, N + 0.4)
ax.set_ylim(37, 62)
ax.set_xticks([])
ax.set_yticks([40, 50, 60])
for s in ("top", "right", "bottom"):
    ax.spines[s].set_visible(False)
ax.spines["left"].set_color(MID)
ax.tick_params(colors=GREY, labelsize=7.5, length=2.5, width=0.6)

out = os.path.join(HERE, "fig-method5.pdf")
fig.savefig(out)
fig.savefig(out.replace(".pdf", ".png"), dpi=250)
print(f"wrote {out}")
print(f"  (a) 3 boxes: {D['nAssertions']} candidates -> {D['nFeasible']} survive -> argmax")
print(f"  (b) owning it caps at {OWNS}; blaming another pays {BLAMES} "
      f"on {BANDIT['nTiedAtMax']} tied accounts, {BANDIT['nTiedNamingSelf']} of them naming him")
