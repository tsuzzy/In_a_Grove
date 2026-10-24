// THE MAGISTRATE'S FILE — evidence as atomic, establishable facts.
//
// An aftermath spec used to be a literal in domain.mjs, one per named world. That is fine
// when the evidence is fixed before the hearing starts, and useless once it arrives during
// one. Here a file is a LIST of facts, each of which a magistrate could separately have
// established, and the spec is built from it.
//
// The list is ORDERED, not a set, and that is load-bearing: which witness gets caught out
// depends on what they happened to be standing on when a fact landed. Establishing the
// wound's location and then the weapon is not the same hearing as the reverse. The
// interactive page therefore keeps a sequence and replays it, rather than keeping a set.
//
// `part` is what a woodcutter can see. `weapon` is the much stronger claim that the wound
// identifies the blade — in Akutagawa he cannot make it, and that single missing fact is
// most of the difference between the two worlds.
//
// NO LLM. Shared by private-hearing.mjs, the magistrate page, and the tests.

export const FACTS = {
  corpse: { note: 'a body, and it is Takehiro', apply: (f) => { f.dead = [{ who: 'Takehiro' }] } },
  part: { note: 'where the wound is', apply: (f, o) => { (f.dead ??= [{ who: 'Takehiro' }])[0].part = o.part } },
  weapon: { note: 'the wound identifies the blade that made it', apply: (f, o) => { (f.dead ??= [{ who: 'Takehiro' }])[0].weapon = o.weapon } },
  // says only that the blade drew blood — NOT where it ended up. A witness can stab with
  // the dagger and carry it out of the grove; that is not a contradiction with `bladesGone`.
  daggerBlood: { note: 'the dagger drew blood', apply: (f) => { f.bloodied = ['dagger'] } },
  swordClean: { note: 'the longsword drew none', apply: (f) => { f.notBloodied = ['longsword'] } },
  bladesGone: { note: 'neither blade is left at the scene', apply: (f) => { f.absent = ['longsword', 'dagger'] } },
  rope: { note: 'the rope is found cut', apply: (f) => { f.rope = 'cut' } },
  banditGone: { note: 'the bandit is not at the scene', apply: (f) => { f.gone = [...new Set([...(f.gone || []), 'Tajomaru'])] } },
  wifePresent: { note: 'the wife is still at the scene', apply: (f) => { f.alivePresent = ['Masago'] } },
  wifeGone: { note: 'the wife is not at the scene either', apply: (f) => { f.gone = [...new Set([...(f.gone || []), 'Masago'])] } },
  horseGone: { note: 'the horse is gone', apply: (f) => { f.horseGone = true } },
}

export const FACT_KEYS = Object.keys(FACTS)

/** build an aftermath spec from a list of established facts */
export function buildF(facts, opt = {}) {
  const f = {}
  for (const k of facts) {
    if (!FACTS[k]) throw new Error(`unknown fact: ${k}`)
    FACTS[k].apply(f, { part: 'throat', weapon: 'dagger', ...opt })
  }
  return f
}

/** the two named files, as fact lists rather than literals */
export const WORLDS = {
  'run-06': {
    facts: ['corpse', 'part', 'weapon', 'daggerBlood', 'swordClean', 'rope', 'banditGone', 'wifePresent'],
    opt: { part: 'throat' }, title: 'the scene our agents left',
  },
  akutagawa: {
    facts: ['corpse', 'part', 'bladesGone', 'rope', 'banditGone', 'wifeGone', 'horseGone'],
    opt: { part: 'chest' }, title: "Akutagawa's canonical scene",
  },
}

/** a bare corpse upward, one fact at a time, toward our own file */
export const LADDER = ['corpse', 'part', 'rope', 'banditGone', 'wifePresent', 'daggerBlood', 'swordClean', 'weapon']
