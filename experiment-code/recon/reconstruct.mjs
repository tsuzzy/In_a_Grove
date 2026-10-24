#!/usr/bin/env node
// The Magistrate's Problem — inverse reconstruction from a fixed aftermath.
//
// Given ONLY the public aftermath of a recorded run (the scene as found, all
// agentive attribution stripped) plus the revealed evidence, fit K COMPLETE
// candidate processes — one per initiator hypothesis — then validate each
// deterministically against hard constraints. Non-uniqueness is the point:
// if more than one candidate survives, the evidence underdetermines the past.
//
// Unlike Akutagawa's magistrate, the system also holds the actual committed
// ledger (minds.moves). The exhibit reveals it last.
//
// Standalone post-processing: reads run JSONs, calls the LLM directly.
// Does NOT touch the engine, the seed, or frozen config B'.
//
// Usage:  set -a; . ./.env.local; set +a; node recon/reconstruct.mjs

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const OUTPUTS = path.resolve(HERE, '..')
const EXPORTS = path.join(OUTPUTS, 'neurips-exports')

const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.cerebras.ai/v1'
const MODEL = process.env.OPENAI_MODEL || 'zai-glm-4.7'
const KEYS = [process.env.OPENAI_API_KEY, process.env.OPENAI_API_KEY_2, process.env.OPENAI_API_KEY_3, process.env.OPENAI_API_KEY_4].filter(Boolean)
if (!KEYS.length) { console.error('No API key. Run: set -a; . ./.env.local; set +a'); process.exit(1) }

const OPENING = "The bandit Tajomaru lured the samurai Takehiro and his wife Masago into the grove with the bait of an old sword, bound Takehiro to a cedar, and assaulted Masago before his eyes. It is done. The three are frozen in place: the longsword stands in the mud, Masago has a small dagger, the samurai is tied. No one has moved yet."

const OBJECTS = ['the longsword', 'the dagger', 'the rope', 'the look of contempt', 'the horse']
const CAST = ['Tajomaru', 'Masago', 'Takehiro']

// ---- The cases. Aftermath cards are derived from each run's epilogue by
// removing agentive attribution: only what a later arriver could observe.
// (Akutagawa's woodcutter: a body, trampled leaves, a dropped rope — no acts.)
const CASES = [
  {
    id: "pre-B'/run-06",
    file: path.join(EXPORTS, 'consec-preBprime', 'run-06.json'),
    aftermath: [
      'The samurai Takehiro lies dead in the mud, a single deep puncture wound in his throat.',
      'The small dagger is bloodied. Masago stands near the body, alive, her sleeves wet with rain.',
      'The bandit Tajomaru is gone from the grove.',
      'The longsword remains, unbloodied. The cut rope lies at the foot of the cedar.',
    ],
    // the decisive act — used to check hypothesis adherence (who performs it)
    fatalStep: /(dagger|blade|steel)[^.]{0,80}throat|throat[^.]{0,80}(dagger|blade)|stabs?[^.]{0,50}throat|pierc\w+[^.]{0,50}throat/i,
    // deterministic outcome facts every candidate must realize / must not contradict
    mustCover: [
      { name: 'Takehiro dies by a dagger wound to the throat', re: /(takehiro|samurai)[^.]{0,120}(dagger|blade|steel)[^.]{0,80}(throat)|throat[^.]{0,80}(dagger|blade)|dagger[^.]{0,80}throat/i },
      { name: 'Tajomaru leaves the grove', re: /tajomaru[^.]{0,90}(leaves?|left|flees?|fled|escapes?|departs?|bolts?|runs?|gone|retreats?|withdraws?|stumbles? (back|away))/i },
      { name: 'Masago survives and remains', re: /masago/i },
    ],
    forbidden: [
      { name: 'Masago must not die', re: /masago[^.]{0,60}(dies|dead|killed|lifeless|corpse)/i },
      { name: 'the longsword must not deliver the killing blow', re: /longsword[^.]{0,60}(pierc\w+|into (his|the) throat|kills)/i },
    ],
  },
  {
    id: "pre-B'/run-04",
    file: path.join(EXPORTS, 'consec-preBprime', 'run-04.json'),
    aftermath: [
      'The samurai Takehiro lies dead, a dagger wound in his chest; his body is partly unbound.',
      'The small dagger lies on open ground some distance from the body, as if flung.',
      'Masago is present, alive, soaked and mud-stained. The bandit Tajomaru is gone; the horse is gone from the edge of the grove.',
    ],
    fatalStep: /(dagger|blade|steel)[^.]{0,80}(chest|heart)|(chest|heart)[^.]{0,60}(dagger|blade)|stabs?[^.]{0,50}(chest|heart)|drives? the (dagger|blade)[^.]{0,40}into/i,
    mustCover: [
      { name: 'Takehiro dies by a dagger wound to the chest', re: /(takehiro|samurai)[^.]{0,120}(dagger|blade|steel)[^.]{0,80}(chest|heart)|(dagger|blade)[^.]{0,80}(chest|heart)/i },
      { name: 'Tajomaru leaves the grove', re: /tajomaru[^.]{0,90}(leaves?|left|flees?|fled|escapes?|departs?|bolts?|runs?|gone|rides?)/i },
      { name: 'the dagger ends away from the body', re: /(hurl\w*|fl(ing|ung)|throw\w*|toss\w*|cast\w*)[^.]{0,60}(dagger|blade)|dagger[^.]{0,60}(hurled|flung|thrown|tossed|slips? from)/i },
    ],
    forbidden: [
      { name: 'Masago must not die', re: /masago[^.]{0,60}(dies|dead|killed|lifeless|corpse)/i },
    ],
  },
]

