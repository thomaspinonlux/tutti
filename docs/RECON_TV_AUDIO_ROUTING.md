# Recon — son sur l'écran TV (opt-in)

**Statut** : recon read-only, **AUCUN code**. Doc de décision avant Phase 3.
**Date** : 2026-06-19.
**Cible** : permettre, quand la TV est ouverte via un **2ᵉ appareil** (code TV `tv_code`), de **router le son vers la TV** au lieu du host, **en opt-in proposé par l'animateur**.

---

## TL;DR — décision à prendre

- **YouTube on TV** : faisable rapidement (~3–5 j). Mount du même `useYouTubePlayer` côté TV, sync via `currentTrack` déjà polled, ajout d'un flag `audio_target` dans `screen-state`, bouton "Activer le son" côté TV pour débloquer l'autoplay.
- **Spotify on TV** : 2 options, **friction très différente**.
  - (a) **Login Spotify sur la TV** (recommandé, propre, ToS-safe) : la TV est un appareil Spotify Premium normal, host transfère via Spotify Connect.
  - (b) **Partage du token host vers la TV** (déconseillé) : pas de 2ᵉ login mais hors-ToS et fuite token si réseau non maîtrisé.
- Le **toggle host** vit en haut-droite (à côté de `TvCastButton`), le **bouton TV "Activer le son"** vit sur `ScreenPage` quand `audioBlocked`.

**Action utilisateur attendue** : valider (a) vs (b) pour Spotify, confirmer si la TV dispose d'un compte Spotify Premium.

---

## 1. Audio aujourd'hui (host-only)

Le son joue **uniquement sur le host**.

- **YouTube** — `frontend/src/lib/useYouTubePlayer.ts:228-1097`
  - IFrame Player API montée sur `<div id="youtube-player-host">` (hors arbre React, possédée par le hook).
  - API : `play(videoId, opts)`, `pause()`, `resume()`, `seek(ms)`, `warmupSync()`, `unblockAudio()`, `tapToStart()`.
  - Position polled toutes les 250 ms via `player.getCurrentTime()`.
- **Spotify** — `frontend/src/lib/useSpotifyPlayer.ts:122-782`
  - Web Playback SDK chargé depuis `https://sdk.scdn.co/spotify-player.js`.
  - Crée un device "Tutti Tracks - Soirée" (lié au compte du host).
  - API : `play(uri)`, `pause()`, `resume()`, `seek(ms)`, `transferToTutti()`, `activate()`, `unblockAudio()`.
  - Transfer Connect auto à l'event `ready` (`useSpotifyPlayer.ts:313-314`) via `PUT /me/player`.
- **Sync vers backend** :
  - `useYouTubeAudioSync.ts:22-113` et `useSpotifyAudioSync.ts:33-136` regardent `currentTrack` (provider, track_id, started_at, phase, isPaused) reçu via `screen-state` et déclenchent `play / pause / resume`.
  - Le backend est la **source de vérité** (= déjà bien factorisé pour un mirror).
- **Position/durée broadcast** :
  - `screen-state` porte `currentTrack` mais **pas la position en cours** (uniquement `started_at`). La TV reconstitue la position localement à partir de `Date.now() - started_at`.
- **Musique d'ambiance sélection** : `useSelectionBackgroundMusic.ts:42-80` (HTMLAudioElement loop, `public/audio/selection-loop.mp3`).

---

## 2. Accès TV — deux chemins, un seul détectable par URL

1. **Auto-detect même navigateur** : `/screen` sans param.
   - `ScreenPage.tsx:56-148` appelle `getMe()` → cookie Supabase → `workspaceId`.
   - Fallback : saisie manuelle.
2. **Appareil séparé via code TV** : `/tv/CODE` ou `/tv` puis saisie.
   - `TvJoinPage.tsx:35-82` → `resolveTvCode(code)` (`lib/tv.ts:29-31`) → `GET /api/tv/{code}` (`backend/src/routes/tv.ts:20-52`) → retourne `{ workspace_id, join_code, session_name }`.
   - L'utilisateur choisit "📺 Écran TV" → `/screen?workspace=<id>` (endpoint public, pas d'auth).

**Distinction "appareil séparé"** : présence du param `?workspace=UUID` dans l'URL. C'est le bon signal pour activer ou non le mode "son sur TV" : OFF par défaut, ON disponible **uniquement** quand `workspaceParam` est set.

Le `tv_code` est généré à la création de session (`backend/src/lib/tvCode.ts:41-52`) et stocké sur `Session.tv_code` (Prisma schema, ~line 20).

---

