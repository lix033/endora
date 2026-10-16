// Génère les visuels de marque à partir du monogramme (build/logo.svg) :
//   docs/assets/wordmark-dark.png   logo + nom, texte clair (fonds sombres)
//   docs/assets/wordmark-light.png  logo + nom, texte foncé (fonds clairs)
//   docs/assets/social-preview.png  aperçu 1280×640 pour GitHub et les réseaux
// Le nom utilise la police Avenir Next (macOS) : les PNG produits sont versionnés pour que le
// rendu ne dépende pas des polices installées. Usage : npm run brand (sur macOS).
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'

const mark = (await readFile('build/logo.svg', 'utf8')).replace(/<\?xml[^>]*>/, '')
const inner = mark.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
const FONT = "'Avenir Next', 'Helvetica Neue', Arial, sans-serif"

function wordmark(textColor) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="880" height="300" viewBox="0 0 880 300">
  <svg x="0" y="0" width="300" height="300" viewBox="0 0 1024 1024">${inner}</svg>
  <text x="320" y="196" font-family="${FONT}" font-weight="600" font-size="150" letter-spacing="-3" fill="${textColor}">Endora</text>
</svg>`
}

await sharp(Buffer.from(wordmark('#F7F9F9')), { density: 144 }).png().toFile('docs/assets/wordmark-dark.png')
await sharp(Buffer.from(wordmark('#0F1419')), { density: 144 }).png().toFile('docs/assets/wordmark-light.png')

const social = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1C2B3B"/><stop offset="1" stop-color="#0B141D"/></linearGradient></defs>
  <rect width="1280" height="640" fill="url(#g)"/>
  <svg x="120" y="190" width="220" height="220" viewBox="0 0 1024 1024">${inner}</svg>
  <text x="380" y="315" font-family="${FONT}" font-weight="600" font-size="128" letter-spacing="-3" fill="#F7F9F9">Endora</text>
  <text x="384" y="378" font-family="${FONT}" font-weight="500" font-size="32" fill="#8B98A5">Client API open source · macOS, Windows, Linux</text>
  <rect x="384" y="412" width="120" height="8" rx="4" fill="#1D9BF0"/>
</svg>`
await sharp(Buffer.from(social)).png().toFile('docs/assets/social-preview.png')
console.log('Visuels générés dans docs/assets/')
