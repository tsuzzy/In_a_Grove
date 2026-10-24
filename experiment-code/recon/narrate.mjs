// THE INNER MONOLOGUE — the only file in this build that talks to a model.
//
// A witness's deliberation is already computed on every move and thrown away: for each
// account still open, the solver scores how far it flatters them, how far the other two back
// it, how far it strays from their own opening, and what a previous refutation has left of
// their standing. `explain` mode in hearing-core keeps that. This turns it into something
// readable.
//
// TWO RENDERERS, and the order matters:
//
//   renderTemplate   deterministic, offline, no network. Not a fallback in the sense of
//                    being second-best — it is what the tests run on (no key in CI), what
//                    the page uses when the proxy is not there, and the standing
//                    demonstration that no language model computes anything here. Turn the
//                    model off and the page still works; that is the point.
//
//   renderLLM        the same deliberation, in the witness's own voice. commit-then-render,
//                    extended from testimony to thought: the decision is already made and
//                    the numbers are already fixed before a single word is generated.
//
// THE RED LINES, stated in the prompt and enforced on the way back:
//   * rewrite only the deliberation supplied — invent no account, name no option that was
//     not given, alter no number;
//   * never mention utilities, scores, credibility, the file as a "file", or that anything
//     was computed;
//   * a response that names an account outside the supplied set is DISCARDED and the
//     template is used instead. The model does not get to add candidates.
//
// Numbers are never taken from the model. The page renders them beside the prose straight
// from the solver, narrated or not.

const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.cerebras.ai/v1'
const MODEL = process.env.OPENAI_MODEL || 'zai-glm-4.7'
const KEYS = [process.env.OPENAI_API_KEY, process.env.OPENAI_API_KEY_2, process.env.OPENAI_API_KEY_3, process.env.OPENAI_API_KEY_4].filter(Boolean)
let keyIdx = 0

export const hasKey = () => KEYS.length > 0

const VOICE = {
  Tajomaru: 'the captured bandit — vain about being taken for a warrior rather than an ambusher',
  Masago: "the samurai's wife — unable to bear being looked at with contempt",
  Takehiro: 'the dead samurai, speaking through a medium — humiliated at having been bound and made to watch',
}

import { renderTemplate, narrateTemplate, nameOf } from './narrate-template.mjs'
export { renderTemplate, narrateTemplate }

// ---------------------------------------------------------------- the model
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// The last error, so a failure is diagnosable instead of silently becoming a template.
// The first version swallowed everything, and a `reasoning_effort` the provider rejected
// looked exactly like having no key at all.
export let lastError = null

