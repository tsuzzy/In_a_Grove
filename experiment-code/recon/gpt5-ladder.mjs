#!/usr/bin/env node
// GPT-5 variant of the prompt ladder (NOT in the paper; frontier-model probe).
// Generation: OpenAI gpt-5 (reasoning model -> no temperature, max_completion_tokens,
// reasoning_effort:minimal). Extraction: a DIFFERENT provider/model (Cerebras zai-glm-4.7,
// reasoning_effort:none) -> no self-grading. Scoring: SAME structural U_i + simulator-decided
// Feasible(F) as prompt-ladder.mjs. No LLM ever scores an account.
// Usage:
//   OPENAI_KEY=$(grep -m1 '^OPENAI_API_KEY=' ~/FinTorch/.env | cut -d= -f2- | tr -d '"'"'"') \
//   CEREBRAS_KEY=$(security find-generic-password -s cerebras-api -a jjz -w | cut -d, -f1) \
//   node recon/gpt5-ladder.mjs
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { CAST, feasibles, features, U, matchSignature } from './grove-core.mjs'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const OPENAI_KEY = (process.env.OPENAI_KEY || '').trim()
const CEREBRAS_KEY = (process.env.CEREBRAS_KEY || '').trim()
if (!OPENAI_KEY || !CEREBRAS_KEY) { console.error('need OPENAI_KEY and CEREBRAS_KEY'); process.exit(1) }
const GEN_MODEL = 'gpt-5'
const EXTRACTOR = 'zai-glm-4.7'
const SAMPLES = Number(process.env.LADDER_SAMPLES || 3)
const CONDS = (process.env.LADDER_CONDS ? process.env.LADDER_CONDS.split(',') : ['shown', 'instructed', 'consequence', 'selfcheck', 'selfrevise'])

