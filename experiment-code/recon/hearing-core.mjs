// THE GROVE'S BINDING OF THE HEARING SOLVER — Eq. (3) on In a Grove.
//
// The solver itself moved to hearing-engine.mjs when the Franceschini benchmark arrived, so
// that both domains run the SAME Eq. (3) rather than two copies of it. What is left here is
// exactly the part that is about the grove: which witnesses there are, what an account's
// assertion atoms are, and how coarse a claim has to be before two accounts count as
// contradicting one another.
//
// The export surface is unchanged, deliberately. game-core, dialogue, magistrate-core,
// test-magistrate and the browser bundle all import from here by name, and the paper's
// published grove numbers depend on this module behaving exactly as it did — so the refactor
// is required to be a no-op on the grove, and is checked against captured baselines.
//
//   cred_i      atom-level corroboration by the other two, in (1/3, 1]
//   self_i      max(0, 1 − γ·drift from one's OWN opening statement)
//   standing_i  max(0, 1 − δ·(times the evidence has caught this witness out))
//
// cred and self depend on what is currently asserted, so a witness can repair them by
// speaking again. standing depends on what HAPPENED, and cannot be repaired — which is what
// makes being caught out heavier than merely changing one's mind.
//
// NO LLM. Usable from node and from the browser bundle alike.

import { features, dimsOf, Uw, label } from './grove-objective.mjs'
// no `as` renaming in these imports: bundle-esm.mjs's ESM->classic transform does not
// support it, and this module has to survive that transform for magistrate.html.
import { makeHearing, u100 } from './hearing-engine.mjs'
export { features, dimsOf, Uw, label }
export { u100 }

export const CAST = ['Tajomaru', 'Masago', 'Takehiro']

// The asserted signature decomposes into these atoms. Two accounts can agree on who wielded
// the blade and still contradict each other on whether the victim was armed, so agreement is
// measured atom by atom. Fatal attribution outweighs circumstance.
export const ATOM_KEYS = ['actor', 'type', 'weapon', 'bound', 'armed']
export const DEFAULT_ATOM_W = [3, 3, 2, 1, 1]
export const DRIFT_W = { actor: 3, type: 3, weapon: 2, bound: 1, armed: 1 }

const groveAtoms = (rec) => {
  const f = rec.an.fatal
  return { actor: f.actor, type: f.type, weapon: f.weapon, bound: !!f.boundAtDeath, armed: !!f.victimArmed }
}

/** the coarse fatal attribution an account asserts */
const groveClaimKey = (r) => `${r.an.fatal.actor}|${r.an.fatal.type}|${r.an.fatal.weapon}`

const GROVE_ADAPTER = {
  CAST,
  key: (r) => r.sig,
  fmt: (r) => label(r.an),
  Uself: (T, rec, w) => Uw(T, features(T, rec.an), w),
  ATOM_KEYS, ATOM_W: DEFAULT_ATOM_W, atomsOf: groveAtoms, DRIFT_W,
  claimKey: groveClaimKey,
  // a single death has ONE fatal actor, so the audit can report who blames whom
  blameOf: (r) => r.an.fatal.actor,
}

const H = makeHearing(GROVE_ADAPTER)

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
