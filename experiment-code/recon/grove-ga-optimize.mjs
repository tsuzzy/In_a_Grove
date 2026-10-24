#!/usr/bin/env node
// NON-ENUMERATIVE GA solver for "In a Grove".  Searches  argmax_{tau in Feas(F)} U_i(tau)
// using ONLY the simulator (domain.mjs), the public record F, and U_i (grove-objective.mjs).
// It never constructs Feasible(F): every candidate is a bounded event history scored by replay.
// Enumeration (grove-core.mjs) is imported ONCE, only to print the ground-truth optima (58/75/80)
// the GA is measured against.  See NON_ENUM_GROVE_GENETIC_OPTIMIZATION.zh.md.
//
// Reports, per witness: exact optimum, GA best, success rate over seeds, median simulator calls to
// first reach the optimum.  Every number is produced by running; nothing is hard-coded, and the
// initial population is pure random legal rollouts (no seeded answer histories).
//
// Usage: node recon/grove-ga-optimize.mjs

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { simulate, ACTIONS, diffAftermath } from './domain.mjs'
import { features, U } from './grove-objective.mjs'
import { CAST, feasibles, F } from './grove-core.mjs'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const BLADES = ['longsword', 'dagger']
const TMAX = 7

// ---- replicated legal-move generator (grove-core.mjs:23-44), the same one behind the 3,631 states
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
          for (const t of CAST) if (t !== actor && s.agents[t].alive && s.agents[t].present) yield { type: 'strike', actor, target: t, object: obj, part: 'throat' }
          yield { type: 'self_strike', actor, object: obj, part: 'throat' }
        }
      }
      if (!g.bound && o.holder && o.holder !== actor) yield { type: 'impale_on_held', actor, object: obj, part: 'throat' }
    }
  }
}

// ---- replicated fatal-act annotator (grove-core.mjs:98-111) -> the `an` object features() reads
function annotate(steps) {
  const s = initialClone(); let fatal = null, cutter = null
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
// a private fresh initial state for annotate's throwaway replay (domain.initialState is not needed here)
function initialClone() {
  return {
    agents: { Tajomaru: { alive: true, bound: false, present: true, wounds: [] },
      Masago: { alive: true, bound: false, present: true, wounds: [] },
      Takehiro: { alive: true, bound: true, present: true, wounds: [] } },
    objects: { longsword: { holder: null, ground: true, bloodied: false },
      dagger: { holder: 'Masago', ground: false, bloodied: false } },
    rope: 'binding', horse: true, log: [],
  }
}

// ---- seedable RNG so success rates are reproducible (Date/Math.random not needed) ----
function mulberry32(seed) {
  let a = seed >>> 0
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)]

// ---- the only simulator access; every call is counted (the GA's compute budget) ----
let SIMCALLS = 0
const sim = (steps) => { SIMCALLS++; return simulate(steps) }
const stateAfter = (h) => sim(h).state
const legalIn = (s) => [...groundings(s)].filter(a => ACTIONS[a.type].pre(s, a).ok)

// pure random legal rollout, extending `prefix` with legal actions to a random length <= TMAX
function rollout(prefix, rng) {
  let h = prefix.slice(); let s = stateAfter(h)
  while (h.length < TMAX) {
    const legal = legalIn(s)
    if (!legal.length) break
    h.push(pick(legal, rng)); s = stateAfter(h)
    if (!s.agents.Takehiro.alive && rng() < 0.5) break   // allow short histories once resolved
  }
  return h
}
// longest legal prefix of a possibly-broken history (used after crossover)
function legalize(h) {
  const r = sim(h); if (r.ok) return h
  const bad = r.trace.findIndex(t => !t.ok); return bad < 0 ? [] : h.slice(0, bad)
}

