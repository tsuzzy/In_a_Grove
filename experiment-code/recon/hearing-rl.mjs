#!/usr/bin/env node
// EXPERIMENT (NOT in the paper): re-run the Section 4.4 coupled hearing with tabular
// Q-learning best-responses in place of the exact argmax over the enumerated feasible pool.
//
// The hearing engine (hearing-engine.mjs) settles a sequential hearing by having each witness,
// on their turn, pick the feasible account that maximizes the coupled objective
//     U_i^tot = (1-beta) U_i  +  beta * cred_i * selfConsistency_i * standing_i
// given the standing record. The engine does that pick with argmaxBy(pool, score): an exact
// argmax over the enumerated feasible set. This script replaces THAT pick with runRL from
// solver-engines.mjs -- the same tabular-Q agent used for Table 3 -- so the witness LEARNS its
// best feasible account from the simulator without ever enumerating Feasible(F). Openings are
// the pure-U_i argmax (beta=0 payoff), also solved by RL.
//
// It reports, for each of the paper's three conditions, the RL-driven audit next to the exact
// engine's audit, so we can see whether RL reproduces Table 4: distinct accounts, provably
// false accounts, what the record closes on, and whether tau* survives.
//
// NO LLM. Usage: node recon/hearing-rl.mjs

import { AFTERMATH } from './domain.mjs'
import { enumerateShared, DEGENERATE } from './grove-enum.mjs'
import { makePayoff, jointAudit, claimKey, runHearing } from './hearing-core.mjs'
import { TRUTH_CLAIM } from './game-core.mjs'
import { runRL } from './solver-engines.mjs'
import * as GD from './domain.mjs'
import * as GO from './grove-objective.mjs'
import * as GC from './grove-core.mjs'

const CAST = GC.CAST  // ['Tajomaru','Masago','Takehiro'] order as the engine uses

// ── grove RL adapter base (copied verbatim from solvers-report.mjs) ───────────
const gBLADES = ['longsword', 'dagger']
function* gGroundings(s) {
  for (const actor of GC.CAST) {
    const g = s.agents[actor]; if (!g.alive || !g.present) continue
    if (!g.bound) { yield { type: 'flee', actor }; if (s.horse) yield { type: 'mount_flee', actor } }
    for (const obj of gBLADES) {
      const o = s.objects[obj]
      if (!g.bound && o.holder === null && o.ground) yield { type: 'take', actor, object: obj }
      if (!g.bound && o.holder && o.holder !== actor && s.agents[o.holder]?.present) yield { type: 'seize', actor, object: obj }
      if (o.holder === actor) {
        for (const t of GC.CAST) if (t !== actor && s.agents[t].alive && s.agents[t].present) yield { type: 'give', actor, object: obj, target: t }
        if (!g.bound && s.rope === 'binding') yield { type: 'cut_rope', actor, object: obj }
        if (!g.bound) { for (const t of GC.CAST) if (t !== actor && s.agents[t].alive && s.agents[t].present) yield { type: 'strike', actor, target: t, object: obj, part: 'throat' }; yield { type: 'self_strike', actor, object: obj, part: 'throat' } }
      }
      if (!g.bound && o.holder && o.holder !== actor) yield { type: 'impale_on_held', actor, object: obj, part: 'throat' }
    }
  }
}
function gAnnotate(steps) {
  const s = GD.initialState(); let fatal = null
  for (const a of steps) {
    const bb = s.agents.Takehiro.bound, ba = s.agents.Takehiro.alive, va = gBLADES.some(o => s.objects[o].holder === 'Takehiro')
    GD.ACTIONS[a.type].eff(s, a)
    if (!fatal && ba && s.agents.Takehiro.alive === false) fatal = { actor: a.actor, type: a.type, weapon: a.object, boundAtDeath: bb, victimArmed: va }
  }
  return { fatal }
}
const gKey = (s) => JSON.stringify([GC.CAST.map(a => [s.agents[a].alive, s.agents[a].bound, s.agents[a].present, s.agents[a].wounds.map(w => w.part + ':' + w.weapon + (w.selfInflicted ? 's' : w.contested ? 'c' : ''))]), gBLADES.map(o => [s.objects[o].holder, s.objects[o].ground, s.objects[o].bloodied, !!s.objects[o].flung]), s.rope, s.horse])
const gFatal = (h) => { const an = gAnnotate(h).fatal; return an ? `${an.actor}|${an.type}|${an.weapon}|${an.boundAtDeath}|${an.victimArmed}` : '-' }

