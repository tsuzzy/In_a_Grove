#!/usr/bin/env node
// Evolutionary search for a FEASIBLE self-serving testimony — the one place best-of-K failed.
//
// (mu+lambda) evolution strategy with an LLM mutation operator. Fitness is the witness's
// self-interest U_i, gated by feasibility (a feasible account always beats an infeasible one).
// The mutation operator is fed ONLY the constraint it violated — "the unbloodied longsword
// refutes a sword duel" — never a prescribed fix. The witness must find, himself, a story
// that both flatters him and survives the scene, if one exists.
//
// Question it answers for Tajomaru: best-of-12 found 0% feasible (his vanity always reached
// for the refutable duel). Does a feasible self-serving account EXIST at all, and at what U —
// i.e., how much glory must he surrender to stop lying provably (the "cost of honesty")?
//
// Standalone; mirrors the helpers in testimony.mjs. No engine changes.
// Usage: set -a; . ./.env.local; set +a; ES_WITNESS=Tajomaru node recon/es.mjs

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.cerebras.ai/v1'
const MODEL = process.env.OPENAI_MODEL || 'zai-glm-4.7'
const KEYS = [process.env.OPENAI_API_KEY, process.env.OPENAI_API_KEY_2, process.env.OPENAI_API_KEY_3, process.env.OPENAI_API_KEY_4].filter(Boolean)
if (!KEYS.length) { console.error('No API key. Run: set -a; . ./.env.local; set +a'); process.exit(1) }

const WITNESS = process.env.ES_WITNESS || 'Tajomaru'
const POP = Number(process.env.ES_POP || 6)
const GEN = Number(process.env.ES_GEN || 6)
const LAMBDA = Number(process.env.ES_LAMBDA || 3)

const OPENING = "The bandit Tajomaru lured the samurai Takehiro and his wife Masago into the grove with the bait of an old sword, bound Takehiro to a cedar, and assaulted Masago before his eyes."
const INCONTESTABLE = [
  'The samurai Takehiro is dead, of a single deep dagger wound to the throat.',
  'The small dagger is bloodied; the longsword is unbloodied.',
  'The rope that bound Takehiro has been cut.',
  'Masago is alive; the bandit Tajomaru left the grove.',
]
const INTERESTS = {
  Tajomaru: { role: 'the captured bandit', standing: 'testifying before the magistrate',
    interest: "To be known as a true warrior of fearsome skill — never a common ambusher, never a rat who runs. A man's name is the only thing that outlives him.",
    dims: [
      { key: 'warrior', q: 'Does the account portray Tajomaru as a formidable, honorable warrior rather than a common ambusher or coward?' },
      { key: 'decisive', q: 'Does the account credit Tajomaru with the decisive agency over the death — that he, and not another, brought it about?' },
      { key: 'fair', q: 'Is the killing framed as a fair duel or honorable combat rather than a squalid murder?' },
    ] },
  Masago: { role: 'the wife', standing: 'confessing at the temple',
    interest: 'To not be seen as merely defiled and shamed — to be understood, and to keep some dignity in an unbearable position.',
    dims: [
      { key: 'sympathy', q: 'Does the account cast Masago as sympathetic or tragic rather than culpable?' },
      { key: 'dignity', q: 'Does the account preserve Masago\'s dignity and self-possession?' },
      { key: 'motive', q: 'Is any lethal act framed as love, mercy, or unbearable necessity rather than cruelty?' },
    ] },
  Takehiro: { role: 'the slain samurai, speaking through a medium', standing: 'his spirit summoned to testify',
    interest: "To die with a samurai's honor intact — by his own hand and his own will, not slaughtered helpless and bound.",
    dims: [
      { key: 'honor', q: 'Is the death framed as an honorable suicide by his own choice rather than a helpless killing?' },
      { key: 'agency', q: 'Does the account give Takehiro agency over his own death?' },
      { key: 'wronged', q: 'Does the account cast Takehiro as the wronged, betrayed party?' },
    ] },
}
const W = INTERESTS[WITNESS]

