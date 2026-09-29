#!/bin/bash
# CariRadio — build turnkey : compile, génère l'icône, empaquette et dépose CariRadio.app dans ./release
# Aucune suppression de fichier, aucune écriture hors de ce dossier.
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js est requis (v20 ou plus) : https://nodejs.org"
  read -r -p "Entrée pour fermer…" _
  exit 1
fi

echo "▸ Dépendances"
npm install --no-fund --no-audit
echo "▸ Vérification TypeScript"
npm run typecheck
echo "▸ Build (renderer + main)"
npm run build

echo "▸ Icône (.icns)"
mkdir -p build/icon.iconset
for s in 16 32 128 256 512; do
  sips -z $s $s assets/icon-1024.png --out "build/icon.iconset/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d assets/icon-1024.png --out "build/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns build/icon.iconset -o build/icon.icns

echo "▸ Paquet macOS (Apple Silicon)"
npx electron-builder --mac dir --arm64

APP="release/mac-arm64/CariRadio.app"
echo "▸ Signature ad hoc + runtime renforcé (sans droit micro : macOS refuse l'accès au micro sans rien demander)"
codesign --force --deep --options runtime --entitlements assets/entitlements.mac.plist --sign - "$APP"
codesign --verify --deep --strict "$APP"
codesign -d --entitlements - "$APP" 2>/dev/null | grep -q "audio-input" && { echo "✗ droit micro présent : anormal"; exit 1; }

echo "✓ $APP — glisse-la dans Applications, puis lance-la une fois."
open release/mac-arm64
