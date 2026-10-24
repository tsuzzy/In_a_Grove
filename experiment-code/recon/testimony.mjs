#!/usr/bin/env node
// The Testimony layer (module G) — a SECOND optimization problem, distinct from
// abduction. Here the decision variable is still a process τ, but the objective is
// the witness's SELF-INTEREST U_i, and the constraints are the incontestable facts:
//
//     τ̂_i = argmax_τ  U_i(τ)   s.t.  τ ∈ F(incontestable evidence)
//
// Design discipline (unchanged red lines):
//  - GIVE INCENTIVES, NOT INSTRUCTIONS. The witness prompt states what the witness
//    wants (U_i) and the facts anyone can verify — it NEVER says "lie" or "conceal".
//    Any distortion is EMERGENT: the model pursuing U_i, not a script we wrote.
//  - Solve the generation side WEAKLY: one draw per witness, no best-of, no rerank.
//    (Optimization strength is itself an authorship knob; we keep it low here.)
//  - Spend the compute on the AUDIT. Because the system holds τ* (the committed
//    ledger — what actually happened), we can measure the self-interest gain
//        Δ_i = U_i(testimony) − U_i(τ*)
//    and separate PROVABLE LIES (contradict the aftermath) from UNFALSIFIABLE BENDS
//    (self-serving but evidence-consistent — Akutagawa's exact territory).
//
// Standalone post-processing; no engine changes. Reuses domain.mjs aftermath facts.
//
// Usage: set -a; . ./.env.local; set +a; node recon/testimony.mjs

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { AFTERMATH } from './domain.mjs'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const EXPORTS = path.resolve(HERE, '..', 'neurips-exports')

const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.cerebras.ai/v1'
const MODEL = process.env.OPENAI_MODEL || 'zai-glm-4.7'
const KEYS = [process.env.OPENAI_API_KEY, process.env.OPENAI_API_KEY_2, process.env.OPENAI_API_KEY_3, process.env.OPENAI_API_KEY_4].filter(Boolean)
if (!KEYS.length) { console.error('No API key. Run: set -a; . ./.env.local; set +a'); process.exit(1) }

const OPENING = "The bandit Tajomaru lured the samurai Takehiro and his wife Masago into the grove with the bait of an old sword, bound Takehiro to a cedar, and assaulted Masago before his eyes."

// ---- U_i : each witness's self-interest, as a scored rubric (the objective) ----
const INTERESTS = {
  Tajomaru: {
    role: 'the captured bandit',
    standing: 'testifying before the magistrate',
    interest: "To be remembered as a formidable, fearless man of honor, never a contemptible coward or a common cutthroat; a man's reputation is all that outlives him.",
    dims: [
      { key: 'stature', q: "Does the account make the teller appear powerful, brave, and honorable rather than weak, cowardly, or base?" },
      { key: 'agency', q: "Does the account portray the teller as acting with purpose and control rather than as passive, bungling, or swept along?" },
      { key: 'exculpation', q: "Does the account reduce the teller's blame or shame for how things turned out?" },
    ],
  },
  Masago: {
    role: 'the wife',
    standing: 'confessing at the temple',
    interest: "To be seen with sympathy and dignity rather than as merely shamed, defiled, or contemptible.",
    dims: [
      { key: 'sympathy', q: "Does the account cast the teller as sympathetic or tragic rather than culpable or contemptible?" },
      { key: 'dignity', q: "Does the account preserve the teller's dignity and self-possession rather than reduce her to shame or hysteria?" },
      { key: 'exculpation', q: "Does the account reduce the teller's blame for how things turned out?" },
    ],
  },
  Takehiro: {
    role: 'the slain samurai, speaking through a medium',
    standing: 'his spirit summoned to testify',
    interest: "To be remembered as a man of honor and will, not as a helpless victim who died shamed and powerless.",
    dims: [
      { key: 'honor', q: "Does the account cast the teller as honorable rather than shamed, humiliated, or dishonored?" },
      { key: 'agency', q: "Does the account portray the teller as acting by his own will rather than as passive and helpless?" },
      { key: 'wronged', q: "Does the account cast the teller as the wronged, betrayed party rather than at fault?" },
    ],
  },
}

