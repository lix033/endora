// Génère les manifestes des gestionnaires de paquets pour une version publiée :
//   dist-packaging/homebrew/endora.rb        cask Homebrew (dépôt lix033/homebrew-tap)
//   dist-packaging/scoop/endora.json         manifeste Scoop (dépôt lix033/scoop-bucket)
//   dist-packaging/winget/…                  manifestes winget (dépôt microsoft/winget-pkgs)
// Usage : node scripts/render-packaging.mjs <version> <chemin de SHA256SUMS.txt>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [version, sumsPath] = process.argv.slice(2)
if (!version || !sumsPath) {
  console.error('Usage : node scripts/render-packaging.mjs <version> <SHA256SUMS.txt>')
  process.exit(1)
}
const sums = Object.fromEntries(
  readFileSync(sumsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [hash, ...name] = l.trim().split(/\s+/)
      return [name.join(' ').replace(/^\*/, ''), hash]
    })
)
const sha = (file) => {
  if (!sums[file]) throw new Error(`Empreinte manquante pour ${file}`)
  return sums[file]
}
const values = {
  VERSION: version,
  SHA_MAC_ARM64: sha(`Endora-${version}-mac-arm64.dmg`),
  SHA_MAC_X64: sha(`Endora-${version}-mac-x64.dmg`),
  SHA_WIN_ZIP_X64: sha(`Endora-${version}-win-x64.zip`),
  SHA_WIN_ZIP_ARM64: sha(`Endora-${version}-win-arm64.zip`),
  SHA_WIN_SETUP_X64: sha(`Endora-Setup-${version}-x64.exe`),
  SHA_WIN_SETUP_ARM64: sha(`Endora-Setup-${version}-arm64.exe`),
  RELEASE_DATE: new Date().toISOString().slice(0, 10)
}
const render = (template) => readFileSync(template, 'utf8').replace(/\{\{(\w+)\}\}/g, (_, k) => {
  if (!(k in values)) throw new Error(`Variable inconnue dans ${template} : ${k}`)
  return values[k]
})
const out = 'dist-packaging'
const write = (path, content) => {
  mkdirSync(join(out, path, '..'), { recursive: true })
  writeFileSync(join(out, path), content)
  console.log(`  ${join(out, path)}`)
}
write('homebrew/endora.rb', render('packaging/homebrew/endora.rb'))
write('scoop/endora.json', render('packaging/scoop/endora.json'))
const winget = `winget/manifests/l/lix033/Endora/${version}`
for (const f of ['lix033.Endora.yaml', 'lix033.Endora.installer.yaml', 'lix033.Endora.locale.fr-FR.yaml', 'lix033.Endora.locale.en-US.yaml']) {
  write(`${winget}/${f}`, render(`packaging/winget/${f}`))
}
