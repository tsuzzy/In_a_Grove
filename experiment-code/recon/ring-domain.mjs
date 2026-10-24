// THE FRANCESCHINI CASE — a second domain for the same framework.
// Robert Browning, *The Ring and the Book* (1868–69), out of the Old Yellow Book:
// the trial of Count Guido Franceschini, Rome, January–February 1698.
//
// WHY A SECOND DOMAIN, AND WHY THIS ONE.
//
// In a Grove is a whodunit: the identity of the killer is the free variable, the evidence is
// thin (one wound, one clean blade, one cut rope), and every witness claims the decisive act
// for or against themselves. The obvious second domain would be another whodunit, and it
// would test nothing — the same result in a new costume.
//
// The Franceschini case is the opposite case in three ways at once, which is the point:
//
//   1. THE DEED IS CONCEDED. Guido never denies the killing; he argues about what it *was*.
//      So no utility here can be bought by denying the act, and the exculpation dimension
//      that drives the bandit is dead on arrival. What remains in dispute is the ANTECEDENT
//      history — the letters, the flight, the inn, the child — and its legal classification.
//
//   2. THE RECORD IS THICK. The Old Yellow Book fixes a dozen facts the grove has no analogue
//      for: dates, sentences, a birth, four hired men, the name called at the door. If the
//      Rashomon spread is really an artifact of evidentiary poverty, it should collapse here.
//
//   3. THE CONSTRAINTS ARE PARTLY JURIDICAL, NOT PHYSICAL. The grove's simulator asks whether
//      a bound man can swing a sword. This one also asks whether a husband who has gone to
//      law may afterwards invoke the husband's right — a precondition in the *ius commune*,
//      not in physics, but every bit as mechanical, and it is the ground the historical trial
//      actually turned on.
//
// THE MOMENT — `in continenti`. The husband's privilege (ius mariti) required taking the pair
// in the act AND acting in that same moment: no interval, and above all no recourse to a
// judge, because a man who asks the court to avenge him has conceded that vengeance is the
// court's. Guido overtook them at the inn at Castelnuovo and DID NOT KILL. He sued instead.
// Eight months later he came to the villa with four hired men. That sequence is in the record
// and it is what closes the privilege — mechanically, the way the unbloodied longsword closes
// the duel. The simulator enforces it as a precondition; no moral judgment is anywhere in
// this file.
//
// NO LLM. Preconditions and effects only, replayed deterministically.

export const CAST = ['Guido', 'Pompilia', 'Caponsacchi', 'Pietro', 'Violante']

/** the parties whose account the framework will optimize */
export const PRINCIPALS = ['Guido', 'Pompilia', 'Caponsacchi']

export function initialState() {
  return {
    where: {
      Guido: 'arezzo', Pompilia: 'arezzo', Caponsacchi: 'arezzo',
      Pietro: 'rome', Violante: 'rome',
    },
    alive: { Guido: true, Pompilia: true, Caponsacchi: true, Pietro: true, Violante: true },
    // Pompilia is thirteen at the marriage and was never taught to write; whether she was
    // taught later is a HISTORY coordinate, not a world parameter, because it is exactly what
    // the parties dispute. Making it an operator is what lets the enumerator decide who
    // could possibly have written the letters.
    pompilia: { literate: false, mortallyWounded: false, testified: false },
    letters: { exist: false, author: null },
    flight: { begun: false, initiator: null, consummated: false, reachedRome: false },
    // Conception LOCATION, not just paternity: the child was born 18 December 1697 and the
    // flight was late April 1697. A child got at the inn is not born in December. The record's
    // date is therefore evidence about the antecedent history, and the strongest such fact
    // in the case.
    child: { conceivedAt: null, born: false },
    suit: { brought: false, judged: false, sentence: null, placed: false },
    guido: { overtook: false, momentOpen: false, men: 0, usedName: false, basis: null, taken: false },
    peril: false,     // cruelty at Arezzo — alleged by the wife, denied by the husband
    log: [],
  }
}

const err = (m) => ({ ok: false, reason: m })
const ok = () => ({ ok: true })

const at = (s, who, place) => s.where[who] === place
const pairTogether = (s, place) => at(s, 'Pompilia', place) && at(s, 'Caponsacchi', place)

