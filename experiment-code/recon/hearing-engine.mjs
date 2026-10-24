// THE HEARING SOLVER, DOMAIN-AGNOSTIC — Eq. (3) with the story factored out.
//
// hearing-core.mjs was the sequential-revision solver AND the grove's binding of it, in one
// file. That was fine while there was one domain. It is not fine with two: a second benchmark
// is evidence that the framework travels only if the framework is what stayed fixed, and a
// second copy of the solver would make any difference between the domains unattributable.
// So the solver moves here, parameterised by a DOMAIN ADAPTER, and each domain supplies only
// the adapter. hearing-core.mjs is now the grove's adapter and re-exports this engine's bound
// functions under their original names; ring-hearing.mjs is the Franceschini one.
//
// The objective is unchanged. Only the first term is the paper's Eq. (2):
//
//   U_i^tot(τ_i ; τ_-i, history)
//     = (1−β)·U_i(τ_i)  +  β · cred_i(τ_i ; τ_-i) · self_i(τ_i) · standing_i(history)
//       ─────────────      ──────────────────────────────────────────────────────────
//       the domain's U_i   the coupling layer: corroboration × self-consistency × standing
//
// β is the master gate: at β=0 all three penalties vanish and U^tot is exactly U_i, which is
// the regression anchor every domain must reproduce. γ=0 and δ=0 are the other two.
//
// WHAT AN ADAPTER MUST SUPPLY. Everything domain-shaped, and nothing else:
//
//   CAST        string[]                the witnesses, in a fixed order
//   key(rec)    rec -> string           stable identity; the ONLY tie-break, so no result
//                                       depends on the order the enumerator emitted
//   fmt(rec)    rec -> string           display; never used in a comparison
//   Uself(T, rec, w) -> number          the domain's U_i under an explicit weighting
//   ATOM_KEYS   string[]                the assertion atoms, in weight order
//   ATOM_W      number[]                their weights (corroboration)
//   atomsOf(rec) -> {atom: value}       the atoms of one account
//   DRIFT_W     {atom: number}          drift weights (self-consistency)
//   claimKey(rec) -> string             the COARSE claim, for corroboration relations and the
//                                       audit: two accounts differing only below this grain
//                                       are not treated as contradicting one another
//   blameOf(rec) -> string   OPTIONAL   whom this account puts the deed on; enables the audit's
//                                       blame graph. Omitted where the domain has no analogue.
//
// NO LLM. Usable from node and from a browser bundle alike. No module-level state.

export const u100 = (x) => Math.round(100 * x)

/**
 * What is left of a witness's credibility after the evidence has caught them out n times.
 *
 * Hoisted to module scope deliberately, not closed over an adapter: standing reads only what
 * HAPPENED to a witness, never anything about the domain, so both benchmarks share this
 * function identically rather than each holding a behaviourally-equal copy. test-ring-hearing
 * asserts the identity, which is what keeps "the domains share Eq. (3)" a structural fact
 * rather than a claim about two pieces of source that currently look alike.
 */
export const standing = (refutations, delta) => Math.max(0, 1 - delta * (refutations || 0))

/**
 * Bind the solver to one domain. Returns the same function surface hearing-core.mjs has
 * always exported, so a domain's binding module is a re-export and nothing downstream moves.
 */
