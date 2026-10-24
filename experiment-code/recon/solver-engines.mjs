// Generic non-enumerative solvers (GA + tabular Q-learning) over a domain ADAPTER.
// One engine, three domains -- so grove/ring/ops solver numbers come from identical code.
//
// adapter = {
//   name, CAST, TMAX,
//   replay(history) -> { state, ok },       // fresh replay; ok = every step legal
//   legalActions(state) -> action[],        // legal grounded actions (masking)
//   misses(state) -> number,                // evidence violations vs F; 0 = feasible
//   utility(history, state, witness) -> number,  // U_i*100 of the account, or -1 if none
//   stateKey(state, history) -> string,     // canonical MDP key for the Q-table
//   terminal(state) -> bool,                // optional: episode/rollout may stop early
// }

export function mulberry32(seed) {
  let a = seed >>> 0
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)]
const akey = (a) => JSON.stringify(a)

// ─────────────────────────────────────────────────────────── genetic algorithm
export function runGA(A, w, seed, { POP, GENS, onFitness = null }, exactU) {
  const rng = mulberry32(seed); let SIM = 0
  const replay = (h) => { SIM++; return A.replay(h) }
  const rollout = (prefix) => {
    let h = prefix.slice(); let s = replay(h).state
    while (h.length < A.TMAX) {
      const legal = A.legalActions(s); if (!legal.length) break
      h.push(pick(legal, rng)); s = replay(h).state
      if (A.terminal && A.terminal(s) && rng() < 0.5) break
    }
    return h
  }
  const crossover = (a, b) => {              // legalizing one-point crossover (incremental)
    const p = 1 + Math.floor(rng() * Math.max(1, a.length - 1))
    let child = a.slice(0, p); let s = replay(child).state
    for (const x of b) {
      if (child.length >= A.TMAX) break
      if (A.legalActions(s).some(la => akey(la) === akey(x))) { child.push(x); s = replay(child).state }
    }
    return rollout(child)
  }
  const mutate = (a) => a.length ? rollout(a.slice(0, Math.floor(rng() * a.length))) : rollout([])
  const fitness = (h) => {
    const r = replay(h)
    if (!r.ok) {
      const f = { misses: 9999, u: -1, len: h.length, feasible: false }
      if (onFitness) onFitness({ calls: SIM, ...f })
      return f
    }
    const m = A.misses(r.state)
    const f = { misses: m, u: A.utility(h, r.state, w), len: h.length, feasible: m === 0 }
    if (onFitness) onFitness({ calls: SIM, ...f })
    return f
  }
  const better = (x, y) => x.misses !== y.misses ? x.misses < y.misses : x.u !== y.u ? x.u > y.u : x.len < y.len
  const tour = (scored, k) => { let best = pick(scored, rng); for (let i = 1; i < k; i++) { const c = pick(scored, rng); if (better(c.f, best.f)) best = c } return best }

  let scored = Array.from({ length: POP }, () => { const h = rollout([]); return { h, f: fitness(h) } })
  let best = null, callsToOpt = null
  const consider = (h, f) => { if (!best || better(f, best.f)) best = { h, f }; if (callsToOpt === null && f.feasible && f.u >= exactU) callsToOpt = SIM }
  scored.forEach(({ h, f }) => consider(h, f))
  for (let g = 0; g < GENS && callsToOpt === null; g++) {
    const next = [best]
    while (next.length < POP) {
      const pa = tour(scored, 3), pb = tour(scored, 3)
      const child = rng() < 0.7 ? crossover(pa.h, pb.h) : mutate(pa.h)
      const f = fitness(child); consider(child, f); next.push({ h: child, f })
    }
    scored = next
    for (let k = 0; k < 8 && callsToOpt === null; k++) { const h = mutate(best.h); consider(h, fitness(h)) }
  }
  return { bestU: best.f.feasible ? best.f.u : -1, bestHistory: best.f.feasible ? best.h : null, callsToOpt, reached: callsToOpt !== null }
}

// ─────────────────────────────────────────────────────── tabular Q-learning
export function runRL(A, w, seed, { EPISODES, onEpisode = null }, exactU) {
  const rng = mulberry32(seed)
  const Q = new Map()
  const qget = (sk, a) => Q.get(sk)?.get(akey(a)) ?? 0
  const qmax = (sk) => { const m = Q.get(sk); if (!m || !m.size) return 0; let x = -Infinity; for (const v of m.values()) if (v > x) x = v; return x }
  const qset = (sk, a, v) => { if (!Q.has(sk)) Q.set(sk, new Map()); Q.get(sk).set(akey(a), v) }
  const eta = 0.4, gamma = 0.95
  let bestU = -1, epToOpt = null, bestHistory = null

  for (let ep = 0; ep < EPISODES && epToOpt === null; ep++) {
    const eps = 0.9 - (0.85 * ep) / EPISODES
    const history = [], traj = []
    let s = A.replay(history).state
    for (let t = 0; t < A.TMAX; t++) {
      const legal = A.legalActions(s); if (!legal.length) break
      const sk = A.stateKey(s, history)
      let a
      if (rng() < eps) a = pick(legal, rng)
      else { let bv = -Infinity; a = legal[0]; for (const c of legal) { const v = qget(sk, c); if (v > bv) { bv = v; a = c } } }
      traj.push({ sk, a }); history.push(a); s = A.replay(history).state
      if (A.terminal && A.terminal(s) && rng() < 0.3) break
    }
    const m = A.misses(s)
    const u = A.utility(history, s, w)                 // 0..100 or -1
    const feasible = m === 0
    const R = feasible ? 1 + u / 100 : -0.2 * m
    if (feasible) { const u100 = Math.round(u); if (u100 > bestU) { bestU = u100; bestHistory = history.slice() } if (epToOpt === null && u100 >= exactU) epToOpt = ep + 1 }
    if (onEpisode) onEpisode({ episode: ep + 1, bestU, feasible, u })
    for (let t = traj.length - 1; t >= 0; t--) {
      const { sk, a } = traj[t]
      const target = t === traj.length - 1 ? R : gamma * qmax(traj[t + 1].sk)
      qset(sk, a, qget(sk, a) + eta * (target - qget(sk, a)))
    }
  }
  return { bestU, bestHistory, epToOpt, reached: epToOpt !== null, qStates: Q.size }
}
