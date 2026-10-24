#!/usr/bin/env node
// FIGURE (v2): the method itself, on the first domain.
//
// What changed from v1, and why. v1 drew panel (c) as an 11x2 table of printed utilities.
// Four independent model families, asked to critique it cold, converged on the same defect:
// a grid of numbers READS AS A RESULTS TABLE. The utility was encoded as a glyph you have to
// parse, the feasibility cut was a pale tint, and the fact that the bandit's optimum is gone
// was something you worked out rather than something you saw.
//
// v2 encodes the two things that matter as POSITION instead:
//   * utility is a height on a real axis, so 72 and 58 are a visible gap, not two numerals;
//   * whom the account blames is a horizontal group, so the punchline is a shape --- inside
//     the feasible block, "the bandit did it" tops out below every account that blames
//     somebody else.
// The refuted half is drawn as a hatched region the survivors are not in, so the constraint
// is a cut in the page rather than an adjective.
//
// The tie is drawn, not hidden. U_i is heavily tied (CLAUDE.md, "the indifference
// convention"): the bandit has SEVEN feasible maximizers and Table 1 prints one tie-broken
// representative. All seven are marked and braced. Every one of them blames somebody else,
// so the claim does not rest on the tie-break rule.
//
// Deliberately NOT drawn: the other two agents' maximizer sets. In this domain one assertion
// (samurai, self_strike, dagger) maximizes all three utilities at once, so a three-agent
// overlay would show the three agreeing --- true here, and the opposite of the paper's
// headline, which is carried on the richer second domain. The figure stays on one agent.
//
// Every mark is RECOMPUTED from grove-core.mjs on every run; nothing is transcribed.
//
// Usage: node recon/fig-method2.mjs && pdflatex fig-method2.tex

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { all, feasibles, features, U, F, statesExplored, resolvedCount } from './grove-core.mjs'
import { simulate, diffAftermath, ACTIONS } from './domain.mjs'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))

const ROLE = { Tajomaru: 'bandit', Masago: 'wife', Takehiro: 'samurai' }
const COL = { bandit: 'banditcol', wife: 'wifecol', samurai: 'samuraicol' }
const OPNAME = { impale_on_held: 'impale' }
const op = (t) => (OPNAME[t] || t).replace(/_/g, '\\_')
const BLADES = ['dagger', 'longsword']
const BANDIT = 'Tajomaru'

const u = (T, rec) => Math.round(100 * U[T](features(T, rec.an)))
const parts = (rec) => {
  const [actor, type, weapon, b, a] = rec.sig.split('|')
  return { actor, type, weapon, bound: b === 'bound:true', armed: a === 'armed:true' }
}

// ---- the 22 assertions factor as (manner) x (blade); assert it, do not assume it ----
const grid = new Map()
for (const rec of all) {
  const p = parts(rec)
  const m = `${p.actor}|${p.type}|${p.bound}|${p.armed}`
  if (!grid.has(m)) grid.set(m, { p, cells: {} })
  grid.get(m).cells[p.weapon] = rec
}
for (const [m, row] of grid) for (const w of BLADES)
  if (!row.cells[w]) throw new Error(`the assertion space does not factor: ${m} has no ${w} twin`)
if (grid.size * BLADES.length !== all.length) throw new Error('the grid does not cover the assertion space')
for (const row of grid.values()) {
  if (!row.cells.dagger.feasible) throw new Error('a dagger assertion is refuted: the block headers are wrong')
  if (row.cells.longsword.feasible) throw new Error('a longsword assertion survives: the block headers are wrong')
}

const ACTORORDER = ['Tajomaru', 'Masago', 'Takehiro']
const TYPEORDER = ['strike', 'impale_on_held', 'self_strike']
const manners = [...grid.values()].sort((x, y) =>
  ACTORORDER.indexOf(x.p.actor) - ACTORORDER.indexOf(y.p.actor) ||
  TYPEORDER.indexOf(x.p.type) - TYPEORDER.indexOf(y.p.type) ||
  (x.p.bound === y.p.bound ? 0 : x.p.bound ? 1 : -1) ||
  (x.p.armed === y.p.armed ? 0 : x.p.armed ? 1 : -1))

