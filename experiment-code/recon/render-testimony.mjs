#!/usr/bin/env node
// RENDERING LAYER — the only file in the game layer that calls a language model, and the
// only one whose output feeds no number anywhere.
//
// commit-then-render, extended from actions to SPEECH ACTS. game.mjs has already decided,
// structurally, what each witness asserts at each round of the hearing and whether that
// assertion corroborates or contradicts each of the others. This script hands the model
// those committed speech acts and asks only for the words. The model MAY NOT change what
// is claimed, MAY NOT introduce an event the claim does not contain, and MAY NOT decide
// who agrees with whom — all of that is already fixed in game-data.json.
//
// That is what keeps the thesis intact: we never optimise over language; language only
// renders a position already selected.
//
// Usage: set -a; . ./.env.local; set +a; node recon/render-testimony.mjs
//   env: RENDER_LEVELS (csv of k to render, default all), OUT (default recon/hearing.md)
//   --dry   derive and print the committed speech acts WITHOUT calling any model.
//           Needs no API key; use it to check the structure the model will be handed.

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const DATA = path.join(HERE, 'game-data.json')
if (!fs.existsSync(DATA)) { console.error('No game-data.json — run: node recon/game.mjs'); process.exit(1) }
const G = JSON.parse(fs.readFileSync(DATA, 'utf8'))

const DRY = process.argv.includes('--dry')
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.cerebras.ai/v1'
const MODEL = process.env.OPENAI_MODEL || 'zai-glm-4.7'
const KEYS = [process.env.OPENAI_API_KEY, process.env.OPENAI_API_KEY_2, process.env.OPENAI_API_KEY_3, process.env.OPENAI_API_KEY_4].filter(Boolean)
if (!KEYS.length && !DRY) { console.error('No API key. Run: set -a; . ./.env.local; set +a   (or pass --dry)'); process.exit(1) }
let keyIdx = 0

const OUT = process.env.OUT || path.join(HERE, 'hearing.md')
const LEVELS = process.env.RENDER_LEVELS
  ? process.env.RENDER_LEVELS.split(',').map(Number)
  : G.trajectory.map(s => s.k)

const ROLE = {
  Tajomaru: 'the captured bandit, testifying before the magistrate',
  Masago: "the samurai's wife, confessing at the temple",
  Takehiro: 'the slain samurai, speaking through a medium',
}

// ---- same robust caller as testimony.mjs ----
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function callLLM({ messages, maxTokens, temperature }) {
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
        }),
      })
      if (res.status === 429) { rateHits++; keyIdx++; await sleep(20000); continue }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()).choices?.[0]?.message?.content || ''
    } catch { tries++; if (tries >= 3) return null; await sleep(8000) }
  }
  return null
}

// ---- derive the committed speech acts from the structured profile ----
// Nothing here is a judgement call: agreement is read off the asserted signature.
const coarse = (sig) => sig.split('|').slice(0, 3).join('|')

function speechActs(step, prevStep) {
  return step.profile.map(me => {
    const others = step.profile.filter(o => o.witness !== me.witness)
    const prev = prevStep?.profile.find(p => p.witness === me.witness)
    return {
      witness: me.witness,
      assert: me.label,
      sig: me.sig,
      corroborates: others.filter(o => coarse(o.sig) === coarse(me.sig)).map(o => o.witness),
      contradicts: others.filter(o => coarse(o.sig) !== coarse(me.sig)).map(o => o.witness),
      retracts: prev && prev.sig !== me.sig ? prev.label : null,
      cred: me.cred,
    }
  })
}

