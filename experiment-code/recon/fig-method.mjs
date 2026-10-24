#!/usr/bin/env node
// FIGURE: the method itself, on the first domain.
//
// Emits a standalone TikZ figure (fig-method.tex) for the paper's Section 2.
//
// Three panels, matching the three moves of Eq. (1):
//   (a) a candidate account is a PROGRAM — a grounded operator sequence, not a sentence;
//   (b) feasibility is REPLAY — the simulator runs tau and compares its terminal state to F,
//       fact by fact, with no language model and no scoring anywhere in the box;
//   (c) the task is an ARGMAX over what survives — and the constraint bites.
//
// Panel (c) is the reason the figure exists rather than a cartoon of a pipeline. The 22
// assertions of this domain factor exactly as 11 manners x 2 blades (asserted below, not
// assumed), and F ("the longsword is unbloodied") cuts along the blade axis: the whole
// longsword column is refuted. The bandit's two best accounts sit in that column. So the
// picture shows in one glance what Table 1 can only tabulate — WHERE his optimum was, and
// WHY it is gone.
//
// The tie is drawn, not hidden. U_i is heavily tied (see CLAUDE.md, "the indifference
// convention"): the bandit has SEVEN feasible maximizers, not one, and Table 1's single
// representative is a tie-break. Marking all seven is both more honest and stronger — every
// one of them attributes the death to somebody else, so the claim does not rest on the
// tie-break rule. A figure that planted one flag would invite exactly the objection this
// repository has already had to answer once.
//
// Numbers, cells, marks and the two example histories are RECOMPUTED from grove-core.mjs on
// every run, never transcribed. If the domain changes, this figure changes with it.
//
// Usage: node recon/fig-method.mjs && pdflatex fig-method.tex

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { all, feasibles, features, U, F, statesExplored, resolvedCount } from './grove-core.mjs'
import { simulate, diffAftermath } from './domain.mjs'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))

// The paper never uses the Japanese names; Table 1 says bandit / wife / samurai.
const ROLE = { Tajomaru: 'bandit', Masago: 'wife', Takehiro: 'samurai' }
const COL = { bandit: 'banditcol', wife: 'wifecol', samurai: 'samuraicol' }
// The paper's operator vocabulary. `impale_on_held` is `impale` in the text; keeping the
// figure on the text's names is what lets a reader carry the operator list from panel (a)
// into the row labels of panel (c).
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
// The figure's design rests on F cutting along the blade axis. If a future F stops doing
// that, fail loudly rather than draw a column header that is no longer true.
for (const row of grid.values()) {
  if (!row.cells.dagger.feasible) throw new Error('a dagger assertion is refuted: the column headers are wrong')
  if (row.cells.longsword.feasible) throw new Error('a longsword assertion survives: the column headers are wrong')
}

const ACTORORDER = ['Tajomaru', 'Masago', 'Takehiro']
const TYPEORDER = ['strike', 'impale_on_held', 'self_strike']
const rows = [...grid.values()].sort((x, y) =>
  ACTORORDER.indexOf(x.p.actor) - ACTORORDER.indexOf(y.p.actor) ||
  TYPEORDER.indexOf(x.p.type) - TYPEORDER.indexOf(y.p.type) ||
  (x.p.bound === y.p.bound ? 0 : x.p.bound ? 1 : -1) ||
  (x.p.armed === y.p.armed ? 0 : x.p.armed ? 1 : -1))

// ---- the bandit's two optima ----
const maxAll = Math.max(...all.map(r => u(BANDIT, r)))
const maxFeas = Math.max(...feasibles.map(r => u(BANDIT, r)))
const minAll = Math.min(...all.map(r => u(BANDIT, r)))
const argAll = all.filter(r => u(BANDIT, r) === maxAll)
const argFeas = feasibles.filter(r => u(BANDIT, r) === maxFeas)
const selfServing = argFeas.filter(r => parts(r).actor === BANDIT).length

