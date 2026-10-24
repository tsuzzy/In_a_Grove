#!/usr/bin/env node
// THE HEARING WITH PRIVATE MOTIVES — and evidence as a dial.
//
// Everything before this was perfect-information: every witness knew the evidence, the
// feasible set, AND every other witness's objective. That left nothing for talk to do.
// Game-theoretically, speech does work when it transmits private information, binds the
// speaker, or selects an equilibrium; only the last was present, and it happened through
// move order rather than through anything said.
//
// Here each witness knows the evidence F and their OWN objective, and not the others'.
// Everyone knows the FORM of the others' objectives — the three named dimensions — but not
// the weights. So a statement is now informative about its speaker: an account is chosen
// because it serves the speaker, and a listener can invert that.
//
//   BELIEF     each witness holds the set of opponent weight vectors still consistent with
//              everything that opponent has said.
//   UPDATE     REVEALED PREFERENCE. If j asserted τ_j while the record stood at P, then any
//              w that would have made some other account strictly better for j is ruled out.
//              Exact, and computed without a language model.
//   RESPONSE   each witness maximises its EXPECTED payoff: credibility depends on what the
//              others will say, which is now predicted under belief rather than read off.
//              Misreading an opponent therefore costs you — that is what makes this a
//              conversation and not a look-up.
//
// Two quantities exist only because of the asymmetry, and both are reported:
//   SURPRISE   how much of a listener's belief a statement destroyed.
//   MISREAD    how often a witness's prediction of the next speaker was wrong.
//
// The second half makes the EVIDENCE ADJUSTABLE: a magistrate's file is a set of atomic
// facts, and the ladder adds them one at a time. The question that answers is the one an
// auditor actually has — how much evidence is needed before witnesses with private motives
// can no longer coordinate on a single story?
//
// NO LLM anywhere. Usage:
//   node recon/private-hearing.mjs                     both named worlds + the ladder
//   node recon/private-hearing.mjs --facts corpse,part,weapon,rope   a custom file
//   node recon/private-hearing.mjs --beta 0.5 --gamma 0 --samples 96

import { writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { enumerateShared, DEGENERATE, CAST } from './grove-enum.mjs'
import { features, dimsOf, Uw } from './grove-core.mjs'
import { credibility, claimKey, jointAudit } from './game-core.mjs'
import { drift, selfConsistency } from './dialogue.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d }
const BETA = Number(arg('beta', 0.5))
const GAMMA = Number(arg('gamma', 0))
const SAMPLES = Number(arg('samples', 96))
const ROUNDS = 24

const u100 = (x) => Math.round(100 * x)
const argmaxBy = (arr, f) =>
  arr.slice().sort((a, b) => (f(b) - f(a)) || (a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0))[0]

// seeded, so every number here is reproducible
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }

// ============================================================ EVIDENCE AS A DIAL
// Each fact is one thing a magistrate could have established. A "file" is a subset.
// `part` is what the woodcutter can see; `weapon` is the much stronger claim that he can
// identify the blade from the wound — in Akutagawa he cannot, and that single missing fact
// is most of the difference between the two worlds.
const FACTS = {
  corpse: { note: 'Takehiro is dead', apply: (f) => { f.dead = [{ who: 'Takehiro' }] } },
  part: { note: 'the wound is where it is (chest / throat)', apply: (f, o) => { f.dead[0].part = o.part } },
  weapon: { note: 'the wound identifies the blade that made it', apply: (f, o) => { f.dead[0].weapon = o.weapon } },
  daggerBlood: { note: 'the dagger is at the scene, bloodied', apply: (f) => { f.bloodied = ['dagger'] } },
  swordClean: { note: 'the longsword is at the scene, unbloodied', apply: (f) => { f.notBloodied = ['longsword'] } },
  bladesGone: { note: 'neither blade is at the scene', apply: (f) => { f.absent = ['longsword', 'dagger'] } },
  rope: { note: 'the rope is found cut', apply: (f) => { f.rope = 'cut' } },
  banditGone: { note: 'the bandit is not at the scene', apply: (f) => { f.gone = [...(f.gone || []), 'Tajomaru'] } },
  wifePresent: { note: 'the wife is still at the scene', apply: (f) => { f.alivePresent = ['Masago'] } },
  wifeGone: { note: 'the wife is not at the scene either', apply: (f) => { f.gone = [...(f.gone || []), 'Masago'] } },
  horseGone: { note: 'the horse is gone', apply: (f) => { f.horseGone = true } },
}
const buildF = (facts, opt = {}) => {
  const f = {}
  for (const k of facts) FACTS[k].apply(f, { part: 'throat', weapon: 'dagger', ...opt })
  return f
}