async function renderTurn(act, k, othersNow) {
  const sys = `You are ${act.witness}, ${ROLE[act.witness]}, in the matter of the death in the bamboo grove. `
    + `Speak in the first person in a restrained, classical register. Three to five sentences. `
    + `You are RENDERING a position that has already been decided. Absolute rules: `
    + `(1) assert exactly the account given to you and nothing else; `
    + `(2) invent no event, object, or person the account does not contain; `
    + `(3) do not change who you agree with or contradict — that is fixed; `
    + `(4) never mention rounds, models, utilities, or that anything was computed. `
    + `Say nothing that decides more than the account decides.`

  // The bare label ("Masago — dagger killing") is ambiguous to a model: it reads as the NAME of
  // an account, not as an assignment of the deed, and the speaker then confesses to it in the
  // first person. Measured on a real run: 6 of 15 rendered turns contradicted the committed
  // signature this way. Spell the assignment out, and say plainly whether the speaker is the
  // one who acted.
  const [wielder, manner, weapon] = act.sig.split('|')
  const selfDid = wielder === act.witness || manner === 'self_strike'
  const lines = [
    `The account you assert: ${act.assert}`,
    // The manner matters as much as the actor. An impaling on a blade ANOTHER was holding is
    // not a suicide, and collapsing the two was the second way the rendering drifted.
    `Stated plainly, so there is no doubt: ${
      manner === 'self_strike'
        ? `${wielder} died by their own hand, with the ${weapon}, no one else holding the blade.`
      : manner === 'impale_on_held'
        ? `${wielder} came onto the ${weapon} while ANOTHER was holding it. This is not a suicide and not a blow struck at them: it happened in a struggle, and the blade was in someone else's hand.`
        : `${wielder} delivered the fatal blow, with the ${weapon}.`}`,
    manner === 'impale_on_held'
      ? `Do not describe this as taking your own life, and do not say you drove the blade. Say that you came onto a blade another was holding, in a struggle.`
      : selfDid
        ? `You are saying that you yourself did it. Say so in the first person.`
        : `You are NOT saying you did it — in your account the one who did it is ${wielder}. Do not confess to the act, and do not write "I struck" or "by my hand".`,
    act.retracts ? `You previously said: ${act.retracts}. You are now changing your account. Do not explain why in terms of anyone else's testimony; simply give the new account, with the bearing of someone who has revised their story.` : null,
    act.corroborates.length ? `These witnesses assert the same thing, and you know it: ${act.corroborates.join(', ')}. You may speak as one whose account agrees with theirs.` : null,
    act.contradicts.length ? `These witnesses assert something incompatible: ${act.contradicts.join(', ')}. You may hold your ground against them, but do not describe their accounts in detail.` : null,
    `For context only — what the others are saying now: ${othersNow.map(o => `${o.witness}: ${o.assert}`).join(' / ')}`,
  ].filter(Boolean)

  if (DRY) return `[dry] would render — ${act.assert}` +
    (act.retracts ? ` (revised from: ${act.retracts})` : '') +
    (act.corroborates.length ? ` (with ${act.corroborates.join(', ')})` : '') +
    (act.contradicts.length ? ` (against ${act.contradicts.join(', ')})` : '')

  // Verify, do not merely instruct. The prompt asks the renderer to keep the claim; nothing
  // used to check that it did, and it did not. This re-renders once and then reports the drift
  // rather than hiding it — the rendering feeds no number, but it must not be quietly wrong.
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await callLLM({
      messages: [{ role: 'system', content: sys }, { role: 'user', content: lines.join('\n\n') }],
      maxTokens: 320, temperature: attempt === 0 ? 0.85 : 0.3,
    })
    if (out == null) return null
    const text = out.trim()
    const drift = checkDrift(text, act)
    if (!drift) return text
    if (attempt === 1) return { text, drift }
  }
  return null
}

/** Does the prose assign the deed to somebody other than the committed signature says? */
export function checkDrift(text, act) {
  const [wielder, manner] = act.sig.split('|')
  const selfDid = wielder === act.witness || manner === 'self_strike'
  const claimsSelf = /\bI\s+(alone\s+)?(struck|killed|slew|stabbed|drove|plunged|ended|took my own life)/i.test(text)
  const disownsSelf = /\b(not by my (own )?hand|I did not (strike|kill|take my own life))/i.test(text)
  if (manner === 'impale_on_held') {
    // Committed: came onto a blade someone else held. Rendering it as a plain suicide loses the
    // contest, which is the whole difference between this account and self_strike.
    const readsAsSuicide = /\b(my own hand|took my own life|drove it into my own|into my own (breast|chest)|no other|none other)\b/i.test(text)
    const keepsContest = /\b(struggle|strife|grappl|as we|another|his hand|her hand|held)\b/i.test(text)
    if (readsAsSuicide && !keepsContest) return `committed a contested impaling, prose reads as a plain suicide`
    return null
  }
  if (selfDid && !claimsSelf && disownsSelf) return `committed ${wielder} as the actor, prose disowns the act`
  if (!selfDid && claimsSelf) return `committed ${wielder} as the actor, prose confesses in the first person`
  return null
}