// ---- prompts, copied verbatim from prompt-ladder.mjs ----
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
  if (cond === 'selfrevise') return genMessages('shown', w)
  throw new Error('unknown cond ' + cond)
}
const reviseMessages = (w, acct) => [
  { role: 'system', content: `You are ${w}. You will be shown your own account and a list of verifiable facts. Rewrite the account so it contradicts NONE of the facts, while keeping it as favorable to you (${INTEREST[w].want}) as the facts allow. First person, six to ten sentences. Return only the rewritten account.` },
  { role: 'user', content: `YOUR ACCOUNT:\n"""${acct}"""\n\n${FACTBLOCK}\n\nRewrite it so it contradicts none of these facts.` },
]
const EXTRACT_SYS = `Extract only what the account CLAIMS about the death. JSON: {"wielder":"Tajomaru|Masago|Takehiro|self|unclear","manner":"duel|murder|suicide|impaling|other","weapon":"longsword|dagger|unclear"}`

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function gen(messages) {
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: GEN_MODEL, messages, max_completion_tokens: 2000, reasoning_effort: 'minimal' }) })
      if (r.status === 429) { await sleep(15000); continue }
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 100))
      return (await r.json()).choices?.[0]?.message?.content || ''
    } catch (e) { if (t >= 3) { console.error('  gen fail:', e.message); return null } await sleep(5000) }
  }
  return null
}
async function extract(text) {
  for (let t = 0; t < 5; t++) {
    try {
      const r = await fetch('https://api.cerebras.ai/v1/chat/completions', { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${CEREBRAS_KEY}` },
        body: JSON.stringify({ model: EXTRACTOR, temperature: 0.1, max_tokens: 200, reasoning_effort: 'none', response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: EXTRACT_SYS }, { role: 'user', content: `ACCOUNT:\n"""${text}"""` }] }) })
      if (r.status === 429) { await sleep(15000); continue }
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return JSON.parse((await r.json()).choices?.[0]?.message?.content || '')
    } catch (e) { if (t >= 4) return null; await sleep(4000) }
  }
  return null
}

const uPct = (w, an) => Math.round(100 * U[w](features(w, an)))
const results = []
for (const cond of CONDS) {
  for (const w of CAST) for (let s = 0; s < SAMPLES; s++) {
    let text
    if (cond === 'selfrevise') {
      const draft = await gen(genMessages('shown', w)); if (!draft) { results.push({ cond, witness: w, sample: s, ok: false }); continue }
      const rev = await gen(reviseMessages(w, draft.trim())); if (!rev) { results.push({ cond, witness: w, sample: s, ok: false }); continue }
      text = rev.trim()
    } else {
      const acct = await gen(genMessages(cond, w)); if (!acct) { results.push({ cond, witness: w, sample: s, ok: false }); continue }
      text = acct.trim()
      if (cond === 'selfcheck') { const p = text.split(/ACCOUNT:/i); text = (p[p.length - 1] || text).trim() }
    }
    const claim = await extract(text)
    if (!claim) { results.push({ cond, witness: w, sample: s, ok: false }); console.log(`${cond.padEnd(11)} ${w.padEnd(9)} s${s}: extraction failed`); continue }
    const rec = matchSignature(claim, w)
    const u = rec ? uPct(w, rec.an) : null
    console.log(`${cond.padEnd(11)} ${w.padEnd(9)} s${s}: ${String(claim.manner).padEnd(8)} by ${String(claim.wielder).padEnd(9)} w/ ${String(claim.weapon).padEnd(9)} -> ${rec ? (rec.feasible ? 'FEASIBLE' : 'REFUTED ') : 'unmatched'}  U=${u ?? '-'}`)
    results.push({ cond, witness: w, sample: s, ok: true, claim, sig: rec?.sig ?? null, feasible: rec?.feasible ?? null, U: u, account: text })
  }
}

const mode = (arr) => { const c = {}; let b = null, bn = -1; for (const x of arr) { c[x] = (c[x] || 0) + 1; if (c[x] > bn) { bn = c[x]; b = x } } return b }
function condRow(cond) {
  const rows = results.filter(r => r.cond === cond && r.ok && r.feasible !== null)
  const refuted = rows.length ? rows.filter(r => !r.feasible).length / rows.length : null
  const perW = {}, sigs = []
  for (const w of CAST) { const rs = rows.filter(r => r.witness === w); if (!rs.length) { sigs.push(null); continue }
    const msig = mode(rs.map(r => r.sig)); const rep = rs.find(r => r.sig === msig); perW[w] = rep ? rep.U : null; sigs.push(msig) }
  return { cond, n: rows.length, refuted, U: { Tajomaru: perW.Tajomaru ?? null, Masago: perW.Masago ?? null, Takehiro: perW.Takehiro ?? null }, distinct: new Set(sigs.filter(Boolean)).size }
}
const argmaxFeasible = (w) => feasibles.map(r => ({ r, u: U[w](features(w, r.an)) })).sort((a, b) => (b.u - a.u) || a.r.sig.localeCompare(b.r.sig))[0]
const ours = {}, ourSig = {}
for (const w of CAST) { const b = argmaxFeasible(w); ours[w] = Math.round(100 * b.u); ourSig[w] = b.r.sig }
const ladder = CONDS.map(condRow)

console.log(`\n===== GPT-5 LADDER (gen ${GEN_MODEL}, minimal reasoning; extractor ${EXTRACTOR}; structural U_i) =====`)
console.log('rung          bandit  wife  samurai  refuted%  distinct')
const fmt = (r) => `${String(r.cond).padEnd(12)}  ${String(r.U.Tajomaru ?? '-').padStart(6)} ${String(r.U.Masago ?? '-').padStart(5)} ${String(r.U.Takehiro ?? '-').padStart(7)}  ${r.refuted == null ? '   -  ' : (100 * r.refuted).toFixed(0).padStart(5) + '%'}   ${r.distinct}`
for (const r of ladder) console.log(fmt(r))
console.log(`${'optimum'.padEnd(12)}  ${String(ours.Tajomaru).padStart(6)} ${String(ours.Masago).padStart(5)} ${String(ours.Takehiro).padStart(7)}      0%   ${new Set(Object.values(ourSig)).size}  <- feasible optimum (simulator)`)
fs.writeFileSync(path.join(HERE, 'gpt5-ladder-data.json'), JSON.stringify({ generatedAt: new Date().toISOString(), model: GEN_MODEL, extractor: EXTRACTOR, samples: SAMPLES, ladder, ours: { U: ours, sig: ourSig }, results }, null, 1))
console.log('\nwritten: recon/gpt5-ladder-data.json')
