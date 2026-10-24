#!/usr/bin/env node
// SCALING — how far the exact method reaches, and how well the approximation stands in.
//
// The paper's optima are exact because Feas(F) is enumerated. That holds only where
// enumeration is possible, which is the limitation every reviewer named. This measures both
// halves of the honest answer: where enumeration stops, and whether a sampler that never sees
// the full set still finds the same optima where the truth is known.
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const P = Number(process.env.SITE_PARTIES || 3)
const [{ all, feasibles, statesExplored, causalSignatures, CAST }, obj, approx] = await Promise.all([
  import('./site-enum.mjs'), import('./site-objective.mjs'), import('./site-approx.mjs'),
])
const BUDGET = Number(process.env.APPROX_BUDGET || 400000)
const t0 = Date.now()
const v = approx.validate({ all, feasibles, U: obj.U, features: obj.features, budget: BUDGET })
const secs = ((Date.now() - t0) / 1000).toFixed(1)

console.log(`\n${P} parties · ${statesExplored.toLocaleString()} states enumerated · ${all.length} assertions · |Feas(F)| = ${feasibles.length}`)
console.log(`approximation: ${BUDGET.toLocaleString()} guided rollouts in ${secs}s, found ${v.coverage}/${v.truth} feasible assertions (${(100*v.coverage/v.truth).toFixed(0)}%)\n`)
console.log(`  party       exact U   approx U   same account?   gap`)
for (const r of v.rows) {
  console.log(`  ${r.party.padEnd(11)} ${String(r.exactU).padEnd(9)} ${String(r.approxU).padEnd(10)} ` +
    `${(r.sameAccount ? 'yes' : 'no').padEnd(15)} ${r.gap}`)
}
const allHit = v.rows.every(r => r.gap === 0)
console.log(`\n  ${allHit ? 'The approximation recovers every exact optimum.' : 'The approximation MISSES an optimum — the gap column says by how much.'}`)

// Every number the paper cites must have a source in the repository. Each run of this script covers
// one (parties, budget) combination, so results are merged into one file by key rather than
// overwritten: running each of the four configurations once collects them all.
const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const DATA = path.join(HERE, 'site-scaling-data.json')
let store = {}
try { store = JSON.parse(fs.readFileSync(DATA, 'utf8')) } catch { store = { note:
  'where enumeration stops, and what the sampler recovers. One entry per (parties, budget) run.', runs: {} } }
store.runs = store.runs || {}
const MODE = process.env.UNIFORM === '1' ? '-uniform' : ''
store.runs[`${P}p-${BUDGET}${MODE}`] = {
  parties: P, budget: BUDGET, uniform: process.env.UNIFORM === '1',
  statesExplored, causalSignatures: causalSignatures(),
  assertions: all.length, feasible: feasibles.length,
  coverage: v.coverage, truth: v.truth,
  coveragePct: Number((100 * v.coverage / v.truth).toFixed(0)),
  approxSeconds: Number(secs),
  recoversEveryOptimalValue: allHit,
  rows: v.rows.map(r => ({ party: r.party, exactU: r.exactU, approxU: r.approxU,
                           sameAccount: r.sameAccount, gap: r.gap })),
}
fs.writeFileSync(DATA, JSON.stringify(store, null, 1))
console.log(`  written: recon/site-scaling-data.json  [${P}p-${BUDGET}${MODE}]`)