// ---- action schema: preconditions + effects ----
export const ACTIONS = {

  // ---------------------------------------------------------------- Arezzo
  // The Comparini give the child to Guido for his title and he takes her for the dowry; both
  // sides then sue over the dowry. None of that is disputed, so none of it is an operator.
  // What IS disputed at Arezzo is these four:

  /** Guido's usage of his wife — alleged by Pompilia and the Comparini, denied by Guido */
  cruelty: {
    pre: (s) => at(s, 'Guido', 'arezzo') && at(s, 'Pompilia', 'arezzo')
      ? (s.peril ? err('already alleged') : ok())
      : err('both must be at Arezzo'),
    eff: (s) => { s.peril = true },
  },

  /** the convent taught her to sign her name; whether she could write more is the question */
  teach_letters: {
    pre: (s) => s.pompilia.literate ? err('she has her letters already')
      : at(s, 'Pompilia', 'arezzo') ? ok() : err('she is not at Arezzo to be taught'),
    eff: (s) => { s.pompilia.literate = true },
  },

  /**
   * The love-letters produced at the flight-trial. Three hands are possible and the domain
   * decides only who COULD have held the pen: Pompilia needs her letters first, which is why
   * `teach_letters` exists. A letter in Guido's hand signed with his wife's name is a forgery;
   * the domain does not say so, it just records the author and lets the objective read it.
   */
  write_letters: {
    pre: (s, a) => {
      if (s.letters.exist) return err('the letters are already written')
      if (!['Pompilia', 'Caponsacchi', 'Guido'].includes(a.actor)) return err(`${a.actor} writes no letters here`)
      if (a.actor === 'Pompilia' && !s.pompilia.literate) return err('Pompilia cannot write')
      if (!at(s, a.actor, 'arezzo')) return err(`${a.actor} is not at Arezzo`)
      return ok()
    },
    eff: (s, a) => { s.letters.exist = true; s.letters.author = a.actor },
  },

  /** the husband gets the child — the only conception the December birth allows */
  conceive_at_arezzo: {
    pre: (s) => s.child.conceivedAt ? err('already with child')
      : (at(s, 'Pompilia', 'arezzo') && at(s, 'Guido', 'arezzo')) ? ok() : err('both must be at Arezzo'),
    eff: (s) => { s.child.conceivedAt = 'arezzo' },
  },

  // ---------------------------------------------------------------- the flight
  // Who set it going is the first great disputed coordinate. Guido's version is an elopement;
  // Pompilia's is a woman in fear of her life sending for the one man who would come;
  // Caponsacchi's darkest suspicion — and Browning gives it weight — is that Guido baited the
  // trap himself, to manufacture the grounds he wanted.

  summon:   { pre: (s) => s.flight.initiator ? err('the flight is already set going') : at(s, 'Pompilia', 'arezzo') ? ok() : err('not at Arezzo'),   eff: (s) => { s.flight.initiator = 'Pompilia' } },
  entice:   { pre: (s) => s.flight.initiator ? err('the flight is already set going') : at(s, 'Caponsacchi', 'arezzo') ? ok() : err('not at Arezzo'), eff: (s) => { s.flight.initiator = 'Caponsacchi' } },
  contrive: { pre: (s) => s.flight.initiator ? err('the flight is already set going') : at(s, 'Guido', 'arezzo') ? ok() : err('not at Arezzo'),       eff: (s) => { s.flight.initiator = 'Guido' } },

  depart: {
    pre: (s) => {
      if (!s.flight.initiator) return err('nobody has set the flight going')
      if (s.flight.begun) return err('they have already gone')
      if (!pairTogether(s, 'arezzo')) return err('the pair are not both at Arezzo')
      return ok()
    },
    eff: (s) => { s.flight.begun = true; s.where.Pompilia = 'road'; s.where.Caponsacchi = 'road' },
  },

  /** the disputed act on the road. The domain records it; it never calls it adultery. */
  lie_together: {
    pre: (s) => {
      if (s.flight.consummated) return err('already')
      if (!(pairTogether(s, 'road') || pairTogether(s, 'inn'))) return err('they are not alone together')
      return ok()
    },
    eff: (s) => { s.flight.consummated = true; if (!s.child.conceivedAt) s.child.conceivedAt = 'road' },
  },

  /** they stop at Castelnuovo, a few hours short of Rome. This is the stop that lost her. */
  rest_at_inn: {
    pre: (s) => pairTogether(s, 'road') ? ok() : err('they are not on the road'),
    eff: (s) => { s.where.Pompilia = 'inn'; s.where.Caponsacchi = 'inn' },
  },

  /** the history Caponsacchi tortures himself with for the rest of the poem */
  press_on: {
    pre: (s) => pairTogether(s, 'road') ? ok() : err('they are not on the road'),
    eff: (s) => { s.where.Pompilia = 'rome'; s.where.Caponsacchi = 'rome'; s.flight.reachedRome = true },
  },

  // ---------------------------------------------------------------- Castelnuovo
  overtake: {
    pre: (s) => {
      if (s.guido.overtook) return err('he has come up with them already')
      if (!pairTogether(s, 'inn')) return err('there is nobody at the inn to come up with')
      return ok()
    },
    // The moment opens here and here only. `simulate` closes it after any other act — see
    // the note there; that IS the in-continenti rule.
    eff: (s) => { s.where.Guido = 'inn'; s.guido.overtook = true; s.guido.momentOpen = true },
  },

  /**
   * The husband's right. Every clause is a real requirement of the ius commune and each one
   * is separately checkable against the record:
   *   — he must have come up with them                (taken in the act)
   *   — the moment must not have closed               (in continenti, no interval)
   *   — he must not have gone to law                  (no recourse to a judge)
   *   — there must be something to take them in       (flagrante)
   * The record answers the third clause on its own: Guido sued. That single fact refutes this
   * operator in every history the evidence permits, which is the structural twin of the
   * unbloodied longsword — and, unlike the longsword, it is the ground the real court took.
   */
  kill_in_continenti: {
    pre: (s) => {
      if (!s.guido.overtook) return err('Guido has not come up with them')
      if (!s.guido.momentOpen) return err('the moment has closed — the privilege is in continenti only')
      if (s.suit.brought) return err('having gone to law, he cannot afterwards take the law in hand')
      if (!s.flight.consummated) return err('the privilege requires taking them in the act')
      if (!s.alive.Pompilia || !s.alive.Caponsacchi) return err('they are not both there to be taken')
      return ok()
    },
    eff: (s) => {
      s.alive.Pompilia = false; s.alive.Caponsacchi = false
      s.guido.basis = 'honor'
    },
  },

  /**
   * He went to law instead. The single act that decides the case.
   *
   * The third clause is load-bearing and was missing at first, which quietly destroyed the
   * mechanism this domain is built on. Without it a history may kill in the moment and bring
   * the flight-suit AFTERWARDS, so `sued` and `basis: honor` co-occur, so the record's
   * establishing that he sued no longer refutes the husband's privilege — and the filtration
   * showed 'suit' costing Guido nothing at all. A man does not prosecute a flight by two
   * people he has just killed.
   */
  sue: {
    pre: (s) => s.suit.brought ? err('the suit is brought')
      : s.guido.basis ? err('there is nobody left to prosecute')
      : s.guido.overtook ? ok() : err('nothing to sue upon yet'),
    eff: (s) => { s.suit.brought = true },
  },

  // ---------------------------------------------------------------- the courts
  // The flight-trial's sentence is a fact of the record and a weak signal about what it found.
  // Both operators are available whenever the suit is brought: a court that saw adultery could
  // still have relegated, and the domain does not pretend otherwise. Making the light sentence
  // logically exclude consummation would hand the framework its answer; it has to earn it.
  judge_flight: {
    pre: (s) => !s.suit.brought ? err('no suit') : s.suit.judged ? err('judged already') : ok(),
    eff: (s) => { s.suit.judged = true; s.suit.sentence = 'relegation'; s.where.Caponsacchi = 'civitavecchia' },
  },
  judge_adultery: {
    pre: (s) => !s.suit.brought ? err('no suit') : s.suit.judged ? err('judged already')
      : !s.flight.consummated ? err('there was no adultery to find') : ok(),
    eff: (s) => { s.suit.judged = true; s.suit.sentence = 'galleys'; s.where.Caponsacchi = 'galleys' },
  },

  place_in_convent: {
    pre: (s) => !s.suit.judged ? err('not yet judged') : s.suit.placed ? err('already placed') : ok(),
    eff: (s) => { s.where.Pompilia = 'convent'; s.suit.placed = true },
  },

  /** released to the Comparini villa on account of her pregnancy */
  release_to_villa: {
    pre: (s) => {
      if (!at(s, 'Pompilia', 'convent')) return err('she is not in the convent')
      if (!s.child.conceivedAt) return err('there is no pregnancy to release her upon')
      return ok()
    },
    eff: (s) => { s.where.Pompilia = 'villa'; s.where.Pietro = 'villa'; s.where.Violante = 'villa' },
  },

  deliver: {
    pre: (s) => !s.child.conceivedAt ? err('no child') : s.child.born ? err('delivered already') : ok(),
    eff: (s) => { s.child.born = true },
  },

  // ---------------------------------------------------------------- the villa
  hire_men: {
    pre: (s) => s.guido.men ? err('they are hired') : ok(),
    eff: (s) => { s.guido.men = 4 },
  },

  go_to_villa: {
    pre: (s) => at(s, 'Guido', 'villa') ? err('he is there') : s.suit.judged ? ok() : err('the suit is still open'),
    eff: (s) => { s.where.Guido = 'villa' },
  },

  /** the door was gained by calling the name of the man he came to avenge himself for */
  call_the_name: {
    pre: (s) => !at(s, 'Guido', 'villa') ? err('he is not at the door') : s.guido.usedName ? err('already') : ok(),
    eff: (s) => { s.guido.usedName = true },
  },

  kill_ex_intervallo: {
    pre: (s) => {
      if (!at(s, 'Guido', 'villa')) return err('he is not at the villa')
      if (s.guido.basis) return err('the killing is done')
      if (!at(s, 'Pompilia', 'villa')) return err('she is not there')
      if (!s.alive.Pietro || !s.alive.Violante) return err('the Comparini are dead already')
      return ok()
    },
    eff: (s) => {
      s.alive.Pietro = false; s.alive.Violante = false
      s.pompilia.mortallyWounded = true
      s.guido.basis = 'revenge'
    },
  },

  /** twenty-two wounds and she lived four days. Without this the case has no Book 7. */
  testify: {
    pre: (s) => !s.pompilia.mortallyWounded ? err('she is unhurt') : s.pompilia.testified ? err('she has spoken') : ok(),
    eff: (s) => { s.pompilia.testified = true },
  },

  die_of_wounds: {
    pre: (s) => s.pompilia.mortallyWounded && s.alive.Pompilia ? ok() : err('nothing to die of'),
    eff: (s) => { s.alive.Pompilia = false },
  },

  taken_at_the_gate: {
    pre: (s) => !s.guido.basis ? err('nothing done to be taken for') : s.guido.taken ? err('taken already') : ok(),
    eff: (s) => { s.guido.taken = true; s.where.Guido = 'prison' },
  },
}

