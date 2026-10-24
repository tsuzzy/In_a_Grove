// THE OBJECTIVE — U_i and nothing else.
//
// Lifted verbatim out of grove-core.mjs, which was doing two unrelated jobs: enumerating the
// candidate space (at import time, hard-wired to one evidence set) and defining how an
// account flatters its teller. Every consumer that wants only the second job had to drag the
// first one along, and the browser cannot afford that. grove-core.mjs re-exports everything
// here, so nothing downstream changes.
//
// This half is FROZEN in a stronger sense than the rest of the project: it is the paper's
// published objective. The coupling layer built on top of it — corroboration, self-consistency,
// standing — lives in the hearing solver and never touches these functions.
//
// NO LLM, no state, no enumeration: pure functions of a causal signature.

// ---- generic self-presentation features ----
// They name decisive-vs-passive, dignified-vs-helpless, clean-hands-vs-killer — never
// "duel" or "suicide". The manner, if it wins, is emergent.
export function features(T, an) {
  const f = an.fatal
  const isFatalActor = f.actor === T
  const isKiller = f.type === 'strike' && f.actor === T
  const selfWilled = f.type === 'self_strike' && T === 'Takehiro'
  const contested = f.type === 'impale_on_held'
  const victimT = T === 'Takehiro'
  const cleanHands = !(f.type === 'strike' && f.actor === T) ? 1 : 0.15
  // Agency is about the fatal act, nothing else. An earlier version credited whoever cut
  // the rope with 0.55 — four tenths of what striking the fatal blow is worth — for freeing
  // a bound man. That is out of proportion, and it had two bad consequences: U stopped being
  // a function of the causal signature (16 of 22 signatures had a U that depended on which
  // representative history was stored), and Tajomaru could buy back his unconstrained ideal
  // inside the feasible set purely by claiming he cut the rope, which made the "cost of
  // honesty" vanish. The rope-cutter is not part of how an account flatters its teller.
  const agency = isFatalActor ? 1 : 0.15
  let honor
  if (victimT) honor = selfWilled ? 1 : contested ? 0.6 : (f.boundAtDeath ? 0.05 : (f.victimArmed ? 0.5 : 0.3))
  else honor = isKiller ? (f.victimArmed && f.weapon === 'longsword' ? 1 : f.boundAtDeath ? 0.1 : 0.3) : 0.6
  const sympathy = isKiller ? 0.35 : (victimT ? 0.7 : 0.8)
  const dignity = 0.4 + 0.4 * agency
  const wronged = victimT ? (f.type === 'strike' ? 0.8 : selfWilled ? 0.4 : 0.6) : 0.3
  return { agency, honor, cleanHands, sympathy, dignity, wronged }
}

/** which three of those dimensions each witness is actually judged on */
export const dimsOf = {
  Tajomaru: (x) => [x.honor, x.agency, x.cleanHands],     // stature, agency, exculpation
  Masago:   (x) => [x.sympathy, x.dignity, x.cleanHands], // sympathy, dignity, exculpation
  Takehiro: (x) => [x.honor, x.agency, x.wronged],        // honor, agency, wronged
}

/** U_i under an explicit weighting of that witness's three dimensions */
export const Uw = (T, x, w) => { const d = dimsOf[T](x); return (w[0] * d[0] + w[1] * d[1] + w[2] * d[2]) / (w[0] + w[1] + w[2]) }

/** U_i at equal weights — the published objective */
export const U = {
  Tajomaru: (x) => Uw('Tajomaru', x, [1, 1, 1]),
  Masago: (x) => Uw('Masago', x, [1, 1, 1]),
  Takehiro: (x) => Uw('Takehiro', x, [1, 1, 1]),
}

/** how an account reads in words; display only, never used in a comparison */
export const label = (an) => {
  const f = an.fatal, who = f.type === 'self_strike' ? 'Takehiro (self)' : f.actor
  const manner = f.type === 'self_strike' ? 'suicide' : f.type === 'impale_on_held' ? 'contested impaling'
    : f.weapon === 'longsword' ? (f.victimArmed ? 'sword duel' : 'sword killing') : 'dagger killing'
  return `${who} — ${manner} (${f.weapon}${f.boundAtDeath ? ', victim bound' : ''})`
}
