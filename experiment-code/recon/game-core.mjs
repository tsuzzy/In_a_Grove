// The COUPLED TESTIMONY GAME — single source of truth for the strategic layer.
//
// V1 (optimize.mjs / joint.mjs) solved each witness in ISOLATION:
//     τ̂_i = argmax_τ U_i(τ)   s.t.  τ ∈ Feasible(F)
// and then observed, post hoc, that the three answers are jointly unsatisfiable.
// Nobody in V1 ever anticipated anybody. Here they do:
//     τ̂_i = BR_i(τ̂_{-i})
// The bandit guesses the wife will blame the husband, and revises what he himself says.
//
// Solved by LEVEL-K bounded rationality, chosen so that **level-0 IS EXACTLY V1** — the
// previous result is not replaced, it becomes the k=0 row of this table. Everything at
// k≥1 is new.
//
// Discipline, identical to grove-core.mjs:
//   * NO LLM anywhere in this file. Feasibility comes from the simulator, the objective is
//     a transparent function, the game is solved by exhaustive enumeration (7^3 = 343).
//   * grove-core.mjs is imported, NEVER modified: V1's published numbers must not drift.
//   * deterministic tie-breaks by signature string (an earlier version of optimize.mjs
//     sorted in place and made tie-heavy statistics silently order-dependent).

import { CAST, feasibles, features, U, dimsOf, Uw, label, rand } from './grove-core.mjs'
export { CAST, feasibles, label, rand }

// ---- V1-compatible vocabulary (copied verbatim from joint.mjs so the two are comparable) ----
/** the coarse fatal attribution an account asserts; V1 counts distinct claims with this */
export const claimKey = r => `${r.an.fatal.actor}|${r.an.fatal.type}|${r.an.fatal.weapon}`
/** the agent an account blames for the fatal act */
export const accuses = r => r.an.fatal.actor

export const argmaxBy = (arr, f) =>
  arr.slice().sort((a, b) => (f(b) - f(a)) || (a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0))[0]

// ---- τ*: what the committed ledger records ACTUALLY happened ----
// Verbatim from testimony.mjs's case record for pre-B'/run-06 (`trueKiller: 'Masago'`:
// she drove the dagger into his throat; Tajomaru struck no blow; Takehiro did not take his
// own life). No witness sees this — only the audit does.
export const TRUTH_CLAIM = 'Masago|strike|dagger'
export const assertsTruth = (rec) => claimKey(rec) === TRUTH_CLAIM

/** two feasible accounts can share a label and differ on circumstance atoms; disambiguate */
export const tag = (rec) => `${label(rec.an)}${rec.an.fatal.victimArmed ? ' [armed]' : ' [unarmed]'}`

// ---- 1-2. atoms and corroboration ----
// Moved to hearing-core.mjs, which is the one solver and has no module-level state, so the
// browser bundle and the node scripts cannot drift apart. Re-exported unchanged.
import { ATOM_KEYS, DEFAULT_ATOM_W, atoms, credibility } from './hearing-core.mjs'
export { ATOM_KEYS, DEFAULT_ATOM_W, atoms, credibility }

// ---- 3. the objective ----
/** V1's private objective, untouched: U_i over the witness's own three generic dimensions */
export const Uself = (T, rec, w = [1, 1, 1]) => Uw(T, features(T, rec.an), w)

/**
 * The coupled objective. β=0 collapses to Uself EXACTLY, which is what makes level-0 ≡ V1.
 * `profile` must already contain T's candidate account under key T.
 */
export const Utot = (T, profile, beta, opts = {}) => {
  const { w = [1, 1, 1], atomW = DEFAULT_ATOM_W } = opts
  const self = Uself(T, profile[T], w)
  if (beta === 0) return self                       // exact, not approximate, degeneration
  return (1 - beta) * self + beta * credibility(T, profile, atomW)
}

// ---- 4. level-k ----
// Every solver takes an optional `pool` — the feasible set the witnesses may choose from.
// It defaults to grove-core's, i.e. our own run-06 aftermath, which is what V1 and every
// published game number use. Passing a different pool runs the same game on a different
// evidential world (see recon/akutagawa.mjs).

