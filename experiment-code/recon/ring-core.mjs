// ENUMERATION AND FEASIBILITY for the Franceschini case.
//
// Same contract as grove-enum.mjs: one enumeration of the whole reachable graph with NO
// pruning on any record, and each record then picks its own survivors out of the one shared
// space. That is what makes |Feas(F)| comparable between records, and what makes the
// unconstrained ideal — the thing "the constraint bites" is measured against — a maximum over
// the same candidates in every condition.
//
// TWO DIFFERENCES FROM THE GROVE, both consequences of the deed being conceded.
//
// (1) The grove's search key has to carry the fatal attribution, because the state records the
//     wound but not who dealt it, so two different killers reach an identical state. Nothing
//     like that happens here: every disputed coordinate is monotone — once the letters are
//     written, once they have lain together, once the suit is brought, the fact is in the
//     state and stays there. The state key therefore already contains the signature and no
//     separate attribution needs carrying. Worth saying out loud, because a reader who knows
//     the grove will look for the trick and should know why it is absent.
//
// (2) The quotient runs the other way. In the grove exactly one coordinate — the wound's
//     location — drops out of the assertion. Here the coordinate that drops out is whether
//     Pompilia could write. No score reads it; it only gates who could have held the pen, and
//     the pen's owner IS read. So two histories differing only in her schooling are one
//     assertion, and no teller ever chose between them. But literacy is still readable by a
//     CONSTRAINT — Pompilia asserts she could not write — so the quotient is applied to the
//     argmax domain only, never to feasibility. Feasibility runs on signatures; an assertion
//     is feasible iff some signature under it is.
//
// NO LLM: feasibility is the simulator replaying steps.

import { ACTIONS, initialState, simulate, signature, sigKey, diffRecord, PRINCIPALS } from './ring-domain.mjs'
import { readings, buildReading, coherent, CONTESTED_KEYS } from './ring-evidence.mjs'

export { PRINCIPALS }

/** the assertion key: the signature minus the one coordinate no objective reads */
export const assertKey = (g) => sigKey({ ...g, literate: false })

const stateKey = (s) => JSON.stringify([
  s.where, s.alive, s.pompilia, s.letters, s.flight, s.child, s.suit, s.guido, s.peril,
])

/** every grounded action available in state `s` */
function* groundings(s) {
  for (const type of Object.keys(ACTIONS)) {
    if (type === 'write_letters') {
      for (const actor of ['Pompilia', 'Caponsacchi', 'Guido'])
        if (ACTIONS[type].pre(s, { type, actor }).ok) yield { type, actor }
    } else if (ACTIONS[type].pre(s, { type }).ok) {
      yield { type }
    }
  }
}

/**
 * A state is a candidate ENDING when the case has come to rest, and there are two ways for
 * that to happen. Either the killing is done and Guido is taken — the case as the documents
 * have it — or the pair reached Rome, in which case there is no murder case at all.
 *
 * The second disjunct is not decoration and it is easy to leave out by accident. Caponsacchi's
 * whole self-accusation in Book VI is that he stopped at Castelnuovo when he should have
 * pressed on; the history in which he does press on is his unconstrained ideal, and if the
 * enumerator records only states where somebody died, that history is never a candidate and
 * his ideal is silently reported as attainable. It is not: the record says they were taken
 * short of Rome. Leaving it out costs the experiment one of its two refutations, and the more
 * interesting one, because it bites on a different coordinate than Guido's.
 */
const settled = (s) => (s.guido.basis !== null && s.guido.taken) || s.flight.reachedRome

/**
 * Enumerate the reachable graph once.
 *
 * Every settled state is recorded against its signature, and all of them are kept rather than
 * one representative. A signature is feasible under a record iff SOME of its end states fits —
 * judging it by a single stored history is the bug that once cost the grove four of its eleven
 * feasible accounts, and the same bug is available here because histories sharing a signature
 * still differ in what a record constrains (whether she lived to testify, whether he was taken
 * at the gate).
 */
export function enumerate({ cap = 400000 } = {}) {
  const start = initialState()
  const seen = new Map([[stateKey(start), { parent: null, act: null, state: start }]])
  const queue = [stateKey(start)]
  const bySig = new Map()
  let statesExplored = 0, endStates = 0

  const pathTo = (k) => {
    const steps = []
    let cur = k
    while (seen.get(cur).act) { steps.unshift(seen.get(cur).act); cur = seen.get(cur).parent }
    return steps
  }

  while (queue.length) {
    const k = queue.shift(); statesExplored++
    const s = seen.get(k).state
    const g = signature(s)

    if (settled(s)) {
      endStates++
      const key = sigKey(g)
      let rec = bySig.get(key)
      if (!rec) { rec = { sig: key, g, ends: new Map(), steps: pathTo(k) }; bySig.set(key, rec) }
      rec.ends.set(k, s)
    }

    for (const a of groundings(s)) {
      const steps = [...pathTo(k), a]
      const sim = simulate(steps)
      if (!sim.ok) continue
      const nk = stateKey(sim.state)
      if (!seen.has(nk)) { seen.set(nk, { parent: k, act: a, state: sim.state }); queue.push(nk) }
    }
    if (statesExplored > cap) { console.error('safety cap hit'); break }
  }

  const all = [...bySig.values()]

  /** the signatures some end state of which satisfies `spec` */
  const feasibleSigs = (spec) => all.filter(r => {
    for (const st of r.ends.values()) if (diffRecord(st, spec).length === 0) return true
    return false
  })

  /**
   * The argmax domain: one entry per ASSERTION, carrying every signature that spells it.
   * `g` is the representative's signature and is safe to score, because the coordinate the
   * signatures under one assertion may differ on is exactly the one no score reads.
   */
  const assertionsUnder = (spec) => {
    const byA = new Map()
    for (const r of feasibleSigs(spec)) {
      const a = assertKey(r.g)
      if (!byA.has(a)) byA.set(a, { assertion: a, g: r.g, sigs: [], steps: r.steps })
      byA.get(a).sigs.push(r)
    }
    return [...byA.values()]
  }

  return {
    statesExplored, endStates, all,
    causalSignatures: all.length,
    assertions: new Set(all.map(r => assertKey(r.g))).size,
    feasibleSigs, assertionsUnder,
  }
}

