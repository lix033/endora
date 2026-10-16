# Développer Endora

Prérequis : **Node.js 24** (`nvm use` lit `.nvmrc`) et Git. Puis `npm ci`.

## Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | application en développement, avec rechargement à chaud de l'interface |
| `npm test` | tests Vitest (serveurs HTTP locaux réels, pas de mock réseau) |
| `npm run typecheck` | vérification TypeScript |
| `npm run build` | build de production dans `out/` |
| `npm start` | lance le build de production sans l'empaqueter |
| `npm run dist:mac` / `dist:win` / `dist:linux` | installeurs dans `release/` (voir [PUBLICATION.md](PUBLICATION.md)) |
| `npm run licenses` | génère `build/THIRD_PARTY_LICENSES.txt` (licences des modules embarqués) |
| `npm run icons` | régénère les icônes depuis `build/logo.svg` |
| `npm run brand` | régénère le wordmark et l'image d'aperçu (`docs/assets/`, sur macOS) |

Profil vierge pour tester sans toucher à vos données : `npx electron . --user-data-dir=/tmp/endora-test`
après `npm run build`.

## Architecture

```
src/
├─ shared/     types et logique pure, sans Electron : modèle, collection v2.1, variables,
│              auth, runner, runtime des scripts, réglages, thèmes, raccourcis
├─ main/       process principal : réseau (undici), stockage, auth, exécution, sandbox des
│              scripts, OAuth 2.0, imports, génération de code, mises à jour
├─ preload/    pont IPC minimal (index : interface, sandbox : fenêtre des scripts) — sortie CJS
└─ renderer/   interface React + Zustand ; sandbox.html : page d'exécution isolée des scripts
```

Règles :

- Le renderer n'a jamais accès à Node ni au réseau : tout passe par `window.endora` (contrat dans
  `src/shared/api.ts`), et le process principal refuse les appels venant d'autres fenêtres.
- Les échecs attendus (réseau, délai, fichier, import…) sont des résultats typés, jamais des exceptions.
- Les scripts utilisateur s'exécutent dans une fenêtre cachée sandboxée, sans Node, avec un iframe
  neuf par exécution et un délai maximal.
- `contextIsolation`, `sandbox`, pas de `nodeIntegration`, CSP stricte.

Données locales (`userData/workspace`) : `collections/<id>.json` (format collection v2.1),
`environments/<id>.json`, `globals.json`, `history.json`, `session.json`, `settings.json`.

## Dépendances

- Les modules chargés à l'exécution par le process principal sont dans `dependencies` (et sont
  embarqués dans l'installeur) ; tout ce qu'utilise l'interface est intégré au bundle par Vite et
  reste dans `devDependencies`.
- npm 11 bloque les scripts d'installation non revus : la liste `allowScripts` de `package.json`
  enregistre les décisions (`npm install-scripts approve <paquet>` ou `deny`).
- `overrides` impose `uuid@3` à deux convertisseurs anciens qui importent `uuid/v4`.
- Licences acceptées : compatibles MIT. `npm run licenses` liste les licences embarquées.

## Logo et visuels

- `build/logo.svg` : monogramme, source des icônes de l'application (`npm run icons`) et du
  favicon du site.
- `docs/assets/` : wordmark clair et sombre, image d'aperçu sociale, capture du README
  (`npm run brand`, sur macOS : la police du nom est Avenir Next ; les PNG sont versionnés).

## Documentation du projet

- [INSTALLATION.md](INSTALLATION.md) : installer, mettre à jour, désinstaller.
- [PUBLICATION.md](PUBLICATION.md) : mise en ligne, publication des versions, signature.
- [ROADMAP.md](ROADMAP.md) : phases du projet ; [FEATURES.md](FEATURES.md) : inventaire fonctionnel.