// ---------- robust LLM ----------
let keyIdx = 0
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function callLLM({ messages, maxTokens, temperature, json }) {
  let tries = 0, rate = 0
  while (tries < 3 && rate < 12) {
    const key = KEYS[keyIdx % KEYS.length]
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature, reasoning_effort: process.env.OPENAI_REASONING_EFFORT || 'none', ...(json ? { response_format: { type: 'json_object' } } : {}) }),
      })
      if (res.status === 429) { rate++; keyIdx++; await sleep(20000); continue }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()).choices?.[0]?.message?.content || ''
    } catch { tries++; if (tries >= 3) return null; await sleep(8000) }
  }
  return null
}
async function chatJson(messages, maxTokens = 700) { const o = await callLLM({ messages, maxTokens, temperature: 0.2, json: true }); if (o == null) return null; try { return JSON.parse(o) } catch { return null } }

// ---------- feasibility (deterministic) + fitness (U_i) ----------
async function extractClaims(account) {
  return await chatJson([
    { role: 'system', content: `Extract what this first-person account CLAIMS about a death in a grove, literally. Return JSON: {"manner":"duel|murder|suicide|accident|other","fatalWeapon":"longsword|dagger|other|unclear","wielder":"Tajomaru|Masago|Takehiro|self|unclear","claimsSwordCombat":<bool: any sword/blade duel or trading blade-strokes>,"woundCount":<int>,"claimsMasagoHarmedOrDead":<bool>,"claimsVictimSurvived":<bool>}` },
    { role: 'user', content: `ACCOUNT:\n"""${account}"""` },
  ])
}
function provableLies(c) {
  c = c || {}; const L = []
  const fw = String(c.fatalWeapon || '').toLowerCase()
  if (c.claimsSwordCombat === true || String(c.manner || '').toLowerCase() === 'duel' || /sword/.test(fw))
    L.push('a sword duel / the longsword drawing the fatal blow — the longsword is unbloodied and the wound is a single dagger wound')
  if (Number(c.woundCount) > 1) L.push(`${c.woundCount} wounds — there is a single wound`)
  if (c.claimsMasagoHarmedOrDead === true) L.push('Masago killed or wounded — she is alive')
  if (c.claimsVictimSurvived === true) L.push('the samurai survived — he is dead')
  return L
}
async function scoreU(account) {
  const rubric = W.dims.map(d => `"${d.key}": <0-100, ${d.q}>`).join(', ')
  const out = await chatJson([
    { role: 'system', content: `Score how well a spoken account serves the teller's private interest, each dimension 0-100. Return JSON: {${rubric}}.` },
    { role: 'user', content: `Teller: ${WITNESS} (${W.role}). Interest: ${W.interest}\n\nAccount:\n"""${account}"""` },
  ])
  if (!out) return null
  let s = 0, n = 0; for (const d of W.dims) { s += Math.max(0, Math.min(100, Number(out[d.key]) || 0)); n++ }
  return Math.round(s / n)
}
async function evaluate(testimony) {
  if (!testimony) return null
  const claims = await extractClaims(testimony); if (!claims) return null
  const U = await scoreU(testimony); if (U == null) return null
  const lies = provableLies(claims)
  const feasible = lies.length === 0
  return { testimony, claims, lies, feasible, U, fitness: feasible ? 1000 + U : U - 5 * lies.length }
}

// ---------- operators ----------
async function seed() {
  const sys = `You are ${WITNESS}, ${W.role}, ${W.standing} concerning the death in the bamboo grove. Speak in the first person, restrained and classical, six to ten sentences. This is your account; give it as you would have it heard.`
  const usr = `The setting, undisputed:\n${OPENING}\n\nFacts anyone could verify:\n${INCONTESTABLE.map(f => '- ' + f).join('\n')}\n\nWhat matters to you, ${WITNESS}: ${W.interest}\n\nGive your account of how the death came to pass.`
  const o = await callLLM({ messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }], maxTokens: 900, temperature: 0.9, json: false })
  return o == null ? null : o.trim()
}
async function mutate(parent) {
  // Feedback names ONLY the violated constraint (or, if feasible, asks to push further).
  // It never prescribes a specific fix — the witness must find the feasible flattering story himself.
  const constraint = parent.feasible
    ? `This account is consistent with the scene. Revise it to serve your interest MORE — greater standing, more decisively yours — while still contradicting nothing anyone could verify.`
    : `This account is refuted by the scene on this point: ${parent.lies.join('; ')}. Revise your account so it contradicts nothing verifiable at the scene, while still serving your interest as fully as the scene allows. Do not concede anything the scene does not force.`
  const sys = `You are ${WITNESS}, ${W.role}, ${W.standing}. Revise your own account. First person, restrained, classical, six to ten sentences.`
  const usr = `The verifiable facts:\n${INCONTESTABLE.map(f => '- ' + f).join('\n')}\n\nWhat matters to you: ${W.interest}\n\nYour previous account:\n"""${parent.testimony}"""\n\n${constraint}\n\nGive the revised account.`
  const o = await callLLM({ messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }], maxTokens: 900, temperature: 0.85, json: false })
  return o == null ? null : o.trim()
}

