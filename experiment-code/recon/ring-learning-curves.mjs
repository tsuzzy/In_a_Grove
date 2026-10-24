#!/usr/bin/env node
// Empirical learning curves for the Ring solver comparison in Table 4.
// The generic solver engine is the same one used by solvers-report.mjs; this script only
// supplies callbacks that retain best-feasible-utility traces for plotting.

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import * as RD from './ring-domain.mjs'
import * as RO from './ring-objective.mjs'
import * as RC from './ring-core.mjs'
import { runGA, runRL } from './solver-engines.mjs'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const CAST = RO.CAST
const SETTINGS = {
  GA: { POP: 80, GENS: 300, SEEDS: 8 },
  Qlearning: { EPISODES: 12000, SEEDS: 8 },
}

function* groundings(s) {
  for (const type of Object.keys(RD.ACTIONS)) {
    if (type === 'write_letters') {
      for (const actor of ['Pompilia', 'Caponsacchi', 'Guido'])
        if (RD.ACTIONS[type].pre(s, { type, actor }).ok) yield { type, actor }
    } else if (RD.ACTIONS[type].pre(s, { type }).ok) yield { type }
  }
}

const adapter = {
  CAST,
  TMAX: 24,
  replay: (h) => { const r = RD.simulate(h); return { state: r.state, ok: r.ok } },
  legalActions: (s) => [...groundings(s)],
  misses: (s) => RD.diffRecord(s, RD.RECORD).length,
  utility: (h, s, w) => Math.round(100 * RO.U[w](RO.features(w, RD.signature(s)))),
  stateKey: (s) => JSON.stringify([s.where, s.alive, s.pompilia, s.letters, s.flight, s.child, s.suit, s.guido, s.peril]),
  terminal: (s) => (s.guido.basis !== null && s.guido.taken) || s.flight.reachedRome,
}

const space = RC.enumerate()
const feasible = space.assertionsUnder(RD.RECORD)
const exact = Object.fromEntries(CAST.map(w => [w,
  Math.max(...feasible.map(r => Math.round(100 * RO.U[w](RO.features(w, r.g)))))]))
const gap = (best, optimum) => Math.max(0, optimum - Math.max(0, best))

function gaTrace(w, seed) {
  let best = -1
  const trace = [{ x: 1, gap: gap(best, exact[w]) }]
  const onFitness = ({ calls, u, feasible: isFeasible }) => {
    if (isFeasible && u > best) best = u
    if (best === exact[w] || calls === 1 || calls % 100 === 0)
      trace.push({ x: calls, gap: gap(best, exact[w]) })
  }
  const result = runGA(adapter, w, seed,
    { ...SETTINGS.GA, onFitness }, exact[w])
  trace.push({ x: Math.max(1, result.callsToOpt ?? result.calls ?? 1), gap: gap(best, exact[w]) })
  return { trace, bestFeasible: best, ...result }
}

function qTrace(w, seed) {
  let best = -1
  const trace = [{ x: 1, gap: gap(best, exact[w]) }]
  const onEpisode = ({ episode, bestU }) => {
    if (bestU > best) best = bestU
    if (best === exact[w] || episode % 100 === 0)
      trace.push({ x: episode, gap: gap(best, exact[w]) })
  }
  const result = runRL(adapter, w, seed,
    { ...SETTINGS.Qlearning, onEpisode }, exact[w])
  trace.push({ x: Math.max(1, result.epToOpt ?? SETTINGS.Qlearning.EPISODES), gap: gap(best, exact[w]) })
  return { trace, bestFeasible: best, ...result }
}

const runs = { GA: {}, Qlearning: {} }
for (const w of CAST) {
  runs.GA[w] = Array.from({ length: SETTINGS.GA.SEEDS }, (_, i) => gaTrace(w, i + 1))
  runs.Qlearning[w] = Array.from({ length: SETTINGS.Qlearning.SEEDS }, (_, i) => qTrace(w, i + 1))
}
const median = (xs) => { const ys = xs.slice().sort((a, b) => a - b); return ys.length ? ys[Math.floor(ys.length / 2)] : null }
const summary = Object.fromEntries(CAST.map(w => [w, {
  exact: exact[w],
  GA: { success: runs.GA[w].filter(r => r.callsToOpt !== null).length,
    medianCalls: median(runs.GA[w].filter(r => r.callsToOpt !== null).map(r => r.callsToOpt)) },
  Qlearning: { success: runs.Qlearning[w].filter(r => r.epToOpt !== null).length,
    medianEpisodes: median(runs.Qlearning[w].filter(r => r.epToOpt !== null).map(r => r.epToOpt)) },
}]))

const out = {
  note: 'Best-feasible-utility traces recomputed with the same Ring adapter and settings as Table 4.',
  domain: 'The Ring and the Book', states: space.statesExplored, feasible: feasible.length,
  settings: SETTINGS, exact, runs, summary,
}
fs.writeFileSync(path.join(HERE, 'ring-learning-curves-data.json'), JSON.stringify(out, null, 1))
console.log(JSON.stringify({ states: out.states, feasible: out.feasible, summary }, null, 2))
