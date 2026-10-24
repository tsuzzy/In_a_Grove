#!/usr/bin/env node
// FIGURE: what answering one another does to the auditor's proof, and what buys it back.
//
// Emits a standalone pgfplots figure (fig-hearing.tex) for the paper's hearing result.
//
// Every number is RECOMPUTED here from the same modules that produce the tables —
// grove-enum for the feasible set, dialogue.hearing for the hearing, game-core.jointAudit
// for the proof — rather than transcribed. The same rule the other two figures follow:
// a figure with hand-copied numbers goes stale the first time the domain changes.
//
// Two panels, one shared x-axis (β, coordination pressure):
//
//   (a) THE BOUNDARY. For each β, the least accountability γ that keeps the auditor's proof
//       alive. Below the curve the three accounts have collapsed to one and nothing is
//       provable; above it the proof stands. Both evidence sets are drawn, because the
//       claim is about the mechanism and not about one record: a richer record (akutagawa,
//       22 feasible) tolerates far more corroboration pressure before it needs any
//       accountability at all than the sparser one does.
//
//   (b) WHAT COLLAPSES. At γ=0, the number of distinct accounts the hearing closes on and
//       the number of lies the record can still prove, against β. The two drop together at
//       the same β, which is the point: the proof is not weakened gradually, it is lost.
//
// The figure asserts its own preconditions and throws rather than drawing something false:
//   - β=0 must reproduce independent testimony exactly (3 distinct, 2 provable lies),
//     since β=0 is the parameter setting at which U_i^tot reduces to U_i;
//   - the collapse must actually happen somewhere in [0,1], or panel (b) is a flat line
//     and there is no result to draw.
//
// NO LLM anywhere. Usage: node recon/fig-hearing.mjs && pdflatex fig-hearing.tex

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { AFTERMATH } from './domain.mjs'
import { enumerateShared, DEGENERATE, CAST } from './grove-enum.mjs'
import { hearing } from './dialogue.mjs'
import { jointAudit, claimKey, TRUTH_CLAIM } from './game-core.mjs'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const BSTEPS = 20
const GSTEPS = 40

const SPECS = { 'run-06': AFTERMATH["pre-B'/run-06"], akutagawa: AFTERMATH['akutagawa/canonical'] }
const space = enumerateShared({ specs: SPECS, degenerate: DEGENERATE })

// ---- recompute ----
const worlds = {}
for (const name of Object.keys(SPECS)) {
  const pool = space.feasibleUnder(name)
  const cell = (b, g) => {
    const h = hearing({ pool, beta: b, gamma: g })
    const a = jointAudit(h.profile)
    return {
      distinct: a.distinctClaims,
      lies: a.provenLies,
      safe: a.provenLies === 2,
      closes: [...new Set(CAST.map(T => claimKey(h.profile[T])))].sort().join(' + '),
      revisions: h.moves.filter(m => m.act === 'revise').length,
    }
  }
  const boundary = []      // γ*(β)
  const collapse = []      // distinct / lies at γ=0
  for (let i = 0; i <= BSTEPS; i++) {
    const b = i / BSTEPS
    let gStar = null
    for (let j = 0; j <= GSTEPS; j++) {
      if (cell(b, j / GSTEPS).safe) { gStar = j / GSTEPS; break }
    }
    boundary.push({ beta: b, gammaStar: gStar })
    const c0 = cell(b, 0)
    collapse.push({ beta: b, distinct: c0.distinct, lies: c0.lies, closes: c0.closes })
  }
  worlds[name] = { n: pool.length, boundary, collapse, zero: cell(0, 0) }
}

// ---- assert the preconditions rather than drawing something false ----
for (const [name, w] of Object.entries(worlds)) {
  if (!(w.zero.distinct === 3 && w.zero.lies === 2)) {
    throw new Error(
      `${name}: β=0 must reproduce independent testimony (3 distinct, 2 provable lies), ` +
      `got ${w.zero.distinct} and ${w.zero.lies}. Either the reduction U_i^tot -> U_i at β=0 ` +
      `has broken, or the domain changed. The figure's whole premise is that comparison.`)
  }
  const collapsed = w.collapse.filter(c => c.distinct < 3)
  if (!collapsed.length) {
    throw new Error(`${name}: no collapse anywhere in β ∈ [0,1]; panel (b) would be a flat line.`)
  }
  w.betaStar = collapsed[0].beta
  w.after = collapsed[0].closes
}

// The second curve may only be called the no-constraint control if it is **truly unconstrained**:
// akutagawa's feasible set, with the wound-location coordinate stripped, must equal the full
// assertion set exactly. If it does not, do not draw it.
const strip = (r) => r.sig.split('|').filter(x => x !== 'throat' && x !== 'chest').join('|')
const universe = new Set(space.all.map(strip))
const akuStripped = new Set(space.feasibleUnder('akutagawa').map(strip))
if (!(universe.size === akuStripped.size && [...universe].every(x => akuStripped.has(x)))) {
  throw new Error(
    'the second curve is labelled "no constraint" but akutagawa/canonical now excludes something: ' +
    `${akuStripped.size} of ${universe.size} assertions survive it. Relabel or drop the curve.`)
}