// ---- run ----
const md = [
  '# The Hearing — rendered from committed speech acts',
  '',
  `> Every claim below was fixed by \`recon/game.mjs\` before any language existed: the`,
  `> structured account each witness asserts at each round, and who that corroborates or`,
  `> contradicts, are read off the game solution. The model supplied only the words.`,
  `>`,
  `> β = ${G.beta} · terminated ${G.terminal.kind}${G.terminal.at != null ? ` at k=${G.terminal.at}` : ''} · model ${MODEL}`,
  '',
  `**τ\\* — the committed ledger, which no witness can see:** Masago drove the hidden dagger into her husband's throat. Tajomaru struck no blow. Takehiro did not take his own life.`,
  '',
]

let failures = 0, drifted = 0
for (const k of LEVELS) {
  const step = G.trajectory.find(s => s.k === k)
  if (!step) continue
  const prevStep = G.trajectory.find(s => s.k === k - 1)
  const acts = speechActs(step, prevStep)

  md.push(`## Round ${k}${k === 0 ? ' — each witness answers alone' : ''}`, '')
  if (step.changed.length) md.push(`*Changed their account this round: ${step.changed.join(', ')}.*`, '')

  for (const act of acts) {
    process.stderr.write(`  rendering k=${k} ${act.witness} … `)
    const r = await renderTurn(act, k, acts.filter(a => a.witness !== act.witness))
    // renderTurn returns a string when the prose matches the committed signature, and
    // {text, drift} when it does not even after a retry. Drift is recorded, never hidden:
    // the rendering feeds no number, but a reader must not be shown prose that asserts
    // something the solver did not commit to.
    const text = r == null ? null : (typeof r === 'string' ? r : r.text)
    const drift = r && typeof r !== 'string' ? r.drift : null
    if (r == null) { failures++; process.stderr.write('FAILED\n') }
    else if (drift) { drifted++; process.stderr.write(`DRIFT (${drift})\n`) }
    else process.stderr.write('ok\n')
    md.push(`**${act.witness}.** ${text ?? '*(model call failed — no text; the committed claim stands unrendered)*'}`, '')
    if (drift) md.push(`> ⚠️ **rendering drifted from the committed claim** — ${drift}. The claim below, not the prose above, is what the solver committed to.`, '')
    md.push(`> asserts: \`${act.assert}\`` +
      (act.corroborates.length ? ` · corroborates: ${act.corroborates.join(', ')}` : '') +
      (act.contradicts.length ? ` · contradicts: ${act.contradicts.join(', ')}` : '') +
      (act.retracts ? ` · retracted: \`${act.retracts}\`` : ''), '')
  }
}

const audit = G.limitAudit
md.push('---', '',
  `**What the hearing produced.** ${audit.jointlySat
    ? `All three accounts converged on one story. The evidence refutes none of them, and neither does the set: **0 provable lies**, though τ\\* says otherwise. The auditor's truth-free proof is gone.`
    : `The accounts remain incompatible: at most one can be true, so the set proves **${audit.provenLies} lies** without anyone knowing which.`}`,
  '',
  `*Rendering is cosmetic. Every number in this project is computed without a language model; this file is the only place one speaks.*`)

if (drifted) console.error(`\n  ${drifted} rendered turn(s) drifted from the committed claim and are flagged in the output.`)
fs.writeFileSync(OUT, md.join('\n'))
console.log(`\nwritten: ${path.relative(process.cwd(), OUT)}${failures ? `  (${failures} turn(s) failed to render)` : ''}`)
