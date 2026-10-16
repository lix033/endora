#!/bin/sh
# Installe Endora sur macOS ou Linux depuis les releases GitHub.
#
#   curl -fsSL https://raw.githubusercontent.com/lix033/endora/main/scripts/install.sh | sh
#
# Variables facultatives :
#   ENDORA_VERSION=0.2.0      version précise (défaut : dernière release)
#   ENDORA_METHOD=appimage    Linux : deb | rpm | appimage (défaut : selon la distribution)
#   ENDORA_PREFIX=$HOME/Apps  macOS : dossier d'installation (défaut : /Applications ou ~/Applications)
#   ENDORA_BASE_URL=…         miroir des fichiers de release (tests, réseaux d'entreprise)
set -eu

REPO="lix033/endora"
VERSION="${ENDORA_VERSION:-latest}"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
fail() {
  printf '\033[1;31merreur :\033[0m %s\n' "$*" >&2
  exit 1
}
need() { command -v "$1" >/dev/null 2>&1 || fail "commande requise introuvable : $1"; }

need curl
need uname

# Version : la dernière release est déduite de la redirection de /releases/latest (sans API ni jeton).
if [ "$VERSION" = "latest" ]; then
  url=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest") || fail "impossible de joindre GitHub"
  VERSION=${url##*/v}
  case "$VERSION" in
    *[!0-9.a-z-]* | "") fail "aucune release publiée trouvée pour $REPO" ;;
  esac
fi
VERSION=${VERSION#v}
BASE="${ENDORA_BASE_URL:-https://github.com/$REPO/releases/download/v$VERSION}"

case "$(uname -m)" in
  x86_64 | amd64) ARCH=x64 ;;
  arm64 | aarch64) ARCH=arm64 ;;
  *) fail "architecture non prise en charge : $(uname -m)" ;;
esac

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM

download() {
  say "Téléchargement de $1"
  curl -fL --progress-bar -o "$TMP/$1" "$BASE/$1" || fail "téléchargement impossible : $BASE/$1"
  # Vérification de l'empreinte publiée avec la release, si disponible.
  if curl -fsSL -o "$TMP/SHA256SUMS.txt" "$BASE/SHA256SUMS.txt" 2>/dev/null; then
    expected=$(grep " $1\$" "$TMP/SHA256SUMS.txt" | cut -d' ' -f1 || true)
    if [ -n "$expected" ]; then
      if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$TMP/$1" | cut -d' ' -f1); else actual=$(shasum -a 256 "$TMP/$1" | cut -d' ' -f1); fi
      [ "$expected" = "$actual" ] || fail "empreinte SHA-256 invalide pour $1"
      say "Empreinte SHA-256 vérifiée"
    fi
  fi
}

install_macos() {
  need hdiutil
  file="Endora-$VERSION-mac-$ARCH.dmg"
  download "$file"
  if [ -n "${ENDORA_PREFIX:-}" ]; then dest="$ENDORA_PREFIX"; elif [ -w /Applications ]; then dest=/Applications; else dest="$HOME/Applications"; fi
  mkdir -p "$dest"
  mount="$TMP/mnt"
  hdiutil attach -nobrowse -quiet -mountpoint "$mount" "$TMP/$file"
  rm -rf "$dest/Endora.app"
  ditto "$mount/Endora.app" "$dest/Endora.app"
  hdiutil detach -quiet "$mount"
  # Les builds non signés sont mis en quarantaine par Gatekeeper ; l'installation explicite la lève.
  xattr -dr com.apple.quarantine "$dest/Endora.app" 2>/dev/null || true
  say "Endora $VERSION installé dans $dest/Endora.app"
}

sudo_cmd() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; elif command -v sudo >/dev/null 2>&1; then sudo "$@"; else fail "droits administrateur requis (sudo introuvable)"; fi
}

install_appimage() {
  appimage_arch=$([ "$ARCH" = x64 ] && echo x86_64 || echo arm64)
  file="Endora-$VERSION-linux-$appimage_arch.AppImage"
  download "$file"
  bin="$HOME/.local/bin"
  share="$HOME/.local/share"
  mkdir -p "$bin" "$share/applications" "$share/icons/hicolor/512x512/apps"
  install -m 755 "$TMP/$file" "$bin/endora"
  curl -fsSL -o "$share/icons/hicolor/512x512/apps/endora.png" "https://raw.githubusercontent.com/$REPO/v$VERSION/build/icon-512.png" || true
  cat >"$share/applications/endora.desktop" <<EOF
[Desktop Entry]
Name=Endora
Comment=Client API de bureau open source
Exec=$bin/endora %U
Icon=endora
Type=Application
Categories=Development;
EOF
  say "Endora $VERSION installé : $bin/endora"
  case ":$PATH:" in *":$bin:"*) ;; *) say "Ajoutez $bin à votre PATH pour lancer « endora » depuis le terminal." ;; esac
}

install_linux() {
  method="${ENDORA_METHOD:-auto}"
  if [ "$method" = auto ]; then
    if command -v apt-get >/dev/null 2>&1 && command -v dpkg >/dev/null 2>&1; then
      method=deb
    elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1 || command -v zypper >/dev/null 2>&1; then
      method=rpm
    else
      method=appimage
    fi
  fi
  case "$method" in
    deb)
      file="endora_${VERSION}_$([ "$ARCH" = x64 ] && echo amd64 || echo arm64).deb"
      download "$file"
      sudo_cmd apt-get install -y "$TMP/$file"
      say "Endora $VERSION installé (paquet deb). Lancez « endora » ou ouvrez-le depuis le menu."
      ;;
    rpm)
      file="endora-$VERSION.$([ "$ARCH" = x64 ] && echo x86_64 || echo aarch64).rpm"
      download "$file"
      if command -v dnf >/dev/null 2>&1; then
        sudo_cmd dnf install -y "$TMP/$file"
      elif command -v zypper >/dev/null 2>&1; then
        sudo_cmd zypper --non-interactive install --allow-unsigned-rpm "$TMP/$file"
      else
        sudo_cmd yum install -y "$TMP/$file"
      fi
      say "Endora $VERSION installé (paquet rpm). Lancez « endora » ou ouvrez-le depuis le menu."
      ;;
    appimage) install_appimage ;;
    *) fail "méthode inconnue : $method (deb, rpm ou appimage)" ;;
  esac
}

case "$(uname -s)" in
  Darwin) install_macos ;;
  Linux) install_linux ;;
  *) fail "système non pris en charge : $(uname -s) — sous Windows, utilisez install.ps1" ;;
esac
