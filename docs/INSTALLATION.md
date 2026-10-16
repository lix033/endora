# Installer Endora

Endora fonctionne sur **macOS 11+** (Apple Silicon et Intel), **Windows 10/11** (x64 et ARM) et
**Linux** (x64 et ARM64 ; Debian/Ubuntu, Fedora/RHEL, openSUSE ou toute distribution via AppImage).

- [macOS](#macos)
- [Windows](#windows)
- [Linux](#linux)
- [Vérifier un téléchargement](#vérifier-un-téléchargement)
- [Mettre à jour](#mettre-à-jour)
- [Désinstaller](#désinstaller)
- [Données de l'application](#données-de-lapplication)
- [Dépannage](#dépannage)

---

## macOS

### Homebrew (recommandé)

```bash
brew install --cask lix033/tap/endora
```

### Script d'installation

```bash
curl -fsSL https://lix033.github.io/endora/install.sh | sh
```

Le script détecte l'architecture (Apple Silicon ou Intel), télécharge le `.dmg` de la dernière
version, vérifie son empreinte SHA-256 et copie `Endora.app` dans `/Applications` (ou
`~/Applications` sans droits d'écriture).

Options : `ENDORA_VERSION=0.2.0` (version précise), `ENDORA_PREFIX=~/Apps` (dossier).

```bash
curl -fsSL https://lix033.github.io/endora/install.sh | ENDORA_VERSION=0.1.0 sh
```

### Téléchargement manuel

1. Téléchargez `Endora-<version>-mac-arm64.dmg` (Apple Silicon : M1, M2, M3…) ou
   `Endora-<version>-mac-x64.dmg` (Intel) depuis la [dernière release](https://github.com/lix033/endora/releases/latest).
2. Ouvrez le `.dmg` et glissez **Endora** dans **Applications**.

> **Si macOS indique « Apple n'a pas pu vérifier qu'Endora ne contient pas de logiciel malveillant »**
> (ou que l'app « est endommagée ») : c'est le cas des versions publiées avant la notarisation des
> builds. Cliquez sur **Terminé**, ouvrez **Réglages Système › Confidentialité et sécurité**, puis
> **Ouvrir quand même** en bas de la page (le clic droit › Ouvrir ne suffit plus depuis macOS 15).
> Ou levez la quarantaine dans le Terminal :
>
> ```bash
> xattr -dr com.apple.quarantine /Applications/Endora.app
> ```
>
> Le script d'installation le fait pour vous.

---

## Windows

### winget (intégré à Windows 10/11)

```powershell
winget install lix033.Endora
```

### Scoop

```powershell
scoop bucket add lix033 https://github.com/lix033/scoop-bucket
scoop install endora
```

### Script PowerShell

```powershell
irm https://lix033.github.io/endora/install.ps1 | iex
```

Le script télécharge l'installeur de la dernière version pour votre architecture (x64 ou ARM),
vérifie son empreinte et l'installe silencieusement pour l'utilisateur courant (sans droits
administrateur). Version portable, sans installeur :

```powershell
$env:ENDORA_PORTABLE = '1'; irm https://lix033.github.io/endora/install.ps1 | iex
```

### Téléchargement manuel

- **Installeur** : `Endora-Setup-<version>-x64.exe` (ou `-arm64.exe`), à lancer puis suivre les étapes.
- **Portable** : `Endora-<version>-win-x64.zip`, à décompresser puis lancer `Endora.exe`.

> **Si Windows SmartScreen affiche « Windows a protégé votre ordinateur »** : tant que les builds ne
> sont pas signés, cliquez sur **Informations complémentaires** › **Exécuter quand même**.

---

## Linux

### Script d'installation

```bash
curl -fsSL https://lix033.github.io/endora/install.sh | sh
```

Selon la distribution, le script installe :

| Distribution | Paquet | Commande utilisée |
|---|---|---|
| Debian, Ubuntu, Mint, Pop!_OS… | `.deb` | `sudo apt-get install ./endora_<version>_<arch>.deb` |
| Fedora, RHEL, Rocky, Alma | `.rpm` | `sudo dnf install ./endora-<version>.<arch>.rpm` |
| openSUSE | `.rpm` | `sudo zypper install ./endora-<version>.<arch>.rpm` |
| Autres | AppImage | copiée dans `~/.local/bin/endora` + entrée de menu |

Forcer une méthode : `ENDORA_METHOD=appimage` (sans sudo), `deb` ou `rpm`.

```bash
curl -fsSL https://lix033.github.io/endora/install.sh | ENDORA_METHOD=appimage sh
```

### Téléchargement manuel

```bash
# Debian / Ubuntu
sudo apt install ./endora_<version>_amd64.deb
# Fedora
sudo dnf install ./endora-<version>.x86_64.rpm
# AppImage (toute distribution)
chmod +x Endora-<version>-linux-x86_64.AppImage && ./Endora-<version>-linux-x86_64.AppImage
```

L'AppImage nécessite FUSE 2 sur certaines distributions récentes (`sudo apt install libfuse2t64`
sur Ubuntu 24.04). Une archive `.tar.gz` est aussi fournie.

---

## Vérifier un téléchargement

Chaque release contient `SHA256SUMS.txt`.

```bash
# macOS
shasum -a 256 -c SHA256SUMS.txt --ignore-missing
# Linux
sha256sum -c SHA256SUMS.txt --ignore-missing
```

```powershell
# Windows : comparez avec la ligne correspondante de SHA256SUMS.txt
Get-FileHash .\Endora-Setup-<version>-x64.exe -Algorithm SHA256
```

## Mettre à jour

Endora vérifie au démarrage si une nouvelle version est publiée (**Paramètres › Mises à jour**, désactivable) et propose le lien de téléchargement.

| Méthode d'installation | Mise à jour |
|---|---|
| Homebrew | `brew upgrade --cask endora` |
| winget | `winget upgrade lix033.Endora` |
| Scoop | `scoop update endora` |
| Scripts | relancer la même commande d'installation |
| apt / dnf | relancer le script, ou installer le nouveau paquet |

## Désinstaller

| Méthode | Commande |
|---|---|
| Homebrew | `brew uninstall --cask endora` (ajoutez `--zap` pour supprimer aussi les données) |
| macOS (manuel) | supprimer `/Applications/Endora.app` |
| winget | `winget uninstall lix033.Endora` |
| Scoop | `scoop uninstall endora` |
| Windows (installeur) | Paramètres › Applications › Endora › Désinstaller |
| Debian / Ubuntu | `sudo apt remove endora` |
| Fedora / openSUSE | `sudo dnf remove endora` / `sudo zypper remove endora` |
| AppImage | `rm ~/.local/bin/endora ~/.local/share/applications/endora.desktop` |

## Données de l'application

Collections, environnements, historique et réglages sont stockés localement :

| Système | Dossier |
|---|---|
| macOS | `~/Library/Application Support/Endora/workspace` |
| Windows | `%APPDATA%\Endora\workspace` |
| Linux | `~/.config/Endora/workspace` |

Les collections sont des fichiers JSON au format collection v2.1. Les valeurs des variables de type
« secret » sont chiffrées par le trousseau du système (Trousseau macOS, DPAPI sous Windows,
libsecret/kwallet sous Linux).

## Dépannage

- **« Aucune release publiée »** avec les scripts : vérifiez votre accès à `github.com` (proxy
  d'entreprise) ; `ENDORA_BASE_URL` permet de pointer vers un miroir interne.
- **L'AppImage ne démarre pas** : installez FUSE 2 (voir plus haut) ou utilisez le `.deb` / `.rpm`.
- **Problème non résolu** : ouvrez un [ticket](https://github.com/lix033/endora/issues/new/choose) en
  précisant le système, la version et la méthode d'installation.
