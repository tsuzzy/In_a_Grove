#!/usr/bin/env node
// THE COUPLED TESTIMONY GAME — reporting script (the game-layer analogue of optimize.mjs).
// All computation lives in game-core.mjs, which imports but never modifies grove-core.mjs.
//
// The question: V1 solved each witness in isolation and found three irreconcilable accounts.
// What happens when each witness can ANTICIPATE the others — when the bandit guesses the
// wife will blame the husband, and revises his own story accordingly?
//
// Usage: node recon/game.mjs [--beta 0.5] [--K 12] [--samples 2000]   (no API key)

import { writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CAST, feasibles, label, tag, rand, argmaxBy, Uself, Utot, credibility, claimKey,
  level0, levelK, nashEquilibria, jointAudit, frameUp, profileKey, DEFAULT_ATOM_W,
  TRUTH_CLAIM, assertsTruth,
} from './game-core.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? Number(process.argv[i + 1]) : d }
const BETA = arg('beta', 0.5)
const K = arg('K', 12)
const SAMPLES = arg('samples', 2000)

const pct = (x) => `${(100 * x).toFixed(1)}%`
const u100 = (x) => Math.round(100 * x)
const show = (p) => CAST.map(T => `${T}→${tag(p[T])}`).join('  |  ')

// ================================================================= 1. regression anchor
console.log('\n=== 1. level-0 IS V1 (regression anchor) ===')
console.log('No witness anticipates anyone; each solves argmax U_i over Feasible(F).\n')
const p0 = level0()
// Updated when the rope-cutter left the objective: Masago's ceiling fell 81 -> 75 and her
// argmax moved off the contested-impaling account onto blaming the bandit.
const V1_EXPECTED = {
  Tajomaru: 'Masago — dagger killing (dagger)',
  Masago: 'Tajomaru — dagger killing (dagger)',
  Takehiro: 'Takehiro (self) — suicide (dagger)',
}
let anchorOk = true
for (const T of CAST) {
  const got = label(p0[T].an)
  const ok = got === V1_EXPECTED[T]
  if (!ok) anchorOk = false
  console.log(`  ${ok ? '✓' : '✗'} ${T.padEnd(9)} ${got.padEnd(42)} U_self=${u100(Uself(T, p0[T]))}`)
}
console.log(`\n  ${anchorOk ? 'MATCHES optimize.mjs exactly.' : '*** MISMATCH — stop and investigate ***'}`)
if (!anchorOk) process.exit(1)

const a0 = jointAudit(p0)
console.log(`  joint audit: distinct claims ${a0.distinctClaims}/3, jointly satisfiable ${a0.jointlySat},`)
console.log(`               proven lies ${a0.provenLies}, unaccused ${a0.unaccused.join(',') || '(none)'}`)

// ================================================================= 2. the ties under V1
console.log('\n=== 2. how much of V1\'s headline rests on a tie-break? ===')
console.log('Found while building this layer. It is a fact about V1, not about the game.\n')
const tiesFor = (T) => {
  const best = Math.max(...feasibles.map(r => Uself(T, r)))
  return feasibles.filter(r => Math.abs(Uself(T, r) - best) < 1e-12)
}
for (const T of CAST)
  console.log(`  ${T.padEnd(9)} is indifferent among ${tiesFor(T).length}/${feasibles.length} feasible accounts at U=${u100(Math.max(...feasibles.map(r => Uself(T, r))))}`)

const tieProfiles = []
for (const a of tiesFor(CAST[0])) for (const b of tiesFor(CAST[1])) for (const c of tiesFor(CAST[2]))
  tieProfiles.push({ [CAST[0]]: a, [CAST[1]]: b, [CAST[2]]: c })
const tieSpread3 = tieProfiles.filter(p => jointAudit(p).distinctClaims === 3).length
const tieJsat = tieProfiles.filter(p => jointAudit(p).jointlySat).length
const tieUnacc = tieProfiles.filter(p => jointAudit(p).unaccused.includes('Tajomaru')).length
console.log(`\n  equally-optimal profiles at equal weights: ${tieProfiles.length}`)
console.log(`    "3/3 Rashomon spread"          holds in ${tieSpread3}/${tieProfiles.length}  (${pct(tieSpread3 / tieProfiles.length)})`)
console.log(`    jointly SATISFIABLE            in ${tieJsat}/${tieProfiles.length}  (${pct(tieJsat / tieProfiles.length)})  <- V1 reports 0 of these`)
console.log(`    "nobody accuses Tajomaru"      holds in ${tieUnacc}/${tieProfiles.length}  (${pct(tieUnacc / tieProfiles.length)})  <- NOT tie-robust either`)
for (const p of tieProfiles.filter(p => jointAudit(p).jointlySat))
  console.log(`\n    the jointly-satisfiable one: ${show(p)}`)