// ---- lexicographic fitness: primary fewer evidence misses, secondary higher U_i, tertiary shorter
function fitness(h, w) {
  const r = sim(h)
  if (!r.ok) { const bad = r.trace.findIndex(t => !t.ok); return { misses: 99, u: -1, len: h.length, legal: bad < 0 ? h.length : bad, feasible: false } }
  const misses = diffAftermath(r.state, F).length
  const an = annotate(h)
  const u = an.fatal ? Math.round(100 * U[w](features(w, an))) : -1
  return { misses, u, len: h.length, feasible: misses === 0 }
}
const betterLex = (a, b) => a.misses !== b.misses ? a.misses < b.misses : a.u !== b.u ? a.u > b.u : a.len < b.len

const tournament = (scored, k, rng) => { let best = pick(scored, rng); for (let i = 1; i < k; i++) { const c = pick(scored, rng); if (betterLex(c.f, best.f)) best = c } return best }
function crossover(a, b, rng) {
  const p = 1 + Math.floor(rng() * Math.max(1, a.h.length - 1))
  const q = Math.floor(rng() * (b.h.length + 1))
  return rollout(legalize([...a.h.slice(0, p), ...b.h.slice(q)]), rng)
}
const mutate = (a, rng) => a.h.length ? rollout(a.h.slice(0, Math.floor(rng() * a.h.length)), rng) : rollout([], rng)

function runGA(w, seed, POP, GENS, exactU) {
  const rng = mulberry32(seed)
  let scored = Array.from({ length: POP }, () => { const h = rollout([], rng); return { h, f: fitness(h, w) } })
  let best = null, callsToOpt = null
  const consider = (h, f) => {
    if (!best || betterLex(f, best.f)) best = { h, f }
    if (callsToOpt === null && f.feasible && f.u >= exactU) callsToOpt = SIMCALLS
  }
  scored.forEach(({ h, f }) => consider(h, f))
  for (let g = 0; g < GENS && callsToOpt === null; g++) {
    const next = [best]                                   // elitism
    while (next.length < POP) {
      const pa = tournament(scored, 3, rng), pb = tournament(scored, 3, rng)
      const child = rng() < 0.7 ? crossover(pa, pb, rng) : mutate(pa, rng)
      const f = fitness(child, w); consider(child, f); next.push({ h: child, f })
    }
    scored = next
    for (let k = 0; k < 8 && callsToOpt === null; k++) { const h = mutate(best, rng); consider(h, fitness(h, w)) } // memetic local search
  }
  return { bestU: best.f.feasible ? best.f.u : -1, callsToOpt, reached: callsToOpt !== null }
}

// ---- ground truth from enumeration (the baseline the GA must recover) ----
const exact = {}
for (const T of CAST) exact[T] = Math.max(...feasibles.map(r => Math.round(100 * U[T](features(T, r.an)))))

const POP = 40, GENS = 40, SEEDS = 12
console.log(`GA non-enumerative solver — In a Grove   (pop ${POP}, gens ${GENS}, seeds ${SEEDS})`)
console.log(`exact optima (enumeration ground truth): ${CAST.map(T => `${T} ${exact[T]}`).join(', ')}\n`)
const out = { solver: 'genetic algorithm', domain: 'In a Grove', population: POP, generations: GENS, seeds: SEEDS, witnesses: {} }
for (const T of CAST) {
  const runs = []
  for (let s = 1; s <= SEEDS; s++) { SIMCALLS = 0; runs.push(runGA(T, s, POP, GENS, exact[T])) }
  const wins = runs.filter(r => r.reached)
  const bestU = Math.max(...runs.map(r => r.bestU))
  const calls = wins.map(r => r.callsToOpt).sort((a, b) => a - b)
  const median = calls.length ? calls[Math.floor(calls.length / 2)] : null
  out.witnesses[T] = { exactU: exact[T], bestGAU: bestU, successRate: +(wins.length / SEEDS).toFixed(2), medianSimulatorCalls: median }
  console.log(`  ${T.padEnd(9)}: exact ${exact[T]}   GA best ${bestU}   success ${wins.length}/${SEEDS}   median calls to optimum ${median ?? '-'}`)
}
fs.writeFileSync(path.join(HERE, 'grove-ga-data.json'), JSON.stringify({ generatedAt: null, ...out }, null, 1))
console.log('\nwritten: recon/grove-ga-data.json')