## 3. Options Spotify sur TV

### (a) — Login Spotify sur la TV _(recommandé)_

- La TV ouvre le flow `startSpotifyConnect()` → token TV propre.
- La TV monte son **propre Web Playback SDK** = nouveau device Spotify.
- Le **host** appelle `PUT /me/player { device_ids: [tv_device_id], play: true }` (Spotify Connect Transfer) pour pousser la lecture vers la TV.
- ✅ Conforme ToS Spotify, propre, fiable.
- ❌ Friction : login Spotify Premium sur la TV. Requiert scope `streaming` = compte Premium vérifié.

### (b) — Partage du token host _(déconseillé)_

- Le host expose son access token à la TV (via API maison ou query param signé).
- La TV monte le SDK avec **le token du host** → device dans le contexte Spotify du host.
- ✅ Aucun 2ᵉ login.
- ❌ Hors-ToS Spotify (token réservé à un client), risque de fuite réseau, durée de vie courte du token = re-fetch fréquent côté TV.

**Recommandation** : MVP en (a). Documenter clairement le pré-requis "Spotify Premium sur la TV".

Fichiers à toucher si (a) :

- Backend : `/backend/src/routes/spotify.ts` — pas de modification si on réutilise le flow existant + nouvelle route `POST /api/workspace/screen-state/audio-target`.
- Backend : `/backend/src/routes/spotify.ts` — ajouter endpoint d'aide pour Transfer Connect (ou laisser le host appeler Spotify directement avec son token).
- Frontend : `useSpotifyPlayer.ts` — ajouter prop `mode: 'host' | 'tv'` (côté TV : auth séparée).
- Schéma : optionnel `Session.tv_spotify_device_id` ou table dédiée `SpotifyDevice { workspace_id, device_id, registered_at }`.

---

## 4. Routing des contrôles (play/pause/seek/suivant)

Bonne nouvelle : **les `useXAudioSync` sont déjà data-driven**. Tant que la TV reçoit le même `currentTrack` que le host (déjà le cas via polling 2 s + triggers socket), **les contrôles ne changent pas** — c'est l'audio sink qui change.

Canal à étendre : `screen-state`. Ajout du champ :

```ts
// dans le payload `currentTrack` ou à la racine de screen-state
audio_target?: 'host' | 'tv';  // défaut 'host' (backward compat)
```

Route à ajouter, copie du pattern `focused-playlist` (`backend/src/routes/screenState.ts:78-119`) :

```
POST /api/workspace/screen-state/audio-target
body: { audio_target: 'host' | 'tv' }
```

- In-memory flag par workspace (idem `qrOverlay`, TTL 30 s OK).
- Émission socket `audio-target-changed` pour forcer la TV à re-poll < 100 ms.

**Latence** : 2 s en polling pur c'est trop pour un seek/next réactif, mais pour un **toggle d'opt-in** (clic explicite avant de lancer un round) c'est OK. Pour play/pause runtime → triggers socket déjà en place.

**Trade-off** : le seek/next côté blind test reste un flow "next track" simple, le trigger socket existant (`track:start`, `session:paused`) propage assez vite.

---

## 5. Emplacements UI

### Toggle host

- **Cible 1 (recommandée)** : header de `HostPage` à côté de `<TvCastButton />` (`pages/HostPage.tsx:1346` et `:1560`).
  - Toggle compact "📺 Son sur TV" / "🎧 Son sur ce device" — visible seulement si `session.tv_code` actif **et** au moins une TV est connectée (signalable via `screen-state` ou un ping côté TV).
- **Cible 2** : dans `TvCastButton.tsx` qui est déjà le hub "TV" — extension naturelle.
- Persister le choix tant que la session vit (in-memory backend, pas de DB).

### Bouton TV "Activer le son sur cet écran"

- `ScreenPage.tsx` (vue `PLAYING`/`PAUSED`), condition : `workspaceParam` set + `audio_target === 'tv'` + `audioBlocked`.
- Action : `unlockAudioSync()` (`lib/audioUnlock.ts:86-146`) SYNC, puis `youtubePlayer.warmupSync()` / `spotifyPlayer.activate()` selon le provider courant.
- Réutiliser le pattern de `PreGameStartScreen.tsx:100-165` (déjà bien rodé sur iOS PWA standalone).
- **Recommandation safety** : toujours afficher le bouton sur la TV en mode `audio_target === 'tv'`, même si `audioBlocked === false` (no-op si déjà unlocked). Évite le "j'ai loupé le gesture initial → silence".

---

## 6. Implémentation recommandée (du plus petit au plus gros)

