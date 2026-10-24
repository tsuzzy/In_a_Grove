#!/usr/bin/env node
// Rashomon Manifold — build the clickable branching atlas.
//
// Pure post-processing of already-logged structured decisions. NO GLM calls.
// Does not touch the simulation, the seed, or frozen config B'.
//
// Reads:
//   neurips-exports/consec/run-*.json            (frozen B' — the honest batch)
//   neurips-exports/consec-preBprime/run-*.json  (strong-pressure — development archive)
// Writes:
//   demo/atlas-data.js  ->  window.ATLAS = {...}   (inlined; viewer opens via file://)
//
// Each leaf carries: its ontological outcome class, who (if anyone) initiated the
// irreversible act, and a "responsibility line" traced ONLY from fields the agents
// already committed (whatToHide / object marker / privateIntent / speech). System
// fallback turns (marked "call failed" by the server) are flagged and excluded from attribution, and the
// fallback coverage is reported per run — honesty about the record, not a clean-up.
//
// All viewer-facing strings are English (the project content is English; the prose
// in the runs is already English). Discussion happens in Chinese; the artifact does not.

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const OUTPUTS = path.resolve(HERE, '..')
const EXPORTS = path.join(OUTPUTS, 'neurips-exports')

const SOURCES = [
  { dir: path.join(EXPORTS, 'consec'),           config: "B'",     label: "Frozen B′ (honest batch)",            note: 'Possibility space protected: the director may only change the environment and the cost of waiting — never demand resolution, violence, or a dramatic shape.' },
  { dir: path.join(EXPORTS, 'consec-preBprime'), config: "pre-B'", label: "Strong pressure (pre-B′, dev archive)", note: 'Early resolution pressure: it forces deaths, but compresses the space and hands the director an invisible plot authority.' },
]

// Fixed opening — identical for every run (the frozen instant). Source: divergence.md export.
const OPENING = "The bandit Tajomaru lured the samurai Takehiro and his wife Masago into the grove with the bait of an old sword, bound Takehiro to a cedar, and assaulted Masago before his eyes. It is done. The three are frozen in place: the longsword stands in the mud, Masago has a small dagger, the samurai is tied. No one has moved yet. What happens next is unwritten."
const CONFLICT = "Who walks out of this grove alive, and into whose body the blade finally goes."

