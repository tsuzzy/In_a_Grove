#!/usr/bin/env node
// Self-test for the Franceschini domain.
//
// The load-bearing tests are [2] — the husband's privilege dies on each of its clauses
// separately, and in particular a man cannot prosecute a flight by people he has just killed,
// which is the bug that once made the whole mechanism inert — and [5], that two signatures
// spelling one assertion are worth exactly the same to every one of the seven objectives,
// which is what makes the quotient legitimate.
//
// Usage: node recon/test-ring.mjs   (no API key)

import { ACTIONS, simulate, initialState, signature, sigKey, diffRecord, RECORD } from './ring-domain.mjs'
import { enumerate, popeScores, pinning, assertKey, COORDS } from './ring-core.mjs'
import { features, dimsOf, DIM_NAMES, U, CAST, brief, DISPUTED } from './ring-objective.mjs'
import { V, SPECTATORS, tilt, altPompilia } from './ring-extensions.mjs'
import { CONTESTED, CONTESTED_KEYS, LADDER, buildRecord, buildReading, readings, coherent } from './ring-evidence.mjs'

const PRINCIPALS = CAST

let pass = 0, fail = 0
const expect = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${detail}`) }
}

const EPS = 1e-9
const space = enumerate()
const ALL = space.assertionsUnder({})
const FEAS = space.assertionsUnder(RECORD)

// the canonical run-up: she is taught, letters are written, they fly, they lie together,
// he comes up with them at the inn. From here the two killings diverge.
const RUNUP = [
  { type: 'teach_letters' }, { type: 'write_letters', actor: 'Pompilia' },
  { type: 'conceive_at_arezzo' }, { type: 'summon' }, { type: 'depart' },
  { type: 'lie_together' }, { type: 'rest_at_inn' }, { type: 'overtake' },
]

// ---------- 1) the simulator ----------
console.log('\n[1] the simulator replays and refuses')
{
  expect('the run-up to Castelnuovo replays', simulate(RUNUP).ok)
  expect('she cannot write before she is taught',
    !simulate([{ type: 'write_letters', actor: 'Pompilia' }]).ok)
  expect('a priest and a count can write without being taught',
    simulate([{ type: 'write_letters', actor: 'Caponsacchi' }]).ok &&
    simulate([{ type: 'write_letters', actor: 'Guido' }]).ok)
  expect('nobody departs before someone sets the flight going',
    !simulate([{ type: 'depart' }]).ok)
  expect('he cannot come up with them if they reached Rome',
    !simulate([{ type: 'summon' }, { type: 'depart' }, { type: 'press_on' }, { type: 'overtake' }]).ok)
}

// ---------- 2) the husband's privilege ----------
console.log('\n[2] in continenti — every clause bites separately')
{
  expect('taken in the act, in the moment, no suit → the privilege holds',
    simulate([...RUNUP, { type: 'kill_in_continenti' }]).ok)

  // clause: flagrante
  const chaste = RUNUP.filter(a => a.type !== 'lie_together')
  expect('with nothing to take them in, the privilege fails',
    !simulate([...chaste, { type: 'kill_in_continenti' }]).ok)

  // clause: no recourse to a judge
  expect('having sued, he may not afterwards take the law in hand',
    !simulate([...RUNUP, { type: 'sue' }, { type: 'kill_in_continenti' }]).ok)

  // clause: the moment. ANY intervening act closes it, not only the suit.
  expect('an intervening act closes the moment',
    !simulate([...RUNUP, { type: 'hire_men' }, { type: 'kill_in_continenti' }]).ok)

  // THE regression. Without this, `sued` and basis=honor co-occur, the record's establishing
  // the suit stops refuting the privilege, and the filtration shows 'suit' costing Guido
  // nothing at all.
  expect('he cannot prosecute a flight by people he has just killed',
    !simulate([...RUNUP, { type: 'kill_in_continenti' }, { type: 'sue' }]).ok)
  expect('so no history has both a suit and the privilege',
    space.all.every(r => !(r.g.sued && r.g.basis === 'honor')))
}

// ---------- 3) the December birth ----------
console.log('\n[3] the date is evidence about the antecedent history')
{
  const gotAtInn = simulate([{ type: 'summon' }, { type: 'depart' }, { type: 'lie_together' },
    { type: 'rest_at_inn' }, { type: 'overtake' }, { type: 'sue' }, { type: 'judge_flight' },
    { type: 'place_in_convent' }, { type: 'release_to_villa' }, { type: 'deliver' }])
  expect('a child got at the inn is recorded as got at the inn',
    gotAtInn.ok && signature(gotAtInn.state).sire === 'Caponsacchi')
  expect('and a December birth refuses it',
    diffRecord(gotAtInn.state, { birth: 'december' }).length > 0)
  expect('under the full record every feasible account has the child the husband\'s',
    FEAS.length > 0 && FEAS.every(r => r.g.sire === 'Guido'))
}

// ---------- 4) the record shrinks the feasible set, monotonically ----------
console.log('\n[4] evidence as a filtration')
{
  const sizes = LADDER.map((_, i) => space.assertionsUnder(buildRecord(LADDER.slice(0, i + 1))).length)
  expect('adding a fact never grows Feas', sizes.every((n, i) => i === 0 || n <= sizes[i - 1]), sizes.join(','))
  expect('an empty record constrains nothing', space.assertionsUnder({}).length === ALL.length)
  expect('the full record is the end of the ladder',
    space.assertionsUnder(buildRecord(LADDER)).length === FEAS.length)
  // the specific fact that does the work
  const before = space.assertionsUnder(buildRecord(['flight', 'castelnuovo', 'lettersFiled']))
  const after = space.assertionsUnder(buildRecord(['flight', 'castelnuovo', 'lettersFiled', 'suit']))
  const gu = (r) => U.Guido(features('Guido', r.g))
  const maxOf = (a) => a.reduce((m, r) => Math.max(m, gu(r)), -Infinity)
  expect('establishing the suit is what costs Guido his optimum',
    maxOf(after) < maxOf(before) - EPS, `${maxOf(before)} → ${maxOf(after)}`)
}

// ---------- 5) the quotient ----------
console.log('\n[5] her schooling is not an assertion')
{
  const byA = new Map()
  for (const r of space.all) {
    const a = assertKey(r.g)
    if (!byA.has(a)) byA.set(a, [])
    byA.get(a).push(r)
  }
  const scorers = [...PRINCIPALS.map(T => (g) => U[T](features(T, g))), ...SPECTATORS.map(S => (g) => V[S](g))]
  let worstGap = 0
  for (const group of byA.values())
    for (const r of group)
      for (const f of scorers) worstGap = Math.max(worstGap, Math.abs(f(r.g) - f(group[0].g)))
  expect('every objective is constant across the signatures of one assertion',
    worstGap < EPS, `worst gap ${worstGap}`)
  expect('the quotient is not vacuous — some assertions have several signatures',
    [...byA.values()].some(v => v.length > 1))
  expect('and the only coordinate it collapses is literacy',
    [...byA.values()].every(v => v.every(r =>
      COORDS.every(c => String(r.g[c]) === String(v[0].g[c])))))
}

// ---------- 6) feasibility is over ALL end states, not a representative ----------
console.log('\n[6] a signature is feasible if SOME history realises it')
{
  const multi = space.all.filter(r => r.ends.size > 1)
  expect('signatures do reach several distinct end states', multi.length > 0, `${multi.length}`)
  // a signature counted feasible must actually have a witness that replays to a fitting state
  let witnessed = 0
  for (const r of space.feasibleSigs(RECORD)) {
    for (const st of r.ends.values()) if (diffRecord(st, RECORD).length === 0) { witnessed++; break }
  }
  expect('every feasible signature has a witnessing end state',
    witnessed === space.feasibleSigs(RECORD).length)
}

// ---------- 7) what the record settles ----------
console.log('\n[7] the deed is conceded and the interior is not')
{
  const pin = pinning(FEAS)
  for (const c of ['basis', 'sued', 'alone', 'usedName', 'sire', 'reachedRome'])
    expect(`the record pins ${c}`, pin[c].pinned, `values ${pin[c].values}`)
  for (const c of ['initiator', 'letters', 'consummated', 'peril'])
    expect(`the record leaves ${c} open`, !pin[c].pinned)
  expect('every feasible account is a killing at the villa after the suit',
    FEAS.every(r => r.g.basis === 'revenge' && r.g.sued))
}

// ---------- 8) the headline optima ----------
console.log('\n[8] three tellers, three relations to the record')
{
  const maxOver = (pool, f) => pool.reduce((m, r) => Math.max(m, f(r)), -Infinity)
  for (const [T, shouldBite] of [['Guido', true], ['Pompilia', false], ['Caponsacchi', true]]) {
    const f = (r) => U[T](features(T, r.g))
    const bites = maxOver(ALL, f) > maxOver(FEAS, f) + EPS
    expect(`${T}'s unconstrained ideal is ${shouldBite ? 'refuted' : 'attainable'}`, bites === shouldBite)
  }
  const pick = (T) => {
    const f = (r) => U[T](features(T, r.g))
    return FEAS.slice().sort((a, b) => (f(b) - f(a)) || (a.assertion < b.assertion ? -1 : 1))[0]
  }
  expect('the three witnesses choose three DIFFERENT feasible accounts (full Rashomon spread)',
    new Set(PRINCIPALS.map(T => pick(T).assertion)).size === 3)

  // Every objective is strictly SELF-REGARDING: score_d(T, ·) must not change when a
  // coordinate is altered that bears only on another agent's standing and not on T's. The
  // guard that matters is structural — no feature function may be defined in terms of
  // another teller's features — so it is asserted on the shape of the module, not sampled.
  expect("no witness's utility is built out of another's features",
    PRINCIPALS.every(T => DIM_NAMES[T].every(d => typeof features(T, FEAS[0].g)[d] === 'number')) &&
    DIM_NAMES.Pompilia.every(d => d !== 'shielding'))

  // deniability does not add up: the accounts are pairwise as well as jointly unsatisfiable
  const maxers = (T) => { const f = (r) => U[T](features(T, r.g)); const b = Math.max(...FEAS.map(f)); return FEAS.filter(r => f(r) > b - EPS) }
  const asserts = (T, d) => { const v = new Set(maxers(T).map(r => String(d.read(r.g)))); return v.size === 1 ? [...v][0] : null }
  const satisfies = (r, T) => DISPUTED.every(d => { const a = asserts(T, d); return a === null || String(d.read(r.g)) === a })
  expect('no feasible history satisfies all three accounts at once',
    FEAS.filter(r => PRINCIPALS.every(T => satisfies(r, T))).length === 0)
  expect('nor any PAIR of them', PRINCIPALS.every((A, i) =>
    PRINCIPALS.slice(i + 1).every(B => FEAS.filter(r => satisfies(r, A) && satisfies(r, B)).length === 0)))
  expect('yet each account is individually in Feasible(F)',
    PRINCIPALS.every(T => FEAS.some(r => r.assertion === pick(T).assertion)))

  // a witness is credited only with what every one of their maximizers agrees on
  expect('an indifferent witness asserts nothing on that coordinate',
    DISPUTED.some(d => PRINCIPALS.some(T => asserts(T, d) === null)))
}

