// THE OBJECTIVE — U_i and nothing else. The Franceschini counterpart of grove-objective.mjs,
// built to the SAME specification so that the only thing differing between the two
// experiments is the story.
//
// The specification, taken from grove-objective.mjs and held fixed:
//   * six structural features, each a fixed rule into [0,1], read off a replayed causal
//     signature — never off a natural-language description;
//   * every feature is TELLER-RELATIVE, the way the grove's `honor` has one branch for the
//     victim and another for the agent: score_d(T, τ) asks what the history is worth to T;
//   * every feature is SELF-REGARDING. It scores how the history bears on the teller's own
//     standing and reads nothing about anyone else's welfare;
//   * each witness averages a fixed triple of them, equally weighted;
//   * no plot content in any feature name. "Adultery", "elopement", "honour-killing" appear
//     nowhere below. If one of them wins, it wins as an emergent property of generic scores;
//   * no language model, no state, no enumeration.
//
// An earlier draft of this file broke the third clause: it gave Pompilia an other-regarding
// dimension built out of Caponsacchi's features, on the grounds that Book VII is largely a
// defence of him. That is a true reading of the poem and the wrong thing to put in this
// experiment. It made her utility contain his, so the two of them corroborated each other by
// construction, and the resulting 2/3 spread was a property of the machinery rather than of
// the case. Holding the method fixed is what licenses the comparison with the grove; a
// finding that only appears when the objective changes shape is not a finding about the
// second domain. The other-regarding variant now lives in ring-extensions.mjs, where it is
// labelled as a departure and reported separately.
//
// WHAT IS GENUINELY DIFFERENT HERE, and it is the domain's doing rather than the method's:
// Guido concedes the killing in Book V and again in Book XI. So `innocence` — the exculpation
// dimension that drives the bandit's entire problem in the grove — is a constant for him. He
// cannot buy anything by denying the deed, and the three dimensions he is judged on are
// therefore all about what the deed WAS. That is the point of choosing this case.

// ---- the six structural features ----
/**
 * score_d(T, g) for all six d, computed from teller T and causal signature g.
 * Each is a fixed rule into [0,1].
 */
export function features(T, g) {
  const isGuido = T === 'Guido', isPom = T === 'Pompilia', isCap = T === 'Caponsacchi'

  // --- warrant: was the teller's decisive act licensed by the rule that governs it? ---
  // Guido's decisive act is the killing, and the rule is the husband's privilege: worth
  // everything if taken in the moment, worth least once he has himself gone to law. Pompilia's
  // decisive act is the flight, licensed if she fled a house that was making an end of her.
  // Caponsacchi's is carrying her off, licensed for a priest by the life he was saving and
  // forfeit if he took anything for himself on the way.
  let warrant
  if (isGuido) warrant = g.basis === 'honor' ? 1 : g.basis === 'revenge' ? (g.sued ? 0.1 : 0.3) : 0.5
  else if (isPom) warrant = g.peril ? (g.consummated ? 0.5 : 1) : 0.3
  else warrant = g.consummated ? 0.15 : (g.peril ? 1 : 0.5)

  // --- provocation: the gravity of the wrong done TO the teller ---
  let provocation
  if (isGuido) provocation = clamp(
    (g.consummated ? 0.3 : 0) + (g.sire === 'Caponsacchi' ? 0.3 : 0) +
    (g.letters === 'Pompilia' ? 0.2 : 0) + (g.initiator !== 'Guido' && g.initiator !== 'none' ? 0.2 : 0) -
    (g.peril ? 0.25 : 0))
  else if (isPom) provocation = clamp(
    (g.peril ? 0.5 : 0) + (g.basis === 'revenge' ? 0.3 : 0) + (g.initiator === 'Guido' ? 0.2 : 0))
  else provocation = clamp(
    (g.consummated ? 0 : 0.5) + (g.initiator === 'Guido' ? 0.3 : 0) + (g.peril ? 0.2 : 0))

  // --- bearing: the dignity of the teller's own conduct ---
  let bearing
  if (isGuido) bearing = Math.max(0.1, (g.alone ? 0.5 : 0) + (g.usedName ? 0 : 0.5))
  else if (isPom) bearing = clamp((g.consummated ? 0 : 0.6) + (g.letters === 'Pompilia' ? 0 : 0.4))
  else bearing = clamp((g.consummated ? 0 : 0.6) + (g.initiator === 'Caponsacchi' ? 0 : 0.4))

  // --- innocence: freedom from the charge actually laid against the teller ---
  // Guido's is murder and he concedes it, so his is a constant. Stated rather than hidden:
  // the dimension is dead for him, and that is the domain's central fact.
  let innocence
  if (isGuido) innocence = 0.1
  else if (isPom) innocence = clamp(
    (g.consummated ? 0 : 0.5) + (g.letters === 'Pompilia' ? 0 : 0.3) + (g.sire === 'Guido' ? 0.2 : 0))
  else innocence = clamp(
    (g.consummated ? 0 : 0.5) + (g.letters === 'Caponsacchi' ? 0 : 0.3) + (g.initiator === 'Caponsacchi' ? 0 : 0.2))

  // --- purity: was the teller's motive disinterested? ---
  // Caponsacchi's turns on WHO set the flight going, and this is the coordinate on which he
  // and Pompilia part company. A priest who answered a woman's cry acted at his best; one who
  // was drawn into a husband's trap was merely gulled; one who enticed her acted at his worst.
  // Her interest runs the other way — a plot laid by her husband makes her its victim — so the
  // two of them want different origins for the same flight, each for their own sake.
  let purity
  if (isGuido) purity = g.basis === 'honor' ? 1 : 0.2
  else if (isPom) purity = g.consummated ? 0.05 : (g.peril ? 1 : 0.6)
  else purity = g.consummated ? 0.05
    : g.initiator === 'Pompilia' ? 1
    : g.initiator === 'Guido' ? 0.7
    : g.initiator === 'Caponsacchi' ? 0.4 : 0.6

  // --- efficacy: did the teller's decisive act achieve its end? ---
  let efficacy
  if (isGuido) efficacy = g.basis === 'none' ? 0.15 : 1
  else if (isPom) efficacy = g.reachedRome ? 1 : 0.15
  else efficacy = g.reachedRome ? 1 : 0.15

  return { warrant, provocation, bearing, innocence, purity, efficacy }
}

