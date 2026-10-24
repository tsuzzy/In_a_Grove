// THE MAGISTRATE'S FILE, FRANCESCHINI — the interactive layer for ring-magistrate.html.
//
// The counterpart of magistrate-core.mjs, and it answers the same question in a case where
// the deed is not in doubt: a file assembled ONE DOCUMENT AT A TIME while the three are
// testifying, so a document can land on the account somebody is standing on and destroy it.
//
// The state is a SEQUENCE of established facts, never a set. Which witness is caught depends
// on what they happened to be saying when the document arrived, so the same documents in a
// different order are a different hearing.
//
//   establish   append and re-solve. History accumulates.
//   withdraw    NOT an undo. It is a REWIND: replay the remaining sequence from the opening.
//               Cheap (a few ms), exactly reproducible, and it does not pretend the
//               magistrate forgot.
//
// WHAT A WITNESS ASSERTS, AND WHAT THEY MERELY SCORE THE SAME ON.
//
// This is the load-bearing idea of the file and the one that is easy to get wrong. U_i is
// heavily tied: many feasible accounts differ only in coordinates a given witness's three
// dimensions cannot read. A witness indifferent between two accounts has not chosen between
// them, so the page must not print one of them as their testimony — that is a string
// tie-break wearing a witness's voice. Concretely: Pompilia's utility asks only that the
// letters not be in HER hand, so "in Guido's" and "in Caponsacchi's" are worth exactly the
// same to her, and an unguarded argmax has her accusing the priest — the opposite of Book VII.
//
// So a witness ASSERTS a coordinate only when every account attaining their maximum agrees on
// it, and is recorded as uncommitted otherwise. Everything downstream — who is caught out,
// who contradicts whom, how many of them can be true at once — is computed against assertions,
// never against a representative.
//
// NO LLM.

import { signature, RECORD } from './ring-domain.mjs'
import { enumerate, COORDS } from './ring-core.mjs'
import { buildRecord, FACTS, FACT_KEYS } from './ring-evidence.mjs'
import { CAST, features, U, DIM_NAMES, DISPUTED, brief, label } from './ring-objective.mjs'

export { CAST, COORDS, FACTS, FACT_KEYS, DISPUTED, DIM_NAMES, brief, label, RECORD }

const EPS = 1e-12

/**
 * Enumerate the reachable graph once. It does NOT depend on the evidence — every file is a
 * filter applied afterwards — which is what makes the page affordable: this runs on load and
 * each subsequent toggle only re-filters and re-solves.
 */
export function buildSpace() {
  return enumerate()
}

/** the assertions still available under a given list of established documents */
export function poolFor(space, facts) {
  return space.assertionsUnder(buildRecord(facts))
}

/**
 * Solve one pool: every witness's maximizers, their utility, and what they commit to.
 * `pick` is a representative for display only; `commits` is the testimony.
 */
export function solve(pool) {
  const out = {}
  for (const T of CAST) {
    const f = (r) => U[T](features(T, r.g))
    const best = pool.reduce((m, r) => Math.max(m, f(r)), -Infinity)
    const maxers = pool.filter(r => f(r) > best - EPS)
      .sort((a, b) => (a.assertion < b.assertion ? -1 : 1))
    const commits = {}
    for (const c of COORDS) {
      const vals = new Set(maxers.map(r => String(r.g[c])))
      commits[c] = vals.size === 1 ? [...vals][0] : null
    }
    const says = {}
    for (const d of DISPUTED) {
      const vals = new Set(maxers.map(r => String(d.read(r.g))))
      says[d.q] = vals.size === 1 ? [...vals][0] : null
    }
    out[T] = { T, u: best, maxers, pick: maxers[0], commits, says, tied: maxers.length }
  }
  return out
}

/** does this account satisfy everything witness T asserts? */
export const satisfies = (rec, w) => DISPUTED.every(d => w.says[d.q] === null || String(d.read(rec.g)) === w.says[d.q])