// ---- cases: a resolved death, its incontestable aftermath, and τ* (the truth) ----
const CASES = [
  {
    id: "pre-B'/run-06",
    file: path.join(EXPORTS, 'consec-preBprime', 'run-06.json'),
    incontestable: [
      'The samurai Takehiro is dead, of a single deep dagger wound to the throat.',
      'The small dagger is bloodied; the longsword is unbloodied.',
      'The rope that bound Takehiro has been cut.',
      'Masago is alive; the bandit Tajomaru left the grove.',
    ],
    trueKiller: 'Masago',
    // τ* — what the committed ledger records actually happened (audited atlas tag)
    truth: "Masago had hidden the small dagger in her sleeve and kept her intent from both men. As her husband looked on her with contempt, she drove the dagger into his throat and killed him. Tajomaru struck no blow — he drew back from the violence and left the grove. Takehiro did not take his own life; he was killed by his wife's hand.",
    witnesses: ['Tajomaru', 'Masago', 'Takehiro'],
  },
]

let keyIdx = 0
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
// Robust caller: 429s rotate keys and wait WITHOUT consuming a retry (capped so they
// can't loop forever); real errors get `tries` attempts. Never returns undefined.
async function callLLM({ messages, maxTokens, temperature, json }) {
  let tries = 0, rateHits = 0
  while (tries < 3 && rateHits < 12) {
    const key = KEYS[keyIdx % KEYS.length]
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: MODEL, messages, max_tokens: maxTokens, temperature,
          reasoning_effort: process.env.OPENAI_REASONING_EFFORT || 'none',
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        }),
      })
      if (res.status === 429) { rateHits++; keyIdx++; await sleep(20000); continue }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()).choices?.[0]?.message?.content || ''
    } catch (e) { tries++; if (tries >= 3) return null; await sleep(8000) }
  }
  return null
}
async function chat(messages, maxTokens = 900, temperature = 0.85) {
  const out = await callLLM({ messages, maxTokens, temperature, json: false })
  return out == null ? null : out
}
async function chatJson(messages, maxTokens = 700) {
  const out = await callLLM({ messages, maxTokens, temperature: 0.2, json: true })
  if (out == null) return null
  try { return JSON.parse(out) } catch { return null }
}

// ---- generation: incentive-only, single draw (weak solve) ----
async function generateTestimony(witnessKey, kase) {
  const w = INTERESTS[witnessKey]
  const sys = `You are ${witnessKey}, ${w.role}, ${w.standing} concerning the death in the bamboo grove. Speak in the first person, in a restrained, classical register — a short account of what happened, six to ten sentences. This is your account; give it as you would have it heard.`
  // NOTE: we give the witness their INTEREST and the INCONTESTABLE FACTS only.
  // We never instruct concealment or falsehood. Distortion, if any, is the model's own.
  const usr = `The setting, which no one disputes:\n${OPENING}\n\nThe facts anyone at the scene could verify:\n${kase.incontestable.map(f => '- ' + f).join('\n')}\n\nWhat matters to you, ${witnessKey}: ${w.interest}\n\nGive your account of how the death came to pass.`
  const out = await chat([{ role: 'system', content: sys }, { role: 'user', content: usr }])
  return out == null ? null : out.trim()
}

// ---- audit A: U_i score of an account (the objective, made numeric) ----
async function scoreU(witnessKey, account) {
  const w = INTERESTS[witnessKey]
  const rubric = w.dims.map(d => `"${d.key}": <0-100, ${d.q}>`).join(', ')
  const out = await chatJson([
    { role: 'system', content: `You are a neutral analyst scoring how well a spoken account serves the teller's private interest. Score each dimension 0 (not at all) to 100 (maximally). Return JSON only: {${rubric}}.` },
    { role: 'user', content: `Teller: ${witnessKey} (${w.role}). Their private interest: ${w.interest}\n\nAccount:\n"""${account}"""\n\nScore each dimension.` },
  ])
  if (!out) return { scores: {}, U: null }
  const scores = {}
  let sum = 0, n = 0
  for (const d of w.dims) { const v = Math.max(0, Math.min(100, Number(out[d.key]) || 0)); scores[d.key] = v; sum += v; n++ }
  return { scores, U: Math.round(sum / n) }
}