const maxAll = Math.max(...all.map(r => u(BANDIT, r)))
const maxFeas = Math.max(...feasibles.map(r => u(BANDIT, r)))
const minAll = Math.min(...all.map(r => u(BANDIT, r)))
const argAll = all.filter(r => u(BANDIT, r) === maxAll)
const argFeas = feasibles.filter(r => u(BANDIT, r) === maxFeas)
const selfServing = argFeas.filter(r => parts(r).actor === BANDIT).length
// the claim the figure makes with its horizontal grouping: inside Feasible(F), the best the
// bandit can do while still owning the killing is strictly worse than blaming somebody else.
const bestOwning = Math.max(...feasibles.filter(r => parts(r).actor === BANDIT).map(r => u(BANDIT, r)))
if (!(bestOwning < maxFeas)) throw new Error('owning the killing is no longer strictly worse: the grouping claim is dead')

// What actually earns the 72? NOT "a duel". Both assertions attaining it have the victim
// ARMED, and one of them has him still BOUND — honour reads `armed`, not `unbound`, so an
// unanswerable blow against a tied man scores exactly what a fair fight scores. The code's own
// label calls both a "sword duel"; the figure must not repeat that, and the reader is told
// what the feature really rewards.
const optArmed = argAll.every(r => parts(r).armed)
const optUnbound = argAll.every(r => !parts(r).bound)
if (!optArmed) throw new Error('the optimum no longer requires an armed victim: relabel the ceiling')
const OPTGLOSS = optUnbound ? 'a sword duel' : 'a longsword blow, the victim armed'

// ---- the public facts, each checked on its own by the same procedure ----
const FACTS = [
  ['samurai dead --- throat, dagger', { dead: F.dead }],
  ['wife alive, in the grove', { alivePresent: F.alivePresent }],
  ['bandit gone', { gone: F.gone }],
  ['dagger bloodied', { bloodied: F.bloodied }],
  ['longsword unbloodied', { notBloodied: F.notBloodied }],
  ['rope cut', { rope: F.rope }],
]
const holds = (rec, spec) => diffAftermath(simulate(rec.steps).state, spec).length === 0

// a matched pair, chosen so the longsword twin fails on as few facts as possible
const pairRow = manners
  .map(r => ({
    r,
    misses: FACTS.filter(([, spec]) => !holds(r.cells.longsword, spec)).length,
    n: r.cells.dagger.steps.length + r.cells.longsword.steps.length,
  }))
  .sort((x, y) => x.misses - y.misses || x.n - y.n || (x.r.p.actor < y.r.p.actor ? -1 : 1))[0].r
const TAU = { dagger: pairRow.cells.dagger, longsword: pairRow.cells.longsword }
// The operator vocabulary, taken from the domain rather than retyped. The hand-typed list in
// v1 was both unverifiable and wrong: it omitted `give`. `speak`/`look` never change the world
// and the enumerator never grounds them, so they are not part of the account space.
const INERT = new Set(['speak', 'look', 'drop', 'fling', 'mount_flee'])
const OPS = Object.keys(ACTIONS).filter(t => !INERT.has(t))

const showStep = (a) => {
  const args = [ROLE[a.actor], a.object, a.target ? `$\\to$ ${ROLE[a.target]}` : null].filter(Boolean)
  return `${op(a.type)}(${args.join(', ')})`
}

// =====================================================================================
//                                    geometry (cm)
// =====================================================================================
const W = 16.60, H = 9.70
const LX = 0.00, LW = 5.55                 // left column: (a) over (b)
const BY = -5.32                           // top of (b)
const CX = 6.15, CW = W - CX               // right panel: (c)

const AXX = CX + 1.28                      // x of the utility axis
const PLOTY0 = -7.45, PLOTY1 = -1.42       // bottom / top of the plot area
const UMIN = 36, UMAX = 86
const uy = (v) => PLOTY0 + (v - UMIN) / (UMAX - UMIN) * (PLOTY1 - PLOTY0)

const BLOCKGAP = 0.52
const COSTW = 2.55                         // the "what F costs each agent" strip
const BLOCKW = (W - AXX - 2 * BLOCKGAP - COSTW - 0.10) / 2
const slot = (blockIdx, i) =>
  AXX + 0.22 + blockIdx * (BLOCKW + BLOCKGAP) + (i + 0.5) * ((BLOCKW - 0.36) / manners.length)

