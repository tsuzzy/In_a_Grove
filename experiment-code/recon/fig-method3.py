#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FIGURE (v3): one panel, one idea.

v1 and v2 failed the only test that matters: a reader said they could not tell what the
figure was saying, and that there was more text than picture. Both were three panels wide and
carried ~40 labels. Every label was there because the drawing did not carry the point on its
own, and adding a label is the reflex that hides that.

So this draws one thing:

    The evidence does not tell the story. It fences off part of the space, and the teller
    picks inside the fence. His favourite story is outside it.

Everything else -- that a history is a program, that feasibility is decided by replay, the
enumeration counts, the other two domains -- is prose, and belongs in prose.

Layout owned by matplotlib rather than by hand-placed coordinates: the collisions in v1/v2
came from placing nodes by hand, and the labels came from patching the collisions.

Numbers come from fig-data.json, emitted by fig-data.mjs from grove-core.mjs. Nothing here
is typed in; this file asserts the claims it draws and refuses to run if they stop holding.

Usage:  node recon/fig-data.mjs > recon/fig-data.json
        python3 recon/fig-method3.py
"""
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, FancyArrowPatch

HERE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.path.join(HERE, "fig-data.json")))

# ---- the drawing is only allowed to say what the data still supports ----
assert D["checks"]["cutIsExactlyTheBlade"], "the evidence no longer cuts along the blade"
assert D["checks"]["onlyOneAgentIsBitten"], "more than one agent is now constrained"
BANDIT = D["agents"]["bandit"]
assert BANDIT["bites"], "the bandit's optimum is no longer refuted; this figure has no subject"
assert BANDIT["nTiedNamingSelf"] == 0, "one of his surviving optima now names him"

plt.rcParams.update({
    "font.family": "serif",
    "font.serif": ["STIXGeneral", "DejaVu Serif"],
    "mathtext.fontset": "stix",
    "font.size": 8,
    "axes.linewidth": 0.6,
    "pdf.fonttype": 42,
})

INK = "#0B0B0B"
GREY = "#8A8A8A"
RED = "#B03A2E"
COLOUR = {"bandit": "#2A78D6", "wife": "#EB6834", "samurai": "#1BAF7A"}
ORDER = ["bandit", "wife", "samurai"]

rows = sorted(
    [a for a in D["assertions"] if a["feasible"]],
    key=lambda a: (ORDER.index(a["blames"]), a["manner"], a["bound"], a["armed"]),
)
key = lambda a: (a["blames"], a["manner"], a["bound"], a["armed"])
twin = {key(a): a for a in D["assertions"] if not a["feasible"]}
assert len(rows) == len(twin) == D["nFeasible"]

fig, ax = plt.subplots(figsize=(5.5, 2.85))

# ---------------------------------------------------------------- the two zones
N = len(rows)
GAP = 1.6
XA, XB = 0.0, N + GAP                      # left edge of the allowed / forbidden zone
UMIN, UMAX = 36, 80

ax.add_patch(Rectangle((XB - 0.7, UMIN), N + 0.4, UMAX - UMIN, transform=ax.transData,
                       facecolor=RED, alpha=0.035, edgecolor="none", zorder=0))
ax.add_patch(Rectangle((XB - 0.7, UMIN), N + 0.4, UMAX - UMIN, transform=ax.transData,
                       facecolor="none", hatch="////", edgecolor=RED, alpha=0.11,
                       linewidth=0.0, zorder=0))

# ---------------------------------------------------------------- the accounts
for i, a in enumerate(rows):
    c = COLOUR[a["blames"]]
    ax.plot(XA + i, a["u"]["bandit"], "o", ms=5.2, mfc=c, mec="white", mew=0.7, zorder=3)
    b = twin[key(a)]
    top = b["u"]["bandit"] == BANDIT["maxAll"]
    ax.plot(XB + i, b["u"]["bandit"], "o", ms=6.6 if top else 5.2,
            mfc="white", mec=RED if top else c, mew=1.3 if top else 0.9,
            alpha=1.0 if top else 0.55, zorder=3)

# ---------------------------------------------------------------- what he can still claim
ax.hlines(BANDIT["maxFeas"], XA - 0.6, XA + N - 0.4, color=COLOUR["bandit"],
          lw=1.1, zorder=2)
ax.text(XA - 0.6, BANDIT["maxFeas"] + 1.1,
        f"best he can still tell: {BANDIT['maxFeas']}   ({BANDIT['nTiedAtMax']} accounts, tied)",
        color=COLOUR["bandit"], fontsize=7.5, va="bottom", ha="left")

star = [i for i, a in enumerate(rows) if twin[key(a)]["u"]["bandit"] == BANDIT["maxAll"]]
ax.text(XB + max(star) + 0.85, BANDIT["maxAll"],
        f"the story he wants: {BANDIT['maxAll']}",
        color=RED, fontsize=7.5, va="center", ha="left")

ax.add_patch(FancyArrowPatch(
    (XB + min(star) - 0.45, BANDIT["maxAll"]),
    (XA + N - 0.6, BANDIT["maxFeas"] + 0.8),
    connectionstyle="arc3,rad=0.28", arrowstyle="-|>", mutation_scale=8,
    color=RED, lw=0.9, zorder=4))

# ---------------------------------------------------------------- words, all of them
ax.text(XA + (N - 1) / 2, UMAX + 1.0, f"the {D['nFeasible']} accounts the evidence allows",
        ha="center", va="bottom", fontsize=8, color=INK)
ax.text(XB + (N - 1) / 2, UMAX + 1.0, f"the {D['nFeasible']} it rules out",
        ha="center", va="bottom", fontsize=8, color=RED)

i0 = 0
while i0 < N:
    i1 = i0
    while i1 + 1 < N and rows[i1 + 1]["blames"] == rows[i0]["blames"]:
        i1 += 1
    who = rows[i0]["blames"]
    ax.plot([XA + i0 - 0.3, XA + i1 + 0.3], [UMIN + 0.6] * 2,
            color=COLOUR[who], lw=1.6, solid_capstyle="butt", clip_on=False)
    ax.text((XA + i0 + XA + i1) / 2, UMIN - 0.8, f"the {who}",
            ha="center", va="top", fontsize=7, color=COLOUR[who])
    i0 = i1 + 1

ax.text(XA - 1.0, UMIN - 0.8, "his account\nblames \u2192", ha="right", va="top",
        fontsize=7, color=GREY)
ax.set_ylabel("what the account is worth to the bandit", fontsize=8, color=INK)
ax.set_ylim(UMIN, UMAX + 0.5)
ax.set_yticks([40, 50, 60, 70, 80])
ax.set_xlim(XA - 2.6, XB + N + 3.9)
ax.set_xticks([])
for s in ("top", "right", "bottom"):
    ax.spines[s].set_visible(False)
ax.spines["left"].set_color(GREY)
ax.tick_params(axis="y", colors=GREY, labelsize=7.5, length=2.5, width=0.6)

fig.tight_layout(pad=0.35)
out = os.path.join(HERE, "fig-method3.pdf")
fig.savefig(out)
fig.savefig(out.replace(".pdf", ".png"), dpi=260)
print(f"wrote {out}")
print(f"  {D['nAssertions']} accounts, {D['nFeasible']} allowed; "
      f"he wants {BANDIT['maxAll']}, can still tell {BANDIT['maxFeas']} "
      f"({BANDIT['nTiedAtMax']} tied, {BANDIT['nTiedNamingSelf']} of them naming him)")
print(f"  text items on the page: 5 labels + 3 group labels + 1 axis label")
