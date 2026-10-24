// The grove's physics — a tiny STRIPS-like domain + simulator.
// Module B+E of the inverse layer: validation by REPLAY, not by regex.
//
// State predicates: alive(x), bound(x), present(x), wounds(x) [{part, weapon}],
//                   holder(o), bloodied(o), rope.state, horse.present.
// Every candidate process is a sequence of STRUCTURED steps; the simulator
// replays them, checking each action's preconditions, then diffs the final
// state against the aftermath. Speech/looks pass through (texture, no state).

export const CAST = ['Tajomaru', 'Masago', 'Takehiro']
export const BLADES = ['longsword', 'dagger']

export function initialState() {
  return {
    agents: {
      Tajomaru: { alive: true, bound: false, present: true, wounds: [] },
      Masago:   { alive: true, bound: false, present: true, wounds: [] },
      Takehiro: { alive: true, bound: true,  present: true, wounds: [] },
    },
    objects: {
      longsword: { holder: null, ground: true, bloodied: false },
      dagger:    { holder: 'Masago', ground: false, bloodied: false },
    },
    rope: 'binding',        // binding | cut
    horse: true,            // still at the edge of the grove
    log: [],
  }
}

const err = (m) => ({ ok: false, reason: m })
const ok = () => ({ ok: true })