// The grid's smallest positive beta is 1/BSTEPS = 0.05, so the step drawn there is a grid
// artifact unless finer probes collapse too. Probe them; the annotation says "<=" only
// because this PASSES — if a probed positive beta ever fails to collapse, refuse to draw.
const fineProbe = [0.0005, 0.001, 0.005, 0.01].map(b => {
  const h = hearing({ pool: space.feasibleUnder('run-06'), beta: b, gamma: 0 })
  const a = jointAudit(h.profile)
  return { beta: b, distinct: a.distinctClaims, lies: a.provenLies }
})
if (fineProbe.some(pr => pr.distinct !== 1 || pr.lies !== 0)) {
  throw new Error('a probed positive beta does not collapse; the "<=0.05" annotation would be false: '
    + JSON.stringify(fineProbe))
}
let gStarFine = null
for (let j = 0; j <= 40; j++) {
  const h = hearing({ pool: space.feasibleUnder('run-06'), beta: 0.0005, gamma: j / 40 })
  if (jointAudit(h.profile).provenLies === 2) { gStarFine = j / 40; break }
}

// what the run-06 hearing settles on, and whether it is the truth
const settled = worlds['run-06'].after
const isTruth = settled === TRUTH_CLAIM
if (isTruth) {
  throw new Error('run-06 hearing now settles on the true history; the caption below says it does not.')
}

const pts = (rows, f) => rows.map(r => `(${r.beta.toFixed(3)},${f(r)})`).join(' ')
// γ*=null means "no accountability in [0,1] restores the proof"; draw it at the top edge
const gstar = (r) => (r.gammaStar === null ? 1.0 : r.gammaStar).toFixed(3)

const tex = `\\documentclass[tikz,border=3pt]{standalone}
\\usepackage{pgfplots}\\pgfplotsset{compat=1.18}
\\usepackage{times}
\\begin{document}
\\begin{tikzpicture}
\\pgfplotsset{
  every axis/.append style={font=\\footnotesize, width=6.6cm, height=3.6cm,
    xmin=0, xmax=1, xlabel={$\\beta$}, tick align=outside, tick pos=left,
    title style={font=\\footnotesize, align=left, yshift=1pt},
    every axis plot/.append style={line width=0.9pt}},
}

%% ---- (a) the boundary ----
\\begin{axis}[name=A, ymin=0, ymax=1,
  ylabel={$\\gamma^\\star$ needed},
  title={\\textbf{(a)} Accountability that keeps the proof alive},
  legend style={font=\\scriptsize, at={(0.03,0.97)}, anchor=north west, draw=none, fill=none},
  legend cell align=left]
\\addplot[const plot, black, fill=black, fill opacity=0.07, draw opacity=1]
  coordinates {${pts(worlds['run-06'].boundary, gstar)}} \\closedcycle;
\\addlegendentry{run-06 record ($|\\mathrm{Feas}|=${worlds['run-06'].n}$)}
\\node[font=\\scriptsize, text=black!65, anchor=west] at (axis cs:0.10,0.09)
  {shaded: proof gone};
\\end{axis}

%% ---- (b) what collapses ---- placed to the RIGHT of (a), not below it:
%% stacked, this figure took a page of its own in a paper already over the limit.
\\begin{axis}[name=B, at={(A.south east)}, anchor=south west, xshift=1.25cm,
  xmin=0, xmax=1, xtick={0,1},
  xticklabels={$\\beta=0$,$\\beta>0$}, xlabel={corroboration pressure},
  ymin=-0.15, ymax=3.3, ytick={0,1,2,3},
  ylabel={count at $\\gamma=0$},
  title={\\textbf{(b)} Accounts left, and lies still provable},
  legend style={font=\\scriptsize, at={(0.97,0.97)}, anchor=north east, draw=none, fill=none},
  legend cell align=left]
\\addplot[black, mark=*, mark options={fill=white}] coordinates {(0,${worlds['run-06'].collapse[0].distinct}) (1,${worlds['run-06'].collapse[1].distinct})};
\\addlegendentry{distinct accounts}
\\addplot[black!55, dashed, mark=square*, mark options={fill=white}] coordinates {(0,${worlds['run-06'].collapse[0].lies}) (1,${worlds['run-06'].collapse[1].lies})};
\\addlegendentry{provable lies}
\\node[font=\\scriptsize, align=center, anchor=center] at (axis cs:1,0.55)
  {tested down to\\\\$\\beta=5\\times10^{-4}$};
\\end{axis}
\\end{tikzpicture}
\\end{document}
`

fs.writeFileSync(path.join(HERE, 'fig-hearing.tex'), tex)

// Every number the paper cites must be traceable to the repository; project.py's number check
// reads *-data.json.
fs.writeFileSync(path.join(HERE, 'fig-hearing-data.json'), JSON.stringify({
  note: 'gamma*(beta) boundary and the gamma=0 collapse, both evidence sets. Recomputed, not transcribed.',
  worlds: Object.fromEntries(Object.entries(worlds).map(([k, w]) => [k, {
    feasible: w.n, betaStar: w.betaStar,
    boundary: w.boundary, collapse: w.collapse,
  }])),
  truthClaim: TRUTH_CLAIM,
  fineProbe, gammaStarAtBeta0p0005: gStarFine,
}, null, 1))

console.log('recomputed, not transcribed:')
for (const [name, w] of Object.entries(worlds)) {
  const g0 = w.boundary.find(b => b.beta === 0.5)
  console.log(`  ${name.padEnd(10)} |Feas|=${String(w.n).padStart(3)}  ` +
    `collapse first at β=${w.betaStar.toFixed(2)}  γ*(β=0.5)=${g0.gammaStar ?? 'none'}`)
}
console.log(`  run-06 settles on: ${settled}   τ* is: ${TRUTH_CLAIM}   same? ${isTruth}`)
console.log('written: recon/fig-hearing.tex')