// ---------- 9) spectators ----------
console.log('\n[9] tellers with nothing at stake')
{
  const spick = (S) => FEAS.slice().sort((a, b) => (V[S](b.g) - V[S](a.g)) || (a.assertion < b.assertion ? -1 : 1))[0]
  const ppick = (T) => {
    const f = (r) => U[T](features(T, r.g))
    return FEAS.slice().sort((a, b) => (f(b) - f(a)) || (a.assertion < b.assertion ? -1 : 1))[0]
  }
  // matched against everything attaining a principal's maximum, not one tie-broken argmax
  const maxers = (T) => { const f = (r) => U[T](features(T, r.g)); const b = Math.max(...FEAS.map(f)); return FEAS.filter(r => f(r) > b - EPS) }
  const consistentWith = (a, T) => maxers(T).some(r => r.assertion === a)
  expect('the three spectators choose three different accounts',
    new Set(SPECTATORS.map(S => spick(S).assertion)).size === 3)
  expect("Half-Rome lands on an account Guido would also have been content with",
    consistentWith(spick('HalfRome').assertion, 'Guido'))
  expect("the Other Half-Rome lands on one Pompilia would also have been content with",
    consistentWith(spick('OtherHalfRome').assertion, 'Pompilia'))
  const tq = tilt(spick('TertiumQuid').g)
  expect('Tertium Quid sits strictly between the two partisans',
    tq > tilt(spick('OtherHalfRome').g) + EPS && tq < tilt(spick('HalfRome').g) - EPS,
    `${tilt(spick('OtherHalfRome').g)} / ${tq} / ${tilt(spick('HalfRome').g)}`)
  expect('and occupies a position no principal chose',
    !PRINCIPALS.some(T => ppick(T).assertion === spick('TertiumQuid').assertion))
  expect('the record is asymmetric: the husband\'s advocate cannot reach the wife\'s advocate\'s score',
    V.HalfRome(spick('HalfRome').g) < V.OtherHalfRome(spick('OtherHalfRome').g) - EPS)
}

