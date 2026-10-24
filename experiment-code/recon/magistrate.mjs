#!/usr/bin/env node
// THE MAGISTRATE'S HEARING — the experiment, not the mechanism.
//
// magistrate-core.mjs can establish evidence during testimony; this asks what that does.
// Four questions, in the order they matter:
//
//   1. Does a fact landing mid-testimony actually turn the story, or do the witnesses
//      absorb it and carry on?
//   2. Does pricing "caught out" change anything? δ is the one parameter this build adds,
//      and if the answer is no it should be reported as no.
//   3. How much does the ORDER of establishment matter? The design assumes it is
//      load-bearing; that is a claim with a number attached.
//   4. If an auditor can establish one more fact, which one most changes the record?
//      Batch mode could not ask this, because nothing arrived mid-hearing to catch anyone.
//
// NO LLM. Usage: node recon/magistrate.mjs [--beta 0.5] [--gamma 0] [--delta 0.3]

import { writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AFTERMATH } from './domain.mjs'
import { FACTS, FACT_KEYS, WORLDS, LADDER } from './evidence.mjs'
import { buildSpace, poolFor, replay, preview, CAST, jointAudit, claimKey } from './magistrate-core.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? Number(process.argv[i + 1]) : d }
const BETA = arg('beta', 0.5), GAMMA = arg('gamma', 0), DELTA = arg('delta', 0.3)
const OPT = { part: 'throat' }

const space = buildSpace({ 'run-06': AFTERMATH["pre-B'/run-06"], akutagawa: AFTERMATH['akutagawa/canonical'] })
const shortClaim = (k) => {
  const [actor, type, weapon] = k.split('|')
  const how = type === 'self_strike' ? 'suicide' : type === 'impale_on_held' ? 'impaled' : 'struck'
  return `${actor} ${how}/${weapon === 'longsword' ? 'sword' : 'dagger'}`
}
const story = (p) => [...new Set(CAST.map(T => claimKey(p[T])))].sort().map(shortClaim).join(' + ')
const P = (delta = DELTA) => ({ beta: BETA, gamma: GAMMA, delta })

console.log(`\nshared space: ${space.statesExplored} states, ${space.all.length} causal signatures`)
console.log(`β=${BETA} γ=${GAMMA} δ=${DELTA}\n`)

// ============================================================ 1. does the story turn?
console.log('='.repeat(78))
console.log('=== 1. A file assembled one fact at a time ===')
console.log('='.repeat(78) + '\n')
const run = replay({ space, facts: LADDER, params: P(), opt: OPT })
console.log(`  opening statements, before anything is established:`)
for (const T of CAST) {
  const m = run.state.moves.find(x => x.speaker === T && x.act === 'open')
  console.log(`    ${T.padEnd(9)} ${m.toLabel}`)
}
console.log(`\n  fact established     |Feas|  caught out                the record then reads                          claims  proof`)
for (const t of run.turns) {
  const a = t.audit
  console.log(`  ${t.fact.padEnd(20)} ${String(t.feasible).padStart(5)}  ` +
    `${(t.caught.length ? t.caught.join(',') : '—').padEnd(24)} ${storyAt(run, t).padEnd(46)} ` +
    `${String(a.distinctClaims).padStart(6)}  ${a.provenLies === 2 ? 'holds' : 'gone'}`)
}
function storyAt(r, turn) {
  // the record as it stood right after this fact, reconstructed from the transcript
  const i = r.turns.indexOf(turn)
  const upto = replay({ space, facts: r.facts.slice(0, i + 1), params: P(), opt: OPT })
  return story(upto.state.profile)
}
const totalCaught = run.turns.reduce((s, t) => s + t.caught.length, 0)
console.log(`\n  witnesses caught out over the whole file: ${totalCaught}`)
console.log(`  ${totalCaught ? 'Evidence landing mid-testimony does force retractions.' : 'Nobody was ever caught — the witnesses absorbed every fact.'}`)

// ============================================================ 2. what does δ do?
console.log('\n' + '='.repeat(78))
console.log('=== 2. Does pricing "caught out" change anything? ===')
console.log('='.repeat(78) + '\n')
console.log('   δ      caught  closing record                                  claims  proof  standing')
const deltaSweep = []
for (const d of [0, 0.1, 0.2, 0.3, 0.5, 0.7, 1]) {
  const r = replay({ space, facts: LADDER, params: P(d), opt: OPT })
  const a = jointAudit(r.state.profile)
  const st = CAST.map(T => Math.round(100 * Math.max(0, 1 - d * (r.state.refutations[T] || 0))))
  deltaSweep.push({ delta: d, caught: r.turns.reduce((s, t) => s + t.caught.length, 0), story: story(r.state.profile), distinctClaims: a.distinctClaims, provenLies: a.provenLies, standing: st })
  console.log(`  ${d.toFixed(1)}   ${String(r.turns.reduce((s, t) => s + t.caught.length, 0)).padStart(6)}  ` +
    `${story(r.state.profile).padEnd(46)} ${String(a.distinctClaims).padStart(6)}  ${(a.provenLies === 2 ? 'holds' : 'gone').padStart(5)}  ${st.join('/')}`)
}
const changed = new Set(deltaSweep.map(x => x.story)).size > 1
console.log(`\n  ${changed
  ? '=> δ CHANGES the closing record. Being caught out is not cosmetic.'
  : '=> δ changes nothing here: the closing record is the same at every price.'}`)
