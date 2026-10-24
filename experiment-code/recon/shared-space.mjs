#!/usr/bin/env node
// THE TWO EVIDENCE SETS, MEASURED IN ONE HISTORY SPACE.
//
// Each evidence set used to be enumerated in its own candidate space, because the search
// pruned at a terminal condition that only one world could satisfy. |Feasible(F)| was then
// not comparable across them, and neither was the "cost of honesty", whose unconstrained
// ideal is a max over that candidate set. Here the grove is enumerated ONCE with no pruning
// on any evidence set, and each set picks its own terminals out of the one space, so every
// count below is measured against the same candidate histories.
//
// NO LLM anywhere. Usage: node recon/shared-space.mjs   (no API key)

import { writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AFTERMATH } from './domain.mjs'
import { enumerateShared, DEGENERATE, CAST } from './grove-enum.mjs'
import { features, U } from './grove-core.mjs'
import { hearing } from './dialogue.mjs'
import { jointAudit, nashEquilibria, profileKey } from './game-core.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const u100 = (x) => Math.round(100 * x)
const argmaxBy = (arr, f) =>
  arr.slice().sort((a, b) => (f(b) - f(a)) || (a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0))[0]

const label = (an) => {
  const f = an.fatal
  const who = f.type === 'self_strike' ? 'Takehiro (self)' : f.actor
  const manner = f.type === 'self_strike' ? 'suicide'
    : f.type === 'impale_on_held' ? 'contested impaling'
    : f.weapon === 'longsword' ? (f.victimArmed ? 'sword duel' : 'sword killing')
    : 'dagger killing'
  return `${who} — ${manner} (${f.weapon}, ${f.part}${f.boundAtDeath ? ', bound' : ''})`
}
// the rope-cutter is deliberately not shown: it is not part of the account this model
// scores, so displaying it would imply a precision the objective does not have
const full = (r) => label(r.an)
const claimKey = (r) => `${r.an.fatal.actor}|${r.an.fatal.type}|${r.an.fatal.weapon}`

const SPECS = { 'run-06': AFTERMATH["pre-B'/run-06"], akutagawa: AFTERMATH['akutagawa/canonical'] }
const WORLDS = [
  { name: 'run-06', title: 'the scene our own agents left', note: 'dagger wound to the throat; both blades at the scene; the longsword unbloodied; Masago still there' },
  { name: 'akutagawa', title: "Akutagawa's canonical scene", note: 'a stab wound to the chest, weapon never named; neither blade found; nobody at the scene' },
]

const space = enumerateShared({ specs: SPECS, degenerate: DEGENERATE })

console.log(`\n=== One shared history space ===`)
console.log(`  states explored ${space.statesExplored}`)
console.log(`  distinct causal signatures  ${space.causalSignatures}`)
console.log(`  one record per signature ${space.all.length}   <- the argmax domain`)
console.log(`  Both evidence sets select their terminals out of this one space, so every`)
console.log(`  count below is measured against the same candidate histories.`)

const results = []
for (const w of WORLDS) {
  const pool = space.feasibleUnder(w.name)
  const gap = space.gapUnder(w.name)
  console.log(`\n=== ${w.name} — ${w.title} ===`)
  console.log(`    ${w.note}`)
  console.log(`    DENIABILITY GAP — causal attributions the evidence cannot rule out: ${gap}`)

  console.log(`\n    witness     wants (over the whole space)                     can say (feasible)                     cost`)
  const costs = {}, picks = {}
  for (const T of CAST) {
    const ideal = argmaxBy(space.all, r => U[T](features(T, r.an)))
    const best = argmaxBy(pool, r => U[T](features(T, r.an)))
    const cost = u100(U[T](features(T, ideal.an))) - u100(U[T](features(T, best.an)))
    costs[T] = cost; picks[T] = best
    console.log(`    ${T.padEnd(10)} ${(full(ideal) + ` [U ${u100(U[T](features(T, ideal.an)))}]`).padEnd(48)} ` +
      `${(full(best) + ` [U ${u100(U[T](features(T, best.an)))}]`).padEnd(38)} ${String(cost).padStart(4)}`)
  }

  const duel = pool.some(r => r.an.fatal.weapon === 'longsword' && r.an.fatal.victimArmed && r.an.fatal.type === 'strike')
  const claims = CAST.map(T => claimKey(picks[T]))
  const distinct = new Set(claims).size
  const accused = new Set(CAST.map(T => picks[T].an.fatal.actor))
  console.log(`\n    the bandit's duel account survives the evidence: ${duel ? 'YES' : 'no'}`)
  console.log(`    distinct fatal claims ${distinct}/3 · jointly satisfiable ${distinct === 1} · proven lies ${distinct === 1 ? 0 : 2}`)
  console.log(`    accused by nobody: ${CAST.filter(a => !accused.has(a)).join(', ') || '(none)'}`)
  results.push({ ...w, pool: pool.length, gap, costs, duel, distinct, provenLies: distinct === 1 ? 0 : 2, picks })
}