console.log(`\n  Reading: V1's "the SET proves ≥2 lies" is selected by argmaxBy's string tie-break,`)
console.log(`  not forced by the objective. optimize.mjs's 5000-weighting sweep already hedges the`)
console.log(`  SPREAD claim; joint.mjs's proven-lies claim carries no such hedge and needs one.`)

// ================================================================= 3. level-k trajectory
console.log(`\n=== 3. level-k best responses at β=${BETA} ===`)
console.log('Each step: every witness answers the PREVIOUS profile of the other two.')
console.log('The trajectory is the public record — each step is a change of story.\n')
const { traj, terminal } = levelK(K, BETA)
for (let k = 0; k < traj.length; k++) {
  const p = traj[k]
  const changed = k > 0 ? CAST.filter(T => p[T].sig !== traj[k - 1][T].sig) : []
  console.log(`  k=${k}  ${show(p)}`)
  console.log(`        cred: ${CAST.map(T => `${T.slice(0, 3)}=${u100(credibility(T, p))}`).join(' ')}` +
    `   U_self: ${CAST.map(T => `${T.slice(0, 3)}=${u100(Uself(T, p[T]))}`).join(' ')}` +
    (k > 0 ? `   changed: ${changed.join(',') || '(none)'}` : ''))
}
console.log(`\n  terminated: ${terminal.kind}${terminal.at !== null ? ` at k=${terminal.at}` : ''}` +
  `${terminal.period ? ` (period ${terminal.period})` : ''}`)

const pInf = traj[traj.length - 1]
const aInf = jointAudit(pInf)
const fu = frameUp(pInf)
console.log(`\n  limit profile audit: distinct claims ${aInf.distinctClaims}/3, jointly satisfiable ${aInf.jointlySat},`)
console.log(`                       proven lies ${aInf.provenLies}, unaccused ${aInf.unaccused.join(',') || '(none)'}`)
console.log(`  frame-up (≥2 witnesses converge on blaming a third): ${fu ? `${fu.colluders.join('+')} → ${fu.target}` : 'none'}`)

const coordCost = CAST.reduce((s, T) => s + (Uself(T, p0[T]) - Uself(T, pInf[T])), 0)
console.log(`\n  cost of coordination Σ_i [U_i(level-0) − U_i(limit)] = ${u100(coordCost)} / 300`)
console.log(`  ${Math.abs(coordCost) < 1e-9
  ? '=> ZERO. Agreeing costs these witnesses nothing — they were already indifferent.'
  : '=> agreement is not free; somebody gives up self-interest to be corroborated.'}`)

// ================================================================= 4. equilibria
console.log(`\n=== 4. pure-strategy Nash equilibria (brute force over ${feasibles.length}³ = ${feasibles.length ** 3} profiles) ===`)
const eqB = nashEquilibria(BETA)
const eqJsat = eqB.filter(p => jointAudit(p).jointlySat).length
console.log(`  at β=${BETA}: ${eqB.length} equilibria, ${eqJsat} of them jointly satisfiable`)
console.log(`  limit of level-k is an equilibrium: ${eqB.some(p => profileKey(p) === profileKey(pInf))}`)
for (const p of eqB.slice(0, 8)) console.log(`    ${show(p)}${jointAudit(p).jointlySat ? '  [jointly sat]' : ''}`)
if (eqB.length > 8) console.log(`    … and ${eqB.length - 8} more`)

// ---- is the TRUTH an equilibrium? ----
console.log(`\n  τ* (the committed ledger) says: ${TRUTH_CLAIM.split('|').join(' ')} — Masago struck the throat.`)
const truthRecs = feasibles.filter(assertsTruth)
const truthProfiles = []
for (const a of truthRecs) for (const b of truthRecs) for (const c of truthRecs)
  truthProfiles.push({ [CAST[0]]: a, [CAST[1]]: b, [CAST[2]]: c })
const eqTruthful = eqB.filter(p => CAST.every(T => assertsTruth(p[T])))
console.log(`  unanimous-on-the-truth profiles: ${truthProfiles.length}; of these, Nash at β=${BETA}: ${eqTruthful.length}`)