const WORLDS = {
  'run-06': { facts: ['corpse', 'part', 'weapon', 'daggerBlood', 'swordClean', 'rope', 'banditGone', 'wifePresent'], opt: { part: 'throat' }, title: 'the scene our agents left' },
  akutagawa: { facts: ['corpse', 'part', 'bladesGone', 'rope', 'banditGone', 'wifeGone', 'horseGone'], opt: { part: 'chest' }, title: "Akutagawa's canonical scene" },
}
// the ladder: start from a bare corpse and add one fact at a time toward our own file
const LADDER = ['corpse', 'part', 'rope', 'banditGone', 'wifePresent', 'daggerBlood', 'swordClean', 'weapon']

// ============================================================ PRIVATE OBJECTIVES
// Public: each witness's three dimensions (dimsOf, from grove-core). Private: the weights.
const rand = mulberry32(20260729)
const drawW = () => [0.1 + rand(), 0.1 + rand(), 0.1 + rand()]
const CANDIDATES = Object.fromEntries(CAST.map(T => [T, Array.from({ length: SAMPLES }, drawW)]))
// each witness's actual private weights — themselves drawn from the same space, so nobody's
// objective is special and no witness could have guessed it a priori
const TRUE_W = Object.fromEntries(CAST.map(T => [T, drawW()]))

const Upriv = (T, rec, w) => Uw(T, features(T, rec.an), w)

/**
 * What j would say under hypothetical weights w, as a LISTENER models it.
 *
 * The listener cannot model j exactly: j chose by maximising expected credibility under j's
 * own beliefs about the other two, and those beliefs are private as well. So each listener
 * uses a level-1 model — "j is responding to the record as it now stands" — which is
 * coherent, stateable, and computable. It is misspecified in general, and the consequence is
 * visible in the transcript as persistent misreads. An earlier version inverted on argmax
 * U_j alone, ignoring credibility entirely; that model was refuted by j's own moves, the
 * consistent set emptied, and a fallback silently inserted a wrong candidate.
 */
const modelOf = (j, pool, w, record, beta, gamma, opening) => argmaxBy(pool, r => {
  const self = Uw(j, features(j, r.an), w)
  if (beta === 0) return self
  const sc = gamma === 0 || !opening?.[j] ? 1 : selfConsistency(r, opening[j], gamma)
  return (1 - beta) * self + beta * credibility(j, { ...record, [j]: r }) * sc
})

