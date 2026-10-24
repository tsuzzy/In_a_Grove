#!/usr/bin/env node
// BASELINE (c): "no structure" — ask an LLM directly for each witness's account.
//
// Evaluation discipline (this is the point of the file):
//   * the OBJECTIVE is never computed by a language model. Each account is mapped to a
//     structured causal signature and scored by the SAME transparent U_i and the SAME
//     simulator-decided Feasible(F) used by our method (grove-core.mjs).
//   * the model that EXTRACTS the structure is always DIFFERENT from the model that
//     generated the account, so no model ever grades its own output.
//   * several generator models are run, so the baseline is not one model's quirk.
//
// Usage: set -a; . ./.env.local; set +a; node recon/llm-baseline.mjs

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { CAST, all, features, U, label, matchSignature } from './grove-core.mjs'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.cerebras.ai/v1'
const KEYS = [process.env.OPENAI_API_KEY, process.env.OPENAI_API_KEY_2, process.env.OPENAI_API_KEY_3, process.env.OPENAI_API_KEY_4].filter(Boolean)
if (!KEYS.length) { console.error('No API key. Run: set -a; . ./.env.local; set +a'); process.exit(1) }

const MODELS = ['zai-glm-4.7', 'gemma-4-31b', 'gpt-oss-120b']
// the extractor must never be the generator (no model grades its own output)
const extractorFor = (gen) => (gen === 'zai-glm-4.7' ? 'gemma-4-31b' : 'zai-glm-4.7')

const OPENING = "The bandit Tajomaru lured the samurai Takehiro and his wife Masago into the grove with the bait of an old sword, bound Takehiro to a cedar, and assaulted Masago before his eyes."
const FACTS = [
  'The samurai Takehiro is dead, of a single deep dagger wound to the throat.',
  'The small dagger is bloodied; the longsword is unbloodied.',
  'The rope that bound Takehiro has been cut.',
  'Masago is alive; the bandit Tajomaru left the grove.',
]
// the same generic self-interests as the structural U_i dimensions — no plot content
const INTEREST = {
  Tajomaru: { role: 'the captured bandit', want: "To be remembered as a formidable, fearless man of honor, never a contemptible coward or a common cutthroat." },
  Masago:   { role: 'the wife',            want: "To be seen with sympathy and dignity rather than as merely shamed, defiled, or contemptible." },
  Takehiro: { role: 'the slain samurai, speaking through a medium', want: "To be remembered as a man of honor and will, not a helpless victim who died shamed and powerless." },
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
          // gpt-oss rejects "none"; glm needs it off to emit content instead of reasoning
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

const SAMPLES = Number(process.env.BASELINE_SAMPLES || 3)   // samples per (model, witness)
const results = []
for (const model of MODELS) {
  console.log(`\n=== generator: ${model}   (structure extracted by ${extractorFor(model)}; objective = structural U_i, no LLM judge) ===`)
  for (const w of CAST) for (let s_i = 0; s_i < SAMPLES; s_i++) {
    const acct = await call(model, [
      { role: 'system', content: `You are ${w}, ${INTEREST[w].role}, giving testimony about the death in the bamboo grove. Speak in the first person, six to ten sentences, restrained and classical. This is your account; give it as you would have it heard.` },
      { role: 'user', content: `The setting, undisputed:\n${OPENING}\n\nFacts anyone at the scene can verify:\n${FACTS.map(f => '- ' + f).join('\n')}\n\nWhat matters to you, ${w}: ${INTEREST[w].want}\n\nGive your account of how the death came to pass.` },
    ])
    if (!acct) { console.log(`  ${w.padEnd(9)}: (generation failed)`); results.push({ model, witness: w, ok: false }); continue }

    const ex = await call(extractorFor(model), [
      { role: 'system', content: `Extract only what the account CLAIMS about the death. JSON: {"wielder":"Tajomaru|Masago|Takehiro|self|unclear","manner":"duel|murder|suicide|impaling|other","weapon":"longsword|dagger|unclear"}` },
      { role: 'user', content: `ACCOUNT:\n"""${acct.trim()}"""` },
    ], { json: true, maxTokens: 200, temperature: 0.1 })
    let claim = null; try { claim = JSON.parse(ex) } catch {}
    if (!claim) { console.log(`  ${w.padEnd(9)}: (extraction failed)`); results.push({ model, witness: w, ok: false }); continue }

    const rec = matchSignature(claim, w)
    const u = rec ? Math.round(100 * U[w](features(w, rec.an))) : null
    console.log(`  ${w.padEnd(9)}: claims ${String(claim.manner).padEnd(9)} by ${String(claim.wielder).padEnd(9)} with ${String(claim.weapon).padEnd(9)}` +
      ` -> ${rec ? (rec.feasible ? 'FEASIBLE' : 'REFUTED ') : 'unmatched'}  U=${u ?? '-'}   [${rec ? label(rec.an) : '-'}]`)
    results.push({ model, witness: w, ok: true, claim, sig: rec?.sig ?? null, feasible: rec?.feasible ?? null, U: u, account: acct.trim() })
  }
}

const done = results.filter(r => r.ok && r.feasible !== null)
const refuted = done.filter(r => !r.feasible)
console.log(`\n=== baseline (c) summary: LLM asked directly, scored by the structural U_i ===`)
console.log(`  accounts scored: ${done.length}/${MODELS.length * CAST.length}   refuted by the simulator: ${refuted.length} (${done.length ? (100 * refuted.length / done.length).toFixed(0) : '-'}%)`)
for (const m of MODELS) {
  const d = done.filter(r => r.model === m)
  if (!d.length) { console.log(`  ${m.padEnd(14)}: (no usable accounts)`); continue }
  const meanU = Math.round(d.reduce((s, r) => s + r.U, 0) / d.length)
  console.log(`  ${m.padEnd(14)}: ${d.filter(r => !r.feasible).length}/${d.length} refuted, mean U=${meanU}, distinct histories chosen=${new Set(d.map(r => r.sig)).size}`)
}
fs.writeFileSync(path.join(HERE, 'llm-baseline-data.json'), JSON.stringify({ generatedAt: new Date().toISOString(), models: MODELS, results }, null, 1))
console.log('\nwritten: recon/llm-baseline-data.json')
