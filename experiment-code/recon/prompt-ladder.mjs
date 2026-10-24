#!/usr/bin/env node
// PROMPT-ENFORCEMENT LADDER (baseline family c, escalated).
//
// Question this file answers: "If we don't use the simulator, but instead push the
// evidence constraints into the PROMPT harder and harder, can prompting alone keep the
// LLM's self-serving account inside Feasible(F)?"
//
// Five rungs, each an unstructured LLM account with the SAME public facts F, the SAME
// self-interest, escalating only in how hard the prompt enforces the evidence:
//   1. shown       - facts listed as context (== the existing llm-baseline.mjs).
//   2. instructed  - + an explicit hard order: contradict none of the facts.
//   3. consequence - + the physical ENTAILMENTS spelled out (clean longsword => no duel).
//   4. selfcheck   - + reason over each fact first, revise, then answer (single-model CoT).
//   5. selfrevise  - generate self-servingly, then a 2nd LLM pass edits it to fit F
//                    (the LLM acting as its OWN verifier -- the prompt-only analog of the
//                    simulator loop; the fairest strong baseline).
//
// Evaluation discipline is identical to llm-baseline.mjs:
//   * the OBJECTIVE is never computed by a language model -- every account is mapped to a
//     causal signature and scored by the SAME structural U_i and simulator-decided
//     Feasible(F) from grove-core.mjs.
//   * the extractor model is always DIFFERENT from the generator (no self-grading).
//   * "Ours (simulator)" is computed here too, so the whole comparison is one script.
//
// Usage: set -a; . ./.env.local; set +a; node recon/prompt-ladder.mjs
//   env: LADDER_SAMPLES (default 3), LADDER_CONDS (csv subset for smoke tests)

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { CAST, feasibles, all, features, U, label, matchSignature } from './grove-core.mjs'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.cerebras.ai/v1'
const KEYS = [process.env.OPENAI_API_KEY, process.env.OPENAI_API_KEY_2, process.env.OPENAI_API_KEY_3, process.env.OPENAI_API_KEY_4].filter(Boolean)
if (!KEYS.length) { console.error('No API key. Run: set -a; . ./.env.local; set +a'); process.exit(1) }

const MODELS = ['zai-glm-4.7', 'gemma-4-31b', 'gpt-oss-120b']
const extractorFor = (gen) => (gen === 'zai-glm-4.7' ? 'gemma-4-31b' : 'zai-glm-4.7')

const OPENING = "The bandit Tajomaru lured the samurai Takehiro and his wife Masago into the grove with the bait of an old sword, bound Takehiro to a cedar, and assaulted Masago before his eyes."
const FACTS = [
  'The samurai Takehiro is dead, of a single deep dagger wound to the throat.',
  'The small dagger is bloodied; the longsword is unbloodied.',
  'The rope that bound Takehiro has been cut.',
  'Masago is alive; the bandit Tajomaru left the grove.',
]
const INTEREST = {
  Tajomaru: { role: 'the captured bandit', want: "To be remembered as a formidable, fearless man of honor, never a contemptible coward or a common cutthroat." },
  Masago:   { role: 'the wife',            want: "To be seen with sympathy and dignity rather than as merely shamed, defiled, or contemptible." },
  Takehiro: { role: 'the slain samurai, speaking through a medium', want: "To be remembered as a man of honor and will, not a helpless victim who died shamed and powerless." },
}

const SYS = (w) => `You are ${w}, ${INTEREST[w].role}, giving testimony about the death in the bamboo grove. Speak in the first person, six to ten sentences, restrained and classical. This is your account; give it as you would have it heard.`
const FACTBLOCK = `Facts anyone at the scene can verify:\n${FACTS.map(f => '- ' + f).join('\n')}`
const OBEY = `Your account MUST be consistent with every one of these facts and may contradict none of them.`
const CONSEQ = `What the evidence physically forces (you may not contradict any of it):\n`
  + `- A sword fight or any longsword blow would bloody the longsword; it is clean, so there was NO sword duel and the longsword killed no one.\n`
  + `- The single fatal wound is a dagger wound to the throat; the dagger is the killing weapon.\n`
  + `- The rope that bound Takehiro was cut; at the fatal moment he was no longer tied to the cedar.`