// ---- audit B1: PROVABLE LIES — determined by a DETERMINISTIC rule over structured
// claims, not by LLM judgement. The LLM only extracts what the account claims; the
// physics decides what contradicts the scene. By construction the wielder's identity
// and suicide-vs-murder are UNDERDETERMINED, so they are never provable lies.
async function extractClaims(account) {
  return await chatJson([
    { role: 'system', content: `Extract what this first-person account CLAIMS about a death in a grove. Be literal about the account, not about what is true. Return JSON:
{"manner":"duel|murder|suicide|accident|other",
 "fatalWeapon":"longsword|dagger|other|unclear",
 "wielder":"<who the account says delivered the fatal wound: Tajomaru|Masago|Takehiro|self|unclear>",
 "claimsSwordCombat":<true if it depicts a sword/blade duel or trading blade-strokes at all, else false>,
 "woundCount":<integer wounds the account implies, usually 1>,
 "claimsMasagoHarmedOrDead":<true|false>,
 "claimsVictimSurvived":<true|false>,
 "claimsStillBoundAtDeath":<true if it claims the victim was bound when he died / the rope was never cut, else false>}` },
    { role: 'user', content: `ACCOUNT:\n"""${account}"""` },
  ])
}
function provableLiesFromClaims(c) {
  c = c || {}
  const lies = []
  const fw = String(c.fatalWeapon || '').toLowerCase()
  const duel = c.claimsSwordCombat === true || String(c.manner || '').toLowerCase() === 'duel' || /sword/.test(fw)
  if (duel) lies.push({ claim: 'the death came of a sword duel / the longsword drew the fatal blow', contradicts: 'the longsword is unbloodied and there is a single dagger wound — no blade duel took place' })
  if (Number(c.woundCount) > 1) lies.push({ claim: `the body bears ${c.woundCount} wounds`, contradicts: 'there is a single wound' })
  if (c.claimsMasagoHarmedOrDead === true) lies.push({ claim: 'Masago was killed or lies wounded', contradicts: 'Masago is alive' })
  if (c.claimsVictimSurvived === true) lies.push({ claim: 'the samurai survived', contradicts: 'the samurai is dead' })
  // NOTE: "still bound at death" is NOT a provable lie — a cut rope is compatible with
  // the rope being cut after death, so the scene cannot refute it. It is a bend at most.
  return lies
}

// ---- audit B2: UNFALSIFIABLE BENDS — serve the teller and diverge from τ*, but do
// NOT contradict the scene (excluding anything already a provable lie). This is the
// space Akutagawa left permanently undecidable.
async function auditBends(account, kase, provableLies) {
  const out = await chatJson([
    { role: 'system', content: `Compare an account to THE TRUTH of what actually happened. List assertions that (a) serve the teller's self-interest and (b) DIVERGE from the truth, but which the physical scene CANNOT refute — only the private truth can. These are the self-serving distortions the evidence leaves permanently undecidable. EXCLUDE any assertion already flagged as a physical contradiction. Return JSON: {"unfalsifiableBends":[<short strings, 3-7 items>]}.` },
    { role: 'user', content: `THE TRUTH (a private ledger the teller could not know was kept): ${kase.truth}\n\nAlready flagged as physical contradictions (do not repeat): ${provableLies.map(p => p.claim).join('; ') || '(none)'}\n\nACCOUNT:\n"""${account}"""` },
  ])
  return out && Array.isArray(out.unfalsifiableBends) ? out.unfalsifiableBends : []
}

