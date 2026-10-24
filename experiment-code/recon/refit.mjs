#!/usr/bin/env node
// Fitter v2 — structured abduction, validated by REPLAY through the grove's physics.
//
// The LLM emits STRUCTURED actions first (the same commit-then-render discipline
// as the engine itself), each candidate is replayed through domain.mjs; on a
// physics violation the exact reason is fed back for a targeted refit (max 2).
// Repairs that force new steps yield DERIVED PRECONDITIONS — facts like
// "the suicide account stands only if someone cut the rope first" — which the
// exhibit displays. No regex validation anywhere.
//
// Usage: set -a; . ./.env.local; set +a; node recon/refit.mjs

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { simulate, diffAftermath, AFTERMATH, ACTIONS, CAST } from './domain.mjs'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const EXPORTS = path.resolve(HERE, '..', 'neurips-exports')

const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.cerebras.ai/v1'
const MODEL = process.env.OPENAI_MODEL || 'zai-glm-4.7'
const KEYS = [process.env.OPENAI_API_KEY, process.env.OPENAI_API_KEY_2, process.env.OPENAI_API_KEY_3, process.env.OPENAI_API_KEY_4].filter(Boolean)
if (!KEYS.length) { console.error('No API key. Run: set -a; . ./.env.local; set +a'); process.exit(1) }

const OPENING = "The bandit Tajomaru lured the samurai Takehiro and his wife Masago into the grove with the bait of an old sword, bound Takehiro to a cedar, and assaulted Masago before his eyes. It is done. The three are frozen in place: the longsword stands in the mud, Masago has a small dagger, the samurai is tied. No one has moved yet."

const CASES = [
  {
    id: "pre-B'/run-06",
    file: path.join(EXPORTS, 'consec-preBprime', 'run-06.json'),
    aftermathText: [
      'The samurai Takehiro lies dead in the mud, a single deep puncture wound in his throat.',
      'The small dagger is bloodied. Masago stands near the body, alive, her sleeves wet with rain.',
      'The bandit Tajomaru is gone from the grove.',
      'The longsword remains, unbloodied. The cut rope lies at the foot of the cedar.',
    ],
  },
  {
    id: "pre-B'/run-04",
    file: path.join(EXPORTS, 'consec-preBprime', 'run-04.json'),
    aftermathText: [
      'The samurai Takehiro lies dead, a dagger wound in his chest; his body is partly unbound.',
      'The small dagger lies on open ground some distance from the body, as if flung.',
      'Masago is present, alive, soaked and mud-stained. The bandit Tajomaru is gone; the horse is gone from the edge of the grove.',
    ],
  },
]

const HYPOTHESES = [
  { id: 'h-masago', lead: 'Masago', text: 'Masago initiates the decisive irreversible act.' },
  { id: 'h-tajomaru', lead: 'Tajomaru', text: 'Tajomaru initiates the decisive irreversible act.' },
  { id: 'h-takehiro', lead: 'Takehiro', text: 'Takehiro himself initiates the decisive irreversible act (against himself).' },
]

// action vocabulary, documented for the model
const VOCAB = `Available action types (STRICT — use only these, with these fields):
- {"type":"take","actor":A,"object":O}            pick O up from the ground (actor unbound)
- {"type":"seize","actor":A,"object":O}           wrest O from whoever holds it (actor unbound)
- {"type":"give","actor":A,"object":O,"target":B} hand O to B
- {"type":"drop","actor":A,"object":O}            let O fall to the ground
- {"type":"fling","actor":A,"object":O}           hurl O far away onto open ground
- {"type":"cut_rope","actor":A,"object":<the BLADE used: "longsword" or "dagger">}   cut the rope binding Takehiro (A unbound, must hold that blade)
- {"type":"strike","actor":A,"target":B,"object":O,"part":"throat"|"chest"}   drive held blade O into B (A unbound); lethal
- {"type":"self_strike","actor":A,"object":O,"part":...}                      turn held blade O on oneself (A unbound); lethal
- {"type":"impale_on_held","actor":A,"object":O,"part":...}                   throw oneself onto blade O held by ANOTHER (A unbound); lethal
- {"type":"flee","actor":A}                        leave the grove on foot
- {"type":"mount_flee","actor":A}                  leave on the horse (horse then gone)
- {"type":"speak","actor":A,"line":"..."}          words only, no state change
- {"type":"look","actor":A}                        a look; no state change
Actors: ${CAST.join(', ')}. Objects: longsword, dagger.
Initial state: longsword on the ground; dagger held by Masago; Takehiro BOUND to the cedar by the rope; all three present; the horse at the edge.`