### YouTube — chemin minimal

1. Schéma `screen-state` : ajout `audio_target?: 'host' | 'tv'`.
2. Backend : route `POST /api/workspace/screen-state/audio-target` + broadcast socket.
3. Host : toggle dans le header (cf. §5) qui POST le flag.
4. TV (`ScreenPage`) :
   - Si `audio_target === 'tv'` : monte `useYouTubePlayer` (nouveau `<div id="youtube-player-tv">` dans `body`).
   - Branche `useYouTubeAudioSync` sur la même `currentTrack` polled.
   - Bouton "🔊 Activer le son sur cet écran" → `unlockAudioSync` + `warmupSync`.
5. Host : si `audio_target === 'tv'`, **pas** de mount YouTube côté host (économie CPU/RAM) — ou mute. Plus simple : mute le player host (gardé chaud) pour switch instantané si la TV se déconnecte.

### Spotify — chemin recommandé (option a)

Tout ce qui précède, plus :

1. Backend (optionnel) : table `SpotifyDevice` ou champ `Session.tv_spotify_device_id`.
2. Frontend TV : `useSpotifyPlayer({ mode: 'tv' })` → auth flow propre côté TV (`startSpotifyConnect`).
3. Host : à `audio_target === 'tv'`, déclenche `PUT /me/player { device_ids: [tv_device_id] }` (host garde son token + son contrôle, la lecture sort sur la TV).
4. Fallback : si la TV se déconnecte (heartbeat manquant), bascule `audio_target` retour à `host` côté backend (TTL ou ping).

### Coût estimé (sans surprise)

- YouTube only : **3–5 j**.
- - Spotify option (a) : **+5–7 j**.
- - heartbeat TV / fallback host : **+1 j**.

---

## 7. Questions ouvertes (réponses utilisateur attendues)

1. **Spotify — (a) ou (b) ?** Recommandation forte (a).
2. **La TV dispose-t-elle d'un compte Spotify Premium** ? Si non → Spotify-on-TV impossible en (a), MVP YouTube-only.
3. **Fallback si TV unmount** : (i) silence jusqu'à ce que le host re-toggle, (ii) auto-bascule sur host, (iii) au choix dans un setting ? Reco : (ii) avec heartbeat 5 s.
4. **Autoplay** : afficher le bouton "Activer le son" toujours ou seulement si bloqué ? Reco : toujours (safe + idempotent).
5. **Mix de providers** : si l'host change de provider en cours de partie, la TV switch automatiquement ? Reco : oui (les `useXAudioSync` le font déjà sur le host, suffit de mounter les 2 hooks côté TV).
6. **Remote pause/seek depuis le host vers la TV** : déjà gratuit avec les `useXAudioSync` data-driven (le `currentTrack` polled inclut `isPaused`). Pas besoin d'API supplémentaire.

---

## 8. Récap fichiers cités

**Frontend** :

- `frontend/src/pages/HostPage.tsx` — toggle host (§5).
- `frontend/src/pages/ScreenPage.tsx` — mount des players côté TV + bouton activer son (§5).
- `frontend/src/pages/TvJoinPage.tsx:35-82` — flow tv_code.
- `frontend/src/lib/useYouTubePlayer.ts:228-1097` — moteur YouTube.
- `frontend/src/lib/useSpotifyPlayer.ts:122-782` — moteur Spotify.
- `frontend/src/lib/useYouTubeAudioSync.ts:22-113` — sync data-driven YouTube.
- `frontend/src/lib/useSpotifyAudioSync.ts:33-136` — sync data-driven Spotify.
- `frontend/src/lib/audioUnlock.ts:86-146` — unlock SYNC.
- `frontend/src/lib/tv.ts:29-31` — `resolveTvCode`.
- `frontend/src/lib/screenState.ts` — contrat polling + POSTs.
- `frontend/src/components/host/TvCastButton.tsx` — extension naturelle pour le toggle.
- `frontend/src/pages/host/PreGameStartScreen.tsx:100-165` — pattern unlock à copier.

**Backend** :

- `backend/src/routes/tv.ts:20-52` — resolve tv_code.
- `backend/src/lib/tvCode.ts:41-52` — génération du code.
- `backend/src/routes/screenState.ts:78-119` — pattern de route à dupliquer pour `audio-target`.
- `backend/src/lib/screenState.ts` — payload + champs à étendre.
- `backend/src/routes/spotify.ts` — auth Spotify (potentiellement à ré-instancier côté TV).
- `backend/prisma/schema.prisma` — Session.tv_code existant, ajout optionnel `tv_spotify_device_id`.