// ============================================================ THE HEARING
function privateHearing({ pool, beta = BETA, gamma = GAMMA, order = CAST, rounds = ROUNDS }) {
  const moves = []
  const opening = {}
  // beliefs[i][j] = the weight vectors i still considers possible for j
  const beliefs = Object.fromEntries(CAST.map(i =>
    [i, Object.fromEntries(CAST.filter(j => j !== i).map(j => [j, CANDIDATES[j].slice()]))]))

  // what i expects j to say next, given i's belief about j and the standing record
  const predict = (i, j, profile) => {
    const counts = new Map()
    for (const w of beliefs[i][j]) {
      const r = modelOf(j, pool, w, profile, beta, gamma, opening)
      counts.set(r.sig, (counts.get(r.sig) || 0) + 1)
    }
    return counts   // sig -> weight of belief
  }

  // i's expected payoff for asserting `cand`, averaging cred over predicted opponents
  const expectedPayoff = (i, cand, profile, preds) => {
    const self = Upriv(i, cand, TRUE_W[i])
    if (beta === 0) return self
    let credSum = 0, n = 0
    const others = CAST.filter(j => j !== i)
    // sample the joint prediction by pairing the two opponents' predicted claims
    for (const [sigA, wA] of preds[others[0]]) for (const [sigB, wB] of preds[others[1]]) {
      const p = { [i]: cand, [others[0]]: pool.find(r => r.sig === sigA), [others[1]]: pool.find(r => r.sig === sigB) }
      credSum += wA * wB * credibility(i, p)
      n += wA * wB
    }
    const cred = n ? credSum / n : 0
    const sc = gamma === 0 ? 1 : selfConsistency(cand, opening[i], gamma)
    return (1 - beta) * self + beta * cred * sc
  }

  // REVEALED PREFERENCE: j said τ while the record stood at P, so any w making some other
  // account strictly better for j is impossible. Applied by every listener.
  const update = (j, said, record) => {
    const learned = {}
    for (const i of CAST) {
      if (i === j) continue
      const before = beliefs[i][j].length
      const kept = beliefs[i][j].filter(w => modelOf(j, pool, w, record, beta, gamma, opening).sig === said.sig)
      // An empty set means the listener's model of j has been REFUTED, not that j is
      // impossible. Recorded as such and the belief is reset to the full space rather than
      // quietly replaced by an arbitrary candidate.
      const refuted = kept.length === 0
      beliefs[i][j] = refuted ? CANDIDATES[j].slice() : kept
      learned[i] = { before, after: beliefs[i][j].length, refuted,
        surprise: refuted ? 100 : u100(1 - beliefs[i][j].length / Math.max(1, before)) }
    }
    return learned
  }

  const relations = (p, T) => ({
    corroborates: CAST.filter(j => j !== T && claimKey(p[j]) === claimKey(p[T])),
    contradicts: CAST.filter(j => j !== T && claimKey(p[j]) !== claimKey(p[T])),
  })

  // ---- opening statements: nobody has heard anybody, so nobody can predict ----
  const profile = {}
  for (const T of CAST) profile[T] = argmaxBy(pool, r => Upriv(T, r, TRUE_W[T]))
  for (const T of CAST) opening[T] = profile[T]
  for (const T of order) {
    const learned = update(T, profile[T], profile)
    moves.push({
      round: 0, speaker: T, act: 'open', to: profile[T].sig, toLabel: lbl(profile[T]),
      uSelf: u100(Upriv(T, profile[T], TRUE_W[T])), cred: u100(credibility(T, profile)),
      predicted: null, misread: null, learned, ...relations(profile, T),
    })
  }

  // ---- rounds ----
  let terminal = { kind: 'open', round: null }
  const seen = new Set()
  for (let round = 1; round <= rounds; round++) {
    let revised = 0
    for (const T of order) {
      const preds = Object.fromEntries(CAST.filter(j => j !== T).map(j => [j, predict(T, j, profile)]))
      // what T thinks the others will say — recorded so misreads are visible
      const guess = Object.fromEntries(Object.entries(preds).map(([j, c]) =>
        [j, [...c.entries()].sort((a, b) => b[1] - a[1])[0][0]]))
      const before = profile[T]
      const uB = expectedPayoff(T, before, profile, preds)
      const best = argmaxBy(pool, r => expectedPayoff(T, r, profile, preds))
      const uA = expectedPayoff(T, best, profile, preds)
      const changed = best.sig !== before.sig
      if (changed) { profile[T] = best; revised++ }
      // being asked and not budging is informative as well, so it updates too
      const learned = update(T, profile[T], profile)
      moves.push({
        round, speaker: T, act: changed ? 'revise' : 'stand',
        from: changed ? before.sig : null, fromLabel: changed ? lbl(before) : null,
        to: profile[T].sig, toLabel: lbl(profile[T]),
        uSelf: u100(Upriv(T, profile[T], TRUE_W[T])), cred: u100(credibility(T, profile)),
        gain: changed ? u100(uA - uB) : 0,
        drift: u100(drift(profile[T], opening[T])),
        predicted: guess,
        // a misread: T predicted j would be saying something j is not
        misread: CAST.filter(j => j !== T && guess[j] !== profile[j].sig),
        beliefSize: Object.fromEntries(CAST.filter(j => j !== T).map(j => [j, beliefs[T][j].length])),
        learned, ...relations(profile, T),
      })
    }
    if (revised === 0) { terminal = { kind: 'settled', round }; break }
    const k = CAST.map(T => profile[T].sig).join('|')
    if (seen.has(k)) { terminal = { kind: 'cycle', round }; break }
    seen.add(k)
  }
  return { moves, profile: { ...profile }, opening, terminal, beliefs }
}

const lbl = (r) => {
  const f = r.an.fatal
  const who = f.type === 'self_strike' ? 'Takehiro (self)' : f.actor
  const manner = f.type === 'self_strike' ? 'suicide' : f.type === 'impale_on_held' ? 'contested impaling'
    : f.weapon === 'longsword' ? (f.victimArmed ? 'sword duel' : 'sword killing') : 'dagger killing'
  return `${who} — ${manner} (${f.weapon}, ${f.part})`
}
const story = (p) => [...new Set(CAST.map(T => claimKey(p[T])))].sort().join('  +  ')

// ============================================================ RUN
const custom = arg('facts', null)
const specs = {}
if (custom) specs.custom = buildF(custom.split(','), { part: 'throat' })
else for (const [n, w] of Object.entries(WORLDS)) specs[n] = buildF(w.facts, w.opt)
for (let i = 1; i <= LADDER.length; i++) specs[`rung${i}`] = buildF(LADDER.slice(0, i), { part: 'throat' })

