#!/usr/bin/env node
// Records the two demos the paper describes, demo/magistrate.html and demo/ring-magistrate.html,
// as short MP4 walkthroughs for readers who would rather watch than click. Drives headless Chrome
// over the DevTools protocol (Node's built-in WebSocket), draws a caption bar and a pointer into
// the page, records it with Page.startScreencast, and encodes the frames with ffmpeg.
//
// Every caption is followed by a printed readout of the page's record, so a caption that no longer
// matches what the page shows is visible in the log.
//
// Usage:  node experiment-code/recon/record-demos.mjs [magistrate] [ring]   (default: both)
// Needs:  Google Chrome or Chromium (set CHROME to override the path) and ffmpeg on PATH.
// Writes: demo/videos/magistrate.mp4 and demo/videos/ring-magistrate.mp4, each with a .jpg poster
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import url from 'node:url'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const DEMO = path.resolve(HERE, '../../demo')
const OUT = path.join(DEMO, 'videos')
const VIEW = { width: 1440, height: 1000 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findChrome() {
  const candidates = [process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].filter(Boolean)
  for (const c of candidates) {
    if (c.includes('/') ? fs.existsSync(c) : spawnSync('which', [c]).status === 0) return c
  }
  throw new Error('Chrome not found; set CHROME to its executable path')
}

// ---- a minimal DevTools-protocol client -------------------------------------------------------
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id)
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
      } else if (msg.method) (this.handlers.get(msg.method) || []).forEach((fn) => fn(msg.params, msg.sessionId))
    })
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
  on(method, fn) { this.handlers.set(method, [...(this.handlers.get(method) || []), fn]) }
}

async function launchChrome() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'record-demos-'))
  const proc = spawn(findChrome(), ['--headless=new', '--disable-gpu', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = ''
    proc.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]) })
    proc.on('exit', (code) => reject(new Error(`Chrome exited (${code})`)))
  })
  const ws = new WebSocket(wsUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  return { proc, profile, cdp: new CDP(ws), ws }
}

// ---- the page-side overlay: a caption bar and a pointer -----------------------------------------
const OVERLAY = `(() => {
  const css = document.createElement('style');
  css.textContent = \`
    #rd-caption{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:1100px;width:max-content;
      background:rgba(8,8,10,.92);color:#f4efe6;border:1px solid #3a3a44;border-radius:10px;padding:12px 20px;
      font:500 19px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;z-index:2147483646;
      box-shadow:0 8px 30px rgba(0,0,0,.55);transition:opacity .35s;pointer-events:none;text-align:center}
    #rd-caption.off{opacity:0}
    #rd-pointer{position:fixed;left:-60px;top:-60px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;
      background:rgba(255,214,120,.35);border:2px solid #ffd678;z-index:2147483647;pointer-events:none;
      transition:left .5s ease,top .5s ease,transform .15s}
    #rd-pointer.press{transform:scale(.6);background:rgba(255,214,120,.8)}\`;
  document.head.appendChild(css);
  const cap = document.createElement('div'); cap.id = 'rd-caption'; cap.className = 'off'; document.body.appendChild(cap);
  const ptr = document.createElement('div'); ptr.id = 'rd-pointer'; document.body.appendChild(ptr);
})()`