let tex = ''
const title = (x, y, n, t, w) =>
  `  \\node[anchor=north west, font=\\scriptsize\\bfseries, text=inkcol, align=left, text width=${w}cm]` +
  ` at (${x},${y}) {\\textcolor{black!42}{(${n})}\\, ${t}};\n`
const note = (x, y, w, t, c = 'black!62', size = '\\scriptsize') =>
  `  \\node[anchor=north west, font=${size}, text=${c}, align=left, text width=${w}cm] at (${x},${y}) {${t}};\n`

// ---------------------------------- panel (a) ----------------------------------------
{
  tex += title(LX, 0, 'a', 'a candidate account is a program', LW)
  tex += note(LX, -0.36, LW, 'samurai bound $\\cdot$ wife holds the dagger $\\cdot$ longsword on the ground $\\cdot$ rope binding', 'black!55', '\\tiny')
  const half = Math.ceil(OPS.length / 2)
  tex += note(LX, -0.72, LW,
    OPS.slice(0, half).map(t => op(t)).join('~') + '\\\\' + OPS.slice(half).map(t => op(t)).join('~'),
    'black!45', '\\tiny\\ttfamily')

  let y = -1.46
  for (const blade of BLADES) {
    const ok = blade === 'dagger'
    tex += `  \\node[anchor=north west, font=\\tiny, text=inkcol] at (${LX},${y})` +
      ` {$\\tau${ok ? '' : "'"}$ \\textcolor{black!55}{--- the same story, told with the ${blade}}};\n`
    y -= 0.26
    const steps = TAU[blade].steps
    steps.forEach((a, k) => {
      // state dot, then the operator that leaves it: replay is a walk, not a list
      tex += `  \\fill[black!30] (${LX + 0.11},${y - 0.09}) circle (0.045);\n`
      if (k < steps.length) {
        tex += `  \\draw[-{Latex[length=2.4pt,width=2.4pt]}, black!30, line width=0.5pt]` +
          ` (${LX + 0.11},${y - 0.13}) -- (${LX + 0.11},${y - 0.30});\n`
      }
      tex += `  \\node[anchor=north west, draw=black!30, line width=0.4pt,` +
        ` rounded corners=1.2pt, fill=black!3, inner xsep=2.6pt, inner ysep=2.0pt,` +
        ` font=\\tiny\\ttfamily, text=inkcol] at (${LX + 0.24},${y}) {${showStep(a)}};\n`
      y -= 0.34
    })
    tex += `  \\fill[black!45] (${LX + 0.11},${y - 0.09}) circle (0.055);\n`
    tex += `  \\node[anchor=west, font=\\tiny, text=black!55] at (${LX + 0.24},${y - 0.09}) {terminal state};\n`
    y -= 0.40
  }
}

// ---------------------------------- panel (b) ----------------------------------------
{
  tex += title(LX, BY, 'b', 'feasibility is replay, not judgement', LW)
  const mx = LX + LW - 0.52, mxp = LX + LW - 0.12
  let y = BY - 0.62
  tex += `  \\node[anchor=south, font=\\tiny, text=okcol] at (${mx},${y + 0.03}) {$\\tau$};\n`
  tex += `  \\node[anchor=south, font=\\tiny, text=nocol] at (${mxp},${y + 0.03}) {$\\tau'$};\n`
  tex += `  \\node[anchor=south west, font=\\tiny, text=black!55] at (${LX},${y + 0.03}) {does the terminal state match $F$?};\n`
  tex += `  \\draw[gray!30, line width=0.4pt] (${LX},${y + 0.01}) -- (${LX + LW},${y + 0.01});\n`
  y -= 0.20
  for (const [labelText, spec] of FACTS) {
    const a = holds(TAU.dagger, spec), b = holds(TAU.longsword, spec)
    tex += `  \\node[anchor=west, font=\\tiny, text=${b ? 'black!58' : 'inkcol'}] at (${LX + 0.06},${y}) {${labelText}};\n`
    tex += `  \\node[font=\\tiny, text=${a ? 'okcol' : 'nocol'}] at (${mx},${y}) {${a ? '$\\checkmark$' : '$\\times$'}};\n`
    tex += `  \\node[font=\\tiny, text=${b ? 'okcol' : 'nocol'}] at (${mxp},${y}) {${b ? '$\\checkmark$' : '$\\times$'}};\n`
    y -= 0.285
  }
  y -= 0.04
  tex += `  \\draw[gray!30, line width=0.4pt] (${LX},${y}) -- (${LX + LW},${y});\n`
  tex += note(LX, y - 0.04, LW, 'no language model, no scoring and no tunable threshold in this box', 'inkcol', '\\tiny')
  tex += note(LX, y - 0.36, LW,
    `${statesExplored.toLocaleString('en-US')} states $\\to$ ${resolvedCount} resolved histories $\\to$ ${all.length} assertions $\\to$ $|\\Feas(F)|=${feasibles.length}$`,
    'black!45', '\\tiny')
}