async function callLLM(messages, { maxTokens = 400, temperature = 0.85 } = {}) {
  let tries = 0, rateHits = 0
  while (tries < 2 && rateHits < 6) {
    const key = KEYS[keyIdx % KEYS.length]
    try {
      const body = { model: MODEL, messages, max_tokens: maxTokens, temperature }
      // Only sent when explicitly asked for: Cerebras accepts it, Groq's llama models reject
      // the request outright with a 400. Provider-specific knobs do not belong in a default.
      if (process.env.OPENAI_REASONING_EFFORT) body.reasoning_effort = process.env.OPENAI_REASONING_EFFORT
      if (process.env.OPENAI_JSON_MODE !== 'off') body.response_format = { type: 'json_object' }
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      })
      if (res.status === 429) { rateHits++; keyIdx++; await sleep(1500); continue }
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status} ${detail.slice(0, 200)}`)
      }
      lastError = null
      return (await res.json()).choices?.[0]?.message?.content || ''
    } catch (e) {
      lastError = e.message || String(e)
      tries++
      if (tries >= 2) return null
      await sleep(800)
    }
  }
  return null
}

/** the deliberation, reduced to what the model is allowed to see */
function brief(moves, ctx) {
  return moves.map((m, i) => {
    const d = m.deliberation || {}
    return {
      i,
      moment: m.act === 'refuted' ? 'what_i_said_was_destroyed'
        : m.act === 'revise' ? 'changed_what_i_say'
          : m.act === 'open' ? 'spoke_first'
            : 'kept_silent_and_did_not_move',
      i_now_say: nameOf(m.toLabel),
      i_was_saying: m.fromLabel ? nameOf(m.fromLabel) : null,
      others_agreeing_with_me: m.corroborates,
      others_contradicting_me: m.contradicts,
      // ranked purely so the voice can reflect a trade-off it was actually offered
      what_else_i_could_say: (d.alternatives || []).map(a => nameOf(a.label)),
      what_the_evidence_took_from_me: (d.deleted || []).slice(0, 3).map(a => nameOf(a.label)),
      the_best_thing_i_lost: d.lostBest ? nameOf(d.lostBest.label) : null,
      it_suits_me_better_than_what_i_now_say: d.lostBest && d.chosen ? d.lostBest.total > d.chosen.total : null,
      i_gave_up_something_to_be_believed: (m.gainSelf ?? 0) < 0,
      i_have_been_caught_out_before: (m.refutations ?? 0) > 1 || m.standing < 100,
    }
  })
}

/** the set of account names the model is permitted to mention */
function allowed(moves) {
  const s = new Set()
  for (const m of moves) {
    if (m.toLabel) s.add(nameOf(m.toLabel))
    if (m.fromLabel) s.add(nameOf(m.fromLabel))
    for (const a of m.deliberation?.alternatives || []) s.add(nameOf(a.label))
    for (const a of m.deliberation?.deleted || []) s.add(nameOf(a.label))
  }
  return s
}

/**
 * One witness, one evidence event. Falls back to the template on any failure, on a missing
 * key, or on a response that names an account it was not given.
 */
export async function renderLLM(witness, allMoves, ctx = {}) {
  if (!hasKey() || !allMoves.length) return { lines: narrateTemplate(allMoves, ctx), source: 'template' }
  // A witness asked three times who does not move three times has ONE thought about it. The
  // template collapses identical lines after the fact; here the repetition is removed before
  // the model ever sees it, so it is not invited to find three ways of saying "I hold firm".
  const moves = allMoves.filter((m, i) => !(m.act === 'stand' && allMoves[i - 1]?.act === 'stand'))

  const sys = `You are ${witness}, ${VOICE[witness] || 'a witness'}, testifying about a death in a bamboo grove. `
    + `You are given a numbered list of moments in your own testimony. Voice each as inner thought — first person, `
    + `present tense, restrained classical register, no melodrama.\n`
    + `WHAT EACH MOMENT MEANS, and you must not confuse them:\n`
    + `  "kept_silent_and_did_not_move" — you were asked again and saw no reason to change. This is NOT an `
    + `admission, NOT a defeat, NOT a confession. It is a man holding his ground.\n`
    + `  "changed_what_i_say" — you chose to say something else. Nobody forced you.\n`
    + `  "what_i_said_was_destroyed" — the evidence made your account impossible. Only here are you cornered.\n`
    + `  "spoke_first" — you had heard no one yet.\n`
    + `ABSOLUTE RULES: (1) speak only of the accounts named in the JSON — never invent another; `
    + `(2) never mention numbers, scores, credibility, weighing, optimisation, a "file", or anything computed; `
    + `(3) never call yourself a liar or a deceiver and never admit to deception — you are not told that you lied, `
    + `only what serves you; (4) never address anyone; this is thought, not speech; `
    + `(5) AT MOST TWO short sentences per moment, and none for moments you are not given.\n`
    + `Return JSON only: {"moments":[{"i":<the moment's number>,"lines":["...","..."]}]}, one entry per moment, in order.`

  const usr = JSON.stringify({ moments: brief(moves, ctx), evidence_just_established: ctx.factNote || null })
  const raw = await callLLM([{ role: 'system', content: sys }, { role: 'user', content: usr }])
  if (!raw) return { lines: narrateTemplate(moves, ctx), source: 'template', error: lastError }

  let parsed
  try { parsed = JSON.parse(raw) } catch { return { lines: narrateTemplate(moves, ctx), source: 'template', error: 'unparseable' } }

  // The MODEL supplies words; the SOLVER supplies structure. Which visual register a line
  // belongs to follows from what the witness actually did, and is not the model's to choose
  // — an earlier version let it pick, and it returned every line as a passing thought, so a
  // man being cornered read the same as a man standing pat.
  const kindFor = (act) => act === 'refuted' ? 'blow' : act === 'revise' ? 'say' : act === 'open' ? 'say' : 'think'
  const byMoment = Array.isArray(parsed?.moments) ? parsed.moments : null
  if (!byMoment || !byMoment.length) return { lines: narrateTemplate(moves, ctx), source: 'template', error: 'no moments returned' }

  const lines = []
  byMoment.forEach((entry, pos) => {
    // the index is the model's, and models are not reliable about zero-basing it. Fall back
    // to position, which is what the ordering was always meant to carry.
    const m = moves[entry?.i] ?? moves[pos]
    if (!m) return
    const texts = (Array.isArray(entry.lines) ? entry.lines : [entry.lines])
      .filter(t => typeof t === 'string' && t.trim().length > 3)
      .slice(0, 2)   // two per moment, whatever the model felt like producing
    texts.forEach((t, k) => lines.push({ kind: k === 0 ? kindFor(m.act) : 'think', text: t.trim(), act: m.act, round: m.round }))
  })
  if (!lines.length) return { lines: narrateTemplate(moves, ctx), source: 'template', error: 'nothing usable' }

  // The model does not get to add candidates. An earlier version checked that any line
  // naming a witness also carried a full account prefix, which was both too strict — a bare
  // "Takehiro" was flagged because his account reads "Takehiro (self) — suicide" — and too
  // weak, since it could not catch an invented manner at all. What actually needs guarding
  // is the MANNER: if the monologue speaks of a duel and no duel was on offer, it has made
  // one up.
  const offered = [...allowed(moves)].join(' ').toLowerCase()
  const MANNERS = [['duel', 'duel'], ['suicide', 'suicide'], ['took his own life', 'suicide'],
    ['own hand', 'suicide'], ['impal', 'impaling'], ['fell on', 'impaling']]
  const invented = lines.some(l => {
    const t = l.text.toLowerCase()
    return MANNERS.some(([needle, manner]) => t.includes(needle) && !offered.includes(manner))
  })
  if (invented) return { lines: narrateTemplate(moves, ctx), source: 'template', rejected: 'described a manner of death it was never offered' }

  // The mechanism never says a witness lied — it says what serves them. A monologue that
  // confesses to deception is asserting something the solver did not compute.
  if (lines.some(l => /\b(lie|lied|lying|liar|deceit|deception|deceive|deceiv\w*|falsehood)\b/i.test(l.text)))
    return { lines: narrateTemplate(moves, ctx), source: 'template', rejected: 'confessed to deception, which the model was not told' }

  return { lines, source: 'model' }
}
