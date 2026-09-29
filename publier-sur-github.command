#!/bin/bash
# CariRadio — publication sur GitHub (dépôt CaribouNathan/CariRadio).
#  1. crée le dépôt git local si besoin et enregistre les modifications (commit) ;
#  2. crée le dépôt GitHub public au premier lancement (après confirmation), sinon pousse sur main ;
#  3. pose le tag vX.Y.Z (version de package.json) et l'envoie : GitHub Actions compile alors
#     les .dmg/.zip Apple Silicon + Intel et crée la release.
# Pour une nouvelle version : changer "version" dans package.json, ajouter la section au CHANGELOG.md, relancer.
# Aucune suppression de fichier ; n'écrit que dans ce dossier (.git) et sur GitHub.
set -e
cd "$(dirname "$0")"
REPO="CaribouNathan/CariRadio"
pause() { read -r -p "Entrée pour fermer…" _; }

command -v git >/dev/null || { echo "git est requis (xcode-select --install)."; pause; exit 1; }
command -v gh >/dev/null || { echo "GitHub CLI est requis : brew install gh"; pause; exit 1; }
command -v node >/dev/null || { echo "Node.js est requis : https://nodejs.org"; pause; exit 1; }
gh auth status >/dev/null 2>&1 || gh auth login

VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
grep -q "^## $VERSION\$" CHANGELOG.md || { echo "Ajoute d'abord une section « ## $VERSION » dans CHANGELOG.md."; pause; exit 1; }

if [ -z "$(git config user.name)" ] || [ -z "$(git config user.email)" ]; then
  read -r -p "Nom pour les commits : " N;  git config --global user.name "$N"
  read -r -p "E-mail pour les commits : " E; git config --global user.email "$E"
fi

[ -d .git ] || git init -b main
git add -A
if git diff --cached --quiet; then echo "▸ Rien de nouveau à enregistrer"; else git commit -m "CariRadio $VERSION"; fi

if git ls-remote --exit-code --tags origin "$TAG" >/dev/null 2>&1 || git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "Le tag $TAG existe déjà. Pour publier une nouvelle version, augmente \"version\" dans package.json."
  pause; exit 1
fi

if gh repo view "$REPO" >/dev/null 2>&1; then
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$REPO.git"
  echo "▸ Envoi sur $REPO"
  git push -u origin main
else
  read -r -p "Créer le dépôt PUBLIC github.com/$REPO ? (o/N) " OK
  [ "$OK" = "o" ] || [ "$OK" = "O" ] || { echo "Annulé."; pause; exit 1; }
  gh repo create "$REPO" --public --description "Mini lecteur de radios pour macOS, pilotable depuis le Stream Deck — Caribou Labs" \
    --source . --remote origin --push
  gh repo edit "$REPO" --add-topic macos --add-topic radio --add-topic electron --add-topic stream-deck >/dev/null || true
fi

echo "▸ Tag $TAG → compilation de la release sur GitHub Actions"
git tag -a "$TAG" -m "CariRadio $VERSION"
git push origin "$TAG"

echo
echo "✓ Compilation lancée (≈ 5 à 10 min). Release : https://github.com/$REPO/releases/tag/$TAG"
open "https://github.com/$REPO/actions"
pause
