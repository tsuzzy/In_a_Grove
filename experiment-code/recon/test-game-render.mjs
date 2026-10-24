#!/usr/bin/env node
// Render check for game.html — same idea as atlas/test-render.mjs: run the page's real
// JS against a minimal DOM shim so a broken selector or a renamed data field fails here
// instead of silently rendering an empty panel.
// Usage: node recon/test-game-render.mjs

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const html = fs.readFileSync(path.join(HERE, '../../demo/game.html'), 'utf8')
const dataSrc = fs.readFileSync(path.join(HERE, '../../demo/game-data.js'), 'utf8')

let pass = 0, fail = 0
const expect = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${detail}`) }
}

// ---- the ids the page writes into, taken from the markup itself ----
const ids = [...html.matchAll(/id="([A-Za-z0-9_]+)"/g)].map(m => m[1])
const written = new Set()
const nodes = Object.fromEntries(ids.map(id => [id, {
  id, _html: '',
  set innerHTML(v) { this._html = String(v); written.add(this.id) },
  get innerHTML() { return this._html },
}]))

const documentShim = {
  getElementById(id) {
    if (!nodes[id]) throw new Error(`page writes to #${id}, which does not exist in the markup`)
    return nodes[id]
  },
}

// ---- execute data + page script exactly as the browser would ----
const script = html.split('<script>')[1].split('</script>')[0]
const windowShim = {}
let threw = null
try {
  new Function('window', 'document', `${dataSrc}\n${script}`)(windowShim, documentShim)
} catch (e) { threw = e }

console.log('\n[1] the page script runs')
expect('no exception during initial render', threw === null, threw ? `${threw.message}` : '')
if (threw) { console.log(`\nFAILURES — ${pass} passed, ${fail} failed\n`); process.exit(1) }

console.log('\n[2] every panel got content')
for (const id of ['truth', 'anchor', 'tiesNote', 'ties', 'traj', 'sweep', 'sweepKpis', 'eqNote', 'eqs', 'rob', 'foot'])
  expect(`#${id} rendered`, written.has(id) && nodes[id].innerHTML.length > 40,
    `${nodes[id]?.innerHTML.length ?? 0} chars`)

console.log('\n[3] the numbers on the page are the numbers in the data')
{
  const w = {}; new Function('window', dataSrc)(w)
  const G = w.GAME
  const all = Object.values(nodes).map(n => n.innerHTML).join('\n')
  expect('anchor shows all three witnesses',
    ['Tajomaru', 'Masago', 'Takehiro'].every(t => nodes.anchor.innerHTML.includes(t)))
  expect('trajectory has one row per level', (nodes.traj.innerHTML.match(/<tr/g) || []).length >= G.trajectory.length)
  expect('β sweep has one column per β', (nodes.sweep.innerHTML.match(/class="col/g) || []).length === G.sweep.length)
  expect('β* appears on the page', all.includes(String(G.betaStar)))
  expect('equilibrium count appears', nodes.eqNote.innerHTML.includes(String(G.equilibria.count)))
  expect('one card per equilibrium', (nodes.eqs.innerHTML.match(/class="eq /g) || []).length === G.equilibria.profiles.length)
  expect('the limitations paragraph is present', nodes.foot.innerHTML.includes('Limits, stated'))
  expect('no undefined leaked into the markup', !all.includes('undefined'),
    all.slice(Math.max(0, all.indexOf('undefined') - 60), all.indexOf('undefined') + 60))
  expect('no NaN leaked into the markup', !all.includes('NaN'))
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
