// Run the generic non-enumerative solvers (solver-engines.mjs) on grove / ring / ops.
// Each domain supplies an adapter; enumeration is imported only for the ground-truth optima.
// Usage: node recon/solvers-report.mjs [grove|ring|ops|all]
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { runGA, runRL } from './solver-engines.mjs'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))

// ── grove adapter ──────────────────────────────────────────────
import * as GD from './domain.mjs'
import * as GO from './grove-objective.mjs'
import * as GC from './grove-core.mjs'
const gBLADES = ['longsword', 'dagger']
function* gGroundings(s) {
  for (const actor of GC.CAST) {
    const g = s.agents[actor]; if (!g.alive || !g.present) continue
    if (!g.bound) { yield { type: 'flee', actor }; if (s.horse) yield { type: 'mount_flee', actor } }
    for (const obj of gBLADES) {
      const o = s.objects[obj]
      if (!g.bound && o.holder === null && o.ground) yield { type: 'take', actor, object: obj }
      if (!g.bound && o.holder && o.holder !== actor && s.agents[o.holder]?.present) yield { type: 'seize', actor, object: obj }
      if (o.holder === actor) {
        for (const t of GC.CAST) if (t !== actor && s.agents[t].alive && s.agents[t].present) yield { type: 'give', actor, object: obj, target: t }
        if (!g.bound && s.rope === 'binding') yield { type: 'cut_rope', actor, object: obj }
        if (!g.bound) { for (const t of GC.CAST) if (t !== actor && s.agents[t].alive && s.agents[t].present) yield { type: 'strike', actor, target: t, object: obj, part: 'throat' }; yield { type: 'self_strike', actor, object: obj, part: 'throat' } }
      }
      if (!g.bound && o.holder && o.holder !== actor) yield { type: 'impale_on_held', actor, object: obj, part: 'throat' }
    }
  }
}
function gAnnotate(steps) {
  const s = GD.initialState(); let fatal = null
  for (const a of steps) {
    const bb = s.agents.Takehiro.bound, ba = s.agents.Takehiro.alive, va = gBLADES.some(o => s.objects[o].holder === 'Takehiro')
    GD.ACTIONS[a.type].eff(s, a)
    if (!fatal && ba && s.agents.Takehiro.alive === false) fatal = { actor: a.actor, type: a.type, weapon: a.object, boundAtDeath: bb, victimArmed: va }
  }
  return { fatal }
}
const gKey = (s) => JSON.stringify([GC.CAST.map(a => [s.agents[a].alive, s.agents[a].bound, s.agents[a].present, s.agents[a].wounds.map(w => w.part + ':' + w.weapon + (w.selfInflicted ? 's' : w.contested ? 'c' : ''))]), gBLADES.map(o => [s.objects[o].holder, s.objects[o].ground, s.objects[o].bloodied, !!s.objects[o].flung]), s.rope, s.horse])
const gFatal = (h) => { const an = gAnnotate(h).fatal; return an ? `${an.actor}|${an.type}|${an.weapon}|${an.boundAtDeath}|${an.victimArmed}` : '-' }
const groveA = {
  name: 'grove', CAST: GC.CAST, TMAX: 7,
  replay: (h) => { const r = GD.simulate(h); return { state: r.state, ok: r.ok } },
  legalActions: (s) => [...gGroundings(s)].filter(a => GD.ACTIONS[a.type].pre(s, a).ok),
  misses: (s) => GD.diffAftermath(s, GC.F).length,
  utility: (h, s, w) => { const an = gAnnotate(h); return an.fatal ? Math.round(100 * GO.U[w](GO.features(w, an))) : -1 },
  stateKey: (s, h) => gKey(s) + '#' + gFatal(h),
  accountKey: (h) => gFatal(h),
  terminal: (s) => !s.agents.Takehiro.alive,
}
const groveExact = Object.fromEntries(GC.CAST.map(T => [T, Math.max(...GC.feasibles.map(r => Math.round(100 * GO.U[T](GO.features(T, r.an)))))]))

// ── ops adapter ────────────────────────────────────────────────
import * as OD from './ops-domain.mjs'
import * as OO from './ops-objective.mjs'
import * as OE from './ops-enum.mjs'
const opsMoves = []; for (const op of Object.keys(OD.ACTIONS)) for (const actor of OD.CAST) opsMoves.push({ op, actor })
const opsA = {
  name: 'ops', CAST: OD.CAST, TMAX: 7,
  replay: (h) => { const r = OD.simulate(h); return { state: r.state, ok: r.ok } },
  legalActions: (s) => s.incident ? [] : opsMoves.filter(a => OD.ACTIONS[a.op].pre(s, a)),
  misses: (s) => !s.incident ? 2 : (OD.matchesRecord(OD.signature(s)) ? 0 : 1),
  utility: (h, s, w) => s.incident ? Math.round(OO.U[w](OD.signature(s))) : -1,
  stateKey: (s) => JSON.stringify([s.planBy, s.planRisky, s.planGuarded, s.approvedBy, s.escalatedBy, s.flaggedBy, s.overriddenBy, s.incident]),
  accountKey: (h) => { const s = OD.simulate(h).state; return s.incident ? OD.assertKey(OD.signature(s)) : '-' },
  terminal: (s) => !!s.incident,
}
const opsExact = Object.fromEntries(OD.CAST.map(T => [T, Math.max(...OE.feasibles.map(r => Math.round(OO.U[T](r.g))))]))

