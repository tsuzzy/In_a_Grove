// THE SPECTATOR OBJECTIVES — Books II–IV, and the other-regarding variant of Book VII.
//
// These are DEPARTURES from the grove method and are not part of ring-optimize.mjs. They live
// in their own module because two consumers need them — the ring-extensions report and the
// browser bundle — and a copy in each is how a project ends up with two implementations that
// disagree.
//
// What makes them departures: the three spectators optimize alignment with an AUDIENCE rather
// than self-portrayal, and Tertium Quid's objective is additionally non-monotone — he is paid
// for committing to neither side, so his optimum is interior rather than at a vertex. The
// grove has no witness of either kind.
//
// NO LLM.

import { features } from './ring-objective.mjs'

// `tilt` is the one quantity the spectators read: how far a history carries the case for the
// husband (+1) or for the wife (−1). A signed weighted sum of the same coordinates the
// principals read, normalized by total weight, so it is comparable across accounts.
const TILT_TERMS = [
  { w: 0.22, f: (g) => (g.consummated ? +1 : -1) },
  { w: 0.18, f: (g) => (g.sire === 'Caponsacchi' ? +1 : g.sire === 'Guido' ? -1 : 0) },
  { w: 0.16, f: (g) => (g.letters === 'Pompilia' ? +1 : g.letters === 'Guido' ? -1 : 0) },
  { w: 0.14, f: (g) => (g.initiator === 'Guido' ? -1 : g.initiator === 'none' ? 0 : +1) },
  { w: 0.12, f: (g) => (g.basis === 'honor' ? +1 : g.basis === 'revenge' ? -1 : 0) },
  { w: 0.10, f: (g) => (g.peril ? -1 : +1) },
  { w: 0.08, f: (g) => (g.usedName || !g.alone ? -1 : +1) },
]

export const tilt = (g) => {
  let num = 0, den = 0
  for (const t of TILT_TERMS) { num += t.w * t.f(g); den += t.w }
  return num / den
}

export const SPECTATORS = ['HalfRome', 'OtherHalfRome', 'TertiumQuid']

export const SPECTATOR_NOTE = {
  HalfRome: 'Book II — to the married men of Rome',
  OtherHalfRome: 'Book III — to the crowd that wept at her funeral',
  TertiumQuid: 'Book IV — to his Excellency, over cards',
}

export const V = {
  HalfRome: (g) => (1 + tilt(g)) / 2,
  OtherHalfRome: (g) => (1 - tilt(g)) / 2,
  TertiumQuid: (g) => 1 - Math.abs(tilt(g)),
}

// ---- the other-regarding variant of Pompilia (departure B) ----
/** she can speak to his motive and to his conduct, not to his efficacy — so those two */
export const shielding = (g) => {
  const c = features('Caponsacchi', g)
  return (c.purity + c.innocence) / 2
}

export const altPompilia = (g) => {
  const p = features('Pompilia', g)
  return (p.innocence + p.provocation + shielding(g)) / 3
}
