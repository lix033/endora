// Notes de release : la section de CHANGELOG.md correspondant à la version, suivie des
// instructions d'installation. Usage : node scripts/release-notes.mjs <version>
import { readFileSync } from 'node:fs'

const version = process.argv[2]
if (!version) {
  console.error('Usage : node scripts/release-notes.mjs <version>')
  process.exit(1)
}
const changelog = readFileSync('CHANGELOG.md', 'utf8')
const start = changelog.search(new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm'))
let section = 'Voir CHANGELOG.md.'
if (start !== -1) {
  const rest = changelog.slice(start)
  const next = rest.slice(3).search(/^## /m)
  section = (next === -1 ? rest : rest.slice(0, next + 3)).split('\n').slice(1).join('\n').trim()
}
console.log(`${section}

## Installation

| Système | Commande |
|---|---|
| macOS (Homebrew) | \`brew install --cask lix033/tap/endora\` |
| macOS / Linux | \`curl -fsSL https://raw.githubusercontent.com/lix033/endora/main/scripts/install.sh \\| sh\` |
| Windows (winget) | \`winget install lix033.Endora\` |
| Windows (Scoop) | \`scoop bucket add lix033 https://github.com/lix033/scoop-bucket && scoop install endora\` |
| Windows (PowerShell) | \`irm https://raw.githubusercontent.com/lix033/endora/main/scripts/install.ps1 \\| iex\` |

Ou téléchargez directement le fichier adapté ci-dessous : \`.dmg\` (macOS), \`Endora-Setup-….exe\` (Windows), \`.AppImage\`, \`.deb\` ou \`.rpm\` (Linux). Empreintes : \`SHA256SUMS.txt\`.

Guide complet : [docs/INSTALLATION.md](https://github.com/lix033/endora/blob/main/docs/INSTALLATION.md)`)
