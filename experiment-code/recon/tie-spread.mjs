#!/usr/bin/env node
// Table 1 prints ONE representative per agent out of a tied argmax set, and its footer says
// "distinct accounts selected: 3/3 in all three domains". This computes what survives the tie:
// the tie widths, every equally-optimal profile, and the fraction in which the three selections
// are pairwise distinct -- under the SAME key each domain's benchmark uses (grove r.sig,
// ring r.assertion, ops r.sig, site r.sig), plus the coarser "who dealt the fatal act" reading where that
// is meaningful (grove, site; in ring nobody disputes who struck, so that lens is degenerate
// and is reported as such rather than hidden).
//
// Also settles, by measurement rather than assumption, whether the site signature contains any
// coordinate no U_i reads: for each coordinate, vary it alone across the whole assertion space
// and see whether any agent's utility ever moves. If some coordinate never moves any U_i, the
// site sig is finer than the paper's own assertion notion and Section 2's warning applies.
//
// Everything is written to tie-spread-data.json. CLAUDE.md's hazard section asked for exactly
// this: "report the fraction, not the single profile".
//
// NO LLM. Usage: node recon/tie-spread.mjs

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const EPS = 1e-9
const pct = (a, b) => Number((100 * a / b).toFixed(1))

function analyse({ name, cast, pool, U, keys, note }) {
  const M = {}
  for (const T of cast) {
    const scored = pool.map(r => ({ r, u: U(T, r) }))
    const best = Math.max(...scored.map(s => s.u))
    M[T] = { best, maxers: scored.filter(s => s.u > best - EPS).map(s => s.r) }
  }
  const widths = cast.map(T => M[T].maxers.length)
  const total = widths.reduce((a, b) => a * b, 1)
  const fractions = {}
  for (const [kname, kf] of Object.entries(keys)) {
    let three = 0
    const rec = (i, acc) => {
      if (i === cast.length) { if (new Set(acc).size === cast.length) three++; return }
      for (const r of M[cast[i]].maxers) rec(i + 1, [...acc, kf(r)])
    }
    rec(0, [])
    fractions[kname] = { three, total, pct: pct(three, total) }
  }
  console.log(`\n${name}: widths ${widths.join(' x ')} = ${total} equally-optimal profiles${note ? '  (' + note + ')' : ''}`)
  for (const [k, f] of Object.entries(fractions))
    console.log(`  distinct-3 under ${k.padEnd(24)} ${f.three}/${f.total} = ${f.pct}%`)
  return { widths, total, fractions, M }
}

const out = { note: 'tie-break robustness of Table 1\'s "distinct accounts selected: 3/3"' }

// ---- grove: the paper's 22-assertion universe, benchmark key r.sig ----
{
  const GC = await import('./game-core.mjs')
  const pool = GC.feasibles
  const r0 = pool[0]
  if (!r0.sig) throw new Error('grove records have no .sig; the benchmark key changed')
  const res = analyse({
    name: 'grove (In a Grove)', cast: GC.CAST, pool,
    U: (T, r) => GC.Uself(T, r),
    keys: { 'r.sig (benchmark key)': r => r.sig, 'fatal act (claimKey)': GC.claimKey },
    note: `|Feas|=${pool.length}, counted in the 22-assertion universe`,
  })
  // the bandit's robust statement: every tied optimum attributes the death to somebody else
  const banditActors = [...new Set(res.M['Tajomaru'].maxers.map(r => r.an.fatal.actor))]
  const blamesAnother = !banditActors.includes('Tajomaru')
  console.log(`  bandit's tied optima blame: ${banditActors.join(', ')}  -> blames another in all ties: ${blamesAnother}`)
  out.grove = { feasible: pool.length, widths: res.widths, profiles: res.total,
                fractions: res.fractions, banditTiedActors: banditActors,
                banditBlamesAnotherInAllTies: blamesAnother }
}

// ---- ring: benchmark key r.assertion ----
{
  const obj = await import('./ring-objective.mjs')
  const RH = await import('./ring-hearing.mjs')
  const pool = RH.fullPool(RH.buildSpace())
  const killerOf = (r) => JSON.stringify(r.g.killer ?? r.g.fatal ?? r.g.actor ?? null)
  const res = analyse({
    name: 'ring (The Ring and the Book)', cast: obj.CAST, pool,
    U: (T, r) => obj.Uw(T, obj.features(T, r.g), [1, 1, 1]),
    keys: { 'r.assertion (benchmark key)': r => r.assertion },
    note: `|Feas|=${pool.length}`,
  })
  // the "fatal act" lens is degenerate here iff every feasible account has the same killer
  const killers = [...new Set(pool.map(killerOf))]
  console.log(`  distinct "killer" values across Feas: ${killers.length} -> fatal-act lens ${killers.length === 1 ? 'DEGENERATE (undisputed)' : 'non-degenerate'}`)
  out.ring = { feasible: pool.length, widths: res.widths, profiles: res.total,
               fractions: res.fractions, distinctKillerValues: killers.length }
}