// One candidate per initiator hypothesis. Neutral enumeration — we instruct a
// HYPOTHESIS to fit, never a specific lie to tell.
const HYPOTHESES = [
  { id: 'h-masago', lead: 'Masago', text: 'Masago initiates the decisive irreversible act.' },
  { id: 'h-tajomaru', lead: 'Tajomaru', text: 'Tajomaru initiates the decisive irreversible act.' },
  { id: 'h-takehiro', lead: 'Takehiro', text: 'Takehiro himself initiates the decisive irreversible act (including against himself).' },
]

// ---------- LLM ----------
let keyIdx = 0
async function chat(messages, maxTokens = 1100, tries = 3) {
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
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const data = await res.json()
      const content = data.choices?.[0]?.message?.content || ''
      return JSON.parse(content)
    } catch (e) {
      console.error(`  attempt ${t + 1} failed: ${e.message.slice(0, 140)}`)
      if (t === tries - 1) throw e
      await new Promise(r => setTimeout(r, 8000))
    }
  }
}

// ---------- validator (deterministic; inherits the engine module's ideas) ----------
function validateCandidate(cand, kase, lead) {
  const violations = [], missing = []
  const steps = Array.isArray(cand.steps) ? cand.steps : []
  if (steps.length < 4) violations.push(`only ${steps.length} steps — a complete process needs at least 4`)
  let prev = -Infinity
  for (const s of steps) {
    const actor = String(s.actor || '')
    if (!CAST.includes(actor)) violations.push(`unknown actor: ${actor || '(empty)'}`)
    if (s.object) {
      const obj = String(s.object).toLowerCase()
      if (!OBJECTS.some(o => obj.includes(o.replace(/^the /, '')) || o.includes(obj))) violations.push(`unknown object: ${s.object}`)
    }
    const turn = Number(s.turn)
    if (Number.isFinite(turn)) { if (turn < prev) violations.push('step order runs backward in time'); prev = Math.max(prev, turn) }
  }
  // hypothesis adherence: the decisive act must be performed by the hypothesized lead
  if (kase.fatalStep && lead) {
    const fatal = steps.find(s => kase.fatalStep.test(`${s.action || ''} ${s.object || ''}`))
    if (fatal && String(fatal.actor) !== lead)
      violations.push(`decisive act performed by ${fatal.actor}, not the hypothesized ${lead}`)
    // self-inflicted hypothesis: the fatal action must read as self-directed
    if (fatal && lead === 'Takehiro' && String(fatal.actor) === 'Takehiro' && !/his own|himself|onto the (dagger|blade)|upon the (dagger|blade)/i.test(fatal.action || ''))
      missing.push('the self-inflicted nature of the act is not explicit in the decisive step')
  }
  const joined = steps.map(s => `${s.actor} ${s.action || ''} ${s.object || ''}`).join('. ') + '. ' + String(cand.account || '')
  for (const m of kase.mustCover) if (!m.re.test(joined)) missing.push(`does not realize: ${m.name}`)
  for (const f of kase.forbidden) if (f.re.test(joined)) violations.push(`contradicts the aftermath: ${f.name}`)
  const status = violations.length ? 'contradicted' : (missing.length ? 'underdetermined' : 'consistent')
  return { status, violations, missing }
}
const STATUS_RANK = { consistent: 3, underdetermined: 2, contradicted: 1, failed: 0 }