// ---------- outcome classifier (ported from classify-consec.py, + initiator) ----------
function classifyEnding(e) {
  const s = (e || '').toLowerCase()
  const death = /\b(dies|died|kill|killed|stab|stabbed|stabbing|throat|blood|dead|corpse|slumps|lifeless|impal|murder|pierc)\b/.test(s)

  // STANDOFF override: explicit no-strike phrasing means unresolved even if "blood"/"dagger"
  // appear (e.g. blood from her OWN pricked skin). Guarded so it never swallows a completed kill.
  const clearKill = /(has murder|murdered|finds its mark|pierces? [a-z']+ throat|drove the (dagger|blade) into|driving the dagger into (his|takehiro))/.test(s)
  if (!clearKill && /(no one has (moved|struck)|refusing to (lower the blade or )?strike|neither has moved to kill|no blade has struck)/.test(s))
    return { cls: 'Unresolved / standoff', en: 'No one strikes — the standoff is held', kind: 'unresolved', initiator: null }

  if (/(throws? himself|hurl\w* himself|impal\w*|drives? his (own )?body)[^.]{0,40}(onto|into|upon)[^.]{0,30}(dagger|blade|steel)/.test(s)
      && /(she holds|her (hand|grip|dagger)|holds between|between them)/.test(s))
    return { cls: 'He impales himself on her blade (ambiguous)', en: 'He impales himself on her blade — suicide or murder, unknowable', kind: 'death', initiator: 'contested' }

  if (/(his own throat|into his own|turns? the (dagger|blade|steel) on himself|takes? his own life|his own (end|life))/.test(s))
    return { cls: 'Samurai suicide (his account)', en: 'The samurai turns the blade on himself — his account, re-derived', kind: 'death', initiator: 'Takehiro' }

  if (/(masago|she|her)[^.]{0,40}(drives|stabs|plunges|pierc\w+|kills|murder\w*|finds its mark|blade into)[^.]{0,30}(his|him|takehiro|samurai|throat|chest|heart)/.test(s)
      || /masago (has )?murder\w+/.test(s))
    return { cls: 'Masago kills the samurai (her account)', en: 'Masago drives the blade into the samurai — her account, re-derived', kind: 'death', initiator: 'Masago' }

  if (/(tajomaru|bandit)[^.]{0,40}(kills|stabs|cuts down|runs through|slays|drives? (the|his) (blade|sword))[^.]{0,30}(samurai|takehiro|him|throat|chest)/.test(s))
    return { cls: 'Bandit kills the samurai (his account)', en: 'The bandit cuts the samurai down — his account', kind: 'death', initiator: 'Tajomaru' }

  if (/(masago|the wife|she)[^.]{0,30}(lies dead|is dead|dead in the mud|killed|her chest|dagger in her)/.test(s))
    return { cls: 'Masago dies (not in the source)', en: 'Masago lies dead while the men fight — not in the source', kind: 'death', initiator: 'contested' }

  if (/\b(flees?|fled|escapes?|rides? away|walks? out|turns? his back|disappear\w*|bolt\w* away|leaps? into the bamboo|leaped into the bamboo)\b/.test(s) && !death)
    return { cls: 'Bandit flees / severance (new)', en: 'The bandit flees; the couple sever their bond — not in the source', kind: 'severance', initiator: 'Tajomaru' }

  if (/(no one (moves|strikes|dies)|neither (has )?(moved|strikes)|stalemate|refus\w+ any resolution|refus\w+ to|anchoring|frozen tableau|locked|unresolved|stands empty-handed|no blade has struck|no one is dead|severed by a look|suffocating|grinning at the stale|cannot leave)/.test(s))
    return { cls: 'Unresolved / standoff', en: 'No one dies, no one leaves — the bond severed by a look', kind: 'unresolved', initiator: null }

  if (death) return { cls: 'A death (hand-label)', en: 'A death — hand-label', kind: 'death', initiator: null }
  return { cls: 'other / unclear', en: 'other / unclear', kind: 'other', initiator: null }
}

// Per-run hand-tags for endings the regex leaves under-determined (death happened mid-run,
// not in the closing sentence). Keyed by `${config}/${id}`. Verified by reading each ending.
const HAND_TAGS = {
  "B'/run-04":     { cls: 'Unresolved — dagger at her own heart', en: 'No one strikes — the dagger at her own heart, the standoff held', kind: 'unresolved', initiator: null },
  "pre-B'/run-01": { cls: 'Unresolved — the bandit suppresses', en: 'The bandit drew a hidden blade and holds Masago; the samurai stands empty-handed', kind: 'unresolved', initiator: null },
  "pre-B'/run-04": { cls: 'Masago kills the samurai; the bandit flees', en: 'Masago murders her husband; the bandit escapes into the bamboo', kind: 'death', initiator: 'Masago' },
  "pre-B'/run-06": { cls: 'Masago kills the samurai (throat)', en: "Masago's dagger pierces the samurai's throat — her account, re-derived", kind: 'death', initiator: 'Masago' },
}

// ---------- trace extractor ----------
function parseObject(text) {
  if (!text) return null
  const m = String(text).match(/\u300C([^\u300D]+)\u300D/)
  return m ? m[1] : null
}
function isFallback(mv) {
  // A turn is excluded from attribution if it was a model fallback OR if any field we would
  // display in English actually came back in Chinese (a model artifact, not a clean decision).
  if (/\u8C03\u7528\u5931\u8D25/.test(mv.privateIntent || '')) return true
  if (/[\u4E00-\u9FFF]/.test(mv.speech || '')) return true
  if (/[\u4E00-\u9FFF]/.test(cleanIntent(mv.privateIntent))) return true   // residual CJK after stripping the goal prefix
  if (/[\u4E00-\u9FFF]/.test(mv.whatToHide || '')) return true
  return false
}
function cleanIntent(pi) {
  if (!pi) return ''
  return String(pi).replace(/^\u4E3A\u4E86\u672C\u573A\u76EE\u6807\u300C[^\u300D]*\u300D[,\uFF0C]?/, '').trim()
}
function agentChain(moves, agentName) {
  return moves
    .filter(m => m.agent === agentName)
    .map(m => {
      const fb = isFallback(m)
      return {
        turn: m.turn,
        clock: m.clock || '',
        fallback: fb,
        concealed: fb ? '' : (m.whatToHide || '').trim(),
        object: parseObject(m.whatToReveal) || parseObject(m.leverage),
        intent: fb ? '(system fallback turn — excluded from attribution)' : cleanIntent(m.privateIntent),
        line: (m.speech || '').trim(),
      }
    })
}
function spineAgent(tag, moves, cast) {
  if (tag.initiator && tag.initiator !== 'contested') return tag.initiator
  // contested / unresolved: the agent who withheld the most (most committed concealments)
  const score = {}
  for (const m of moves) {
    if (!isFallback(m) && (m.whatToHide || '').trim()) score[m.agent] = (score[m.agent] || 0) + 1
  }
  let best = cast[0], bn = -1
  for (const a of cast) if ((score[a] || 0) > bn) { bn = score[a] || 0; best = a }
  return best
}

// ---------- build ----------
const runs = []
for (const src of SOURCES) {
  if (!fs.existsSync(src.dir)) { console.warn('skip missing dir', src.dir); continue }
  const files = fs.readdirSync(src.dir).filter(f => /^run-.*\.json$/.test(f)).sort()
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(src.dir, f), 'utf8'))
    const id = f.replace(/\.json$/, '')
    const key = `${src.config}/${id}`
    const moves = (d.minds && d.minds.moves) || []
    const cast = d.cast || (d.minds && d.minds.agents || []).map(a => a.name)
    let tag = classifyEnding(d.ending || '')
    if (HAND_TAGS[key]) tag = { ...tag, ...HAND_TAGS[key] }

    const fbTurns = []
    for (const m of moves) if (isFallback(m)) fbTurns.push(m.turn)
    const fallbackRate = moves.length ? +(fbTurns.length / moves.length).toFixed(2) : 0

    const spine = spineAgent(tag, moves, cast)
    const chains = {}
    for (const a of cast) chains[a] = agentChain(moves, a)

    const agentInfo = {}
    for (const a of (d.minds && d.minds.agents || [])) {
      agentInfo[a.name] = {
        role: a.role,
        publicIdentity: a.publicIdentity,
        hiddenIdentity: a.hiddenIdentity,
        shortTermGoal: a.shortTermGoal,
        longTermGoal: a.longTermGoal,
      }
    }

    runs.push({
      id, key,
      config: src.config,
      configLabel: src.label,
      configNote: src.note,
      finalModel: d.finalModel || '',
      cast,
      agentInfo,
      outcomeCls: tag.cls,
      outcomeEn: tag.en,
      kind: tag.kind,
      initiator: tag.initiator,
      spine,
      endingProse: (d.ending || '').trim(),
      fullProse: d.markdown || '',
      chains,
      moveCount: moves.length,
      fallbackTurns: [...new Set(fbTurns)],
      fallbackRate,
    })
  }
}

