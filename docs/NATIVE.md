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
- [x] **Phase 1** — pont MusicKit natif : plugin `native/plugins/tutti-musickit`
      (Swift `ApplicationMusicPlayer`) + wrapper `frontend/src/lib/nativeMusicKit.ts` + wiring guardé dans `useAppleMusicPlayer` (chemin natif si iPad, sinon web
      inchangé). → Apple Music full-track sans blocage autoplay.
- [x] **Phase 2** — sortie écran joueurs : plugin
      `native/plugins/tutti-external-screen` (2ᵉ `UIWindow`/`WKWebView` sur
      l'écran externe) + hook `useExternalPlayerScreen` (no-op hors iPad natif).
- [x] **Phase 3** — desktop : coque Electron packageable (electron-builder
      dmg / NSIS / AppImage) + mode kiosque (`TUTTI_KIOSK=1`). Signature = étape
      user (certificats).

> ⚠️ **Le code natif Swift (phases 1-2) n'a PAS pu être compilé/testé** (pas de
> Mac/Xcode en CI). Il est structuré et prêt à builder sur device — à valider
> via `native/README.md`. La couche JS/TS, elle, est buildée et vérifiée (tsc).
>
> Nuances : YouTube reste en WebView (pas de SDK natif). L'écran externe charge
> l'URL `/screen` hébergée (gain = un seul appareil, plus de cast) ; le rendu
> 100 % local viendrait d'une étape ultérieure servant le bundle à la WebView.

Voir `native/README.md` et `desktop/README.md` pour lancer chaque coque.