// ---- the public facts, each checked on its own by the same procedure ----
const FACTS = [
  ['Dead: throat, dagger', { dead: F.dead }],
  ['Wife alive, present', { alivePresent: F.alivePresent }],
  ['Bandit gone', { gone: F.gone }],
  ['Dagger bloodied', { bloodied: F.bloodied }],
  ['Longsword unbloodied', { notBloodied: F.notBloodied }],
  ['Rope cut', { rope: F.rope }],
]
const holds = (rec, spec) => diffAftermath(simulate(rec.steps).state, spec).length === 0

// ---- panels (a)/(b): a matched pair of histories, one per blade.
// Chosen so the longsword twin fails on as few facts as possible: the point of the pair is
// that the blade is what the record refutes, and a twin that also loses the rope or the
// bandit's departure blurs that into "it differs somehow".
const pairRow = rows
  .map(r => ({
    r,
    misses: FACTS.filter(([, spec]) => !holds(r.cells.longsword, spec)).length,
    n: r.cells.dagger.steps.length + r.cells.longsword.steps.length,
  }))
  .sort((x, y) => x.misses - y.misses || x.n - y.n || (x.r.p.actor < y.r.p.actor ? -1 : 1))[0].r
const TAU = { dagger: pairRow.cells.dagger, longsword: pairRow.cells.longsword }

const showStep = (a) => {
  const args = [ROLE[a.actor], a.object, a.target ? `$\\to$ ${ROLE[a.target]}` : null].filter(Boolean)
  return `${op(a.type)}(${args.join(', ')})`
}

// =====================================================================================
//                                    geometry (cm)
// =====================================================================================
const W = 14.50
const AX = 0.00, AW = 3.95           // (a)
const BX = 4.40, BW = 3.55           // (b)
const CX = 8.40, CW = W - CX         // (c)

const RH = 0.360                     // grid row height
const CELLW = 1.08                   // grid cell width
const BARW = 0.30                    // actor group bar
const LABW = 3.15                    // manner label column
const GX = CX + BARW + LABW          // left edge of the cells

let tex = ''
const title = (x, y, n, t, w) =>
  `  \\node[anchor=north west, font=\\scriptsize\\bfseries, text=inkcol, align=left, text width=${w}cm]` +
  ` at (${x},${y}) {\\textcolor{black!42}{(${n})}\\, ${t}};\n`
const note = (x, y, w, t, c = 'black!62', size = '\\scriptsize') =>
  `  \\node[anchor=north west, font=${size}, text=${c}, align=left, text width=${w}cm] at (${x},${y}) {${t}};\n`

// ---------------------------------- panel (a) ----------------------------------------
{
  tex += title(AX, 0, 'a', 'A history is a program', AW)
  tex += note(AX, -0.38, AW, 'take~seize~cut\\_rope~strike\\\\self\\_strike~impale~flee', 'black!45', '\\tiny\\ttfamily')

  let y = -1.06
  for (const blade of BLADES) {
    const ok = blade === 'dagger'
    tex += `  \\node[anchor=north west, font=\\scriptsize, text=${ok ? 'okcol' : 'nocol'}] at (${AX},${y})` +
      ` {$\\tau${ok ? '' : "'"}$ \\textcolor{black!55}{--- the ${blade} account}};\n`
    y -= 0.30
    for (const a of TAU[blade].steps) {
      tex += `  \\node[anchor=north west, draw=${ok ? 'okcol!45' : 'nocol!40'}, line width=0.4pt,` +
        ` rounded corners=1.2pt, fill=${ok ? 'okcol!7' : 'nocol!6'}, inner xsep=2.4pt, inner ysep=1.9pt,` +
        ` font=\\tiny\\ttfamily, text=inkcol] at (${AX + 0.05},${y}) {${showStep(a)}};\n`
      y -= 0.315
    }
    y -= 0.16
  }
}

