#!/usr/bin/env node
// Bundle the Franceschini solver for the browser.
//
// Same contract as build-magistrate.mjs: ES modules over file:// are blocked by CORS, so the
// page cannot `import`. This emits ONE classic script with no imports, generated from the very
// modules the node scripts run — there is one solver, not a second implementation.
//
// Usage: node recon/build-ring-magistrate.mjs

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from './bundle-esm.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

// dependency order; each is self-contained apart from the others listed before it
const MODULES = [
  './ring-domain.mjs',
  './ring-objective.mjs',
  './ring-evidence.mjs',
  './ring-core.mjs',
  './ring-spectators.mjs',
  './ring-magistrate-core.mjs',
].map(name => ({ name, path: join(HERE, name) }))

const bytes = bundle({
  modules: MODULES,
  globalName: 'RING',
  generator: 'recon/build-ring-magistrate.mjs',
  outFile: join(HERE, '../../demo/ring-magistrate-bundle.js'),
  expose: {
    domain: './ring-domain.mjs',
    objective: './ring-objective.mjs',
    evidence: './ring-evidence.mjs',
    core: './ring-core.mjs',
    spectators: './ring-spectators.mjs',
    magistrate: './ring-magistrate-core.mjs',
  },
})

console.log(`written: demo/ring-magistrate-bundle.js  (${(bytes / 1024).toFixed(1)} kB from ${MODULES.length} modules)`)
