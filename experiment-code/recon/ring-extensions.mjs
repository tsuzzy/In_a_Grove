#!/usr/bin/env node
// DEPARTURES FROM THE GROVE METHOD — reported separately, and separately labelled.
//
// ring-optimize.mjs is a strict mirror of recon/optimize.mjs: three witnesses, six structural
// features, self-regarding U_i, argmax over one enumerated Feasible(F). Holding all of that
// fixed is what licenses the claim that the framework travels to a second domain, because it
// leaves the story as the only thing that changed.
//
// Everything in THIS file changes the method as well. None of it belongs in that comparison,
// and all of it is worth having, so it lives here where it cannot be mistaken for the mirror:
//
//   (A) SPECTATORS — Books II–IV. Half-Rome, the Other Half-Rome and Tertium Quid were at
//       none of it and are charged with nothing. Their objective is alignment with an
//       AUDIENCE rather than self-portrayal, which the grove has no witness for. Tertium
//       Quid's is additionally non-monotone: he is paid for committing to neither side, so
//       his optimum is interior rather than at a vertex. Every other objective in this
//       project is a weighted sum of things one wants more of.
//
//   (B) AN OTHER-REGARDING UTILITY — the variant of Pompilia whose third dimension is built
//       out of CAPONSACCHI's features rather than her own. A true reading of Book VII, and it
//       changes the shape of U_i, so it cannot sit in the mirror.
//
//   (C) THE POPE — Book X. J = how much of the case an account survives, over every coherent
//       way of deciding whom to believe. No self-interest in it at all. This exercises the
//       paper's Section 3 claim (same Feasible(F), different J, different reasoning task),
//       but it is not part of the testimony experiment.
//
// The objectives are exported so the tests can reach them; the report runs only when this
// file is executed directly.
//
// Usage: node recon/ring-extensions.mjs      (no API key needed)

import { RECORD } from './ring-domain.mjs'
import { enumerate, popeScores } from './ring-core.mjs'
import { CAST, features, U, brief } from './ring-objective.mjs'

const EPS = 1e-12
const u100 = (x) => Math.round(100 * x)
const pct = (x) => `${(100 * x).toFixed(1)}%`
const argmaxBy = (arr, f) => arr.slice().sort((a, b) => (f(b) - f(a)) || (a.assertion < b.assertion ? -1 : 1))[0]

// ---------------------------------------------------------------- (A) spectator objectives
// `tilt` is the one quantity they read: how far a history carries the case for the husband
// (+1) or for the wife (−1). A signed weighted sum of the same coordinates the principals
// read, normalized by total weight, so it is directly comparable across accounts.
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
export const V = {
  HalfRome: (g) => (1 + tilt(g)) / 2,              // to the married men of Rome
  OtherHalfRome: (g) => (1 - tilt(g)) / 2,         // to the crowd that wept at her funeral
  TertiumQuid: (g) => 1 - Math.abs(tilt(g)),       // to his Excellency, over cards
}

// ---------------------------------------------------------------- (B) other-regarding U
/** she can speak to his motive and to his conduct, not to his efficacy — so those two */
export const shielding = (g) => {
  const c = features('Caponsacchi', g)
  return (c.purity + c.innocence) / 2
}
export const altPompilia = (g) => {
  const p = features('Pompilia', g)
  return (p.innocence + p.provocation + shielding(g)) / 3
}