// ---- simulator ----
export function simulate(steps) {
  const s = initialState()
  const trace = []
  for (let i = 0; i < steps.length; i++) {
    const a = steps[i]
    const schema = ACTIONS[a.type]
    if (!schema) { trace.push({ i, a, ok: false, reason: `unknown action ${a.type}` }); return { state: s, trace, ok: false } }
    const chk = schema.pre(s, a)
    if (!chk.ok) { trace.push({ i, a, ok: false, reason: chk.reason }); return { state: s, trace, ok: false } }
    schema.eff(s, a)
    // IN CONTINENTI, enforced here rather than in twenty preconditions. The privilege lives
    // in the moment of the discovery and no longer: any act at all that is not the killing
    // itself is an interval, and an interval ends it. Encoding it once in the simulator is
    // also the honest place — it is a property of the passage of time, not of any one
    // operator, and writing it into `sue` alone would quietly let a dozen other delays
    // through.
    if (a.type !== 'overtake' && a.type !== 'kill_in_continenti') s.guido.momentOpen = false
    trace.push({ i, a, ok: true })
  }
  return { state: s, trace, ok: true }
}

// ---- the disputed coordinates ----
/**
 * A history's causal signature: everything about it the parties actually fight over.
 * `literate` is carried here and quotiented away in ring-core — no score reads it, it only
 * gates who could have written the letters, so two histories differing only in whether she
 * was taught are the same ASSERTION and no witness ever chose between them.
 */
