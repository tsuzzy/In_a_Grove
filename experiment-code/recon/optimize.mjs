#!/usr/bin/env node
// STRICT optimization over structured event histories — reporting script.
// All computation lives in grove-core.mjs (single source of truth, no LLM):
//   τ = structured multi-agent action sequence; Feasible(F) decided by simulator replay;
//   U_i = transparent structural functional; argmax by exhaustive enumeration.
//
// Usage: node recon/optimize.mjs      (no API key needed)

import { CAST, all, feasibles, features, U, Uw, rand, label, statesExplored, resolvedCount } from './grove-core.mjs'

// Deterministic argmax: ties broken by signature string, so no result depends on the
// order the enumerator happened to produce. (An earlier version sorted `all` in place,
// which made tie-heavy statistics silently order-dependent.)
const argmaxBy = (arr, f) => arr.slice().sort((a, b) => (f(b) - f(a)) || (a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0))[0]
const maxOf = (arr, f) => arr.reduce((m, r) => Math.max(m, f(r)), -Infinity)
const EPS = 1e-12

console.log(`\nStates explored: ${statesExplored}.  Resolved histories: ${resolvedCount}.  Distinct causal signatures: ${all.length}.\n`)
console.log('=== The feasible set Feasible(F), by the simulator (no LLM) ===')
console.log('F = Takehiro dead throat/dagger; Masago alive; Tajomaru gone; dagger bloodied; LONGSWORD UNBLOODIED; rope cut.\n')
for (const rec of all.slice().sort((a, b) => (b.feasible - a.feasible))) {
  const u = {}; for (const T of CAST) u[T] = Math.round(100 * U[T](features(T, rec.an)))
  console.log(`  [${rec.feasible ? 'FEASIBLE ' : 'refuted  '}] ${label(rec.an).padEnd(42)}  U: Taj=${u.Tajomaru}  Mas=${u.Masago}  Tak=${u.Takehiro}`)
}

console.log('\n=== argmax_{τ} U_i(τ):  each witness\'s ideal vs. best FEASIBLE history ===')
for (const T of CAST) {
  const ideal = { r: argmaxBy(all, r => U[T](features(T, r.an))) }
  const feas  = { r: argmaxBy(feasibles, r => U[T](features(T, r.an))) }
  ideal.u = U[T](features(T, ideal.r.an)); feas.u = U[T](features(T, feas.r.an))
  console.log(`\n  ${T}:`)
  console.log(`    unconstrained ideal : ${label(ideal.r.an)}  (U=${Math.round(100 * ideal.u)}${ideal.r.feasible ? ', feasible' : ', INFEASIBLE'})`)
  console.log(`    best feasible (τ̂)   : ${label(feas.r.an)}  (U=${Math.round(100 * feas.u)})`)
  console.log(`    constraint bites?    : ${ideal.u > feas.u + EPS ? 'YES — the unconstrained optimum is strictly better and is refuted by F' : 'no — the ideal is attainable inside Feasible(F)'}`)
}

console.log('\n=== does self-interest SPREAD the witnesses across Feasible(F)? ===')
const picks = {}
for (const T of CAST) picks[T] = label(argmaxBy(feasibles, r => U[T](features(T, r.an))).an)
for (const T of CAST) console.log(`  ${T} → ${picks[T]}`)
const distinct = new Set(Object.values(picks)).size
console.log(`  distinct feasible histories chosen: ${distinct}/3  ${distinct === 3 ? '(full Rashomon spread)' : distinct === 1 ? '(NO spread — all converge)' : '(partial spread)'}`)

// ---- robustness: random weightings of the SAME generic dimensions ----
const mannerKey = (r) => `${r.an.fatal.actor}|${r.an.fatal.type}|${r.an.fatal.weapon}`
const N = 5000
let spread3 = 0, biteTaj = 0
for (let t = 0; t < N; t++) {
  const rw = () => [rand(), rand(), rand()]
  const w = { Tajomaru: rw(), Masago: rw(), Takehiro: rw() }
  const pk = {}
  for (const T of CAST) pk[T] = mannerKey(argmaxBy(feasibles, r => Uw(T, features(T, r.an), w[T])))
  if (new Set(Object.values(pk)).size === 3) spread3++
  const g = (r) => Uw('Tajomaru', features('Tajomaru', r.an), w.Tajomaru)
  if (maxOf(all, g) > maxOf(feasibles, g) + EPS) biteTaj++
}
console.log(`\n=== robustness: ${N} random weightings of the same generic dimensions ===`)
console.log(`  full 3/3 spread across witnesses : ${(100 * spread3 / N).toFixed(1)}%`)
console.log(`  bandit's ideal is INFEASIBLE (constraint bites): ${(100 * biteTaj / N).toFixed(1)}%`)

// ---- baselines: what does each ingredient buy? ----
console.log(`\n=== baselines (same enumerated set, same U_i) ===`)
console.log(`  witness      | (a) random feasible | (b) no oracle: argmax over ALL | (c) ours: argmax over Feas(F)`)
for (const T of CAST) {
  const uFeas = feasibles.map(r => 100 * U[T](features(T, r.an)))
  const meanFeas = Math.round(uFeas.reduce((s, v) => s + v, 0) / uFeas.length)
  const ours = { r: argmaxBy(feasibles, r => U[T](features(T, r.an))) }; ours.u = U[T](features(T, ours.r.an))
  const unc  = { r: argmaxBy(all,        r => U[T](features(T, r.an))) }; unc.u  = U[T](features(T, unc.r.an))
  console.log(`  ${T.padEnd(12)} | U=${String(meanFeas).padEnd(18)} | U=${Math.round(100 * unc.u)}${unc.r.feasible ? ' (feasible)' : ' REFUTED by F'}`.padEnd(86) + `| U=${Math.round(100 * ours.u)} (0 refuted)`)
}
let refutedNoOracle = 0, pairs = 0
for (let t = 0; t < N; t++) {
  const rw = () => [rand(), rand(), rand()]
  for (const T of CAST) {
    const w = rw()
    const g = (r) => Uw(T, features(T, r.an), w)
    pairs++; if (maxOf(all, g) > maxOf(feasibles, g) + EPS) refutedNoOracle++
  }
}
console.log(`\n  dropping the feasibility oracle publishes an evidence-REFUTED history in ${(100 * refutedNoOracle / pairs).toFixed(1)}% of (witness, weighting) pairs;`)
console.log(`  keeping it: 0% by construction. That is exactly what the simulator buys.`)
