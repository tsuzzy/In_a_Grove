// ONE SHARED HISTORY SPACE for several evidence sets.
//
// grove-core.mjs does exactly one enumeration, hard-wired to the project's own run-06:
// wounds are always to the throat, and a history "resolves" only when Masago is still
// standing in the grove. Two evidence sets with different terminal conditions (run-06
// leaves Masago in the grove; Akutagawa's canonical scene leaves nobody there) cannot both
// be enumerated that way, and if each gets its own candidate space then |Feasible(F)| is
// not comparable between them — part of any difference would come from the candidate set
// rather than from the evidence. Worse, the unconstrained ideal used for "cost of honesty"
// is a max over that candidate set, so that comparison would not be sound either.
//
// So this enumerates the reachable graph with NO pruning on any evidence set, and lets each
// evidence set pick its own terminals out of the one shared space. Every |Feasible(F)|,
// every ideal and every cost is then measured against the same candidate histories.
//
// Two corrections are built in, and both were bugs in the original enumeration:
//   * the search key carries the FATAL ATTRIBUTION, not just the physical state. State
//     records the wound but not who dealt it, so "Tajomaru ran him through" and "Masago ran
//     him through" reach an identical state and a state-deduplicating search keeps only
//     whichever arrived first — dropping the attribution this whole enumeration exists to
//     distinguish.
//   * a signature is FEASIBLE iff SOME history realising it fits the evidence, not iff its
//     shortest representative does. Histories sharing a signature still differ in what F
//     also constrains (rope, blood, horse).
//
// The rope-cutter is recorded but is NOT part of any key: it does not enter U_i (see the
// note on `agency` in grove-core.mjs) and F does not constrain it, so two histories
// differing only in who cut the rope are the same account in every respect this model uses.
//
// NO LLM here, same as grove-core.mjs: feasibility is the simulator replaying steps.

import { CAST, BLADES, ACTIONS, simulate, diffAftermath, initialState } from './domain.mjs'
export { CAST, BLADES }

const key = (s) => JSON.stringify([
  CAST.map(a => [s.agents[a].alive, s.agents[a].bound, s.agents[a].present,
                 s.agents[a].wounds.map(w => w.part + ':' + w.weapon + (w.selfInflicted ? 's' : w.contested ? 'c' : ''))]),
  BLADES.map(o => [s.objects[o].holder, s.objects[o].ground, s.objects[o].bloodied, !!s.objects[o].flung]),
  s.rope, s.horse,
])

/** every action available in state `s`; `parts` is which wound locations may be aimed at */
function* groundings(s, parts) {
  for (const actor of CAST) {
    const g = s.agents[actor]
    if (!g.alive || !g.present) continue
    if (!g.bound) { yield { type: 'flee', actor }; if (s.horse) yield { type: 'mount_flee', actor } }
    for (const obj of BLADES) {
      const o = s.objects[obj]
      if (!g.bound && o.holder === null && o.ground) yield { type: 'take', actor, object: obj }
      if (!g.bound && o.holder && o.holder !== actor && s.agents[o.holder]?.present) yield { type: 'seize', actor, object: obj }
      if (o.holder === actor) {
        for (const t of CAST) if (t !== actor && s.agents[t].alive && s.agents[t].present) yield { type: 'give', actor, object: obj, target: t }
        if (!g.bound && s.rope === 'binding') yield { type: 'cut_rope', actor, object: obj }
        if (!g.bound) for (const part of parts) {
          for (const t of CAST) if (t !== actor && s.agents[t].alive && s.agents[t].present)
            yield { type: 'strike', actor, target: t, object: obj, part }
          yield { type: 'self_strike', actor, object: obj, part }
        }
      }
      if (!g.bound && o.holder && o.holder !== actor) for (const part of parts)
        yield { type: 'impale_on_held', actor, object: obj, part }
    }
  }
}

/** replay a history and read off who dealt the fatal blow, how, and who cut the rope */
function annotate(steps) {
  const s = initialState()
  let fatal = null, cutter = null
  for (const a of steps) {
    const beforeBound = s.agents.Takehiro.bound
    const beforeAlive = s.agents.Takehiro.alive
    const victimArmed = BLADES.some(o => s.objects[o].holder === 'Takehiro')
    ACTIONS[a.type].eff(s, a)
    if (a.type === 'cut_rope') cutter = a.actor
    if (!fatal && beforeAlive && s.agents.Takehiro.alive === false)
      fatal = { actor: a.actor, type: a.type, weapon: a.object, part: a.part, boundAtDeath: beforeBound, victimArmed }
  }
  return { fatal, cutter }
}

