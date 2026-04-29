# Résilience du flow joueur — Tutti

> Une soirée de blind test au bar implique des téléphones qui sortent et
> reviennent en permanence (SMS, photo, écran qui s'éteint, mode avion
> involontaire, appel entrant…). L'expérience joueur DOIT être robuste à
> ces interruptions, sinon les joueurs perdent leur partie.

## Principes

1. **Identité persistée localement** — un joueur qui revient sur l'URL d'une
   session active reprend exactement où il en était, sans repasser par le
   choix de pseudo / d'équipe.
2. **Socket.IO reconnect agressif** — `reconnection: true,
reconnectionAttempts: Infinity, reconnectionDelay: 2000`.
3. **Pas de suppression côté serveur** — un participant déconnecté reste
   `is_kicked: false` jusqu'à kick explicite ou fin de session.
4. **Wake Lock** pendant `PLAYING` — l'écran reste allumé tant que la partie
   est en cours (fallback gracieux si l'API n'est pas supportée).
5. **Indicateur visuel** discret de l'état de connexion + toast au retour.

## Détails

### 1. Persistance d'identité

Clé localStorage : `tutti.player.{SHORT_CODE}` (donc plusieurs sessions
peuvent coexister sur un même appareil sans conflit).

Valeur :

```json
{
  "token": "…JWT participant…",
  "participantId": "uuid",
  "sessionId": "uuid",
  "pseudo": "Florian",
  "teamId": "uuid|null"
}
```

Cycle de vie :

- **écrite** au succès de `POST /sessions/by-code/:code/join`
- **lue** à chaque montage de `/play?session=CODE` — si présente et le
  token n'est pas expiré, on saute directement à l'étape `waiting` ou
  `playing` selon `session.status`
- **effacée** quand la session passe à `ENDED` (event `session:ended`),
  ou quand le serveur rejette le token (401), ou quand le joueur clique
  explicitement sur "Quitter".

Le JWT participant a un TTL de 24 h. Au-delà, il faut refaire le flow
pseudo + équipe.

### 2. Socket.IO reconnect

```ts
io(SOCKET_URL, {
  auth: { token, role: 'participant' },
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 2000,
  // backoff exponentiel jusqu'à 30 s puis stable
  reconnectionDelayMax: 30000,
});
```

Le serveur ne purge **jamais** un participant à la déconnexion (cf.
`backend/src/socket/index.ts` — pas de `participant:left` automatique).
Le host peut kicker explicitement si besoin.

### 3. Resync au reconnect

Au `connect` Socket.IO (initial OU reconnexion), le client émet
`session:join` avec son `sessionId`. Le serveur retourne un snapshot
complet (status courant, participants, futur : round courant + scores).
Le client met à jour son state local et affiche la bonne UI sans flicker.

### 4. Wake Lock API

Hook `useWakeLock(enabled: boolean)` :

- demande `navigator.wakeLock.request('screen')` quand `enabled === true`
  et la page est visible
- gère `document.visibilitychange` (le navigateur relâche
  automatiquement le sentinel à chaque passage en background, on
  re-demande au retour)
- relâche au démontage / quand `enabled === false`
- fallback silencieux si l'API n'existe pas (Safari iOS < 16.4, Firefox
  Android…). Pas de message d'erreur.

Activé pendant `session.status === 'PLAYING'`. Désactivé en `WAITING`
(pas critique) et en `ENDED`.

### 5. Indicateur de connexion

Composant `<ConnectionIndicator socket={s} />` :

- pastille verte (5 px) en haut à droite quand `connected`
- orange clignotante quand `reconnect_attempt`
- rouge fixe quand `disconnect` durable

Toasts :

- `connection.toastReconnected` au premier `reconnect` après une coupure
- `connection.toastMissedRound` si le serveur signale qu'on a manqué
  des manches (étape 10+, payload `missed_rounds: [...]`)

## Tests à faire avant chaque release

1. Sur téléphone joueur :
   - Fermer la page Tutti, ouvrir un autre app, revenir → reconnect en
     < 3 s sans aucune action utilisateur.
   - Mode avion ON 30 s → OFF → reconnect auto.
   - Bouton home, attendre 1 min, retour Tutti → état correct.
   - Pendant `PLAYING`, ne pas toucher l'écran 1 min → écran reste
     allumé (Wake Lock OK).

2. Sur navigateur desktop (DevTools) :
   - Network throttling "Offline" 30 s → indicator passe rouge → "Online"
     → indicator vert + toast.
   - Fermer l'onglet, rouvrir → reprise sans pseudo.

3. Edge cases :
   - Token expiré (> 24 h) → flow pseudo redemandé proprement.
   - Joueur kické pendant qu'il est offline → au reconnect, message clair
     - clear localStorage.