// ---- action schema: preconditions + effects ----
export const ACTIONS = {
  // pick an object up from the ground
  take: {
    pre: (s, a) => {
      const g = s.agents[a.actor], o = s.objects[a.object]
      if (!g?.alive) return err(`${a.actor} is not alive`)
      if (!g.present) return err(`${a.actor} has left the grove`)
      if (g.bound) return err(`${a.actor} is bound and cannot take up ${a.object}`)
      if (!o) return err(`unknown object ${a.object}`)
      if (o.holder) return err(`${a.object} is held by ${o.holder}, not on the ground`)
      return ok()
    },
    eff: (s, a) => { s.objects[a.object].holder = a.actor; s.objects[a.object].ground = false },
  },
  // wrest an object from whoever holds it
  seize: {
    pre: (s, a) => {
      const g = s.agents[a.actor], o = s.objects[a.object]
      if (!g?.alive || !g.present) return err(`${a.actor} cannot act`)
      if (g.bound) return err(`${a.actor} is bound and cannot seize`)
      if (!o?.holder) return err(`${a.object} is not in anyone's hand`)
      if (o.holder === a.actor) return err(`${a.actor} already holds ${a.object}`)
      if (!s.agents[o.holder]?.present) return err(`${o.holder} is not present to be seized from`)
      return ok()
    },
    eff: (s, a) => { s.objects[a.object].holder = a.actor },
  },
  give: {
    pre: (s, a) => {
      const o = s.objects[a.object]
      if (o?.holder !== a.actor) return err(`${a.actor} does not hold ${a.object}`)
      if (!s.agents[a.target]?.alive || !s.agents[a.target]?.present) return err(`${a.target} cannot receive`)
      // a bound receiver can accept a small blade into his hands; a longsword he cannot wield
      return ok()
    },
    eff: (s, a) => { s.objects[a.object].holder = a.target },
  },
  drop: {
    pre: (s, a) => s.objects[a.object]?.holder === a.actor ? ok() : err(`${a.actor} does not hold ${a.object}`),
    eff: (s, a) => { s.objects[a.object].holder = null; s.objects[a.object].ground = true },
  },
  fling: {  // throw far — object ends on open ground away from bodies
    pre: (s, a) => s.objects[a.object]?.holder === a.actor ? ok() : err(`${a.actor} does not hold ${a.object}`),
    eff: (s, a) => { s.objects[a.object].holder = null; s.objects[a.object].ground = true; s.objects[a.object].flung = true },
  },
  // cut the rope binding Takehiro; cutter must be unbound and hold a blade
  cut_rope: {
    pre: (s, a) => {
      const g = s.agents[a.actor]
      if (!g?.alive || !g.present) return err(`${a.actor} cannot act`)
      if (g.bound) return err(`${a.actor} is bound and cannot cut the rope`)
      if (!BLADES.includes(a.object)) return err(`the rope must be cut with a blade`)
      if (s.objects[a.object]?.holder !== a.actor) return err(`${a.actor} does not hold ${a.object}`)
      if (s.rope !== 'binding') return err(`the rope is already cut`)
      return ok()
    },
    eff: (s) => { s.rope = 'cut'; s.agents.Takehiro.bound = false },
  },
  // strike another with a held weapon
  strike: {
    pre: (s, a) => {
      const g = s.agents[a.actor], v = s.agents[a.target]
      if (!g?.alive || !g.present) return err(`${a.actor} cannot act`)
      if (g.bound) return err(`${a.actor} is bound and cannot strike`)
      if (s.objects[a.object]?.holder !== a.actor) return err(`${a.actor} does not hold ${a.object}`)
      if (!v?.alive || !v.present) return err(`${a.target} is not there to be struck`)
      return ok()
    },
    eff: (s, a) => {
      const v = s.agents[a.target]
      v.wounds.push({ part: a.part || 'body', weapon: a.object })
      if (a.lethal !== false) v.alive = false
      s.objects[a.object].bloodied = true
    },
  },
  // turn a held weapon on oneself; requires a free hand holding it
  self_strike: {
    pre: (s, a) => {
      const g = s.agents[a.actor]
      if (!g?.alive || !g.present) return err(`${a.actor} cannot act`)
      if (g.bound) return err(`${a.actor} is bound — bound hands cannot drive a blade into his own ${a.part || 'body'}`)
      if (s.objects[a.object]?.holder !== a.actor) return err(`${a.actor} does not hold ${a.object}`)
      return ok()
    },
    eff: (s, a) => {
      const g = s.agents[a.actor]
      g.wounds.push({ part: a.part || 'body', weapon: a.object, selfInflicted: true })
      if (a.lethal !== false) g.alive = false
      s.objects[a.object].bloodied = true
    },
  },
  // the ambiguous act: drive one's own body onto a blade HELD BY ANOTHER
  impale_on_held: {
    pre: (s, a) => {
      const g = s.agents[a.actor], holder = s.objects[a.object]?.holder
      if (!g?.alive || !g.present) return err(`${a.actor} cannot act`)
      if (g.bound) return err(`${a.actor} is bound and cannot throw himself forward`)
      if (!holder || holder === a.actor) return err(`${a.object} is not held by another`)
      return ok()
    },
    eff: (s, a) => {
      const g = s.agents[a.actor]
      g.wounds.push({ part: a.part || 'chest', weapon: a.object, contested: true })
      if (a.lethal !== false) g.alive = false
      s.objects[a.object].bloodied = true
    },
  },
  flee: {
    pre: (s, a) => {
      const g = s.agents[a.actor]
      if (!g?.alive) return err(`${a.actor} is dead`)
      if (g.bound) return err(`${a.actor} is bound and cannot flee`)
      return ok()
    },
    eff: (s, a) => { s.agents[a.actor].present = false },
  },
  mount_flee: {
    pre: (s, a) => {
      const g = s.agents[a.actor]
      if (!g?.alive || g.bound) return err(`${a.actor} cannot ride`)
      if (!s.horse) return err(`the horse is already gone`)
      return ok()
    },
    eff: (s, a) => { s.agents[a.actor].present = false; s.horse = false },
  },
  // texture actions: no state change, always legal for a live present agent
  speak: { pre: (s, a) => s.agents[a.actor]?.alive ? ok() : err(`${a.actor} is dead`), eff: () => {} },
  look:  { pre: (s, a) => s.agents[a.actor]?.alive ? ok() : err(`${a.actor} is dead`), eff: () => {} },
}

// ---- simulator ----
export function simulate(steps) {
  const s = initialState()
  const trace = []
  for (let i = 0; i < steps.length; i++) {
    const a = steps[i]
    const schema = ACTIONS[a.type]
    if (!schema) { trace.push({ i, a, ok: false, reason: `unknown action type ${a.type}` }); return { state: s, trace, ok: false } }
    if (!CAST.includes(a.actor)) { trace.push({ i, a, ok: false, reason: `unknown actor ${a.actor}` }); return { state: s, trace, ok: false } }
    const chk = schema.pre(s, a)
    if (!chk.ok) { trace.push({ i, a, ok: false, reason: chk.reason }); return { state: s, trace, ok: false } }
    schema.eff(s, a)
    trace.push({ i, a, ok: true })
  }
  return { state: s, trace, ok: true }
}