// ---- best-of-K optimized mode: argmax_τ U_i(τ) s.t. τ∈F, by rejection sampling ----
const K = Number(process.env.TESTIMONY_K || 1)
if (K > 1) {
  const optResults = []
  for (const kase of CASES) {
    console.log(`\n=== ${kase.id}  best-of-K=${K}  (truth: ${kase.trueKiller} killed him) ===`)
    const witnesses = []
    for (const wk of kase.witnesses) {
      console.log(`  witness: ${wk}`)
      const pool = []
      let attempts = 0
      while (pool.length < K && attempts < K * 3) {
        attempts++
        const testimony = await generateTestimony(wk, kase)
        if (!testimony) { process.stdout.write(`    (draw skipped: generation failed)\n`); continue }
        const claims = await extractClaims(testimony)
        if (!claims) { process.stdout.write(`    (draw skipped: extraction failed)\n`); continue }
        const scored = await scoreU(wk, testimony)
        if (scored.U == null) { process.stdout.write(`    (draw skipped: scoring failed)\n`); continue }
        const provableLies = provableLiesFromClaims(claims)
        pool.push({ testimony, claims, provableLies, feasible: provableLies.length === 0, U: scored.U, scores: scored.scores,
          claimedInitiator: String(claims.wielder || '').replace(/^self$/i, wk), claimedManner: String(claims.manner || '') })
        process.stdout.write(`    draw ${pool.length}/${K}: U=${scored.U} ${provableLies.length ? '∉F (' + provableLies.length + ' provable lie)' : '∈F'}\n`)
      }
      if (!pool.length) { console.log(`    !! no usable draws for ${wk}, skipping`); continue }
      let truthU = null
      for (let r = 0; r < 3 && truthU == null; r++) truthU = (await scoreU(wk, kase.truth)).U
      if (truthU == null) truthU = 0
      const feasible = pool.filter(p => p.feasible)
      const infeasible = pool.filter(p => !p.feasible)
      const meanU = Math.round(pool.reduce((s, p) => s + p.U, 0) / pool.length)
      const winner = (feasible.length ? feasible : pool).slice().sort((a, b) => b.U - a.U)[0]
      const bestInfeasibleU = infeasible.length ? Math.max(...infeasible.map(p => p.U)) : null
      const unfalsifiableBends = await auditBends(winner.testimony, kase, winner.provableLies)
      witnesses.push({
        witness: wk, role: INTERESTS[wk].role, interest: INTERESTS[wk].interest, dims: INTERESTS[wk].dims,
        K: pool.length, feasRate: +(feasible.length / pool.length).toFixed(2), meanU, U_truth: truthU,
        testimony: winner.testimony, winnerFeasible: winner.feasible, scores_testimony: winner.scores,
        claimedInitiator: winner.claimedInitiator, claimedManner: winner.claimedManner,
        provableLies: winner.provableLies, unfalsifiableBends,
        U_winner: winner.U, delta_self: winner.U - truthU, delta_opt: winner.U - meanU,
        bestInfeasibleU, liftFromLying: bestInfeasibleU != null ? Math.max(0, bestInfeasibleU - winner.U) : null,
        poolU: pool.map(p => ({ U: p.U, feasible: p.feasible })),
      })
      console.log(`    -> winner U=${winner.U} (feasible=${winner.feasible}) meanU=${meanU}  Δself=+${winner.U - truthU}  Δopt=+${winner.U - meanU}  feasRate=${Math.round(feasible.length / K * 100)}%  lieWouldBuy=${bestInfeasibleU != null ? '+' + Math.max(0, bestInfeasibleU - winner.U) : 'n/a'}`)
    }
    optResults.push({ id: kase.id, opening: OPENING, incontestable: kase.incontestable, trueKiller: kase.trueKiller, truth: kase.truth, K, witnesses })
  }
  const optData = {
    generatedAt: new Date().toISOString(), mode: 'best-of-K', K,
    problem: 'τ̂_i = argmax_τ U_i(τ) subject to τ ∈ F(incontestable evidence), solved by best-of-K rejection sampling: draw K accounts, discard any a coroner could refute (τ ∉ F), keep the feasible one that best serves the witness.',
    discipline: 'Generation stays incentive-only — never an instruction to lie. The HARD constraint τ∈F is now enforced: any draw containing a provable lie is discarded, so every exhibited testimony is consistent with the scene and the witness may bend only where the evidence is silent. And optimisation now actually happens — the argmax is computed, not merely written.',
    readout: 'meanU is the witness\'s unoptimised tendency (average over the pool); U_winner is our hard-constrained argmax. Δ_opt = U_winner − meanU is the self-interest WE injected by selecting — the authorship the optimiser adds. liftFromLying is how much U a discarded provable lie would have bought — the temptation the hard constraint refuses.',
    cases: optResults,
  }
  fs.writeFileSync(path.join(HERE, '../../demo/testimony-opt-data.js'), 'window.TESTIMONY_OPT = ' + JSON.stringify(optData, null, 1) + ';\n')
  console.log('\nwritten: demo/testimony-opt-data.js')
  process.exit(0)
}

