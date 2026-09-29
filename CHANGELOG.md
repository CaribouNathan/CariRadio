# Journal des versions

## 1.1.4
- Plus de demande d'accès au micro : l'app est signée avec le runtime renforcé et sans droit d'entrée audio,
  macOS refuse donc tout accès au micro sans rien demander.

## 1.1.3
- Journal d'erreurs (`~/Library/Logs/CariRadio/cariradio.log`, menu Aide › Afficher le journal d'erreurs).
- Si le processus d'affichage s'arrête, la fenêtre se recharge au lieu de rester vide.

## 1.1.2
- Le micro n'est plus jamais sollicité : entrée audio de Chromium désactivée, toute demande de capture refusée.
- Morceau sans pochette : le logo de la station prend sa place (fenêtre, historique, Centre de contrôle, Stream Deck).

## 1.1.1
- Corrige le plantage au changement France / Monde.
- Une erreur d'affichage montre un message et un bouton « Recharger » au lieu d'une fenêtre vide.

## 1.1.0
- Choix de la station parmi l'annuaire Radio Browser : recherche, Populaires, Genres, Régions / Pays, favoris.
- Menu Stations (⌘1…⌘9, ⌘[ ⌘], ⌘D, ⌘K), boutons favori précédent / suivant, touches média ⏮ ⏭.
- Titre en cours (ICY) et pochette (iTunes) pour les stations hors Radio Choco ; flux HLS via hls.js.
- API locale : `GET /stations`, `POST /station?id=…`, `/station/next`, `/station/prev`.

## 1.0.0
- Lecteur Radio Choco Sound HD, pilotable depuis le Stream Deck (CariCover).
