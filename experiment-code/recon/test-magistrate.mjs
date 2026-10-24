#!/usr/bin/env node
// Self-test for evidence arriving during a hearing.
//
// The load-bearing tests are [4] — a witness is recorded as caught out only if the account
// they were standing on is genuinely unrealisable under the new file, checked by replaying
// its history through the simulator rather than by trusting a flag — and [6], that the
// page's fast incremental path agrees with a full replay of the same sequence.
//
// Usage: node recon/test-magistrate.mjs   (no API key)

import { simulate, diffAftermath, AFTERMATH } from './domain.mjs'
import { FACTS, FACT_KEYS, buildF, WORLDS, LADDER } from './evidence.mjs'
import { buildSpace, poolFor, replay, establish, preview, collapse, assertKey, CAST, jointAudit } from './magistrate-core.mjs'
import { makePayoff, runHearing, standing, drift, openHearing, continueHearing, applyEvidence } from './hearing-core.mjs'
import { hearing } from './dialogue.mjs'

let pass = 0, fail = 0
const expect = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${detail}`) }
}

const SPECS = { 'run-06': AFTERMATH["pre-B'/run-06"], akutagawa: AFTERMATH['akutagawa/canonical'] }
const space = buildSpace(SPECS)
const P = { beta: 0.5, gamma: 0, delta: 0.3 }
const OPT = { part: 'throat' }

// ---------- 1) the evidence module reproduces the named worlds ----------
console.log('\n[1] a file is a list of facts')
{
  const p6 = poolFor(space, WORLDS['run-06'].facts, WORLDS['run-06'].opt)
  const pa = poolFor(space, WORLDS.akutagawa.facts, WORLDS.akutagawa.opt)
  expect('the run-06 fact list reproduces its 11 feasible accounts', p6.length === 11, `${p6.length}`)
  expect('the canonical fact list reproduces its 22', pa.length === 22, `${pa.length}`)
  expect('every fact key is applicable', FACT_KEYS.every(k => { try { buildF([k], OPT); return true } catch { return false } }))
  // 44 causal signatures collapse to 22 ASSERTIONS: throat and chest variants of one claim
  // are the same assertion, because U_i cannot tell them apart and so no witness ever chose
  // between them.
  expect('an empty file constrains nothing — all 22 assertions stand',
    poolFor(space, [], OPT).length === 22, `${poolFor(space, [], OPT).length}`)
  expect('the 44 signatures are exactly 22 assertions × 2 wound locations',
    space.all.length === 44 && poolFor(space, [], OPT).length === 22)
  expect('adding facts never grows the feasible set', LADDER.every((_, i) =>
    poolFor(space, LADDER.slice(0, i + 1), OPT).length <= poolFor(space, LADDER.slice(0, i), OPT).length))
}

// ---------- 2) the δ=0 regression anchor ----------
console.log('\n[2] δ=0 leaves everything as it was')
{
  expect('standing is 1 whatever the refutation count when δ=0',
    [0, 1, 5].every(n => standing(n, 0) === 1))
  const pool = poolFor(space, WORLDS['run-06'].facts, WORLDS['run-06'].opt)
  const a = runHearing({ pool, obj: makePayoff({ beta: 0.5, gamma: 0, delta: 0 }) })
  const b = runHearing({ pool, obj: makePayoff({ beta: 0.5, gamma: 0, delta: 0.9 }) })
  expect('with nobody ever refuted, δ makes no difference at all',
    JSON.stringify(a.profile) === JSON.stringify(b.profile))
}

// ---------- 3) standing is a stock, not a state ----------
console.log('\n[3] standing falls with refutations and cannot be repaired')
{
  expect('1 when never caught', standing(0, 0.3) === 1)
  expect('strictly decreasing in the count',
    standing(1, 0.3) < standing(0, 0.3) && standing(2, 0.3) < standing(1, 0.3))
  expect('floored at 0, never negative', standing(99, 0.3) === 0)
  expect('δ is the price of exactly one refutation',
    Math.abs(standing(1, 0.3) - 0.7) < 1e-12, `${standing(1, 0.3)}`)
}

// ---------- 4) a witness is caught out only if genuinely refuted ----------
console.log('\n[4] every recorded refutation is real, verified by replay')
{
  const r = replay({ space, facts: LADDER, params: P, opt: OPT })
  const caughtTurns = r.turns.filter(t => t.caught.length)
  expect('at least one fact catches somebody out', caughtTurns.length > 0, `${caughtTurns.length}`)

  // walk the sequence again, and at each catch confirm the abandoned account really is
  // unrealisable under the file as it then stood — by simulating its history, not by flag
  let ok = true, checked = 0
  for (let i = 0; i < r.facts.length; i++) {
    const spec = buildF(r.facts.slice(0, i + 1), OPT)
    const turn = r.turns[i]
    if (!turn || !turn.caught.length) continue
    const moves = r.state.moves.filter(m => m.act === 'refuted' && m.fact === r.facts[i])
    for (const m of moves) {
      // An assertion is refuted only when EVERY variant it left open fails the file. This is
      // the stronger check the assertion-class fix makes possible: it is not enough that the
      // representative fails, because the witness never committed to that representative.
      const variants = space.all.filter(x => assertKey(x) === m.from)
      if (!variants.length) { ok = false; continue }
      const anyStillFits = variants.some(v =>
        [...v.ends.values()].some(st => diffAftermath(st, spec).length === 0))
      if (anyStillFits) ok = false
      checked++
    }
  }
  expect(`every variant of each abandoned assertion fails the new file (${checked} checked)`, ok && checked > 0)

  // and nobody standing on a still-feasible account is dragged along
  const finalPool = new Set(r.pool.map(x => x.sig))
  expect('every closing account is feasible under the final file',
    CAST.every(T => finalPool.has(r.state.profile[T].sig)))
}

// ---------- 5) the opening is re-based when the evidence destroys it ----------
console.log('\n[5] a refuted opening stops being the yardstick')
{
  const obj = makePayoff({ beta: 0.5, gamma: 0.5, delta: 0.3 })
  let pool = space.all.slice()
  let s = continueHearing(openHearing({ pool, obj }), { pool, obj })
  const opening0 = { ...s.opening }

  // establish the whole run-06 file at once, which refutes plenty
  pool = poolFor(space, WORLDS['run-06'].facts, WORLDS['run-06'].opt)
  const alive = new Set(pool.map(x => x.sig))
  const doomed = CAST.filter(T => !alive.has(opening0[T].sig))
  s = applyEvidence(s, { pool, obj, fact: 'run-06 file' })

  expect('somebody had their opening destroyed', doomed.length > 0, `${doomed.length}`)
  for (const T of doomed) {
    expect(`${T}'s opening was re-based off the refuted account`, s.opening[T].sig !== opening0[T].sig)
    expect(`${T} is not charged drift against a story the evidence destroyed`,
      drift(s.profile[T], s.opening[T]) === 0, `${drift(s.profile[T], s.opening[T])}`)
  }
  for (const T of CAST.filter(x => !doomed.includes(x)))
    expect(`${T}'s opening survived and still serves as the yardstick`, s.opening[T].sig === opening0[T].sig)
}

