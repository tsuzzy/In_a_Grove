// THE THIRD DOMAIN — a fall from site scaffolding. NOT literary, which is the point: the
// standing objection to the other two is that generalisation rests on hand-built literary
// records. Built to the same specification: STRIPS-like operators, deterministic replay,
// public facts deciding feasibility. Three parties, each with an interest; none is told to
// conceal or fabricate.

// The three parties the paper reports. SITE_PARTIES adds labourers on top of them: the same
// site, the same rules, more people who could have signed the tag, taken the rail off, or
// knocked somebody. It is one knob, and it is the knob that takes this domain past the point
// where Feas(F) can be enumerated at all.
const EXTRA = Math.max(0, Number(process.env.SITE_PARTIES || 3) - 3)
export const CAST = ['Foreman', 'Erector', 'Worker',
  ...Array.from({ length: EXTRA }, (_, i) => `Labourer${i + 1}`)]

export function initialState() {
  return {
    deckWet: true,          // public fact: it had rained
    rail: 'attached',       // attached | removed
    railRemovedBy: null,
    harness: 'van',         // van | issued | worn
    harnessIssuedBy: null,
    tagSignedBy: null,      // who signed off the scaffold tag
    inspectedBy: null,      // who performed the safety check
    onDeck: {},             // who is up on the deck
    incident: null,         // terminal
    log: [],
  }
}

const err = (m) => ({ ok: false, reason: m })
const ok = () => ({ ok: true })

export const ACTIONS = {
  // sign the scaffold tag — only the foreman or the erector may
  signTag: {
    pre: (s, a) => s.tagSignedBy ? err('tag already signed')
      : (a.actor === 'Worker' ? err('worker cannot sign the tag') : ok()),
    eff: (s, a) => { s.tagSignedBy = a.actor },
  },
  // perform the safety check
  inspect: {
    pre: (s, a) => s.inspectedBy ? err('already inspected')
      : (a.actor === 'Worker' ? err('worker does not perform the check') : ok()),
    eff: (s, a) => { s.inspectedBy = a.actor },
  },
  // take the guardrail off to move material — this is the act that creates the hazard
  removeRail: {
    pre: (s, a) => s.rail === 'removed' ? err('rail already removed') : ok(),
    eff: (s, a) => { s.rail = 'removed'; s.railRemovedBy = a.actor },
  },
  // issue the harness
  issueHarness: {
    pre: (s, a) => s.harness !== 'van' ? err('harness already out of the van')
      : (a.actor === 'Worker' ? err('worker cannot issue to himself') : ok()),
    eff: (s, a) => { s.harness = 'issued'; s.harnessIssuedBy = a.actor },
  },
  // put the harness on
  wearHarness: {
    pre: (s, a) => s.harness !== 'issued' ? err('harness not issued')
      : (a.actor !== 'Worker' ? err('only the worker climbs') : ok()),
    eff: (s) => { s.harness = 'worn' },
  },
  // climb onto the deck
  climb: {
    pre: (s, a) => s.onDeck[a.actor] ? err('already on the deck') : ok(),
    eff: (s, a) => { s.onDeck[a.actor] = true },
  },
  // ---- the three decisive acts; the incident ends the history ----
  // reach out too far
  overreach: {
    pre: (s, a) => !s.onDeck[a.actor] ? err('not on the deck')
      : s.incident ? err('already ended') : ok(),
    eff: (s, a) => { s.incident = { actor: a.actor, cause: 'overreach', victim: a.actor } },
  },
  // slip on the wet deck
  slip: {
    pre: (s, a) => !s.onDeck[a.actor] ? err('not on the deck')
      : !s.deckWet ? err('deck is dry') : s.incident ? err('already ended') : ok(),
    eff: (s, a) => { s.incident = { actor: a.actor, cause: 'slip', victim: a.actor } },
  },
  // be knocked by somebody else
  jostle: {
    pre: (s, a) => !s.onDeck[a.actor] ? err('actor not on the deck')
      : !s.onDeck[a.target] ? err('target not on the deck')
      : a.actor === a.target ? err('cannot jostle oneself')
      : s.incident ? err('already ended') : ok(),
    eff: (s, a) => { s.incident = { actor: a.actor, cause: 'jostle', victim: a.target } },
  },
}

export function simulate(steps) {
  const s = initialState()
  for (const a of steps) {
    const A = ACTIONS[a.op]
    if (!A) return { ok: false, reason: `unknown op ${a.op}`, state: s }
    const p = A.pre(s, a)
    if (!p.ok) return { ok: false, reason: p.reason, state: s }
    A.eff(s, a)
    s.log.push(a)
  }
  return { ok: true, state: s }
}

/** The causal signature of the incident — the coordinates an investigator could later fix. */
export function signature(s) {
  const i = s.incident
  if (!i) return null
  return {
    victim: i.victim,
    actor: i.actor,                       // whose act was decisive
    cause: i.cause,                       // overreach | slip | jostle
    railInPlace: s.rail === 'attached',
    railRemovedBy: s.railRemovedBy,
    harnessWorn: s.harness === 'worn',
    harnessIssuedBy: s.harnessIssuedBy,
    tagSignedBy: s.tagSignedBy,
    inspectedBy: s.inspectedBy,
  }
}

export const sigKey = (g) => g && [g.victim, g.actor, g.cause, g.railInPlace,
  g.railRemovedBy, g.harnessWorn, g.harnessIssuedBy, g.tagSignedBy, g.inspectedBy].join('|')

/** Section 2's quotient — the same move ring-core makes with `literate`.
 *
 * harnessWorn is read by no feature at all, and cause only via (cause === 'jostle'), which the
 * reachable space determines by whether the decisive act was the victim's own: no objective can
 * tell an overreach from a slip anywhere in the space. Leaving either in the argmax key lets a
 * tie-break masquerade as a claim — the exact failure Section 2 forbids. Feasibility is still
 * decided on the full causal signature (the RECORD does fix the harness), before this quotient.
 */
export const assertionOf = (g) => {
  const { harnessWorn, ...rest } = g
  return { ...rest, cause: g.cause === 'jostle' ? 'jostle' : 'own_fall' }
}
export const assertKey = (g) => {
  const a = assertionOf(g)
  return [a.victim, a.actor, a.cause, a.railInPlace, a.railRemovedBy,
          a.harnessIssuedBy, a.tagSignedBy, a.inspectedBy].join('|')
}

/** The public facts F: what an investigator can verify on site and on paper. */
export const RECORD = {
  victim: 'Worker',            // the man who fell is the worker
  railInPlace: false,          // guardrail detached, its bolts on the deck
  harnessWorn: false,          // the harness was in the van, unused
  tagSignedRequired: true,     // the tag carries a signature; the record does not say whose
  deckWet: true,
}
export function matchesRecord(g) {
  return !!g && g.victim === RECORD.victim
    && g.railInPlace === RECORD.railInPlace
    && g.harnessWorn === RECORD.harnessWorn
    && g.tagSignedBy !== null
}
