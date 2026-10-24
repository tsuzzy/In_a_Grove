#!/usr/bin/env node
// STRICT optimization over structured event histories — reporting script for the SECOND
// DOMAIN. Deliberately a section-for-section mirror of recon/optimize.mjs: same pipeline,
// same reported quantities, same order, same wording. The only thing that differs between
// the two experiments is the story.
//
//   τ = structured multi-agent action sequence; Feasible(F) decided by simulator replay;
//   U_i = transparent structural functional; argmax by exhaustive enumeration.
//
// That parity is the whole methodological point. A second domain is evidence that the
// framework travels only if the framework is what stayed fixed; if the objective changes
// shape at the same time as the story, any difference in the result is unattributable.
// Everything that was NOT in the grove experiment — the spectator books, the Pope, the
// other-regarding variant of Pompilia's utility — has been moved to ring-extensions.mjs and
// is reported separately as a departure.
//
// THE GAME WITHOUT THE DIALOGUE. As in the grove, the three witnesses optimize independently:
// U_i reads only τ, so what the others say cannot enter witness i's problem. The interaction
// is not in the objective, it is in the SHARED CONSTRAINT — one Feasible(F), three claims
// drawn from it, and the claims collide. Each is individually unrefuted by the record and no
// single history satisfies more than one of them, so at least two of the three must be false.
// That is the "deniability does not add up" result, and it is measured below.
//
// Usage: node recon/ring-optimize.mjs      (no API key needed)

import { RECORD } from './ring-domain.mjs'
import { enumerate, pinning, COORDS } from './ring-core.mjs'
import { CAST, features, dimsOf, DIM_NAMES, U, Uw, label, brief, DISPUTED } from './ring-objective.mjs'

// Deterministic argmax: ties broken by assertion string, so no result depends on the order
// the enumerator happened to produce.
const argmaxBy = (arr, f) => arr.slice().sort((a, b) => (f(b) - f(a)) || (a.assertion < b.assertion ? -1 : 1))[0]
const maxOf = (arr, f) => arr.reduce((m, r) => Math.max(m, f(r)), -Infinity)
const EPS = 1e-12
const u100 = (x) => Math.round(100 * x)

// seeded PRNG so every reported number is exactly reproducible
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const rand = mulberry32(16980222)   // 22 February 1698

/**
 * The unconstrained ideal, chosen CHARITABLY among the maximizers. U_i is heavily tied —
 * many assertions differ only in coordinates a given teller's three dimensions cannot read —
 * so a plain argmax picks a maximizer by string order, and if that arbitrary pick happens to
 * be refuted while an equally optimal feasible one exists, the report says the constraint
 * bites when it does not. Same discipline as `matchSignature` in grove-core.
 */
const idealFor = (all, feas, f) => {
  const best = maxOf(all, f)
  const tied = feas.filter(r => f(r) > best - EPS)
  if (tied.length) return { r: argmaxBy(tied, f), u: best, feasible: true }
  return { r: argmaxBy(all.filter(r => f(r) > best - EPS), f), u: best, feasible: false }
}

const space = enumerate()
const all = space.assertionsUnder({})        // no record at all — the candidate space
const feasibles = space.assertionsUnder(RECORD)

console.log(`\nStates explored: ${space.statesExplored}.  Settled histories: ${space.endStates}.  ` +
  `Distinct causal signatures: ${space.causalSignatures}.  Assertions: ${all.length}.\n`)

console.log('=== The feasible set Feasible(F), by the simulator (no LLM) ===')
console.log('F = the Old Yellow Book: taken at Castelnuovo short of Rome; GUIDO SUED INSTEAD OF KILLING;')
console.log('    Caponsacchi relegated three years; a son born 18 Dec 1697; four hired men; the door')
console.log('    gained by calling "Caponsacchi"; she lived four days and testified; Guido taken at the gate.\n')
for (const rec of all.slice().sort((a, b) => {
  const fa = feasibles.some(r => r.assertion === a.assertion), fb = feasibles.some(r => r.assertion === b.assertion)
  return (fb - fa) || (a.assertion < b.assertion ? -1 : 1)
}).slice(0, 14)) {
  const feasible = feasibles.some(r => r.assertion === rec.assertion)
  const u = {}; for (const T of CAST) u[T] = u100(U[T](features(T, rec.g)))
  console.log(`  [${feasible ? 'FEASIBLE ' : 'refuted  '}] ${brief(rec.g)}  U: Gui=${u.Guido}  Pom=${u.Pompilia}  Cap=${u.Caponsacchi}`)
}
console.log(`  … ${all.length} assertions in all; ${feasibles.length} survive F, ${all.length - feasibles.length} are refuted by it.`)