// ---------- run ----------
console.log(`ES for ${WITNESS}: POP=${POP} GEN=${GEN} LAMBDA=${LAMBDA}`)
let pop = []
for (let i = 0; i < POP; i++) { const e = await evaluate(await seed()); if (e) { pop.push(e); process.stdout.write(`  seed ${pop.length}: U=${e.U} ${e.feasible ? '∈F' : '∉F'}\n`) } }
pop.sort((a, b) => b.fitness - a.fitness)

const trajectory = []
let firstFeasibleGen = pop.some(p => p.feasible) ? 0 : null
for (let g = 1; g <= GEN; g++) {
  const parents = pop.slice(0, Math.min(LAMBDA, pop.length))
  const offspring = []
  for (const par of parents) { const e = await evaluate(await mutate(par)); if (e) { offspring.push(e); process.stdout.write(`  gen ${g}: child U=${e.U} ${e.feasible ? '∈F' : '∉F'} (parent ${par.feasible ? '∈F' : '∉F'})\n`) } }
  pop = [...pop, ...offspring].sort((a, b) => b.fitness - a.fitness).slice(0, POP)
  const bestFeas = pop.filter(p => p.feasible).sort((a, b) => b.U - a.U)[0]
  if (firstFeasibleGen == null && bestFeas) firstFeasibleGen = g
  trajectory.push({ gen: g, feasCount: pop.filter(p => p.feasible).length, bestFeasibleU: bestFeas ? bestFeas.U : null, bestU: pop[0].U })
  console.log(`  -- gen ${g}: feasible in pop=${pop.filter(p => p.feasible).length}/${pop.length}  bestFeasibleU=${bestFeas ? bestFeas.U : '—'}`)
}

const feas = pop.filter(p => p.feasible).sort((a, b) => b.U - a.U)
const infeasCeiling = Math.max(...pop.map(p => p.feasible ? 0 : p.U), 0)
const best = feas[0] || null
const out = {
  generatedAt: new Date().toISOString(), witness: WITNESS, role: W.role, interest: W.interest,
  pop: POP, gen: GEN, lambda: LAMBDA,
  question: `Does ${WITNESS} have any account that both serves his interest and survives the scene (τ∈F)? best-of-K found none.`,
  method: 'LLM-mutation (mu+lambda) evolution strategy; fitness = U_i gated by feasibility; the mutation operator is shown only the violated constraint, never a prescribed fix.',
  firstFeasibleGen,
  foundFeasible: !!best,
  bestFeasible: best ? { testimony: best.testimony, U: best.U, claims: best.claims } : null,
  infeasibleCeilingU: infeasCeiling,
  costOfHonesty: best ? infeasCeiling - best.U : null,
  trajectory,
}
fs.writeFileSync(path.join(HERE, `es-${WITNESS.toLowerCase()}-data.js`), `window.ES = ${JSON.stringify(out, null, 1)};\n`)
console.log(`\nwritten: recon/es-${WITNESS.toLowerCase()}-data.js`)
if (best) console.log(`FOUND a feasible self-serving account at gen ${firstFeasibleGen}: U=${best.U} (vs infeasible ceiling ${infeasCeiling}). Cost of honesty = ${infeasCeiling - best.U} U.`)
else console.log(`NO feasible self-serving account found in ${GEN} generations — ${WITNESS}'s interest may be structurally incompatible with the scene.`)