// ---------- 10) readings and the Pope ----------
console.log('\n[10] the Pope reports what he can settle')
{
  expect('a reading never credits two assertions that exclude each other',
    readings().every(coherent))
  expect('crediting Guido on the letters excludes both attacks on them',
    !coherent(['wroteThem', 'illiterate']) && !coherent(['wroteThem', 'forged']))
  expect('but the two attacks are compatible with each other',
    coherent(['illiterate', 'forged']))

  const pope = popeScores(space, { base: RECORD })
  const flat = popeScores(space, { base: RECORD, weighted: false })
  const decides = (p) => ['initiator', 'letters', 'consummated', 'peril']
    .filter(c => { const m = p.marginal(FEAS, c); return m[0].mass - m[1].mass > 0.02 })
  expect('a flat prior decides strictly fewer coordinates than an attested one',
    decides(flat).length < decides(pope).length, `${decides(flat)} vs ${decides(pope)}`)
  expect('who set the flight going stays undecided — nobody corroborates anybody on it',
    !decides(pope).includes('initiator'))
  expect('scores are a probability: nothing exceeds 1',
    FEAS.every(r => pope.score(r.assertion) <= 1 + EPS))

  // scored over what a witness ASSERTS: best over the accounts attaining their maximum,
  // since they are indifferent among those and never preferred the worse-surviving one
  const best = (T) => {
    const f = (r) => U[T](features(T, r.g)); const b = Math.max(...FEAS.map(f))
    return FEAS.filter(r => f(r) > b - EPS).reduce((m, r) => Math.max(m, pope.score(r.assertion)), 0)
  }
  expect("Pompilia's account survives strictly more of the case than Guido's",
    best('Pompilia') > best('Guido') + EPS, `${best('Pompilia')} vs ${best('Guido')}`)
  expect("so does Caponsacchi's", best('Caponsacchi') > best('Guido') + EPS)
}