// ---------------------------------- panel (c) ----------------------------------------
{
  tex += title(CX, 0, 'c', 'the objective is maximized over what survives', CW)
  tex += note(CX, -0.36, CW,
    `all ${all.length} assertions, placed by what they are worth to the bandit, grouped by whom they blame`,
    'black!55', '\\tiny')

  const blocks = [
    { i: 0, feas: true, head: `$\\checkmark$ $\\Feas(F)$\\\\[-1.5pt]${feasibles.length} dagger accounts` },
    { i: 1, feas: false, head: `$\\times$ refuted\\\\[-1.5pt]${all.length - feasibles.length} longsword accounts` },
  ]

  // refuted block: hatched, so the survivors are visibly not in it
  const rx0 = AXX + 0.10 + (BLOCKW + BLOCKGAP), rx1 = rx0 + BLOCKW
  tex += `  \\fill[nocol!5] (${rx0},${PLOTY0 - 0.06}) rectangle (${rx1},${PLOTY1 + 0.30});\n`
  tex += `  \\fill[pattern=north east lines, pattern color=nocol!18] (${rx0},${PLOTY0 - 0.06}) rectangle (${rx1},${PLOTY1 + 0.30});\n`

  // the axis
  tex += `  \\draw[black!45, line width=0.5pt] (${AXX},${PLOTY0 - 0.06}) -- (${AXX},${PLOTY1 + 0.30});\n`
  for (const v of [40, 50, 60, 70]) {
    tex += `  \\draw[gray!22, line width=0.35pt] (${AXX},${uy(v)}) -- (${W},${uy(v)});\n`
    tex += `  \\node[anchor=east, font=\\tiny, text=black!50] at (${AXX - 0.06},${uy(v)}) {${v}};\n`
  }
  tex += `  \\node[rotate=90, anchor=south, font=\\tiny, text=black!62] at (${AXX - 0.44},${(PLOTY0 + PLOTY1) / 2})` +
    ` {$U_{\\mathrm{bandit}}$ \\ (0--100)};\n`

  tex += `  \\node[anchor=north east, font=\\tiny, text=black!55, align=right] at (${AXX - 0.06},${PLOTY0 - 0.30})` +
    ` {the account\\\\[-1.5pt]blames $\\rightarrow$};\n`

  for (const blk of blocks) {
    const x0 = AXX + 0.10 + blk.i * (BLOCKW + BLOCKGAP)
    tex += `  \\node[anchor=south, font=\\tiny, align=center, text=${blk.feas ? 'okcol' : 'nocol'}] at (${x0 + BLOCKW / 2},${PLOTY1 + 0.10}) {${blk.head}};\n`

    // whom-does-it-blame groups along the bottom
    let i0 = 0
    while (i0 < manners.length) {
      let i1 = i0
      while (i1 + 1 < manners.length && manners[i1 + 1].p.actor === manners[i0].p.actor) i1++
      const role = ROLE[manners[i0].p.actor]
      const gx0 = slot(blk.i, i0) - 0.14, gx1 = slot(blk.i, i1) + 0.14
      tex += `  \\draw[${COL[role]}!45, line width=1.4pt] (${gx0},${PLOTY0 - 0.10}) -- (${gx1},${PLOTY0 - 0.10});\n`
      tex += `  \\node[anchor=north, font=\\tiny, text=black!62, align=center] at (${(gx0 + gx1) / 2},${PLOTY0 - 0.16})` +
        ` {\\color{${COL[role]}!85!black}${role}};\n`
      i0 = i1 + 1
    }

    // the points
    manners.forEach((m, i) => {
      const rec = m.cells[blk.feas ? 'dagger' : 'longsword']
      const v = u(BANDIT, rec)
      const role = ROLE[m.p.actor]
      const x = slot(blk.i, i), y = uy(v)
      if (blk.feas) {
        tex += `  \\fill[${COL[role]}] (${x},${y}) circle (0.075);\n`
      } else {
        const top = v === maxAll
        tex += `  \\fill[white] (${x},${y}) circle (0.078);\n`
        tex += `  \\draw[${COL[role]}!${top ? 90 : 50}, line width=${top ? 0.9 : 0.6}pt] (${x},${y}) circle (0.078);\n`
        tex += `  \\draw[nocol!${top ? 95 : 65}, line width=${top ? 0.8 : 0.5}pt] (${x - 0.062},${y - 0.062}) -- (${x + 0.062},${y + 0.062});\n`
      }
    })
  }

  // the two ceilings, and the drop between them
  const fx0 = AXX + 0.10, fx1 = fx0 + BLOCKW
  tex += `  \\draw[banditcol, line width=0.8pt] (${fx0},${uy(maxFeas)}) -- (${fx1},${uy(maxFeas)});\n`
  tex += `  \\node[anchor=north west, font=\\tiny, text=banditcol] at (${fx0 + 0.04},${uy(maxFeas) - 0.07})` +
    ` {best he can still claim: ${maxFeas}};\n`
  tex += `  \\draw[nocol, line width=0.8pt, dash pattern=on 2pt off 1.6pt] (${rx0},${uy(maxAll)}) -- (${rx1},${uy(maxAll)});\n`
  tex += `  \\node[anchor=north west, font=\\tiny, text=nocol, align=left] at (${rx0 + 0.10},${uy(maxAll) - 0.07})` +
    ` {his optimum, ${maxAll}\\\\[-1pt]{\\itshape ${OPTGLOSS}}};\n`

  // the brace over the tied maximizers, so no single account is credited as "the" answer
  const tiedIdx = manners.map((m, i) => [m, i]).filter(([m]) => u(BANDIT, m.cells.dagger) === maxFeas).map(([, i]) => i)
  const bx0 = slot(0, Math.min(...tiedIdx)) - 0.12, bx1 = slot(0, Math.max(...tiedIdx)) + 0.12
  tex += `  \\draw[decorate, decoration={brace, amplitude=3pt}, banditcol!70, line width=0.5pt]` +
    ` (${bx0},${uy(maxFeas) + 0.16}) -- (${bx1},${uy(maxFeas) + 0.16});\n`
  tex += `  \\node[anchor=south, font=\\tiny, text=banditcol!85!black, align=center] at (${(bx0 + bx1) / 2},${uy(maxFeas) + 0.32})` +
    ` {${argFeas.length} tied, ${selfServing === 0 ? 'none of them his own hand' : `${selfServing} of them his own`}};\n`

  // the arrow that is the whole point: the record takes the duel away
  tex += `  \\draw[-{Latex[length=3.6pt,width=3.6pt]}, nocol, line width=0.7pt]` +
    ` (${rx0 - 0.10},${uy(maxAll)}) .. controls (${rx0 - 0.75},${uy(maxAll)}) and (${fx1 - 0.05},${uy(maxFeas) + 0.75}) ..` +
    ` (${fx1 - 0.05},${uy(maxFeas) + 0.07});\n`
  tex += `  \\node[anchor=east, font=\\tiny, text=nocol, align=right] at (${rx0 - 0.18},${uy((maxAll + maxFeas) / 2) + 0.34})` +
    ` {\\emph{the longsword}\\\\[-1pt]\\emph{is unbloodied}};\n`

  // ---- what F costs each agent: the only three-agent mark on the page ----
  // Deliberately SEGMENTS, not maximizer sets. In this domain one assertion maximizes all
  // three utilities at once, so drawing the three argmax sets would assert that the agents can
  // agree --- true here, and the opposite of the paper's headline, which is carried on the
  // richer second domain. A segment from unconstrained max to feasible max says the one thing
  // that is both true and sufficient: the constraint is selective, and it bites him alone.
  {
    const costX = rx1 + BLOCKGAP
    tex += `  \\node[anchor=south, font=\\tiny, text=black!62, align=center] at (${costX + COSTW / 2},${PLOTY1 + 0.06})` +
      ` {what $F$ costs each};\n`
    tex += `  \\draw[gray!30, line width=0.4pt] (${costX - 0.20},${PLOTY0 - 0.06}) -- (${costX - 0.20},${PLOTY1 + 0.02});\n`
    let bitten = 0
    ACTORORDER.forEach((T, k) => {
      const role = ROLE[T]
      const mA = Math.max(...all.map(r => u(T, r)))
      const mF = Math.max(...feasibles.map(r => u(T, r)))
      if (mA > mF) bitten++
      const x = costX + (k + 0.5) * (COSTW / ACTORORDER.length)
      if (mA > mF) {
        tex += `  \\draw[${COL[role]}, line width=1.4pt] (${x},${uy(mF)}) -- (${x},${uy(mA)});\n`
        tex += `  \\fill[white] (${x},${uy(mA)}) circle (0.078);\n`
        tex += `  \\draw[${COL[role]}, line width=0.8pt] (${x},${uy(mA)}) circle (0.078);\n`
        tex += `  \\draw[nocol, line width=0.7pt] (${x - 0.062},${uy(mA) - 0.062}) -- (${x + 0.062},${uy(mA) + 0.062});\n`
        tex += `  \\node[anchor=west, font=\\tiny, text=nocol] at (${x + 0.12},${uy((mA + mF) / 2)}) {$-${mA - mF}$};\n`
      } else {
        tex += `  \\node[anchor=west, font=\\tiny, text=black!50] at (${x + 0.12},${uy(mF)}) {$0$};\n`
      }
      tex += `  \\fill[${COL[role]}] (${x},${uy(mF)}) circle (0.078);\n`
      tex += `  \\node[anchor=east, font=\\tiny, text=black!55] at (${x - 0.10},${uy(mF)}) {${mF}};\n`
      tex += `  \\node[anchor=north, font=\\tiny, text=${COL[role]}!85!black] at (${x},${PLOTY0 - 0.12}) {${role}};\n`
    })
    if (bitten !== 1) throw new Error(`the constraint now bites ${bitten} agents, not 1: the strip's caption is wrong`)
  }

  // the reading, stated once
  tex += note(CX, PLOTY0 - 0.72, CW,
    `Owning the killing is worth at most \\textbf{${bestOwning}} to him once $F$ is in force: every surviving account that pays more puts the blade in somebody else's hand. Of the three agents, only his optimum is refuted.`,
    'inkcol', '\\tiny')
}