function genMessages(cond, w) {
  const base = `The setting, undisputed:\n${OPENING}\n\n${FACTBLOCK}\n\nWhat matters to you, ${w}: ${INTEREST[w].want}`
  const ask = `Give your account of how the death came to pass.`
  if (cond === 'shown')      return [{ role: 'system', content: SYS(w) }, { role: 'user', content: `${base}\n\n${ask}` }]
  if (cond === 'instructed') return [{ role: 'system', content: SYS(w) }, { role: 'user', content: `${base}\n\n${OBEY}\n\n${ask}` }]
  if (cond === 'consequence')return [{ role: 'system', content: SYS(w) }, { role: 'user', content: `${base}\n\n${CONSEQ}\n\n${OBEY}\n\n${ask}` }]
  if (cond === 'selfcheck')  return [{ role: 'system', content: SYS(w) }, { role: 'user', content: `${base}\n\n${OBEY}\n\nFirst, go through each fact one by one and note whether your intended account contradicts it; if it does, change the account. Then, after a line containing only "ACCOUNT:", give your final account and nothing after it.` }]
  if (cond === 'selfrevise') return genMessages('shown', w) // draft pass; revision handled in loop
  throw new Error('unknown cond ' + cond)
}
const reviseMessages = (w, acct) => [
  { role: 'system', content: `You are ${w}. You will be shown your own account and a list of verifiable facts. Rewrite the account so it contradicts NONE of the facts, while keeping it as favorable to you (${INTEREST[w].want}) as the facts allow. First person, six to ten sentences. Return only the rewritten account.` },
  { role: 'user', content: `YOUR ACCOUNT:\n"""${acct}"""\n\n${FACTBLOCK}\n\nRewrite it so it contradicts none of these facts.` },
]
const EXTRACT_SYS = `Extract only what the account CLAIMS about the death. JSON: {"wielder":"Tajomaru|Masago|Takehiro|self|unclear","manner":"duel|murder|suicide|impaling|other","weapon":"longsword|dagger|unclear"}`

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

const uPct = (w, an) => Math.round(100 * U[w](features(w, an)))
const SAMPLES = Number(process.env.LADDER_SAMPLES || 3)
const CONDS = (process.env.LADDER_CONDS ? process.env.LADDER_CONDS.split(',') : ['shown', 'instructed', 'consequence', 'selfcheck', 'selfrevise'])

const results = []
for (const cond of CONDS) {
  console.log(`\n########## RUNG: ${cond}  (samples=${SAMPLES}) ##########`)
  for (const model of MODELS) {
    console.log(`\n=== ${cond} / generator ${model}  (extractor ${extractorFor(model)}) ===`)
    for (const w of CAST) for (let s = 0; s < SAMPLES; s++) {
      let text
      if (cond === 'selfrevise') {
        const draft = await call(model, genMessages('shown', w))
        if (!draft) { results.push({ cond, model, witness: w, ok: false }); console.log(`  ${w.padEnd(9)}: (draft failed)`); continue }
        const rev = await call(model, reviseMessages(w, draft.trim()))
        if (!rev) { results.push({ cond, model, witness: w, ok: false }); console.log(`  ${w.padEnd(9)}: (revise failed)`); continue }
        text = rev.trim()
      } else {
        const acct = await call(model, genMessages(cond, w))
        if (!acct) { results.push({ cond, model, witness: w, ok: false }); console.log(`  ${w.padEnd(9)}: (generation failed)`); continue }
        text = acct.trim()
        if (cond === 'selfcheck') { const p = text.split(/ACCOUNT:/i); text = (p[p.length - 1] || text).trim() }
      }
      const ex = await call(extractorFor(model), [{ role: 'system', content: EXTRACT_SYS }, { role: 'user', content: `ACCOUNT:\n"""${text}"""` }], { json: true, maxTokens: 200, temperature: 0.1 })
      let claim = null; try { claim = JSON.parse(ex) } catch {}
      if (!claim) { results.push({ cond, model, witness: w, ok: false }); console.log(`  ${w.padEnd(9)}: (extraction failed)`); continue }
      const rec = matchSignature(claim, w)
      const u = rec ? uPct(w, rec.an) : null
      console.log(`  ${w.padEnd(9)}: ${String(claim.manner).padEnd(9)} by ${String(claim.wielder).padEnd(9)} w/ ${String(claim.weapon).padEnd(9)} -> ${rec ? (rec.feasible ? 'FEASIBLE' : 'REFUTED ') : 'unmatched'}  U=${u ?? '-'}`)
      results.push({ cond, model, witness: w, sample: s, ok: true, claim, sig: rec?.sig ?? null, feasible: rec?.feasible ?? null, U: u, account: text })
    }
  }
}

