# Tutti — coque desktop (Electron)

App **Windows / Mac** pour la console Tutti (cible desktop du plan natif, cf.
[`../docs/NATIVE.md`](../docs/NATIVE.md)). Emballe l'app web dans une fenêtre
dédiée avec deux vrais gains desktop :

- **Autoplay débloqué** — la musique démarre sans geste utilisateur (pendant
  desktop du fix mobile).
- **Micro auto-autorisé** — la reconnaissance vocale marche sans pop-up.

Dossier **hors du workspace pnpm** : deps installées à part, build web
inchangé. Détection côté JS via `window.__TUTTI_DESKTOP__` (posé par
`preload.cjs`), lu par `frontend/src/lib/platform.ts` (`isElectron()`).

## Lancer en dev

```bash
# 1) Démarrer le frontend web (dans un terminal)
pnpm -C ../frontend dev            # sert http://localhost:5173

# 2) Démarrer la coque Electron (dans un autre terminal)
cd desktop
pnpm install
pnpm start                         # ouvre la fenêtre sur localhost:5173
```

## Pointer sur la prod (ou un autre serveur)

La console a besoin du backend live. Le plus simple est de charger l'app
hébergée :

```bash
TUTTI_URL="https://<ton-domaine-tutti>" pnpm start
```

## Packager une app installable

```bash
cd desktop
pnpm install
TUTTI_URL="https://<ton-domaine-tutti>" pnpm run dist       # OS courant
# ou ciblé :
pnpm run dist:mac      # .dmg
pnpm run dist:win      # installeur NSIS
```

Les binaires sortent dans `desktop/release/`. La signature de code (notarization
macOS / certificat Windows) est une étape séparée non couverte ici.

> Note : la coque charge une **URL** (l'app hébergée). C'est le choix le plus
> fiable pour une app temps-réel qui dépend du backend. Un packaging 100 % local
> (charger `../frontend/dist`) demanderait de passer le routeur en HashRouter —
> à faire seulement si un mode hors-ligne devient nécessaire.