export function makeHearing(adapter) {
  const {
    CAST, key, fmt: fmtDefault, Uself: adapterUself,
    ATOM_KEYS, ATOM_W, atomsOf, DRIFT_W, claimKey, blameOf = null,
  } = adapter

  const DRIFT_NORM = Object.values(DRIFT_W).reduce((a, b) => a + b, 0)

  /** deterministic argmax: ties broken by the domain's key, never by array order */
  const argmaxBy = (arr, f) =>
    arr.slice().sort((a, b) => (f(b) - f(a)) || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))[0]

  /**
   * The same ordering argmaxBy uses, keeping the whole ranking instead of the winner. Used
   * only when explaining: the deliberation a witness goes through is computed on every move
   * and then thrown away, and this is what keeps it. `rankBy(...)[0].rec` is argmaxBy's answer
   * by construction — same comparator, same tie-break.
   */
  const rankBy = (arr, f) => arr
    .map(rec => ({ rec, score: f(rec) }))
    .sort((a, b) => (b.score - a.score) || (key(a.rec) < key(b.rec) ? -1 : key(a.rec) > key(b.rec) ? 1 : 0))

  const profileKey = (p) => CAST.map(T => key(p[T])).join(' || ')

  // -------------------------------------------------------------- corroboration
  // An asserted account decomposes into atoms. Two accounts can agree on the central
  // attribution and still contradict each other on circumstance, so agreement is measured
  // atom by atom rather than account by account.
  function credibility(T, profile, atomW = ATOM_W) {
    const mine = atomsOf(profile[T])
    const norm = atomW.reduce((a, b) => a + b, 0)
    let corr = 0, contra = 0
    for (const j of CAST) {
      if (j === T) continue
      const theirs = atomsOf(profile[j])
      ATOM_KEYS.forEach((k, i) => { if (mine[k] === theirs[k]) corr += atomW[i] / norm; else contra += atomW[i] / norm })
    }
    return (1 + corr) / (1 + corr + contra)
  }

  // -------------------------------------------------------------- self-consistency
  // Drift is taken against the witness's OWN OPENING, not their previous version. Measuring
  // from the opening closes the salami-slicing loophole: five one-atom revisions cannot reach
  // a total reversal more cheaply than one honest reversal. Charged only over atoms the
  // witness actually asserted — coordinates the objective cannot read were never claimed, so
  // charging drift against them would punish a witness for a detail they never gave.
  function drift(now, opening) {
    if (!opening) return 0
    const a = atomsOf(now), b = atomsOf(opening)
    let d = 0
    for (const k of Object.keys(DRIFT_W)) if (a[k] !== b[k]) d += DRIFT_W[k]
    return d / DRIFT_NORM
  }

  const selfConsistency = (now, opening, gamma) => Math.max(0, 1 - gamma * drift(now, opening))

  // -------------------------------------------------------------- the objective
  function makePayoff({ beta = 0.5, gamma = 0, delta = 0, w = [1, 1, 1], atomW = ATOM_W, fmt = fmtDefault } = {}) {
    const Uself = (T, rec, weights = w) => adapterUself(T, rec, weights)
    const payoff = (T, profile, state = {}) => {
      const self = Uself(T, profile[T])
      if (beta === 0) return self                       // exact, not approximate, degeneration
      const c = credibility(T, profile, atomW)
      const sc = gamma === 0 ? 1 : selfConsistency(profile[T], state.opening?.[T], gamma)
      const st = delta === 0 ? 1 : standing(state.refutations?.[T], delta)
      return (1 - beta) * self + beta * c * sc * st
    }
    /** the same number, itemised */
    const components = (T, profile, state = {}) => {
      const uSelf = Uself(T, profile[T])
      const cred = beta === 0 ? 1 : credibility(T, profile, atomW)
      const selfCons = gamma === 0 ? 1 : selfConsistency(profile[T], state.opening?.[T], gamma)
      const st = delta === 0 ? 1 : standing(state.refutations?.[T], delta)
      return { uSelf, cred, selfCons, standing: st, total: payoff(T, profile, state) }
    }
    return { payoff, components, Uself, beta, gamma, delta, w, atomW, fmt }
  }

  /**
   * What a witness weighed, and what it cost them. Recording only — `explain` never changes a
   * decision, and with it off every transcript is byte-identical.
   */
  function deliberate({ T, ranked, profile, st, obj, deleted = [] }) {
    const at = (rec) => {
      const c = obj.components(T, { ...profile, [T]: rec }, st)
      return {
        sig: key(rec), label: obj.fmt(rec),
        uSelf: u100(c.uSelf), cred: u100(c.cred), selfCons: u100(c.selfCons),
        standing: u100(c.standing), total: u100(c.total),
      }
    }
    const top = ranked.slice(0, 3).map(x => at(x.rec))
    const gone = deleted.map(at).sort((a, b) => b.total - a.total)
    return {
      chosen: top[0] || null,
      alternatives: top.slice(1),
      deleted: gone,
      margin: top.length > 1 ? top[0].total - top[1].total : null,
      lostBest: gone.length ? gone[0] : null,
      beliefs: null,
    }
  }

  // -------------------------------------------------------------- the hearing
  const relations = (p, T) => ({
    corroborates: CAST.filter(j => j !== T && claimKey(p[j]) === claimKey(p[T])),
    contradicts: CAST.filter(j => j !== T && claimKey(p[j]) !== claimKey(p[T])),
  })

  /** opening statements: nobody has heard anybody, so each states their private optimum */
  function openHearing({ pool, obj, order = CAST }) {
    const { Uself, w, atomW, fmt } = obj
    const profile = {}, opening = {}, refutations = {}
    for (const T of CAST) { profile[T] = argmaxBy(pool, r => Uself(T, r, w)); refutations[T] = 0 }
    for (const T of CAST) opening[T] = profile[T]
    const moves = order.map(T => ({
      round: 0, speaker: T, act: 'open', from: null, to: key(profile[T]), toLabel: fmt(profile[T]),
      uSelf: u100(Uself(T, profile[T], w)), cred: u100(credibility(T, profile, atomW)),
      drift: 0, selfCons: 100, standing: 100, gain: null, ...relations(profile, T),
    }))
    return { profile, opening, refutations, moves, round: 0, terminal: { kind: 'open', round: null, period: null } }
  }

  /** Run rounds of public revision until nobody moves (settled) or the record repeats (cycle). */
  function continueHearing(state, { pool, obj, order = CAST, rounds = 24, explain = false }) {
    const { payoff, Uself, gamma, delta, w, atomW, fmt } = obj
    const profile = { ...state.profile }
    const moves = [...state.moves]
    const st = { opening: state.opening, refutations: state.refutations }
    let terminal = { kind: 'open', round: null, period: null }
    const roundKeys = new Map([[profileKey(profile), state.round]])

    for (let n = 1; n <= rounds; n++) {
      const round = state.round + n
      let revised = 0
      for (const T of order) {
        const before = profile[T]
        const uBefore = payoff(T, profile, st)
        const score = (r) => payoff(T, { ...profile, [T]: r }, st)
        const ranked = explain ? rankBy(pool, score) : null
        const best = explain ? ranked[0].rec : argmaxBy(pool, score)
        const uAfter = payoff(T, { ...profile, [T]: best }, st)
        const changed = key(best) !== key(before)
        if (changed) { profile[T] = best; revised++ }
        moves.push({
          round, speaker: T, act: changed ? 'revise' : 'stand',
          from: changed ? key(before) : null, fromLabel: changed ? fmt(before) : null,
          to: key(profile[T]), toLabel: fmt(profile[T]),
          uSelf: u100(Uself(T, profile[T], w)), cred: u100(credibility(T, profile, atomW)),
          drift: u100(drift(profile[T], st.opening[T])),
          selfCons: u100(selfConsistency(profile[T], st.opening[T], gamma)),
          standing: u100(standing(st.refutations[T], delta)),
          gain: changed ? u100(uAfter - uBefore) : 0,
          gainSelf: changed ? u100(Uself(T, best, w) - Uself(T, before, w)) : 0,
          gainCred: changed ? u100(credibility(T, profile, atomW) - credibility(T, { ...profile, [T]: before }, atomW)) : 0,
          ...(explain ? { deliberation: deliberate({ T, ranked, profile, st, obj }) } : {}),
          ...relations(profile, T),
        })
      }
      if (revised === 0) { terminal = { kind: 'settled', round, period: 1 }; break }
      const rk = profileKey(profile)
      if (roundKeys.has(rk)) { terminal = { kind: 'cycle', round, period: round - roundKeys.get(rk) }; break }
      roundKeys.set(rk, round)
    }
    const lastRound = moves.length ? moves[moves.length - 1].round : state.round
    return { ...state, profile, moves, round: lastRound, terminal }
  }

  /**
   * A fact is established. Any witness whose standing account is no longer in the feasible set
   * has been CAUGHT OUT: their refutation count rises (permanently — standing cannot be
   * repaired by speaking again) and they move to their best still-feasible account.
   */
  function applyEvidence(state, { pool, obj, fact = null, order = CAST, explain = false, prevPool = null }) {
    const { payoff, Uself, w, atomW, fmt } = obj
    const feasible = new Set(pool.map(r => key(r)))
    const caught = CAST.filter(T => !feasible.has(key(state.profile[T])))
    const refutations = { ...state.refutations }
    const profile = { ...state.profile }
    const moves = [...state.moves]
    const round = state.round + 1

    for (const T of caught) refutations[T] = (refutations[T] || 0) + 1
    const st = { opening: state.opening, refutations }

    // Openings are what a witness is held to. If the opening itself has been refuted it cannot
    // go on serving as the yardstick for drift, so it is re-based to what they are forced to
    // say — a witness cannot be punished for straying from a story the evidence destroyed.
    const opening = { ...state.opening }

    for (const T of order) {
      if (!caught.includes(T)) continue
      const before = profile[T]
      const score = (r) => payoff(T, { ...profile, [T]: r }, st)
      const ranked = explain ? rankBy(pool, score) : null
      const best = explain ? ranked[0].rec : argmaxBy(pool, score)
      profile[T] = best
      if (!feasible.has(key(opening[T]))) opening[T] = best
      moves.push({
        round, speaker: T, act: 'refuted', fact,
        from: key(before), fromLabel: fmt(before), to: key(best), toLabel: fmt(best),
        uSelf: u100(Uself(T, best, w)), cred: u100(credibility(T, profile, atomW)),
        drift: u100(drift(best, opening[T])), standing: u100(standing(refutations[T], obj.delta)),
        refutations: refutations[T], gain: null,
        ...(explain ? {
          deliberation: deliberate({
            T, ranked, profile, st, obj,
            deleted: prevPool ? prevPool.filter(r => !feasible.has(key(r))) : [],
          }),
        } : {}),
        ...relations(profile, T),
      })
    }
    return { ...state, profile, opening, refutations, moves, round, caught,
      terminal: caught.length ? { kind: 'open', round: null, period: null } : state.terminal }
  }

  /** convenience: a whole hearing from scratch on a fixed pool */
  const runHearing = ({ pool, obj, order = CAST, rounds = 24, explain = false }) =>
    continueHearing(openHearing({ pool, obj, order }), { pool, obj, order, rounds, explain })

  // -------------------------------------------------------------- audit
  /**
   * One world fits all three accounts only if they assert the same coarse claim. What "coarse"
   * means is the domain's to say: in the grove a single death has one (actor, type, weapon);
   * in the Franceschini case a single history has one value per contested coordinate.
   */
  function jointAudit(profile) {
    const claims = CAST.map(T => claimKey(profile[T]))
    const distinct = new Set(claims)
    const jointlySat = distinct.size === 1
    const out = {
      claims, distinctClaims: distinct.size, jointlySat,
      atMostTrue: jointlySat ? 3 : 1,
      provenLies: jointlySat ? 0 : CAST.length - 1,
      indivFeasible: CAST.every(T => profile[T].feasible !== false),
    }
    if (blameOf) {
      const accused = new Set(CAST.map(T => blameOf(profile[T])))
      out.blame = CAST.map(T => ({ from: T, to: blameOf(profile[T]) }))
      out.unaccused = CAST.filter(a => !accused.has(a))
    }
    return out
  }

  return {
    CAST, u100, argmaxBy, rankBy, claimKey, profileKey,
    ATOM_KEYS, ATOM_W, atoms: atomsOf, credibility,
    DRIFT_W, driftAtoms: atomsOf, drift, selfConsistency, standing,
    makePayoff, openHearing, continueHearing, applyEvidence, runHearing, jointAudit,
  }
}
