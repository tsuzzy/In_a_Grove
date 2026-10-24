#!/usr/bin/env node
// Self-test for Eq. (3) on The Ring and the Book.
//
// The load-bearing tests are [1] — the derived atom weights are RE-DERIVED here from
// ring-objective.mjs rather than trusted, so the hard-coded vector in ring-hearing.mjs cannot
// silently go stale — and [2], the regression anchors: at beta=0 the hearing must reproduce
// the Eq. (2) optimum exactly, not approximately, for every witness.
//
// Usage: node recon/test-ring-hearing.mjs   (no API key)

import * as RH from './ring-hearing.mjs'
import { CAST, features, U, Uw, brief } from './ring-objective.mjs'
import { COORDS } from './ring-core.mjs'
import { LADDER } from './ring-evidence.mjs'

let pass = 0, fail = 0
const expect = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${detail}`) }
}
const EPS = 1e-12
const space = RH.buildSpace()
const pool = RH.fullPool(space)
const allPool = RH.poolFor(space, [])

// ---------- 1) the derived atom weights are actually derived ----------
console.log('\n[1] atom weights are derived from the objective, not chosen')
{
  const DIMS = ['warrant', 'provocation', 'bearing', 'innocence', 'purity', 'efficacy']
  const dom = {}
  for (const c of COORDS) dom[c] = [...new Set(allPool.map(r => r.g[c]))]
  const derived = {}
  for (const c of COORDS) {
    const seen = new Set()
    for (const r of allPool) for (const T of CAST) {
      const base = features(T, r.g)
      for (const v of dom[c]) {
        const f2 = features(T, { ...r.g, [c]: v })
        for (const d of DIMS) if (Math.abs(f2[d] - base[d]) > EPS) seen.add(d)
      }
    }
    derived[c] = seen.size
  }
  for (const c of COORDS) {
    expect(`w(${c}) = ${derived[c]}`, RH.DERIVED_W[c] === derived[c],
      `declared ${RH.DERIVED_W[c]}, re-derived ${derived[c]}`)
  }
  expect('every coordinate is read by at least one feature',
    COORDS.every(c => derived[c] >= 1))
  expect('the claim grain is exactly the coordinates two or more features read',
    RH.CLAIM_COORDS.join(',') === COORDS.filter(c => derived[c] >= 2).join(','))
}

// ---------- 2) regression anchors ----------
console.log('\n[2] regression anchors: Eq.(3) degenerates to Eq.(2) exactly')
{
  const h = RH.runHearing({ pool, obj: RH.makePayoff({ beta: 0 }) })
  for (const T of CAST) {
    const f = (r) => U[T](features(T, r.g))
    const best = Math.max(...pool.map(f))
    expect(`beta=0 gives ${T} their Eq.(2) optimum`, Math.abs(f(h.profile[T]) - best) < EPS,
      `got ${f(h.profile[T])}, want ${best}`)
  }
  expect('beta=0 settles rather than cycling', h.terminal.kind === 'settled')

  // gamma and delta are independently inert
  const base = RH.runHearing({ pool, obj: RH.makePayoff({ beta: 0.5, gamma: 0, delta: 0 }) })
  const g0 = RH.runHearing({ pool, obj: RH.makePayoff({ beta: 0.5, gamma: 0, delta: 0.4 }) })
  expect('with nobody yet caught out, delta changes nothing',
    CAST.every(T => base.profile[T].assertion === g0.profile[T].assertion))
  expect('selfConsistency is 1 when gamma=0',
    RH.selfConsistency(pool[0], pool[1], 0) === 1)
  expect('standing is 1 when delta=0', RH.standing(3, 0) === 1)
  expect('standing falls with refutations', RH.standing(1, 0.3) < 1 && RH.standing(2, 0.3) < RH.standing(1, 0.3))
  expect('standing floors at 0 rather than going negative', RH.standing(99, 0.3) === 0)
}

// ---------- 3) corroboration behaves ----------
console.log('\n[3] corroboration')
{
  const same = Object.fromEntries(CAST.map(T => [T, pool[0]]))
  const cSame = RH.credibility(CAST[0], same)
  expect('total agreement gives credibility 1', Math.abs(cSame - 1) < EPS)
  const differ = { [CAST[0]]: pool[0], [CAST[1]]: pool[1], [CAST[2]]: pool[2] }
  const cDiff = RH.credibility(CAST[0], differ)
  expect('disagreement lowers credibility', cDiff < cSame)
  expect('credibility stays above 1/3', cDiff > 1 / 3)
  expect('drift from oneself is zero', RH.drift(pool[0], pool[0]) === 0)
  expect('drift is symmetric', Math.abs(RH.drift(pool[0], pool[3]) - RH.drift(pool[3], pool[0])) < EPS)
}

// ---------- 4) determinism ----------
console.log('\n[4] the hearing is a pure function of its inputs')
{
  const p = { beta: 0.6, gamma: 0.5, delta: 0.3 }
  const a = RH.runHearing({ pool, obj: RH.makePayoff(p) })
  const b = RH.runHearing({ pool, obj: RH.makePayoff(p) })
  expect('same inputs, same profile',
    CAST.every(T => a.profile[T].assertion === b.profile[T].assertion))
  expect('same inputs, same move count', a.moves.length === b.moves.length)
  const shuffled = RH.poolFor(space, []).slice().reverse()
  const full = shuffled.filter(r => pool.some(x => x.assertion === r.assertion))
  const c = RH.runHearing({ pool: full, obj: RH.makePayoff(p) })
  expect('and the answer does not depend on the order the pool arrived in',
    CAST.every(T => a.profile[T].assertion === c.profile[T].assertion))
}

// ---------- 5) evidence during the hearing ----------
console.log('\n[5] documents arriving during the hearing')
{
  const p = { beta: 0.5, gamma: 0.5, delta: 0.3 }
  const r = RH.replay({ space, facts: LADDER, params: p })
  expect('the full ladder leaves the record\'s feasible set', r.pool.length === pool.length)
  expect('every surviving account is feasible under the record',
    CAST.every(T => r.pool.some(x => x.assertion === r.state.profile[T].assertion)))
  const caughtTotal = r.turns.reduce((s, t) => s + t.caught.length, 0)
  expect('somebody is caught out along the way', caughtTotal > 0)
  expect('refutation counts match the turning points',
    CAST.reduce((s, T) => s + r.state.refutations[T], 0) === caughtTotal)

  const again = RH.replay({ space, facts: LADDER, params: p })
  expect('replay is a pure function of the sequence',
    CAST.every(T => r.state.profile[T].assertion === again.state.profile[T].assertion))

  // order matters: same documents, different sequence, different hearing
  const rev = RH.replay({ space, facts: [...LADDER].reverse(), params: p })
  expect('the reversed ladder reaches the same feasible set', rev.pool.length === r.pool.length)
  const fwdCaught = r.turns.filter(t => t.caught.length).map(t => t.fact).join(',')
  const revCaught = rev.turns.filter(t => t.caught.length).map(t => t.fact).join(',')
  expect('but the turning points differ', fwdCaught !== revCaught,
    `fwd=[${fwdCaught}] rev=[${revCaught}]`)

  // a witness caught out cannot repair standing by speaking again
  const anyCaught = CAST.find(T => r.state.refutations[T] > 0)
  if (anyCaught) {
    expect('being caught out permanently lowers standing',
      RH.standing(r.state.refutations[anyCaught], 0.3) < 1)
  } else { expect('being caught out permanently lowers standing', false, '(nobody caught)') }
}

// ---------- 6) the coupling actually couples ----------
console.log('\n[6] the coupling is not inert')
{
  const indep = RH.runHearing({ pool, obj: RH.makePayoff({ beta: 0 }) })
  let moved = false
  for (const beta of [0.5, 0.6, 0.7, 0.8, 0.9]) {
    const h = RH.runHearing({ pool, obj: RH.makePayoff({ beta, gamma: 0.5, delta: 0.3 }) })
    if (CAST.some(T => h.profile[T].assertion !== indep.profile[T].assertion)) moved = true
  }
  expect('some witness revises under the pressure to be believed', moved)
  const hi = RH.runHearing({ pool, obj: RH.makePayoff({ beta: 0.9, gamma: 0.5, delta: 0.3 }) })
  expect('the hearing terminates (settles or cycles), never runs away',
    hi.terminal.kind === 'settled' || hi.terminal.kind === 'cycle')
  const aud = RH.jointAudit(hi.profile)
  expect('the audit reports a claim count in range',
    aud.distinctClaims >= 1 && aud.distinctClaims <= CAST.length)
}

// ---------- 7) both domains run the SAME solver ----------
console.log('\n[7] the two benchmarks share one Eq.(3) implementation')
{
  const groveH = await import('./hearing-core.mjs')
  const engine = await import('./hearing-engine.mjs')
  expect('hearing-core is built from hearing-engine', typeof engine.makeHearing === 'function')
  const fns = ['makePayoff', 'openHearing', 'continueHearing', 'applyEvidence', 'runHearing',
    'credibility', 'drift', 'selfConsistency', 'standing', 'jointAudit']
  expect('both bindings expose the same solver surface',
    fns.every(f => typeof groveH[f] === 'function' && typeof RH[f] === 'function'))
  expect('the shared primitives are literally the same function',
    groveH.standing === RH.standing,
    '(standing takes no domain input, so both bindings must share it)')
  expect('domain-dependent primitives are correctly NOT shared',
    groveH.credibility !== RH.credibility)
}

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