// ---------------------------------------------------------------- report
const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  const space = enumerate()
  const FEAS = space.assertionsUnder(RECORD)
  const pick = (T) => argmaxBy(FEAS, (r) => U[T](features(T, r.g)))

  /**
   * Every feasible account attaining a given maximum. A witness who is indifferent between
   * two accounts has not chosen between them, so "does teller X say the same thing as witness
   * T" must be asked against this set, not against the single argmax — otherwise a string
   * tie-break decides whether two tellers are recorded as agreeing.
   */
  const maximizersOf = (f) => {
    const best = FEAS.reduce((m, r) => Math.max(m, f(r)), -Infinity)
    return FEAS.filter(r => f(r) > best - EPS)
  }
  const maxersFor = (T) => maximizersOf((r) => U[T](features(T, r.g)))
  const consistentWith = (assertion, T) => maxersFor(T).some(r => r.assertion === assertion)

  // ---- (A) ----
  console.log(`\n${'='.repeat(78)}`)
  console.log('(A) SPECTATORS — tellers with nothing at stake  [DEPARTURE: audience-aligned U]')
  console.log('='.repeat(78))
  const spicks = {}
  for (const S of SPECTATORS) {
    spicks[S] = argmaxBy(FEAS, (r) => V[S](r.g))
    console.log(`\n  ${S.padEnd(14)} V=${u100(V[S](spicks[S].g))}  tilt=${tilt(spicks[S].g).toFixed(2)}`)
    console.log(`    ${brief(spicks[S].g)}`)
  }
  console.log(`\n  Matched against what each principal actually ASSERTS — i.e. against every account`)
  console.log(`  attaining their maximum, not against one argmax picked by string order:`)
  for (const S of SPECTATORS) {
    const hits = CAST.filter(T => consistentWith(spicks[S].assertion, T))
    console.log(`    ${S.padEnd(14)} ${hits.length ? `consistent with ${hits.join(', ')}` : 'consistent with no principal — a position of its own'}`)
  }
  console.log(`\n  Two of the three spectators land on an account some principal would also have been`)
  console.log(`  content with, and neither of those two is in the case: no stake, no charge, no`)
  console.log(`  presence at any of it. So whatever produces the spread, it is not self-portrayal.`)
  console.log(`\n  the record is ASYMMETRIC: the wife's advocate reaches tilt ${tilt(spicks.OtherHalfRome.g).toFixed(2)} (V=${u100(V.OtherHalfRome(spicks.OtherHalfRome.g))}), the`)
  console.log(`  husband's can do no better than ${tilt(spicks.HalfRome.g).toFixed(2)} (V=${u100(V.HalfRome(spicks.HalfRome.g))}) — three of the tilt's negative terms (he`)
  console.log(`  had sued, he brought hired men, he took the door by a false name) are supplied by the`)
  console.log(`  record itself and no feasible account can shed them. One side is left a perfect case`)
  console.log(`  to argue and the other a compromised one, before any teller opens his mouth.`)
  console.log(`\n  Tertium Quid's optimum is INTERIOR (tilt ${tilt(spicks.TertiumQuid.g).toFixed(2)}), not at a vertex, and it is a position`)
  console.log(`  no principal chose. His is the only non-monotone objective in the project.`)

  // ---- (B) ----
  console.log(`\n${'='.repeat(78)}`)
  console.log("(B) AN OTHER-REGARDING POMPILIA  [DEPARTURE: U_i contains another agent's U]")
  console.log('='.repeat(78))
  const altPick = argmaxBy(FEAS, (r) => altPompilia(r.g))
  const altMaxers = maximizersOf((r) => altPompilia(r.g))
  console.log(`\n  self-regarding  (the mirror) : ${brief(pick('Pompilia').g)}`)
  console.log(`  other-regarding (this file)  : ${brief(altPick.g)}`)
  console.log(`  Caponsacchi's own optimum    : ${brief(pick('Caponsacchi').g)}`)

  const COORD = ['initiator', 'letters', 'consummated', 'peril']
  const committed = (maxers, c) => { const v = new Set(maxers.map(r => String(r.g[c]))); return v.size === 1 ? [...v][0] : null }
  console.log(`\n  coordinate     self-regarding   other-regarding   Caponsacchi   effect`)
  for (const c of COORD) {
    const a = committed(maxersFor('Pompilia'), c), b = committed(altMaxers, c), k = committed(maxersFor('Caponsacchi'), c)
    const moved = String(a) !== String(b)
    const agreesNow = b !== null && k !== null && b === k
    const agreedBefore = a !== null && k !== null && a === k
    console.log(`  ${c.padEnd(13)}  ${String(a ?? '—').padEnd(16)} ${String(b ?? '—').padEnd(17)} ${String(k ?? '—').padEnd(13)} ` +
      `${!moved ? 'unchanged' : agreesNow && !agreedBefore ? '→ now agrees with him' : 'moved'}`)
  }
  console.log(`\n  The other-regarding term buys PARTIAL corroboration, not agreement. It stops her`)
  console.log(`  naming the priest's hand for the letters — under the self-regarding utility all she`)
  console.log(`  requires is that the hand not be HERS, so the tie fell on his by sorting alone — but`)
  console.log(`  the two still part company on who set the flight going, and no amount of shielding`)
  console.log(`  closes that. Her claim there is driven by her own injury (a husband who laid the trap`)
  console.log(`  makes her its victim); his by his own motive (a priest who answered a woman's cry`)
  console.log(`  acted at his best). Both are self-regarding, they point at different people, and that`)
  console.log(`  single coordinate is what keeps the spread at 3/3.`)
  console.log(`\n  This is why the variant cannot sit in the mirror: it changes the SHAPE of U_i, so any`)
  console.log(`  difference it produced would be a fact about the machinery rather than about the case.`)

  // ---- (C) ----
  console.log(`\n${'='.repeat(78)}`)
  console.log('(C) THE POPE, Book X  [DEPARTURE: J with no self-interest in it]')
  console.log('='.repeat(78))
  const pope = popeScores(space, { base: RECORD })
  const flat = popeScores(space, { base: RECORD, weighted: false })
  const OPEN = ['initiator', 'letters', 'consummated', 'peril']
  console.log(`\n  Coherent readings of the case: ${pope.readings}; every one leaves some account standing.`)
  console.log(`\n  coordinate     attested prior                                    flat prior`)
  for (const c of OPEN) {
    const m = pope.marginal(FEAS, c), fm = flat.marginal(FEAS, c)
    const fmt = (mm) => mm.map(x => `${x.value} ${pct(x.mass)}`).join(' · ')
    const decided = m[0].mass - m[1].mass > 0.02
    console.log(`  ${c.padEnd(13)}  ${fmt(m).padEnd(49)} ${fmt(fm).padEnd(49)} ${decided ? '← decided' : '(open)'}`)
  }
  const dec = (p) => OPEN.filter(c => { const m = p.marginal(FEAS, c); return m[0].mass - m[1].mass > 0.02 })
  console.log(`\n  flat prior decides ${dec(flat).length}/4 open coordinates; attested prior ${dec(pope).length}/4: ${dec(pope).join(', ')}.`)
  console.log(`  Report the MARGINALS, not the argmax: under a flat prior three of the four are exactly`)
  console.log(`  symmetric, so an argmax there is a string tie-break wearing a verdict's clothes.`)
  console.log(`  'initiator' stays undecided and that is not a failure — all three versions of it are`)
  console.log(`  asserted by exactly one party each, every one the party it suits, with no corroboration.`)
  console.log(`\n  each witness's own account, by how much of the case it survives`)
  console.log(`  (best over the accounts attaining their maximum — they are indifferent among those):`)
  for (const T of CAST) {
    const n = maxersFor(T).length
    const s = maxersFor(T).reduce((m, r) => Math.max(m, pope.score(r.assertion)), 0)
    console.log(`    ${T.padEnd(12)} ${pct(s).padStart(6)}   (${n} tied account${n > 1 ? 's' : ''})`)
  }
  console.log()
}
