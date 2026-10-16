// Génère les icônes de l'app à partir du logo vectoriel (build/logo.svg) :
//   build/icon.png       1024 px, utilisée par electron-builder pour macOS (.icns) et Windows (.ico)
//   build/icon-512.png   icône de fenêtre en développement
//   src/renderer/src/assets/logo.svg  logo affiché dans l'interface
// Usage : npm run icons
import { copyFile } from 'node:fs/promises'
import sharp from 'sharp'

const src = 'build/logo.svg'
await sharp(src, { density: 300 }).resize(1024, 1024).png().toFile('build/icon.png')
await sharp(src, { density: 300 }).resize(512, 512).png().toFile('build/icon-512.png')
await copyFile(src, 'src/renderer/src/assets/logo.svg')
console.log('Icônes générées : build/icon.png, build/icon-512.png, src/renderer/src/assets/logo.svg')
