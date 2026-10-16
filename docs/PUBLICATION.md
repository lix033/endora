# Publier Endora

Ce guide décrit la mise en ligne initiale du projet, puis la publication de chaque version. Une
fois la configuration faite, **publier une version se résume à pousser un tag** : la CI construit,
publie et met à jour les gestionnaires de paquets.

- [Vue d'ensemble](#vue-densemble)
- [1. Mise en ligne initiale (une seule fois)](#1-mise-en-ligne-initiale-une-seule-fois)
- [2. Publier une version](#2-publier-une-version)
- [3. Signature du code (recommandée)](#3-signature-du-code-recommandée)
- [4. Référence des workflows et secrets](#4-référence-des-workflows-et-secrets)
- [5. Dépannage](#5-dépannage)

## Vue d'ensemble

```
git tag v0.2.0 && git push origin v0.2.0
        │
        ▼
Release (.github/workflows/release.yml)
  ├─ prepare   vérifie que le tag = version de package.json, crée le brouillon de release
  │            avec les notes tirées de CHANGELOG.md
  ├─ build     4 runners en parallèle (electron-builder --publish always)
  │            macOS     → .dmg + .zip  (arm64, x64)
  │            Windows   → Setup .exe + .zip (x64, arm64)
  │            Linux x64 → .AppImage .deb .rpm .tar.gz
  │            Linux arm → .AppImage .deb .rpm .tar.gz
  ├─ publish   calcule SHA256SUMS.txt, publie la release (« Latest »)
  ├─ packages  met à jour le cask Homebrew et le manifeste Scoop
  └─ winget    soumet les manifestes à microsoft/winget-pkgs
        │
        ▼
Utilisateurs : brew / winget / scoop / curl | sh / irm | iex / téléchargement direct
Application  : « nouvelle version disponible » (Paramètres › Mises à jour)
```

Autres workflows : **CI** (types, tests et build sur les 3 systèmes à chaque push/PR) et **Site**
(publie <https://lix033.github.io/endora/> et les scripts d'installation).

## 1. Mise en ligne initiale (une seule fois)

### 1.1 Créer le dépôt et pousser le code

1. Sur GitHub, créez le dépôt **public** `lix033/endora`, sans README ni licence (ils existent déjà).
2. En local, vérifiez que les données d'analyse ne seront jamais publiées (`.rea/` est dans
   `.gitignore`), puis :

```bash
git checkout -b main            # la branche par défaut doit s'appeler main
git add .
git status                      # vérifier : pas de .rea/, out/, release/, node_modules/
git commit -m "Endora 0.1.0"
git remote add origin https://github.com/lix033/endora.git
git push -u origin main
```

### 1.2 Régler le dépôt

Dans **Settings** du dépôt :

| Réglage | Valeur |
|---|---|
| General › Social preview | importer `docs/assets/social-preview.png` |
| General › Features | activer Issues, Discussions (facultatif) |
| About (page d'accueil, roue dentée) | description « Client API de bureau open source », site `https://lix033.github.io/endora/`, topics `api-client`, `http`, `rest`, `electron`, `openapi`, `postman-alternative` |
| Actions › General › Workflow permissions | **Read and write permissions** |
| Pages › Build and deployment › Source | **GitHub Actions** |
| Branches › Branch protection (main) | exiger la réussite de la CI avant fusion (recommandé) |

Lancez ensuite le workflow **Site** (onglet Actions › Site › Run workflow) : le site et les adresses
courtes `https://lix033.github.io/endora/install.sh` et `install.ps1` deviennent disponibles.

### 1.3 Homebrew : créer le tap

1. Créez le dépôt public **`lix033/homebrew-tap`** (le préfixe `homebrew-` est obligatoire), avec un
   dossier `Casks/` (un fichier `Casks/.gitkeep` suffit).
2. Créez un jeton d'accès *fine-grained* (GitHub › Settings › Developer settings › Personal access
   tokens) limité au dépôt `lix033/homebrew-tap`, permission **Contents : Read and write**.
3. Dans `lix033/endora` › Settings › Secrets and variables › Actions, ajoutez le secret
   **`HOMEBREW_TAP_TOKEN`**.

Les utilisateurs installent alors avec `brew install --cask lix033/tap/endora`.

### 1.4 Scoop : créer le bucket

1. Créez le dépôt public **`lix033/scoop-bucket`** avec un dossier `bucket/`.
2. Jeton *fine-grained* limité à ce dépôt (Contents : Read and write) → secret **`SCOOP_BUCKET_TOKEN`**.

Installation : `scoop bucket add lix033 https://github.com/lix033/scoop-bucket` puis `scoop install endora`.

### 1.5 winget

Les manifestes sont soumis par pull request au dépôt communautaire `microsoft/winget-pkgs` avec
l'outil officiel `wingetcreate`.

1. Créez un jeton **classic** avec la portée `public_repo` (wingetcreate crée un fork de
   `microsoft/winget-pkgs` sur votre compte) → secret **`WINGET_TOKEN`**.
2. À la première version, la pull request est revue par les modérateurs de winget (validation
   automatique puis humaine, de quelques heures à quelques jours). Les versions suivantes sont en
   général fusionnées automatiquement.

`winget install lix033.Endora` fonctionne dès que la PR est fusionnée.

> Chaque secret est facultatif : sans `HOMEBREW_TAP_TOKEN`, `SCOOP_BUCKET_TOKEN` ou `WINGET_TOKEN`,
> l'étape correspondante est simplement ignorée et la release GitHub est publiée quand même.

## 2. Publier une version

1. **Mettre à jour `CHANGELOG.md`** : renommer la section `## [Non publié]` en
   `## [0.2.0] — AAAA-MM-JJ` (ses lignes deviennent les notes de la release) et rouvrir une section vide.
2. **Changer la version** et créer le tag :

```bash
npm version 0.2.0 -m "Endora %s"   # met à jour package.json, commit et tag v0.2.0
git push origin main --follow-tags
```

3. Suivre le workflow **Release** dans l'onglet Actions (environ 15 à 25 minutes).
4. Vérifier la release : fichiers des 3 systèmes, `SHA256SUMS.txt`, notes d'installation.
5. Vérifier les gestionnaires de paquets : commits dans `homebrew-tap` et `scoop-bucket`, PR
   ouverte dans `microsoft/winget-pkgs`.

**Préversion** : un tag avec suffixe (`v0.3.0-beta.1`, après `npm version 0.3.0-beta.1`) publie une
release marquée *Pre-release*, sans mise à jour de Homebrew, Scoop ni winget, et sans la proposer
comme mise à jour dans l'application.

**Relancer une release échouée** : supprimez la release brouillon et le tag
(`git push --delete origin v0.2.0 && git tag -d v0.2.0`), corrigez, puis recréez le tag.

**Tester l'empaquetage sans publier** :

```bash
npm run dist:mac        # ou dist:win / dist:linux — fichiers dans release/
```

## 3. Signature du code (recommandée)

Sans signature, les builds fonctionnent mais macOS (Gatekeeper) et Windows (SmartScreen) affichent
un avertissement au premier lancement (voir [INSTALLATION.md](INSTALLATION.md)). Sans certificat,
la CI signe l'app macOS en *ad hoc*, ce qui suffit à la lancer sur Apple Silicon.

### macOS — certificat Developer ID + notarisation

Sans notarisation, macOS 15+ affiche « Apple n'a pas pu vérifier qu'Endora ne contient pas de
logiciel malveillant ». Une signature **Developer ID** seule ne suffit pas : il faut aussi la
notarisation par Apple.

Prérequis : un compte Apple Developer (99 $/an) et le certificat **Developer ID Application** dans
le trousseau (Xcode › Réglages › Comptes › Gérer les certificats › + › Developer ID Application).
Vérification : `security find-identity -v -p codesigning` doit lister
`Developer ID Application: <nom> (<TEAM_ID>)` ; le `TEAM_ID` est entre parenthèses.

1. **Exporter le certificat** : Trousseau d'accès › session › Mes certificats › clic droit sur
   « Developer ID Application: … » › Exporter › format `.p12`, avec un mot de passe. N'exportez que
   ce certificat (pas les certificats Apple Development / Distribution).
2. Encodez-le : `base64 -i DeveloperID.p12 | pbcopy`, puis supprimez le `.p12`.
3. Créez un **mot de passe pour app** sur <https://account.apple.com> (Connexion et sécurité ›
   Mots de passe pour les apps).
4. Ajoutez les secrets (Settings › Secrets and variables › Actions) :

| Secret | Valeur |
|---|---|
| `MAC_CSC_LINK` | le `.p12` encodé en base64 |
| `MAC_CSC_KEY_PASSWORD` | mot de passe du `.p12` |
| `APPLE_ID` | adresse du compte Apple Developer |
| `APPLE_APP_SPECIFIC_PASSWORD` | mot de passe pour app |
| `APPLE_TEAM_ID` | identifiant d'équipe du certificat Developer ID (10 caractères) |

La CI signe alors l'app et la fait notariser par Apple automatiquement. Si `MAC_CSC_LINK` est défini
sans les trois secrets `APPLE_*`, le build échoue plutôt que de publier une app signée mais bloquée.
Après l'empaquetage, la CI vérifie l'app avec `spctl` et `stapler` ; en cas d'échec, la release
reste en brouillon.

**Tester en local** (le certificat est pris dans le trousseau) :

```bash
# Une seule fois : enregistre les identifiants de notarisation dans le trousseau.
xcrun notarytool store-credentials endora-notary --apple-id <adresse> --team-id <TEAM_ID>

APPLE_KEYCHAIN_PROFILE=endora-notary npm run dist:mac
spctl -a -vv -t execute release/mac-arm64/Endora.app   # attendu : accepted, source=Notarized Developer ID
```

### Windows — signature Authenticode

Avec un certificat de signature de code au format `.pfx` (fournisseurs : Certum, Sectigo,
DigiCert…) : secrets **`WIN_CSC_LINK`** (`.pfx` en base64) et **`WIN_CSC_KEY_PASSWORD`**. Les
certificats récents sont souvent livrés sur clé matérielle ou en service cloud (par exemple Azure
Trusted Signing) : ils demandent une configuration `win.azureSignOptions` ou `win.signtoolOptions`
dans `electron-builder.yml` (voir la documentation d'electron-builder).

## 4. Référence des workflows et secrets

| Workflow | Déclencheur | Rôle |
|---|---|---|
| `ci.yml` | push sur `main`, pull requests | typecheck, tests et build sur Ubuntu, macOS et Windows ; analyse des scripts d'installation |
| `release.yml` | tag `v*.*.*` | build, publication, empreintes, Homebrew, Scoop, winget |
| `pages.yml` | push sur `main` (site, scripts, logo), manuel | site et scripts d'installation sur GitHub Pages |

| Secret | Obligatoire | Usage |
|---|---|---|
| `GITHUB_TOKEN` | fourni automatiquement | release, fichiers, empreintes |
| `HOMEBREW_TAP_TOKEN` | non | mise à jour de `lix033/homebrew-tap` |
| `SCOOP_BUCKET_TOKEN` | non | mise à jour de `lix033/scoop-bucket` |
| `WINGET_TOKEN` | non | soumission à `microsoft/winget-pkgs` |
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` | non | signature macOS |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | non | notarisation macOS |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | non | signature Windows |

Fichiers liés : `electron-builder.yml` (empaquetage), `packaging/` (modèles Homebrew, Scoop,
winget), `scripts/render-packaging.mjs` (génération des manifestes),
`scripts/release-notes.mjs` (notes de release), `scripts/third-party.mjs` (licences embarquées),
`scripts/install.sh` et `scripts/install.ps1` (installation en ligne de commande).

## 5. Dépannage

| Symptôme | Cause et solution |
|---|---|
| `prepare` échoue : « ne correspond pas à package.json » | le tag et `version` diffèrent : utilisez `npm version`, qui met à jour les deux |
| `build` échoue pour une seule plateforme | relancez ce job (« Re-run failed jobs ») ; la release reste en brouillon tant que tout n'a pas réussi |
| Le cask Homebrew n'est pas mis à jour | secret `HOMEBREW_TAP_TOKEN` absent ou sans droit d'écriture sur le tap |
| La PR winget est refusée | lisez le commentaire du bot de validation ; corrigez `packaging/winget/` et relancez le job `winget` |
| L'app macOS est « endommagée » ou « Apple n'a pas pu vérifier… » après téléchargement | build non notarisé mis en quarantaine : configurez la signature et la notarisation (section 3) ; en attendant, `xattr -dr com.apple.quarantine /Applications/Endora.app` |
| Build macOS : `MAC_CSC_LINK est défini mais APPLE_… manque` | ajoutez les trois secrets `APPLE_*` (section 3) |
| Étape « Vérifier la notarisation » en échec | `spctl` rejette l'app : vérifiez que le certificat est bien un **Developer ID Application** et que `APPLE_TEAM_ID` est celui de ce certificat |
| `npm ci` échoue en CI sur des scripts d'installation | la liste `allowScripts` de `package.json` doit couvrir tout nouveau paquet à script (`npm install-scripts approve` / `deny`) |