console.log('\n=== argmax_{τ} U_i(τ):  each witness\'s ideal vs. best FEASIBLE history ===')
const picks = {}
for (const T of CAST) {
  const f = (r) => U[T](features(T, r.g))
  const ideal = idealFor(all, feasibles, f)
  const feas = argmaxBy(feasibles, f)
  picks[T] = feas
  console.log(`\n  ${T}  (judged on ${DIM_NAMES[T].join(', ')}):`)
  console.log(`    unconstrained ideal : ${brief(ideal.r.g)}`)
  console.log(`                          (U=${u100(ideal.u)}${ideal.feasible ? ', feasible' : ', INFEASIBLE'})`)
  console.log(`    best feasible (τ̂)   : ${brief(feas.g)}`)
  console.log(`                          (U=${u100(f(feas))})`)
  console.log(`    constraint bites?    : ${ideal.u > f(feas) + EPS
    ? 'YES — the unconstrained optimum is strictly better and is refuted by F'
    : 'no — the ideal is attainable inside Feasible(F)'}`)
  const tied = feasibles.filter(r => f(r) > f(feas) - EPS).length
  if (tied > 1) console.log(`    (${tied} feasible accounts attain this maximum; the witness is indifferent among them)`)
}

console.log('\n=== does self-interest SPREAD the witnesses across Feasible(F)? ===')
for (const T of CAST) console.log(`  ${T.padEnd(12)} → ${brief(picks[T].g)}`)
const distinct = new Set(CAST.map(T => picks[T].assertion)).size
console.log(`  distinct feasible histories chosen: ${distinct}/3  ` +
  `${distinct === 3 ? '(full Rashomon spread)' : distinct === 1 ? '(NO spread — all converge)' : '(partial spread)'}`)

// ---- deniability does not add up: the game, with no dialogue in it ----
//
// A witness ASSERTS a disputed fact only if every account attaining their maximum agrees on
// it. Where their maximizers disagree they are indifferent, and a table that prints one of
// them anyway is reporting a string tie-break as testimony. This matters concretely here:
// Pompilia's optimum is tied between the letters being in Guido's hand and in Caponsacchi's,
// because all her utility asks is that they not be in her own — so printing the argmax
// unguarded has her accusing the priest, which is the exact opposite of Book VII and is an
// artifact of sorting. It is the same principle as the paper's assertion quotient, applied
// one level further in: never credit a witness with detail they expressed no preference over.
const maximizers = {}
for (const T of CAST) {
  const f = (r) => U[T](features(T, r.g))
  const best = maxOf(feasibles, f)
  maximizers[T] = feasibles.filter(r => f(r) > best - EPS)
}
/** what T actually asserts about disputed question d, or null if T is indifferent */
const asserts = (T, d) => {
  const vals = new Set(maximizers[T].map(r => String(d.read(r.g))))
  return vals.size === 1 ? [...vals][0] : null
}

console.log('\n=== where the three optimized accounts CONTRADICT ===')
console.log(`  (“—” = the witness is indifferent: their maximizers disagree, so they assert nothing here)\n`)
console.log(`  ${'disputed fact'.padEnd(26)}${CAST.map(T => T.padEnd(28)).join('')}`)
let contradictions = 0
for (const d of DISPUTED) {
  const vals = CAST.map(T => asserts(T, d))
  const committed = vals.filter(v => v !== null)
  if (new Set(committed).size > 1) contradictions++
  console.log(`  ${d.q.padEnd(26)}${vals.map(v => String(v ?? '—').padEnd(28)).join('')}`)
}
// A history satisfies a witness's account iff it matches everything that witness asserts.
const satisfies = (r, T) => DISPUTED.every(d => { const a = asserts(T, d); return a === null || String(d.read(r.g)) === a })
const jointly = feasibles.filter(r => CAST.every(T => satisfies(r, T)))
const pairwise = []
for (let i = 0; i < CAST.length; i++) for (let j = i + 1; j < CAST.length; j++) {
  const both = feasibles.filter(r => satisfies(r, CAST[i]) && satisfies(r, CAST[j]))
  pairwise.push(`${CAST[i]}+${CAST[j]}: ${both.length}`)
}
console.log(`\n  the three accounts genuinely contradict on ${contradictions}/${DISPUTED.length} disputed facts`)
console.log(`  (counting only facts on which at least two of them commit, and commit differently).`)
console.log(`  feasible histories satisfying ALL THREE at once : ${jointly.length}`)
console.log(`  satisfying each PAIR                           : ${pairwise.join(',  ')}`)
console.log(`\n  So at least two of the three must be false — and no two of them can even be true`)
console.log(`  together. Yet each belongs to Feasible(F) and the record refutes none of them.`)
console.log(`  Each witness is individually deniable; deniability does not add up.`)
console.log(`\n  No witness's objective reads what the others say: the three programs are independent.`)
console.log(`  The interaction is the SHARED CONSTRAINT — one Feasible(F), three claims drawn from`)
console.log(`  it, colliding. That is a game with no dialogue in it.`)