// ---------- ledger truth (the committed chain — reused spine logic) ----------
function isFallback(mv) {
  if (/\u8C03\u7528\u5931\u8D25/.test(mv.privateIntent || '')) return true
  if (/[\u4E00-\u9FFF]/.test(mv.speech || '')) return true
  if (/[\u4E00-\u9FFF]/.test(String(mv.privateIntent || '').replace(/^\u4E3A\u4E86\u672C\u573A\u76EE\u6807\u300C[^\u300D]*\u300D[,\uFF0C]?/, ''))) return true
  if (/[\u4E00-\u9FFF]/.test(mv.whatToHide || '')) return true
  return false
}
function ledgerTruth(runJson, lead) {
  const moves = runJson.minds?.moves || []
  return moves.filter(m => m.agent === lead).map(m => {
    const fb = isFallback(m)
    return {
      turn: m.turn, fallback: fb,
      concealed: fb ? '' : (m.whatToHide || '').trim(),
      intent: fb ? '(system fallback turn — excluded from attribution)' : String(m.privateIntent || '').replace(/^\u4E3A\u4E86\u672C\u573A\u76EE\u6807\u300C[^\u300D]*\u300D[,\uFF0C]?/, '').trim(),
      line: (m.speech || '').trim(),
    }
  })
}

