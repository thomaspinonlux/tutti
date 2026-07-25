# Tutti en natif — deux cibles en parallèle

Un seul dépôt React → deux applications qui vivent en même temps, reliées par une
fine couche « capacités » (`frontend/src/lib/platform.ts`). **Aucun fork.**

| Cible                        | Dossier     | Techno            | Rôle                                                   |
| ---------------------------- | ----------- | ----------------- | ------------------------------------------------------ |
| **A — Web / PWA** (existant) | `frontend/` | Vite → Vercel     | Les joueurs (zéro install, QR) + secours universel     |
| **B — Natif iPad**           | `native/`   | Capacitor + Swift | La console + le son (Apple Music natif, écran externe) |
| **C — Desktop**              | `desktop/`  | Electron          | Poste du lieu (Windows / Mac)                          |

Le détail stratégique (gains, limites, roadmap) est dans le document de plan
partagé séparément. Ce fichier est la référence côté repo.

## Pourquoi `native/` et `desktop/` sont hors du workspace pnpm

`pnpm-workspace.yaml` ne liste que `frontend`, `backend`, `shared`. Les deux
coques ont leur **propre `package.json` et leurs propres deps**, installées à
part. Conséquence : le `pnpm install --frozen-lockfile` de Vercel/Railway n'est
**jamais** impacté par l'ajout du natif. Le web se déploie exactement comme avant.

## La couche « capacités » (le cœur du parallèle)

`frontend/src/lib/platform.ts` détecte la cible à l'exécution **sans importer**
`@capacitor/core` ni `electron` (donc zéro dépendance ajoutée au web) :

- Capacitor injecte `window.Capacitor` → `isCapacitorNative()`, `getPlatform()`.
- Le preload Electron pose `window.__TUTTI_DESKTOP__` → `isElectron()`.

L'UI et la logique de jeu interrogent ce module ; elles ne savent pas où elles
tournent. C'est ce qui permettra de brancher, plus tard, `NativeMusicKit` (iOS)
vs `WebMusicKitJS` (web) derrière une seule interface.

## État d'avancement

- [x] **Phase 0** — couche `platform.ts` + coques `native/` (Capacitor) et
      `desktop/` (Electron) qui emballent le web tel quel. Build web inchangé.
- [ ] **Phase 1** — pont MusicKit natif (plugin Capacitor Swift) → Apple Music
      full-track sans blocage autoplay sur iPad.
- [ ] **Phase 2** — sortie écran joueurs sur affichage externe (WKWebView sur
      l'`UIScreen` secondaire) → latence TV nulle.
- [ ] **Phase 3** — packaging desktop signé (dmg / NSIS).

Voir `native/README.md` et `desktop/README.md` pour lancer chaque coque.
(Les builds iOS nécessitent un Mac + Xcode ; impossible en CI Linux.)