function pageApi(cdp, session) {
  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session)
    if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.text} in ${expression.slice(0, 80)}`)
    return r.result.value
  }
  const api = {
    evaluate,
    async caption(text, holdMs) {
      await evaluate(`(() => { const c = document.getElementById('rd-caption'); c.textContent = ${JSON.stringify(text)}; c.classList.remove('off'); })()`)
      console.log(`  caption: ${text}`)
      if (holdMs) await sleep(holdMs)
    },
    async hideCaption() { await evaluate(`document.getElementById('rd-caption').classList.add('off')`); await sleep(400) },
    async pointer(x, y) { await evaluate(`(() => { const p = document.getElementById('rd-pointer'); p.style.left = '${x}px'; p.style.top = '${y}px'; })()`); await sleep(600) },
    // smooth-scroll so the element's top sits `top` px below the top of the viewport
    async reveal(selector, top = 90) {
      await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
        const y = el.getBoundingClientRect().top + window.scrollY - ${top};
        window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' }); })()`)
      await sleep(1100)
    },
    async scrollTop() { await evaluate(`window.scrollTo({ top: 0, behavior: 'smooth' })`); await sleep(1100) },
    async center(selector) {
      return evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: Math.round(r.left + Math.min(r.width / 2, 120)), y: Math.round(r.top + Math.min(r.height / 2, 14)) }; })()`)
    },
    async click(selector) {
      const { x, y } = await api.center(selector)
      await api.pointer(x, y)
      await evaluate(`document.getElementById('rd-pointer').classList.add('press')`)
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, session)
      }
      await sleep(150)
      await evaluate(`document.getElementById('rd-pointer').classList.remove('press')`)
      await sleep(350)
    },
    // drag a range input to `to`, moving the pointer with the thumb and firing 'input' each step
    async slide(id, to, ms = 1300) {
      const s = await evaluate(`(() => { const el = document.getElementById(${JSON.stringify(id)}), r = el.getBoundingClientRect();
        return { left: r.left, width: r.width, y: Math.round(r.top + r.height / 2), min: +el.min, max: +el.max, v: +el.value, step: +el.step }; })()`)
      const thumbX = (v) => Math.round(s.left + 8 + (s.width - 16) * (v - s.min) / (s.max - s.min))
      await api.pointer(thumbX(s.v), s.y)
      await evaluate(`document.getElementById('rd-pointer').classList.add('press')`)
      const steps = Math.max(1, Math.round(Math.abs(to - s.v) / s.step))
      for (let i = 1; i <= steps; i++) {
        const v = +(s.v + (to - s.v) * i / steps).toFixed(4)
        await evaluate(`(() => { const el = document.getElementById(${JSON.stringify(id)}); el.value = ${v};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          const p = document.getElementById('rd-pointer'); p.style.transition = 'none'; p.style.left = '${thumbX(v)}px'; })()`)
        await sleep(ms / steps)
      }
      await evaluate(`(() => { const p = document.getElementById('rd-pointer'); p.classList.remove('press'); p.style.transition = ''; })()`)
      await sleep(300)
    },
  }
  return api
}

// ---- recording ---------------------------------------------------------------------------------
async function record(name, file, script) {
  const { proc, profile, cdp, ws } = await launchChrome()
  const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), `record-${name}-`))
  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: 1, mobile: false }, sessionId)
    await cdp.send('Page.enable', {}, sessionId)
    const loaded = new Promise((r) => cdp.on('Page.loadEventFired', r))
    await cdp.send('Page.navigate', { url: url.pathToFileURL(path.join(DEMO, file)).href }, sessionId)
    await loaded
    await sleep(800)
    const page = pageApi(cdp, sessionId)
    await page.evaluate(OVERLAY)

    const frames = []
    cdp.on('Page.screencastFrame', (p, sid) => {
      if (sid !== sessionId) return
      const f = path.join(frameDir, `f${String(frames.length).padStart(5, '0')}.jpg`)
      fs.writeFileSync(f, Buffer.from(p.data, 'base64'))
      frames.push({ f, t: p.metadata.timestamp })
      cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }, sessionId)
    })
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 }, sessionId)
    await sleep(600)
    await script(page)
    await sleep(500)
    await cdp.send('Page.stopScreencast', {}, sessionId)
    const end = Date.now() / 1000
    await sleep(300)
    if (frames.length < 2) throw new Error('no frames captured')

    // frames arrive only when the page repaints, so each frame lasts until the next one
    const list = frames.map((fr, i) => `file '${fr.f}'\nduration ${Math.max(0.001, ((frames[i + 1]?.t ?? end) - fr.t)).toFixed(4)}`)
    list.push(`file '${frames[frames.length - 1].f}'`)
    const listFile = path.join(frameDir, 'frames.txt')
    fs.writeFileSync(listFile, list.join('\n') + '\n')
    fs.mkdirSync(OUT, { recursive: true })
    const out = path.join(OUT, file.replace(/\.html$/, '.mp4'))
    // the JPEG frames are full range; convert to the limited-range yuv420p that every player expects
    const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-vf', 'fps=30,scale=in_range=pc:out_range=tv,format=yuv420p', '-color_range', 'tv',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-movflags', '+faststart', '-an', out], { stdio: 'inherit' })
    if (ff.status !== 0) throw new Error('ffmpeg failed')
    // a poster frame for the project page, taken once the opening caption is up
    const poster = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '2.5', '-i', out,
      '-frames:v', '1', '-q:v', '4', out.replace(/\.mp4$/, '.jpg')], { stdio: 'inherit' })
    if (poster.status !== 0) throw new Error('ffmpeg failed to write the poster')
    console.log(`written: ${path.relative(path.resolve(HERE, '../..'), out)}  (${frames.length} frames, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB, ${(end - frames[0].t).toFixed(1)} s)`)
  } finally {
    ws.close(); proc.kill()
    fs.rmSync(frameDir, { recursive: true, force: true })
    setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500)
  }
}

// a compact readout of a page's record card, for the log
const readout = (sel) => `[...document.querySelectorAll('${sel} .k')].map(k => k.textContent.trim() + ': ' + (k.nextElementSibling?.textContent || '').trim().replace(/\\s+/g, ' ')).join(' | ')`

const SCRIPTS = {
  async magistrate(p) {
    const log = async () => console.log(`    record -> ${await p.evaluate(readout('#rec'))}\n    claims -> ` +
      await p.evaluate(`[...document.querySelectorAll('#claims .cl')].map(c => c.querySelector('.w').textContent + ': ' +
        c.childNodes[2].textContent.trim()).join(' | ')`))
    await p.caption('Three witnesses to one death. You hold the file of public evidence; each witness chooses the account that serves them best.', 6000)
    await p.caption('Click a fact to establish it. Accounts it rules out disappear, and a witness standing on one is caught out.', 1500)
    await p.click('#facts .fact[data-f="daggerBlood"]')
    await log()
    await sleep(3500)
    await p.caption('Each witness answers in turn: caught out, they must say something else.')
    await p.reveal('#booths', 110)
    await sleep(4000)
    await p.caption("Load the paper's scene (run-06): its whole file is on record before anyone speaks.")
    await p.reveal('#clear', 380)
    await sleep(600)
    await p.click('#loadRun06')
    await sleep(2500)
    await p.reveal('#beta', 820)
    await p.caption('β = 0: each witness serves only itself. Three different accounts, and two provable lies.', 600)
    await p.slide('beta', 0)
    await log()
    await sleep(3200)
    await p.caption("β = 0.5: being believed now matters. Corroboration collapses the testimony into the samurai's suicide.", 600)
    await p.slide('beta', 0.5)
    await log()
    await sleep(3500)
    await p.caption('γ = 0.2: each witness is held to its opening statement, and the three accounts return.', 600)
    await p.slide('gamma', 0.2)
    await log()
    await sleep(3500)
    await p.caption('The hearing log keeps every statement, round by round.')
    await p.reveal('#tr', 150)
    await sleep(4000)
    await p.caption('Try it yourself: open demo/magistrate.html in any browser. No install, no server.')
    await p.scrollTop()
    await sleep(3000)
  },

  async ring(p) {
    const log = async () => console.log(`    record -> ${await p.evaluate(readout('#rec'))}`)
    await p.caption("The Ring and the Book, Rome 1698. Guido's guilt is not in dispute; what his act was, is.", 5500)
    await p.caption('File the Old Yellow Book documents one at a time. A document that contradicts an account catches its witness out.', 1500)
    const facts = await p.evaluate(`[...document.querySelectorAll('#facts .fact')].map(f => f.dataset.f)`)
    await p.click(`#facts .fact[data-f="${facts[1]}"]`)
    await log()
    await sleep(3000)
    await p.click(`#facts .fact[data-f="${facts[2]}"]`)
    await log()
    await sleep(3000)
    await p.caption('With every document on file, no two of the three accounts can be true together.', 1200)
    await p.reveal('#all', 640)
    await p.click('#all')
    await p.scrollTop()
    await log()
    await sleep(3500)
    await p.caption('The conflict table shows where they disagree; "—" marks a witness who is indifferent, and so makes no claim.')
    await p.reveal('#mx', 160)
    await sleep(5000)
    await p.caption('The story lists each turning point in the order you caused it.')
    await p.reveal('#story', 110)
    await sleep(3500)
    await p.caption('Try it yourself: open demo/ring-magistrate.html in any browser. No install, no server.')
    await p.scrollTop()
    await sleep(3000)
  },
}

const FILES = { magistrate: 'magistrate.html', ring: 'ring-magistrate.html' }
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(FILES)
for (const name of wanted) {
  if (!FILES[name]) throw new Error(`unknown demo '${name}' (choose from: ${Object.keys(FILES).join(', ')})`)
  console.log(`\nrecording ${name}`)
  await record(name, FILES[name], SCRIPTS[name])
}
