// THE OLD YELLOW BOOK, SPLIT IN TWO — and the reason the Pope has a job.
//
// evidence.mjs treats the magistrate's file as an ordered list of facts, each of which he
// could separately have established. That is the right shape for the grove, where every fact
// is something a woodcutter SAW. It is the wrong shape for a trial record, because a trial
// record contains two utterly different kinds of thing:
//
//   RECORD    — what the documents establish and no party disputes: dates, sentences, a
//               birth, the number of men, the name called at the door. Guido's own defence
//               concedes every one of these.
//   CONTESTED — what a party ASSERTS and another party denies: what passed at the inn, whose
//               hand held the pen, who set the flight going, how she was used at Arezzo.
//               Nothing in the documents settles these. They are testimony about testimony.
//
// Browning's whole figure for the poem is built on this split. The ring is pure gold — the
// Book, the record — worked with an alloy to make it hold a shape, and the alloy is what each
// speaker adds. The question the poem asks, and the question this file makes computable, is
// what shape survives when you file the alloy off.
//
// A READING of the case is a consistent way of deciding whom to believe: a subset of the
// contested facts containing no two that exclude one another. There are 2^k such subsets to
// filter, k small. An account that survives many readings is one you have to disbelieve a lot
// of people to be rid of. That quantity — not any moral premise — is the Pope's objective in
// ring-core.mjs, and it is the only objective in this project with no self-interest in it.
//
// NO LLM.

import { RECORD } from './ring-domain.mjs'
export { RECORD }

/**
 * The uncontested record, as separately establishable facts, in the order a magistrate
 * working forward through the documents would come to them. Ordered, not a set: Feas shrinks
 * monotonically along it, and which account is broken by which fact depends on the order.
 */
export const FACTS = {
  flight:      { note: 'the pair left Arezzo together by night',            apply: (f) => { f.flightBegun = true } },
  castelnuovo: { note: 'they were taken at the inn, short of Rome',          apply: (f) => { f.takenAt = 'inn' } },
  suit:        { note: 'Guido came up with them and brought suit',          apply: (f) => { f.sued = true } },
  sentence:    { note: 'Caponsacchi: three years’ relegation, Civita Vecchia', apply: (f) => { f.sentence = 'relegation' } },
  convent:     { note: 'Pompilia placed, then released for her pregnancy',   apply: (f) => { f.placed = true } },
  lettersFiled:{ note: 'letters were produced at the flight-trial',          apply: (f) => { f.lettersProduced = true } },
  birth:       { note: 'a son born 18 December 1697',                        apply: (f) => { f.birth = 'december' } },
  hiredMen:    { note: 'he came to the villa with four hired men',           apply: (f) => { f.men = true } },
  theName:     { note: 'the door was gained by calling “Caponsacchi”',       apply: (f) => { f.usedName = true } },
  fourDays:    { note: 'she lived four days and gave evidence',              apply: (f) => { f.lingered = true } },
  gate:        { note: 'Guido was stopped at the gate for want of a pass',   apply: (f) => { f.taken = true; f.dead = ['Pietro', 'Violante', 'Pompilia'] } },
}

export const FACT_KEYS = Object.keys(FACTS)

/** the order a magistrate comes to them in — used for the filtration experiment */
export const LADDER = ['flight', 'castelnuovo', 'lettersFiled', 'suit', 'sentence', 'convent', 'birth', 'hiredMen', 'theName', 'fourDays', 'gate']

/**
 * The contested facts. `party` is who asserts it — never a neutral document. `excludes` names
 * the assertions it cannot be credited alongside; the relation is symmetric and is checked
 * both ways, so listing each pair once is enough.
 */
export const CONTESTED = {
  chaste:     { party: ['Pompilia', 'Caponsacchi'], note: 'nothing passed at the inn',          spec: { consummated: false }, excludes: ['adultery'] },
  adultery:   { party: ['Guido'],                   note: 'they were taken in the act',          spec: { consummated: true },  excludes: ['chaste'] },

  illiterate: { party: ['Pompilia'],                note: 'she could not write at all',          spec: { literate: false },    excludes: ['wroteThem'] },
  wroteThem:  { party: ['Guido'],                   note: 'the letters are in her hand',         spec: { lettersBy: 'Pompilia' }, excludes: ['illiterate', 'forged'] },
  forged:     { party: ['Caponsacchi'],             note: 'the letters were bait, in his',       spec: { lettersBy: 'Guido' },  excludes: ['wroteThem'] },

  cruelty:    { party: ['Pompilia', 'Pietro'],      note: 'she was used to make her fly',        spec: { peril: true },        excludes: ['noCruelty'] },
  noCruelty:  { party: ['Guido'],                   note: 'she wanted for nothing at Arezzo',    spec: { peril: false },       excludes: ['cruelty'] },

  sheSent:    { party: ['Pompilia'],                note: 'she sent for him, in fear of her life', spec: { /* initiator */ },  excludes: ['heBaited', 'theyEloped'], initiator: 'Pompilia' },
  heBaited:   { party: ['Caponsacchi'],             note: 'the husband laid the trap himself',   spec: {},                     excludes: ['sheSent', 'theyEloped'], initiator: 'Guido' },
  theyEloped: { party: ['Guido'],                   note: 'the priest carried her off',          spec: {},                     excludes: ['sheSent', 'heBaited'], initiator: 'Caponsacchi' },
}

export const CONTESTED_KEYS = Object.keys(CONTESTED)

/** build a record spec from a list of uncontested facts */
export function buildRecord(facts) {
  const f = {}
  for (const k of facts) {
    if (!FACTS[k]) throw new Error(`unknown fact: ${k}`)
    FACTS[k].apply(f)
  }
  return f
}

/** the spec for a reading: the uncontested record plus whatever this reading credits */
export function buildReading(credited, base = RECORD) {
  const f = { ...base }
  for (const k of credited) {
    const c = CONTESTED[k]
    if (!c) throw new Error(`unknown contested assertion: ${k}`)
    Object.assign(f, c.spec)
    if (c.initiator) f.initiator = c.initiator
  }
  return f
}

const excludes = (a, b) =>
  (CONTESTED[a].excludes || []).includes(b) || (CONTESTED[b].excludes || []).includes(a)

/** is this set of credited assertions internally consistent? */
export function coherent(credited) {
  for (let i = 0; i < credited.length; i++)
    for (let j = i + 1; j < credited.length; j++)
      if (excludes(credited[i], credited[j])) return false
  return true
}

/**
 * Every coherent reading of the case, as arrays of credited assertion keys. The empty reading
 * (credit nobody, stand on the documents alone) is included and is the Pope's starting point.
 */
export function readings(keys = CONTESTED_KEYS) {
  const out = []
  for (let m = 0; m < (1 << keys.length); m++) {
    const pick = keys.filter((_, i) => m & (1 << i))
    if (coherent(pick)) out.push(pick)
  }
  return out
}

/** how many independent parties assert this — used only for the weighted robustness check */
export const attestors = (k) => CONTESTED[k].party.length
