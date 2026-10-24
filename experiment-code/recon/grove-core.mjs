// Single source of truth for the strict optimization: the enumerated feasible set and the
// structural objective U_i. Imported by BOTH optimize.mjs (the main result) and
// llm-baseline.mjs (the LLM baselines), so the two can never drift apart.
// NO LLM anywhere in this file: feasibility is the simulator, U_i is a transparent function.

import { CAST, BLADES, ACTIONS, simulate, diffAftermath, initialState, AFTERMATH } from './domain.mjs'
import { features, dimsOf, Uw, U, label } from './grove-objective.mjs'
export { CAST }

// Seeded PRNG so every reported number is exactly reproducible.
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
export const rand = mulberry32(20260723)

export const F = AFTERMATH["pre-B'/run-06"]

const key = (s) => JSON.stringify([
  CAST.map(a => [s.agents[a].alive, s.agents[a].bound, s.agents[a].present,
                 s.agents[a].wounds.map(w => w.part + ':' + w.weapon + (w.selfInflicted ? 's' : w.contested ? 'c' : ''))]),
  BLADES.map(o => [s.objects[o].holder, s.objects[o].ground, s.objects[o].bloodied, !!s.objects[o].flung]),
  s.rope, s.horse,
])

function* groundings(s) {
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
        if (!g.bound) {
          for (const t of CAST) if (t !== actor && s.agents[t].alive && s.agents[t].present)
            yield { type: 'strike', actor, target: t, object: obj, part: 'throat' }
          yield { type: 'self_strike', actor, object: obj, part: 'throat' }
        }
      }
      if (!g.bound && o.holder && o.holder !== actor) yield { type: 'impale_on_held', actor, object: obj, part: 'throat' }
    }
  }
}

const resolved = (s) => !s.agents.Takehiro.alive && !s.agents.Tajomaru.present
  && s.agents.Masago.alive && s.agents.Masago.present
const degenerate = (s) => !s.agents.Masago.alive || !s.agents.Tajomaru.alive

// ---- BFS enumeration over the reachable state graph ----
// The search key is the physical state PLUS the fatal attribution recorded so far.
//
// State alone is NOT enough, and the reason is easy to miss: the state records the wound
// (part + weapon) but not who dealt it. "Tajomaru ran him through" and "Masago ran him
// through" therefore reach an identical state, and a state-deduplicating search keeps only
// whichever path arrived first — silently dropping the other attribution, which is the one
// thing this enumeration exists to distinguish. The signatures that went missing were all
// "killed while still bound, rope cut afterwards": reachable, evidence-consistent, and
// never enumerated.
//
// Fixing this raised |Feasible(F)| from 7 to 11 for the same F. Every argmax result is
// unchanged (the recovered accounts score badly under U_i, so no witness wants them), but
// the size of the feasible set — the deniability gap — was understated.
// Carrying the attribution multiplies the space by at most the number of signatures, so
// the search stays small.
const start = initialState()
const skey = (s, fatal) => key(s) + '#' + (fatal || '-')
const seen = new Map([[skey(start, null), { parent: null, act: null, state: start, fatal: null }]])
const queue = [skey(start, null)]
const resolvedKeys = []
export let statesExplored = 0
while (queue.length) {
  const k = queue.shift(); statesExplored++
  const node = seen.get(k)
  const s = node.state
  if (resolved(s)) { resolvedKeys.push(k); continue }
  if (degenerate(s)) continue
  for (const a of groundings(s)) {
    const steps = []
    let cur = k
    while (seen.get(cur).act) { steps.unshift(seen.get(cur).act); cur = seen.get(cur).parent }
    const sim = simulate([...steps, a])
    if (!sim.ok) continue
    let fatal = node.fatal
    if (!fatal && s.agents.Takehiro.alive && !sim.state.agents.Takehiro.alive) {
      fatal = `${a.actor}|${a.type}|${a.object}|bound:${s.agents.Takehiro.bound}` +
        `|armed:${BLADES.some(o => s.objects[o].holder === 'Takehiro')}`
    }
    const nk = skey(sim.state, fatal)
    if (!seen.has(nk)) { seen.set(nk, { parent: k, act: a, state: sim.state, fatal }); queue.push(nk) }
  }
  if (statesExplored > 500000) { console.error('safety cap hit'); break }
}
export const resolvedCount = resolvedKeys.length