const clamp = (x) => Math.min(1, Math.max(0, x))

/** which three of those six each witness is actually judged on */
export const dimsOf = {
  Guido:       (x) => [x.warrant, x.provocation, x.bearing],      // licence, injury, manner
  Pompilia:    (x) => [x.innocence, x.provocation, x.purity],     // the charge, the injury, the motive
  Caponsacchi: (x) => [x.purity, x.efficacy, x.innocence],        // the motive, the outcome, the charge
}

// The same triples by name. Kept alongside `dimsOf` rather than recovered from it by
// reflection: two dimensions can hold equal values on a given history, so matching values
// back to names is ambiguous exactly when it matters.
export const DIM_NAMES = {
  Guido: ['warrant', 'provocation', 'bearing'],
  Pompilia: ['innocence', 'provocation', 'purity'],
  Caponsacchi: ['purity', 'efficacy', 'innocence'],
}

export const CAST = ['Guido', 'Pompilia', 'Caponsacchi']

/** U_i under an explicit weighting of that witness's three dimensions */
export const Uw = (T, x, w) => {
  const d = dimsOf[T](x)
  return (w[0] * d[0] + w[1] * d[1] + w[2] * d[2]) / (w[0] + w[1] + w[2])
}

/** U_i at equal weights — the published objective */
export const U = Object.fromEntries(CAST.map(T => [T, (x) => Uw(T, x, [1, 1, 1])]))

// ---- display only, never used in a comparison ----
export const label = (g) => {
  const act = g.basis === 'honor' ? 'killed in the moment, by the husband’s right'
    : g.basis === 'revenge' ? `killed at the villa${g.sued ? ', the suit already brought' : ''}`
    : 'no killing'
  return `${g.initiator} began it; ${g.consummated ? 'they lay together' : 'chaste'}; ` +
    `letters in ${g.letters}'s hand; the child is ${g.sire}'s; ${g.peril ? 'cruelty at Arezzo' : 'no cruelty'}; ${act}`
}

/** the short form, for tables. Must show every coordinate some score reads. */
export const brief = (g) => {
  const a = g.basis === 'honor' ? 'honour-killing' : g.basis === 'revenge' ? (g.sued ? 'revenge after suit' : 'revenge') : '—'
  return `${String(g.initiator).padEnd(11)} began it / ${g.consummated ? 'lay together' : 'chaste     '} / ` +
    `${(g.letters === 'none' ? 'no letters' : g.letters + "'s hand").padEnd(16)} / child ${String(g.sire).padEnd(11)} / ` +
    `${g.peril ? 'cruelty   ' : 'no cruelty'} / ${a}`
}

/**
 * The disputed facts a reader of the transcripts would tabulate — the Franceschini
 * counterpart of the paper's Table 2. Each is a question the three accounts answer, and the
 * point of the table is that they cannot all be answered at once.
 */
export const DISPUTED = [
  { q: 'what passed at the inn', read: (g) => g.consummated ? 'they lay together' : 'nothing passed' },
  { q: 'whose hand held the pen', read: (g) => g.letters === 'none' ? 'no letters' : `${g.letters}'s` },
  { q: 'who set the flight going', read: (g) => g.initiator },
  { q: 'the usage at Arezzo', read: (g) => g.peril ? 'she was driven to fly' : 'she wanted for nothing' },
  { q: "Pompilia's role", read: (g) => g.consummated ? 'an adulteress' : g.peril ? 'a wife in fear of her life' : 'a wife who ran' },
  { q: "Caponsacchi's role", read: (g) => g.consummated ? 'her lover' : g.initiator === 'Caponsacchi' ? 'he carried her off' : 'he answered a call' },
]
