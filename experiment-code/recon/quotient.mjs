#!/usr/bin/env node
// TWO THINGS THE PAPER STATES AND DID NOT COMPUTE.
//
// (1) The quotient. The paper defines an assertion as the causal signature restricted to the
//     coordinates some component of J actually depends on. That is a definition, not a
//     procedure, and a reviewer asked how one would get it. It is decidable by finite
//     difference: hold a signature, vary ONE coordinate across every value it takes anywhere
//     in the space, and see whether any witness's U moves. Coordinates that never move it are
//     the ones the quotient collapses.
//
// (2) The binding dimension. Table 1 names, for each excluded optimum, the single feature on
//     which it fails. Until now that column was written by hand. It is computed here: take the
//     agent's unconstrained ideal and ask, dimension by dimension, whether ANY feasible
//     account reaches the value the ideal has. The binding dimension is the one no feasible
//     account can match.
//
//     "Which dimension drops most between the ideal and the chosen feasible account" is the
//     obvious guess and it is WRONG: the bandit gives up agency when he stops being the
//     killer, but agency is not what the evidence forbids — he could strike with the dagger
//     and keep it. What he cannot have is honour, because honour at 1 needs a longsword blow
//     and the longsword is unbloodied. The drop measures what he chose; the shortfall
//     measures what he was denied.
//
// Neither uses a language model, and neither reads a stored constant.
import { all, feasibles, CAST, features, dimsOf, U } from './grove-core.mjs'
import { RECORD } from './ring-domain.mjs'
import { enumerate, pinning } from './ring-core.mjs'
import * as RO from './ring-objective.mjs'

const COORDS = ['actor', 'type', 'weapon', 'boundAtDeath', 'victimArmed']
const readOf = (r) => ({
  actor: r.an.fatal.actor, type: r.an.fatal.type, weapon: r.an.fatal.weapon,
  boundAtDeath: r.an.fatal.boundAtDeath, victimArmed: r.an.fatal.victimArmed,
})
const EPS = 1e-12

console.log('\n(1) WHICH COORDINATES THE OBJECTIVE READS  —  decided, not declared')
console.log('    method: for each coordinate, compare every pair of assertions that agree on')
console.log('    all the others and differ only there; if no such pair changes any U_i, the')
console.log('    quotient collapses that coordinate.\n')

const rows = all.map(r => ({ r, c: readOf(r) }))
for (const c of COORDS) {
  const movedBy = new Set()
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j]
    if (a.c[c] === b.c[c]) continue
    if (COORDS.some(o => o !== c && a.c[o] !== b.c[o])) continue   // differ only in c
    for (const T of CAST)
      if (Math.abs(U[T](features(T, a.r.an)) - U[T](features(T, b.r.an))) > EPS) movedBy.add(T)
  }
  const vals = new Set(rows.map(x => String(x.c[c]))).size
  console.log(`    ${c.padEnd(14)} ${vals} distinct values   ` +
    (movedBy.size ? `READ by ${[...movedBy].join(', ')}` : 'read by nobody — collapsed by the quotient'))
}

console.log('\n(2) THE BINDING DIMENSION  —  computed, not written by hand')
console.log('    method: for an agent whose ideal is refuted, ask of each dimension whether ANY')
console.log('    feasible account reaches the value the ideal has there. The binding one is the')
console.log('    dimension no feasible account can match. (Largest drop is the obvious guess and')
console.log('    is wrong — see the note at the top of this file.)\n')

const argmaxBy = (arr, f) => arr.slice().sort((a, b) => (f(b) - f(a)) || (a.sig < b.sig ? -1 : 1))[0]
const maxOf = (arr, f) => arr.reduce((m, x) => Math.max(m, f(x)), -Infinity)
const NAMES = { Tajomaru: ['honor', 'agency', 'cleanHands'], Masago: ['sympathy', 'dignity', 'cleanHands'], Takehiro: ['honor', 'agency', 'wronged'] }

for (const T of CAST) {
  const f = (r) => U[T](features(T, r.an))
  const best = maxOf(all, f)
  if (feasibles.some(r => f(r) > best - EPS)) {
    console.log(`    ${T.padEnd(10)} ideal is feasible — no dimension binds`)
    continue
  }
  const ideal = argmaxBy(all, f), got = argmaxBy(feasibles, f)
  const di = dimsOf[T](features(T, ideal.an))
  // For each dimension: the best any FEASIBLE account can do on it, against what the ideal has.
  const short = di.map((want, k) => {
    const bestFeasible = feasibles.reduce((m, r) => Math.max(m, dimsOf[T](features(T, r.an))[k]), -Infinity)
    return { name: NAMES[T][k], want, bestFeasible, shortfall: want - bestFeasible }
  }).sort((a, b) => b.shortfall - a.shortfall)
  const binds = short.filter(d => d.shortfall > EPS)
  console.log(`    ${T.padEnd(10)} ${Math.round(100 * best)} → ${Math.round(100 * f(got))}   binds on ` +
    (binds.length ? binds.map(d => `${d.name} (wants ${d.want.toFixed(2)}, best feasible ${d.bestFeasible.toFixed(2)})`).join('; ')
                  : 'nothing — every dimension is individually attainable') +
    `\n${' '.repeat(15)}not binding: ` +
    short.filter(d => d.shortfall <= EPS).map(d => `${d.name} (attainable at ${d.want.toFixed(2)})`).join(', '))
}

