#!/usr/bin/env node
// Self-test for the shared history space and the correction it forces.
// The load-bearing test is [2]: the deniability gap doubles between the two evidence sets,
// measured in ONE candidate space so the comparison is sound. [3] pins the cost of honesty,
// which an intermediate pass wrongly reported as 0.
// Usage: node recon/test-shared-space.mjs   (no API key)

import { AFTERMATH, simulate, diffAftermath } from './domain.mjs'
import { enumerateShared, DEGENERATE, CAST } from './grove-enum.mjs'
import { features, U } from './grove-core.mjs'

let pass = 0, fail = 0
const expect = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${detail}`) }
}
const u100 = (x) => Math.round(100 * x)
const maxU = (arr, T) => Math.max(...arr.map(r => u100(U[T](features(T, r.an)))))
const claimKey = (r) => `${r.an.fatal.actor}|${r.an.fatal.type}|${r.an.fatal.weapon}`

const F6 = AFTERMATH["pre-B'/run-06"]
const SPECS = { 'run-06': F6, akutagawa: AFTERMATH['akutagawa/canonical'] }
const space = enumerateShared({ specs: SPECS, degenerate: DEGENERATE })
const P6 = space.feasibleUnder('run-06')
const PA = space.feasibleUnder('akutagawa')

// ---------- 1) one space, both worlds inside it ----------
console.log('\n[1] a single candidate space serves both evidence sets')
{
  expect('44 causal signatures', space.causalSignatures === 44, `${space.causalSignatures}`)
  expect('one record per causal signature, 44 of them', space.all.length === 44, `${space.all.length}`)
  expect('every feasible record under either spec is in the shared space',
    [...P6, ...PA].every(r => space.all.includes(r)))
  expect('no record is feasible under a spec it does not satisfy',
    space.all.every(r => Object.entries(r.feasible).every(([n, f]) =>
      !f || diffAftermath(simulate(r.witness[n]).state, SPECS[n]).length === 0)))
}

// ---------- 2) the deniability gap, now comparable ----------
console.log('\n[2] the gap doubles, measured in the same space')
{
  expect('run-06: 11 feasible causal attributions', P6.length === 11 && space.gapUnder('run-06') === 11, `${P6.length}`)
  expect('akutagawa: 22 feasible causal attributions', PA.length === 22 && space.gapUnder('akutagawa') === 22, `${PA.length}`)
  expect('the gap is exactly twice as large under canonical evidence',
    space.gapUnder('akutagawa') === 2 * space.gapUnder('run-06'))
  const duel = (pool) => pool.some(r => r.an.fatal.weapon === 'longsword' && r.an.fatal.victimArmed && r.an.fatal.type === 'strike')
  expect('the duel is refuted by run-06 evidence', !duel(P6))
  expect('the duel survives canonical evidence', duel(PA))
}

// ---------- 3) the cost of honesty, and the claim that was withdrawn ----------
// An intermediate pass reported this as 0 for everyone in both worlds. That came from
// crediting whoever cut the rope with 0.55 agency, which let Tajomaru buy his ideal back
// inside the feasible set by claiming he freed the man. The rope-cutter is not part of how
// an account flatters its teller, that term is gone, and the cost is 14 again.
console.log('\n[3] cost of honesty: 14 on our evidence, 0 on the canonical evidence')
{
  const cost = (pool, T) => maxU(space.all, T) - maxU(pool, T)
  expect('run-06: the constraint BITES on the bandit, costing him 14',
    cost(P6, 'Tajomaru') === 14, `${cost(P6, 'Tajomaru')}`)
  expect('run-06: it costs the other two nothing',
    cost(P6, 'Masago') === 0 && cost(P6, 'Takehiro') === 0)
  expect('canonical: it costs all three nothing — the contrast the second case exists for',
    CAST.every(T => cost(PA, T) === 0), CAST.map(T => `${T}:${cost(PA, T)}`).join(' '))

  // U must be a function of the causal signature: nothing outside the signature may move it
  const bySig = new Map()
  for (const r of space.all) {
    const k = CAST.map(T => u100(U[T](features(T, r.an)))).join('/')
    if (!bySig.has(r.sig)) bySig.set(r.sig, new Set())
    bySig.get(r.sig).add(k)
  }
  expect('U is well defined on the causal signature — no representative-dependence left',
    [...bySig.values()].every(v => v.size === 1))
  expect('and the rope-cutter provably does not enter it',
    space.all.every(r => {
      const withCutter = { fatal: r.an.fatal, cutter: 'Tajomaru' }
      const without = { fatal: r.an.fatal, cutter: null }
      return CAST.every(T => U[T](features(T, withCutter)) === U[T](features(T, without)))
    }))
}

// ---------- 4) the tie situation in the corrected domain ----------
console.log('\n[4] which findings survive the tie-break in the corrected domain')
{
  const per = {}
  for (const T of CAST) {
    const best = Math.max(...P6.map(r => U[T](features(T, r.an))))
    per[T] = P6.filter(r => Math.abs(U[T](features(T, r.an)) - best) < 1e-12)
  }
  const profiles = []
  for (const a of per.Tajomaru) for (const b of per.Masago) for (const c of per.Takehiro)
    profiles.push({ Tajomaru: a, Masago: b, Takehiro: c })
  expect('49 equally-optimal profiles under run-06 evidence', profiles.length === 49, `${profiles.length}`)
  const spread3 = profiles.filter(p => new Set(CAST.map(T => claimKey(p[T]))).size === 3).length
  const tajUnacc = profiles.filter(p => !new Set(CAST.map(T => p[T].an.fatal.actor)).has('Tajomaru')).length
  expect('3 distinct claims in 32 of them', spread3 === 32, `${spread3}`)
  expect('"nobody accuses the bandit" holds in only 21 of 49 — NOT tie-robust',
    tajUnacc === 21, `${tajUnacc}`)
  expect('so that finding needs the same hedge as the proven-lies claim',
    tajUnacc > 0 && tajUnacc < profiles.length)
}

// ---------- 5) the (β, γ) phase boundary ----------
// Coarse grid; recon/phase.mjs reports the full map. β is coordination pressure, γ is how
// far a witness is held to their own opening. "Safe" = the closing record still holds 3
// distinct claims, which is what lets an auditor prove >=2 lies without knowing the truth.
console.log('\n[5] the (β, γ) phase boundary')
{
  const { hearing } = await import('./dialogue.mjs')
  const { jointAudit, claimKey: ck } = await import('./game-core.mjs')
  const ORDERS = [['Tajomaru', 'Masago', 'Takehiro'], ['Takehiro', 'Masago', 'Tajomaru']]
  const story = (p) => [...new Set(CAST.map(T => ck(p[T])))].sort().join(' + ')

  const gStarFor = (base) => (b) => {
    const pool = base
    for (let k = 0; k <= 40; k++)
      if (jointAudit(hearing({ pool, beta: b, gamma: k / 40 }).profile).provenLies === 2) return k / 40
    return null
  }
  const g6 = gStarFor(P6), gA = gStarFor(PA)

  expect('β=0 is safe at every γ in both worlds — no coordination pressure',
    [0, 0.25, 1].every(g => [P6, PA].every(pool =>
      jointAudit(hearing({ pool, beta: 0, gamma: g }).profile).provenLies === 2)))
  // 0.225 before drift stopped counting the wound location and the rope-cutter, which the
  // witnesses never asserted; the plateau survives the correction, one notch lower.
  expect('run-06: γ* = 0.2, FLAT across β = 0.05 … 0.50',
    [0.05, 0.2, 0.35, 0.5].every(b => Math.abs(g6(b) - 0.2) < 1e-9),
    [0.05, 0.35, 0.5].map(b => `${b}:${g6(b)}`).join(' '))
  expect('run-06: the requirement climbs above β=0.5, to 0.625 at β=1',
    g6(0.8) > g6(0.5) && Math.abs(g6(1) - 0.625) < 1e-9, `${g6(0.8)} ${g6(1)}`)
  expect('accountability ALWAYS suffices — some γ≤1 saves the proof at every β, both worlds',
    [0.25, 0.5, 0.75, 0.9, 1].every(b => g6(b) !== null && gA(b) !== null))

  // The boundaries are NOT the same any more, and the reason is worth pinning: under the
  // canonical evidence every witness already opens on their global ideal (cost 0), so any
  // move costs self-interest and coordination needs a much higher β before it starts.
  expect('canonical evidence needs NO accountability until β > 0.5',
    [0.05, 0.2, 0.35, 0.5].every(b => gA(b) === 0), [0.2, 0.5].map(b => `${b}:${gA(b)}`).join(' '))
  expect('so the boundary is NOT identical across worlds — weaker evidence makes coordination HARDER',
    [0.2, 0.5].some(b => g6(b) !== gA(b)), `${g6(0.5)} vs ${gA(0.5)}`)

  // and the order-dependence claim, corrected: it is NOT confined to γ=0
  const pool6 = P6
  const pasts = (b, g) => new Set(ORDERS.map(o => story(hearing({ pool: pool6, beta: b, gamma: g, order: o }).profile))).size
  expect('at β=0.5 order-dependence really is confined to γ=0', pasts(0.5, 0) === 2 && pasts(0.5, 0.025) === 1)
  expect('but at β=1.0 it SURVIVES positive accountability — the earlier retraction was too broad',
    pasts(1, 0.2) > 1, `${pasts(1, 0.2)}`)
}

// ---------- 6) the two-groves exhibit renders against the regenerated data ----------
console.log('\n[6] akutagawa.html renders (data now comes from shared-space.mjs)')
{
  const fs = await import('node:fs')
  const path = await import('node:path')
  const url = await import('node:url')
  const HERE = path.dirname(url.fileURLToPath(import.meta.url))
  const dp = path.join(HERE, '../../demo/akutagawa-data.js')
  if (!fs.existsSync(dp)) expect('akutagawa-data.js exists (run: node recon/shared-space.mjs)', false)
  else {
    const html = fs.readFileSync(path.join(HERE, '../../demo/akutagawa.html'), 'utf8')
    const ids = [...html.matchAll(/id="([A-Za-z0-9_]+)"/g)].map(m => m[1])
    const written = new Set()
    const nodes = Object.fromEntries(ids.map(id => [id, {
      id, _h: '', set innerHTML(v) { this._h = String(v); written.add(this.id) }, get innerHTML() { return this._h },
    }]))
    let threw = null
    try {
      new Function('window', 'document', fs.readFileSync(dp, 'utf8') + '\n' + html.split('<script>')[1].split('</script>')[0])(
        {}, { getElementById: (i) => { if (!nodes[i]) throw new Error('missing #' + i); return nodes[i] } })
    } catch (e) { threw = e }
    expect('the page script runs', threw === null, threw?.message || '')
    if (!threw) {
      for (const id of ['worlds', 'c1', 'picks', 'c2', 'games', 'c3', 'c4', 'foot'])
        expect(`#${id} rendered`, written.has(id) && nodes[id].innerHTML.length > 40)
      const all = Object.values(nodes).map(n => n.innerHTML).join('\n')
      expect('no undefined leaked', !all.includes('undefined'))
      expect('no NaN leaked', !all.includes('NaN'))
      expect('the exhibit shows the cost of honesty as 14, not the withdrawn 0',
        all.includes('>14<'), 'cost cell missing')
    }
  }
}