// ---------------------------------- panel (b) ----------------------------------------
{
  tex += title(BX, 0, 'b', 'Feasibility is replay', BW)
  tex += note(BX, -0.38, BW, `Replay, then compare to the public facts $F$`, 'black!62', '\\tiny')

  const mx = BX + BW - 0.52, mxp = BX + BW - 0.10
  let y = -0.92
  tex += `  \\node[anchor=south, font=\\scriptsize, text=okcol] at (${mx},${y + 0.03}) {$\\tau$};\n`
  tex += `  \\node[anchor=south, font=\\scriptsize, text=nocol] at (${mxp},${y + 0.03}) {$\\tau'$};\n`
  tex += `  \\draw[gray!30, line width=0.4pt] (${BX},${y + 0.03}) -- (${BX + BW},${y + 0.03});\n`
  y -= 0.20
  for (const [labelText, spec] of FACTS) {
    const a = holds(TAU.dagger, spec), b = holds(TAU.longsword, spec)
    tex += `  \\node[anchor=west, font=\\scriptsize, text=${b ? 'black!60' : 'inkcol'}] at (${BX},${y}) {${labelText}};\n`
    tex += `  \\node[font=\\scriptsize, text=${a ? 'okcol' : 'nocol'}] at (${mx},${y}) {${a ? '$\\checkmark$' : '$\\times$'}};\n`
    tex += `  \\node[font=\\scriptsize, text=${b ? 'okcol' : 'nocol'}] at (${mxp},${y}) {${b ? '$\\checkmark$' : '$\\times$'}};\n`
    y -= 0.315
  }
  y -= 0.06
  tex += `  \\draw[gray!30, line width=0.4pt] (${BX},${y}) -- (${BX + BW},${y});\n`
  tex += note(BX, y - 0.06, BW, 'No language model, no scoring,\\\\no tunable threshold in this box', 'inkcol', '\\tiny')
  tex += note(BX, y - 0.62, BW,
    `${statesExplored.toLocaleString('en-US')} reachable states\\\\$\\to$ ${resolvedCount} resolved histories\\\\$\\to$ ${all.length} assertions`, 'black!45', '\\tiny')
}