export const signature = (s) => ({
  initiator: s.flight.initiator ?? 'none',
  letters: s.letters.author ?? 'none',
  literate: s.pompilia.literate,
  consummated: s.flight.consummated,
  reachedRome: s.flight.reachedRome,
  sire: s.child.conceivedAt === 'road' ? 'Caponsacchi' : s.child.conceivedAt === 'arezzo' ? 'Guido' : 'none',
  basis: s.guido.basis ?? 'none',
  // carried separately from `basis` because it is what the husband's privilege turns on and
  // no other coordinate implies it: a man may kill ex intervallo having sued or not, and the
  // two are worth very different things to him.
  sued: s.suit.brought,
  alone: s.guido.men === 0,
  usedName: s.guido.usedName,
  peril: s.peril,
})

export const sigKey = (g) => [
  g.initiator, g.letters, g.literate ? 'lit' : 'unlit', g.consummated ? 'lay' : 'chaste',
  g.reachedRome ? 'rome' : 'taken', g.sire, g.basis, g.sued ? 'sued' : 'nosuit',
  g.alone ? 'alone' : 'men', g.usedName ? 'name' : 'noname', g.peril ? 'peril' : 'noperil',
].join('|')

// ---- the record, and how a history is checked against it ----
/**
 * A record spec constrains the terminal state. Every field is optional, so a partial record
 * — the magistrate's file before he has established everything — is a legitimate spec, and
 * Feas shrinks monotonically as fields are added.
 */
