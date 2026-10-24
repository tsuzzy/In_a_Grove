#!/usr/bin/env node
// THE EXPERIMENTAL MATRIX — one reporter, both benchmarks, both equations.
//
// Until now each domain had its own reporting script (optimize.mjs, ring-optimize.mjs) and
// Eq. (3) had none outside the grove's phase diagram. That made the matrix impossible to read:
// the cells were produced by different code, in different orders, with different wording, so
// "the same result in both domains" was a claim about two scripts rather than an observation.
//
// This script emits the SAME sections, in the same order, for every (benchmark, equation)
// cell. A domain enters as a descriptor and nothing else. Where a cell genuinely does not
// exist, it is printed as N/A with the reason, rather than omitted — an absent row and an
// impossible row are different facts and the matrix has to distinguish them.
//
//   Eq. (2)  independent testimony     argmax U_i over Feas(F)
//   Eq. (3)  sequential public hearing argmax U_i^tot, witnesses coupled and answerable
//
// Usage:
//   node recon/benchmark-report.mjs              both benchmarks
//   node recon/benchmark-report.mjs grove        one of them
//   node recon/benchmark-report.mjs ring
//   node recon/benchmark-report.mjs site

import { AFTERMATH } from './domain.mjs'

const EPS = 1e-12
const u100 = (x) => Math.round(100 * x)
const pad = (s, n) => String(s).padEnd(n)
const rule = (c = '─') => console.log(c.repeat(92))
const head = (t) => { console.log(); rule('═'); console.log(t); rule('═') }
const sec = (t) => { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 86 - t.length))}`) }

/** seeded PRNG so every reported number is exactly reproducible */
// Wilson score interval. The paper reports one on every proportion it states, and a reader
// must be able to get the same brackets out of this reporter rather than taking them on trust.
const wilson = (k, n, z = 1.959964) => {
  const p = k / n, d = 1 + z * z / n
  const c = (p + z * z / (2 * n)) / d
  const m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
  return `[${(100 * (c - m)).toFixed(1)}, ${(100 * (c + m)).toFixed(1)}]`
}

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0
    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

// ─────────────────────────────────────────────────────────────── benchmark descriptors
async function groveBenchmark() {
  const core = await import('./grove-core.mjs')
  const H = await import('./hearing-core.mjs')
  const M = await import('./magistrate-core.mjs')
  const { LADDER } = await import('./evidence.mjs')
  const SPECS = { 'run-06': AFTERMATH["pre-B'/run-06"], akutagawa: AFTERMATH['akutagawa/canonical'] }
  const OPT = { part: 'throat' }
  const space = M.buildSpace(SPECS)
  return {
    name: 'In a Grove',
    source: 'Akutagawa (1922)',
    CAST: core.CAST,
    all: core.all,
    feasible: core.feasibles,
    key: (r) => r.sig,
    fmt: (r) => core.label(r.an),
    U: (T, r) => core.U[T](core.features(T, r.an)),
    Uw: (T, r, w) => core.Uw(T, core.features(T, r.an), w),
    hearing: H,
    ladder: LADDER,
    hearingPool: (facts) => M.poolFor(space, facts, OPT),
    replay: (p) => M.replay({ space, opt: OPT, ...p }),
    atomW: H.DEFAULT_ATOM_W,
    stats: { states: core.statesExplored, settled: core.resolvedCount, assertions: core.all.length },
  }
}

async function ringBenchmark() {
  const obj = await import('./ring-objective.mjs')
  const RH = await import('./ring-hearing.mjs')
  const { LADDER } = await import('./ring-evidence.mjs')
  const space = RH.buildSpace()
  return {
    name: 'The Ring and the Book',
    source: 'Browning (1868–69), Old Yellow Book',
    CAST: obj.CAST,
    all: RH.poolFor(space, []),
    feasible: RH.fullPool(space),
    key: (r) => r.assertion,
    fmt: (r) => obj.brief(r.g),
    U: (T, r) => obj.U[T](obj.features(T, r.g)),
    Uw: (T, r, w) => obj.Uw(T, obj.features(T, r.g), w),
    hearing: RH,
    ladder: LADDER,
    hearingPool: (facts) => RH.poolFor(space, facts),
    replay: (p) => RH.replay({ space, ...p }),
    atomW: RH.DEFAULT_ATOM_W,
    stats: { states: space.statesExplored, settled: space.endStates, assertions: space.assertions },
  }
}

// ─────────────────────────────────────────────────────────────── Eq. (2)
function reportEq2(B) {
  const { CAST, all, feasible, U, Uw, fmt, key } = B
  const argmaxBy = (arr, f) => arr.slice().sort((a, b) => (f(b) - f(a)) || (key(a) < key(b) ? -1 : 1))[0]
  const maxOf = (arr, f) => arr.reduce((m, r) => Math.max(m, f(r)), -Infinity)

  sec('Eq. (2)  independent testimony — argmax U_i over Feas(F)')
  console.log(`  candidate assertions: ${all.length}    |Feas(F)| = ${feasible.length}    ` +
    `refuted by F: ${all.length - feasible.length}`)

  console.log(`\n  ${pad('witness', 14)}${pad('ideal U', 10)}${pad('in Feas?', 11)}${pad('best feasible U', 17)}constraint bites?`)
  const picks = {}
  for (const T of CAST) {
    const f = (r) => U(T, r)
    const best = maxOf(all, f)
    const tied = feasible.filter(r => f(r) > best - EPS)
    const feasBest = argmaxBy(feasible, f)
    picks[T] = feasBest
    const bites = best > f(feasBest) + EPS
    console.log(`  ${pad(T, 14)}${pad(u100(best), 10)}${pad(tied.length ? 'yes' : 'NO', 11)}` +
      `${pad(u100(f(feasBest)), 17)}${bites ? 'YES' : 'no'}`)
  }
  for (const T of CAST) console.log(`    ${pad(T, 14)}→ ${fmt(picks[T])}`)
  const distinct = new Set(CAST.map(T => key(picks[T]))).size
  console.log(`\n  distinct accounts chosen: ${distinct}/${CAST.length}` +
    `${distinct === CAST.length ? '  (full Rashomon spread)' : ''}`)

  // robustness over the same generic dimensions
  const rand = mulberry32(16980222)
  const N = 5000
  let spreadFull = 0
  const bite = Object.fromEntries(CAST.map(T => [T, 0]))
  for (let t = 0; t < N; t++) {
    const pk = new Set()
    for (const T of CAST) {
      const w = [rand(), rand(), rand()]
      const g = (r) => Uw(T, r, w)
      pk.add(key(argmaxBy(feasible, g)))
      if (maxOf(all, g) > maxOf(feasible, g) + EPS) bite[T]++
    }
    if (pk.size === CAST.length) spreadFull++
  }
  // Seeded Monte Carlo. This reporter draws from ONE generator with one seed for both
  // benchmarks, so the two columns are comparable to each other — which is the property a
  // cross-domain matrix needs. The per-domain scripts (optimize.mjs, ring-optimize.mjs) seed
  // independently, so their figures for these same quantities differ from these by sampling
  // noise (± ~0.7pp at N=5000 on a proportion near 0.5). Cite one source or the other; do not
  // mix them within a table.
  console.log(`\n  robustness (${N} random weightings, seed 16980222 — same generator in both benchmarks)`)
  console.log(`    full ${CAST.length}/${CAST.length} spread : ${spreadFull}/${N} = ${(100 * spreadFull / N).toFixed(1)}%  95% CI ${wilson(spreadFull, N)}`)
  for (const T of CAST) console.log(`    ${pad(T, 14)}ideal infeasible: ${bite[T]}/${N} = ${(100 * bite[T] / N).toFixed(1)}%  95% CI ${wilson(bite[T], N)}`)

  // ablations
  console.log(`\n  ablations (same enumerated set, same U_i)`)
  console.log(`    ${pad('witness', 14)}${pad('uniform', 10)}${pad('no oracle', 22)}ours`)
  for (const T of CAST) {
    const f = (r) => U(T, r)
    const mean = Math.round(feasible.reduce((s, r) => s + 100 * f(r), 0) / feasible.length)
    const best = maxOf(all, f)
    const feasBest = f(argmaxBy(feasible, f))
    const refuted = !feasible.some(r => f(r) > best - EPS)
    console.log(`    ${pad(T, 14)}${pad(mean, 10)}${pad(`${u100(best)}${refuted ? ' REFUTED' : ' (feasible)'}`, 22)}${u100(feasBest)}`)
  }
  let refutedPairs = 0, pairs = 0
  const rand2 = mulberry32(16980222)
  for (let t = 0; t < N; t++) for (const T of CAST) {
    const w = [rand2(), rand2(), rand2()]
    const g = (r) => Uw(T, r, w)
    pairs++; if (maxOf(all, g) > maxOf(feasible, g) + EPS) refutedPairs++
  }
  console.log(`    dropping the oracle publishes a refuted account in ` +
    `${refutedPairs}/${pairs} = ${(100 * refutedPairs / pairs).toFixed(1)}% of (witness, weighting) pairs ` +
    `95% CI ${wilson(refutedPairs, pairs)}; keeping it: 0%.`)
  return { picks, distinct }
}

// ─────────────────────────────────────────────────────────────── Eq. (3)
function reportEq3(B, eq2) {
  const { CAST, feasible, U, hearing, key, fmt } = B
  const { makePayoff, runHearing } = hearing

  sec('Eq. (3)  sequential public hearing — argmax U_i^tot, witnesses coupled')
  console.log(`  atom weights: [${B.atomW.join(', ')}]`)

  // anchor
  const h0 = runHearing({ pool: feasible, obj: makePayoff({ beta: 0 }) })
  const anchorOK = CAST.every(T => {
    const f = (r) => U(T, r)
    return Math.abs(f(h0.profile[T]) - Math.max(...feasible.map(f))) < EPS
  })
  console.log(`\n  regression anchor  β=0 reproduces Eq. (2): ${anchorOK ? 'HOLDS (exactly)' : 'FAILS'}`)
  const sameAsEq2 = CAST.every(T => key(h0.profile[T]) === key(eq2.picks[T]))
  console.log(`  and selects the same accounts Eq. (2) did: ${sameAsEq2 ? 'yes' : 'no (tie-break differs)'}`)

  // sweep over the coupling
  console.log(`\n  ${pad('β', 6)}${pad('γ', 6)}${pad('δ', 6)}${pad('terminal', 12)}${pad('distinct', 10)}${pad('mean U_i', 10)}revised`)
  const GAMMA = 0.5, DELTA = 0.3
  for (const beta of [0, 0.25, 0.5, 0.75, 1]) {
    const h = runHearing({ pool: feasible, obj: makePayoff({ beta, gamma: GAMMA, delta: DELTA }) })
    const distinct = new Set(CAST.map(T => key(h.profile[T]))).size
    const meanU = Math.round(CAST.reduce((s, T) => s + 100 * U(T, h.profile[T]), 0) / CAST.length)
    const revised = CAST.filter(T => key(h.profile[T]) !== key(h0.profile[T])).length
    console.log(`  ${pad(beta, 6)}${pad(GAMMA, 6)}${pad(DELTA, 6)}` +
      `${pad(`${h.terminal.kind}${h.terminal.round ? '@' + h.terminal.round : ''}`, 12)}` +
      `${pad(`${distinct}/${CAST.length}`, 10)}${pad(meanU, 10)}${revised}`)
  }

  // the filtration, with standing
  sec('Eq. (3) under the filtration — documents arriving DURING the hearing')
  const params = { beta: 0.5, gamma: GAMMA, delta: DELTA }
  const r = B.replay({ facts: B.ladder, params })
  console.log(`  ${pad('step', 6)}${pad('document', 16)}${pad('|Feas|', 9)}${pad('caught', 34)}distinct`)
  r.turns.forEach((t, i) => {
    const d = t.audit ? `${t.audit.distinctClaims}/${CAST.length}` : '—'
    console.log(`  ${pad(i + 1, 6)}${pad(t.fact, 16)}${pad(t.feasible, 9)}${pad(t.caught.join(', ') || '—', 34)}${d}`)
  })
  console.log(`\n  refutations by the end: ` +
    CAST.map(T => `${T}=${r.state.refutations[T]}`).join('  '))
  console.log(`  final standing        : ` +
    CAST.map(T => `${T}=${u100(hearing.standing(r.state.refutations[T], DELTA))}`).join('  '))
  for (const T of CAST) console.log(`    ${pad(T, 14)}→ ${fmt(r.state.profile[T])}`)

  // order dependence
  const rev = B.replay({ facts: [...B.ladder].reverse(), params })
  const fwd = r.turns.filter(t => t.caught.length).map(t => `${t.fact}(${t.caught.join('+')})`)
  const bwd = rev.turns.filter(t => t.caught.length).map(t => `${t.fact}(${t.caught.join('+')})`)
  console.log(`\n  order dependence — the same documents, reversed:`)
  console.log(`    forward turning points : ${fwd.join(', ') || 'none'}`)
  console.log(`    reversed turning points: ${bwd.join(', ') || 'none'}`)
  console.log(`    same terminal |Feas|   : ${r.pool.length === rev.pool.length ? 'yes' : 'NO'}` +
    ` (${r.pool.length} vs ${rev.pool.length})`)
}

// The third domain has no hearing layer yet: Eq. (3) couples witnesses through a domain
// adapter that exists for the grove and the Ring only. It reports Eq. (2), which is what the
// paper cites it for, and says so rather than printing a silently missing section.
async function siteBenchmark() {
  const enumr = await import('./site-enum.mjs')
  const obj = await import('./site-objective.mjs')
  return {
    name: 'A site fall',
    source: 'incident reconstruction, not literary',
    CAST: enumr.CAST,
    all: enumr.all,
    feasible: enumr.feasibles,
    key: (r) => r.sig,
    fmt: (r) => obj.label(r.g),
    U: (T, r) => obj.U[T](obj.features(T, r.g)),
    Uw: (T, r, w) => obj.Uw(T, obj.features(T, r.g), w),
    eq2only: true,
    stats: { states: enumr.statesExplored, settled: enumr.settledCount, assertions: enumr.all.length },
  }
}

// The fourth domain, like the site fall, has no hearing layer yet, so it reports Eq. (2): three
// tool-using agents (planner, executor, monitor) and a destructive production action, reconstructed
// from the execution trace F. Non-literary, agent-native.
async function opsBenchmark() {
  const enumr = await import('./ops-enum.mjs')
  const obj = await import('./ops-objective.mjs')
  return {
    name: 'An agent ops incident',
    source: 'incident reconstruction, not literary',
    CAST: enumr.CAST,
    all: enumr.all,
    feasible: enumr.feasibles,
    key: (r) => r.sig,
    fmt: (r) => obj.label(r.g),
    U: (T, r) => obj.U[T](r.g),
    Uw: (T, r, w) => obj.Uw(T, obj.features(T, r.g), w),
    eq2only: true,
    stats: { states: enumr.statesExplored, settled: enumr.settledCount, assertions: enumr.all.length },
  }
}

// ─────────────────────────────────────────────────────────────── main
const which = process.argv[2]
const ALL = ['grove', 'ring', 'site', 'ops']
const chosen = ALL.includes(which) ? [which] : ALL
for (const name of chosen) {
  const B = name === 'grove' ? await groveBenchmark()
          : name === 'ring' ? await ringBenchmark()
          : name === 'site' ? await siteBenchmark()
          : await opsBenchmark()
  head(`BENCHMARK: ${B.name}   (${B.source})`)
  console.log(`  reachable states ${B.stats.states}   settled histories ${B.stats.settled}   ` +
    `assertions ${B.stats.assertions}   witnesses ${B.CAST.length}`)
  const eq2 = reportEq2(B)
  if (B.eq2only) console.log(`\n  (no Eq. (3) for this domain: the coupled objective needs a hearing adapter,\n   which exists for the grove and the Ring only.)`)
  else reportEq3(B, eq2)
  console.log()
}
