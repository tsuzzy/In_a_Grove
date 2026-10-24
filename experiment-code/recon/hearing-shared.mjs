#!/usr/bin/env node
// The hearing, re-run on the CORRECTED domain.
//
// dialogue.mjs runs on grove-core's pool, which deduplicates histories to causal signatures
// and therefore hides the rope-cutter that U_i depends on. This runs the same sequential
// public revision over the extended signatures from the shared history space — the domain
// the argmax should have been on all along — for both evidence sets.
//
// One adaptation is needed and it matters: the shared-space records carry `sig` = the causal
// signature, and several records share one. game-core's argmaxBy breaks ties on `.sig`, so
// those records would tie and the winner would fall out of array order. The pool is remapped
// so `sig` is the EXTENDED signature, keeping every tie-break deterministic.
//
// NO LLM. Usage: node recon/hearing-shared.mjs [--beta 0.5]

import { writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AFTERMATH } from './domain.mjs'
import { enumerateShared, DEGENERATE, CAST } from './grove-enum.mjs'
import { hearing } from './dialogue.mjs'
import { jointAudit, nashEquilibria, claimKey, frameUp, profileKey } from './game-core.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? Number(process.argv[i + 1]) : d }
const BETA = arg('beta', 0.5)

const label = (an) => {
  const f = an.fatal
  const who = f.type === 'self_strike' ? 'Takehiro (self)' : f.actor
  const manner = f.type === 'self_strike' ? 'suicide'
    : f.type === 'impale_on_held' ? 'contested impaling'
    : f.weapon === 'longsword' ? (f.victimArmed ? 'sword duel' : 'sword killing')
    : 'dagger killing'
  return `${who} — ${manner} (${f.weapon}, ${f.part}${f.boundAtDeath ? ', bound' : ''})`
}
const full = (r) => `${label(r.an)}; rope cut by ${r.an.cutter || 'nobody'}`
const bySig = new Map()
const story = (p) => [...new Set(CAST.map(T => claimKey(p[T])))].sort().join('  +  ')

const SPECS = { 'run-06': AFTERMATH["pre-B'/run-06"], akutagawa: AFTERMATH['akutagawa/canonical'] }
const space = enumerateShared({ specs: SPECS, degenerate: DEGENERATE })
// remap so tie-breaks are on the extended signature, not the causal one
const poolFor = (name) => space.feasibleUnder(name).map(r => { bySig.set(r.sig, r); return r })

const ORDERS = [
  ['Tajomaru', 'Masago', 'Takehiro'], ['Tajomaru', 'Takehiro', 'Masago'],
  ['Masago', 'Tajomaru', 'Takehiro'], ['Masago', 'Takehiro', 'Tajomaru'],
  ['Takehiro', 'Tajomaru', 'Masago'], ['Takehiro', 'Masago', 'Tajomaru'],
]

