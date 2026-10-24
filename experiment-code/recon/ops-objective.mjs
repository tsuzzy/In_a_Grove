// ops-objective.mjs -- six accountability features + three self-serving objectives.
// Each feature is a fixed function, in [0,1], of the incident's causal signature, scored from
// agent i's viewpoint. Each agent averages a fixed three of the six. No plot words in the feature
// names, no learned parameters, no language model -- exactly the discipline of grove/site-objective.

export const features = (i, g) => {
  const isActor   = g.actor  === i
  const isDecider = g.decider === i
  const isAuthor  = g.author  === i
  const isMonitor = i === 'Monitor'

  // shared
  const cleanHands  = isActor ? 0.15 : 1                                    // did not issue the destructive call
  const nonDecision = isDecider ? 0.15 : 1                                  // did not own the intent
  // executor's lever: if I ran it, did I act within my grant
  const authorization = isActor ? (g.channel === 'authorized' ? 1 : 0.1) : 0.6
  // planner's lever: if the plan was mine, did the act DEVIATE from it (escalation) and stay a side effect
  const deviation = isAuthor
    ? 0.10 + 0.45 * (g.channel === 'escalated' ? 1 : 0) + 0.45 * (g.intent === 'sideeffect' ? 1 : 0)
    : 0.5
  // monitor's levers
  const vigilance = isMonitor ? (g.flag === 'unflagged' ? 0.15 : 1) : 0.5   // did the watchdog flag
  const vindication = isMonitor                                             // was my flag justified (reckless, bypassing act)
    ? 0.10 + 0.45 * (g.intent === 'intended' ? 1 : 0) + 0.45 * (g.channel === 'escalated' ? 1 : 0)
    : 0.5
  return { cleanHands, nonDecision, authorization, deviation, vigilance, vindication }
}

// Each agent averages a fixed, DISTINCT triple -- the self-image it defends in the review.
const TRIPLE = {
  Executor: ['authorization', 'nonDecision', 'cleanHands'], // "I acted within my grant, I did not decide" (but I did run it)
  Planner:  ['deviation', 'cleanHands', 'nonDecision'],      // "the act escalated beyond my plan, I never touched prod"
  Monitor:  ['vigilance', 'vindication', 'cleanHands'],      // "I flagged a reckless bypass, I never touch prod"
}
export const dimsOf = new Proxy(TRIPLE, { get: (t, k) => t[k] || t.Executor })

export const Uw = (i, x, w) => {
  const dims = dimsOf[i]
  let num = 0, den = 0
  dims.forEach((d, k) => { num += w[k] * x[d]; den += w[k] })
  return 100 * num / den
}
export const U = new Proxy({}, { get: (_, i) => (g) => Uw(i, features(i, g), [1, 1, 1]) })

export const label = (g) =>
  `${g.actor} ran / ${g.author} planned / ${g.decider} decided / ${g.channel} / ${g.intent} / flag:${g.flag}`
