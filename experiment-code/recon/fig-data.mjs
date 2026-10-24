#!/usr/bin/env node
// Dump everything a figure needs about the first domain, as JSON.
//
// The drawing moved to matplotlib (fig-method3.py) because hand-placing TikZ nodes is what
// produced the collisions in v1/v2 — and, worse, produced the reflex of *labelling my way out*
// of them. A plotting library that owns the layout removes both problems. This file keeps the
// repository's rule intact: numbers are recomputed here from grove-core.mjs and never typed
// into the drawing.
//
// Usage: node recon/fig-data.mjs > recon/fig-data.json

import { all, feasibles, features, U, F, statesExplored, resolvedCount, CAST } from './grove-core.mjs'

const ROLE = { Tajomaru: 'bandit', Masago: 'wife', Takehiro: 'samurai' }
const u = (T, rec) => Math.round(100 * U[T](features(T, rec.an)))
const parts = (rec) => {
  const [actor, type, weapon, b, a] = rec.sig.split('|')
  return { actor, type, weapon, bound: b === 'bound:true', armed: a === 'armed:true' }
}

const assertions = all.map(rec => {
  const p = parts(rec)
  return {
    sig: rec.sig,
    blames: ROLE[p.actor],
    manner: p.type === 'impale_on_held' ? 'impale' : p.type,
    blade: p.weapon,
    bound: p.bound,
    armed: p.armed,
    feasible: rec.feasible,
    u: Object.fromEntries(CAST.map(T => [ROLE[T], u(T, rec)])),
  }
})

const agents = Object.fromEntries(CAST.map(T => {
  const maxAll = Math.max(...all.map(r => u(T, r)))
  const maxFeas = Math.max(...feasibles.map(r => u(T, r)))
  const argFeas = feasibles.filter(r => u(T, r) === maxFeas)
  return [ROLE[T], {
    maxAll,
    maxFeas,
    bites: maxAll > maxFeas,
    nTiedAtMax: argFeas.length,
    nTiedNamingSelf: argFeas.filter(r => parts(r).actor === T).length,
    bestWhileOwningIt: Math.max(...feasibles.filter(r => parts(r).actor === T).map(r => u(T, r))),
  }]
}))

// The claims the drawing is allowed to make, checked here so a stale figure cannot ship.
const checks = {
  factorsAsMannerByBlade: new Set(assertions.map(a => `${a.blames}|${a.manner}|${a.bound}|${a.armed}`)).size * 2 === all.length,
  cutIsExactlyTheBlade: assertions.every(a => a.feasible === (a.blade === 'dagger')),
  onlyOneAgentIsBitten: Object.values(agents).filter(a => a.bites).length === 1,
  // "a sword duel" would require the victim to be free; he need only be armed.
  optimumNeedsArmed: assertions.filter(a => a.u.bandit === agents.bandit.maxAll).every(a => a.armed),
  optimumNeedsUnbound: assertions.filter(a => a.u.bandit === agents.bandit.maxAll).every(a => !a.bound),
}
for (const [k, v] of Object.entries(checks)) {
  if (k === 'optimumNeedsUnbound') continue          // reported, not required
  if (!v) throw new Error(`the figure's premise no longer holds: ${k}`)
}

console.log(JSON.stringify({
  statesExplored, resolvedCount,
  nAssertions: all.length,
  nFeasible: feasibles.length,
  facts: F,
  assertions,
  agents,
  checks,
}, null, 1))
