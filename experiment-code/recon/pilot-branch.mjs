#!/usr/bin/env node
// Sensitive-dependence pilot: does a SHARED early prefix constrain the ending,
// or does per-step sampling wash it out?
//   - run a common prefix to turn PREFIX, snapshot the full engine state
//   - fork K "siblings": restore the snapshot, resample turns PREFIX+1..N  (shared history)
//   - run M independent runs from scratch to N turns                        (baseline)
//   - compare ending-spread(shared) vs ending-spread(independent)
// H1 (early perturbations amplify): shared siblings converge MORE than independent.
// H2 (sampling dominates):          shared siblings diverge about the SAME.
//
// Needs the engine's /api/state/full (GET) and /api/state/load (POST) endpoints.
// Usage: set -a; . ./.env.local; set +a; node recon/pilot-branch.mjs
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const PORT = Number(process.env.PILOT_PORT || 4977)
const BASE = `http://127.0.0.1:${PORT}`
const PREFIX = Number(process.env.PREFIX || 4)
const N = Number(process.env.NTURNS || 7)
const K = Number(process.env.KBRANCH || 5)
const M = Number(process.env.MINDEP || 5)
const SEED = JSON.parse(readFileSync(path.join(ROOT, 'neurips-submission', 'rashomon-seed-en.json'), 'utf8'))

async function api(method, p, body) {
  const res = await fetch(`${BASE}${p}`, { method, headers: { 'content-type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined })
  const text = await res.text(); let json = null; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text }
}
async function waitUp(ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { try { const r = await fetch(`${BASE}/api/state`); if (r.ok) return true } catch {} await sleep(300) } throw new Error('server not up') }
function endOf(md) { if (!md) return ''; const m = md.match(/##\s*(Epilogue|Ending|Finale|\u5C3E\u58F0|\u7ED3\u5C40|\u843D\u5E55)\s*\n+([\s\S]+?)(?:\n##|\n*$)/i); return (m ? m[2] : md.slice(-600)).trim().replace(/\s+/g, ' ').slice(0, 500) }
function tag(s) {
  const t = (s || '').toLowerCase()
  if (/(throat|pierc|stab|drove the (blade|dagger)|dagger .*(throat|chest|heart)|kill|slain|lies dead|his life ends|takes his own life|suicide|drove it into)/.test(t)) return 'DEATH'
  if (/(rides? (out|off|away)|flees|fled|bond .*(sever|broke)|walk(s|ed) away|leaves the grove alive|escap|part(s|ed) ways)/.test(t)) return 'FLIGHT/SEVER'
  return 'UNRESOLVED'
}
async function scenario() { await api('POST', '/api/reset'); const r = await api('POST', '/api/scenario', SEED); if (r.status !== 200) throw new Error('scenario failed: ' + r.text.slice(0, 200)) }
async function turns(n) { for (let i = 0; i < n; i++) await api('POST', '/api/turn', {}) }
async function ending() { const r = await api('POST', '/api/script/final', {}); return endOf(r.json?.script?.markdown || '') }

const child = spawn(process.execPath, [path.join(ROOT, 'agent-society-server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'inherit'] })
process.on('exit', () => { try { child.kill('SIGTERM') } catch {} })
await waitUp()
console.error(`[pilot] PREFIX=${PREFIX} N=${N} K=${K} M=${M}`)

// ---- common prefix + snapshot ----
await scenario(); await turns(PREFIX)
const snap = (await api('GET', '/api/state/full')).json
if (!snap || snap.world?.turn !== PREFIX) { console.error('[pilot] snapshot unusable, turn=', snap?.world?.turn); child.kill(); process.exit(2) }
console.error(`[pilot] prefix -> turn ${PREFIX}, snapshot ok`)

// ---- shared-prefix siblings ----
const shared = []
for (let k = 0; k < K; k++) {
  const load = await api('POST', '/api/state/load', snap)
  if (load.json?.turn !== PREFIX) { console.error(`[pilot] restore failed @branch ${k}:`, load.text.slice(0, 120)); continue }
  await turns(N - PREFIX)
  const e = await ending(); shared.push(e)
  console.error(`[pilot] shared ${k + 1}/${K} -> ${tag(e)}`)
}

// ---- independent baseline ----
const indep = []
for (let m = 0; m < M; m++) {
  await scenario(); await turns(N)
  const e = await ending(); indep.push(e)
  console.error(`[pilot] indep ${m + 1}/${M} -> ${tag(e)}`)
}

const summ = arr => { const c = {}; arr.forEach(e => { const t = tag(e); c[t] = (c[t] || 0) + 1 }); return c }
const out = { params: { PREFIX, N, K, M }, shared, indep, sharedTags: shared.map(tag), indepTags: indep.map(tag), sharedSpread: summ(shared), indepSpread: summ(indep) }
writeFileSync(path.join(HERE, 'pilot-branch-data.json'), JSON.stringify(out, null, 2))
console.error('\n[pilot] shared-prefix spread:', JSON.stringify(out.sharedSpread))
console.error('[pilot] independent  spread:', JSON.stringify(out.indepSpread))
console.error('[pilot] SAVED recon/pilot-branch-data.json')
child.kill('SIGTERM')