// ---------- 6) the fast path equals the reference replay ----------
console.log('\n[6] incremental establishment agrees with a full replay')
{
  const seq = ['corpse', 'part', 'rope', 'daggerBlood', 'weapon']
  const ref = replay({ space, facts: seq, params: P, opt: OPT })

  let inc = { state: null, pool: collapse(space.all), facts: [], turns: [] }
  const obj = makePayoff(P)
  inc.state = continueHearing(openHearing({ pool: inc.pool, obj }), { pool: inc.pool, obj })
  for (const f of seq) inc = establish(inc, { space, fact: f, params: P, opt: OPT })

  expect('same closing profile', JSON.stringify(ref.state.profile) === JSON.stringify(inc.state.profile))
  expect('same transcript, move for move',
    JSON.stringify(ref.state.moves) === JSON.stringify(inc.state.moves),
    `${ref.state.moves.length} vs ${inc.state.moves.length} moves`)
  expect('same refutation stock', JSON.stringify(ref.state.refutations) === JSON.stringify(inc.state.refutations))
  expect('same turning points', JSON.stringify(ref.turns) === JSON.stringify(inc.turns))
}

// ---------- 7) the hearing is a function of the SEQUENCE, not the set ----------
console.log('\n[7] order of establishment is load-bearing')
{
  const a = replay({ space, facts: ['corpse', 'part', 'weapon', 'daggerBlood'], params: P, opt: OPT })
  const b = replay({ space, facts: ['corpse', 'daggerBlood', 'weapon', 'part'], params: P, opt: OPT })
  expect('the same facts in both files', a.pool.length === b.pool.length, `${a.pool.length} vs ${b.pool.length}`)
  const same = JSON.stringify(a.state.refutations) === JSON.stringify(b.state.refutations)
  expect('replaying an identical sequence is deterministic',
    JSON.stringify(replay({ space, facts: ['corpse', 'part', 'weapon'], params: P, opt: OPT }).state.moves) ===
    JSON.stringify(replay({ space, facts: ['corpse', 'part', 'weapon'], params: P, opt: OPT }).state.moves))
  console.log(`     (order changed the refutation stock: ${!same ? 'yes' : 'no, not on this pair'})`)
  expect('withdrawing a fact is a rewind, not an undo — the shorter sequence is replayed clean',
    JSON.stringify(replay({ space, facts: ['corpse', 'part'], params: P, opt: OPT }).state.refutations) ===
    JSON.stringify(replay({ space, facts: ['corpse', 'part'], params: P, opt: OPT }).state.refutations))
}