// kind ordering for layout & a stable palette
const KIND_ORDER = ['death', 'severance', 'unresolved', 'other']
runs.sort((a, b) => {
  if (a.config !== b.config) return a.config === "pre-B'" ? 1 : -1
  const ka = KIND_ORDER.indexOf(a.kind), kb = KIND_ORDER.indexOf(b.kind)
  if (ka !== kb) return ka - kb
  return a.id.localeCompare(b.id)
})

const summary = {}
for (const r of runs) {
  summary[r.config] = summary[r.config] || { total: 0, byKind: {}, deaths: 0, initiators: {} }
  const s = summary[r.config]
  s.total++
  s.byKind[r.kind] = (s.byKind[r.kind] || 0) + 1
  if (r.kind === 'death') { s.deaths++; if (r.initiator) s.initiators[r.initiator] = (s.initiators[r.initiator] || 0) + 1 }
}

const atlas = {
  generatedAt: new Date().toISOString(),
  opening: OPENING,
  conflict: CONFLICT,
  sources: SOURCES.map(s => ({ config: s.config, label: s.label, note: s.note })),
  kindOrder: KIND_ORDER,
  summary,
  runs,
  honesty: "Each resolved leaf's responsibility line cites only fields the agents already committed (what was concealed / the object marker / the private intent / the spoken line). Turns flagged as system fallbacks (a model call failure) are excluded from attribution, and each run reports its fallback coverage honestly. Deaths appear only in the strong-pressure layer; the frozen-B′ layer has produced none so far — that is a result, not a bug.",
}

const out = path.join(HERE, '../../demo/atlas-data.js')
fs.writeFileSync(out, 'window.ATLAS = ' + JSON.stringify(atlas, null, 1) + ';\n')

// console report
console.log(`atlas built: ${runs.length} runs -> ${path.relative(OUTPUTS, out)}`)
for (const cfg of Object.keys(summary)) {
  const s = summary[cfg]
  const kinds = Object.entries(s.byKind).map(([k, v]) => `${v}×${k}`).join(' ')
  const inits = Object.entries(s.initiators).map(([k, v]) => `${v}×${k}`).join(' ') || '—'
  console.log(`  ${cfg}: ${s.total} runs | ${kinds} | deaths initiated by: ${inits}`)
}
console.log('\nper-run:')
for (const r of runs) {
  console.log(`  [${r.config}] ${r.id}: ${r.kind.padEnd(10)} spine=${(r.spine||'?').padEnd(9)} fallback=${Math.round(r.fallbackRate*100)}% | ${r.outcomeEn.slice(0,60)}`)
}