export function enumerateShared({ parts = ['throat', 'chest'], degenerate = DEGENERATE, specs, cap = 3000000 }) {
  const names = Object.keys(specs)
  const fatalKey = (f) => `${f.actor}|${f.type}|${f.weapon}|${f.part}|bound:${f.boundAtDeath}|armed:${f.victimArmed}`
  const skey = (s, f) => key(s) + '#' + (f ? fatalKey(f) : '-')

  const start = initialState()
  const seen = new Map([[skey(start, null), { parent: null, act: null, state: start, fatal: null, cutter: null }]])
  const queue = [skey(start, null)]
  let statesExplored = 0
  const bySig = new Map()

  const pathTo = (k) => {
    const steps = []
    let cur = k
    while (seen.get(cur).act) { steps.unshift(seen.get(cur).act); cur = seen.get(cur).parent }
    return steps
  }

  while (queue.length) {
    const k = queue.shift(); statesExplored++
    const node = seen.get(k)
    const s = node.state

    // A state is only a candidate ENDING for this case if the scene has not run past it.
    // `degenerate` means somebody else has since died, and such a state is not an aftermath
    // of THIS death — it is the aftermath of a different, later one. Recording them made
    // evidence about the blades unfalsifiable: "the dagger is bloodied" was satisfiable by
    // any signature at all, because in some continuation Masago later stabs Tajomaru with
    // it. The check has to come before the recording, not after.
    if (node.fatal && !degenerate(s)) {
      const sig = fatalKey(node.fatal)
      let rec = bySig.get(sig)
      if (!rec) {
        rec = {
          sig, an: { fatal: node.fatal, cutter: node.cutter },
          steps: pathTo(k),
          feasible: Object.fromEntries(names.map(n => [n, false])),
          witness: Object.fromEntries(names.map(n => [n, null])),
          // Every distinct end state this signature can reach, so an evidence set NOT known
          // at enumeration time can still be decided exactly. Without it a later caller has
          // only `steps`, which is one arbitrary history — and judging a signature by one
          // representative is precisely the bug that once turned 11 feasible accounts into 7.
          ends: new Map(),
        }
        bySig.set(sig, rec)
      }
      rec.ends.set(key(s), s)
      for (const n of names) {
        if (diffAftermath(s, specs[n]).length === 0) {
          rec.feasible[n] = true
          if (!rec.witness[n]) rec.witness[n] = pathTo(k)
        }
      }
    }

    if (degenerate(s)) continue
    for (const a of groundings(s, parts)) {
      const sim = simulate([...pathTo(k), a])
      if (!sim.ok) continue
      let fatal = node.fatal, cutter = node.cutter
      if (a.type === 'cut_rope') cutter = a.actor
      if (!fatal && s.agents.Takehiro.alive && !sim.state.agents.Takehiro.alive) {
        fatal = {
          actor: a.actor, type: a.type, weapon: a.object, part: a.part,
          boundAtDeath: s.agents.Takehiro.bound,
          victimArmed: BLADES.some(o => s.objects[o].holder === 'Takehiro'),
        }
      }
      const nk = skey(sim.state, fatal)
      if (!seen.has(nk)) { seen.set(nk, { parent: k, act: a, state: sim.state, fatal, cutter }); queue.push(nk) }
    }
    if (statesExplored > cap) { console.error('safety cap hit'); break }
  }

  const all = [...bySig.values()]
  return {
    statesExplored,
    all,
    /** one record per causal signature, so this equals all.length */
    causalSignatures: new Set(all.map(r => r.sig)).size,
    /** the accounts a witness may give under evidence set `name` — the argmax domain */
    feasibleUnder: (name) => all.filter(r => r.feasible[name]),
    /** the deniability gap: distinct causal attributions the evidence cannot rule out */
    gapUnder: (name) => new Set(all.filter(r => r.feasible[name]).map(r => r.sig)).size,
    /** decide an arbitrary evidence set, exactly: does SOME end state of this signature fit? */
    feasibleUnderSpec: (spec) => all.filter(r => {
      for (const st of r.ends.values()) if (diffAftermath(st, spec).length === 0) return true
      return false
    }),
  }
}

export const DEGENERATE = (s) => !s.agents.Masago.alive || !s.agents.Tajomaru.alive