const groveBase = {
  CAST, TMAX: 7,
  replay: (h) => { const r = GD.simulate(h); return { state: r.state, ok: r.ok } },
  legalActions: (s) => [...gGroundings(s)].filter(a => GD.ACTIONS[a.type].pre(s, a).ok),
  misses: (s) => GD.diffAftermath(s, GC.F).length,
  stateKey: (s, h) => gKey(s) + '#' + gFatal(h),
  terminal: (s) => !s.agents.Takehiro.alive,
}

// account (rec) the hearing engine can consume, built from an RL history's annotation
const sigOf = (an) => { const f = an.fatal; return [f.actor, f.type, f.weapon, !!f.boundAtDeath, !!f.victimArmed].join('|') }
const recOf = (h) => { if (!h) return null; const an = gAnnotate(h); return an.fatal ? { sig: sigOf(an), an } : null }

// ── the enumerated pool (same construction as tab-hearing.mjs) ────────────────
const SPECS = { 'run-06': AFTERMATH["pre-B'/run-06"], akutagawa: AFTERMATH['akutagawa/canonical'] }
const pool = enumerateShared({ specs: SPECS, degenerate: DEGENERATE }).feasibleUnder('run-06')

// sanity: the RL simulator's reachable feasible accounts must be the SAME set the hearing
// audits against, or the two are not solving the same problem.
const poolSigs = new Set(pool.map(r => sigOf(r.an)))

// ── RL best-response: argmax over feasible accounts of a score(rec) in [0,1] ───
// runs `seeds` independent tabular-Q agents (exactU=101 so none early-stops; each runs the
// full episode budget) and returns the highest coupled score any of them reached, together
// with the RL-native representative (min sig among the seeds' own winners). It ALSO reports
// the exact max over the pool, so we can tell a search failure (RL value < exact value) apart
// from a mere tie-break difference (RL value == exact value, different representative).
const EPS = 1e-9
function rlArgmax(T, scoreRec, { seeds = 4, EP = 8000 } = {}) {
  const A = { ...groveBase, utility: (h) => { const rec = recOf(h); return rec ? 100 * scoreRec(rec) : -1 } }
  const found = []
  for (let s = 1; s <= seeds; s++) {
    const res = runRL(A, T, s, { EPISODES: EP }, 101)
    const rec = recOf(res.bestHistory)
    if (rec) found.push({ rec, score: scoreRec(rec) })
  }
  if (!found.length) throw new Error(`RL found no feasible account for ${T}`)
  const rlBest = Math.max(...found.map(f => f.score))
  const nativeTies = found.filter(f => rlBest - f.score < EPS).sort((a, b) => a.rec.sig < b.rec.sig ? -1 : 1)
  const exactMax = Math.max(...pool.map(scoreRec))
  // the engine's convention: min sig among ALL pool accounts at the RL-discovered optimum
  const minSigAt = pool.filter(r => Math.abs(scoreRec(r) - rlBest) < EPS).sort((a, b) => a.sig < b.sig ? -1 : 1)[0]
  return { native: nativeTies[0].rec, minsig: minSigAt, score: rlBest, exactMax, searchOK: Math.abs(rlBest - exactMax) < EPS }
}

// exact argmax over the pool (reference for a single best-response), engine tie-break by sig
const argmaxPool = (scoreRec) => pool.slice().sort((a, b) => (scoreRec(b) - scoreRec(a)) || (a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0))[0]

// ── audit helpers (mirror tab-hearing.mjs) ────────────────────────────────────
const story = (profile) => [...new Set(CAST.map(T => claimKey(profile[T])))].sort()
const audit = (profile) => { const a = jointAudit(profile); return { distinct: a.distinctClaims, lies: a.provenLies, closes: story(profile), tau: story(profile).includes(TRUTH_CLAIM) } }
const PROSE = {
  'Takehiro|self_strike|dagger': "the samurai's suicide",
  'Masago|strike|dagger': "the wife's stroke",
  'Tajomaru|strike|dagger': "the bandit's blow",
}
const where = (r) => r.closes.length === 1 ? (PROSE[r.closes[0]] || r.closes[0]) : `${r.closes.length} different accounts`