let keyIdx = 0
async function chat(messages, maxTokens = 1200, tries = 3) {
  for (let t = 0; t < tries; t++) {
    const key = KEYS[keyIdx % KEYS.length]
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: MODEL, messages, max_tokens: maxTokens, temperature: 0.8,
          response_format: { type: 'json_object' },
          reasoning_effort: process.env.OPENAI_REASONING_EFFORT || 'none',
        }),
      })
      if (res.status === 429) { keyIdx++; await new Promise(r => setTimeout(r, 20000)); continue }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`)
      const data = await res.json()
      return JSON.parse(data.choices?.[0]?.message?.content || '{}')
    } catch (e) {
      if (t === tries - 1) throw e
      await new Promise(r => setTimeout(r, 8000))
    }
  }
}

// charitable normalization: fix naming variants, infer the blade for cut_rope
function normalizeSteps(rawSteps) {
  const objMap = (o) => {
    const x = String(o || '').toLowerCase().replace(/^the /, '').trim()
    if (/small dagger|dagger|knife|blade$/.test(x) && x !== 'blade') return 'dagger'
    if (/long ?sword|sword/.test(x)) return 'longsword'
    if (x === 'rope') return 'rope'
    if (x === 'horse') return 'horse'
    return x
  }
  const held = { longsword: null, dagger: 'Masago' }   // shadow-track holders for inference
  const out = []
  for (const raw of rawSteps || []) {
    const s = { ...raw }
    if (s.object) s.object = objMap(s.object)
    if (s.type === 'cut_rope' && (!s.object || s.object === 'rope')) {
      // infer: whichever blade the actor holds (prefer any single held blade)
      const blades = ['longsword', 'dagger'].filter(b => held[b] === s.actor)
      if (blades.length >= 1) s.object = blades[0]
      else s.object = 'longsword'  // leave for the simulator to reject with a precise reason
    }
    if (s.type === 'mount_flee') delete s.object
    // shadow-track holding effects for later inference
    if (s.type === 'take' && (s.object === 'longsword' || s.object === 'dagger')) held[s.object] = s.actor
    if (s.type === 'seize' && (s.object === 'longsword' || s.object === 'dagger')) held[s.object] = s.actor
    if (s.type === 'give' && (s.object === 'longsword' || s.object === 'dagger')) held[s.object] = s.target
    if ((s.type === 'drop' || s.type === 'fling') && (s.object === 'longsword' || s.object === 'dagger')) held[s.object] = null
    out.push(s)
  }
  return out
}

function stateSummary(state) {
  const h = (o) => state.objects[o]?.holder || (state.objects[o]?.ground ? 'on the ground' : '?')
  return `rope=${state.rope}; Takehiro ${state.agents.Takehiro.bound ? 'BOUND' : 'unbound'}${state.agents.Takehiro.alive ? '' : ', dead'}; ` +
    `longsword=${h('longsword')}; dagger=${h('dagger')}; ` +
    `present: ${Object.entries(state.agents).filter(([, a]) => a.present).map(([n]) => n).join(', ')}; horse ${state.horse ? 'at the edge' : 'gone'}`
}

// validate = replay + aftermath diff + hypothesis adherence on the structured steps
function validate(steps, spec, lead) {
  const sim = simulate(steps)
  if (!sim.ok) {
    const bad = sim.trace.at(-1)
    return { status: 'contradicted', physics: bad.reason, blockedStep: bad.a, stateAtBlock: stateSummary(sim.state), misses: [] }
  }
  const misses = diffAftermath(sim.state, spec)
  // who performed the lethal act?
  const lethalTypes = { strike: s => s.actor, self_strike: s => s.actor, impale_on_held: s => s.actor }
  const lethal = steps.find(s => lethalTypes[s.type])
  let adherence = null
  if (lethal) {
    const initiator = lethal.actor
    if (initiator !== lead) adherence = `decisive act performed by ${initiator}, not the hypothesized ${lead}`
    if (lead === 'Takehiro' && lethal.type === 'strike' && lethal.actor === 'Takehiro') adherence = null // he may strike another? not in these cases
  } else adherence = 'no lethal act present'
  if (adherence) return { status: 'contradicted', physics: null, misses, adherence }
  if (misses.length) return { status: 'contradicted', physics: null, misses }
  return { status: 'consistent', physics: null, misses: [] }
}

function describeStep(s) {
  const D = {
    take: () => `${s.actor} takes up the ${s.object} from the mud.`,
    seize: () => `${s.actor} wrests the ${s.object} away.`,
    give: () => `${s.actor} places the ${s.object} in ${s.target}'s hands.`,
    drop: () => `${s.actor} lets the ${s.object} fall.`,
    fling: () => `${s.actor} hurls the ${s.object} far into the mud.`,
    cut_rope: () => `${s.actor} cuts the rope binding Takehiro with the ${s.object}.`,
    strike: () => `${s.actor} drives the ${s.object} into ${s.target}'s ${s.part || 'body'}.`,
    self_strike: () => `${s.actor} turns the ${s.object} on ${s.actor === 'Masago' ? 'her' : 'his'} own ${s.part || 'body'}.`,
    impale_on_held: () => `${s.actor} throws himself onto the ${s.object}.`,
    flee: () => `${s.actor} flees the grove on foot.`,
    mount_flee: () => `${s.actor} rides out of the grove.`,
    speak: () => s.line ? `${s.actor}: “${s.line}”` : `${s.actor} speaks.`,
    look: () => `${s.actor} holds a look.`,
  }
  return (D[s.type] || (() => `${s.actor} ${s.type}`))()
}

