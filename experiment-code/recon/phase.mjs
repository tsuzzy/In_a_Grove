#!/usr/bin/env node
// THE PHASE DIAGRAM — when does consistency-based auditing survive?
//
// Two pressures act on a hearing, and both are free parameters:
//   β  how much a witness wants to be CORROBORATED by the others (coordination pressure)
//   γ  how much a witness is held to their OWN OPENING statement (accountability)
//
// Earlier runs fixed one and swept the other, which gives single points: β* = 0.30 at γ=0,
// γ* = 0.23 at β=0.5. Neither is a constant of the method. This sweeps both and reports the
// BOUNDARY — for each β, the least accountability that keeps the auditor's proof alive —
// and answers the question the single points cannot: is there a coordination pressure so
// strong that no amount of accountability saves the audit?
//
// The auditor's proof is "the three accounts cannot all be true, so at least two are lies",
// available exactly when the closing record still holds 3 distinct claims (provenLies = 2).
//
// Runs on the CORRECTED domain (extended signatures from the shared history space).
// NO LLM. Usage: node recon/phase.mjs [--steps 20] [--gsteps 40]

import { writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AFTERMATH } from './domain.mjs'
import { enumerateShared, DEGENERATE, CAST } from './grove-enum.mjs'
import { hearing } from './dialogue.mjs'
import { jointAudit, claimKey } from './game-core.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? Number(process.argv[i + 1]) : d }
const BSTEPS = arg('steps', 20)
const GSTEPS = arg('gsteps', 40)

const ORDERS = [
  ['Tajomaru', 'Masago', 'Takehiro'], ['Tajomaru', 'Takehiro', 'Masago'],
  ['Masago', 'Tajomaru', 'Takehiro'], ['Masago', 'Takehiro', 'Tajomaru'],
  ['Takehiro', 'Tajomaru', 'Masago'], ['Takehiro', 'Masago', 'Tajomaru'],
]
const story = (p) => [...new Set(CAST.map(T => claimKey(p[T])))].sort().join(' + ')

const SPECS = { 'run-06': AFTERMATH["pre-B'/run-06"], akutagawa: AFTERMATH['akutagawa/canonical'] }
const space = enumerateShared({ specs: SPECS, degenerate: DEGENERATE })

