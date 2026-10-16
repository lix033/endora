// Rassemble les licences des dépendances embarquées dans l'application (dépendances de production,
// y compris transitives) dans build/THIRD_PARTY_LICENSES.txt, livré avec chaque installeur.
// Les licences Apache-2.0 (bibliothèques Postman notamment) exigent cette redistribution.
// Usage : npm run licenses
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const seen = new Map()

function resolveDir(name, from) {
  let dir = from
  for (;;) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = join(dir, '..')
    if (parent === dir) return null
    dir = parent
  }
}

function visit(name, from) {
  const dir = resolveDir(name, from)
  if (!dir || seen.has(dir)) return
  const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const licenseFile = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|-|$)/i.test(f))
  const notice = readdirSync(dir).find((f) => /^notice(\.|$)/i.test(f))
  seen.set(dir, {
    name: meta.name,
    version: meta.version,
    // Champ moderne `license`, ou ancien format `licenses: [{ type }]`.
    license:
      typeof meta.license === 'string'
        ? meta.license
        : (meta.license?.type ?? (Array.isArray(meta.licenses) ? meta.licenses.map((l) => l.type).join(' OR ') : null) ?? (licenseFile ? 'voir le texte ci-dessous' : 'non précisée')),
    text: licenseFile ? readFileSync(join(dir, licenseFile), 'utf8').trim() : null,
    notice: notice && notice !== licenseFile ? readFileSync(join(dir, notice), 'utf8').trim() : null
  })
  for (const dep of Object.keys(meta.dependencies ?? {})) visit(dep, dir)
  for (const dep of Object.keys(meta.optionalDependencies ?? {})) visit(dep, dir)
}

for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, root)

const entries = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
const header = `Endora — licences des composants tiers\n\nEndora est distribué sous licence MIT (voir LICENSE). Il embarque Electron (MIT, avec Chromium et Node.js,\ndont les licences sont fournies dans LICENSES.chromium.html) et les modules suivants.\n`
const body = entries
  .map((e) => [`${'='.repeat(78)}\n${e.name} ${e.version} — ${e.license}\n${'='.repeat(78)}`, e.text ?? '(texte de licence non fourni par le paquet)', e.notice ? `\n--- NOTICE ---\n${e.notice}` : ''].join('\n'))
  .join('\n\n')
writeFileSync(join(root, 'build', 'THIRD_PARTY_LICENSES.txt'), `${header}\n${body}\n`)
const byLicense = entries.reduce((m, e) => m.set(e.license, (m.get(e.license) ?? 0) + 1), new Map())
console.log(`${entries.length} modules : ${[...byLicense].map(([l, n]) => `${l} ×${n}`).join(', ')}`)
