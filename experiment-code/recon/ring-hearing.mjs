// THE FRANCESCHINI BINDING OF THE HEARING SOLVER — Eq. (3) on The Ring and the Book.
//
// The counterpart of hearing-core.mjs. Both domains run the SAME solver (hearing-engine.mjs);
// this file supplies only what is about this case. That is the whole point: a second domain
// is evidence that Eq. (3) travels only if Eq. (3) is what stayed fixed.
//
// WHERE THE ATOM WEIGHTS COME FROM, AND WHY IT MATTERS.
//
// Corroboration and self-consistency are measured atom by atom, so they need a weighting over
// the assertion's coordinates. The grove's is hand-set — (3,3,2,1,1) on
// (actor, type, weapon, bound, armed), on the stated principle that "fatal attribution
// outweighs circumstance". Inventing a second hand-set weighting for ten coordinates would put
// a fresh, undefended judgement at the centre of the second benchmark, and any difference
// between the domains would then be partly a difference between two acts of taste.
//
// So this one is DERIVED, by a rule with no freedom in it:
//
//     w_c  =  the number of the six structural features that read coordinate c
//
// measured by perturbation over the enumerated space (vary c alone, count which score_d move).
// test-ring-hearing.mjs re-derives these numbers and fails if they drift.
//
// HONESTY ABOUT THE GROVE. The same rule applied to the grove gives (5,4,1,1,1), not the
// declared (3,3,2,1,1). It agrees on the ordering that the declared weights were chosen to
// express — attribution above circumstance — but it is not the same vector, and the derived
// claim grain would be {actor,type} where the grove uses {actor,type,weapon}. We therefore do
// NOT claim the two domains share a weighting rule, and we do not retrofit the grove (its
// published numbers depend on the declared vector). What we claim instead is weaker and true:
// the weights are a PARAMETER of the hearing, not a constant of it, and every result below is
// reported under random reweighting as well as under the default — the same discipline the
// paper already applies to U_i.
//
// NO LLM.

import { RECORD } from './ring-domain.mjs'
import { enumerate, COORDS } from './ring-core.mjs'
import { buildRecord } from './ring-evidence.mjs'
import { CAST, features, Uw, brief } from './ring-objective.mjs'
import { makeHearing } from './hearing-engine.mjs'

export { CAST, COORDS, RECORD }

/**
 * w_c = |{ d : score_d depends on coordinate c }|, by perturbation over the enumerated space.
 * Hard-coded so module load stays cheap; re-derived and asserted in test-ring-hearing.mjs, so
 * these cannot silently go stale if ring-objective.mjs changes.
 */
export const DERIVED_W = {
  consummated: 5,   // bearing, innocence, provocation, purity, warrant
  initiator: 4,     // bearing, innocence, provocation, purity
  basis: 4,         // efficacy, provocation, purity, warrant
  letters: 3,       // bearing, innocence, provocation
  peril: 3,         // provocation, purity, warrant
  sire: 2,          // innocence, provocation
  reachedRome: 1,   // efficacy
  sued: 1,          // warrant
  alone: 1,         // bearing
  usedName: 1,      // bearing
}

export const ATOM_KEYS = [...COORDS]
export const DEFAULT_ATOM_W = ATOM_KEYS.map(c => DERIVED_W[c])
export const DRIFT_W = Object.fromEntries(ATOM_KEYS.map(c => [c, DERIVED_W[c]]))

/**
 * The coarse claim, at which two accounts count as contradicting one another. The grove drops
 * its weight-1 circumstantials and keeps the rest; the same threshold here keeps the six
 * coordinates at least two features read. Coordinates below it still enter `cred` atom by
 * atom — the threshold only decides the grain of "corroborates / contradicts" and of the audit.
 */
export const CLAIM_COORDS = ATOM_KEYS.filter(c => DERIVED_W[c] >= 2)

const ringAtoms = (rec) => Object.fromEntries(ATOM_KEYS.map(c => [c, String(rec.g[c])]))

export const RING_ADAPTER = {
  CAST,
  key: (r) => r.assertion,
  fmt: (r) => brief(r.g),
  Uself: (T, rec, w) => Uw(T, features(T, rec.g), w),
  ATOM_KEYS, ATOM_W: DEFAULT_ATOM_W, atomsOf: ringAtoms, DRIFT_W,
  claimKey: (r) => CLAIM_COORDS.map(c => String(r.g[c])).join('|'),
  // Everyone concedes Guido struck the blow, so "who is accused" has no analogue here; the
  // nearest question the witnesses actually divide on is who set the flight going.
  blameOf: (r) => String(r.g.initiator),
}

const H = makeHearing(RING_ADAPTER)

export const argmaxBy = H.argmaxBy
export const rankBy = H.rankBy
export const claimKey = H.claimKey
export const profileKey = H.profileKey
export const atoms = H.atoms
export const driftAtoms = H.driftAtoms
export const credibility = H.credibility
export const drift = H.drift
export const selfConsistency = H.selfConsistency
export const standing = H.standing
export const makePayoff = H.makePayoff
export const openHearing = H.openHearing
export const continueHearing = H.continueHearing
export const applyEvidence = H.applyEvidence
export const runHearing = H.runHearing
export const jointAudit = H.jointAudit
export const u100 = H.u100

// ---------------------------------------------------------------- pools
/** enumerate once; every evidence set is a filter applied afterwards */
export function buildSpace() { return enumerate() }

/** the assertions still available under a list of established documents */
export const poolFor = (space, facts) => space.assertionsUnder(buildRecord(facts))

/** the assertions available under the complete Old Yellow Book */
export const fullPool = (space) => space.assertionsUnder(RECORD)

/**
 * A whole hearing with the documents arriving one at a time — the counterpart of
 * magistrate-core.replay. Rewind semantics: this replays the sequence from the opening rather
 * than undoing, so the same documents in a different order are a different hearing.
 */
export function replay({ space, facts, params, order = CAST, rounds = 24, explain = false }) {
  const obj = makePayoff(params)
  let pool = poolFor(space, [])
  let state = openHearing({ pool, obj, order })
  state = continueHearing(state, { pool, obj, order, rounds, explain })
  const turns = []

  for (let i = 0; i < facts.length; i++) {
    const prevPool = pool
    pool = poolFor(space, facts.slice(0, i + 1))
    if (!pool.length) {
      turns.push({ fact: facts[i], impossible: true, caught: [], moved: [], feasible: 0 })
      return { state, pool: [], turns, facts: [...facts], impossible: facts[i] }
    }
    const before = { ...state.profile }
    state = applyEvidence(state, { pool, obj, fact: facts[i], order, explain, prevPool })
    state = continueHearing(state, { pool, obj, order, rounds, explain })
    turns.push({
      fact: facts[i], caught: state.caught || [], feasible: pool.length,
      moved: CAST.filter(T => before[T].assertion !== state.profile[T].assertion),
      audit: jointAudit(state.profile),
    })
  }
  return { state, pool, turns, facts: [...facts] }
}
