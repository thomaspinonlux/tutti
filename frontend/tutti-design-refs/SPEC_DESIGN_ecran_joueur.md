# SPEC DESIGN — Écran joueur / TV Tutti (refonte visuelle)

But : donner à l'écran JOUEUR / ÉCRAN TV (ScreenPage) un style sombre, immersif et
cinématographique, inspiré des blind tests premium (type "This Is Blind Test"), tout en
gardant l'identité Tutti (coral, crème) sur les interfaces de CONTRÔLE (console, manette,
lobby host). PÉRIMÈTRE = uniquement l'écran vu par les joueurs / la TV.

---

1. PRINCIPES GÉNÉRAUX (écran joueur/TV uniquement)

---

- Fond SOMBRE profond : noir (#0B0B0F) → dégradé anthracite (#14141C). Jamais de fond clair.
- Ambiance "salle de concert" : sombre, contrasté, la lumière vient du contenu (pochette, accents).
- Un seul élément dominant par écran. Pas de surcharge. L'écran ne montre QUE le jeu.
- AUCUN bouton de contrôle sur l'écran joueur (les contrôles sont sur console/manette).
- Lisibilité à distance (bar) : typo XXL, gras, fort contraste.

---

2. COULEURS

---

Fond : #0B0B0F → #14141C (dégradé vertical subtil)
Texte principal : #FFFFFF
Texte secondaire: #B8B8C4 (gris clair)
Accent Tutti : coral #FF5C4D (ou la valeur exacte de la charte Tutti) → timer, highlights, badges
Accent 2 : reprendre les couleurs Tutti existantes en TOUCHES seulement (pas en fond)
Surfaces : cartes/blocs en #1C1C26 avec coins arrondis (16-24px) + ombre douce

---

3. TYPOGRAPHIE

---

- Titre de chanson (au reveal) : XXL, très gras (48-72px selon écran), blanc.
- Nom d'artiste : grand (32-48px), gras, sous le titre.
- Labels d'état ("MANCHE 1", "NIVEAU 1", "15 TITRES") : condensé, majuscules, espacé (letter-spacing).
- Garder la typo Tutti si elle existe déjà ; sinon une grotesque grasse (type Inter/Archivo Black).

---

4. LES ÉCRANS (états successifs)

---

A. LOBBY / SALLE D'ATTENTE (écran TV)

- Fond sombre. Titre "LES JOUEURS ARRIVENT…" en haut, blanc XXL.
- QR code GRAND, centré ou à gauche, sur fond clair (carré blanc arrondi) pour scan facile.
- Code de session en très gros dessous (ex: KOMP-T94M), typo mono, espacé.
- Liste des joueurs connectés en cartes sombres, NOMS EN GRAND (le user a demandé
  d'agrandir les noms + le compteur). Compteur "X JOUEURS" bien visible.

B. AVANT MANCHE ("READY")

- Fond sombre. Grand disque vinyle / pochette stylisée au centre.
- "MANCHE N" + "NIVEAU X" + "15 TITRES" en labels condensés autour.
- Animation d'entrée (fade + léger zoom).

C. ÉCOUTE (pendant qu'un titre joue, réponse cachée)

- Fond sombre. Pochette MASQUÉE : silhouette floue / vinyle générique / point d'interrogation stylisé.
- TIMER dominant : cercle animé épais OU barre épaisse, couleur coral, qui se vide.
- Numéro du titre "3 / 15" en coin.
- Zone "derniers buzz" discrète si besoin (petit, bas de l'écran).

D. RÉVÉLATION (reveal de la réponse)

- LA POCHETTE apparaît EN GRAND, nette, centrée, ombre douce — élément star.
- TITRE en XXL + ARTISTE en grand dessous, animation d'entrée (slide/fade).
- Année / album en secondaire.
- Accent coral sur un badge "RÉPONSE".

E. SCORES / CLASSEMENT

- Fond sombre, classement en cartes, nom + points en grand.
- Leader mis en avant (accent coral, plus grand).

---

5. ANIMATIONS / TRANSITIONS

---

- Transitions fluides entre états (fade + zoom léger, 300-500ms).
- Reveal de la pochette : entrée avec scale de 0.9→1 + fade.
- Timer : animation continue fluide (requestAnimationFrame ou CSS), pas de saccade.
- Éviter les animations qui distraient : sobre et premium, pas clignotant.

---

6. CE QU'ON NE TOUCHE PAS

---

- Le design des interfaces de CONTRÔLE (console host, manette animateur, lobby côté host,
  page de config) reste en identité Tutti actuelle (crème/couleurs).
- Toute la logique : socket, reveal, mirroring, anti-triche des rôles, timers serveur.
  C'est un RESTYLE VISUEL de l'écran joueur/TV, pas un changement de logique.
- Le mirroring console ↔ écran TV doit rester parfaitement synchro.

---

7. RÉFÉRENCES VISUELLES (captures fournies dans design_refs/)

---

- 01_selection_repertoires.png : grandes vignettes de répertoires (pochettes riches, fond sombre)
- 02_niveaux.png : niveaux en "cassettes", fond coloré mais sombre, labels clairs
- 03_comment_jouer.png : écran d'explication, typo grande, fond coloré profond
- 04_ready.png : écran d'avant-manche, grand disque, labels manche/niveau/titres
- 05_mode.png : choix de mode, visuels d'artistes plein écran, badges ronds
  (NB : ces captures viennent d'un blind test concurrent = référence de STYLE, pas à copier
  à l'identique ni reprendre leur marque. S'en inspirer pour l'ambiance sombre premium.)
