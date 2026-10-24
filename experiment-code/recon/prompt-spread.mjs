#!/usr/bin/env node
// Table 3's caption says the three models "differ by no more than 6 points on any row". This script
// computes both readings and writes them to disk, because the paper cites both: the range of the
// per-row model means (6), and the per-cell (row x witness) range (38).
//
// Data: recon/prompt-ladder-data.json. All 135 generations are in the repository, with full text,
// signature, feasibility and U. A generation whose signature cannot be extracted has U = null and
// is left out of the means (which is why the caption's K=3 needs a qualifier).
//
// Usage: node recon/prompt-spread.mjs
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const d = JSON.parse(fs.readFileSync(path.join(HERE, 'prompt-ladder-data.json'), 'utf8'))
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
const usable = d.results.filter(r => r.U !== null && r.U !== undefined)
const wits = [...new Set(d.results.map(r => r.witness))].sort()

const cellMean = (c, m, w) => {
  const v = usable.filter(r => r.cond === c && r.model === m && r.witness === w).map(r => r.U)
  return v.length ? mean(v) : null
}
const cells = []
for (const c of d.conds) for (const w of wits) {
  const v = d.models.map(m => cellMean(c, m, w)).filter(x => x !== null)
  if (v.length > 1) cells.push({ cond: c, witness: w, values: v, spread: Math.max(...v) - Math.min(...v) })
}
const rows = d.conds.map(c => {
  const v = d.models.map(m => {
    const x = usable.filter(r => r.cond === c && r.model === m).map(r => r.U)
    return x.length ? mean(x) : null
  }).filter(x => x !== null)
  return { cond: c, values: v.map(x => Number(x.toFixed(1))), spread: Number((Math.max(...v) - Math.min(...v)).toFixed(1)) }
})
const short = []
for (const c of d.conds) for (const m of d.models) for (const w of wits) {
  const n = usable.filter(r => r.cond === c && r.model === m && r.witness === w).length
  if (n < d.samples) short.push({ cond: c, model: m, witness: w, usable: n })
}
// Does any model hit a witness's feasible optimum exactly, with every generation in that cell hitting it?
const perfect = []
for (const c of d.conds) for (const m of d.models) for (const w of wits) {
  const rs = d.results.filter(r => r.cond === c && r.model === m && r.witness === w)
  const u = [...new Set(rs.map(r => r.U))]
  if (rs.length === d.samples && u.length === 1 && u[0] !== null && rs.every(r => r.feasible))
    perfect.push({ cond: c, model: m, witness: w, U: u[0], sig: rs[0].sig, n: rs.length })
}
// Table 3's distinct column: how many different accounts each model's three witnesses give on the
// row, averaged over models.
const distinct = d.conds.map(c => {
  const per = d.models.map(m => {
    const claims = wits.map(w => {
      const rs = usable.filter(r => r.cond === c && r.model === m && r.witness === w)
      return rs.length ? rs[0].sig : null
    }).filter(Boolean)
    return new Set(claims).size
  })
  return { cond: c, perModel: per, mean: Number((per.reduce((a,b)=>a+b,0)/per.length).toFixed(1)) }
})

const out = {
  distinctPerRow: distinct,
  note: 'the two readings of "the three never differ by more than 6 points on any row"',
  generations: d.results.length, withSignature: usable.length,
  rowMeanMaxSpread: Math.max(...rows.map(r => r.spread)),
  cellMaxSpread: Math.max(...cells.map(c => c.spread)),
  cellsOverSix: cells.filter(c => c.spread > 6).length, cellsTotal: cells.length,
  rows, cells, cellsShortOfK: short, unanimousCells: perfect,
}
fs.writeFileSync(path.join(HERE, 'prompt-spread-data.json'), JSON.stringify(out, null, 1))
console.log(`generations ${out.generations}, with an extractable signature ${out.withSignature}`)
console.log(`row-mean max spread ${out.rowMeanMaxSpread}   per-cell max spread ${out.cellMaxSpread}` +
  `   cells over 6: ${out.cellsOverSix}/${out.cellsTotal}`)
console.log(`cells short of K=${d.samples}: ${short.length}`)
for (const p of perfect) console.log(`  unanimous: ${p.cond} / ${p.model} / ${p.witness}  U=${p.U}  ${p.sig}`)
for (const r of distinct) console.log(`  distinct ${r.cond.padEnd(12)} per-model ${r.perModel.join(',')} -> ${r.mean}`)
console.log('written: recon/prompt-spread-data.json')
