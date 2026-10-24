#!/usr/bin/env node
// JOINT testimony analysis — what emerges when the three self-interested accounts are
// laid side by side. NO LLM: everything is read off the enumerated feasible set and the
// structural objective in grove-core.mjs.
//
// Each witness independently picks the whole-scene history τ̂_i that maximizes U_i over
// Feasible(F). This script asks the questions that only exist for the TUPLE (τ̂_1,τ̂_2,τ̂_3):
//   1. Is each individually consistent with the evidence?      (deniable alone?)
//   2. Are they JOINTLY satisfiable — one world fitting all?   (deniable together?)
//   3. Who does each account accuse?                            (the blame graph)
//   4. Which feasible attributions does NO witness ever voice?  (incentive-censored)
//
// Usage: node recon/joint.mjs   (no API key)

import { CAST, all, feasibles, features, U, Uw, rand, label } from './grove-core.mjs'

const argmaxBy = (arr, f) => arr.slice().sort((a, b) => (f(b) - f(a)) || (a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0))[0]
const claimKey = r => `${r.an.fatal.actor}|${r.an.fatal.type}|${r.an.fatal.weapon}`
const who = r => r.an.fatal.type === 'self_strike' ? 'Takehiro (his own hand)'
  : r.an.fatal.type === 'impale_on_held' ? `Takehiro (fell on ${r.an.fatal.actor === 'Takehiro' ? 'the held' : r.an.fatal.actor + "'s"} blade)`
  : `${r.an.fatal.actor}`
const accuses = r => r.an.fatal.actor   // the agent the account blames for the fatal act

// ---- 1. the three accounts at equal weights ----
const W = [1, 1, 1]
const acc = {}
for (const T of CAST) acc[T] = argmaxBy(feasibles, r => U[T](features(T, r.an)))

console.log('\n=== The three self-interested accounts (equal weights) ===')
for (const T of CAST) console.log(`  ${T.padEnd(9)} claims:  ${label(acc[T].an)}   [blames: ${accuses(acc[T])}]`)

// ---- 2. individually feasible vs jointly satisfiable ----
const indivFeasible = CAST.every(T => acc[T].feasible)
const claims = CAST.map(T => claimKey(acc[T]))
const distinctClaims = new Set(claims)
// a single death has ONE fatal (actor,type,weapon); the accounts assert `distinctClaims.size`
// different ones, so at most one can be true.
const jointlySat = distinctClaims.size === 1
console.log('\n=== Deniability, alone vs together ===')
console.log(`  each account individually inside Feasible(F): ${indivFeasible}  (the evidence refutes none of them)`)
console.log(`  distinct fatal claims asserted: ${distinctClaims.size}/3`)
console.log(`  jointly satisfiable (one world fits all three): ${jointlySat}`)
console.log(`  => at most ${jointlySat ? 3 : 1} can be true; the SET proves at least ${Math.max(0, CAST.length - (jointlySat ? 3 : 1))} are lies,`)
console.log(`     though the evidence alone convicts none. Deniability does not add up.`)

// pairwise agreement
console.log('\n  pairwise agreement on the fatal act:')
for (let i = 0; i < CAST.length; i++) for (let j = i + 1; j < CAST.length; j++)
  console.log(`    ${CAST[i]} vs ${CAST[j]}: ${claims[i] === claims[j] ? 'agree' : 'contradict'}`)

// ---- 3. blame graph + who is left unaccused ----
const accused = new Set(CAST.map(T => accuses(acc[T])))
const unaccused = CAST.filter(a => !accused.has(a))
console.log('\n=== The blame graph ===')
for (const T of CAST) console.log(`  ${T} --accuses--> ${accuses(acc[T])}`)
console.log(`  agents no account blames at these weights: ${unaccused.join(', ') || '(none)'}`)

// is being unaccused actually forced by the evidence, or just unserved by anyone's interest?
const feasibleActors = new Set(feasibles.map(r => r.an.fatal.actor))
for (const a of unaccused) {
  const couldHaveDoneIt = feasibleActors.has(a)
  console.log(`    - "${a} struck the blow" is ${couldHaveDoneIt ? 'PERMITTED by the evidence' : 'refuted by the evidence'}; ` +
    `${couldHaveDoneIt ? 'the unanimity is incentive-driven, not evidence — no teller is served by accusing ' + a + '.' : ''}`)
}

// ---- 4. coverage: which feasible attributions can EVER be voiced? ----
const feasibleClaims = new Set(feasibles.map(claimKey))
const voicedDefault = new Set(claims)
// sweep weights: collect every claim that is SOME witness's argmax under SOME weighting
const everVoiced = new Set()
for (let t = 0; t < 20000; t++) {
  const rw = () => [rand(), rand(), rand()]
  for (const T of CAST) everVoiced.add(claimKey(argmaxBy(feasibles, r => Uw(T, features(T, r.an), rw()))))
}
const gapDefault = [...feasibleClaims].filter(c => !voicedDefault.has(c))
const gapPersistent = [...feasibleClaims].filter(c => !everVoiced.has(c))
console.log('\n=== Coverage of the deniability space by self-interested testimony ===')
console.log(`  feasible fatal attributions total: ${feasibleClaims.size}`)
console.log(`  voiced at equal weights: ${voicedDefault.size}  ->  unvoiced: ${gapDefault.map(c => c.split('|').slice(0, 2).join(' ')).join(', ') || '(none)'}`)
console.log(`  voiced under SOME weighting (20k sweep): ${everVoiced.size}`)
console.log(`  NEVER voiced by any witness under any weighting: ${gapPersistent.map(c => c.split('|').slice(0, 2).join(' ')).join(', ') || '(none)'}`)
console.log(`  reading: a feasible truth surfaces in testimony only if it serves some teller.`)
// computed, not asserted: which attribution goes unvoiced depends on the objective, and it
// moved once the rope-cutter stopped counting toward agency (see grove-core.mjs). Earlier
// versions hard-coded "the bandit did it" here; that is no longer what falls out.
if (gapDefault.length) console.log(`           at balanced incentives ${gapDefault.map(c => `"${c.split('|').slice(0, 2).join(' ')}"`).join(', ')} ` +
  `${gapDefault.length > 1 ? 'go' : 'goes'} unvoiced though the evidence permits ${gapDefault.length > 1 ? 'them' : 'it'}.`)
else console.log(`           at balanced incentives every feasible attribution is voiced by someone.`)

// ---- machine-readable dump for the project page ----
import { writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
writeFileSync(HERE + '/joint-data.json', JSON.stringify({
  accounts: CAST.map(T => ({ witness: T, label: label(acc[T].an), blames: accuses(acc[T]), claim: claimKey(acc[T]) })),
  indivFeasible, distinctClaims: distinctClaims.size, jointlySat,
  atMostTrue: jointlySat ? 3 : 1, provenLies: jointlySat ? 0 : CAST.length - 1,
  blame: CAST.map(T => ({ from: T, to: accuses(acc[T]) })),
  unaccused, feasibleClaims: [...feasibleClaims], voicedDefault: [...voicedDefault],
  gapDefault, everVoiced: [...everVoiced], gapPersistent,
}, null, 1))
console.log('\nwritten: recon/joint-data.json')
