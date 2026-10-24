#!/usr/bin/env node
// THE HEARING — testimony as a sequential public conversation.
//
// The level-k layer had every witness answer a SIMULTANEOUS guess about the others: it
// modelled anticipation, not conversation, and it never actually reached an equilibrium —
// it stopped at a chosen reasoning depth. Here the witnesses take turns, out loud. Each
// one hears what has already been said and revises. The transcript is the record.
//
//   opening   each witness states the account that best serves them, having heard nobody
//             (this is exactly the independent solution — V1 is the opening of the hearing)
//   rounds    in turn, each witness best-responds to what is CURRENTLY on the record,
//             including revisions made earlier in the same round
//   close     a full round in which nobody revises. By construction every witness is then
//             best-responding to the standing profile — the hearing has reached a Nash
//             equilibrium. Cross-checked against the brute-forced equilibrium set.
//
// Why this is worth changing method for: we already knew the game has SEVERAL equilibria
// (6 at β=0.5, forming 3 mutually exclusive stories) and could only say the landing point
// was "path dependent". The conversation IS the path. So the question this file answers is
// which story a hearing selects, and whether that depends on who speaks first.
//
// NO LLM anywhere: the moves are structured speech acts, feasibility is the simulator, the
// objective is the same transparent function. Rendering the transcript into prose is a
// separate, optional step that changes no number.
//
// Usage: node recon/dialogue.mjs [--beta 0.5] [--rounds 24]   (no API key)

import { writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CAST, feasibles, label, tag, claimKey, argmaxBy, Uself, Utot, credibility,
  nashEquilibria, jointAudit, frameUp, profileKey, levelK, DEFAULT_ATOM_W, TRUTH_CLAIM,
} from './game-core.mjs'
import { makePayoff, runHearing, drift, selfConsistency } from './hearing-core.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? Number(process.argv[i + 1]) : d }
const BETA = arg('beta', 0.5)
const ROUNDS = arg('rounds', 24)

const u100 = (x) => Math.round(100 * x)
const ORDERS = [
  ['Tajomaru', 'Masago', 'Takehiro'], ['Tajomaru', 'Takehiro', 'Masago'],
  ['Masago', 'Tajomaru', 'Takehiro'], ['Masago', 'Takehiro', 'Tajomaru'],
  ['Takehiro', 'Tajomaru', 'Masago'], ['Takehiro', 'Masago', 'Tajomaru'],
]

// ---------------------------------------------------------------- self-consistency
// Moved to hearing-core.mjs alongside the solver that uses it. Re-exported unchanged so
// every existing importer of dialogue.mjs keeps working.
import { DRIFT_W, driftAtoms } from './hearing-core.mjs'
export { DRIFT_W, driftAtoms, drift, selfConsistency }

// ---------------------------------------------------------------- the solver
/**
 * Run one hearing. Returns the transcript and how it ended.
 * `order` is who speaks in what sequence each round.
 * `gamma` prices self-contradiction; gamma=0 reproduces the earlier behaviour exactly.
 */
export function hearing({ pool = feasibles, beta = BETA, gamma = 0, order = ORDERS[0], rounds = ROUNDS, opts = {} } = {}) {
  const { w = [1, 1, 1], atomW = DEFAULT_ATOM_W } = opts
  // delegated to hearing-core so there is exactly one solver. `tag` is passed as the label
  // formatter so transcripts are byte-identical to before the split.
  const obj = makePayoff({ beta, gamma, delta: 0, w, atomW, fmt: tag })
  const s = runHearing({ pool, obj, order, rounds })
  return { moves: s.moves, profile: { ...s.profile }, opening: { ...s.opening }, terminal: s.terminal, beta, gamma, order: [...order] }
}