// ── RL-driven hearing: openings by RL, then rounds of RL best-response ─────────
// `pick` chooses which representative RL commits to when the coupled optimum is tied:
//   'native'  -> the account RL's own runs landed on (its emergent tie-break)
//   'minsig'  -> the engine's convention: min sig among pool accounts at the RL-found optimum
// searchOK is tracked separately: it is true iff RL's discovered optimum VALUE equalled the
// exact max at every best-response, so a divergence with searchOK=true is purely tie-break.
function rlHearing(beta, gamma, openings, profile0, { seeds, EP, rounds = 24, pick = 'native' } = {}) {
  const obj = makePayoff({ beta, gamma })
  const prof = { ...profile0 }
  const st = { opening: openings[pick], refutations: Object.fromEntries(CAST.map(T => [T, 0])) }
  const seen = new Set([CAST.map(T => prof[T].sig).join('|')])
  let terminal = 'open', settledRound = 0, revisionsTotal = 0, searchOK = true
  for (let n = 1; n <= rounds; n++) {
    let revised = 0
    for (const T of CAST) {
      const before = prof[T]
      const r = rlArgmax(T, (rec) => obj.payoff(T, { ...prof, [T]: rec }, st), { seeds, EP })
      if (!r.searchOK) searchOK = false
      const best = r[pick]
      if (best.sig !== before.sig) { prof[T] = best; revised++; revisionsTotal++ }
    }
    if (revised === 0) { terminal = 'settled'; settledRound = n; break }
    const k = CAST.map(T => prof[T].sig).join('|')
    if (seen.has(k)) { terminal = 'cycle'; settledRound = n; break }
    seen.add(k)
  }
  return { profile: prof, terminal, settledRound, revisionsTotal, searchOK, ...audit(prof) }
}

// ── run ───────────────────────────────────────────────────────────────────────
console.log(`pool |Feas(F)| = ${pool.length}   (expect 11);  tau* = ${TRUTH_CLAIM}\n`)

// openings: pure U_i argmax, learned by RL. Grove optima are heavily tied, so we keep both
// the RL-native representative and the engine's min-sig one.
const OPEN = { seeds: 4, EP: 6000 }
const REV = { seeds: 4, EP: 8000 }
const obj0 = makePayoff({ beta: 0, gamma: 0 })
const openings = { native: {}, minsig: {} }
console.log('openings (RL argmax of U_i):  [# = how many pool accounts share the optimum value]')
for (const T of CAST) {
  const rl = rlArgmax(T, (r) => obj0.Uself(T, r), OPEN)
  openings.native[T] = rl.native
  openings.minsig[T] = rl.minsig
  const ties = pool.filter(r => Math.abs(obj0.Uself(T, r) - rl.score) < EPS)
  const distinctCk = new Set(ties.map(claimKey)).size
  console.log(`  ${T.padEnd(9)} opt ${rl.score.toFixed(3)}  searchOK ${rl.searchOK}  tied #${ties.length} across ${distinctCk} claim(s)` +
    `   native ${claimKey(rl.native).padEnd(28)} | min-sig ${claimKey(rl.minsig)}`)
}

// gamma* searched on the EXACT hearing, exactly as the paper does
let gStar = null
for (let j = 0; j <= 40; j++) { const g = j / 40; if (audit(runHearing({ pool, obj: makePayoff({ beta: 0.5, gamma: g }) }).profile).lies === 2) { gStar = g; break } }

const CONDS = [
  { label: 'independent      (beta=0)', beta: 0, gamma: 0 },
  { label: 'a hearing        (beta=0.5, gamma=0)', beta: 0.5, gamma: 0 },
  { label: `+ accountability (beta=0.5, gamma=${gStar})`, beta: 0.5, gamma: gStar },
]
const fmt = (a) => `${a.distinct}`.padStart(3) + ' |' + `${a.lies}`.padStart(4) + ' |' + `${a.tau ? 'yes' : 'no'}`.padStart(5) + ' | ' + where(a)
const same = (ex, rl) => ex.distinct === rl.distinct && ex.lies === rl.lies && ex.tau === rl.tau && ex.closes.join('+') === rl.closes.join('+')

for (const pick of ['native', 'minsig']) {
  console.log(`\n=== RL-driven hearing (${pick} tie-break)  vs  exact engine ===`)
  console.log(`${''.padEnd(34)}|dist|lies| tau*| closes on`)
  const results = []
  for (const c of CONDS) {
    const ex = audit(runHearing({ pool, obj: makePayoff({ beta: c.beta, gamma: c.gamma }) }).profile)
    const rl = rlHearing(c.beta, c.gamma, openings, { ...openings[pick] }, { ...REV, pick })
    results.push({ ex, rl })
    console.log(`\n${c.label}`)
    console.log(`  exact: ${fmt(ex)}`)
    console.log(`  RL   : ${fmt(rl)}   [${rl.terminal}@${rl.settledRound}, ${rl.revisionsTotal} rev, searchOK ${rl.searchOK}]  -> ${same(ex, rl) ? 'REPRODUCED' : 'DIFFERS'}`)
  }
  const allSame = results.every(r => same(r.ex, r.rl))
  const allSearchOK = results.every(r => r.rl.searchOK)
  console.log(`\n  ${pick}: ${allSame ? 'reproduces all three conditions' : 'diverges on >=1 condition'}` +
    `  (RL found the exact optimum value at every best-response: ${allSearchOK ? 'yes' : 'NO'})`)
}
