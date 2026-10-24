#!/usr/bin/env node
// Bundle the solver for the browser.
//
// The exhibits are opened straight off the filesystem, and ES modules over file:// are
// blocked by CORS, so magistrate.html cannot `import`. This emits ONE classic script with
// no imports at all.
//
// The ESM->classic transform itself lives in bundle-esm.mjs, shared with the Franceschini
// bundle; the rationale for it being a real module system rather than a concatenation is
// documented there.
//
// Usage: node recon/build-magistrate.mjs

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from './bundle-esm.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

// dependency order; each is self-contained apart from the others listed before it
const MODULES = [
  './domain.mjs',
  './grove-objective.mjs',
  './grove-enum.mjs',
  './hearing-engine.mjs',
  './hearing-core.mjs',
  './evidence.mjs',
  './magistrate-core.mjs',
  './narrate-template.mjs',
].map(name => ({ name, path: join(HERE, name) }))

const bytes = bundle({
  modules: MODULES,
  globalName: 'GROVE',
  generator: 'recon/build-magistrate.mjs',
  outFile: join(HERE, '../../demo/magistrate-bundle.js'),
  expose: {
    domain: './domain.mjs',
    objective: './grove-objective.mjs',
    enumerate: './grove-enum.mjs',
    hearing: './hearing-core.mjs',
    evidence: './evidence.mjs',
    magistrate: './magistrate-core.mjs',
    narrate: './narrate-template.mjs',
  },
})

console.log(`written: demo/magistrate-bundle.js  (${(bytes / 1024).toFixed(1)} kB from ${MODULES.length} modules)`)
