#!/usr/bin/env node
// Self-test for the grove simulator: replay tonight's v1 candidates (hand-mapped
// to structured actions, faithful to their prose) and show what regex validation
// passed but physics catches.
import { simulate, diffAftermath, AFTERMATH } from './domain.mjs'

const spec06 = AFTERMATH["pre-B'/run-06"]
let pass = 0, fail = 0
function expect(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${detail}`) }
}

// ---------- 1) v1 Masago candidate (run-06), faithful mapping ----------
console.log('\n[1] Masago candidate — she strikes, then frees the body')
{
  const r = simulate([
    { type: 'strike', actor: 'Masago', target: 'Takehiro', object: 'dagger', part: 'throat' },
    { type: 'take', actor: 'Masago', object: 'longsword' },
    { type: 'cut_rope', actor: 'Masago', object: 'longsword' },
    { type: 'drop', actor: 'Masago', object: 'longsword' },
    { type: 'flee', actor: 'Tajomaru' },
  ])
  expect('replay ok', r.ok, r.ok ? '' : `blocked: ${r.trace.at(-1).reason}`)
  const misses = r.ok ? diffAftermath(r.state, spec06) : ['n/a']
  expect('aftermath matches (consistent)', r.ok && misses.length === 0, misses.join('; '))
}

// ---------- 2) v1 Takehiro candidate (run-06), faithful mapping ----------
// prose: she offers the dagger; he (STILL BOUND) drives it into his own throat;
// only afterwards is the rope cut. Regex passed this. Physics must not.
console.log('\n[2] Takehiro candidate as generated — self-strike while still bound')
{
  const r = simulate([
    { type: 'give', actor: 'Masago', object: 'dagger', target: 'Takehiro' },
    { type: 'self_strike', actor: 'Takehiro', object: 'dagger', part: 'throat' },
    { type: 'cut_rope', actor: 'Tajomaru', object: 'longsword' },
    { type: 'flee', actor: 'Tajomaru' },
  ])
  expect('simulator BLOCKS it', !r.ok)
  expect('reason names the rope', /bound/.test(r.trace.at(-1)?.reason || ''), r.trace.at(-1)?.reason)
  console.log(`    → blocked step: ${JSON.stringify(r.trace.at(-1)?.a)}`)
  console.log(`    → reason: ${r.trace.at(-1)?.reason}`)
}

// ---------- 2b) the derived necessary precondition: free him FIRST ----------
console.log('\n[2b] Takehiro candidate, repaired — someone must cut the rope first')
{
  const r = simulate([
    { type: 'take', actor: 'Tajomaru', object: 'longsword' },
    { type: 'cut_rope', actor: 'Tajomaru', object: 'longsword' },
    { type: 'drop', actor: 'Tajomaru', object: 'longsword' },
    { type: 'give', actor: 'Masago', object: 'dagger', target: 'Takehiro' },
    { type: 'self_strike', actor: 'Takehiro', object: 'dagger', part: 'throat' },
    { type: 'flee', actor: 'Tajomaru' },
  ])
  expect('replay ok once rope is cut first', r.ok, r.ok ? '' : r.trace.at(-1)?.reason)
  const misses = r.ok ? diffAftermath(r.state, spec06) : ['n/a']
  expect('aftermath matches', r.ok && misses.length === 0, misses.join('; '))
}

// ---------- 3) v1 Tajomaru candidate, faithful (no take before cut) ----------
console.log('\n[3] Tajomaru candidate as generated — cuts rope with a longsword he never took')
{
  const r = simulate([
    { type: 'seize', actor: 'Tajomaru', object: 'dagger' },
    { type: 'strike', actor: 'Tajomaru', target: 'Takehiro', object: 'dagger', part: 'throat' },
    { type: 'cut_rope', actor: 'Tajomaru', object: 'longsword' },  // never picked it up
  ])
  expect('simulator BLOCKS it', !r.ok)
  console.log(`    → reason: ${r.trace.at(-1)?.reason}`)
}

// ---------- 3b) corrected ----------
console.log('\n[3b] Tajomaru candidate, repaired — take the longsword before cutting')
{
  const r = simulate([
    { type: 'seize', actor: 'Tajomaru', object: 'dagger' },
    { type: 'strike', actor: 'Tajomaru', target: 'Takehiro', object: 'dagger', part: 'throat' },
    { type: 'take', actor: 'Tajomaru', object: 'longsword' },
    { type: 'cut_rope', actor: 'Tajomaru', object: 'longsword' },
    { type: 'drop', actor: 'Tajomaru', object: 'longsword' },
    { type: 'drop', actor: 'Tajomaru', object: 'dagger' },
    { type: 'flee', actor: 'Tajomaru' },
  ])
  expect('replay ok', r.ok, r.ok ? '' : r.trace.at(-1)?.reason)
  const misses = r.ok ? diffAftermath(r.state, spec06) : ['n/a']
  expect('aftermath matches', r.ok && misses.length === 0, misses.join('; '))
}

// ---------- 4) guard: the longsword must stay unbloodied in run-06 ----------
console.log('\n[4] guard — a longsword kill cannot fit the run-06 aftermath')
{
  const r = simulate([
    { type: 'take', actor: 'Tajomaru', object: 'longsword' },
    { type: 'strike', actor: 'Tajomaru', target: 'Takehiro', object: 'longsword', part: 'throat' },
    { type: 'flee', actor: 'Tajomaru' },
  ])
  const misses = r.ok ? diffAftermath(r.state, spec06) : []
  expect('aftermath diff rejects it', misses.length > 0, '')
  console.log(`    → misses: ${misses.join(' | ')}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