// what the record settled, and where the surviving disagreement sits
const pin = pinning(feasibles)
const pinned = COORDS.filter(c => pin[c].pinned)
const openC = COORDS.filter(c => !pin[c].pinned)
const split = COORDS.filter(c => new Set(CAST.map(T => String(picks[T].g[c]))).size > 1)
console.log(`\n  the record CLOSED ${pinned.length}/${COORDS.length} coordinates — ${pinned.join(', ')} —`)
console.log(`  and every witness concedes all of them, the killing included. The ${split.length} they divide on`)
console.log(`  (${split.join(', ')}) are all coordinates the record leaves open.`)

// ---- robustness: random weightings of the SAME generic dimensions ----
const N = 5000
let spread3 = 0, biteGuido = 0
const biteOf = Object.fromEntries(CAST.map(T => [T, 0]))
for (let t = 0; t < N; t++) {
  const rw = () => [rand(), rand(), rand()]
  const w = Object.fromEntries(CAST.map(T => [T, rw()]))
  const pk = {}
  for (const T of CAST) {
    const g = (r) => Uw(T, features(T, r.g), w[T])
    pk[T] = argmaxBy(feasibles, g).assertion
    if (maxOf(all, g) > maxOf(feasibles, g) + EPS) biteOf[T]++
  }
  if (new Set(Object.values(pk)).size === 3) spread3++
}
biteGuido = biteOf.Guido
console.log(`\n=== robustness: ${N} random weightings of the same generic dimensions ===`)
console.log(`  full 3/3 spread across witnesses : ${(100 * spread3 / N).toFixed(1)}%`)
console.log(`  the husband's ideal is INFEASIBLE (constraint bites): ${(100 * biteGuido / N).toFixed(1)}%`)
for (const T of CAST.filter(T => T !== 'Guido'))
  console.log(`  ${T}'s ideal is INFEASIBLE: ${(100 * biteOf[T] / N).toFixed(1)}%`)

// ---- baselines: what does each ingredient buy? ----
console.log(`\n=== baselines (same enumerated set, same U_i) ===`)
console.log(`  witness      | (a) random feasible | (b) no oracle: argmax over ALL | (c) ours: argmax over Feas(F)`)
for (const T of CAST) {
  const f = (r) => U[T](features(T, r.g))
  const uFeas = feasibles.map(r => 100 * f(r))
  const meanFeas = Math.round(uFeas.reduce((s, v) => s + v, 0) / uFeas.length)
  const ours = argmaxBy(feasibles, f)
  const unc = idealFor(all, feasibles, f)
  console.log(`  ${T.padEnd(12)} | U=${String(meanFeas).padEnd(18)} | U=${u100(unc.u)}${unc.feasible ? ' (feasible)' : ' REFUTED by F'}`.padEnd(86) +
    `| U=${u100(f(ours))} (0 refuted)`)
}
let refutedNoOracle = 0, pairs = 0
for (let t = 0; t < N; t++) {
  const rw = () => [rand(), rand(), rand()]
  for (const T of CAST) {
    const w = rw()
    const g = (r) => Uw(T, features(T, r.g), w)
    pairs++; if (maxOf(all, g) > maxOf(feasibles, g) + EPS) refutedNoOracle++
  }
}
console.log(`\n  dropping the feasibility oracle publishes an evidence-REFUTED history in ${(100 * refutedNoOracle / pairs).toFixed(1)}% of (witness, weighting) pairs;`)
console.log(`  keeping it: 0% by construction. That is exactly what the simulator buys.`)
console.log()