// ---------------------------------- panel (c) ----------------------------------------
{
  const cx = (j) => GX + j * CELLW + CELLW / 2
  const gy = -1.26                          // top edge of the first cell row
  const cy = (i) => gy - i * RH - RH / 2
  const botY = gy - rows.length * RH

  tex += title(CX, 0, 'c', 'Argmax over what survives', CW)
  tex += note(CX, -0.36, CW,
    `${all.length} assertions $=$ ${rows.length} manners $\\times$ 2 blades`, 'black!62', '\\tiny')

  // the refuted column, as a block behind its cells
  tex += `  \\fill[nocol!6] (${cx(1) - CELLW / 2},${gy}) rectangle (${cx(1) + CELLW / 2},${botY});\n`

  // column headers
  BLADES.forEach((w, j) => {
    const feas = w === 'dagger'
    tex += `  \\node[anchor=south, font=\\scriptsize\\ttfamily, text=inkcol] at (${cx(j)},${gy + 0.32}) {${w}};\n`
    tex += `  \\node[anchor=south, font=\\tiny, text=${feas ? 'okcol' : 'nocol'}] at (${cx(j)},${gy + 0.06})` +
      ` {${feas ? `$\\checkmark$ all ${feasibles.length}` : `$\\times$ all ${all.length - feasibles.length}`}};\n`
  })

  tex += `  \\node[anchor=south east, font=\\tiny, text=black!55] at (${GX - 0.12},${gy + 0.30}) {Each cell: $U_{\\mathrm{bandit}}$};\n`

  // the one fact that does it, called out beside the column it kills
  tex += `  \\node[rotate=90, anchor=south, font=\\scriptsize\\itshape, text=nocol] at (${cx(1) + CELLW / 2 + 0.20},${(gy + botY) / 2})` +
    ` {The longsword is unbloodied};\n`

  // actor group bars
  let i0 = 0
  while (i0 < rows.length) {
    let i1 = i0
    while (i1 + 1 < rows.length && rows[i1 + 1].p.actor === rows[i0].p.actor) i1++
    const role = ROLE[rows[i0].p.actor]
    const yTop = gy - i0 * RH, yBot = gy - (i1 + 1) * RH
    tex += `  \\fill[${COL[role]}!20, rounded corners=1pt] (${CX},${yTop - 0.02}) rectangle (${CX + BARW - 0.09},${yBot + 0.02});\n`
    tex += `  \\node[rotate=90, font=\\tiny, text=${COL[role]}!80!black] at (${CX + (BARW - 0.09) / 2},${(yTop + yBot) / 2}) {${role}};\n`
    i0 = i1 + 1
  }

  // rows
  rows.forEach((row, i) => {
    const flags = [row.p.bound ? 'bound' : null, row.p.armed ? 'armed' : null].filter(Boolean).join(', ')
    tex += `  \\node[anchor=east, font=\\scriptsize] at (${GX - 0.12},${cy(i)})` +
      ` {{\\ttfamily ${op(row.p.type)}}${flags ? `\\,\\textcolor{black!45}{$\\cdot$ ${flags}}` : ''}};\n`

    BLADES.forEach((w, j) => {
      const rec = row.cells[w]
      const v = u(BANDIT, rec)
      const feas = rec.feasible
      const isTop = v === (feas ? maxFeas : maxAll)
      const tint = Math.round(5 + 45 * (v - minAll) / (maxAll - minAll))
      tex += `  \\node[draw=white, line width=0.6pt, fill=${feas ? `banditcol!${tint}` : 'black!0'},` +
        ` minimum width=${CELLW}cm, minimum height=${RH}cm, inner sep=0pt, font=\\scriptsize,` +
        ` text=${feas ? 'inkcol' : 'black!45'}] at (${cx(j)},${cy(i)}) {${isTop ? `\\bfseries ${v}` : v}};\n`
      if (isTop) {
        const style = feas ? 'draw=banditcol, line width=0.8pt'
          : 'draw=nocol, line width=0.8pt, dash pattern=on 1.5pt off 1.2pt'
        tex += `  \\draw[${style}, rounded corners=1.2pt] (${cx(j) - CELLW / 2 + 0.05},${cy(i) - RH / 2 + 0.035})` +
          ` rectangle (${cx(j) + CELLW / 2 - 0.05},${cy(i) + RH / 2 - 0.035});\n`
      }
    })
  })

  // the payoff
  tex += `  \\draw[gray!30, line width=0.4pt] (${CX},${botY - 0.14}) -- (${CX + CW},${botY - 0.14});\n`
  tex += note(CX, botY - 0.20, CW,
    `\\textcolor{nocol}{$\\square$}~${maxAll}: his optimum, refuted \\quad ` +
    `\\textcolor{banditcol}{$\\square$}~${maxFeas}: his best feasible`, 'inkcol', '\\tiny')
  tex += note(CX, botY - 0.50, CW,
    `${argFeas.length} tied maximizers${selfServing === 0 ? '; none names him the killer' : ''}`, 'black!62', '\\tiny')
}