// ---- site: benchmark key r.sig; plus the coordinate-read audit ----
{
  const E = await import('./site-enum.mjs')
  const O = await import('./site-objective.mjs')
  const U = (T, r) => O.Uw(T, O.features(T, r.g), [1, 1, 1])
  const res = analyse({
    name: 'site (A site fall)', cast: E.CAST, pool: E.feasibles,
    U,
    keys: { 'r.sig (benchmark key)': r => r.sig,
            'fatal act (actor|cause)': r => `${r.g.actor}|${r.g.cause}` },
    note: `|Feas|=${E.feasibles.length}`,
  })

  // does any signature coordinate go unread by every U_i? tested on the full assertion space
  const coords = Object.keys(E.all[0].g)
  const uvec = (g) => E.CAST.map(T => O.Uw(T, O.features(T, g), [1, 1, 1])).join(',')
  const unread = []
  for (const c of coords) {
    const groups = new Map()
    for (const r of E.all) {
      const rest = JSON.stringify(Object.fromEntries(Object.entries(r.g).filter(([k]) => k !== c)))
      if (!groups.has(rest)) groups.set(rest, [])
      groups.get(rest).push(r)
    }
    let everMoves = false, everVaries = false
    for (const rs of groups.values()) {
      if (rs.length < 2) continue
      const vals = new Set(rs.map(r => JSON.stringify(r.g[c])))
      if (vals.size < 2) continue
      everVaries = true
      const us = new Set(rs.map(r => uvec(r.g)))
      if (us.size > 1) { everMoves = true; break }
    }
    if (everVaries && !everMoves) unread.push(c)
  }
  console.log(`  coordinates in the site signature never moving any U_i: ${unread.length ? unread.join(', ') : 'none'}`)
  out.site = { feasible: E.feasibles.length, widths: res.widths, profiles: res.total,
               fractions: res.fractions, coordinates: coords, coordinatesUnreadByEveryU: unread }
}

// ---- ops: the paper's third domain; benchmark key r.sig, plus the same coordinate-read audit ----
{
  const E = await import('./ops-enum.mjs')
  const O = await import('./ops-objective.mjs')
  const U = (T, r) => O.Uw(T, O.features(T, r.g), [1, 1, 1])
  const res = analyse({
    name: 'ops (An agent ops incident)', cast: E.CAST, pool: E.feasibles,
    U,
    keys: { 'r.sig (benchmark key)': r => r.sig,
            'fatal act (actor)': r => `${r.g.actor}` },
    note: `|Feas|=${E.feasibles.length}`,
  })
  // F pins the actor, so the "who acted" lens is degenerate here, exactly as it is for the site fall
  const actors = [...new Set(E.feasibles.map(r => r.g.actor))]
  console.log(`  distinct "actor" values across Feas: ${actors.length} -> fatal-act lens ${actors.length === 1 ? 'DEGENERATE (F pins the actor)' : 'non-degenerate'}`)

  // does any signature coordinate go unread by every U_i? tested on the full assertion space
  const coords = Object.keys(E.all[0].g)
  const uvec = (g) => E.CAST.map(T => O.Uw(T, O.features(T, g), [1, 1, 1])).join(',')
  const unread = []
  for (const c of coords) {
    const groups = new Map()
    for (const r of E.all) {
      const rest = JSON.stringify(Object.fromEntries(Object.entries(r.g).filter(([k]) => k !== c)))
      if (!groups.has(rest)) groups.set(rest, [])
      groups.get(rest).push(r)
    }
    let everMoves = false, everVaries = false
    for (const rs of groups.values()) {
      if (rs.length < 2) continue
      const vals = new Set(rs.map(r => JSON.stringify(r.g[c])))
      if (vals.size < 2) continue
      everVaries = true
      const us = new Set(rs.map(r => uvec(r.g)))
      if (us.size > 1) { everMoves = true; break }
    }
    if (everVaries && !everMoves) unread.push(c)
  }
  console.log(`  coordinates in the ops signature never moving any U_i: ${unread.length ? unread.join(', ') : 'none'}`)
  out.ops = { feasible: E.feasibles.length, widths: res.widths, profiles: res.total,
              fractions: res.fractions, coordinates: coords, coordinatesUnreadByEveryU: unread }
}

fs.writeFileSync(path.join(HERE, 'tie-spread-data.json'), JSON.stringify(out, null, 1))
console.log('\nwritten: recon/tie-spread-data.json')