const out = {}
for (const name of Object.keys(SPECS)) {
  // tie-breaks must be on the extended signature, several of which share a causal one
  const pool = space.feasibleUnder(name)
  console.log(`\n${'='.repeat(76)}`)
  console.log(`=== ${name} — ${pool.length} feasible accounts, ${space.gapUnder(name)} causal attributions ===`)
  console.log(`${'='.repeat(76)}`)

  const cell = (b, g) => {
    const h = hearing({ pool, beta: b, gamma: g })
    const a = jointAudit(h.profile)
    return {
      beta: b, gamma: g,
      revisions: h.moves.filter(m => m.act === 'revise').length,
      distinctClaims: a.distinctClaims, provenLies: a.provenLies,
      terminal: h.terminal.kind,
      safe: a.provenLies === 2,
    }
  }

  // ---- 1. the phase map ----
  // rows are β (coordination pressure), columns γ (accountability)
  console.log(`\n1. Does the auditor's proof survive?   ·=proof holds (provenLies 2)   ×=proof gone (0)`)
  console.log(`   rows β = coordination pressure, columns γ = accountability\n`)
  const grid = []
  let header = '        γ '
  for (let j = 0; j <= GSTEPS; j += 4) header += (j / GSTEPS).toFixed(2).slice(1).padEnd(5)
  console.log(header)
  for (let i = BSTEPS; i >= 0; i--) {
    const b = i / BSTEPS
    const row = []
    let line = `  β=${b.toFixed(2)}  `
    for (let j = 0; j <= GSTEPS; j++) {
      const c = cell(b, j / GSTEPS)
      row.push(c)
      line += c.safe ? '·' : '×'
    }
    grid.push(row)
    console.log(line)
  }

  // ---- 2. the boundary γ*(β) ----
  console.log(`\n2. The boundary — least accountability that keeps the proof alive, per β\n`)
  console.log(`     β      γ*      reading`)
  const boundary = []
  for (let i = 0; i <= BSTEPS; i++) {
    const b = i / BSTEPS
    const row = grid[BSTEPS - i]
    const first = row.find(c => c.safe)
    const gStar = first ? first.gamma : null
    const allSafe = row.every(c => c.safe)
    boundary.push({ beta: b, gammaStar: gStar, alwaysSafe: allSafe, neverSafe: !first })
    const reading = allSafe ? 'no coordination pressure — proof safe at any γ'
      : gStar === null ? 'NO γ in [0,1] SAVES IT'
        : `accountability must reach ${gStar.toFixed(3)}`
    console.log(`   ${b.toFixed(2)}   ${gStar === null ? ' none ' : gStar.toFixed(3)}   ${reading}`)
  }

  const lost = boundary.filter(r => r.neverSafe)
  const needs = boundary.filter(r => r.gammaStar !== null && r.gammaStar > 0)
  console.log(`\n   β for which NO accountability in [0,1] saves the proof: ` +
    `${lost.length ? `${lost.length} of ${boundary.length}  (β ≥ ${Math.min(...lost.map(r => r.beta)).toFixed(2)})` : 'none — accountability always suffices'}`)
  if (needs.length)
    console.log(`   where it does work, γ* ranges ${Math.min(...needs.map(r => r.gammaStar)).toFixed(3)} – ${Math.max(...needs.map(r => r.gammaStar)).toFixed(3)}`)

  // ---- 3. the order-dependence region ----
  // "who speaks first writes the past" was reported at γ=0; where does it actually live?
  console.log(`\n3. Where does the recorded past depend on WHO SPEAKS FIRST?\n`)
  const orderDep = []
  for (let i = 0; i <= BSTEPS; i++) {
    const b = i / BSTEPS
    const hits = []
    for (let j = 0; j <= GSTEPS; j++) {
      const g = j / GSTEPS
      const n = new Set(ORDERS.map(o => story(hearing({ pool, beta: b, gamma: g, order: o }).profile))).size
      if (n > 1) hits.push({ gamma: g, pasts: n })
    }
    if (hits.length) orderDep.push({ beta: b, gammas: hits.map(h => h.gamma), maxPasts: Math.max(...hits.map(h => h.pasts)) })
  }
  if (!orderDep.length) console.log(`   nowhere in the grid — the outcome never depends on speaking order`)
  else for (const r of orderDep)
    console.log(`   β=${r.beta.toFixed(2)}  γ ∈ {${r.gammas.map(g => g.toFixed(3)).join(', ')}}  up to ${r.maxPasts} distinct pasts`)
  const onlyAtZero = orderDep.length > 0 && orderDep.every(r => r.gammas.every(g => g === 0))
  console.log(`\n   ${onlyAtZero
    ? '=> it lives ONLY on the γ=0 edge. With any accountability at all the past is determined.'
    : '=> it survives some positive accountability.'}`)

  out[name] = {
    feasible: pool.length, gap: space.gapUnder(name),
    grid: grid.map(row => row.map(c => ({ beta: c.beta, gamma: c.gamma, safe: c.safe, revisions: c.revisions, distinctClaims: c.distinctClaims }))),
    boundary, orderDependence: orderDep, orderDependenceOnlyAtGammaZero: onlyAtZero,
  }
}

// ---- the cross-world reading ----
console.log(`\n\n${'='.repeat(76)}`)
console.log(`=== Both worlds together ===`)
console.log(`${'='.repeat(76)}\n`)
console.log(`   world      feasible  gap   β above which no γ saves the proof   γ* at β=0.5`)
for (const [name, o] of Object.entries(out)) {
  const lost = o.boundary.filter(r => r.neverSafe)
  const half = o.boundary.find(r => Math.abs(r.beta - 0.5) < 1e-9)
  console.log(`   ${name.padEnd(11)} ${String(o.feasible).padStart(8)} ${String(o.gap).padStart(4)}   ` +
    `${(lost.length ? `β ≥ ${Math.min(...lost.map(r => r.beta)).toFixed(2)}` : 'never lost').padStart(33)}   ` +
    `${half.gammaStar === null ? 'none' : half.gammaStar.toFixed(3)}`)
}

writeFileSync(`${HERE}/phase-data.json`, JSON.stringify({
  generatedAt: new Date().toISOString(), betaSteps: BSTEPS, gammaSteps: GSTEPS, worlds: out,
}, null, 1))
console.log(`\nwritten: recon/phase-data.json\n`)