// ---------------------------------------------------------------- the Pope's objective
/**
 * J_Pope — the one objective in this project with no self-interest in it, and the only one
 * that is not a function of a single history in isolation.
 *
 * A READING of the case is a coherent choice of whom to believe among the parties (see
 * ring-evidence.mjs). J_Pope(a) is the fraction of readings under which assertion `a` still
 * stands. The normalization drops readings that no history at all survives: those are not
 * readings of THIS case, they are ways of believing a set of people who cannot all be right,
 * and counting them would reward accounts for other people's incoherence.
 *
 * This is Browning's ring, made arithmetic. The gold is what is left when every speaker's
 * alloy has been filed away in turn — not the account that pleases, the account you have to
 * disbelieve the most people to be rid of.
 */
export function popeScores(space, { base, keys = CONTESTED_KEYS, weighted = true } = {}) {
  const rs = readings(keys)
  const survivors = new Map()      // assertion -> total weight of readings it survives
  let live = 0                     // total weight of readings under which the case is coherent

  // A reading's weight is a product over ALL contested assertions of whether it credits them,
  // not a product over the credited ones only. The difference matters: weighting by the
  // credited ones alone makes every additional assertion increase a reading's weight, so the
  // measure drifts toward readings that believe everybody, which is the opposite of a
  // magistrate's posture. Here each assertion is credited independently with probability p_k
  // and the reading's weight is ∏ p_k over the credited and ∏ (1−p_k) over the rest.
  const weightOf = (r) => {
    if (!weighted) return 1
    let w = 1
    for (const k of keys) w *= r.includes(k) ? CREDIT_P(k) : (1 - CREDIT_P(k))
    return w
  }

  for (const r of rs) {
    const spec = buildReading(r, base)
    const surviving = space.assertionsUnder(spec)
    if (!surviving.length) continue          // an incoherent way to believe people
    const w = weightOf(r)
    live += w
    for (const a of surviving) survivors.set(a.assertion, (survivors.get(a.assertion) || 0) + w)
  }
  const score = (a) => (survivors.get(a) || 0) / (live || 1)

  /**
   * How the surviving mass distributes over the values of one coordinate. This, and not the
   * argmax, is what should be read off J_Pope: on three of the four open coordinates the
   * uniform measure is exactly symmetric, so an argmax there is a string tie-break wearing a
   * verdict's clothes. Reporting the marginal says which coordinates the objective actually
   * decides and which it leaves open — which is the honest answer, and is also Book X's:
   * the Pope settles what he can settle and says so about the rest.
   */
  const marginal = (pool, coord) => {
    const m = new Map()
    let tot = 0
    for (const a of pool) { const v = String(a.g[coord]); const s = score(a.assertion); m.set(v, (m.get(v) || 0) + s); tot += s }
    return [...m.entries()].map(([v, s]) => ({ value: v, mass: s / (tot || 1) })).sort((x, y) => y.mass - x.mass)
  }

  return { live, readings: rs.length, score, survivors, marginal }
}

// An assertion two parties make independently is credited more readily than one only the
// party it benefits makes. p = a/(a+1): a lone self-serving assertion is a coin-flip, one
// corroborated by a second party is 2:1. This is the whole of the Pope's prior, and it is
// evidentiary rather than moral — it says nothing about who deserves belief, only that
// uncorroborated testimony from an interested party is worth less than corroborated.
import { attestors } from './ring-evidence.mjs'
const CREDIT_P = (k) => attestors(k) / (attestors(k) + 1)

// ---------------------------------------------------------------- what the record pins
/**
 * WHICH COORDINATES THE RECORD CLOSES, AND WHICH IT LEAVES OPEN.
 *
 * This is the measurement the second domain exists for. The grove's evidence is thin and it
 * still leaves the killer's identity open. The Franceschini record is thick, and the deed is
 * conceded by the man who did it — so if a self-serving spread survives HERE, it cannot be
 * explained by anybody being in doubt about what happened.
 *
 * A coordinate is PINNED if every feasible assertion agrees on it, and OPEN otherwise.
 */
export const COORDS = ['initiator', 'letters', 'consummated', 'reachedRome', 'sire', 'basis', 'sued', 'alone', 'usedName', 'peril']

export function pinning(pool) {
  const out = {}
  for (const c of COORDS) {
    const vals = new Set(pool.map(a => String(a.g[c])))
    out[c] = { pinned: vals.size === 1, values: [...vals] }
  }
  return out
}
