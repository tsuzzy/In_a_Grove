#!/usr/bin/env node
// Self-test for the coupled testimony game. Same style as test-domain.mjs.
// The load-bearing test is #4: at β=0 the game must reproduce V1 EXACTLY.
// Usage: node recon/test-game.mjs   (no API key)

import {
  CAST, feasibles, atoms, ATOM_KEYS, DEFAULT_ATOM_W, credibility, Uself, Utot,
  level0, bestResponse, levelK, nashEquilibria, jointAudit, frameUp, claimKey, label,
  TRUTH_CLAIM, assertsTruth,
} from './game-core.mjs'

let pass = 0, fail = 0
function expect(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${detail}`) }
}

// ---------- 1) atom decomposition ----------
console.log('\n[1] atoms')
{
  const r = feasibles[0]
  const a = atoms(r)
  expect('all five atom keys present', ATOM_KEYS.every(k => k in a), JSON.stringify(a))
  expect('atoms reconstruct the signature',
    `${a.actor}|${a.type}|${a.weapon}|bound:${a.bound}|armed:${a.armed}` === r.sig,
    `${JSON.stringify(a)} vs ${r.sig}`)
  expect('every feasible record decomposes losslessly',
    feasibles.every(x => {
      const y = atoms(x)
      return `${y.actor}|${y.type}|${y.weapon}|bound:${y.bound}|armed:${y.armed}` === x.sig
    }))
}

// ---------- 2) credibility bounds and monotonicity ----------
console.log('\n[2] credibility')
{
  const same = Object.fromEntries(CAST.map(T => [T, feasibles[0]]))
  const cAll = credibility(CAST[0], same)
  expect('unanimity gives cred = 1', Math.abs(cAll - 1) < 1e-12, `got ${cAll}`)

  // find a genuinely maximally-disagreeing profile for witness 0
  let worst = Infinity, worstP = null
  for (const b of feasibles) for (const c of feasibles) {
    const p = { [CAST[0]]: feasibles[0], [CAST[1]]: b, [CAST[2]]: c }
    const v = credibility(CAST[0], p)
    if (v < worst) { worst = v; worstP = p }
  }
  expect('disagreement lowers cred strictly below unanimity', worst < cAll - 1e-9, `worst=${worst}`)
  expect('cred stays in (1/3, 1]', worst > 1 / 3 - 1e-9 && cAll <= 1 + 1e-12, `worst=${worst}`)

  // monotone: swapping one dissenter to agreement cannot lower cred
  const half = { ...worstP, [CAST[1]]: feasibles[0] }
  expect('moving a dissenter to agreement does not lower cred',
    credibility(CAST[0], half) >= worst - 1e-12,
    `${credibility(CAST[0], half)} vs ${worst}`)
}

// ---------- 3) atom weights actually matter ----------
console.log('\n[3] atom weights')
{
  // two accounts sharing the coarse claim but differing on circumstance atoms
  const pairs = []
  for (const a of feasibles) for (const b of feasibles)
    if (a.sig !== b.sig && claimKey(a) === claimKey(b)) pairs.push([a, b])
  expect('the feasible set contains same-claim / different-circumstance pairs', pairs.length > 0,
    `found ${pairs.length}`)
  if (pairs.length) {
    const [a, b] = pairs[0]
    const p = { [CAST[0]]: a, [CAST[1]]: b, [CAST[2]]: b }
    const heavyFatal = credibility(CAST[0], p, [9, 9, 9, 1, 1])
    const heavyCirc = credibility(CAST[0], p, [1, 1, 1, 9, 9])
    expect('weighting fatal atoms up beats weighting circumstance up',
      heavyFatal > heavyCirc, `${heavyFatal} vs ${heavyCirc}`)
  }
}

// ---------- 4) THE REGRESSION ANCHOR: β=0 is V1, exactly ----------
console.log('\n[4] β=0 degenerates to V1 exactly')
{
  const p0 = level0()
  expect('Utot(β=0) === Uself for every witness × every feasible account',
    CAST.every(T => feasibles.every(r =>
      Utot(T, { ...p0, [T]: r }, 0) === Uself(T, r))))

  const one = bestResponse(p0, 0)
  expect('one best-response step at β=0 changes nothing',
    CAST.every(T => one[T].sig === p0[T].sig),
    CAST.map(T => `${T}:${p0[T].sig}->${one[T].sig}`).join(' '))

  const { traj, terminal } = levelK(6, 0)
  expect('level-k at β=0 is a fixed point immediately', terminal.kind === 'fixed' && terminal.at === 1,
    JSON.stringify(terminal))

  // the three published V1 answers
  const expected = {
    Tajomaru: 'Masago — dagger killing (dagger)',
    Masago: 'Tajomaru — dagger killing (dagger)',
    Takehiro: 'Takehiro (self) — suicide (dagger)',
  }
  for (const T of CAST) {
    expect(`level-0 ${T} reproduces V1: ${expected[T]}`,
      label(traj[0][T].an) === expected[T], `got ${label(traj[0][T].an)}`)
  }
}

// ---------- 5) V1 joint audit reproduced at level-0 ----------
console.log('\n[5] joint audit at level-0 matches joint-data.json')
{
  const a = jointAudit(level0())
  expect('distinctClaims = 3', a.distinctClaims === 3, `${a.distinctClaims}`)
  expect('jointlySat = false', a.jointlySat === false)
  expect('atMostTrue = 1', a.atMostTrue === 1)
  expect('provenLies = 2', a.provenLies === 2)
  expect('indivFeasible = true', a.indivFeasible === true)
  // Masago's optimum now blames the bandit, so every agent is accused by someone. This
  // moved when the rope-cutter stopped counting toward agency: her ceiling fell from 81 to
  // 75 and her argmax left the contested-impaling account.
  expect('every agent is accused by someone at level-0', a.unaccused.length === 0, a.unaccused.join(','))
  expect('no frame-up at level-0 (independent optima cannot collude)', frameUp(level0()) === null)
}

// ---------- 6) the game machinery is sane at β>0 ----------
console.log('\n[6] game machinery at β>0')
{
  // At β=0 payoffs are independent of the others, so EVERY profile in which each witness
  // maximises U_self is an equilibrium. U_self is heavily tied at equal weights
  // (Tajomaru 7/11, Masago 7/11, Takehiro 1/11) => 7*7*1 = 49. V1 reports exactly one of
  // them, selected by argmaxBy's string tie-break. See section [7].
  const eq0 = nashEquilibria(0)
  expect('at β=0 equilibria = the tie-consistent profiles (49)', eq0.length === 49,
    `${eq0.length} equilibria`)
  expect('at β=0 every equilibrium maximises U_self for all three',
    eq0.every(p => CAST.every(T => {
      const best = Math.max(...feasibles.map(r => Uself(T, r)))
      return Math.abs(Uself(T, p[T]) - best) < 1e-12
    })))
  expect("V1's published profile is one of them",
    eq0.some(p => CAST.every(T => p[T].sig === level0()[T].sig)))

  const eq1 = nashEquilibria(1)
  expect('at β=1 at least one equilibrium exists', eq1.length >= 1, `${eq1.length}`)
  expect('at β=1 every equilibrium is unanimous (pure credibility ⇒ agree)',
    eq1.every(p => new Set(CAST.map(T => p[T].sig)).size === 1),
    `${eq1.map(p => new Set(CAST.map(T => p[T].sig)).size).join(',')}`)

  const { terminal } = levelK(12, 0.5)
  expect('level-k at β=0.5 terminates (fixed point or detected cycle)',
    terminal.kind === 'fixed' || terminal.kind === 'cycle', JSON.stringify(terminal))
}

// ---------- 7) tie sensitivity of V1's equal-weight headline ----------
// Discovered while building V2, and it is a fact about V1, not about the game layer:
// at equal weights the witnesses are widely indifferent, so joint.mjs's headline numbers
// depend on how the tie is broken. Locked in here so it cannot silently regress.
console.log('\n[7] tie sensitivity of the V1 equal-weight result')
{
  const tiesFor = (T) => {
    const best = Math.max(...feasibles.map(r => Uself(T, r)))
    return feasibles.filter(r => Math.abs(Uself(T, r) - best) < 1e-12)
  }
  expect('Tajomaru is indifferent among 7 feasible accounts', tiesFor('Tajomaru').length === 7)
  expect('Masago is indifferent among 7', tiesFor('Masago').length === 7)
  expect('Takehiro has a unique optimum (his own suicide)', tiesFor('Takehiro').length === 1)

  const profiles = []
  for (const a of tiesFor('Tajomaru')) for (const b of tiesFor('Masago')) for (const c of tiesFor('Takehiro'))
    profiles.push({ Tajomaru: a, Masago: b, Takehiro: c })
  expect('49 tie-consistent profiles', profiles.length === 49)

  const spread3 = profiles.filter(p => jointAudit(p).distinctClaims === 3).length
  const jsat = profiles.filter(p => jointAudit(p).jointlySat).length
  const unacc = profiles.filter(p => jointAudit(p).unaccused.includes('Tajomaru')).length
  expect('"3/3 Rashomon spread" holds in only 32 of 49', spread3 === 32, `${spread3}`)
  expect('a JOINTLY SATISFIABLE tie-consistent profile exists (V1 headline is not tie-robust)',
    jsat === 1, `${jsat}`)
  expect('"nobody accuses Tajomaru" holds in 21 of 49 — NOT tie-robust', unacc === 21, `${unacc}`)
}

// ---------- 8) the headline results of the game layer ----------
console.log('\n[8] coupling results')
{
  // the auditor's truth-free proof: jointly unsatisfiable => >=2 proven lies
  const at = (b) => { const { traj } = levelK(12, b); return jointAudit(traj[traj.length - 1]) }
  expect('β=0: jointly unsatisfiable, 2 proven lies (V1 preserved)',
    at(0).jointlySat === false && at(0).provenLies === 2)
  expect('β=0.5: coordinated into ONE story, 0 proven lies',
    at(0.5).jointlySat === true && at(0.5).provenLies === 0)

  let star = null
  for (let i = 0; i <= 20 && star === null; i++) if (at(i / 20).jointlySat) star = i / 20
  expect('β* (audit tool fails) = 0.05', Math.abs(star - 0.05) < 1e-9, `${star}`)

  // The cycling band is gone. It existed only while the rope-cutter inflated some accounts'
  // U, which created the near-ties that made simultaneous revision oscillate. With a clean
  // objective, level-k settles at every β — so "no stable story" was never about the game.
  const cycles = []
  for (let i = 0; i <= 20; i++) if (levelK(12, i / 20).terminal.kind === 'cycle') cycles.push(i / 20)
  expect('level-k settles at every β — the cycling band was an artefact of the bad agency term',
    cycles.length === 0, `cycles at ${cycles.join(',')}`)

  // truth as an equilibrium
  const truthfulAt = (b) => nashEquilibria(b).filter(p => CAST.every(T => assertsTruth(p[T]))).length
  expect('truth is NOT an equilibrium at β=0.5', truthfulAt(0.5) === 0)
  expect('truth IS an equilibrium at β=0.65', truthfulAt(0.65) > 0)
  expect('τ* is the recorded ledger: Masago struck with the dagger',
    TRUTH_CLAIM === 'Masago|strike|dagger')
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