function historyOf(k) { const steps = []; let cur = k; while (seen.get(cur).act) { steps.unshift(seen.get(cur).act); cur = seen.get(cur).parent } return steps }

function annotate(steps) {
  const s = initialState()
  let fatal = null, cutter = null
  for (const a of steps) {
    const beforeBound = s.agents.Takehiro.bound
    const beforeAliveT = s.agents.Takehiro.alive
    const victimArmed = BLADES.some(o => s.objects[o].holder === 'Takehiro')
    ACTIONS[a.type].eff(s, a)
    if (a.type === 'cut_rope') cutter = a.actor
    if (!fatal && beforeAliveT && s.agents.Takehiro.alive === false)
      fatal = { actor: a.actor, type: a.type, weapon: a.object, boundAtDeath: beforeBound, victimArmed }
  }
  return { fatal, cutter }
}
const sigOf = (an) => `${an.fatal.actor}|${an.fatal.type}|${an.fatal.weapon}|bound:${an.fatal.boundAtDeath}|armed:${an.fatal.victimArmed}`

// A signature is FEASIBLE iff SOME history realising it fits the evidence — not iff its
// shortest representative does. Histories sharing a signature still differ in everything
// F also constrains (who cut the rope, which blade is bloodied, who took the horse), so
// judging one representative reports a signature refuted while a feasible history for it
// exists. The stored representative is chosen to WITNESS feasibility whenever one does.
const bySig = new Map()
for (const k of resolvedKeys) {
  const steps = historyOf(k)
  const an = annotate(steps)
  if (!an.fatal) continue
  const g = sigOf(an)
  const feasible = diffAftermath(simulate(steps).state, F).length === 0
  const prev = bySig.get(g)
  if (!prev) { bySig.set(g, { steps, an, sig: g, feasible, repFeasible: feasible }); continue }
  const better = (feasible && !prev.repFeasible)
    || (feasible === prev.repFeasible && steps.length < prev.steps.length)
  if (better) { prev.steps = steps; prev.an = an; prev.repFeasible = feasible }
  prev.feasible = prev.feasible || feasible
}

/** every distinct causal signature, each tagged feasible / refuted by the simulator */
export const all = [...bySig.values()]
export const feasibles = all.filter(r => r.feasible)

// ---- the transparent structural objective ----
// Lifted into grove-objective.mjs so that consumers wanting only U_i do not have to trigger
// the enumeration above, which runs at import time. Re-exported here unchanged, so every
// existing importer of grove-core keeps working.
export { features, dimsOf, Uw, U, label } from './grove-objective.mjs'

/**
 * Map a coarse claim (who wielded, what manner, which weapon) onto an enumerated signature.
 * `teller` resolves "self" to the witness speaking (not always the victim).
 * Matching is CHARITABLE to the claim: an account that does not specify, say, whether the
 * victim was still bound is counted refuted only if NO variant consistent with it is
 * feasible. Otherwise a baseline would be punished for detail it never asserted.
 */
export function matchSignature({ wielder, manner, weapon }, teller) {
  const m = String(manner || '').toLowerCase(), wp = String(weapon || '').toLowerCase()
  const blade = /sword|katana|longsword/.test(wp) ? 'longsword' : 'dagger'
  let actor = (String(wielder) === 'self') ? teller : wielder
  let type = 'strike'
  if (/suicide|own hand/.test(m) || actor === 'Takehiro') { actor = 'Takehiro'; type = 'self_strike' }
  if (/impal|threw himself|fell (up)?on/.test(m)) { actor = 'Takehiro'; type = 'impale_on_held' }
  const cands = all.filter(r => r.sig.startsWith(`${actor}|${type}|${blade}|`))
  if (!cands.length) return null
  return cands.find(r => r.feasible) || cands[0]
}