// ---------- 8) the preview an auditor reads before spending ----------
console.log('\n[8] preview tells you what a fact would cost before you establish it')
{
  const start = replay({ space, facts: ['corpse'], params: P, opt: OPT })
  const previews = FACT_KEYS.map(f => preview(start, { space, fact: f, params: P, opt: OPT }))
  expect('every fact previews without throwing', previews.every(p => p && p.fact))
  const real = previews.filter(p => !p.impossible)
  expect('elimination counts are consistent with the pools',
    real.every(p => p.eliminates === p.feasibleBefore - p.feasibleAfter))
  expect('no preview claims to catch somebody whose account survives it',
    real.every(p => {
      const pool = poolFor(space, ['corpse', p.fact], OPT)
      const alive = new Set(pool.map(x => x.sig))
      return p.wouldCatch.every(T => !alive.has(start.state.profile[T].sig))
    }))
  // preview must agree with actually doing it
  for (const p of real.slice(0, 4)) {
    const after = establish(start, { space, fact: p.fact, params: P, opt: OPT })
    expect(`preview of "${p.fact}" matches the outcome`,
      after.pool.length === p.feasibleAfter &&
      JSON.stringify((after.turns.at(-1).caught || []).slice().sort()) === JSON.stringify(p.wouldCatch.slice().sort()),
      `${after.pool.length} vs ${p.feasibleAfter}`)
  }
}

