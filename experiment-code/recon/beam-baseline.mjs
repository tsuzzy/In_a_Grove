#!/usr/bin/env node
// Constrained beam-search baseline for the Grove benchmark.
//
// The beam is allowed to use the same replay oracle as the non-enumerative solvers,
// but it never constructs Feasible(F).  Preconditions mask illegal actions; partial
// histories are ranked by evidence misses, utility, and length.  This is a conventional
// structured-planning baseline, separate from the paper's GA and tabular Q-learning.

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { CAST, BLADES, ACTIONS, initialState, simulate, diffAftermath, AFTERMATH } from './domain.mjs'
import { features, U } from './grove-objective.mjs'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const F = AFTERMATH["pre-B'/run-06"]
const TMAX = 7
const WIDTH = Number(process.env.BEAM_WIDTH || 32)

function* groundings(s) {
  for (const actor of CAST) {
    const g = s.agents[actor]
    if (!g?.alive || !g.present) continue
    if (!g.bound) {
      yield { type: 'flee', actor }
      if (s.horse) yield { type: 'mount_flee', actor }
    }
    for (const object of BLADES) {
      const o = s.objects[object]
      if (!o) continue
      if (!g.bound && o.holder === null && o.ground) yield { type: 'take', actor, object }
      if (!g.bound && o.holder && o.holder !== actor && s.agents[o.holder]?.present)
        yield { type: 'seize', actor, object }
      if (o.holder === actor) {
        for (const target of CAST) if (target !== actor && s.agents[target]?.alive && s.agents[target]?.present)
          yield { type: 'give', actor, object, target }
        if (!g.bound && s.rope === 'binding') yield { type: 'cut_rope', actor, object }
        if (!g.bound) {
          for (const target of CAST) if (target !== actor && s.agents[target]?.alive && s.agents[target]?.present)
            yield { type: 'strike', actor, target, object, part: 'throat' }
          yield { type: 'self_strike', actor, object, part: 'throat' }
        }
      }
      if (!g.bound && o.holder && o.holder !== actor)
        yield { type: 'impale_on_held', actor, object, part: 'throat' }
    }
  }
}

function annotate(history) {
  const s = initialState()
  let fatal = null
  for (const a of history) {
    const beforeBound = s.agents.Takehiro.bound
    const beforeAlive = s.agents.Takehiro.alive
    const victimArmed = BLADES.some(o => s.objects[o].holder === 'Takehiro')
    ACTIONS[a.type].eff(s, a)
    if (!fatal && beforeAlive && !s.agents.Takehiro.alive) {
      fatal = { actor: a.actor, type: a.type, weapon: a.object,
        boundAtDeath: beforeBound, victimArmed }
    }
  }
  return { fatal }
}

const key = (history) => JSON.stringify(history)
function score(history, witness) {
  const replay = simulate(history)
  if (!replay.ok) return { misses: 9999, u: -1, len: history.length, feasible: false, key: key(history) }
  const misses = diffAftermath(replay.state, F).length
  const an = annotate(history)
  const u = an.fatal ? Math.round(100 * U[witness](features(witness, an))) : -1
  return { misses, u, len: history.length, feasible: misses === 0, key: key(history) }
}

function compare(a, b) {
  return a.misses - b.misses || b.u - a.u || a.len - b.len || a.key.localeCompare(b.key)
}

function runBeam(witness) {
  let calls = 0
  let beam = [{ history: [], state: initialState(), score: score([], witness) }]
  let best = null
  const consider = (node) => {
    calls++
    if (!node.score.feasible) return
    if (!best || node.score.u > best.score.u ||
        (node.score.u === best.score.u && node.score.key < best.score.key)) best = node
  }
  for (let depth = 0; depth <= TMAX; depth++) {
    for (const node of beam) consider(node)
    if (depth === TMAX) break
    const next = []
    for (const node of beam) {
      for (const action of groundings(node.state)) {
        const check = ACTIONS[action.type].pre(node.state, action)
        if (!check.ok) continue
        const state = structuredClone(node.state)
        ACTIONS[action.type].eff(state, action)
        const history = [...node.history, action]
        next.push({ history, state, score: score(history, witness) })
      }
    }
    next.sort((a, b) => compare(a.score, b.score))
    beam = next.slice(0, WIDTH)
    if (!beam.length) break
  }
  return { bestU: best?.score.u ?? -1, calls, reached: !!best, history: best?.history ?? null }
}

const result = { solver: 'constrained beam search', width: WIDTH, horizon: TMAX, witnesses: {} }
console.log(`Constrained beam baseline — width ${WIDTH}, horizon ${TMAX}`)
for (const witness of CAST) {
  const out = runBeam(witness)
  result.witnesses[witness] = out
  console.log(`  ${witness.padEnd(9)}: best U=${out.bestU}  feasible=${out.reached}  calls=${out.calls}`)
}
fs.writeFileSync(path.join(HERE, 'beam-baseline-data.json'), JSON.stringify(result, null, 1))
console.log('\nwritten: recon/beam-baseline-data.json')
