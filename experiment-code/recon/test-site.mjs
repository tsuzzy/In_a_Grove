#!/usr/bin/env node
// Self-tests for the third domain, in the same shape as test-domain.mjs and test-ring.mjs.
// What these protect: the enumeration counts the paper cites, the exclusion that makes the
// constraint bite, and the parity with the other two domains (six features, three per party,
// equal weights). If any of these drift, Table 1 is wrong.
import { all, feasibles, CAST, statesExplored, settledCount } from './site-enum.mjs'
import { features, dimsOf, U, Uw, label } from './site-objective.mjs'
import { simulate, signature, matchesRecord, initialState } from './site-domain.mjs'
import { causalSignatures } from './site-enum.mjs'

let pass = 0, fail = 0
const expect = (what, cond) => { cond ? pass++ : (fail++, console.log(`  FAIL ${what}`)) }
const eq = (what, got, want) => expect(`${what} (got ${got}, want ${want})`, got === want)

// ---- the counts the paper cites ----
eq('reachable states', statesExplored, 5856211)
eq('settled histories', settledCount, 1220118)
eq('distinct causal signatures', causalSignatures(), 2016)
eq('distinct assertions (the J-induced quotient of those signatures)', all.length, 972)
eq('|Feas(F)|', feasibles.length, 162)

// ---- parity with the other two domains ----
eq('three parties', CAST.length, 3)
const f0 = features('Foreman', all[0].g)
eq('six features', Object.keys(f0).length, 6)
for (const T of CAST) eq(`${T} judged on three dimensions`, dimsOf[T](f0).length, 3)
for (const T of CAST) {
  const x = features(T, all[0].g)
  const d = dimsOf[T](x)
  expect(`${T}'s U is the equal-weight mean of its triple`,
    Math.abs(U[T](x) - (d[0] + d[1] + d[2]) / 3) < 1e-12)
  expect(`${T}'s Uw at equal weights equals U`, Math.abs(Uw(T, x, [1, 1, 1]) - U[T](x)) < 1e-12)
}
// One property, checked over every assertion — counted once, because it is one claim.
// Looping it into thousands of "tests" would inflate the number the paper reports.
expect('every feature of every party on every assertion stays in [0,1]',
  all.every(r => CAST.every(T =>
    Object.values(features(T, r.g)).every(v => v >= 0 && v <= 1))))

// ---- the result Table 1 reports ----
const argmaxBy = (a, f) => a.slice().sort((x, y) => (f(y) - f(x)) || (x.sig < y.sig ? -1 : 1))[0]
const maxOf = (a, f) => a.reduce((m, x) => Math.max(m, f(x)), -Infinity)
const u100 = (x) => Math.round(100 * x)
const EPS = 1e-12
const want = { Foreman: [100, true, 100], Erector: [100, false, 77], Worker: [87, true, 87] }
for (const T of CAST) {
  const f = (r) => U[T](features(T, r.g))
  const best = maxOf(all, f)
  const inFeas = feasibles.some(r => f(r) > best - EPS)
  const feasBest = u100(f(argmaxBy(feasibles, f)))
  const [wb, wi, wf] = want[T]
  eq(`${T} unconstrained optimum`, u100(best), wb)
  expect(`${T} ideal ${wi ? 'is' : 'is NOT'} feasible`, inFeas === wi)
  eq(`${T} attainable inside Feas(F)`, feasBest, wf)
}
const picks = Object.fromEntries(CAST.map(T => [T, argmaxBy(feasibles, r => U[T](features(T, r.g))).sig]))
eq('three parties select three distinct accounts', new Set(Object.values(picks)).size, 3)

// ---- the record is what excludes, and it excludes for a reason ----
expect('every feasible account has the worker falling',
  feasibles.every(r => r.g.victim === 'Worker'))
expect('every feasible account has the rail off',
  feasibles.every(r => r.g.railInPlace === false))
expect('the assertion does not carry the harness coordinate — no objective reads it, F pins it',
  all.every(r => r.g.harnessWorn === undefined))
expect('the erector can only hold agency by admitting he jostled',
  feasibles.filter(r => r.g.actor === 'Erector').every(r => r.g.cause === 'jostle'))

// ---- the simulator refuses what it should ----
expect('a bound worker cannot sign the tag',
  simulate([{ op: 'signTag', actor: 'Worker' }]).ok === false)
expect('the harness cannot be worn before it is issued',
  simulate([{ op: 'wearHarness', actor: 'Worker' }]).ok === false)
expect('nobody can be jostled who is not on the deck',
  simulate([{ op: 'climb', actor: 'Worker' }, { op: 'jostle', actor: 'Erector', target: 'Worker' }]).ok === false)
expect('a history with no incident has no signature',
  signature(simulate([{ op: 'climb', actor: 'Worker' }]).state) === null)
expect('an account that leaves the rail up is refuted by the record',
  matchesRecord({ victim: 'Worker', railInPlace: true, harnessWorn: false, tagSignedBy: 'Foreman' }) === false)

console.log(`\n${fail === 0 ? 'ALL PASS — ' : ''}${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
