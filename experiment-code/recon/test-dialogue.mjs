#!/usr/bin/env node
// Self-test for the hearing (sequential public revision).
// The load-bearing tests are [2] — a settled hearing must be a genuine Nash equilibrium,
// checked against the brute-forced set rather than asserted — and [4], that who speaks
// first changes which past gets recorded.
// Usage: node recon/test-dialogue.mjs   (no API key)

import { hearing, settledIsNash } from './dialogue.mjs'
import {
  CAST, feasibles, label, claimKey, jointAudit, nashEquilibria, levelK, profileKey, level0,
} from './game-core.mjs'

let pass = 0, fail = 0
const expect = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${detail}`) }
}
const ORDERS = [
  ['Tajomaru', 'Masago', 'Takehiro'], ['Tajomaru', 'Takehiro', 'Masago'],
  ['Masago', 'Tajomaru', 'Takehiro'], ['Masago', 'Takehiro', 'Tajomaru'],
  ['Takehiro', 'Tajomaru', 'Masago'], ['Takehiro', 'Masago', 'Tajomaru'],
]
const story = (p) => [...new Set(CAST.map(T => claimKey(p[T])))].sort().join(' + ')

// ---------- 1) the hearing opens on the independent solution ----------
console.log('\n[1] opening statements are the independent optimum — V1 opens the hearing')
{
  const h = hearing({ beta: 0.5 })
  const opens = h.moves.filter(m => m.act === 'open')
  expect('one opening statement per witness', opens.length === 3)
  const p0 = level0()
  expect('each opening equals that witness\'s independent argmax',
    CAST.every(T => opens.find(m => m.speaker === T).to === p0[T].sig))
  const expected = {
    Tajomaru: 'Masago — dagger killing (dagger)',
    Masago: 'Tajomaru — dagger killing (dagger)',
    Takehiro: 'Takehiro (self) — suicide (dagger)',
  }
  expect('and reproduces the three published V1 accounts',
    CAST.every(T => label(p0[T].an) === expected[T]))
  expect('nobody corroborates anybody at the opening',
    opens.every(m => m.corroborates.length === 0))
}

// ---------- 2) a settled hearing IS an equilibrium ----------
console.log('\n[2] settling means solving, not merely stopping')
{
  const h = hearing({ beta: 0.5 })
  expect('the hearing settles rather than cycling', h.terminal.kind === 'settled', h.terminal.kind)
  expect('the closing record is in the brute-forced Nash set', settledIsNash(h) === true)
  // the defining property, checked directly: nobody can gain by moving
  const eq = nashEquilibria(0.5)
  expect('and that set is not trivial (several equilibria exist to choose from)', eq.length > 1, `${eq.length}`)
  expect('the last round contains no revisions',
    h.moves.filter(m => m.round === h.terminal.round).every(m => m.act === 'stand'))
}

// ---------- 3) β=0 leaves the hearing where it opened ----------
console.log('\n[3] β=0 — nobody cares about corroboration, so nobody moves')
{
  const h = hearing({ beta: 0 })
  expect('no revisions at all', h.moves.every(m => m.act !== 'revise'))
  const a = jointAudit(h.profile)
  expect('closes on 3 distinct claims / 2 proven lies (V1 intact)',
    a.distinctClaims === 3 && a.provenLies === 2)
}

// ---------- 4) who speaks first changes the recorded past ----------
console.log('\n[4] speaking order selects which past is recorded')
{
  const runs = ORDERS.map(order => hearing({ beta: 0.5, order }))
  expect('every speaking order settles', runs.every(h => h.terminal.kind === 'settled'))
  expect('every settled close is a verified equilibrium', runs.every(h => settledIsNash(h) === true))
  const outcomes = new Set(runs.map(h => story(h.profile)))
  expect('the orders do NOT all reach the same story', outcomes.size > 1, `${outcomes.size}`)
  expect('exactly 2 distinct pasts across the 6 orders', outcomes.size === 2, `${outcomes.size}`)
  // the specific dependence: the dead man opening leads somewhere else — if Takehiro speaks
  // first, the record does NOT settle on him having done it himself
  const takFirst = runs.filter((h, i) => ORDERS[i][0] === 'Takehiro').map(h => story(h.profile))
  const others = runs.filter((h, i) => ORDERS[i][0] !== 'Takehiro').map(h => story(h.profile))
  expect('Takehiro speaking first yields a different record from anyone else speaking first',
    new Set(takFirst).size === 1 && new Set(others).size === 1 && takFirst[0] !== others[0],
    `${takFirst[0]} vs ${others[0]}`)
  const reachable = outcomes.size
  const stable = new Set(nashEquilibria(0.5).map(story)).size
  expect('at least one stable story no conversation ever reaches', reachable < stable, `${reachable}/${stable}`)
}

// ---------- 5) nothing cycles any more ----------
// An earlier pass reported a band of β where level-k oscillated and called it "no stable
// story", contrasting it with the hearing's convergence. That band existed only while the
// rope-cutter inflated some accounts' U, producing the near-ties that made simultaneous
// revision flip. With that term gone, both solvers settle everywhere and the contrast is
// withdrawn.
console.log('\n[5] neither solver cycles once the objective is clean')
{
  const cyclingLevelK = [], cyclingHearing = []
  for (let i = 0; i <= 20; i++) {
    const b = i / 20
    if (levelK(12, b).terminal.kind === 'cycle') cyclingLevelK.push(b)
    if (hearing({ beta: b }).terminal.kind === 'cycle') cyclingHearing.push(b)
  }
  expect('level-k no longer cycles anywhere', cyclingLevelK.length === 0, `${cyclingLevelK.join(',')}`)
  expect('the hearing settles at every β', cyclingHearing.length === 0, `${cyclingHearing.join(',')}`)
}

// ---------- 6) the hearing coordinates sooner than level-k ----------
console.log('\n[6] a conversation reaches one story sooner than simultaneous guessing')
{
  const firstSingle = (f) => {
    for (let i = 0; i <= 20; i++) {
      const b = i / 20
      if (jointAudit(f(b)).distinctClaims === 1) return b
    }
    return null
  }
  const bH = firstSingle(b => hearing({ beta: b }).profile)
  const bK = firstSingle(b => { const l = levelK(12, b); return l.traj[l.traj.length - 1] })
  // Both now coordinate from β = 0.05. The earlier "taking turns coordinates sooner" gap
  // was also an artefact of the rope-cutter term; withdrawn.
  expect('hearing closes on one story from β = 0.05', Math.abs(bH - 0.05) < 1e-9, `${bH}`)
  expect('level-k does too — the earlier gap is withdrawn', Math.abs(bK - 0.05) < 1e-9, `${bK}`)
}

// ---------- 7) the transcript is a usable record ----------
console.log('\n[7] the transcript records what an audit needs')
{
  const h = hearing({ beta: 0.5 })
  const req = ['round', 'speaker', 'act', 'to', 'toLabel', 'uSelf', 'cred', 'corroborates', 'contradicts']
  expect('every move carries the audit fields', h.moves.every(m => req.every(k => k in m)))
  const revs = h.moves.filter(m => m.act === 'revise')
  expect('every revision records what was retracted', revs.every(m => m.from && m.fromLabel))
  expect('every revision decomposes its gain into self-interest and corroboration',
    revs.every(m => typeof m.gainSelf === 'number' && typeof m.gainCred === 'number'))
  expect('no revision is made at a loss', revs.every(m => m.gain > 0), revs.map(m => m.gain).join(','))
  // the two concessions in the default hearing, and what they cost
  // EVERY concession is now free — nobody gives up any self-interest to join the consensus.
  // "The dead man is the one who pays" was an artefact of the rope-cutter term; withdrawn.
  const free = revs.filter(m => m.gainSelf === 0)
  expect('every concession is free — no witness gives up self-interest', free.length === revs.length,
    revs.map(m => `${m.speaker}:${m.gainSelf}`).join(' '))
  expect('so the coordinated consensus costs the witnesses nothing at all',
    revs.every(m => m.gainSelf === 0 && m.gainCred > 0))
}

// ---------- 8) the self-consistency penalty, on the corrected domain ----------
// γ prices a witness's drift from their OWN opening statement. Measured on the extended
// signatures from the shared space, because that is the domain U_i is a function of.
console.log('\n[8] pricing self-contradiction (γ), corrected domain')
{
  const { AFTERMATH } = await import('./domain.mjs')
  const { enumerateShared, DEGENERATE } = await import('./grove-enum.mjs')
  const { drift, driftAtoms, selfConsistency, DRIFT_W } = await import('./dialogue.mjs')
  const space = enumerateShared({ specs: { f: AFTERMATH["pre-B'/run-06"] }, degenerate: DEGENERATE })
  const pool = space.feasibleUnder('f')
  const at = (g, order) => hearing({ pool, beta: 0.5, gamma: g, order })
  const revs = (g) => at(g).moves.filter(m => m.act === 'revise').length

  expect('γ=0 reproduces the un-penalised hearing exactly',
    JSON.stringify(at(0).moves) === JSON.stringify(hearing({ pool, beta: 0.5 }).moves))
  expect('drift is 0 against oneself', pool.every(r => drift(r, r) === 0))
  expect('drift is 1 only for an account sharing no atom with the opening',
    Math.max(...pool.map(r => Math.max(...pool.map(q => drift(r, q))))) <= 1)
  // drift is measured over what the witness ASSERTED. The rope-cutter left U_i earlier and
  // the wound's location is invisible to it, so neither is something they can be said to
  // have claimed — charging drift against them would punish a detail never given.
  expect('drift covers exactly the asserted dimensions, and no others',
    Object.keys(DRIFT_W).join(',') === 'actor,type,weapon,bound,armed')
  expect('neither the rope-cutter nor the wound location is charged as drift',
    !('cutter' in driftAtoms(pool[0])) && !('part' in driftAtoms(pool[0])))
  expect('selfConsistency falls as γ rises', selfConsistency(pool[0], pool[1], 1) <= selfConsistency(pool[0], pool[1], 0.5))

  // the two thresholds
  expect('at γ=0 the witnesses still revise', revs(0) === 2, `${revs(0)}`)
  expect('γ=0.175 still leaves them revising', revs(0.175) === 2, `${revs(0.175)}`)
  // Dropping part and cutter from drift raised the normaliser's bite: the same reversal is
  // now 7/10 of an account rather than 7/12, so a lower γ suffices. 0.225 -> 0.2.
  expect('γ=0.2 stops every revision — the hearing settles on the opening statements',
    revs(0.2) === 0, `${revs(0.2)}`)
  const a0 = jointAudit(at(0).profile), a1 = jointAudit(at(0.25).profile)
  expect('and that RESTORES the auditor\'s proof: 0 proven lies -> 2',
    a0.provenLies === 0 && a1.provenLies === 2, `${a0.provenLies} -> ${a1.provenLies}`)
  expect('with 3 distinct claims again', a1.distinctClaims === 3)
  expect('the settled point is still an equilibrium given the openings',
    settledIsNash(at(0.25), pool) === true)

  // the earlier order-dependence finding is conditional on γ = 0 exactly
  const pasts = (g) => new Set(ORDERS.map(o => story(at(g, o).profile))).size
  expect('at γ=0 the speaking order changes the recorded past (2 outcomes)', pasts(0) === 2, `${pasts(0)}`)
  expect('at γ=0.01 it no longer does — that finding rested on a payoff tie',
    pasts(0.01) === 1, `${pasts(0.01)}`)
  expect('and it stays gone for every larger γ',
    [0.05, 0.1, 0.2, 0.25, 0.5, 1].every(g => pasts(g) === 1))
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