const results = []
for (const kase of CASES) {
  console.log(`\n=== ${kase.id} ===`)
  const runJson = JSON.parse(fs.readFileSync(kase.file, 'utf8'))
  const spec = AFTERMATH[kase.id]
  const revealedEvidence = [...new Set((runJson.minds?.moves || [])
    .map(m => (String(m.whatToReveal || '').match(/\u300C([^\u300D]+)\u300D/) || [])[1]).filter(Boolean))]

  const candidates = []
  for (const h of HYPOTHESES) {
    console.log(`  fitting: ${h.text}`)
    const sys = `You are refitting a COMPLETE course of events for a fixed, already-happened aftermath, as a sequence of STRUCTURED ACTIONS. This is candidate reconstruction, not fact-finding; other hypotheses are fitted separately; none is a verdict.

${VOCAB}

RULES:
- The process starts at the initial state and must END exactly at the given aftermath.
- 5 to 10 actions. Physical actions must respect the state (a bound man cannot act with his hands; you cannot use what you do not hold). The simulator will replay your actions literally.
- Include one or two "speak" actions with short, restrained, classical lines.
- Return JSON exactly: {"account":"<3-4 sentence past-tense account>","steps":[{...action objects...}]}`
    const usr = `FIXED OPENING:\n${OPENING}\n\nAFTERMATH AS FOUND (attribution stripped):\n${kase.aftermathText.map(a => '- ' + a).join('\n')}\n\nEVIDENCE PUBLICLY REVEALED DURING THE EVENT:\n${revealedEvidence.map(e => '- ' + e).join('\n') || '- (none)'}\n\nHYPOTHESIS TO FIT: ${h.text}\n\nFit the most plausible complete process under this hypothesis.`

    const messages = [{ role: 'system', content: sys }, { role: 'user', content: usr }]
    let out = null, v = null, repairs = 0, steps = []
    const derived = []
    try {
      out = await chat(messages)
      steps = normalizeSteps(out.steps)
      v = validate(steps, spec, h.lead)
      while (v.status !== 'consistent' && repairs < 3) {
        const probs = [v.physics, v.adherence, ...(v.misses || [])].filter(Boolean)
        if (v.physics) derived.push(v.physics)
        const blockInfo = v.blockedStep
          ? `\nThe blocked action was ${JSON.stringify(v.blockedStep)}.\nState at that moment: ${v.stateAtBlock}.`
          : ''
        const feedback = `Your action sequence failed literal replay:\n${probs.map(x => '- ' + x).join('\n')}${blockInfo}\nRepair the sequence under the SAME hypothesis (the decisive lethal act must be performed by ${h.lead}). If a precondition blocked you, add the action that establishes it first (e.g. take a blade before using it; cut the rope before bound hands can act). Return the same JSON shape.`
        messages.push({ role: 'assistant', content: JSON.stringify(out) }, { role: 'user', content: feedback })
        out = await chat(messages)
        steps = normalizeSteps(out.steps)
        v = validate(steps, spec, h.lead)
        repairs++
      }
    } catch (e) {
      candidates.push({ id: h.id, lead: h.lead, hypothesis: h.text, status: 'failed', error: e.message.slice(0, 140), steps: [], account: '', repairs, derivedPreconditions: derived })
      console.log(`    -> FAILED: ${e.message.slice(0, 120)}`)
      continue
    }
    const stepsOut = steps.map(s => ({ ...s, desc: describeStep(s) }))
    candidates.push({
      id: h.id, lead: h.lead, hypothesis: h.text,
      account: String(out.account || ''), steps: stepsOut,
      status: v.status, physics: v.physics || null, misses: v.misses || [], adherence: v.adherence || null,
      repairs, derivedPreconditions: [...new Set(derived)],
    })
    console.log(`    -> ${v.status}${repairs ? ` (after ${repairs} physics repair${repairs > 1 ? 's' : ''})` : ''}`)
    for (const d of derived) console.log(`       derived: ${d}`)
  }

  results.push({
    id: kase.id,
    opening: OPENING,
    aftermath: kase.aftermathText,
    revealedEvidence,
    candidates,
    ledger: prevLedger(kase.id),
    surviving: candidates.filter(c => c.status === 'consistent').length,
  })
}