// ---- aftermath spec + diff ----
// spec example (run-06): { dead: [{who:'Takehiro', part:'throat', weapon:'dagger'}],
//   alivePresent:['Masago'], gone:['Tajomaru'], bloodied:['dagger'], notBloodied:['longsword'],
//   rope:'cut', horseGone:false, flung:[] }
export function diffAftermath(state, spec) {
  const misses = []
  for (const d of spec.dead || []) {
    const g = state.agents[d.who]
    if (!g) { misses.push(`unknown ${d.who}`); continue }
    if (g.alive) { misses.push(`${d.who} should be dead`); continue }
    if (d.part && !g.wounds.some(w => w.part === d.part && (!d.weapon || w.weapon === d.weapon)))
      misses.push(`${d.who}'s fatal wound should be to the ${d.part} by the ${d.weapon || 'blade'}`)
  }
  for (const w of spec.alivePresent || []) {
    const g = state.agents[w]
    if (!g?.alive) misses.push(`${w} should be alive`)
    else if (!g.present) misses.push(`${w} should still be in the grove`)
  }
  for (const w of spec.gone || []) if (state.agents[w]?.present) misses.push(`${w} should be gone from the grove`)
  for (const o of spec.bloodied || []) if (!state.objects[o]?.bloodied) misses.push(`the ${o} should be bloodied`)
  for (const o of spec.notBloodied || []) if (state.objects[o]?.bloodied) misses.push(`the ${o} should be unbloodied`)
  if (spec.rope && state.rope !== spec.rope) misses.push(`the rope should be ${spec.rope}`)
  if (spec.horseGone === true && state.horse) misses.push(`the horse should be gone`)
  if (spec.horseGone === false && !state.horse) misses.push(`the horse should still be at the edge`)
  for (const o of spec.flung || []) if (!state.objects[o]?.flung) misses.push(`the ${o} should lie flung away from the body`)
  // An object is ABSENT from the scene exactly when whoever holds it has left the grove —
  // blades ride away in the hand that took them. Needed for Akutagawa's canonical
  // aftermath, where neither blade is found. Purely additive: specs that omit `absent`
  // (every pre-existing one) are evaluated exactly as before.
  for (const o of spec.absent || []) {
    const h = state.objects[o]?.holder
    if (!h || state.agents[h]?.present) misses.push(`the ${o} should be gone from the scene`)
  }
  return misses
}

export const AFTERMATH = {
  "pre-B'/run-06": {
    dead: [{ who: 'Takehiro', part: 'throat', weapon: 'dagger' }],
    alivePresent: ['Masago'], gone: ['Tajomaru'],
    bloodied: ['dagger'], notBloodied: ['longsword'], rope: 'cut',
  },
  "pre-B'/run-04": {
    dead: [{ who: 'Takehiro', part: 'chest', weapon: 'dagger' }],
    alivePresent: ['Masago'], gone: ['Tajomaru'],
    bloodied: ['dagger'], flung: ['dagger'], horseGone: true,
  },
  // Akutagawa's canonical scene, as his two non-participant witnesses report it (Japanese romanized):
  //   woodcutter — shiin wa mune no sashikizu (a stab wound to the CHEST; he never names the weapon);
  //                at the scene hitosuji no nawa to onnamono no kushi (one rope, a woman's comb), and
  //                uma to kogatana wa mite inai (he saw neither the horse nor the dagger);
  //   policeman  — Tajomaru is caught in the dead man's clothes, carrying the tachi (long sword) and
  //                bow and arrows, riding the horse.
  // So: chest wound, weapon undetermined, BOTH blades gone, nobody at the scene.
  //
  // This is the canonical AFTERMATH, not the canonical MECHANISM: in the story the
  // dagger is drawn from the chest by an unnamed fourth hand, and this domain has only
  // three agents. See recon/akutagawa.mjs — the distinction is reported, not papered over.
  "akutagawa/canonical": {
    dead: [{ who: 'Takehiro', part: 'chest' }],   // weapon deliberately unspecified
    gone: ['Tajomaru', 'Masago'],
    absent: ['longsword', 'dagger'],
    rope: 'cut',
    horseGone: true,
  },
}
