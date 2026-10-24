#!/usr/bin/env node
// TABLE: what answering one another does to the record, and what buys the proof back.
//
// Emits the LaTeX body of the paper's hearing table (tab-hearing.tex). Every cell is
// RECOMPUTED here from the same modules that produce the other numbers -- grove-enum for
// the feasible set, dialogue.hearing for the hearing, game-core.jointAudit for the proof --
// rather than transcribed, which is the rule the figures already follow.
//
// The rows are one experiment each, all on the SAME F, the SAME U_i and the SAME feasible
// set. Only the mode of testimony changes:
//
//   independent      beta = 0. This is the setting at which U_i^tot reduces to U_i exactly,
//                    so this row must reproduce the paper's independent result or something
//                    has broken. Asserted below.
//   hearing          beta = 0.5, gamma = 0. Witnesses speak in turn, hear the standing
//                    record, and either revise or hold.
//   + accountability gamma raised until the proof comes back. The value is SEARCHED, not
//                    assumed, so the table cannot claim a threshold that moved.
//   private motives  each witness knows only their own objective and infers the others'
//                    from what they say. Run by private-hearing.mjs; reported here as the
//                    same experiment with opponent models rather than public weights.
//   simultaneous     level-k, everyone guessing at once instead of taking turns.
//
// Also emitted: the revision ledger, which is the mechanism -- every revision gains 0 on
// U_i and buys corroboration alone. If that ever stops being true the script throws,
// because the paper's sentence about it would then be false.
//
// NO LLM. Usage: node recon/tab-hearing.mjs

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { AFTERMATH } from './domain.mjs'
import { enumerateShared, DEGENERATE, CAST } from './grove-enum.mjs'
import { hearing } from './dialogue.mjs'
import { jointAudit, claimKey, levelK, TRUTH_CLAIM } from './game-core.mjs'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const SPECS = { 'run-06': AFTERMATH["pre-B'/run-06"], akutagawa: AFTERMATH['akutagawa/canonical'] }
const space = enumerateShared({ specs: SPECS, degenerate: DEGENERATE })
const pool = space.feasibleUnder('run-06')

const story = (profile) => [...new Set(CAST.map(T => claimKey(profile[T])))].sort()
const audit = (profile) => {
  const a = jointAudit(profile)
  return { distinct: a.distinctClaims, lies: a.provenLies, closes: story(profile) }
}

// ---- the rows ----
const rows = []
const run = (label, beta, gamma) => {
  const h = hearing({ pool, beta, gamma })
  const a = audit(h.profile)
  rows.push({ label, beta, gamma, ...a, revisions: h.moves.filter(m => m.act === 'revise').length })
  return { h, a }
}

const indep = run('independent testimony', 0, 0)
const hear = run('a hearing', 0.5, 0)

// gamma* is SEARCHED, never assumed
let gStar = null
for (let j = 0; j <= 40; j++) {
  const g = j / 40
  if (audit(hearing({ pool, beta: 0.5, gamma: g }).profile).lies === 2) { gStar = g; break }
}
if (gStar === null) throw new Error('no accountability in [0,1] restores the proof at beta=0.5')
run(`\\quad $+$ accountability $\\gamma=${gStar}$`, 0.5, gStar)

// simultaneous rather than sequential: everyone best-responds at once, nobody takes a turn
const lk = levelK(12, 0.5)
const lkProfile = lk.traj[lk.traj.length - 1]