// ---- the same criterion, on the Ring, because Table 1 claims a binding dimension there too ----
console.log('\n    the same criterion on The Ring and the Book:\n')
{
  const space = enumerate()
  const rall = space.assertionsUnder({})        // no record at all — the candidate space
  const rfeas = space.assertionsUnder(RECORD)
  const dimNames = RO.DIM_NAMES
  for (const T of RO.CAST) {
    const f = (r) => RO.U[T](RO.features(T, r.g))
    const best = maxOf(rall, f)
    if (rfeas.some(r => f(r) > best - EPS)) { console.log(`    ${T.padEnd(13)} ideal is feasible — no dimension binds`); continue }
    const ideal = argmaxBy(rall, f)
    const di = RO.dimsOf[T](RO.features(T, ideal.g))
    const short = di.map((want, k) => {
      const bf = rfeas.reduce((m, r) => Math.max(m, RO.dimsOf[T](RO.features(T, r.g))[k]), -Infinity)
      return { name: (dimNames?.[T]?.[k]) ?? `dim${k}`, want, bf, shortfall: want - bf }
    }).sort((a, b) => b.shortfall - a.shortfall)
    const binds = short.filter(d => d.shortfall > EPS)
    console.log(`    ${T.padEnd(13)} ${Math.round(100*best)} → ${Math.round(100*f(argmaxBy(rfeas,f)))}   binds on ` +
      (binds.length ? binds.map(d => `${d.name} (wants ${d.want.toFixed(2)}, best feasible ${d.bf.toFixed(2)})`).join('; ') : 'nothing'))
  }
}

// ---- and on the third domain ----
console.log('\n    the same criterion on the site fall:\n')
{
  const E = await import('./site-enum.mjs')
  const SO = await import('./site-objective.mjs')
  const NAMES3 = { Foreman: ['diligence','standing','cleanHands'], Erector: ['cleanHands','diligence','agency'], Worker: ['sympathy','wronged','agency'] }
  for (const T of E.CAST) {
    const f = (r) => SO.U[T](SO.features(T, r.g))
    const best = maxOf(E.all, f)
    if (E.feasibles.some(r => f(r) > best - EPS)) { console.log(`    ${T.padEnd(13)} ideal is feasible — no dimension binds`); continue }
    const ideal = argmaxBy(E.all, f)
    const di = SO.dimsOf[T](SO.features(T, ideal.g))
    const short = di.map((want, k) => {
      const bf = E.feasibles.reduce((m, r) => Math.max(m, SO.dimsOf[T](SO.features(T, r.g))[k]), -Infinity)
      return { name: NAMES3[T]?.[k] ?? `dim${k}`, want, bf, shortfall: want - bf }
    }).sort((a, b) => b.shortfall - a.shortfall)
    const binds = short.filter(d => d.shortfall > EPS)
    let verdict
    if (binds.length) {
      verdict = binds.map(d => `${d.name} (wants ${d.want.toFixed(2)}, best feasible ${d.bf.toFixed(2)})`).join('; ')
    } else {
      // Every dimension is individually attainable, so no single feature is what the record
      // denies — the exclusion is JOINT. Name the pair that cannot be had together.
      const pairs = []
      for (let i = 0; i < di.length; i++) for (let j = i + 1; j < di.length; j++) {
        const both = E.feasibles.filter(r => {
          const d2 = SO.dimsOf[T](SO.features(T, r.g))
          return d2[i] >= di[i] - EPS && d2[j] >= di[j] - EPS
        })
        if (!both.length) pairs.push(`${NAMES3[T][i]}+${NAMES3[T][j]}`)
      }
      verdict = pairs.length
        ? `no single dimension — the record denies them JOINTLY: ${pairs.join(', ')} (0 feasible accounts have both)`
        : 'nothing single or pairwise'
    }
    console.log(`    ${T.padEnd(13)} ${Math.round(100*best)} → ${Math.round(100*f(argmaxBy(E.feasibles,f)))}   binds on ${verdict}`)
  }
}
console.log()