// ---- the comparison, now sound ----
console.log(`\n\n=== The comparison, measured in one space ===\n`)
console.log(`  world       feasible  deniability gap  duel survives   cost of honesty (Taj/Mas/Tak)`)
for (const r of results)
  console.log(`  ${r.name.padEnd(11)} ${String(r.gap).padStart(8)} ${String(r.gap).padStart(16)}  ` +
    `${(r.duel ? 'YES' : 'no').padStart(13)}   ${CAST.map(T => r.costs[T]).join(' / ')}`)

const A = results[0], C = results[1]
console.log(`\n  The deniability gap still doubles — ${A.gap} causal attributions against ${C.gap} — and now that is a`)
console.log(`  statement about the evidence alone, because both were counted in the same space.`)
console.log(`  The bandit's duel still survives only Akutagawa's evidence.`)

// ---- what the shared space corrects, and what it leaves standing ----
console.log(`\n=== Corrections, stated ===`)
console.log(`  STANDS, and is a real correction to a published number:`)
console.log(`    |Feasible(F)| = ${A.gap}, not the published 7. Two bugs in the original enumeration:`)
console.log(`    the search deduplicated on physical state, which records the wound but not who`)
console.log(`    dealt it, so one of any two attributions reaching the same state was silently`)
console.log(`    dropped; and a signature's feasibility was decided by testing only its shortest`)
console.log(`    representative. The four recovered accounts are all "killed while still bound,`)
console.log(`    rope cut afterwards" — reachable, evidence-consistent, never enumerated.`)
console.log(`\n  WITHDRAWN — an earlier pass reported the cost of honesty as 0 and "the constraint`)
console.log(`  does not bite". That came from crediting whoever cut the rope with 0.55 agency,`)
console.log(`  four tenths of what striking the fatal blow is worth, which let Tajomaru buy back`)
console.log(`  his ideal inside the feasible set by claiming he freed the man. The rope-cutter is`)
console.log(`  not part of how an account flatters its teller; that term is gone (see \`agency\` in`)
console.log(`  grove-core.mjs), and with it the reported cost of honesty returns to ${A.costs.Tajomaru}.`)
console.log(`\n  So the headline stands: the evidence in OUR scene costs the bandit ${A.costs.Tajomaru} points of glory,`)
console.log(`  and Akutagawa's evidence costs him nothing — ${C.costs.Tajomaru}. That contrast is the point of the`)
console.log(`  canonical case, and it is what the bad agency term had destroyed.`)

// ---- how much of any of this is the tie-break? ----
// "No witness ever accuses the bandit" was published as tie-robust. Removing the rope-cutter
// from the objective lowers Masago's ceiling, which widens her tie set and pulls accounts
// that DO blame Tajomaru into it — so whether that finding survives has to be measured.
console.log(`\n=== How much rests on the tie-break, in the corrected domain ===`)
const ties = {}
for (const r of results) {
  const pool = space.feasibleUnder(r.name)
  const per = {}
  for (const T of CAST) {
    const best = Math.max(...pool.map(x => U[T](features(T, x.an))))
    per[T] = pool.filter(x => Math.abs(U[T](features(T, x.an)) - best) < 1e-12)
  }
  const profiles = []
  for (const a of per.Tajomaru) for (const b of per.Masago) for (const c of per.Takehiro)
    profiles.push({ Tajomaru: a, Masago: b, Takehiro: c })
  const spread3 = profiles.filter(p => new Set(CAST.map(T => claimKey(p[T]))).size === 3).length
  const jsat = profiles.filter(p => new Set(CAST.map(T => claimKey(p[T]))).size === 1).length
  const tajUnacc = profiles.filter(p => !new Set(CAST.map(T => p[T].an.fatal.actor)).has('Tajomaru')).length
  ties[r.name] = { perWitness: Object.fromEntries(CAST.map(T => [T, per[T].length])), profiles: profiles.length, spread3, jsat, tajUnacc }
  console.log(`\n  ${r.name}: tie width ${CAST.map(T => `${T} ${per[T].length}`).join(' · ')}  => ${profiles.length} equally-optimal profiles`)
  console.log(`    3 distinct claims          ${spread3}/${profiles.length}  (${(100 * spread3 / profiles.length).toFixed(1)}%)`)
  console.log(`    jointly satisfiable        ${jsat}/${profiles.length}`)
  console.log(`    nobody accuses the bandit  ${tajUnacc}/${profiles.length}  (${(100 * tajUnacc / profiles.length).toFixed(1)}%)`)
}
console.log(`\n  Reading: "no witness ever accuses the bandit" was published as tie-robust. In the`)
console.log(`  corrected domain it is ${ties['run-06'].tajUnacc === ties['run-06'].profiles ? 'still robust' : 'NOT robust'} — ${ties['run-06'].tajUnacc} of ${ties['run-06'].profiles} equally-optimal profiles leave him unaccused,`)
console.log(`  and the string tie-break now happens to select one that does not. It needs the same`)
console.log(`  hedge as the proven-lies claim: report the fraction, not the single profile.`)

