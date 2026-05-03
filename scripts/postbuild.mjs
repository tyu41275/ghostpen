import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Contentlayer2 generates `assert { type: 'json' }` which Node.js 22+ rejects.
// Patch the generated file to use the standard `with` keyword before importing.
const clIndexPath = path.join(__dirname, '..', '.contentlayer', 'generated', 'index.mjs')
const src = readFileSync(clIndexPath, 'utf8')
const patched = src.replaceAll("assert { type: 'json' }", "with { type: 'json' }")
if (patched !== src) writeFileSync(clIndexPath, patched, 'utf8')

const { default: rss } = await import('./rss.mjs')

async function postbuild() {
  await rss()
}

postbuild()