// sweep: at which β does a truthful consensus first become stable?
const truthScan = []
for (let i = 0; i <= 20; i++) {
  const b = i / 20
  const eq = nashEquilibria(b)
  truthScan.push({
    beta: b, equilibria: eq.length,
    truthful: eq.filter(p => CAST.every(T => assertsTruth(p[T]))).length,
    jointlySat: eq.filter(p => jointAudit(p).jointlySat).length,
    stories: new Set(eq.map(p => CAST.map(T => claimKey(p[T])).join('/'))).size,
  })
}
const firstTruthful = truthScan.find(s => s.truthful > 0)
console.log(`  β at which a truthful consensus first becomes stable: ` +
  `${firstTruthful ? `β = ${firstTruthful.beta.toFixed(2)}` : 'never in [0,1]'}`)
console.log(`  => below it, EVERY stable consensus is a false one. The truth becomes stable only`)
console.log(`     once being corroborated outweighs self-interest — and even then it is just one`)
console.log(`     of ${firstTruthful ? truthScan[truthScan.length - 1].stories : '?'} stable stories, with nothing selecting it.`)
const eqClaims = new Set(eqB.map(p => CAST.map(T => claimKey(p[T])).join('/')))
console.log(`  distinct consensus stories stable at β=${BETA}: ${eqClaims.size}`)
console.log(`  => coordination does not even select ONE story; several mutually exclusive`)
console.log(`     consensuses are each stable, and which one you land on is path-dependent.`)

// ================================================================= 5. the β sweep
console.log('\n=== 5. β sweep — does the audit tool survive strategic interaction? ===')
console.log('V1\'s headline needs the three accounts to be jointly UNSATISFIABLE: that is what')
console.log('proves ≥2 lies without knowing the truth. Watch what anticipation does to it.\n')
console.log('   β     level-k limit                          distinct  jointlySat  provenLies  frame-up')
const sweep = []
for (let i = 0; i <= 20; i++) {
  const b = i / 20
  const { traj: tr, terminal: tm } = levelK(K, b)
  const p = tr[tr.length - 1]
  const a = jointAudit(p)
  const f = frameUp(p)
  sweep.push({
    beta: b, terminal: tm.kind, distinctClaims: a.distinctClaims, jointlySat: a.jointlySat,
    provenLies: a.provenLies, frameUp: f ? `${f.colluders.join('+')}→${f.target}` : null,
    profile: CAST.map(T => ({ witness: T, sig: p[T].sig, label: label(p[T].an) })),
    coordCost: CAST.reduce((s, T) => s + (Uself(T, p0[T]) - Uself(T, p[T])), 0),
  })
  console.log(`  ${b.toFixed(2)}  ${tm.kind.padEnd(6)} ${String(a.distinctClaims).padStart(8)}` +
    `${String(a.jointlySat).padStart(12)}${String(a.provenLies).padStart(12)}    ${f ? `${f.colluders.join('+')}→${f.target}` : '—'}`)
}
const firstJsat = sweep.find(s => s.jointlySat)
console.log(`\n  smallest β at which the three coordinate into ONE jointly-satisfiable story: ` +
  `${firstJsat ? `β* = ${firstJsat.beta.toFixed(2)}` : 'never in [0,1]'}`)
if (firstJsat) {
  console.log(`  At and above β*, the evidence refutes nothing and the SET refutes nothing either:`)
  console.log(`  provenLies drops ${a0.provenLies} → 0. The auditor's truth-free proof is gone.`)
}

