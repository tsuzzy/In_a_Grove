import { buildSpace, poolFor, solve, jointAudit, satisfies, CAST, COORDS, DISPUTED } from './ring-magistrate-core.mjs'
import { features, DIM_NAMES, U } from './ring-objective.mjs'
import { LADDER } from './ring-evidence.mjs'
const space = buildSpace(), pool = poolFor(space, LADDER), sol = solve(pool)
const solU = solve(poolFor(space, []))
const audit = jointAudit(pool, sol)
const ROLE = { Guido: 'the husband', Pompilia: 'the wife', Caponsacchi: 'the priest' }
const owner = pool.map(r => { const w = CAST.filter(T => satisfies(r, sol[T])); if (w.length > 1) throw new Error('overlap'); return w[0] || null })
console.log(JSON.stringify({
  nFeasible: pool.length,
  nBefore: poolFor(space, []).length,
  nRecordItems: LADDER.length,
  recordItems: LADDER,
  nAssertionsBefore: space.length,
  cast: CAST, role: ROLE,
  counts: Object.fromEntries(CAST.map(T => [T, owner.filter(o => o === T).length])),
  nNone: owner.filter(o => o === null).length,
  pairs: audit.pairs, jointly: audit.jointly,
  owner,
  commits: Object.fromEntries(CAST.map(T => [T, sol[T].commits])),
  // Per witness, everything the Step 3 card draws. `ceiling` is the record's cap on each of
  // that witness's own three features across the WHOLE feasible pool -- it happens to equal
  // what he attains, which is why the card is a statement about the record rather than about
  // a tie-broken representative. Emitted, never typed.
  // The testimony itself, and the SMALLEST set of disputed questions that separates all three
  // pairs. Chosen by rule, not for effect: the code below asserts that the pair separates every
  // pair and that no single question does, so the card cannot quietly become a rhetorical
  // selection if the domain changes.
  testimony: (() => {
    const say = (T, q) => sol[T].says[q]
    const sepOf = (q) => {
      const out = []
      for (let i = 0; i < CAST.length; i++) for (let j = i + 1; j < CAST.length; j++) {
        const a = say(CAST[i], q), b = say(CAST[j], q)
        if (a !== null && b !== null && a !== b) out.push(`${CAST[i]}|${CAST[j]}`)
      }
      return out
    }
    const allPairs = []
    for (let i = 0; i < CAST.length; i++) for (let j = i + 1; j < CAST.length; j++)
      allPairs.push(`${CAST[i]}|${CAST[j]}`)
    const qs = DISPUTED.map(d => d.q)
    if (qs.some(q => sepOf(q).length === allPairs.length))
      throw new Error('a single question now separates all three pairs; the card should use one row block')
    let chosen = null
    outer:
    for (let i = 0; i < qs.length; i++) for (let j = i + 1; j < qs.length; j++) {
      const cov = new Set([...sepOf(qs[i]), ...sepOf(qs[j])])
      if (cov.size === allPairs.length) { chosen = [qs[i], qs[j]]; break outer }
    }
    if (!chosen) throw new Error('no pair of questions separates all three pairs')
    return {
      questions: DISPUTED.map(d => ({ q: d.q, separates: sepOf(d.q) })),
      answeredCount: Object.fromEntries(CAST.map(T => [T, qs.filter(q => say(T, q) !== null).length])),
      chosen,
      rows: chosen.map(q => ({
        q,
        answers: [...new Set(CAST.map(T => say(T, q)).filter(v => v !== null))]
          .map(v => ({ value: v, who: CAST.filter(T => say(T, q) === v) })),
        silent: CAST.filter(T => say(T, q) === null),
      })),
    }
  })(),
  objective: Object.fromEntries(CAST.map(T => {
    const dims = DIM_NAMES[T]
    const fc = features(T, sol[T].pick.g), fu = features(T, solU[T].pick.g)
    return [T, {
      dims,
      constrained: dims.map(d => fc[d]),
      unconstrained: dims.map(d => fu[d]),
      ceiling: dims.map(d => Math.max(...pool.map(r => features(T, r.g)[d]))),
      u: Math.round(100 * U[T](fc)),
      uUnconstrained: Math.round(100 * U[T](fu)),
      tiedAtOptimum: sol[T].tied,
    }]
  })),
}, null, 1))