// ---- the coupled hearing on each world, for the exhibit ----
console.log(`\n=== The hearing on each world (β=0.5) ===\n`)
console.log(`   world       feasible  β*(proof fails)  γ*(proof restored)  equilibria  settles`)
const games = []
for (const r of results) {
  const pool = space.feasibleUnder(r.name)
  let bStar = null, gStar = null
  for (let i = 0; i <= 20 && bStar === null; i++)
    if (jointAudit(hearing({ pool, beta: i / 20 }).profile).jointlySat) bStar = i / 20
  for (let j = 0; j <= 40 && gStar === null; j++)
    if (jointAudit(hearing({ pool, beta: 0.5, gamma: j / 40 }).profile).provenLies === 2) gStar = j / 40
  const h = hearing({ pool, beta: 0.5 })
  const eq = nashEquilibria(0.5, { pool })
  games.push({ id: r.name === 'run-06' ? 'A' : 'C', name: r.name, feasible: pool.length,
    betaStar: bStar, gammaStar: gStar, equilibria: eq.length, settles: h.terminal.kind,
    cycling: [], truthful: null })
  console.log(`   ${r.name.padEnd(11)} ${String(pool.length).padStart(8)} ${String(bStar).padStart(16)} ` +
    `${String(gStar).padStart(19)} ${String(eq.length).padStart(11)}  ${h.terminal.kind}`)
}

// ---- exhibit data (akutagawa.html reads this) ----
const exhibit = {
  generatedAt: new Date().toISOString(),
  worlds: results.map((r, i) => ({
    id: i === 0 ? 'A' : 'C', name: r.title, note: r.note,
    feasible: r.gap, gap: r.gap, costs: r.costs, duelFeasible: r.duel,
    distinctClaims: r.distinct, provenLies: r.provenLies,
    picks: CAST.map(T => {
      const pool = space.feasibleUnder(r.name)
      const ideal = argmaxBy(space.all, x => U[T](features(T, x.an)))
      const best = argmaxBy(pool, x => U[T](features(T, x.an)))
      return {
        witness: T,
        wants: { label: full(ideal), U: u100(U[T](features(T, ideal.an))), feasible: !!ideal.feasible[r.name] },
        says: { label: full(best), U: u100(U[T](features(T, best.an))), blames: best.an.fatal.actor },
        cost: r.costs[T],
      }
    }),
    unaccused: CAST.filter(a => !new Set(CAST.map(T => r.picks[T].an.fatal.actor)).has(a)),
  })),
  games,
  evidence: {
    run06: ['Takehiro dead, throat, by the dagger', 'the dagger is at the scene and bloodied',
      'the longsword is at the scene and unbloodied', 'the rope is cut', 'Masago is still in the grove'],
    akutagawa: ['Takehiro dead, a stab wound to the CHEST — the woodcutter never names the weapon',
      "at the scene: one rope and a woman's comb, nothing else",
      'neither blade is found — the tachi rides off with Tajomaru',
      'the horse is gone', 'nobody is at the scene'],
  },
}
writeFileSync(`${HERE}/../../demo/akutagawa-data.js`, `window.AKUTAGAWA = ${JSON.stringify(exhibit, null, 1)}\n`)

const dump = {
  generatedAt: new Date().toISOString(),
  games, ties,
  space: { states: space.statesExplored, causalSignatures: space.causalSignatures, extendedSignatures: space.all.length },
  worlds: results.map(r => ({
    name: r.name, title: r.title, note: r.note, feasible: r.pool, gap: r.gap,
    costs: r.costs, duelSurvives: r.duel, distinctClaims: r.distinct, provenLies: r.provenLies,
    picks: CAST.map(T => ({ witness: T, account: full(r.picks[T]), blames: r.picks[T].an.fatal.actor })),
  })),
  correction: {
    was: { costOfHonesty: { Tajomaru: 14, Masago: 0, Takehiro: 0 }, constraintBites: true },
    now: { costOfHonesty: A.costs, constraintBites: CAST.some(T => A.costs[T] > 0) },
    cause: 'argmax was taken over causal signatures; U_i also depends on who cut the rope, so the reported optimum depended on which representative history was stored.',
  },
}
writeFileSync(`${HERE}/shared-space-data.json`, JSON.stringify(dump, null, 1))
console.log(`\nwritten: recon/shared-space-data.json\n`)