// ================================================================= 6. robustness
console.log(`\n=== 6. robustness: ${SAMPLES} random self-interest weightings × random atom weightings ===`)
console.log('Mirrors optimize.mjs\'s 5000-weighting sweep, extended to the atom weights.\n')
const rw = () => [rand(), rand(), rand()]
const raw = () => [rand(), rand(), rand(), rand(), rand()].map(x => 0.1 + x)
let nJsat0 = 0, nJsatB = 0, nSpread0 = 0, nSpreadB = 0, nFrame = 0, nFreeCoord = 0, nUnacc = 0
for (let t = 0; t < SAMPLES; t++) {
  const w = Object.fromEntries(CAST.map(T => [T, rw()]))
  const atomW = raw()
  // same solver as above, but each witness carries its own random weight vector.
  // tie-breaks go through the shared argmaxBy — never re-implemented here.
  const lvl0 = {}
  for (const T of CAST) lvl0[T] = argmaxBy(feasibles, r => Uself(T, r, w[T]))
  let cur = lvl0
  const seen = new Set([profileKey(cur)])
  for (let k = 1; k <= K; k++) {
    const next = {}
    for (const T of CAST)
      next[T] = argmaxBy(feasibles, r => Utot(T, { ...cur, [T]: r }, BETA, { w: w[T], atomW }))
    const nk = profileKey(next)
    cur = next
    if (seen.has(nk)) break
    seen.add(nk)
  }
  const A0 = jointAudit(lvl0), AB = jointAudit(cur)
  if (A0.jointlySat) nJsat0++
  if (AB.jointlySat) nJsatB++
  if (A0.distinctClaims === 3) nSpread0++
  if (AB.distinctClaims === 3) nSpreadB++
  if (frameUp(cur)) nFrame++
  if (AB.unaccused.includes('Tajomaru')) nUnacc++
  const cc = CAST.reduce((s, T) => s + (Uself(T, lvl0[T], w[T]) - Uself(T, cur[T], w[T])), 0)
  if (Math.abs(cc) < 1e-9) nFreeCoord++
}
console.log(`  level-0 (V1, independent):   3/3 spread ${pct(nSpread0 / SAMPLES)}   jointly satisfiable ${pct(nJsat0 / SAMPLES)}`)
console.log(`  level-k (β=${BETA}, coupled): 3/3 spread ${pct(nSpreadB / SAMPLES)}   jointly satisfiable ${pct(nJsatB / SAMPLES)}`)
console.log(`  frame-up (≥2 blame a third): ${pct(nFrame / SAMPLES)}`)
console.log(`  coordination was FREE (no U_self given up): ${pct(nFreeCoord / SAMPLES)}`)
console.log(`  "nobody accuses Tajomaru" survives coupling: ${pct(nUnacc / SAMPLES)}`)

// ================================================================= 7. dump
const data = {
  generatedAt: new Date().toISOString(),
  beta: BETA, K, samples: SAMPLES, atomW: DEFAULT_ATOM_W,
  anchor: { ok: anchorOk, level0: CAST.map(T => ({ witness: T, label: label(p0[T].an), sig: p0[T].sig, U: u100(Uself(T, p0[T])) })), audit: a0 },
  ties: {
    perWitness: Object.fromEntries(CAST.map(T => [T, tiesFor(T).length])),
    profiles: tieProfiles.length, spread3: tieSpread3, jointlySat: tieJsat, tajomaruUnaccused: tieUnacc,
    jointlySatProfile: tieProfiles.filter(p => jointAudit(p).jointlySat).map(p => CAST.map(T => ({ witness: T, label: label(p[T].an) }))),
  },
  trajectory: traj.map((p, k) => ({
    k, profile: CAST.map(T => ({ witness: T, sig: p[T].sig, label: label(p[T].an), cred: u100(credibility(T, p)), U: u100(Uself(T, p[T])) })),
    changed: k > 0 ? CAST.filter(T => p[T].sig !== traj[k - 1][T].sig) : [],
  })),
  terminal, limitAudit: aInf, frameUp: fu, coordCost: u100(coordCost),
  equilibria: {
    beta: BETA, count: eqB.length, jointlySat: eqJsat,
    limitIsEquilibrium: eqB.some(p => profileKey(p) === profileKey(pInf)),
    truthful: eqTruthful.length, stories: eqClaims.size,
    profiles: eqB.map(p => CAST.map(T => ({ witness: T, sig: p[T].sig, label: tag(p[T]) }))),
  },
  truth: { claim: TRUTH_CLAIM, scan: truthScan, firstTruthfulBeta: firstTruthful ? firstTruthful.beta : null },
  sweep, betaStar: firstJsat ? firstJsat.beta : null,
  robustness: {
    samples: SAMPLES,
    level0: { spread3: nSpread0 / SAMPLES, jointlySat: nJsat0 / SAMPLES },
    levelK: { spread3: nSpreadB / SAMPLES, jointlySat: nJsatB / SAMPLES },
    frameUp: nFrame / SAMPLES, freeCoordination: nFreeCoord / SAMPLES, tajomaruUnaccused: nUnacc / SAMPLES,
  },
}
writeFileSync(`${HERE}/../../demo/game-data.js`, `window.GAME = ${JSON.stringify(data, null, 1)}\n`)
writeFileSync(`${HERE}/game-data.json`, JSON.stringify(data, null, 1))
console.log('\nwritten: demo/game-data.js, recon/game-data.json\n')
