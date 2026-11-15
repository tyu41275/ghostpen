/**
 * Prepares the blog's content before Next.js and Contentlayer run (next.config.js calls it).
 *
 * The content comes from the folder `GHOSTPEN_CONTENT_DIR` names (README.md, "Content"), or, while the variable is unset,
 * from the repository's own data/ (legacy mode, to be removed; `GHOSTPEN_REQUIRE_CONTENT=1` refuses it). Either way it
 * builds the git-ignored `.content/` folder Contentlayer and data/siteMetadata.js read, so the build has one code path.
 * A content folder's images are copied into public/static/images/ and recorded, and the next run removes exactly the
 * recorded files first, so switching folders leaves no strays and never touches a file it did not copy. Each recorded
 * file carries its SHA-256: one whose contents changed since the copy is someone else's now and is kept.
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const VAR = 'GHOSTPEN_CONTENT_DIR'
const OUT = '.content'
const IMAGES = path.join('public', 'static', 'images')
const RECORD = 'copied-images.json'
const REQUIRED_SITE_KEYS = ['title', 'author', 'siteUrl']

const isDir = (p) => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() === true
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const isFile = (p) => fs.statSync(p, { throwIfNoEntry: false })?.isFile() === true

/** The site values, checked: an object with every required key; `label` names their source in every error. */
function checkSite(site, label) {
  if (!site || typeof site !== 'object' || Array.isArray(site)) {
    throw new Error(`${label} must hold a JSON object`)
  }
  const missing = REQUIRED_SITE_KEYS.filter((k) => typeof site[k] !== 'string' || !site[k])
  if (missing.length) throw new Error(`${label} has no ${missing.join(', ')}`)
  return site
}

/** A content folder's site.json, parsed and checked. Its `home` block is always there (empty when left out). */
function readSite(dir, label) {
  const file = path.join(dir, 'site.json')
  if (!isFile(file)) throw new Error(`${label} has no site.json (${file})`)
  let site
  try {
    site = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    throw new Error(`${label}: site.json is not valid JSON (${e.message})`)
  }
  checkSite(site, `${label}: site.json`)
  if (site.home === undefined) return { ...site, home: {} }
  if (!site.home || typeof site.home !== 'object' || Array.isArray(site.home)) {
    throw new Error(`${label}: site.json's home must be an object`)
  }
  return site
}

/** Legacy mode's site values from data/site.legacy.js, read afresh. They have no `home`: the pages show the legacy intro. */
function readLegacySite(dir) {
  const file = path.join(dir, 'site.legacy.js')
  if (!isFile(file)) throw new Error(`data/ has no site.legacy.js (${file})`)
  delete require.cache[require.resolve(file)]
  const { home, ...site } = require(file)
  return checkSite(site, 'data/site.legacy.js')
}

/** Where the content comes from: `{ mode, dir, site, label }`, or an Error naming what is wrong. */
function resolveSource(root, env) {
  const value = env[VAR]
  if (value === undefined) {
    if (env.GHOSTPEN_REQUIRE_CONTENT === '1') {
      throw new Error(
        `${VAR} is not set, and GHOSTPEN_REQUIRE_CONTENT=1 refuses the repository's own content`
      )
    }
    const dir = path.join(root, 'data')
    return { mode: 'legacy', dir, site: readLegacySite(dir) }
  }
  const label = `${VAR} (${value})`
  if (!path.isAbsolute(value)) throw new Error(`${label} must be an absolute path`)
  if (!isDir(value)) throw new Error(`${label} is not an existing folder`)
  const site = readSite(value, label)
  if (!isFile(path.join(value, 'authors', 'default.mdx'))) {
    throw new Error(`${label} has no authors/default.mdx`)
  }
  if (!isDir(path.join(value, 'blog'))) throw new Error(`${label} has no blog/ folder`)
  return { mode: 'content', dir: value, site }
}

/** Every file under `dir`, as `/`-separated paths relative to it. */
function filesUnder(dir, from = dir) {
  return fs.readdirSync(from, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(from, entry.name)
    if (entry.isDirectory()) return filesUnder(dir, p)
    return entry.isFile() ? [path.relative(dir, p).split(path.sep).join('/')] : []
  })
}

/** A recorded image path that stays inside public/static/images/, or an Error. */
function safeRelative(rel) {
  const norm = path.posix.normalize(String(rel))
  if (
    typeof rel !== 'string' ||
    !rel ||
    path.posix.isAbsolute(norm) ||
    norm.startsWith('..') ||
    norm !== rel
  ) {
    throw new Error(
      `.content/${RECORD} lists a path outside public/static/images/: ${JSON.stringify(rel)}`
    )
  }
  return rel
}

