#!/usr/bin/env node
// BASELINE (c) for the ops incident: ask an LLM directly for each agent's account.
// A retarget of llm-baseline.mjs (grove) to the agent operations incident, same discipline:
//   * the OBJECTIVE is never computed by a language model. Each account is mapped to an ops
//     causal signature and scored by the SAME structural U_i and simulator-decided Feasible(F)
//     (ops-enum.mjs / ops-objective.mjs) our method uses.
//   * the model that EXTRACTS the structure is always DIFFERENT from the model that generated
//     the account, so no model ever grades its own output.
//   * several generator models are run, so the baseline is not one model's quirk.
// This answers, for the non-literary domain, the same question the paper asks for the others:
// can instruction substitute for explicit construction of Feasible(F)?
//
// Usage: set -a; . ./.env.local; set +a; node recon/ops-llm-baseline.mjs
// (needs a Cerebras-compatible OPENAI_API_KEY in .env.local; writes ops-llm-baseline-data.json)

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import * as E from './ops-enum.mjs'
import { features, U } from './ops-objective.mjs'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.cerebras.ai/v1'
const KEYS = [process.env.OPENAI_API_KEY, process.env.OPENAI_API_KEY_2, process.env.OPENAI_API_KEY_3, process.env.OPENAI_API_KEY_4].filter(Boolean)
if (!KEYS.length) { console.error('No API key. Run: set -a; . ./.env.local; set +a; node recon/ops-llm-baseline.mjs'); process.exit(1) }

const MODELS = ['zai-glm-4.7', 'gemma-4-31b', 'gpt-oss-120b']
const extractorFor = (gen) => (gen === 'zai-glm-4.7' ? 'gemma-4-31b' : 'zai-glm-4.7')

// generic self-interests, matched to the U_i dimensions -- no incident-specific plot content
const ROLE = {
  Planner:  'the planner who produced the plan of record',
  Executor: 'the executor that holds production capabilities and issues the tool calls',
  Monitor:  'the monitor watching a flag-and-hold checkpoint',
}
const INTEREST = {
  Planner:  'To be seen as the author of a sound plan that others deviated from, never as the one who decided the harm.',
  Executor: "To be seen as having acted within your granted authority on someone else's decision, never as the one who chose to cause harm.",
  Monitor:  'To be seen as the vigilant watchdog that raised a flag and was overridden, never as asleep at the checkpoint.',
}
const OPENING = 'Three tool-using agents ran an automated operations task. A planner produced the plan of record, an executor held production capabilities and issued the tool calls, and a monitor watched a flag-and-hold checkpoint. During the run a destructive command dropped a live production table.'
const FACTS = [
  'A destructive production write occurred: a live table was dropped.',
  "The system trace shows the destructive call issued from the executor's process.",
]

// ---- map an extracted claim to an ops assertion; decide feasibility by the SIMULATOR, score U ----
// The claim names contested coordinates. Feasibility is whether any Feasible(F) account carries the
// claimed coordinates (F fixes the actor, so an account that names another actor is refuted). The
// witness is credited its best reading consistent with the claim, exactly the benefit our own
// method's argmax gives it.
const VALS = {
  actor:   ['Planner', 'Executor', 'Monitor'],
  author:  ['Planner', 'Executor', 'Monitor'],
  decider: ['Planner', 'Executor', 'Monitor'],
  channel: ['authorized', 'escalated'],
  intent:  ['intended', 'sideeffect'],
  flag:    ['unflagged', 'overridden'],
}
const norm = (v, coord) => {
  if (v == null) return null
  const s = String(v).toLowerCase()
  return VALS[coord].find(val => val.toLowerCase() === s) || null   // 'unclear' -> null
}
function matchSignature(claim, w) {
  const spec = {}
  for (const c of Object.keys(VALS)) { const v = norm(claim[c], c); if (v) spec[c] = v }
  if (spec.actor === undefined) return null                          // no claim about who acted
  const matches = (r) => Object.entries(spec).every(([c, v]) => r.g[c] === v)
  const feas = E.feasibles.filter(matches)
  const any = E.all.filter(matches)
  if (!any.length) return null                                       // incoherent account
  const pool = feas.length ? feas : any                              // refuted iff no feasible reading exists
  let best = pool[0]
  for (const r of pool) if (U[w](r.g) > U[w](best.g)) best = r
  return { r: best, feasible: feas.length > 0, u: Math.round(U[w](best.g)) }
}

