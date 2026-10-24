// THE MAGISTRATE'S HEARING — evidence arriving during testimony, not before it.
//
// Every earlier build fixed F before the first word was spoken. A hearing therefore never
// caught anybody out: witnesses coordinated or did not, and evidence only decided which
// story they coordinated on. Here the file is assembled ONE FACT AT A TIME while the three
// are talking, so a fact can land on the account somebody is standing on and destroy it.
//
// The state is a SEQUENCE of established facts, never a set. Which witness is caught
// depends on what they happened to be saying when the fact arrived, so the same facts in a
// different order are a different hearing. Consequences:
//
//   establish a fact   incremental: applyEvidence then resume. History accumulates.
//   withdraw a fact    NOT an undo — refutation standing is permanent and the magistrate
//                      does not forget. It is a REWIND: replay the remaining sequence from
//                      the opening statements. Cheap (a few ms) and exactly reproducible.
//
// `replay` is therefore the reference implementation and `establish` is the fast path; the
// tests assert the two agree, which is what catches any state that leaks between steps.
//
// `known` is the other protocol: facts on file BEFORE the opening statements. With the whole
// record in `known` and nothing established afterwards, this is the hearing the paper reports
// (Section 4.3): F fixed first, witnesses open with their best feasible accounts under it, then
// revise in turn. Facts in `facts` still arrive during testimony, on top of whatever is known.
//
// NO LLM.

import { enumerateShared, DEGENERATE } from './grove-enum.mjs'
import { buildF } from './evidence.mjs'
import {
  CAST, makePayoff, openHearing, continueHearing, applyEvidence, jointAudit, claimKey,
} from './hearing-core.mjs'

/**
 * Enumerate the reachable graph once. It does NOT depend on the evidence — every file is a
 * filter applied afterwards — which is what makes the interactive page affordable: this runs
 * on load, and each subsequent toggle only re-filters and re-solves.
 */
export function buildSpace(specs) {
  return enumerateShared({ specs, degenerate: DEGENERATE })
}

/**
 * WHAT A WITNESS ACTUALLY ASSERTS.
 *
 * A causal signature pins the wound's location, and U_i cannot see it — throat and chest
 * variants of the same claim score identically for everybody. So the choice between them was
 * never a claim; it was argmaxBy's string tie-break. Treating it as one meant that
 * establishing where the wound is "caught out" all three witnesses at once, permanently
 * costing them standing, for a detail none of them had preferred — and the transcript
 * printed the correction as X -> X, because the label does not show the part either.
 *
 * An assertion is therefore the signature MINUS the dimensions the objective cannot
 * distinguish. Right now that is exactly `part` (the rope-cutter left U earlier). If a
 * dimension is ever added to U_i it becomes asserted automatically, with no change here.
 */
export const assertKey = (rec) => {
  const f = rec.an.fatal
  return `${f.actor}|${f.type}|${f.weapon}|bound:${f.boundAtDeath}|armed:${f.victimArmed}`
}

/** one record per assertion, keeping the variants it stays uncommitted between */
export function collapse(records) {
  const by = new Map()
  for (const r of records) {
    const k = assertKey(r)
    if (!by.has(k)) by.set(k, { ...r, sig: k, variants: [r] })
    else by.get(k).variants.push(r)
  }
  return [...by.values()]
}

/** the assertions still available under a given list of facts */
export function poolFor(space, facts, opt) {
  // A signature survives a file when SOME history realising it produces that scene. The
  // enumerator kept every distinct end state per signature for exactly this, so an arbitrary
  // file — one nobody named before the walk — is still decided exactly rather than by
  // testing one arbitrary representative history.
  return collapse(space.feasibleUnderSpec(buildF(facts, opt)))
}

/**
 * Replay a whole hearing from the opening statements, establishing `facts` in order.
 * This is the reference semantics. Returns the final state plus a log of turning points.
 * `known` facts are on file before anyone speaks; see the header.
 */
export function replay({ space, facts, known = [], params, opt, order = CAST, rounds = 24, explain = false }) {
  const obj = makePayoff(params)
  // the hearing opens on whatever is known before any fact is established
  let pool = known.length ? poolFor(space, known, opt) : collapse(space.all)
  if (!pool.length) {
    // the file on record before the hearing is already contradictory: nobody can open at all
    const all = collapse(space.all)
    return { state: openHearing({ pool: all, obj, order }), pool: [], turns: [], facts: [...facts],
      known: [...known], impossible: known[known.length - 1] }
  }
  let state = openHearing({ pool, obj, order })
  state = continueHearing(state, { pool, obj, order, rounds, explain })
  const turns = []

  for (let i = 0; i < facts.length; i++) {
    const established = [...known, ...facts.slice(0, i + 1)]
    const prevPool = pool
    pool = poolFor(space, established, opt)
    if (!pool.length) {
      // No scene fits this file. Reported as such rather than carrying on with the previous
      // pool, which would show the caller a record that the evidence has already ruled out.
      turns.push({ fact: facts[i], impossible: true, caught: [], moved: [], feasible: 0 })
      return { state, pool: [], turns, facts: [...facts], known: [...known], impossible: facts[i] }
    }
    const before = { ...state.profile }
    // prevPool lets the deliberation show what this fact took away, and at what it had been
    // worth — the part that makes a forced choice among leftovers legible
    state = applyEvidence(state, { pool, obj, fact: facts[i], order, explain, prevPool })
    state = continueHearing(state, { pool, obj, order, rounds, explain })
    turns.push({
      fact: facts[i], caught: state.caught || [], feasible: pool.length,
      moved: CAST.filter(T => before[T].sig !== state.profile[T].sig),
      audit: jointAudit(state.profile),
    })
  }
  return { state, pool, turns, facts: [...facts], known: [...known] }
}

/**
 * The fast path the page uses: one more fact on top of an existing hearing.
 * Must agree with `replay` on the same sequence — asserted in test-magistrate.mjs.
 */
export function establish(prev, { space, fact, params, opt, order = CAST, rounds = 24, explain = false }) {
  const obj = makePayoff(params)
  const known = prev.known || []
  const facts = [...prev.facts, fact]
  const pool = poolFor(space, [...known, ...facts], opt)
  if (!pool.length) return { ...prev, facts, impossible: fact }
  const before = { ...prev.state.profile }
  let state = applyEvidence(prev.state, { pool, obj, fact, order, explain, prevPool: prev.pool })
  state = continueHearing(state, { pool, obj, order, rounds, explain })
  return {
    state, pool, facts, known: [...known],
    turns: [...prev.turns, {
      fact, caught: state.caught || [], feasible: pool.length,
      moved: CAST.filter(T => before[T].sig !== state.profile[T].sig),
      audit: jointAudit(state.profile),
    }],
  }
}

/** what establishing `fact` next would do, without doing it — the auditor's budget question */
export function preview(prev, { space, fact, params, opt, order = CAST }) {
  const facts = [...(prev.known || []), ...prev.facts, fact]
  const pool = poolFor(space, facts, opt)
  if (!pool.length) return { fact, impossible: true }
  const feasible = new Set(pool.map(r => r.sig))
  return {
    fact,
    feasibleBefore: prev.pool.length,
    feasibleAfter: pool.length,
    eliminates: prev.pool.length - pool.length,
    // who is standing on an account this fact would destroy
    wouldCatch: CAST.filter(T => !feasible.has(prev.state.profile[T].sig)),
  }
}

export { CAST, jointAudit, claimKey }
