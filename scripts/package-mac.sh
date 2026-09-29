#!/bin/bash
# Empaquette CariRadio pour macOS : .app signée (ad hoc, ou Developer ID si configuré), puis .zip et .dmg.
#   scripts/package-mac.sh arm64|x64
# Utilisé par le workflow GitHub Actions (.github/workflows/release.yml) ; fonctionne aussi en local.
# N'écrit que dans ./build, ./release et un dossier temporaire ; aucune suppression de fichier.
#
# Signature Developer ID + notarisation (facultatif) : définir ces variables d'environnement
#   MAC_SIGN_IDENTITY   ex. "Developer ID Application: Nathan Carrillat (TEAMID)" (certificat déjà dans le trousseau)
#   APPLE_ID, APPLE_TEAM_ID, APPLE_APP_PASSWORD   (mot de passe d'app généré sur appleid.apple.com)
set -euo pipefail
cd "$(dirname "$0")/.."

ARCH="${1:-arm64}"
case "$ARCH" in arm64|x64) ;; *) echo "Architecture inconnue : $ARCH (arm64 ou x64)"; exit 1 ;; esac
VERSION=$(node -p "require('./package.json').version")
NAME="CariRadio-${VERSION}-mac-${ARCH}"

echo "▸ Icône (.icns)"
mkdir -p build/icon.iconset
for s in 16 32 128 256 512; do
  sips -z $s $s assets/icon-1024.png --out "build/icon.iconset/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d assets/icon-1024.png --out "build/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns build/icon.iconset -o build/icon.icns

echo "▸ Paquet .app ($ARCH)"
npx electron-builder --mac dir "--$ARCH" --publish never
if [ "$ARCH" = "arm64" ]; then APP="release/mac-arm64/CariRadio.app"; else APP="release/mac/CariRadio.app"; fi
[ -d "$APP" ] || { echo "Introuvable : $APP"; exit 1; }

if [ -n "${MAC_SIGN_IDENTITY:-}" ]; then
  echo "▸ Signature Developer ID (runtime renforcé)"
  codesign --force --deep --timestamp --options runtime \
    --entitlements assets/entitlements.mac.plist --sign "$MAC_SIGN_IDENTITY" "$APP"
else
  echo "▸ Signature ad hoc + runtime renforcé"
  codesign --force --deep --options runtime --entitlements assets/entitlements.mac.plist --sign - "$APP"
fi
codesign --verify --deep --strict "$APP"

STAGE=$(mktemp -d)
ditto "$APP" "$STAGE/CariRadio.app"

if [ -n "${MAC_SIGN_IDENTITY:-}" ] && [ -n "${APPLE_ID:-}" ]; then
  echo "▸ Notarisation Apple"
  ditto -c -k --keepParent "$STAGE/CariRadio.app" "$STAGE/notarize.zip"
  xcrun notarytool submit "$STAGE/notarize.zip" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_APP_PASSWORD" --wait
  xcrun stapler staple "$STAGE/CariRadio.app"
fi

echo "▸ Archive .zip"
ditto -c -k --sequesterRsrc --keepParent "$STAGE/CariRadio.app" "release/${NAME}.zip"

echo "▸ Image disque .dmg"
DMGSRC="$STAGE/dmg"
mkdir -p "$DMGSRC"
ditto "$STAGE/CariRadio.app" "$DMGSRC/CariRadio.app"
ln -s /Applications "$DMGSRC/Applications"   # raccourci dans l'image disque (glisser-déposer)
hdiutil create -volname "CariRadio" -srcfolder "$DMGSRC" -ov -format UDZO "release/${NAME}.dmg" >/dev/null
[ -n "${MAC_SIGN_IDENTITY:-}" ] && codesign --sign "$MAC_SIGN_IDENTITY" --timestamp "release/${NAME}.dmg"

echo "✓ release/${NAME}.zip"
echo "✓ release/${NAME}.dmg"