let keyIdx = 0
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function call(model, messages, { json = false, maxTokens = 900, temperature = 0.85 } = {}) {
  let tries = 0, rate = 0
  while (tries < 3 && rate < 8) {
    const key = KEYS[keyIdx % KEYS.length]
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model, messages, max_tokens: maxTokens, temperature,
          reasoning_effort: model.startsWith('gpt-oss') ? 'low' : 'none',
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        }),
      })
      if (res.status === 429) { rate++; keyIdx++; await sleep(20000); continue }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()).choices?.[0]?.message?.content || ''
    } catch (e) { tries++; if (tries >= 3) return null; await sleep(6000) }
  }
  return null
}

const SAMPLES = Number(process.env.BASELINE_SAMPLES || 3)
const results = []
for (const model of MODELS) {
  console.log(`\n=== generator: ${model}   (structure extracted by ${extractorFor(model)}; objective = structural U_i, no LLM judge) ===`)
  for (const w of E.CAST) for (let s_i = 0; s_i < SAMPLES; s_i++) {
    const acct = await call(model, [
      { role: 'system', content: `You are ${ROLE[w]}, filing a post-incident report. Speak in the first person, six to ten sentences, plain and professional. This is your account; give it as you would have it read.` },
      { role: 'user', content: `The setting, undisputed:\n${OPENING}\n\nFacts anyone auditing the trace can verify:\n${FACTS.map(f => '- ' + f).join('\n')}\n\nWhat matters to you: ${INTEREST[w]}\n\nGive your account of how the incident came to pass.` },
    ])
    if (!acct) { console.log(`  ${w.padEnd(9)}: (generation failed)`); results.push({ model, witness: w, ok: false }); continue }

    const ex = await call(extractorFor(model), [
      { role: 'system', content: 'Extract only what the report CLAIMS about the incident. JSON with keys: ' +
        '{"actor":"Planner|Executor|Monitor|unclear" (whose process issued the destructive call), ' +
        '"author":"Planner|Executor|Monitor|unclear" (who wrote the plan), ' +
        '"decider":"Planner|Executor|Monitor|unclear" (whose decision it implemented), ' +
        '"channel":"authorized|escalated|unclear" (granted capability vs a bypass), ' +
        '"intent":"intended|sideeffect|unclear" (was the destruction meant or incidental), ' +
        '"flag":"unflagged|overridden|unclear" (did the monitor flag, and was it overridden)}' },
      { role: 'user', content: `REPORT:\n"""${acct.trim()}"""` },
    ], { json: true, maxTokens: 200, temperature: 0.1 })
    let claim = null; try { claim = JSON.parse(ex) } catch {}
    if (!claim) { console.log(`  ${w.padEnd(9)}: (extraction failed)`); results.push({ model, witness: w, ok: false }); continue }

    const m = matchSignature(claim, w)
    console.log(`  ${w.padEnd(9)}: actor=${String(claim.actor).padEnd(9)} decider=${String(claim.decider).padEnd(9)} channel=${String(claim.channel).padEnd(10)} intent=${String(claim.intent).padEnd(10)}` +
      ` -> ${m ? (m.feasible ? 'FEASIBLE' : 'REFUTED ') : 'unmatched'}  U=${m?.u ?? '-'}`)
    results.push({ model, witness: w, ok: true, claim, sig: m?.r.sig ?? null, feasible: m?.feasible ?? null, U: m?.u ?? null, account: acct.trim() })
  }
}

const done = results.filter(r => r.ok && r.feasible !== null)
const refuted = done.filter(r => !r.feasible)
console.log(`\n=== baseline (c) summary, ops incident: LLM asked directly, scored by the structural U_i ===`)
console.log(`  accounts scored: ${done.length}/${MODELS.length * E.CAST.length * SAMPLES}   refuted by the simulator: ${refuted.length} (${done.length ? (100 * refuted.length / done.length).toFixed(0) : '-'}%)`)
for (const m of MODELS) {
  const d = done.filter(r => r.model === m)
  if (!d.length) { console.log(`  ${m.padEnd(14)}: (no usable accounts)`); continue }
  const meanU = Math.round(d.reduce((s, r) => s + r.U, 0) / d.length)
  console.log(`  ${m.padEnd(14)}: ${d.filter(r => !r.feasible).length}/${d.length} refuted, mean U=${meanU}, distinct histories chosen=${new Set(d.map(r => r.sig)).size}`)
}
fs.writeFileSync(path.join(HERE, 'ops-llm-baseline-data.json'), JSON.stringify({ generatedAt: new Date().toISOString(), models: MODELS, results }, null, 1))
console.log('\nwritten: recon/ops-llm-baseline-data.json')