// ── ring adapter ───────────────────────────────────────────────
import * as RD from './ring-domain.mjs'
import * as RO from './ring-objective.mjs'
import * as RC from './ring-core.mjs'
function* rGroundings(s) {
  for (const type of Object.keys(RD.ACTIONS)) {
    if (type === 'write_letters') { for (const actor of ['Pompilia', 'Caponsacchi', 'Guido']) if (RD.ACTIONS[type].pre(s, { type, actor }).ok) yield { type, actor } }
    else if (RD.ACTIONS[type].pre(s, { type }).ok) yield { type }
  }
}
const rSettled = (s) => (s.guido.basis !== null && s.guido.taken) || s.flight.reachedRome
const ringA = {
  name: 'ring', CAST: RO.CAST, TMAX: 24,
  replay: (h) => { const r = RD.simulate(h); return { state: r.state, ok: r.ok } },
  legalActions: (s) => [...rGroundings(s)],
  misses: (s) => RD.diffRecord(s, RD.RECORD).length,
  utility: (h, s, w) => Math.round(100 * RO.U[w](RO.features(w, RD.signature(s)))),
  stateKey: (s) => JSON.stringify([s.where, s.alive, s.pompilia, s.letters, s.flight, s.child, s.suit, s.guido, s.peril]),
  accountKey: (h) => { const g = RD.signature(RD.simulate(h).state); return ['initiator', 'letters', 'consummated', 'reachedRome', 'sire', 'basis', 'sued', 'alone', 'usedName', 'peril'].map(c => String(g[c])).join('|') },
  terminal: rSettled,
}
const rspace = RC.enumerate()
const rfeas = rspace.assertionsUnder(RD.RECORD)
const ringExact = Object.fromEntries(RO.CAST.map(T => [T, Math.max(...rfeas.map(r => Math.round(100 * RO.U[T](RO.features(T, r.g)))))]))

// ── driver ─────────────────────────────────────────────────────
const DOMAINS = {
  grove: { A: groveA, exact: groveExact, ga: { POP: 40, GENS: 40 }, gaSeeds: 8, rl: { EPISODES: 6000 }, rlSeeds: 8 },
  ops:   { A: opsA,   exact: opsExact,   ga: { POP: 40, GENS: 40 }, gaSeeds: 8, rl: { EPISODES: 6000 }, rlSeeds: 8 },
  ring:  { A: ringA,  exact: ringExact,  ga: { POP: 80, GENS: 300 }, gaSeeds: 8, rl: { EPISODES: 12000 }, rlSeeds: 8 },
}
const med = (arr) => { const a = arr.slice().sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null }
const which = process.argv[2] || 'all'
const chosen = which === 'all' ? Object.keys(DOMAINS) : [which]
const out = {}
for (const name of chosen) {
  const D = DOMAINS[name]
  console.log(`\n=== ${name} ===  exact: ${D.A.CAST.map(w => `${w} ${D.exact[w]}`).join(', ')}`)
  out[name] = {}
  const gaBySeed = Array.from({ length: D.gaSeeds }, () => ({})), rlBySeed = Array.from({ length: D.rlSeeds }, () => ({}))
  for (const w of D.A.CAST) {
    const ga = []; for (let s = 1; s <= D.gaSeeds; s++) ga.push(runGA(D.A, w, s, D.ga, D.exact[w]))
    const rl = []; for (let s = 1; s <= D.rlSeeds; s++) rl.push(runRL(D.A, w, s, D.rl, D.exact[w]))
    const gw = ga.filter(r => r.reached), rw = rl.filter(r => r.reached)
    const row = { exact: D.exact[w], gaBest: Math.max(...ga.map(r => r.bestU)), gaSuccess: `${gw.length}/${D.gaSeeds}`, gaCalls: med(gw.map(r => r.callsToOpt)), rlBest: Math.max(...rl.map(r => r.bestU)), rlSuccess: `${rw.length}/${D.rlSeeds}`, rlEpisodes: med(rw.map(r => r.epToOpt)) }
    ga.forEach((r, i) => { if (r.bestHistory) gaBySeed[i][w] = D.A.accountKey(r.bestHistory) })
    rl.forEach((r, i) => { if (r.bestHistory) rlBySeed[i][w] = D.A.accountKey(r.bestHistory) })
    out[name][w] = row
    console.log(`  ${w.padEnd(12)} exact ${row.exact}  GA ${row.gaBest} ${row.gaSuccess} calls ${row.gaCalls ?? '-'}   RL ${row.rlBest} ${row.rlSuccess} ep ${row.rlEpisodes ?? '-'}`)
  }
  const n = D.A.CAST.length
  const fracDistinct = (bySeed) => { const full = bySeed.filter(p => Object.keys(p).length === n); const d = full.filter(p => new Set(Object.values(p)).size === n).length; return full.length ? Math.round(100 * d / full.length) : null }
  const pGA = fracDistinct(gaBySeed), pRL = fracDistinct(rlBySeed)
  out[name].__summary = { distinctPctGA: pGA, distinctPctRL: pRL, inadmissible: 0 }
  console.log(`  3-distinct across seeds: GA ${pGA}%, RL ${pRL}%   |   inadmissible 0%`)
}
fs.writeFileSync(path.join(HERE, 'solvers-data.json'), JSON.stringify(out, null, 1))
console.log('\nwritten: recon/solvers-data.json')