/**
 * How much of the testimony can be true at once.
 *
 * `provenLies` is the number of witnesses that MUST be lying, established without knowing what
 * actually happened: take the largest set of witnesses some single feasible account satisfies,
 * and the rest are provably false. In the grove this bottoms out at 2 because no history
 * satisfies all three; here it also reaches 2 for a stronger reason, since no history satisfies
 * even two of them.
 */
export function jointAudit(pool, sol) {
  const ws = CAST.map(T => sol[T])
  let bestTogether = 0
  for (const rec of pool) {
    const n = ws.filter(w => satisfies(rec, w)).length
    if (n > bestTogether) bestTogether = n
  }
  const pairs = {}
  for (let i = 0; i < CAST.length; i++) for (let j = i + 1; j < CAST.length; j++) {
    const a = CAST[i], b = CAST[j]
    pairs[`${a}+${b}`] = pool.filter(r => satisfies(r, sol[a]) && satisfies(r, sol[b])).length
  }
  const distinctClaims = new Set(CAST.map(T => sol[T].pick.assertion)).size
  const contested = DISPUTED.filter(d => {
    const vals = CAST.map(T => sol[T].says[d.q]).filter(v => v !== null)
    return new Set(vals).size > 1
  }).map(d => d.q)
  return {
    distinctClaims, bestTogether, provenLies: CAST.length - bestTogether,
    pairs, contested, jointly: pool.filter(r => ws.every(w => satisfies(r, w))).length,
  }
}

/** which coordinates every surviving account agrees on, and which are still open */
export function pinning(pool) {
  const out = {}
  for (const c of COORDS) {
    const vals = [...new Set(pool.map(r => String(r.g[c])))]
    out[c] = { pinned: vals.length === 1, values: vals }
  }
  return out
}

/**
 * Replay the whole hearing from the opening, establishing `facts` in order.
 * Returns the final state plus a log of turning points.
 *
 * A witness is CAUGHT OUT when the document that just landed removed every account attaining
 * their previous maximum — not merely when their displayed representative changed. Checking
 * the representative would report a witness broken because a tie-break moved, which is the
 * same mistake the assertion rule exists to prevent.
 */
export function replay({ space, facts }) {
  let pool = poolFor(space, [])
  let sol = solve(pool)
  const turns = []

  for (let i = 0; i < facts.length; i++) {
    const before = sol
    const beforePool = pool
    pool = poolFor(space, facts.slice(0, i + 1))
    if (!pool.length) {
      turns.push({ fact: facts[i], impossible: true, caught: [], moved: [], feasible: 0 })
      return { pool: [], sol: before, turns, facts: [...facts], impossible: facts[i], audit: jointAudit(beforePool, before) }
    }
    const survives = new Set(pool.map(r => r.assertion))
    const caught = CAST.filter(T => !before[T].maxers.some(r => survives.has(r.assertion)))
    sol = solve(pool)
    turns.push({
      fact: facts[i], caught, feasible: pool.length,
      moved: CAST.filter(T => before[T].pick.assertion !== sol[T].pick.assertion),
      eliminated: beforePool.length - pool.length,
      audit: jointAudit(pool, sol),
    })
  }
  return { pool, sol, turns, facts: [...facts], audit: jointAudit(pool, sol) }
}

/** what establishing `fact` next would do, without doing it */
export function preview(prev, { space, fact }) {
  const facts = [...prev.facts, fact]
  const pool = poolFor(space, facts)
  if (!pool.length) return { fact, impossible: true }
  const survives = new Set(pool.map(r => r.assertion))
  return {
    fact,
    feasibleBefore: prev.pool.length,
    feasibleAfter: pool.length,
    eliminates: prev.pool.length - pool.length,
    wouldCatch: CAST.filter(T => !prev.sol[T].maxers.some(r => survives.has(r.assertion))),
  }
}

/** the full record, in the order a magistrate working forward through the documents meets it */
export const ALL_FACTS = FACT_KEYS
