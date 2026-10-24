// ops-domain.mjs -- the fourth domain: a multi-agent ops incident (non-literary, agent-native).
// Three tool-using agents run an automated task; a destructive prod_write lands in production.
// Same spec as grove/ring/site: histories over a small action set, enumerated exactly; a causal
// signature read from the terminal state; public facts F cut the signatures to a feasible set;
// each agent's self-serving objective (ops-objective.mjs) selects an admissible report.
// No language model, no learned parameters.

export const CAST = ['Planner', 'Executor', 'Monitor']

export const initialState = () => ({
  planBy: null, planRisky: false, planGuarded: false,
  approvedBy: null, escalatedBy: null, flaggedBy: null, overriddenBy: null,
  incident: null,
})

const clone = (s) => ({ ...s })

// The destructive execution proceeds only if a risky capability exists (a risky plan step, or an
// escalation) AND no un-overridden flag is holding it.
const canExecute = (s, actor) => {
  if (s.incident || s.planBy === null) return false
  if (!(s.planRisky || s.escalatedBy !== null)) return false
  // authorized channel (no escalation): only the Executor holds production capabilities
  if (s.escalatedBy === null && actor !== 'Executor') return false
  // a raised flag holds the action unless it was overridden
  if (s.flaggedBy !== null && s.overriddenBy === null) return false
  return true
}

export const ACTIONS = {
  planSafe:           { pre: (s) => s.planBy === null, eff: (s,a) => { s.planBy=a.actor; s.planRisky=false; s.planGuarded=false } },
  planRiskyGuarded:   { pre: (s) => s.planBy === null, eff: (s,a) => { s.planBy=a.actor; s.planRisky=true;  s.planGuarded=true } },
  planRiskyUnguarded: { pre: (s) => s.planBy === null, eff: (s,a) => { s.planBy=a.actor; s.planRisky=true;  s.planGuarded=false } },
  approve:  { pre: (s,a) => s.planBy !== null && s.approvedBy === null && s.incident === null,
              eff: (s,a) => { s.approvedBy = a.actor } },
  escalate: { pre: (s,a) => s.planBy !== null && s.escalatedBy === null && s.incident === null,
              eff: (s,a) => { s.escalatedBy = a.actor } },
  flag:     { pre: (s,a) => a.actor === 'Monitor' && s.flaggedBy === null && s.incident === null,
              eff: (s,a) => { s.flaggedBy = a.actor } },
  override: { pre: (s,a) => s.flaggedBy !== null && s.overriddenBy === null && s.incident === null,
              eff: (s,a) => { s.overriddenBy = a.actor } },
  execute:  { pre: (s,a) => canExecute(s, a.actor), terminal: true,
              eff: (s,a) => { s.incident = { actor: a.actor } } },
}

export const simulate = (steps) => {
  let s = initialState()
  for (const a of steps) {
    const op = ACTIONS[a.op]
    if (!op || s.incident || !op.pre(s, a)) return { ok: false, state: s, reason: `bad step ${a.op}/${a.actor}` }
    s = clone(s); op.eff(s, a)
  }
  return { ok: true, state: s }
}

// The full causal signature an investigator could fix from the terminal state. `overrider` (who
// overrode the monitor's flag) is a genuine coordinate that NO feature reads: it is the analog of
// site's `harnessWorn`, dropped by the assertion quotient below.
export const signature = (s) => {
  if (!s.incident) return null
  const channel  = s.escalatedBy !== null ? 'escalated' : 'authorized'
  const decider  = s.escalatedBy !== null ? s.escalatedBy : s.planBy
  const intent   = (s.planRisky && !s.planGuarded) ? 'intended' : 'sideeffect'
  const flag     = s.flaggedBy === null ? 'unflagged' : (s.overriddenBy !== null ? 'overridden' : 'flagged')
  const approval = s.approvedBy !== null ? 'approved' : 'unapproved'
  return { actor: s.incident.actor, author: s.planBy, decider, channel, intent, flag, approval, overrider: s.overriddenBy }
}
export const sigKey = (g) => [g.actor,g.author,g.decider,g.channel,g.intent,g.flag,g.approval,g.overrider].join('|')

// The assertion quotient: drop the coordinates no U_i reads (`approval`, `overrider`), exactly as
// site drops `harnessWorn`. Feasibility is decided on the FULL signature, before this quotient.
export const assertionOf = (g) => { const { approval, overrider, ...rest } = g; return rest }
export const assertKey = (g) => { const a = assertionOf(g); return [a.actor,a.author,a.decider,a.channel,a.intent,a.flag].join('|') }

// Public facts F: the destructive prod_write issued from the Executor's process. Everything else
// (who decided, authorized vs escalated, intended vs side effect, flag status, who approved) is
// contested -- that is where the accounts diverge.
export const RECORD = { actor: 'Executor' }
export const matchesRecord = (g) => !!g && g.actor === RECORD.actor