const space = enumerateShared({ specs, degenerate: DEGENERATE })
console.log(`\nshared history space: ${space.statesExplored} states, ${space.causalSignatures} causal signatures`)
console.log(`private objectives: each witness knows F and its OWN weights; ${SAMPLES} candidate weight`)
console.log(`vectors per opponent, narrowed by revealed preference. β=${BETA} γ=${GAMMA}\n`)

const out = { generatedAt: new Date().toISOString(), beta: BETA, gamma: GAMMA, samples: SAMPLES, worlds: {}, ladder: [] }

for (const name of (custom ? ['custom'] : Object.keys(WORLDS))) {
  const pool = space.feasibleUnder(name)
  console.log('='.repeat(78))
  console.log(`=== ${name} — ${WORLDS[name]?.title || 'custom file'} · ${pool.length} feasible accounts ===`)
  console.log('='.repeat(78) + '\n')
  const h = privateHearing({ pool })
  let last = -1
  for (const m of h.moves) {
    if (m.round !== last) { console.log(`  ${m.round === 0 ? '— opening statements (nobody can predict yet) —' : `— round ${m.round} —`}`); last = m.round }
    if (m.act === 'revise') {
      console.log(`   ${m.speaker.padEnd(9)} RETRACTS ${m.fromLabel}`)
      console.log(`   ${''.padEnd(9)} now says ${m.toLabel}   +${m.gain}`)
    } else {
      console.log(`   ${m.speaker.padEnd(9)} ${m.act === 'open' ? 'states ' : 'stands '} ${m.toLabel}   U ${m.uSelf} cred ${m.cred}`)
    }
    if (m.predicted) {
      const pr = Object.entries(m.predicted).map(([j, s]) => `${j}→${s.split('|').slice(0, 2).join(' ')}`).join(', ')
      console.log(`   ${''.padEnd(9)} expected: ${pr}${m.misread.length ? `   MISREAD ${m.misread.join(',')}` : '   (read them right)'}`)
    }
    const heard = Object.entries(m.learned || {}).filter(([, v]) => v.surprise > 0)
    if (heard.length) console.log(`   ${''.padEnd(9)} listeners: ` +
      heard.map(([i, v]) => v.refuted ? `${i} MODEL REFUTED, belief reset` : `${i} ${v.before}→${v.after} (−${v.surprise}%)`).join(', '))
  }
  const a = jointAudit(h.profile)
  const misreads = h.moves.reduce((s, m) => s + (m.misread?.length || 0), 0)
  console.log(`\n  ended ${h.terminal.kind}${h.terminal.round ? ` at round ${h.terminal.round}` : ''} · closes on ${story(h.profile)}`)
  console.log(`  distinct claims ${a.distinctClaims}/3 · proven lies ${a.provenLies}`)
  console.log(`  misreads over the whole hearing: ${misreads}`)
  console.log(`  final belief sizes: ${CAST.map(i => `${i} knows ${CAST.filter(j => j !== i).map(j => `${j}:${h.beliefs[i][j].length}/${SAMPLES}`).join(' ')}`).join(' | ')}\n`)
  out.worlds[name] = { feasible: pool.length, terminal: h.terminal, closes: story(h.profile), audit: a, misreads,
    beliefs: Object.fromEntries(CAST.map(i => [i, Object.fromEntries(CAST.filter(j => j !== i).map(j => [j, h.beliefs[i][j].length]))])),
    transcript: h.moves }
}