if (!changed) console.log(`     Reported as a null result. The witnesses are driven to the same place whether or not\n     the magistrate holds their refutations against them.`)

// ============================================================ 3. does order matter?
console.log('\n' + '='.repeat(78))
console.log('=== 3. How much does the order of establishment matter? ===')
console.log('='.repeat(78) + '\n')
const SUB = ['part', 'rope', 'daggerBlood', 'swordClean', 'weapon']
const perms = (a) => a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p]))
const orders = perms(SUB)
const outcomes = new Map(), stocks = new Map()
for (const o of orders) {
  const r = replay({ space, facts: ['corpse', ...o], params: P(), opt: OPT })
  const s = story(r.state.profile)
  outcomes.set(s, (outcomes.get(s) || 0) + 1)
  const k = CAST.map(T => r.state.refutations[T] || 0).join('/')
  stocks.set(k, (stocks.get(k) || 0) + 1)
}
console.log(`  ${orders.length} orderings of the same five facts (the final file is identical in all of them)\n`)
console.log(`  distinct closing records: ${outcomes.size}`)
for (const [s, n] of [...outcomes].sort((a, b) => b[1] - a[1]))
  console.log(`    ${String(n).padStart(3)}×  ${s}`)
console.log(`\n  distinct refutation stocks (Taj/Mas/Tak): ${stocks.size}`)
for (const [k, n] of [...stocks].sort((a, b) => b[1] - a[1]).slice(0, 6))
  console.log(`    ${String(n).padStart(3)}×  ${k}`)
console.log(`\n  ${outcomes.size > 1
  ? '=> THE SAME EVIDENCE, ESTABLISHED IN A DIFFERENT ORDER, LEAVES A DIFFERENT RECORD.'
  : '=> Order does NOT change where the hearing closes — every ordering lands on the same\n     record. It changes only WHO WAS CAUGHT along the way, and so the standing each\n     witness carries out of it. The design assumed order was load-bearing for the outcome;\n     measured, it is load-bearing for the history and not for the destination.'}`)

// ============================================================ 4. the auditor's next fact
console.log('\n' + '='.repeat(78))
console.log("=== 4. If you can establish one more fact, which one? ===")
console.log('='.repeat(78) + '\n')
for (const start of [['corpse'], ['corpse', 'part'], ['corpse', 'part', 'rope', 'banditGone']]) {
  const base = replay({ space, facts: start, params: P(), opt: OPT })
  const a0 = jointAudit(base.state.profile)
  console.log(`  file so far: ${start.join(', ')}   (${base.pool.length} feasible, ${a0.distinctClaims} claims, proof ${a0.provenLies === 2 ? 'holds' : 'gone'})`)
  const rows = FACT_KEYS.filter(f => !start.includes(f)).map(f => {
    const pv = preview(base, { space, fact: f, params: P(), opt: OPT })
    if (pv.impossible) return { f, impossible: true }
    const after = replay({ space, facts: [...start, f], params: P(), opt: OPT })
    const a = jointAudit(after.state.profile)
    return { f, eliminates: pv.eliminates, catches: pv.wouldCatch, claims: a.distinctClaims, proof: a.provenLies === 2, turned: story(after.state.profile) !== story(base.state.profile) }
  })
  rows.sort((x, y) => (y.eliminates || -1) - (x.eliminates || -1))
  console.log(`     fact             eliminates  catches       record turns  claims  proof`)
  for (const r of rows) {
    if (r.impossible) { console.log(`     ${r.f.padEnd(16)} — unrealisable with this file`); continue }
    console.log(`     ${r.f.padEnd(16)} ${String(r.eliminates).padStart(10)}  ${(r.catches.join(',') || '—').padEnd(13)} ${(r.turned ? 'YES' : 'no').padStart(12)}  ${String(r.claims).padStart(6)}  ${r.proof ? 'holds' : 'gone'}`)
  }
  const live = rows.filter(r => !r.impossible && r.eliminates > 0)
  const helps = live.filter(r => r.proof && !a0.provenLies === false ? r.proof : r.proof)
  const hurts = live.filter(r => !r.proof)
  const keeps = live.filter(r => r.proof)
  console.log(`     => ${live.length} of ${rows.length} facts change the feasible set at all.`)
  if (keeps.length) console.log(`        the proof survives: ${keeps.map(r => r.f).join(', ')}`)
  if (hurts.length) console.log(`        the proof is DESTROYED by: ${hurts.map(r => r.f).join(', ')}`)
  if (keeps.length && hurts.length) {
    const same = keeps.some(k => hurts.some(h => h.eliminates === k.eliminates))
    if (same) console.log(`        and they eliminate the SAME number of accounts — how much evidence you add is\n        not what decides it; which accounts it removes is.`)
  } else if (!keeps.length && hurts.length) {
    console.log(`        EVERY fact that narrows the space destroys the proof. The ones that preserve it\n        are exactly the ones that rule nothing out. There is no evidence to be had here\n        that helps the auditor.`)
  }
  console.log('')
}

writeFileSync(`${HERE}/magistrate-data.json`, JSON.stringify({
  generatedAt: new Date().toISOString(), beta: BETA, gamma: GAMMA, delta: DELTA,
  ladder: run.turns, totalCaught, deltaSweep,
  order: { facts: SUB, orderings: orders.length, outcomes: [...outcomes], stocks: [...stocks] },
}, null, 1))
console.log(`written: recon/magistrate-data.json\n`)
