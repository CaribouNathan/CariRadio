# Journal des versions

## 1.3.0
- **Icône dans la barre des menus** : station et morceau en cours, lecture/pause, J'aime, enregistrement, favoris,
  volume, mode compact. « REC » s'affiche à côté de l'icône pendant un enregistrement. Désactivable dans le menu
  CariRadio.
- **Morceaux aimés** : cœur sur le morceau en cours (⌘L), onglet « J'aime » (lien Apple Music, retrait au survol),
  conservés entre les lancements. L'étoile « station favorite » passe dans la barre de titre.
- **Mode compact** (⇧⌘M) : fenêtre de 136 px de haut (pochette, titre, commandes), au premier plan par défaut
  (menu Présentation).
- **Historique par station, conservé** : 50 derniers titres par station, gardés quand on change de station et
  après redémarrage ; dates « hier », « 12/09 ».
- **Qualité du flux** : pastille à côté de « En direct » (format et débit réellement mesurés sur les trames audio)
  et fiche détaillée : format, fréquence, canaux, débit mesuré / annoncé, tampon, coupures, serveur, HTTPS.
- **Source de secours** : après 3 échecs d'affilée, CariRadio essaie automatiquement les autres fiches de la même
  radio dans Radio Browser ; « Garder » adopte la nouvelle source pour de bon.
- API locale : `POST /like/toggle`, `POST /compact` ; `/state` expose `track.liked`, `likes`, `quality`, `source`,
  `compact`.

## 1.2.1
- Favoris réorganisables par glisser-déposer avec une poignée ⠿ (les flèches disparaissent) ; défilement
  automatique près des bords ; au clavier, poignée sélectionnée + ↑ / ↓. Le menu Stations (⌘1…⌘9) suit l'ordre.
- Fond du panneau Stations plus opaque.

## 1.2.0
- Bouton d'enregistrement (⌘R) : copie brute du flux, sans réencodage, dans `~/Music/CariRadio`
  (dossier modifiable dans le menu Commandes). Fichier nommé d'après le morceau en cours :
  « Artiste - Titre (Station, date heure).mp3 ». Reconnexion automatique si le flux coupe.
- Clic sur le morceau en cours (titre, artiste ou pochette) : ouvre sa fiche Apple Music, ou une recherche
  Apple Music à défaut de lien direct. Même comportement dans l'historique.
- Pochette qui ne charge pas : le logo de la station prend sa place.
- Échap ferme le panneau Stations quel que soit l'élément actif. Bouton Stations déplacé en haut à droite.
- API locale : `POST /record/toggle`, `/record/start`, `/record/stop` ; `recording` dans `/state`.

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