// ---------- 7) the three-levers exhibit ----------
console.log('\n[7] private-hearing.html renders, and states the lever result')
{
  const fs = await import('node:fs')
  const path = await import('node:path')
  const url = await import('node:url')
  const HERE = path.dirname(url.fileURLToPath(import.meta.url))
  const dp = path.join(HERE, '../../demo/private-hearing-data.js')
  if (!fs.existsSync(dp)) expect('private-hearing-data.js exists (run: node recon/private-hearing.mjs)', false)
  else {
    const html = fs.readFileSync(path.join(HERE, '../../demo/private-hearing.html'), 'utf8')
    const ids = [...html.matchAll(/id="([A-Za-z0-9_]+)"/g)].map(m => m[1])
    const written = new Set()
    const mk = (id) => ({ id, _h: '', set innerHTML(v) { this._h = String(v); written.add(id) },
      get innerHTML() { return this._h }, children: [], addEventListener() {}, dataset: {} })
    const nodes = Object.fromEntries(ids.map(i => [i, mk(i)]))
    const body = html.split('</script>')[1].replace('<script>', '')
    let threw = null
    try {
      new Function('window', 'document', fs.readFileSync(dp, 'utf8') + '\n' + body)(
        {}, { getElementById: (i) => { if (!nodes[i]) throw new Error('missing #' + i); return nodes[i] } })
    } catch (e) { threw = e }
    expect('the page script runs', threw === null, threw?.message || '')
    if (!threw) {
      for (const id of ['levers', 'c1', 'dial', 'c2', 'tabs', 'transcript', 'c3', 'reveal', 'c4', 'limits', 'foot'])
        expect(`#${id} rendered`, written.has(id) && nodes[id].innerHTML.length > 40)
      const all = Object.values(nodes).map(n => n.innerHTML).join('\n')
      expect('no undefined leaked', !all.includes('undefined'))
      expect('no NaN leaked', !all.includes('NaN'))
      const verdicts = all.match(/the proof<b>(holds|is gone)<\/b>/g) || []
      expect('exactly one of the four levers is shown as working',
        verdicts.filter(v => v.includes('holds')).length === 1, verdicts.join(' '))
      expect('and it is the last one — accountability',
        verdicts.length === 4 && verdicts[3].includes('holds'), verdicts.join(' '))
      expect('the withdrawn earlier claim is disclosed on the page',
        all.includes('artefacts of the bug'))
    }
  }
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