// ---- preconditions: assert, do not assume ----
if (!(indep.a.distinct === 3 && indep.a.lies === 2)) {
  throw new Error(`beta=0 must reproduce independent testimony (3 distinct, 2 lies); got ` +
    `${indep.a.distinct} and ${indep.a.lies}. The comparison this table makes is void.`)
}
if (!(hear.a.distinct === 1 && hear.a.lies === 0)) {
  throw new Error(`the hearing no longer collapses to one account with no provable lies; got ` +
    `${hear.a.distinct} and ${hear.a.lies}.`)
}
if (hear.a.closes.includes(TRUTH_CLAIM)) {
  throw new Error('the hearing now settles on the true history; the paper says it does not.')
}
// The strong claim the paper reports: under independent testimony the true history IS on the
// record; after corroboration it is NOT.
if (!indep.a.closes.includes(TRUTH_CLAIM)) {
  throw new Error('tau* is no longer among the independently selected accounts. The paper claims ' +
    'the hearing REMOVES a true account from the record; if it was never there, that claim is false.')
}

// ---- the revision ledger: every revision must gain 0 on U_i, or the paper's sentence is false ----
const revisions = hear.h.moves.filter(m => m.act === 'revise')
const nonzero = revisions.filter(m => m.gainSelf !== 0)
if (nonzero.length) {
  throw new Error('a revision gained ' + nonzero.map(m => `${m.speaker}:${m.gainSelf}`).join(', ') +
    ' on U_i. The paper says every revision gains 0 and buys corroboration alone; that is now false.')
}
console.log('revision ledger (recomputed):')
for (const m of revisions) {
  console.log(`   ${m.speaker.padEnd(9)} ${m.fromLabel}`)
  console.log(`   ${' '.repeat(9)}  -> ${m.toLabel}`)
  console.log(`   ${' '.repeat(9)}  U_i ${m.gainSelf >= 0 ? '+' : ''}${m.gainSelf}   corroboration +${m.gainCred}   credibility now ${m.cred}`)
}

// ---- emit ----
const PROSE = {
  'Takehiro|self_strike|dagger': "the samurai's suicide",
  'Masago|strike|dagger': "the wife's stroke",
  'Tajomaru|strike|dagger': "the bandit's blow",
  'Takehiro|impale_on_held|dagger': 'the samurai onto a held blade',
}
const where = (r) => r.closes.length === 1
  ? (PROSE[r.closes[0]] || r.closes[0].replace(/_/g, '\\_'))
  : `${r.closes.length} different accounts`
// The stronger column, and the one worth reporting: is the true history still on the record?
// (Under independent testimony it is.)
const tauOnRecord = (r) => r.closes.includes(TRUTH_CLAIM) ? 'yes' : '\\textbf{no}'
const body = rows.map(r =>
  `${r.label} & $${r.distinct}$ & $${r.lies}$ & ${where(r)} & ${tauOnRecord(r)} \\\\`
).join('\n')
fs.writeFileSync(path.join(HERE, 'tab-hearing.tex'), body + '\n')

fs.writeFileSync(path.join(HERE, 'tab-hearing-data.json'), JSON.stringify({
  note: 'every number the paper reports about the hearing. Recomputed, not transcribed.',
  rows, gammaStar: gStar, truthClaim: TRUTH_CLAIM,
  levelK: { terminal: lk.terminal.kind, closes: story(lkProfile) },
  revisions: revisions.map(m => ({
    speaker: m.speaker, from: m.fromLabel, to: m.toLabel,
    gainSelf: m.gainSelf, gainCred: m.gainCred, uSelf: m.uSelf, cred: m.cred,
  })),
}, null, 1))

console.log('\nrows (recomputed, not transcribed):')
for (const r of rows) {
  console.log(`  ${r.label.padEnd(34)} beta=${r.beta} gamma=${r.gamma}  ` +
    `distinct=${r.distinct} lies=${r.lies} revisions=${r.revisions}  closes on ${r.closes.join(' + ')}`)
}
console.log(`\n  tau* = ${TRUTH_CLAIM}`)
console.log(`  gamma* at beta=0.5 (searched) = ${gStar}`)
console.log(`  level-k (simultaneous, ${lk.terminal.kind}) = ${story(lkProfile).join(' + ')}`)
console.log(`  same destination as the hearing? ${story(lkProfile).join('+') === hear.a.closes.join('+')}`)
console.log('written: recon/tab-hearing.tex')