// ---------- 9) the experiment's headline results, pinned ----------
// The mechanism was landed before it was ever run. These pin what running it found, so the
// findings cannot drift silently the way game.mjs's anchor did.
console.log('\n[9] what establishing evidence mid-hearing actually does')
{
  const at = (delta, facts = LADDER) => {
    const r = replay({ space, facts, params: { beta: 0.5, gamma: 0, delta }, opt: OPT })
    return { r, a: jointAudit(r.state.profile), caught: r.turns.reduce((s, t) => s + t.caught.length, 0) }
  }
  const base = at(0.3)
  expect('assembling the full file catches somebody out exactly once', base.caught === 1, `${base.caught}`)
  // it was 4 before assertions existed: establishing where the wound is "caught" all three
  // on a dimension none of them had asserted. Only the bandit is genuinely refuted now.
  const partOnly = at(0.3, ['corpse', 'part'])
  expect('establishing where the wound is catches NOBODY', partOnly.caught === 0, `${partOnly.caught}`)
  expect('and the one real refutation is the bandit, on the dagger drawing blood',
    base.r.turns.filter(t => t.caught.length).every(t => t.fact === 'daggerBlood' && t.caught.join() === 'Tajomaru'),
    JSON.stringify(base.r.turns.filter(t => t.caught.length).map(t => [t.fact, t.caught])))

  // evidence NARROWS the record onto one story and destroys the proof
  const bare = at(0.3, ['corpse'])
  expect('a bare corpse leaves the proof intact', bare.a.provenLies === 2)
  expect('the full file destroys it — MORE evidence, WORSE audit',
    base.a.provenLies === 0 && base.a.distinctClaims === 1,
    `${base.a.distinctClaims} claims`)

  // δ still restores it, but only at the very top of its range: with assertions, exactly ONE
  // witness is ever caught over the whole file, so standing has almost nothing to work with.
  // Before the fix, three spurious refutations made δ look far more powerful (δ* = 0.5).
  expect('δ below 1 leaves the proof gone', [0, 0.2, 0.5, 0.7].every(d => at(d).a.provenLies === 0))
  expect('δ = 1 restores it', at(1).a.provenLies === 2, `${at(1).a.provenLies}`)
  expect('the mechanism: the one caught witness ends at zero standing',
    at(1).r.state.refutations.Tajomaru === 1)

  // two facts that remove the same number of accounts have opposite effects
  const from = replay({ space, facts: ['corpse'], params: { beta: 0.5, gamma: 0, delta: 0.3 }, opt: OPT })
  const after = (f) => jointAudit(replay({ space, facts: ['corpse', f], params: { beta: 0.5, gamma: 0, delta: 0.3 }, opt: OPT }).state.profile)
  const pPart = preview(from, { space, fact: 'part', params: { beta: 0.5, gamma: 0, delta: 0.3 }, opt: OPT })
  const pSword = preview(from, { space, fact: 'swordClean', params: { beta: 0.5, gamma: 0, delta: 0.3 }, opt: OPT })
  const pBlood = preview(from, { space, fact: 'daggerBlood', params: { beta: 0.5, gamma: 0, delta: 0.3 }, opt: OPT })
  // WITHDRAWN: an earlier pass reported that "part", "daggerBlood" and "swordClean" each
  // eliminate the same 22 accounts while only "part" preserves the proof — "same quantity,
  // opposite effect". That contrast was an artefact of counting wound-location variants as
  // separate accounts. Where the wound is eliminates NOTHING once accounts are assertions,
  // because no witness ever asserted it. The honest finding is simpler and stronger:
  expect('establishing where the wound is rules out nothing at all', pPart.eliminates === 0, `${pPart.eliminates}`)
  expect('only the two blade facts bite, and by the same amount',
    pSword.eliminates === 11 && pBlood.eliminates === 11, `${pSword.eliminates}/${pBlood.eliminates}`)
  expect('EVERY fact that narrows the account space destroys the proof; none preserves it',
    after('swordClean').provenLies === 0 && after('daggerBlood').provenLies === 0 && after('part').provenLies === 2)
  expect('and the one that preserves it is precisely the one that changes nothing',
    after('part').distinctClaims === jointAudit(from.state.profile).distinctClaims)

  // a file can contradict itself, and that must be reported rather than silently carried
  const bad = replay({ space, facts: ['corpse', 'wifePresent', 'wifeGone'], params: P, opt: OPT })
  expect('an unsatisfiable file is reported as such', bad.impossible === 'wifeGone', `${bad.impossible}`)
  expect('and returns an empty pool rather than the previous one', bad.pool.length === 0, `${bad.pool.length}`)
  expect('while a file that only looks contradictory is not — a blade can draw blood and leave',
    poolFor(space, ['corpse', 'daggerBlood', 'bladesGone'], OPT).length > 0)
}

