// APPROXIMATE Feas(F) — for domains too large to enumerate.
//
// The paper's optima are exact because Feas(F) is enumerated. That is also the paper's
// sharpest limitation: it only holds where enumeration is possible. This is the honest
// alternative — rejection sampling over legal histories — and, more to the point, the
// apparatus for saying HOW WRONG it is, by running it where the exact answer is known.
//
// Nothing here is used for any number the paper reports about the three main domains.
// Those stay exact. This is for the scaling claim and nothing else.
import { CAST, ACTIONS, simulate, signature, matchesRecord, assertionOf, assertKey } from './site-domain.mjs'

function mulberry32(a) { a |= 0; return function () { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }

const OPS = Object.keys(ACTIONS)
function allMoves(cast) {
  const out = []
  for (const op of OPS) for (const actor of cast) {
    if (op === 'jostle') { for (const target of cast) if (target !== actor) out.push({ op, actor, target }) }
    else out.push({ op, actor })
  }
  return out
}

// Which moves can still lead to a history the record admits? Uniform rollout wastes most of
// its budget on prefixes that are already doomed — it never wears the harness by luck, but it
// happily ends the history before the rail comes off. Pruning those is not cheating: the
// record is public, and any practitioner approximating Feas(F) would use it.
function stillPossible(state, move) {
  if (move.op === 'wearHarness') return false          // the record says the harness was unused
  const decisive = move.op === 'overreach' || move.op === 'slip' || move.op === 'jostle'
  if (decisive) {
    if (state.rail !== 'removed') return false         // the record says the guardrail was off
    if (!state.tagSignedBy) return false               // the record says the tag was signed
    const victim = move.op === 'jostle' ? move.target : move.actor
    if (victim !== 'Worker') return false              // the record says the worker fell
  }
  return true
}

/**
 * Sample `budget` legal histories; keep the ones the record admits.
 * Returns the feasible assertions FOUND — a subset of Feas(F), never a superset, so any
 * optimum it reports is attainable; the risk is missing a better one, which is exactly
 * what validate() measures.
 */
export function approximate({ budget = 200000, seed = 16980222, maxLen = 7 } = {}) {
  const rand = mulberry32(seed)
  const MOVES = allMoves(CAST)
  const found = new Map()
  let legal = 0, terminal = 0
  for (let i = 0; i < budget; i++) {
    const steps = []
    let st = simulate(steps).state
    for (let d = 0; d < maxLen; d++) {
      // UNIFORM=1: no record-guided pruning — the ablation SCALING.md quotes. Without this
      // branch that row had no reproduction path (audit round 2, S3).
      const live = process.env.UNIFORM === '1' ? MOVES : MOVES.filter(m => stillPossible(st, m))
      if (!live.length) break
      const m = live[Math.floor(rand() * live.length)]
      const trial = [...steps, m]
      const r = simulate(trial)
      if (!r.ok) continue                       // illegal move: drop it, keep sampling
      steps.push(m)
      st = r.state
      const g = signature(r.state)
      if (g) {                                  // reached a terminal history
        terminal++
        if (matchesRecord(g)) {
          const k = assertKey(g)
          if (!found.has(k)) found.set(k, { sig: k, g: assertionOf(g), feasible: true })
        }
        break
      }
    }
    legal++
  }
  return { found: [...found.values()], budget, terminal, seed }
}

/** How wrong is it, where the truth is known? */
export function validate({ all, feasibles, U, features, budget, seed = 16980222 }) {
  const A = approximate({ budget, seed })
  const argmaxBy = (a, f) => a.slice().sort((x, y) => (f(y) - f(x)) || (x.sig < y.sig ? -1 : 1))[0]
  const u100 = (x) => Math.round(100 * x)
  const rows = []
  for (const T of CAST) {
    const f = (r) => U[T](features(T, r.g))
    const exact = argmaxBy(feasibles, f)
    const approx = A.found.length ? argmaxBy(A.found, f) : null
    rows.push({
      party: T,
      exactU: u100(f(exact)),
      approxU: approx ? u100(f(approx)) : null,
      sameAccount: approx ? approx.sig === exact.sig : false,
      gap: approx ? u100(f(exact)) - u100(f(approx)) : null,
    })
  }
  return { coverage: A.found.length, truth: feasibles.length, budget: A.budget, rows }
}