/** level-0: nobody anticipates anybody. This is V1. */
export function level0(opts = {}) {
  const { w = [1, 1, 1], pool = feasibles } = opts
  const p = {}
  for (const T of CAST) p[T] = argmaxBy(pool, r => Uself(T, r, w))
  return p
}

/** one best-response step: every witness answers the PREVIOUS profile of the others */
export function bestResponse(prev, beta, opts = {}) {
  const { pool = feasibles } = opts
  const next = {}
  for (const T of CAST) {
    next[T] = argmaxBy(pool, r => Utot(T, { ...prev, [T]: r }, beta, opts))
  }
  return next
}

export const profileKey = (p) => CAST.map(T => p[T].sig).join(' || ')

/**
 * Iterate best responses from level-0 up to K.
 * Returns the whole trajectory plus how it terminated: a fixed point (a pure-strategy
 * equilibrium reached by this path), a cycle (no stable story), or still moving at K.
 * Cycles are reported as-is — we do not search for a β that converges.
 */
export function levelK(K, beta, opts = {}) {
  const traj = [level0(opts)]
  const seen = new Map([[profileKey(traj[0]), 0]])
  let terminal = { kind: 'open', at: null, period: null }
  for (let k = 1; k <= K; k++) {
    const next = bestResponse(traj[k - 1], beta, opts)
    const nk = profileKey(next)
    traj.push(next)
    if (nk === profileKey(traj[k - 1])) { terminal = { kind: 'fixed', at: k, period: 1 }; break }
    if (seen.has(nk)) { terminal = { kind: 'cycle', at: k, period: k - seen.get(nk) }; break }
    seen.set(nk, k)
  }
  return { traj, terminal }
}

// ---- 5. pure-strategy Nash equilibria, by brute force over all 343 profiles ----
// Reported alongside level-k so convergence can be read against the true equilibrium set.
export function nashEquilibria(beta, opts = {}) {
  const { pool = feasibles } = opts
  const eq = []
  for (const a of pool) for (const b of pool) for (const c of pool) {
    const p = { [CAST[0]]: a, [CAST[1]]: b, [CAST[2]]: c }
    const stable = CAST.every(T => {
      const best = argmaxBy(pool, r => Utot(T, { ...p, [T]: r }, beta, opts))
      const cur = Utot(T, p, beta, opts)
      return Utot(T, { ...p, [T]: best }, beta, opts) <= cur + 1e-12
    })
    if (stable) eq.push(p)
  }
  return eq
}

// ---- 6. the audit questions, V1-compatible ----
/** V1 definition: a single death has ONE fatal (actor,type,weapon), so one world fits all
 *  three accounts iff they assert the same coarse claim. */
export function jointAudit(profile) {
  const claims = CAST.map(T => claimKey(profile[T]))
  const distinct = new Set(claims)
  const jointlySat = distinct.size === 1
  const accused = new Set(CAST.map(T => accuses(profile[T])))
  return {
    claims,
    distinctClaims: distinct.size,
    jointlySat,
    atMostTrue: jointlySat ? 3 : 1,
    /** what the SET proves without knowing the truth — V1's headline, recomputed */
    provenLies: jointlySat ? 0 : CAST.length - 1,
    indivFeasible: CAST.every(T => profile[T].feasible),
    blame: CAST.map(T => ({ from: T, to: accuses(profile[T]) })),
    unaccused: CAST.filter(a => !accused.has(a)),
  }
}

/**
 * A frame-up: two or more witnesses converge on one story that blames somebody else.
 * Structurally impossible to observe in V1 — independent optima cannot coordinate.
 */
export function frameUp(profile) {
  const groups = new Map()
  for (const T of CAST) {
    const k = claimKey(profile[T])
    groups.set(k, [...(groups.get(k) || []), T])
  }
  for (const [k, members] of groups) {
    const target = k.split('|')[0]
    if (members.length >= 2 && !members.includes(target)) {
      return { colluders: members, target, claim: k }
    }
  }
  return null
}
