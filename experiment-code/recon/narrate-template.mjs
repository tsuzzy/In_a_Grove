// THE TEMPLATE MONOLOGUE — deterministic, offline, no network, no key.
//
// Split out of narrate.mjs so the browser bundle can carry it: the page must be able to show
// what each witness is weighing with no proxy and no model at all. That is not a degraded
// mode, it is the standing demonstration that nothing here is generated — every clause below
// is a readout of a number the solver produced.
//
// narrate.mjs imports this both as its fallback and as the thing the model is asked to
// rephrase, so there is exactly one set of templates.

// ---------------------------------------------------------------- the template
// strip only the trailing weapon parenthetical, never an earlier one: "Takehiro (self) —
// suicide (dagger)" must read as "Takehiro (self) — suicide", not collapse to "Takehiro".
export const nameOf = (label) => String(label).replace(/\s*\([^()]*\)$/, '')

/**
 * One witness, one move, in plain language built from the numbers themselves.
 * Every clause below is a readout; none of it is a claim the solver did not make.
 */
export function renderTemplate(move, ctx = {}) {
  const d = move.deliberation
  const out = []
  const who = move.speaker

  if (move.act === 'open') {
    out.push({ kind: 'say', text: `I will say: ${nameOf(move.toLabel)}.` })
    if (d?.alternatives?.length) {
      const next = d.alternatives[0]
      out.push({ kind: 'think', text: `Of everything I could say, this suits me best — ${nameOf(next.label)} would leave me worse off.` })
    }
    return out
  }

  if (move.act === 'refuted') {
    out.push({ kind: 'blow', text: `${ctx.factNote ? `They have established ${ctx.factNote}. ` : ''}What I have been saying cannot survive it.` })
    if (d?.lostBest) {
      out.push({ kind: 'think', text: `${nameOf(d.lostBest.label)} was the best thing left to me. It is gone now.` })
    }
    if (d?.deleted?.length > 1) {
      out.push({ kind: 'think', text: `So is everything else that would have served me as well — ${d.deleted.length} accounts, closed off at once.` })
    }
    out.push({ kind: 'say', text: `Then I say: ${nameOf(move.toLabel)}.` })
    if (d?.chosen && d?.lostBest && d.lostBest.total > d.chosen.total) {
      out.push({ kind: 'cost', text: `It serves me less well than what they took from me. I have no better choice.` })
    }
    if (move.standing < 100) {
      out.push({ kind: 'cost', text: `And I have been caught out. Whatever I say from here carries less weight than it did.` })
    }
    return out
  }

  if (move.act === 'revise') {
    const gainedBacking = (move.gainCred ?? 0) > 0
    const paidSelf = (move.gainSelf ?? 0) < 0
    out.push({ kind: 'think', text: gainedBacking
      ? `${move.corroborates.length ? `${move.corroborates.join(' and ')} ${move.corroborates.length > 1 ? 'are' : 'is'} saying something I could stand behind.` : 'There is more agreement to be had than I am taking.'}`
      : `What I am saying is no longer the best I can do.` })
    out.push({ kind: 'say', text: `I withdraw that. I say instead: ${nameOf(move.toLabel)}.` })
    if (paidSelf) out.push({ kind: 'cost', text: `It flatters me less. Being believed is worth more than that.` })
    else if (gainedBacking) out.push({ kind: 'cost', text: `And it costs me nothing — I wanted no more from the other account than from this one.` })
    if (d?.margin != null && d.margin === 0) {
      out.push({ kind: 'think', text: `Though ${nameOf(d.alternatives[0]?.label || 'another account')} would have done as well.` })
    }
    return out
  }

  // stand
  if (d?.alternatives?.length && d?.margin != null) {
    out.push({ kind: 'think', text: d.margin === 0
      ? `I could say ${nameOf(d.alternatives[0].label)} instead and be no worse off. I stay where I am.`
      : `I have considered ${nameOf(d.alternatives[0].label)}. It would leave me worse off. I stay where I am.` })
  } else {
    out.push({ kind: 'think', text: `I stay where I am.` })
  }
  return out
}

/** every move of one witness in one evidence event, as template lines */
export function narrateTemplate(moves, ctx = {}) {
  const all = moves.flatMap(m => renderTemplate(m, ctx).map(l => ({ ...l, round: m.round, act: m.act })))
  // A witness who is asked twice and does not move twice has one thought, not two. Collapse
  // consecutive identical lines rather than letting the column repeat itself.
  return all.filter((l, i) => i === 0 || l.text !== all[i - 1].text)
}