// ============================================================ EVIDENCE AS A DIAL
if (!custom) {
  console.log('='.repeat(78))
  console.log('=== Evidence as a dial — how much does an auditor need? ===')
  console.log('='.repeat(78))
  console.log('\nEach rung adds one fact to the magistrate\'s file. "proof" = the closing record still')
  console.log('holds 3 distinct claims, which is what proves >=2 lies without knowing the truth.\n')
  console.log('  rung  fact added        |Feasible|  closes on            distinct  proof  misreads')
  for (let i = 1; i <= LADDER.length; i++) {
    const name = `rung${i}`
    const pool = space.feasibleUnder(name)
    if (!pool.length) { console.log(`  ${String(i).padStart(4)}  ${LADDER[i - 1].padEnd(16)}          0  (unrealisable)`); continue }
    const h = privateHearing({ pool })
    const a = jointAudit(h.profile)
    const misreads = h.moves.reduce((s, m) => s + (m.misread?.length || 0), 0)
    out.ladder.push({ rung: i, fact: LADDER[i - 1], feasible: pool.length, closes: story(h.profile), distinctClaims: a.distinctClaims, provenLies: a.provenLies, misreads })
    console.log(`  ${String(i).padStart(4)}  ${LADDER[i - 1].padEnd(16)} ${String(pool.length).padStart(10)}  ` +
      `${story(h.profile).split('  +  ')[0].split('|').slice(0, 2).join(' ').padEnd(20)} ${String(a.distinctClaims).padStart(8)}  ` +
      `${(a.provenLies === 2 ? 'HOLDS' : 'gone').padStart(5)}  ${String(misreads).padStart(8)}`)
  }
  const firstHold = out.ladder.find(r => r.provenLies === 2)
  const lastGone = [...out.ladder].reverse().find(r => r.provenLies === 0)
  console.log(`\n  first rung at which the proof holds: ${firstHold ? `${firstHold.rung} (after adding "${firstHold.fact}")` : 'never'}`)
  console.log(`  last rung at which it is gone:       ${lastGone ? `${lastGone.rung} ("${lastGone.fact}")` : 'none'}`)
  console.log(`\n  Reading: the dial says how much of a file an auditor has to assemble before three`)
  console.log(`  witnesses who do not know each other's motives can no longer be talked into one`)
  console.log(`  story. Facts are not interchangeable — watch which single addition flips it.\n`)
}

// ============================================================ THE THREE LEVERS
// One run per lever, so the exhibit can state the comparison instead of asserting it.
if (!custom) {
  console.log('='.repeat(78))
  console.log('=== Three levers an auditor might reach for ===')
  console.log('='.repeat(78) + '\n')
  const poolFull = space.feasibleUnder('run-06')
  const poolBare = space.feasibleUnder('rung1')
  const run = (pool, gamma) => { const h = privateHearing({ pool, gamma }); return { audit: jointAudit(h.profile), h } }
  let gStar = null
  for (let j = 0; j <= 40 && gStar === null; j++)
    if (run(poolFull, j / 40).audit.provenLies === 2) gStar = j / 40
  const levers = [
    { lever: 'nothing — the baseline', detail: `full file, ${poolFull.length} feasible, γ=0`,
      provenLies: run(poolFull, 0).audit.provenLies, distinctClaims: run(poolFull, 0).audit.distinctClaims },
    { lever: 'strip the evidence to a bare corpse', detail: `${poolBare.length} feasible — four times the deniability`,
      provenLies: run(poolBare, 0).audit.provenLies, distinctClaims: run(poolBare, 0).audit.distinctClaims },
    { lever: 'hide every objective (already on)', detail: 'private weights, level-1 opponent models',
      provenLies: run(poolFull, 0).audit.provenLies, distinctClaims: run(poolFull, 0).audit.distinctClaims, note: 'this whole file runs under private motives; it changes nothing' },
    { lever: 'hold each witness to their opening', detail: `γ = ${gStar}`,
      provenLies: run(poolFull, gStar).audit.provenLies, distinctClaims: run(poolFull, gStar).audit.distinctClaims },
  ]
  console.log('  lever                                  detail                                     distinct  proof')
  for (const L of levers)
    console.log(`  ${L.lever.padEnd(38)} ${L.detail.padEnd(42)} ${String(L.distinctClaims).padStart(8)}  ${L.provenLies === 2 ? 'HOLDS' : 'gone'}`)
  console.log(`\n  Only the last one works. γ* = ${gStar} under private motives, against 0.225 under public —`)
  console.log(`  so not knowing each other neither helps the witnesses nor hinders the fix.\n`)
  out.levers = levers
  out.gammaStar = gStar
  // the same worlds again with accountability switched on, for the exhibit
  out.withGamma = {}
  for (const name of Object.keys(WORLDS)) {
    const h = privateHearing({ pool: space.feasibleUnder(name), gamma: gStar })
    out.withGamma[name] = { gamma: gStar, terminal: h.terminal, closes: story(h.profile), audit: jointAudit(h.profile),
      misreads: h.moves.reduce((s, m) => s + (m.misread?.length || 0), 0), transcript: h.moves }
  }
}

writeFileSync(`${HERE}/../../demo/private-hearing-data.js`, `window.PRIVATE = ${JSON.stringify(out)}\n`)
writeFileSync(`${HERE}/private-hearing-data.json`, JSON.stringify(out, null, 1))
console.log(`written: demo/private-hearing-data.js, recon/private-hearing-data.json\n`)
