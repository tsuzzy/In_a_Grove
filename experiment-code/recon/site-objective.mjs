// THE OBJECTIVE for the third domain — same specification as the other two:
// six generic self-presentation features, each a fixed rule from the causal signature into
// [0,1]; each party is judged on a fixed triple of them, equally weighted, scaled to [0,100].
// No feature names negligence or a breach; if such an account wins, it wins as an emergent
// property of generic scores. NO LLM: pure functions of a causal signature.

export function features(T, g) {
  const isDecisive = g.actor === T
  const madeHazard = g.railRemovedBy === T
  const isVictim = g.victim === T
  const didCheck = g.inspectedBy === T
  const signedOff = g.tagSignedBy === T
  const issuedGear = g.harnessIssuedBy === T

  // was the decisive act yours
  const agency = isDecisive ? 1 : 0.15
  // did you perform the checks that were yours to perform (inspect + sign + issue, cumulative)
  const diligence = Math.min(1, 0.15 + 0.35 * (didCheck ? 1 : 0)
                                      + 0.3 * (signedOff ? 1 : 0)
                                      + 0.3 * (issuedGear ? 1 : 0))
  // did you create the hazard
  const cleanHands = madeHazard ? 0.15 : (isDecisive && g.cause === 'jostle' ? 0.3 : 1)
  // were you the one harmed
  const sympathy = isVictim ? 0.8 : (isDecisive ? 0.35 : 0.6)
  // were you acting within your role
  const standing = (T === 'Worker')
    ? (isVictim ? 0.7 : 0.3)
    : (signedOff || didCheck ? 1 : 0.4)
  // were you exposed to a risk somebody else made
  const wronged = isVictim ? (madeHazard ? 0.3 : (g.railInPlace ? 0.5 : 0.8)) : 0.3
  return { agency, diligence, cleanHands, sympathy, standing, wronged }
}

/** Which three dimensions each party is actually judged on — three distinct triples.
 *
 * Extra labourers, when the domain is scaled past three parties for the enumeration study,
 * are judged like the worker they stand beside: they are on the deck, not in charge of it.
 * Their triple is fixed by the same rule, so scaling adds people without adding hand-set
 * choices — which is the point of scaling this way rather than inventing new roles.
 */
const TRIPLE = {
  Foreman: (x) => [x.diligence, x.standing, x.cleanHands],   // diligence, standing, exculpation
  Erector: (x) => [x.cleanHands, x.diligence, x.agency],     // exculpation, diligence, agency
  Worker:  (x) => [x.sympathy, x.wronged, x.agency],         // sympathy, being wronged, agency
}
export const dimsOf = new Proxy(TRIPLE, {
  get: (t, k) => t[k] || t.Worker,
  has: () => true,
})
export const Uw = (T, x, w) => { const d = dimsOf[T](x); return (w[0]*d[0] + w[1]*d[1] + w[2]*d[2]) / (w[0]+w[1]+w[2]) }
export const U = new Proxy({}, {
  get: (_, T) => (x) => Uw(T, x, [1, 1, 1]),
  has: () => true,
})
export const label = (g) =>
  `${g.victim} fell — ${g.cause === 'own_fall' ? 'his own doing' : g.cause} by ${g.actor}` +
  ` (rail ${g.railInPlace ? 'up' : 'off' + (g.railRemovedBy ? ' by ' + g.railRemovedBy : '')}` +
  `${g.harnessWorn === undefined ? '' : ', harness ' + (g.harnessWorn ? 'worn' : 'unused')}` +
  `, tag by ${g.tagSignedBy ?? 'nobody'}` +
  `, checked by ${g.inspectedBy ?? 'nobody'})`
