// ENUMERATION — depth-first over every legal action sequence, deduplicated by causal
// signature. Same discipline as the other two domains: exhaustive, no sampling.
import { CAST, ACTIONS, initialState, simulate, signature, sigKey, matchesRecord, assertionOf, assertKey } from './site-domain.mjs'

const OPS = Object.keys(ACTIONS)
const ALL = CAST
function moves() {
  const out = []
  for (const op of OPS) for (const actor of ALL) {
    if (op === 'jostle') { for (const target of ALL) if (target !== actor) out.push({ op, actor, target }) }
    else out.push({ op, actor })
  }
  return out
}
const MOVES = moves()

let states = 0, settled = 0
const bySig = new Map()
const causalSigs = new Set()
const MAXLEN = 7
function dfs(steps) {
  states++
  const r = simulate(steps)
  if (!r.ok) return
  const g = signature(r.state)
  if (g) {                                   // terminal
    settled++
    causalSigs.add(sigKey(g))
    const k = assertKey(g)                     // the argmax domain is assertions, not signatures
    const prev = bySig.get(k)
    if (!prev) bySig.set(k, { sig: k, g: assertionOf(g), feasible: matchesRecord(g), steps: [...steps] })
    else if (!prev.feasible && matchesRecord(g)) { prev.feasible = true; prev.steps = [...steps] }
    return
  }
  if (steps.length >= MAXLEN) return
  for (const m of MOVES) dfs([...steps, m])
}
dfs([])

export const statesExplored = states
export const causalSignatures = () => causalSigs.size
export const settledCount = settled
export const all = [...bySig.values()]
export const feasibles = all.filter(r => r.feasible)
export { CAST }