/**
 * A settled hearing must be an equilibrium — verified, not asserted.
 *
 * With gamma > 0 the payoff depends on each witness's own opening, so the hearing is no
 * longer a normal-form game over profiles and game-core's brute force is not the right
 * benchmark: the right statement is "no witness can gain by moving, GIVEN the openings on
 * the record". That is checked directly here. At gamma = 0 the two coincide, and the
 * brute-forced set is used so the earlier verification is preserved.
 */
export function settledIsNash(h, pool = feasibles, opts = {}) {
  if (h.terminal.kind !== 'settled') return null
  if (!h.gamma) return nashEquilibria(h.beta, { ...opts, pool }).some(p => profileKey(p) === profileKey(h.profile))
  const { w = [1, 1, 1], atomW = DEFAULT_ATOM_W } = opts
  const payoff = (T, p) => {
    const self = Uself(T, p[T], w)
    if (h.beta === 0) return self
    return (1 - h.beta) * self + h.beta * credibility(T, p, atomW) * selfConsistency(p[T], h.opening[T], h.gamma)
  }
  return CAST.every(T => {
    const cur = payoff(T, h.profile)
    return pool.every(r => payoff(T, { ...h.profile, [T]: r }) <= cur + 1e-12)
  })
}

// ---------------------------------------------------------------- reporting
if (import.meta.url === `file://${process.argv[1]}`) {
  const story = (p) => [...new Set(CAST.map(T => claimKey(p[T])))].sort().join('  +  ')

  // ============================================ 1. the transcript
  console.log(`\n=== 1. The hearing, in order ${ORDERS[0].join(' → ')}, β=${BETA} ===`)
  console.log(`Each line is a public move. "stand" means the witness was asked and did not budge.\n`)
  const h = hearing({ beta: BETA })
  let lastRound = -1
  for (const m of h.moves) {
    if (m.round !== lastRound) { console.log(`  ${m.round === 0 ? '— opening statements —' : `— round ${m.round} —`}`); lastRound = m.round }
    const rel = (m.corroborates.length ? ` with ${m.corroborates.join(',')}` : '') +
      (m.contradicts.length ? ` against ${m.contradicts.join(',')}` : '')
    if (m.act === 'revise') {
      console.log(`   ${m.speaker.padEnd(9)} RETRACTS ${m.fromLabel}`)
      console.log(`   ${''.padEnd(9)}   now says ${m.toLabel}`)
      console.log(`   ${''.padEnd(9)}   gain +${m.gain} (self ${m.gainSelf >= 0 ? '+' : ''}${m.gainSelf}, corroboration ${m.gainCred >= 0 ? '+' : ''}${m.gainCred})  cred ${m.cred}${rel}`)
    } else {
      console.log(`   ${m.speaker.padEnd(9)} ${m.act === 'open' ? 'states  ' : 'stands: '} ${m.toLabel}   U ${m.uSelf} cred ${m.cred}${rel}`)
    }
  }
  console.log(`\n  ended: ${h.terminal.kind}${h.terminal.round ? ` at round ${h.terminal.round}` : ''}` +
    `${h.terminal.kind === 'cycle' ? ` (period ${h.terminal.period})` : ''}`)

  const a = jointAudit(h.profile)
  console.log(`  the record closes on: ${story(h.profile)}`)
  console.log(`  distinct claims ${a.distinctClaims}/3 · jointly satisfiable ${a.jointlySat} · proven lies ${a.provenLies}` +
    ` · unaccused ${a.unaccused.join(',') || '(none)'}`)
  console.log(`  frame-up: ${frameUp(h.profile) ? `${frameUp(h.profile).colluders.join('+')} → ${frameUp(h.profile).target}` : 'none'}`)

  // ============================================ 2. is it an equilibrium?
  console.log(`\n=== 2. Did the conversation actually reach an equilibrium? ===`)
  const eq = nashEquilibria(BETA)
  const isNash = settledIsNash(h)
  console.log(`  pure-strategy equilibria that exist at β=${BETA}: ${eq.length}, forming ${new Set(eq.map(story)).size} mutually exclusive stories`)
  console.log(`  the hearing settled: ${h.terminal.kind === 'settled'}`)
  console.log(`  its limit is in the brute-forced equilibrium set: ${isNash}`)
  console.log(`  ${isNash ? 'So the conversation solved the game — it did not merely stop.' : 'The conversation did NOT reach an equilibrium; reported as such.'}`)

  // ============================================ 3. which story does a hearing select?
  console.log(`\n=== 3. Which of the available equilibria does a conversation select? ===`)
  console.log(`  This is the question level-k could not answer: we knew several stories were`)
  console.log(`  stable and could only call the landing point path-dependent. The path is here.\n`)
  const bySpeakingOrder = ORDERS.map(order => {
    const hh = hearing({ beta: BETA, order })
    return { order, hh, story: story(hh.profile), settled: hh.terminal.kind === 'settled', nash: settledIsNash(hh) }
  })
  for (const r of bySpeakingOrder)
    console.log(`  ${r.order.map(x => x.slice(0, 3)).join('→')}  ${r.settled ? `settled r${r.hh.terminal.round}` : r.hh.terminal.kind.padEnd(9)}  ` +
      `nash=${r.nash}  ${r.story}`)
  const stories = new Set(bySpeakingOrder.map(r => r.story))
  console.log(`\n  distinct outcomes across the ${ORDERS.length} speaking orders: ${stories.size}`)
  console.log(`  ${stories.size === 1
    ? '=> the conversation selects ONE story regardless of who speaks first. Order does not matter here.'
    : '=> WHO SPEAKS FIRST CHANGES THE RECORDED PAST. Same evidence, same incentives, different history.'}`)
  const eqStories = new Set(eq.map(story))
  console.log(`  stable stories a conversation never reaches: ${[...eqStories].filter(s => !stories.has(s)).length} of ${eqStories.size}`)

  // ============================================ 4. sequential vs simultaneous
  console.log(`\n=== 4. Conversation vs. simultaneous anticipation (the old level-k) ===`)
  const lk = levelK(12, BETA)
  const lkP = lk.traj[lk.traj.length - 1]
  console.log(`  level-k (simultaneous):  ${lk.terminal.kind.padEnd(8)} -> ${story(lkP)}`)
  console.log(`  hearing  (sequential) :  ${h.terminal.kind.padEnd(8)} -> ${story(h.profile)}`)
  console.log(`  same destination: ${profileKey(lkP) === profileKey(h.profile)}`)
  console.log(`  ${profileKey(lkP) === profileKey(h.profile)
    ? '  (they agree here, but only the hearing certifies its answer as an equilibrium)'
    : '  taking turns lands somewhere simultaneous guessing does not.'}`)

  // ============================================ 5. β sweep
  console.log(`\n=== 5. β sweep — one hearing per β, first speaking order ===`)
  console.log(`   β     ended        round  nash   distinct  provenLies  the record closes on`)
  const sweep = []
  for (let i = 0; i <= 20; i++) {
    const b = i / 20
    const hh = hearing({ beta: b })
    const aa = jointAudit(hh.profile)
    const n = settledIsNash(hh)
    sweep.push({
      beta: b, terminal: hh.terminal.kind, round: hh.terminal.round, nash: n,
      distinctClaims: aa.distinctClaims, provenLies: aa.provenLies, story: story(hh.profile),
      revisions: hh.moves.filter(m => m.act === 'revise').length,
    })
    console.log(`  ${b.toFixed(2)}  ${hh.terminal.kind.padEnd(11)} ${String(hh.terminal.round ?? '—').padStart(5)}  ` +
      `${String(n ?? '—').padStart(5)} ${String(aa.distinctClaims).padStart(9)} ${String(aa.provenLies).padStart(11)}   ${story(hh.profile)}`)
  }
  const firstOne = sweep.find(s => s.distinctClaims === 1)
  console.log(`\n  smallest β at which the hearing closes on a single story: ` +
    `${firstOne ? `β = ${firstOne.beta.toFixed(2)}` : 'never in [0,1]'}`)

  // ============================================ 6. who concedes
  console.log(`\n=== 6. Who moves and who never does ===`)
  const conceded = Object.fromEntries(CAST.map(T => [T, h.moves.filter(m => m.speaker === T && m.act === 'revise').length]))
  console.log(`  revisions in the transcript: ${CAST.map(T => `${T} ${conceded[T]}`).join(' · ')}`)
  for (const T of CAST) {
    const first = h.moves.find(m => m.speaker === T && m.act === 'open')
    const last = h.moves.filter(m => m.speaker === T).at(-1)
    const dSelf = last.uSelf - first.uSelf
    console.log(`  ${T.padEnd(9)} opened on ${first.toLabel}`)
    console.log(`  ${''.padEnd(9)} closed on ${last.toLabel}   self-interest ${dSelf >= 0 ? '+' : ''}${dSelf}, credibility ${first.cred} → ${last.cred}`)
  }

  // ============================================ 7. transcript file + data
  const md = ['# The hearing — a structured record', '',
    `> Every move below was computed, not written: each witness best-responds to what is`,
    `> already on the record. No language model was involved. β = ${BETA}, speaking order`,
    `> ${ORDERS[0].join(' → ')}, ended **${h.terminal.kind}**${h.terminal.round ? ` at round ${h.terminal.round}` : ''}.`, '',
    `**τ\\*, which no witness can see:** ${TRUTH_CLAIM.split('|').join(' ')} — Masago struck the throat.`, '',
    '| round | witness | move | account | self | cred | gain | with | against |', '|---|---|---|---|---|---|---|---|---|']
  for (const m of h.moves) md.push(
    `| ${m.round === 0 ? 'opening' : m.round} | ${m.speaker} | ${m.act}${m.act === 'revise' ? ` (was: ${m.fromLabel})` : ''} | ${m.toLabel} |` +
    ` ${m.uSelf} | ${m.cred} | ${m.act === 'revise' ? `+${m.gain} (self ${m.gainSelf}, corrob ${m.gainCred})` : '—'} |` +
    ` ${m.corroborates.join(', ') || '—'} | ${m.contradicts.join(', ') || '—'} |`)
  md.push('', `**Closes on:** ${story(h.profile)}`, '',
    `**Audit of the closing record:** distinct claims ${a.distinctClaims}/3 · jointly satisfiable ${a.jointlySat} · ` +
    `proven lies ${a.provenLies} · nobody accuses ${a.unaccused.join(', ') || '(nobody)'}`, '',
    `**Is the close an equilibrium?** ${isNash} — verified against the brute-forced equilibrium set, not asserted.`, '')
  writeFileSync(`${HERE}/transcript.md`, md.join('\n'))

  const dump = {
    generatedAt: new Date().toISOString(), beta: BETA, rounds: ROUNDS, atomW: DEFAULT_ATOM_W,
    transcript: h.moves, terminal: h.terminal, closes: story(h.profile), audit: a,
    isNash, equilibria: { count: eq.length, stories: [...eqStories] },
    byOrder: bySpeakingOrder.map(r => ({ order: r.order, settled: r.settled, round: r.hh.terminal.round, nash: r.nash, story: r.story })),
    orderMatters: stories.size > 1,
    vsLevelK: { levelK: story(lkP), hearing: story(h.profile), same: profileKey(lkP) === profileKey(h.profile) },
    sweep, conceded,
  }
  writeFileSync(`${HERE}/dialogue-data.js`, `window.DIALOGUE = ${JSON.stringify(dump, null, 1)}\n`)
  writeFileSync(`${HERE}/dialogue-data.json`, JSON.stringify(dump, null, 1))
  console.log(`\nwritten: recon/transcript.md, recon/dialogue-data.js, recon/dialogue-data.json\n`)
}
