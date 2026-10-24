// test-ops.mjs -- lock the ops-incident domain: exact counts, the parity spec, the Eq.(2) result,
// and the confrontation (the three self-serving accounts pairwise contradict; none is joint).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as E from './ops-enum.mjs'
import { features, dimsOf, U, Uw } from './ops-objective.mjs'

const COORDS = ['actor', 'author', 'decider', 'channel', 'intent', 'flag']
const EPS = 1e-9

test('funnel counts are exact', () => {
  assert.equal(E.statesExplored, 23978)
  assert.equal(E.settledCount, 17007)
  assert.equal(E.causalSignatures(), 480)
  assert.equal(E.all.length, 120)
  assert.equal(E.feasibles.length, 48)
  assert.ok(E.feasibles.every(r => r.g.actor === 'Executor')) // F pins the actor
})

test('parity spec: three agents, six features in [0,1], three-per-agent, equal-weight mean', () => {
  assert.equal(E.CAST.length, 3)
  const g = E.feasibles[0].g
  for (const T of E.CAST) {
    const x = features(T, g)
    assert.equal(Object.keys(x).length, 6)
    for (const v of Object.values(x)) assert.ok(v >= 0 && v <= 1)
    assert.equal(dimsOf[T].length, 3)
    const mean = 100 * dimsOf[T].reduce((s, d) => s + x[d], 0) / 3
    assert.ok(Math.abs(U[T](g) - mean) < EPS)
    assert.ok(Math.abs(Uw(T, x, [1, 1, 1]) - mean) < EPS)
  }
})

// Eq.(2): unconstrained optimum over all assertions vs the best feasible account.
const uncon = {}, feas = {}, argmax = {}
for (const T of E.CAST) {
  uncon[T] = Math.max(...E.all.map(r => U[T](r.g)))
  const scored = E.feasibles.map(r => ({ r, u: U[T](r.g) }))
  const m = Math.max(...scored.map(x => x.u))
  feas[T] = m
  argmax[T] = scored.filter(x => Math.abs(x.u - m) < EPS).map(x => x.r)
}

test('Eq.(2) optima -- unconstrained and best-feasible', () => {
  assert.ok(Math.abs(uncon.Planner - 100) < 1e-6)
  assert.ok(Math.abs(uncon.Executor - 86.6667) < 1e-3)
  assert.ok(Math.abs(uncon.Monitor - 100) < 1e-6)
  assert.ok(Math.abs(feas.Planner - 100) < 1e-6)
  assert.ok(Math.abs(feas.Executor - 71.6667) < 1e-3)
  assert.ok(Math.abs(feas.Monitor - 100) < 1e-6)
})

test("the evidence refutes the Executor's ideal (it cannot deny running the command)", () => {
  // The Executor's unconstrained optimum needs actor != Executor; F pins actor = Executor,
  // so its ideal is not feasible and it is forced down to admit-and-argue-authorization.
  assert.ok(uncon.Executor - feas.Executor > 10)
})

// each agent's indifference-convention assertion (a coord is claimed only if every maximizer agrees)
const assertOf = (T) => {
  const a = {}
  for (const c of COORDS) {
    const vals = new Set(argmax[T].map(r => r.g[c]))
    if (vals.size === 1) a[c] = [...vals][0]
  }
  return a
}
const A = Object.fromEntries(E.CAST.map(T => [T, assertOf(T)]))

test('three agents assert three distinct accounts', () => {
  assert.equal(new Set(E.CAST.map(T => JSON.stringify(A[T]))).size, 3)
})

test('confrontation: all three pairwise contradict, and no single history is joint', () => {
  const contradict = (a, b) => COORDS.some(c => a[c] !== undefined && b[c] !== undefined && a[c] !== b[c])
  assert.ok(contradict(A.Planner, A.Executor))  // channel: escalated vs authorized
  assert.ok(contradict(A.Planner, A.Monitor))   // intent: sideeffect vs intended
  assert.ok(contradict(A.Executor, A.Monitor))  // channel: authorized vs escalated
  const merged = {}; let conflict = false
  for (const T of E.CAST) for (const c of COORDS) if (A[T][c] !== undefined) {
    if (merged[c] !== undefined && merged[c] !== A[T][c]) conflict = true
    merged[c] = A[T][c]
  }
  const joint = !conflict && E.feasibles.some(r => COORDS.every(c => merged[c] === undefined || r.g[c] === merged[c]))
  assert.equal(joint, false)
})
