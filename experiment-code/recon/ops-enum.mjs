// ops-enum.mjs -- exhaustive DFS enumeration of the ops-incident histories.
// Mirrors site-enum: ground every (op, actor) into a move list, DFS to MAXLEN, dedup terminals by
// assertKey (the quotient), track the set of full causal signatures. All counts are exact.
import { CAST, ACTIONS, initialState, signature, sigKey, assertionOf, assertKey, matchesRecord } from './ops-domain.mjs'

const MOVES = []
for (const op of Object.keys(ACTIONS)) for (const actor of CAST) MOVES.push({ op, actor })
const MAXLEN = 7

let _states = 0, _settled = 0
const bySig = new Map()     // assertKey -> record (quotiented assertions)
const fullSigs = new Set()  // full causal signatures (with `overrider`) -- the count "before the quotient"

const clone = (s) => ({ ...s })

function dfs(steps, s) {
  _states++
  if (s.incident) {
    _settled++
    const g = signature(s)
    fullSigs.add(sigKey(g))
    const k = assertKey(g)
    if (!bySig.has(k)) bySig.set(k, { sig: k, g: assertionOf(g), feasible: matchesRecord(g), steps: [...steps] })
    else if (matchesRecord(g)) bySig.get(k).feasible = true
    return
  }
  if (steps.length >= MAXLEN) return
  for (const m of MOVES) {
    if (!ACTIONS[m.op].pre(s, m)) continue
    const ns = clone(s); ACTIONS[m.op].eff(ns, m)
    dfs([...steps, m], ns)
  }
}
dfs([], initialState())

export const statesExplored = _states
export const settledCount = _settled
export const causalSignatures = () => fullSigs.size
export const all = [...bySig.values()]
export const feasibles = all.filter(r => r.feasible)
export { CAST }