const out = []
for (const name of ['run-06', 'akutagawa']) {
  const pool = poolFor(name)
  console.log(`\n${'='.repeat(78)}`)
  console.log(`=== THE HEARING on ${name} evidence — corrected domain (${pool.length} feasible accounts) ===`)
  console.log(`${'='.repeat(78)}`)

  // The equilibrium set is brute-forced ONCE per world (44^3 profiles on the canonical
  // evidence) and then only membership-tested. Recomputing it per speaking order, as a
  // first version did, is 7x the work and does not finish.
  const t0 = Date.now()
  const eq = nashEquilibria(BETA, { pool })
  const eqKeys = new Set(eq.map(profileKey))
  const isNash = (hh) => hh.terminal.kind === 'settled' ? eqKeys.has(profileKey(hh.profile)) : null
  console.log(`\n  (${eq.length} pure-strategy equilibria brute-forced over ${pool.length}³ = ${(pool.length ** 3).toLocaleString()} profiles in ${Date.now() - t0}ms)`)

  const h = hearing({ pool, beta: BETA, order: ORDERS[0] })
  console.log(`\norder ${ORDERS[0].join(' → ')}, β=${BETA}\n`)
  let last = -1
  for (const m of h.moves) {
    if (m.round !== last) { console.log(`  ${m.round === 0 ? '— opening statements —' : `— round ${m.round} —`}`); last = m.round }
    const rec = bySig.get(m.to)
    const rel = (m.corroborates.length ? `  with ${m.corroborates.join(',')}` : '') +
      (m.contradicts.length ? `  against ${m.contradicts.join(',')}` : '')
    if (m.act === 'revise') {
      console.log(`   ${m.speaker.padEnd(9)} RETRACTS  ${full(bySig.get(m.from))}`)
      console.log(`   ${''.padEnd(9)} now says  ${full(rec)}`)
      console.log(`   ${''.padEnd(9)}            +${m.gain} (self ${m.gainSelf >= 0 ? '+' : ''}${m.gainSelf}, corroboration ${m.gainCred >= 0 ? '+' : ''}${m.gainCred})   U ${m.uSelf} cred ${m.cred}${rel}`)
    } else {
      console.log(`   ${m.speaker.padEnd(9)} ${m.act === 'open' ? 'states  ' : 'stands  '}  ${full(rec)}`)
      console.log(`   ${''.padEnd(9)}            U ${m.uSelf} cred ${m.cred}${rel}`)
    }
  }

  const a = jointAudit(h.profile)
  const nash = isNash(h)
  console.log(`\n  ended: ${h.terminal.kind}${h.terminal.round ? ` at round ${h.terminal.round}` : ''}`)
  console.log(`  closes on: ${story(h.profile)}`)
  console.log(`  its limit is a verified Nash equilibrium: ${nash}`)
  console.log(`  distinct claims ${a.distinctClaims}/3 · jointly satisfiable ${a.jointlySat} · proven lies ${a.provenLies}`)
  console.log(`  accused by nobody: ${a.unaccused.join(', ') || '(none)'}`)
  console.log(`  frame-up: ${frameUp(h.profile) ? `${frameUp(h.profile).colluders.join('+')} → ${frameUp(h.profile).target}` : 'none'}`)

  // does who-speaks-first still change the recorded past?
  const byOrder = ORDERS.map(order => {
    const hh = hearing({ pool, beta: BETA, order })
    return { order, kind: hh.terminal.kind, round: hh.terminal.round, nash: isNash(hh), story: story(hh.profile), profile: hh.profile }
  })
  console.log(`\n  --- does speaking order change the recorded past? ---`)
  for (const r of byOrder)
    console.log(`   ${r.order.map(x => x.slice(0, 3)).join('→')}  ${r.kind === 'settled' ? `settled r${r.round}` : r.kind.padEnd(9)}  nash=${r.nash}  ${r.story}`)
  const outcomes = new Set(byOrder.map(r => r.story))
  const eqStories = new Set(eq.map(story))
  console.log(`   distinct pasts across the 6 orders: ${outcomes.size}   stable stories that exist: ${eqStories.size}`)
  console.log(`   ${outcomes.size > 1 ? '=> WHO SPEAKS FIRST STILL CHANGES THE RECORDED PAST.' : '=> order no longer matters in this domain.'}`)

  out.push({
    world: name, feasible: pool.length, beta: BETA,
    transcript: h.moves.map(m => ({ ...m, account: full(bySig.get(m.to)), retracted: m.from ? full(bySig.get(m.from)) : null })),
    terminal: h.terminal, closes: story(h.profile), nash, audit: a,
    byOrder: byOrder.map(r => ({ order: r.order, kind: r.kind, round: r.round, nash: r.nash, story: r.story })),
    distinctPasts: outcomes.size, stableStories: eqStories.size,
  })
}

// transcript file
const md = ['# The hearing, on the corrected domain', '',
  `> Sequential public revision over EXTENDED signatures (fatal attribution + who cut the`,
  `> rope) — the domain U_i is actually a function of. Computed, not written; no language`,
  `> model involved. β = ${BETA}.`, '']
for (const o of out) {
  md.push(`## ${o.world} evidence — ${o.feasible} feasible accounts`, '',
    `Ended **${o.terminal.kind}**${o.terminal.round ? ` at round ${o.terminal.round}` : ''}; limit is a verified Nash equilibrium: **${o.nash}**.`, '',
    '| round | witness | move | account | U | cred | gain | with | against |', '|---|---|---|---|---|---|---|---|---|')
  for (const m of o.transcript) md.push(
    `| ${m.round === 0 ? 'opening' : m.round} | ${m.speaker} | ${m.act}${m.retracted ? `<br>(was: ${m.retracted})` : ''} | ${m.account} |` +
    ` ${m.uSelf} | ${m.cred} | ${m.act === 'revise' ? `+${m.gain} (self ${m.gainSelf}, corrob ${m.gainCred})` : '—'} |` +
    ` ${m.corroborates.join(', ') || '—'} | ${m.contradicts.join(', ') || '—'} |`)
  md.push('', `**Closes on:** ${o.closes}`, '',
    `**Audit:** distinct claims ${o.audit.distinctClaims}/3 · jointly satisfiable ${o.audit.jointlySat} · proven lies ${o.audit.provenLies} · nobody accuses ${o.audit.unaccused.join(', ') || '(nobody)'}`, '',
    `**Speaking order:** ${o.distinctPasts} distinct pasts across the 6 orders, out of ${o.stableStories} stable stories.`, '',
    ...o.byOrder.map(r => `- ${r.order.join(' → ')} → ${r.story}`), '')
}
writeFileSync(`${HERE}/transcript-shared.md`, md.join('\n'))
writeFileSync(`${HERE}/hearing-shared-data.json`, JSON.stringify({ generatedAt: new Date().toISOString(), beta: BETA, worlds: out }, null, 1))
console.log(`\nwritten: recon/transcript-shared.md, recon/hearing-shared-data.json\n`)