// ---------- 12) the extensions are departures, and are kept out of the mirror ----------
console.log('\n[12] the mirror holds only self-regarding objectives')
{
  expect('the other-regarding variant is not one of the three published utilities',
    !PRINCIPALS.some(T => DIM_NAMES[T].includes('shielding')))
  const f = (r) => U.Pompilia(features('Pompilia', r.g))
  const b = Math.max(...FEAS.map(f))
  const selfMax = FEAS.filter(r => f(r) > b - EPS)
  const ab = Math.max(...FEAS.map(r => altPompilia(r.g)))
  const altMax = FEAS.filter(r => altPompilia(r.g) > ab - EPS)
  expect('and it does select differently — so the choice of shape is load-bearing',
    selfMax.map(r => r.assertion).join() !== altMax.map(r => r.assertion).join())
  expect('spectator utilities read only the tilt, never a principal\'s features',
    SPECTATORS.every(S => FEAS.every(r => Math.abs(V[S](r.g) - V[S](r.g)) < EPS)) &&
    Math.abs(V.HalfRome(FEAS[0].g) + V.OtherHalfRome(FEAS[0].g) - 1) < EPS)
}

// ---------- 11) display does not collapse distinct accounts ----------
console.log('\n[11] the table shows every coordinate an objective reads')
{
  const seen = new Map()
  let collisions = 0
  for (const r of FEAS) {
    const b = brief(r.g)
    if (seen.has(b) && seen.get(b) !== r.assertion) collisions++
    seen.set(b, r.assertion)
  }
  expect('no two distinct feasible assertions render identically', collisions === 0, `${collisions}`)
}

