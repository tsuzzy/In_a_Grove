#!/usr/bin/env node
// NON-ENUMERATIVE RL solver for "In a Grove".  A tabular Q-learning agent interacts with the
// simulator (domain.mjs) as an MDP: state = encoded simulator state, action = legal grounded
// operator (action masking), transition = replay one more step, terminal reward = U_i if the
// finished history is feasible under F, else a penalty proportional to evidence misses.  It never
// constructs Feasible(F).  Enumeration (grove-core.mjs) is imported ONCE, only for the ground-truth
// optima (58/75/80).  See NON_ENUM_GROVE_RL_OPTIMIZATION.zh.md.
//
// Reports per witness: exact optimum, RL best, success rate over seeds, median episodes to first
// optimal feasible history.  Every number is produced by running; nothing is hard-coded.
//
// Usage: node recon/grove-rl-optimize.mjs

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { simulate, ACTIONS, diffAftermath } from './domain.mjs'
import { features, U } from './grove-objective.mjs'
import { CAST, feasibles, F } from './grove-core.mjs'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const BLADES = ['longsword', 'dagger']
const T = 8

// ---- replicated legal-move generator (grove-core.mjs:23-44) ----
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
function annotate(steps) {
  const s = initialClone(); let fatal = null
  for (const a of steps) {
    const beforeBound = s.agents.Takehiro.bound, beforeAliveT = s.agents.Takehiro.alive
    const victimArmed = BLADES.some(o => s.objects[o].holder === 'Takehiro')
    ACTIONS[a.type].eff(s, a)
    if (!fatal && beforeAliveT && s.agents.Takehiro.alive === false)
      fatal = { actor: a.actor, type: a.type, weapon: a.object, boundAtDeath: beforeBound, victimArmed }
  }
  return { fatal }
}
// canonical physical-state key (grove-core.mjs:16-21), plus fatal attribution so "who struck" splits states
const keyOf = (s) => JSON.stringify([
  CAST.map(a => [s.agents[a].alive, s.agents[a].bound, s.agents[a].present,
    s.agents[a].wounds.map(w => w.part + ':' + w.weapon + (w.selfInflicted ? 's' : w.contested ? 'c' : ''))]),
  BLADES.map(o => [s.objects[o].holder, s.objects[o].ground, s.objects[o].bloodied, !!s.objects[o].flung]),
  s.rope, s.horse])
const fatalSig = (h) => { const an = annotate(h).fatal; return an ? `${an.actor}|${an.type}|${an.weapon}|${an.boundAtDeath}|${an.victimArmed}` : '-' }

function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)]
const akey = (a) => `${a.type}|${a.actor}|${a.object ?? '-'}|${a.target ?? '-'}`

const stateAfter = (h) => simulate(h).state
const legalIn = (s) => [...groundings(s)].filter(a => ACTIONS[a.type].pre(s, a).ok)

function runRL(w, seed, EPISODES, exactU) {
  const rng = mulberry32(seed)
  const Q = new Map()                        // stateKey -> Map(actionKey -> value)
  const qget = (sk, a) => Q.get(sk)?.get(akey(a)) ?? 0
  const qmax = (sk) => { const m = Q.get(sk); if (!m || !m.size) return 0; let x = -Infinity; for (const v of m.values()) if (v > x) x = v; return x }
  const qset = (sk, a, v) => { if (!Q.has(sk)) Q.set(sk, new Map()); Q.get(sk).set(akey(a), v) }
  const eta = 0.4, gamma = 0.95
  let bestU = -1, epToOpt = null

  for (let ep = 0; ep < EPISODES && epToOpt === null; ep++) {
    const eps = 0.9 - (0.85 * ep) / EPISODES     // 0.9 -> 0.05
    const history = [], traj = []
    for (let t = 0; t < T; t++) {
      const s = stateAfter(history)
      const legal = legalIn(s)
      if (!legal.length) break
      const sk = keyOf(s) + '#' + fatalSig(history)
      let a
      if (rng() < eps) a = pick(legal, rng)
      else { let bv = -Infinity; a = legal[0]; for (const c of legal) { const v = qget(sk, c); if (v > bv) { bv = v; a = c } } }
      traj.push({ sk, a }); history.push(a)
      if (!s.agents.Takehiro.alive && rng() < 0.3) break
    }
    // terminal reward from the finished history
    const fin = stateAfter(history)
    const misses = diffAftermath(fin, F).length
    const an = annotate(history).fatal
    const u = an ? U[w](features(w, { fatal: an })) : 0     // 0..1
    const feasible = misses === 0
    const R = feasible ? 1 + u : -0.2 * misses
    if (feasible) { const u100 = Math.round(100 * u); if (u100 > bestU) bestU = u100; if (epToOpt === null && u100 >= exactU) epToOpt = ep + 1 }
    // backward Q-update: last step toward R, earlier steps toward gamma * value of next state
    for (let t = traj.length - 1; t >= 0; t--) {
      const { sk, a } = traj[t]
      const target = t === traj.length - 1 ? R : gamma * qmax(traj[t + 1].sk)
      qset(sk, a, qget(sk, a) + eta * (target - qget(sk, a)))
    }
  }
  return { bestU, epToOpt, reached: epToOpt !== null, qStates: Q.size }
}

// ---- ground truth from enumeration ----
const exact = {}
for (const Tw of CAST) exact[Tw] = Math.max(...feasibles.map(r => Math.round(100 * U[Tw](features(Tw, r.an)))))

const EPISODES = 6000, SEEDS = 8
console.log(`RL (tabular Q-learning) non-enumerative solver — In a Grove   (episodes ${EPISODES}, seeds ${SEEDS}, horizon ${T})`)
console.log(`exact optima (enumeration ground truth): ${CAST.map(t => `${t} ${exact[t]}`).join(', ')}\n`)
const out = { solver: 'tabular Q-learning', domain: 'In a Grove', horizon: T, episodes: EPISODES, seeds: SEEDS, witnesses: {} }
for (const w of CAST) {
  const runs = []
  for (let s = 1; s <= SEEDS; s++) runs.push(runRL(w, s, EPISODES, exact[w]))
  const wins = runs.filter(r => r.reached)
  const bestU = Math.max(...runs.map(r => r.bestU))
  const eps = wins.map(r => r.epToOpt).sort((a, b) => a - b)
  const median = eps.length ? eps[Math.floor(eps.length / 2)] : null
  out.witnesses[w] = { exactU: exact[w], bestRLU: bestU, successRate: +(wins.length / SEEDS).toFixed(2), medianEpisodesToOptimum: median, meanQStates: Math.round(runs.reduce((a, r) => a + r.qStates, 0) / runs.length) }
  console.log(`  ${w.padEnd(9)}: exact ${exact[w]}   RL best ${bestU}   success ${wins.length}/${SEEDS}   median episodes to optimum ${median ?? '-'}   |Q states|~${out.witnesses[w].meanQStates}`)
}
fs.writeFileSync(path.join(HERE, 'grove-rl-data.json'), JSON.stringify(out, null, 1))
console.log('\nwritten: recon/grove-rl-data.json')