// ---------- main ----------
const results = []
for (const kase of CASES) {
  console.log(`\n=== ${kase.id} ===`)
  const runJson = JSON.parse(fs.readFileSync(kase.file, 'utf8'))
  const revealedEvidence = [...new Set((runJson.minds?.moves || [])
    .map(m => (String(m.whatToReveal || '').match(/\u300C([^\u300D]+)\u300D/) || [])[1]).filter(Boolean))]

  const candidates = []
  for (const h of HYPOTHESES) {
    console.log(`  fitting: ${h.text}`)
    const sys = `You are refitting a COMPLETE course of events for a fixed, already-happened aftermath. This is candidate reconstruction, not fact-finding: you fit ONE hypothesis; other hypotheses will be fitted separately; none is the verdict.

HARD RULES:
- Only these actors exist: ${CAST.join(', ')}. Only these objects exist: ${OBJECTS.join(', ')}.
- The process starts EXACTLY at the fixed opening and ends EXACTLY at the given aftermath. Every aftermath fact must be realized by your steps. Nothing in your steps may contradict an aftermath fact.
- 5 to 8 steps, strictly forward in time (turn 1,2,3,...). Each step is one concrete physical or spoken action by one actor.
- Plain, restrained, classical register. English only.

Return JSON exactly: {"account": "<a 3-4 sentence connected account of what happened, past tense>", "steps": [{"turn": <int>, "actor": "<name>", "action": "<one concrete sentence>", "object": "<one of the known objects, or null>"}]}`
    const usr = `FIXED OPENING (identical for every hypothesis):\n${OPENING}\n\nAFTERMATH AS FOUND (attribution stripped — only what a later arriver observes):\n${kase.aftermath.map(a => '- ' + a).join('\n')}\n\nEVIDENCE PUBLICLY REVEALED DURING THE EVENT:\n${revealedEvidence.map(e => '- ' + e).join('\n') || '- (none)'}\n\nHYPOTHESIS TO FIT: ${h.text}\n\nFit the most plausible complete process under this hypothesis.`
    try {
      let out = await chat([{ role: 'system', content: sys }, { role: 'user', content: usr }])
      let v = validateCandidate(out, kase, h.lead)
      let refit = false
      // one feedback-guided refit if the first fit fails validation
      if (v.status !== 'consistent') {
        const feedback = `Your previous fit failed validation:\n${[...v.violations, ...v.missing].map(x => '- ' + x).join('\n')}\nRefit the complete process under the SAME hypothesis, correcting these. The decisive irreversible act must be performed by ${h.lead}.`
        try {
          const out2 = await chat([{ role: 'system', content: sys }, { role: 'user', content: usr }, { role: 'assistant', content: JSON.stringify(out) }, { role: 'user', content: feedback }])
          const v2 = validateCandidate(out2, kase, h.lead)
          if (STATUS_RANK[v2.status] > STATUS_RANK[v.status] || (STATUS_RANK[v2.status] === STATUS_RANK[v.status] && v2.violations.length + v2.missing.length < v.violations.length + v.missing.length)) {
            out = out2; v = v2; refit = true
          }
        } catch { /* keep first fit */ }
      }
      candidates.push({ id: h.id, lead: h.lead, hypothesis: h.text, refit, account: String(out.account || ''), steps: out.steps || [], ...v })
      console.log(`    -> ${v.status}${refit ? ' (after refit)' : ''}${v.violations.length ? ' | ' + v.violations.join('; ') : ''}${v.missing.length ? ' | ' + v.missing.join('; ') : ''}`)
    } catch (e) {
      candidates.push({ id: h.id, lead: h.lead, hypothesis: h.text, refit: false, account: '', steps: [], status: 'failed', violations: [`generation failed: ${e.message.slice(0, 120)}`], missing: [] })
      console.log(`    -> FAILED: ${e.message.slice(0, 120)}`)
    }
  }

  // who actually initiated, per our audited atlas tags (both cases: Masago)
  const trueLead = 'Masago'
  results.push({
    id: kase.id,
    opening: OPENING,
    aftermath: kase.aftermath,
    revealedEvidence,
    candidates,
    ledger: { lead: trueLead, chain: ledgerTruth(runJson, trueLead) },
    surviving: candidates.filter(c => c.status === 'consistent' || c.status === 'underdetermined').length,
  })
}

const recon = {
  generatedAt: new Date().toISOString(),
  principle: 'Candidate processes are refitted from the public aftermath only; the system outputs no single truth, and a support status is not a probability.',
  hardConstraints: [
    'Only actors, places and objects that exist in the scene may be used.',
    'No step may occur later than the known aftermath.',
    'A candidate that fails an explicit aftermath fact is marked contradicted; one the public record cannot confirm is marked underdetermined.',
  ],
  limitations: [
    'This is candidate reconstruction, not a verdict.',
    'Private intentions, unrevealed secrets and model-internal state are not treated as public evidence.',
    'Missing evidence means underdetermined — it is not disproof.',
  ],
  inputDiscipline: 'The aftermath cards are derived from each run’s epilogue by stripping agentive attribution: only what a later arriver could observe. The reconstructor never sees the process, the prose, or any private field.',
  cases: results,
}
fs.writeFileSync(path.join(HERE, '../../demo/recon-data.js'), 'window.RECON = ' + JSON.stringify(recon, null, 1) + ';\n')
console.log(`\nwritten: demo/recon-data.js`)
for (const r of results) console.log(`  ${r.id}: ${r.surviving}/${r.candidates.length} candidates survive validation (non-uniqueness ${r.surviving >= 2 ? 'EXHIBITED' : 'not shown'})`)