// =====================================================================================
const doc = `% Generated by recon/fig-method2.mjs --- do not edit by hand.
% Regenerate after any change to domain / grove-core / grove-objective.
\\documentclass[tikz,border=2pt]{standalone}
\\usepackage{amsmath,amssymb}
\\usetikzlibrary{arrows.meta,patterns,decorations.pathreplacing}
\\newcommand{\\Feas}{\\mathrm{Feasible}}
\\definecolor{banditcol}{HTML}{2A78D6}
\\definecolor{wifecol}{HTML}{EB6834}
\\definecolor{samuraicol}{HTML}{1BAF7A}
\\definecolor{inkcol}{HTML}{0B0B0B}
\\definecolor{okcol}{HTML}{1B7A4A}
\\definecolor{nocol}{HTML}{B03A2E}
\\begin{document}
\\begin{tikzpicture}[font=\\small, inner sep=0pt]
  \\path (0,0.30) rectangle (${W},${-H});
  \\draw[gray!28, line width=0.4pt] (${CX - 0.30},0.24) -- (${CX - 0.30},${-H + 0.10});

${tex}
\\end{tikzpicture}
\\end{document}
`

fs.writeFileSync(path.join(HERE, 'fig-method2.tex'), doc)

console.log('\nwrote fig-method2.tex\n')
console.log(`  ${grid.size} manners x ${BLADES.length} blades = ${all.length} assertions; ${feasibles.length} feasible`)
console.log(`  bandit: max over all = ${maxAll} (${argAll.length} assertions, all refuted = ${argAll.every(r => !r.feasible)})`)
console.log(`  bandit: max over Feasible(F) = ${maxFeas} on ${argFeas.length} tied; ${selfServing} name him as the killer`)
console.log(`  bandit: best FEASIBLE account that still owns the killing = ${bestOwning} (< ${maxFeas}, so the grouping claim holds)`)
console.log(`  utility range drawn: ${minAll}..${maxAll} on an axis of ${UMIN}..${UMAX}\n`)