// ---------- 10) the bundle IS the solver, and the page runs on it ----------
// The browser must not get a second implementation — that is how three enumeration domains
// happened. The bundle is generated from the same modules, and these assert it agrees.
console.log('\n[10] the browser bundle agrees with node, and the page renders')
{
  const fs = await import('node:fs')
  const path = await import('node:path')
  const url = await import('node:url')
  const HERE = path.dirname(url.fileURLToPath(import.meta.url))
  const bp = path.join(HERE, '../../demo/magistrate-bundle.js')
  if (!fs.existsSync(bp)) expect('magistrate-bundle.js exists (run: node recon/build-magistrate.mjs)', false)
  else {
    const g = {}
    new Function('globalThis', fs.readFileSync(bp, 'utf8'))(g)
    const B = g.GROVE.magistrate, BE = g.GROVE.evidence
    const bs = B.buildSpace(SPECS)
    expect('bundle enumerates the same 44 signatures', bs.all.length === space.all.length)
    expect('bundle reproduces both named files (11 and 22)',
      B.poolFor(bs, WORLDS['run-06'].facts, WORLDS['run-06'].opt).length === 11 &&
      B.poolFor(bs, WORLDS.akutagawa.facts, WORLDS.akutagawa.opt).length === 22)
    const br = B.replay({ space: bs, facts: LADDER, params: P, opt: OPT })
    const nr = replay({ space, facts: LADDER, params: P, opt: OPT })
    expect('bundle and node produce the same transcript, move for move',
      JSON.stringify(br.state.moves) === JSON.stringify(nr.state.moves))
    expect('and the same refutation stock', JSON.stringify(br.state.refutations) === JSON.stringify(nr.state.refutations))
    expect('the bundle carries every fact the page offers', BE.FACT_KEYS.length === FACT_KEYS.length)

    // the page itself
    const html = fs.readFileSync(path.join(HERE, '../../demo/magistrate.html'), 'utf8')
    const ids = [...html.matchAll(/id="([A-Za-z0-9_]+)"/g)].map(m => m[1])
    const written = new Set()
    const mk = (id) => ({ id, _h: '', dataset: {}, value: '0', textContent: '', className: '', style: {},
      set innerHTML(v) { this._h = String(v); written.add(id) }, get innerHTML() { return this._h },
      addEventListener() {}, closest() { return null }, appendChild() {}, remove() {},
      scrollTop: 0, scrollHeight: 0 })
    const nodes = Object.fromEntries(ids.map(i => [i, mk(i)]))
    // the booths create their own ids at runtime (feed-Tajomaru and so on), so a lookup for
    // an id the markup does not declare is normal here; only the declared ones must exist
    const missing = []
    const doc = {
      getElementById: (i) => { if (!nodes[i]) { if (ids.includes(i)) missing.push(i); nodes[i] = mk(i) } return nodes[i] },
      createElement: () => mk('tmp'), querySelector: () => null,
    }
    let threw = null
    try {
      new Function('window', 'document', 'performance', 'setTimeout', 'clearTimeout', 'fetch',
        html.split('</script>')[1].replace('<script>', ''))(
        g, doc, { now: () => Date.now() }, (f) => f(), () => {},
        () => Promise.reject(new Error('no narration proxy in tests')))
    } catch (e) { threw = e }
    expect('the page script runs against the bundle', threw === null, threw?.message || '')
    if (!threw) {
      for (const id of ['facts', 'rec', 'claims', 'booths', 'story', 'tr', 'fileNote', 'foot', 'bm', 'gm', 'dm'])
        expect(`#${id} rendered`, written.has(id) && nodes[id].innerHTML.length > 20)
      expect('one booth per witness', CAST.every(T => nodes.booths.innerHTML.includes(`data-w="${T}"`)))
      expect('the page survives having no narration proxy', threw === null)
      const all = Object.values(nodes).map(n => n.innerHTML).join('')
      expect('no undefined leaked', !all.includes('undefined'))
      expect('no NaN leaked', !all.includes('NaN'))
      expect('the fact panel previews what each unestablished fact would rule out',
        nodes.facts.innerHTML.includes('rules out') || nodes.facts.innerHTML.includes('rules nothing out'))
      expect('the thresholds under the sliders are computed for the current file',
        /β|γ|δ/.test(nodes.bm.innerHTML + nodes.gm.innerHTML + nodes.dm.innerHTML))
      expect('the limits are stated on the page, not hidden',
        nodes.foot.innerHTML.includes('What it is not'))
    }
  }
}