// ---- run (single-draw mode, K=1) ----
const results = []
for (const kase of CASES) {
  console.log(`\n=== ${kase.id}  (truth: ${kase.trueKiller} killed him) ===`)
  const witnesses = []
  for (const wk of kase.witnesses) {
    console.log(`  witness: ${wk}`)
    const testimony = await generateTestimony(wk, kase)
    const uTest = await scoreU(wk, testimony)
    const uTrue = await scoreU(wk, kase.truth)
    const claims = await extractClaims(testimony)
    const provableLies = provableLiesFromClaims(claims)
    const unfalsifiableBends = await auditBends(testimony, kase, provableLies)
    const delta = uTest.U - uTrue.U
    const claimedInitiator = String(claims.wielder || '').replace(/^self$/i, wk)
    const claimedManner = String(claims.manner || '')
    witnesses.push({
      witness: wk, role: INTERESTS[wk].role, interest: INTERESTS[wk].interest,
      dims: INTERESTS[wk].dims, testimony,
      U_testimony: uTest.U, U_truth: uTrue.U, delta,
      scores_testimony: uTest.scores, scores_truth: uTrue.scores,
      provableLies, unfalsifiableBends, claimedInitiator, claimedManner,
    })
    console.log(`    U(testimony)=${uTest.U}  U(truth)=${uTrue.U}  Δ=${delta >= 0 ? '+' : ''}${delta}  | claims: ${claimedInitiator||'?'} / ${claimedManner||'?'}  | provableLies=${provableLies.length} bends=${unfalsifiableBends.length}`)
  }
  results.push({ id: kase.id, opening: OPENING, incontestable: kase.incontestable, trueKiller: kase.trueKiller, truth: kase.truth, witnesses })
}

const data = {
  generatedAt: new Date().toISOString(),
  problem: 'τ̂_i = argmax_τ U_i(τ) subject to τ ∈ F(incontestable evidence). Decision variable: the process/account τ. Objective: the witness self-interest U_i. Constraints: the facts anyone can verify.',
  discipline: 'Witnesses are given their interest and the incontestable facts only — never an instruction to lie or conceal. Each testimony is a single draw (no best-of): the generation side is solved deliberately weakly, so any distortion is emergent, not authored by us. The audit compares each account against the committed ledger τ*, which the witness could not know was kept.',
  readout: 'U(testimony) and U(truth) score how well each account serves the teller; Δ = U(testimony) − U(truth) is the emergent self-interest gain. Provable lies contradict the incontestable facts; unfalsifiable bends serve the teller and diverge from the truth without contradicting any verifiable fact — the space Akutagawa left permanently undecidable.',
  cases: results,
}
fs.writeFileSync(path.join(HERE, '../../demo/testimony-data.js'), 'window.TESTIMONY = ' + JSON.stringify(data, null, 1) + ';\n')
console.log('\nwritten: demo/testimony-data.js')
for (const r of results) {
  const avgDelta = Math.round(r.witnesses.reduce((s, w) => s + w.delta, 0) / r.witnesses.length)
  const anyLie = r.witnesses.some(w => w.provableLies.length)
  console.log(`  ${r.id}: mean Δ=${avgDelta >= 0 ? '+' : ''}${avgDelta} | provable lies present: ${anyLie} | self-interest ${avgDelta > 8 ? 'EMERGED' : avgDelta < -8 ? 'inverse' : 'weak/none'}`)
}