export function diffRecord(state, spec) {
  const miss = []
  const g = signature(state)
  const want = (cond, msg) => { if (!cond) miss.push(msg) }

  if (spec.flightBegun !== undefined) want(state.flight.begun === spec.flightBegun, 'the flight from Arezzo')
  if (spec.takenAt === 'inn') want(!state.flight.reachedRome && state.guido.overtook, 'they were taken at Castelnuovo, short of Rome')
  if (spec.takenAt === 'rome') want(state.flight.reachedRome, 'they reached Rome')
  if (spec.sued !== undefined) want(state.suit.brought === spec.sued, 'Guido brought the flight-suit')
  if (spec.sentence) want(state.suit.sentence === spec.sentence, `the sentence was ${spec.sentence}`)
  if (spec.placed !== undefined) want(state.suit.placed === spec.placed, 'Pompilia was placed in the convent')
  if (spec.lettersProduced !== undefined) want(state.letters.exist === spec.lettersProduced, 'letters were produced at the trial')
  // The date. A child born 18 December was not got at the inn in late April.
  if (spec.birth === 'december') {
    want(state.child.born, 'a child was born')
    want(state.child.conceivedAt === 'arezzo', 'a December birth cannot have been got at Castelnuovo in April')
  }
  if (spec.men !== undefined) want((state.guido.men > 0) === spec.men, 'four hired men came with him')
  if (spec.usedName !== undefined) want(state.guido.usedName === spec.usedName, 'the door was gained by calling "Caponsacchi"')
  if (spec.lingered !== undefined) want(state.pompilia.testified === spec.lingered, 'Pompilia lived four days and testified')
  if (spec.taken !== undefined) want(state.guido.taken === spec.taken, 'Guido was stopped at the gate')
  for (const who of spec.dead || []) want(!state.alive[who], `${who} is dead`)
  for (const who of spec.living || []) want(state.alive[who], `${who} is living`)
  if (spec.basis) want(g.basis === spec.basis, `the killing was ${spec.basis}`)
  // contested facts — see ring-evidence.mjs. Held here so a reading of the record is checked
  // by the same function as the record itself.
  if (spec.consummated !== undefined) want(g.consummated === spec.consummated, 'what passed at the inn')
  if (spec.lettersBy) want(g.letters === spec.lettersBy, `the letters are in ${spec.lettersBy}'s hand`)
  if (spec.peril !== undefined) want(g.peril === spec.peril, 'the usage at Arezzo')
  if (spec.literate !== undefined) want(g.literate === spec.literate, 'whether she could write at all')
  // Who set the flight going. Easy to leave out, and leaving it out silently makes three of
  // the nine contested assertions inert: ring-evidence credits them into the spec and nothing
  // ever reads the field, so every reading scores as though nobody had claimed anything about
  // the flight's origin.
  if (spec.initiator) want(g.initiator === spec.initiator, `${spec.initiator} set the flight going`)
  return miss
}

/**
 * THE OLD YELLOW BOOK — the facts no party to the case disputed.
 * Everything here is in the documents Browning bought off a stall in the Piazza San Lorenzo;
 * nothing here is anybody's testimony about anybody's motive.
 */
export const RECORD = {
  flightBegun: true,
  takenAt: 'inn',            // Castelnuovo, a few hours short of Rome
  sued: true,                // he went to law — the fact that decides the case
  sentence: 'relegation',    // Caponsacchi: three years at Civita Vecchia
  placed: true,              // Pompilia to the Scalette, then released for her pregnancy
  lettersProduced: true,
  birth: 'december',         // Gaetano, 18 December 1697
  men: true,                 // four hired peasants, 2 January 1698
  usedName: true,            // the door opened to the name "Caponsacchi"
  lingered: true,            // twenty-two wounds; she lived four days and gave evidence
  taken: true,               // stopped at the gate for want of a pass
  dead: ['Pietro', 'Violante', 'Pompilia'],
}