// ---------------------------------- panel (d): the hearing ---------------------------
// The three parties do not only each optimize alone; under the coupled objective they answer
// one another in turn, and the record collapses onto a single account (multi-party confrontation).
{
  const DX = AX, DTOP = -4.62, DW = CX - 0.55          // bottom-left: below (a)/(b)'s notes, strictly left of (c)
  tex += title(DX, DTOP, 'd', 'The hearing: the three answer one another', DW)
  const wl = [['bandit', 'banditcol'], ['wife', 'wifecol'], ['samurai', 'samuraicol']]
  const wcx = [1.15, 3.40, 5.65]                        // rightmost box stays well left of CX=8.4
  const wy = DTOP - 0.60
  wl.forEach(([role, col], k) => {
    tex += `  \\node[draw=${col}!55, fill=${col}!10, rounded corners=2.5pt, inner xsep=5pt, inner ysep=3pt,` +
      ` font=\\tiny, text=inkcol] (h${k}) at (${wcx[k]},${wy}) {${role}};\n`
  })
  tex += `  \\draw[-{Latex[length=3pt,width=3pt]}, black!40, line width=0.6pt] (h0) to[bend left=13] (h1);\n`
  tex += `  \\draw[-{Latex[length=3pt,width=3pt]}, black!40, line width=0.6pt] (h1) to[bend left=13] (h2);\n`
  tex += `  \\draw[-{Latex[length=3pt,width=3pt]}, black!40, line width=0.6pt] (h2) to[bend right=13] (h0);\n`
  tex += note(DX, wy - 0.40, DW,
    `Each answers in turn; the record closes on \\emph{one} account and a true one is erased --- holding each to their opening ($\\gamma$) restores it`,
    'black!62', '\\tiny')
}

// =====================================================================================
const arrow = (x0, x1, y) =>
  `  \\draw[-{Latex[length=3.4pt,width=3.4pt]}, black!32, line width=0.7pt] (${x0},${y}) -- (${x1},${y});`

const doc = `% Generated by recon/fig-method.mjs --- do not edit by hand.
% Regenerate after any change to domain / grove-core / grove-objective.
\\documentclass[tikz,border=2pt]{standalone}
\\usepackage{amsmath,amssymb}
\\usetikzlibrary{arrows.meta}
\\definecolor{banditcol}{HTML}{2A78D6}
\\definecolor{wifecol}{HTML}{EB6834}
\\definecolor{samuraicol}{HTML}{1BAF7A}
\\definecolor{inkcol}{HTML}{0B0B0B}
\\definecolor{okcol}{HTML}{1B7A4A}
\\definecolor{nocol}{HTML}{B03A2E}
\\begin{document}
\\begin{tikzpicture}[font=\\small, inner sep=0pt]
  %% fixed canvas, so the float width does not drift between regenerations
  \\path (0,0.28) rectangle (${W},-6.05);
${arrow(AX + AW + 0.06, BX - 0.06, -2.9)}
${arrow(BX + BW + 0.06, CX - 0.06, -2.9)}

${tex}
\\end{tikzpicture}
\\end{document}
`

fs.writeFileSync(path.join(HERE, 'fig-method.tex'), doc)

console.log('\nwrote fig-method.tex\n')
console.log(`  assertion space factors: ${grid.size} manners x ${BLADES.length} blades = ${all.length}`)
console.log(`  feasible: ${feasibles.length} (every dagger row) | refuted: ${all.length - feasibles.length} (every longsword row)`)
console.log(`  bandit: max over all = ${maxAll} on ${argAll.length} assertion(s); all refuted = ${argAll.every(r => !r.feasible)}`)
console.log(`  bandit: max over Feasible(F) = ${maxFeas} on ${argFeas.length} tied maximizers; ${selfServing} name him as the killer`)
console.log(`  example pair: ${pairRow.p.actor} ${pairRow.p.type} (bound=${pairRow.p.bound}, armed=${pairRow.p.armed})`)
for (const b of BLADES) {
  const miss = FACTS.filter(([, spec]) => !holds(TAU[b], spec)).map(([l]) => l)
  console.log(`    tau[${b}] = ${TAU[b].steps.map(a => `${a.type}(${a.actor}${a.object ? ',' + a.object : ''})`).join(' ; ')}`)
  console.log(`      fails: ${miss.length ? miss.join(' | ') : '(nothing --- feasible)'}`)
}
console.log()