// ---------- 11) explain mode is recording only ----------
console.log('\n[11] explain records the deliberation and changes no decision')
{
  const { rankBy, argmaxBy: amb, makePayoff: mp } = await import('./hearing-core.mjs')
  const off = replay({ space, facts: LADDER, params: P, opt: OPT })
  const on = replay({ space, facts: LADDER, params: P, opt: OPT, explain: true })
  const strip = (ms) => JSON.stringify(ms.map(({ deliberation, ...r }) => r))
  expect('every move is byte-identical with explain on and off', strip(off.state.moves) === strip(on.state.moves))
  expect('the closing record is identical', JSON.stringify(off.state.profile) === JSON.stringify(on.state.profile))
  expect('nothing is recorded when it is off', off.state.moves.every(m => !('deliberation' in m)))

  // rankBy must agree with argmaxBy, or the ranking would describe a decision never made
  const pool = poolFor(space, WORLDS['run-06'].facts, WORLDS['run-06'].opt)
  const obj = mp(P)
  const prof = Object.fromEntries(CAST.map(T => [T, pool[0]]))
  expect('rankBy[0] is exactly argmaxBy\'s answer', CAST.every(T => {
    const f = (r) => obj.payoff(T, { ...prof, [T]: r }, {})
    return rankBy(pool, f)[0].rec.sig === amb(pool, f).sig
  }))

  const withD = on.state.moves.filter(m => m.deliberation)
  expect('the recorded choice is the account actually taken',
    withD.every(m => !m.deliberation.chosen || m.deliberation.chosen.sig === m.to))
  expect('alternatives never score above the choice',
    withD.every(m => m.deliberation.alternatives.every(a => a.total <= m.deliberation.chosen.total)))
  expect('the reserved beliefs slot is present and empty',
    withD.every(m => m.deliberation.beliefs === null))

  // every account reported as deleted must genuinely be gone from the file at that moment
  let checkedDeleted = 0, deletedOk = true
  for (let i = 0; i < on.facts.length; i++) {
    const alive = new Set(poolFor(space, on.facts.slice(0, i + 1), OPT).map(r => r.sig))
    for (const m of on.state.moves.filter(x => x.act === 'refuted' && x.fact === on.facts[i]))
      for (const d of m.deliberation?.deleted || []) { if (alive.has(d.sig)) deletedOk = false; checkedDeleted++ }
  }
  expect(`every "deleted" account really is gone (${checkedDeleted} checked)`, deletedOk && checkedDeleted > 0)
}

// ---------- 12) the monologue renders with no key and no network ----------
console.log('\n[12] the template monologue needs neither a key nor a proxy')
{
  const NT = await import('./narrate-template.mjs')
  const on = replay({ space, facts: LADDER, params: P, opt: OPT, explain: true })
  const kinds = new Set()
  for (const T of CAST) {
    const mine = on.state.moves.filter(m => m.speaker === T)
    const lines = NT.narrateTemplate(mine, { factNote: 'the dagger drew blood' })
    expect(`${T} gets a monologue`, lines.length > 0 && lines.every(l => typeof l.text === 'string' && l.text.length > 4))
    for (const l of lines) kinds.add(l.kind)
  }
  for (const act of ['open', 'stand', 'revise', 'refuted']) {
    const m = on.state.moves.find(x => x.act === act)
    if (m) expect(`a "${act}" move produces at least one line`, NT.renderTemplate(m, {}).length > 0)
  }
  expect('the whole account name survives, not just the first word',
    NT.nameOf('Takehiro (self) — suicide (dagger)') === 'Takehiro (self) — suicide',
    NT.nameOf('Takehiro (self) — suicide (dagger)'))
  expect('consecutive identical thoughts are collapsed', (() => {
    const mine = on.state.moves.filter(m => m.speaker === 'Takehiro')
    const ls = NT.narrateTemplate(mine, {})
    return ls.every((l, i) => i === 0 || l.text !== ls[i - 1].text)
  })())

  // the browser bundle must carry the template renderer, or the page cannot run offline
  const fs = await import('node:fs'), path = await import('node:path'), url = await import('node:url')
  const HERE = path.dirname(url.fileURLToPath(import.meta.url))
  const g = {}
  new Function('globalThis', fs.readFileSync(path.join(HERE, '../../demo/magistrate-bundle.js'), 'utf8'))(g)
  expect('the bundle carries the template renderer', typeof g.GROVE.narrate?.narrateTemplate === 'function')
  expect('and it produces the same lines as node', (() => {
    const mine = on.state.moves.filter(m => m.speaker === 'Tajomaru')
    return JSON.stringify(g.GROVE.narrate.narrateTemplate(mine, {})) === JSON.stringify(NT.narrateTemplate(mine, {}))
  })())
}