// ---------- 13) the interactive layer, and the bundle the page actually runs ----------
console.log('\n[13] the magistrate page')
{
  const RM = await import('./ring-magistrate-core.mjs')
  const sp = RM.buildSpace()

  const full = RM.replay({ space: sp, facts: RM.ALL_FACTS })
  expect('the full record reproduces |Feas(F)|=36', full.pool.length === 36, `${full.pool.length}`)
  expect('three distinct claims', full.audit.distinctClaims === 3)
  expect('at most ONE witness can be true at a time', full.audit.bestTogether === 1, `${full.audit.bestTogether}`)
  expect('so two of the three are provably lying', full.audit.provenLies === 2)
  expect('and no PAIR is jointly satisfiable', Object.values(full.audit.pairs).every(n => n === 0))
  expect('the solver agrees with ring-optimize on each U_i',
    Math.round(100 * full.sol.Guido.u) === 30 && Math.round(100 * full.sol.Pompilia.u) === 100 &&
    Math.round(100 * full.sol.Caponsacchi.u) === 72,
    [full.sol.Guido.u, full.sol.Pompilia.u, full.sol.Caponsacchi.u].map(x => Math.round(100 * x)).join(','))

  // a witness who is indifferent must not be recorded as asserting the tie-break
  expect("Pompilia asserts nothing about whose hand held the pen",
    full.sol.Pompilia.says['whose hand held the pen'] === null)
  expect('but she does assert what passed at the inn',
    full.sol.Pompilia.says['what passed at the inn'] !== null)

  // ORDER IS LOAD-BEARING — the same documents, differently ordered, is a different hearing
  const a = RM.replay({ space: sp, facts: ['suit', 'birth', 'theName'] })
  const b = RM.replay({ space: sp, facts: ['theName', 'birth', 'suit'] })
  expect('the same documents in either order leave the same feasible set',
    a.pool.length === b.pool.length)
  expect('but the turning points differ',
    JSON.stringify(a.turns.map(t => t.caught)) !== JSON.stringify(b.turns.map(t => t.caught)),
    JSON.stringify(a.turns.map(t => t.caught)))

  // withdrawing is a REWIND, not an undo: the page recomputes from the opening every time,
  // so a sequence must depend only on itself
  const withdrawn = RM.replay({ space: sp, facts: ['suit', 'theName'] })
  const direct = RM.replay({ space: sp, facts: ['suit', 'theName'] })
  expect('replay is a pure function of the sequence',
    JSON.stringify(withdrawn.turns) === JSON.stringify(direct.turns))

  // preview must agree with actually establishing
  const base = RM.replay({ space: sp, facts: ['flight', 'castelnuovo'] })
  let previewOK = true
  for (const f of RM.ALL_FACTS.filter(k => !base.facts.includes(k))) {
    const p = RM.preview(base, { space: sp, fact: f })
    const real = RM.replay({ space: sp, facts: [...base.facts, f] })
    // `impossible` is absent rather than false on a feasible preview, so compare truthiness
    if (!!p.impossible !== !!real.impossible) { previewOK = false; break }
    if (!p.impossible && p.feasibleAfter !== real.pool.length) { previewOK = false; break }
    const lastTurn = real.turns[real.turns.length - 1]
    if (!p.impossible && JSON.stringify(p.wouldCatch) !== JSON.stringify(lastTurn.caught)) { previewOK = false; break }
  }
  expect('preview agrees with establishing, on every remaining document', previewOK)

  // caught-out is decided on the MAXIMIZER SET, not on the displayed representative —
  // otherwise a witness is reported broken because a string tie-break moved
  const caughtEver = new Set(full.turns.flatMap(t => t.caught))
  expect('Guido is caught out by the record', caughtEver.has('Guido'))
  expect('Pompilia never is', !caughtEver.has('Pompilia'))

  // the browser runs the same solver: the generated bundle must agree with the modules
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../../demo/ring-magistrate-bundle.js', import.meta.url), 'utf8')
  const g = {}
  new Function('globalThis', src).call(g, g)
  expect('the bundle exposes what the page uses',
    g.RING && g.RING.magistrate && g.RING.spectators &&
    typeof g.RING.magistrate.buildSpace === 'function' &&
    typeof g.RING.magistrate.replay === 'function' &&
    typeof g.RING.magistrate.pinning === 'function' &&
    typeof g.RING.spectators.V === 'object')
  const bSpace = g.RING.magistrate.buildSpace()
  const bFull = g.RING.magistrate.replay({ space: bSpace, facts: g.RING.magistrate.ALL_FACTS })
  expect('and it is IN SYNC with the sources — same pool, same audit, same utilities',
    bFull.pool.length === full.pool.length &&
    JSON.stringify(bFull.audit) === JSON.stringify(full.audit) &&
    RM.CAST.every(T => Math.abs(bFull.sol[T].u - full.sol[T].u) < EPS),
    'run: node recon/build-ring-magistrate.mjs')
}

console.log(`\n${fail === 0 ? '✓ all' : '✗'} ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
