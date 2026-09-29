#!/bin/bash
# CariRadio — crée l'image disque d'installation : release/CariRadio-<version>-mac-arm64.dmg (+ .zip)
# Mac Intel : lancer « scripts/package-mac.sh x64 » après ce script, ou éditer ARCH ci-dessous.
# Aucune suppression de fichier, aucune écriture hors de ce dossier (hors dossier temporaire du système).
set -e
cd "$(dirname "$0")"
ARCH="arm64"

command -v node >/dev/null 2>&1 || { echo "Node.js est requis (v20 ou plus) : https://nodejs.org"; read -r -p "Entrée pour fermer…" _; exit 1; }

echo "▸ Dépendances"
npm install --no-fund --no-audit
echo "▸ Vérification TypeScript"
npm run typecheck
echo "▸ Build (renderer + main)"
npm run build

scripts/package-mac.sh "$ARCH"

VERSION=$(node -p "require('./package.json').version")
echo
echo "✓ release/CariRadio-${VERSION}-mac-${ARCH}.dmg"
open -R "release/CariRadio-${VERSION}-mac-${ARCH}.dmg"