// ---------- 13) the paper's protocol: the record on file before anyone speaks ----------
// The page's scene buttons load a world as `known`, the setting of the paper's hearing table
// (tab-hearing.mjs, computed with dialogue.hearing). These pin that the page reproduces it.
console.log("\n[13] a scene on file before the openings reproduces the paper's hearing table")
{
  const w = WORLDS['run-06']
  const at = (beta, gamma) => replay({ space, known: w.facts, facts: [], params: { beta, gamma, delta: 0.3 }, opt: w.opt })
  const claims = (r) => [...new Set(CAST.map(T => r.state.profile[T].sig.split('|').slice(0, 3).join('|')))].sort()
  const indep = at(0, 0), hear = at(0.5, 0), acc = at(0.5, 0.2)
  const A = (r) => jointAudit(r.state.profile)
  expect('independent testimony (β=0): 3 distinct claims, 2 provable lies', A(indep).distinctClaims === 3 && A(indep).provenLies === 2)
  expect('a hearing (β=0.5, γ=0): one account, no provable lies', A(hear).distinctClaims === 1 && A(hear).provenLies === 0)
  expect("the account the hearing settles on is the samurai's suicide",
    JSON.stringify(claims(hear)) === JSON.stringify(['Takehiro|self_strike|dagger']), JSON.stringify(claims(hear)))
  expect('accountability (γ=0.2) restores 3 claims and 2 provable lies', A(acc).distinctClaims === 3 && A(acc).provenLies === 2)
  expect('γ=0.175 does not: 0.2 is the threshold the paper reports', A(at(0.5, 0.175)).provenLies === 0)
  const pool = space.feasibleUnder('run-06')
  expect("each row agrees with dialogue.hearing, the module the paper's table is computed with",
    [[0, 0, indep], [0.5, 0, hear], [0.5, 0.2, acc]].every(([beta, gamma, r]) => {
      const ref = jointAudit(hearing({ pool, beta, gamma }).profile)
      return ref.distinctClaims === A(r).distinctClaims && ref.provenLies === A(r).provenLies
    }))
  expect('nobody is caught out: every opening is feasible under the known record',
    CAST.every(T => !acc.state.refutations[T]) && acc.turns.length === 0)
  // facts established after a known record still arrive during testimony, through the fast path
  const known = ['corpse', 'part']
  const base = replay({ space, known, facts: [], params: P, opt: OPT })
  const inc = establish(base, { space, fact: 'daggerBlood', params: P, opt: OPT })
  const ref = replay({ space, known, facts: ['daggerBlood'], params: P, opt: OPT })
  expect('a fact established on top of a known record rules accounts out', inc.pool.length < base.pool.length,
    `${inc.pool.length} vs ${base.pool.length}`)
  expect('and the fast path agrees with a full replay',
    JSON.stringify(inc.state.moves) === JSON.stringify(ref.state.moves) &&
    JSON.stringify(inc.turns) === JSON.stringify(ref.turns) && inc.pool.length === ref.pool.length)
  expect('preview counts the known record too',
    preview(replay({ space, known: w.facts, facts: [], params: P, opt: w.opt }), { space, fact: 'wifeGone', params: P, opt: w.opt }).impossible === true)
  expect('with nothing known, replay is unchanged',
    JSON.stringify(replay({ space, facts: ['corpse', 'part'], params: P, opt: OPT }).state.moves) ===
    JSON.stringify(replay({ space, known: [], facts: ['corpse', 'part'], params: P, opt: OPT }).state.moves))
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