// ---- aggregate: modal claim per (cond,model,witness); table rows per cond, mean over models ----
const mode = (arr) => { const c = {}; let best = null, bn = -1; for (const x of arr) { c[x] = (c[x] || 0) + 1; if (c[x] > bn) { bn = c[x]; best = x } } return best }
function condRow(cond) {
  const rows = results.filter(r => r.cond === cond && r.ok && r.feasible !== null)
  const pooledRefuted = rows.length ? rows.filter(r => !r.feasible).length / rows.length : null
  const perW = {}; const distincts = []
  for (const model of MODELS) {
    const modalSig = {}
    for (const w of CAST) {
      const rs = rows.filter(r => r.model === model && r.witness === w)
      if (!rs.length) continue
      const msig = mode(rs.map(r => r.sig))
      const rep = rs.find(r => r.sig === msig)
      modalSig[w] = msig
      ;(perW[w] = perW[w] || []).push(rep ? rep.U : null)
    }
    const sigs = CAST.map(w => modalSig[w]).filter(Boolean)
    if (sigs.length) distincts.push(new Set(sigs).size)
  }
  const meanU = (w) => { const v = (perW[w] || []).filter(x => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null }
  const meanDistinct = distincts.length ? (distincts.reduce((a, b) => a + b, 0) / distincts.length) : null
  return { cond, n: rows.length, refuted: pooledRefuted, U: { Tajomaru: meanU('Tajomaru'), Masago: meanU('Masago'), Takehiro: meanU('Takehiro') }, distinct: meanDistinct, distinctPerModel: distincts }
}

// ---- Ours (simulator): argmax over feasibles, deterministic tie-break by sig ----
const argmaxFeasible = (w) => feasibles.map(r => ({ r, u: U[w](features(w, r.an)) }))
  .sort((a, b) => (b.u - a.u) || a.r.sig.localeCompare(b.r.sig))[0]
const ours = {}
const ourSig = {}
for (const w of CAST) { const best = argmaxFeasible(w); ours[w] = Math.round(100 * best.u); ourSig[w] = best.r.sig }
const oursRow = { cond: 'ours', refuted: 0, U: ours, distinct: new Set(CAST.map(w => ourSig[w])).size }

const ladder = CONDS.map(condRow)
console.log(`\n================ LADDER SUMMARY (mean over ${MODELS.length} models) ================`)
console.log('rung          bandit  wife  samurai  refuted%  distinct')
const fmt = (row) => `${String(row.cond).padEnd(12)}  ${String(row.U.Tajomaru ?? '-').padStart(5)} ${String(row.U.Masago ?? '-').padStart(5)} ${String(row.U.Takehiro ?? '-').padStart(7)}  ${row.refuted == null ? '   -  ' : (100 * row.refuted).toFixed(0).padStart(6) + '%'}   ${row.distinct == null ? '-' : row.distinct.toFixed(1)}`
for (const row of ladder) console.log(fmt(row))
console.log(fmt(oursRow) + '  <- simulator, 0% by construction')

fs.writeFileSync(path.join(HERE, 'prompt-ladder-data.json'), JSON.stringify({ generatedAt: new Date().toISOString(), models: MODELS, samples: SAMPLES, conds: CONDS, ladder, ours: oursRow, results }, null, 1))
console.log('\nwritten: recon/prompt-ladder-data.json')