/** The images the previous run copied, `{ path, sha256 }` each, from its record; none when there is no record. */
function previousImages(root) {
  const file = path.join(root, OUT, RECORD)
  if (!fs.existsSync(file)) return []
  let list
  try {
    list = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    throw new Error(
      `.content/${RECORD} is unreadable (${e.message}): check public/static/images/ by hand, then delete it`
    )
  }
  const entry = (e) =>
    e && typeof e === 'object' && typeof e.sha256 === 'string' && /^[0-9a-f]{64}$/.test(e.sha256)
  if (!Array.isArray(list) || !list.every(entry)) {
    throw new Error(
      `.content/${RECORD} must hold a list of { path, sha256 }: check public/static/images/ by hand, then delete it`
    )
  }
  return list.map((e) => ({ path: safeRelative(e.path), sha256: e.sha256 }))
}

/**
 * Whether public/static/images/ or any existing part of `rel` under it is a symbolic link, which would take a removal
 * or a copy outside it. The parts after the first missing one cannot be links.
 */
function throughLink(base, rel) {
  let at = base
  for (const part of ['', ...rel.split('/')]) {
    at = part ? path.join(at, part) : at
    const stat = fs.lstatSync(at, { throwIfNoEntry: false })
    if (!stat) return false
    if (stat.isSymbolicLink()) return true
  }
  return false
}

/**
 * Removes the recorded files whose contents are still what was copied, and the folders they leave empty, under
 * public/static/images/. A recorded file changed since, no longer a plain file, or reached through a symbolic link is
 * kept and logged.
 */
function removeImages(root, list, log) {
  const base = path.join(root, IMAGES)
  for (const { path: rel, sha256: was } of list) {
    const file = path.join(base, rel)
    if (throughLink(base, rel)) {
      log(`ghostpen content: kept public/static/images/${rel}, reached through a symbolic link`)
      continue
    }
    if (!fs.existsSync(file)) continue
    if (!isFile(file) || sha256(file) !== was) {
      log(`ghostpen content: kept public/static/images/${rel}, changed since it was copied`)
      continue
    }
    fs.rmSync(file)
    for (let dir = path.dirname(file); dir.startsWith(base + path.sep); dir = path.dirname(dir)) {
      if (fs.readdirSync(dir).length) break
      fs.rmdirSync(dir)
    }
  }
}

/**
 * Copies the content folder's images into public/static/images/, adding each to `copied`. A file already there that
 * this step did not copy is kept: an identical one is skipped, a different one is an error (it would be overwritten).
 */
function copyImages(root, dir, copied) {
  const from = path.join(dir, 'images')
  if (!isDir(from)) return
  const base = path.join(root, IMAGES)
  for (const rel of filesUnder(from)) {
    const src = path.join(from, rel)
    const dest = path.join(base, rel)
    if (throughLink(base, rel)) {
      throw new Error(
        `${VAR}: images/${rel} would be copied through a symbolic link under public/static/images/`
      )
    }
    if (fs.existsSync(dest)) {
      if (fs.readFileSync(dest).equals(fs.readFileSync(src))) continue
      throw new Error(
        `${VAR}: images/${rel} would replace public/static/images/${rel}, a file it did not copy`
      )
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
    copied.push({ path: rel, sha256: sha256(dest) })
  }
}

/**
 * Builds `<root>/.content/` from the content folder `env` names (or the repository's data/ in legacy mode).
 * Returns `{ mode, dir, images }`; throws an Error naming GHOSTPEN_CONTENT_DIR on any problem with the folder.
 */
function prepareContent({ root, env = process.env, log = console.log }) {
  if (!path.isAbsolute(root)) throw new Error(`prepareContent: root must be absolute (${root})`)
  const source = resolveSource(root, env)
  // The previous run's images go first: should a later step fail, its record still lists them (removing twice is harmless).
  removeImages(root, previousImages(root), log)

  const out = path.join(root, OUT)
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })
  for (const sub of ['blog', 'authors']) {
    fs.cpSync(path.join(source.dir, sub), path.join(out, sub), { recursive: true })
  }
  for (const name of fs.readdirSync(source.dir)) {
    if (name.endsWith('.bib') && isFile(path.join(source.dir, name))) {
      fs.copyFileSync(path.join(source.dir, name), path.join(out, name))
    }
  }
  fs.writeFileSync(path.join(out, 'site.json'), JSON.stringify(source.site, null, 2) + '\n')

  // The record is written even when a copy fails, so the next run still removes the files this one did copy.
  const images = []
  try {
    if (source.mode === 'content') copyImages(root, source.dir, images)
  } finally {
    fs.writeFileSync(path.join(out, RECORD), JSON.stringify(images, null, 2) + '\n')
  }
  // Contentlayer writes the tag counts here; until it has, the pages that import them read none.
  fs.writeFileSync(path.join(out, 'tag-data.json'), '{}\n')

  log(
    source.mode === 'content'
      ? `ghostpen content: ${source.dir} (${VAR})`
      : `ghostpen content: the repository's own (legacy)`
  )
  return { mode: source.mode, dir: source.dir, images: images.map((e) => e.path) }
}

module.exports = { prepareContent }