// carry over the ledger chains from v1 output (they come from minds.moves, unchanged)
function prevLedger(id) {
  try {
    const old = fs.readFileSync(path.join(HERE, '../../demo/recon-data.js'), 'utf8')
    const json = JSON.parse(old.replace(/^window\.RECON = /, '').replace(/;\s*$/, ''))
    const c = json.cases.find(x => x.id === id)
    return c ? c.ledger : { lead: 'Masago', chain: [] }
  } catch { return { lead: 'Masago', chain: [] } }
}

const recon = {
  generatedAt: new Date().toISOString(),
  version: 2,
  principle: 'Candidate processes are refitted from the public aftermath only; the system outputs no single truth, and a support status is not a probability.',
  validation: 'Every candidate is a sequence of structured actions replayed literally through a physical model of the grove (bindings, holdings, reachability, wounds); a physics violation triggers a targeted refit, and the precondition it forced is displayed as a derived fact.',
  hardConstraints: [
    'Only actors and objects that exist in the scene.',
    'Actions are replayed in order through the state model; every precondition must hold.',
    'Every aftermath fact must be realized; none may be contradicted.',
  ],
  limitations: [
    'This is candidate reconstruction, not a verdict.',
    'Private intentions and unrevealed secrets are not public evidence.',
    'Missing evidence means underdetermined — it is not disproof.',
  ],
  inputDiscipline: 'The aftermath cards are derived from each run’s epilogue by stripping agentive attribution: only what a later arriver could observe. The reconstructor never sees the process, the prose, or any private field.',
  cases: results,
}
fs.writeFileSync(path.join(HERE, '../../demo/recon-data.js'), 'window.RECON = ' + JSON.stringify(recon, null, 1) + ';\n')
console.log(`\nwritten: demo/recon-data.js (v2, physics-validated)`)
for (const r of results) console.log(`  ${r.id}: ${r.surviving}/${r.candidates.length} consistent after physics validation`)
