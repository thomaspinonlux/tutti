# Tutti — règles de travail sur ce dépôt

## Après CHAQUE `git push`, vérifier le déploiement

Un déploiement Railway raté **laisse tourner l'ancienne version** : le service
répond normalement, le site marche, et rien ne signale que le code poussé n'est
pas en production.

Le 3 octobre 2026, une erreur TypeScript dans `backend/src/lib/screenState.ts`
a fait échouer **tous** les builds pendant six jours. Le pilote automatique et
la musique d'ambiance du salon étaient dans le dépôt, jamais en production, et
personne ne l'a vu. C'est le mail d'alerte Railway, remarqué par Thomas, qui a
révélé la panne.

Donc : après un push, lire l'état du déploiement (MCP Railway,
`list-deployments`), et ne jamais annoncer qu'un changement de code est en
ligne avant d'avoir vu `SUCCESS`.

Projet Railway `5b7db4f6-ea54-41a7-a724-ebe4b8e8924b`, service
`f87d588c-6f41-49dc-951f-4734f40b900c`, environnement
`7eba7996-b6b8-4f3f-a79d-232f552739cd`.

## Reconstruire `shared` avant de contrôler le backend

`backend` et `frontend` lisent les types de `shared/dist`, pas de
`shared/src`. Un `tsc --noEmit` lancé sans avoir reconstruit `shared` compare
le code d'aujourd'hui à des types potentiellement vieux de plusieurs semaines,
et **ne voit pas** l'erreur que Railway verra. C'est exactement ce qui a caché
la panne ci-dessus.

```
cd shared   && npx tsc            # d'abord, toujours
cd backend  && npx tsc --noEmit -p tsconfig.json
cd frontend && npx tsc --noEmit -p tsconfig.json
```

## Base de données ≠ code

Une correction du catalogue (table Supabase) est active **immédiatement**,
sans déploiement. Une correction de code ne l'est qu'après un build vert. Le
dire clairement quand on annonce un résultat : les deux ne suivent pas le même
chemin.

## Le catalogue Apple Music

- Le contrôle tourne tout seul dans le serveur :
  `backend/src/lib/appleCatalogueCheck.ts`, toutes les six heures, 1 000
  lignes non revues depuis trente jours. Il écarte, il ne remplace jamais un
  identifiant.
- Réparer est un acte lancé à la main, avec rapport :
  `backend/scripts/reparerInjouables.ts` (ajouter `--mode-oeuvre` pour les
  playlists `guess_mode = 'work'`), `reparerArtistes.ts`.
- Contrôler à la demande : `pnpm verify:apple` (catalogue),
  `pnpm tsx scripts/verifierTracksApple.ts` (fiches des espaces de travail).
- La comparaison « est-ce le même morceau ? » vit dans
  `backend/src/lib/comparaisonApple.ts` et sert aux quatre. La modifier d'un
  seul côté casse l'accord entre vérification et réparation.
- Un motif de non-jouabilité posé par un humain (`original_absent_store_fr`)
  est protégé : aucun passage automatique ne doit l'effacer.

## Exécuter les scripts

`tsx`, `vite` et `esbuild` ne tournent pas dans le conteneur Linux (binaires
macOS dans `node_modules`). Les lancer sur le Mac :

```
cd '/Users/thomaspinon/Documents/Claude Code/tutti/backend'
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
(nohup pnpm tsx scripts/<script>.ts > /tmp/<script>.log 2>&1 &)
```

Puis relire le journal. `tsc` seul, lui, fonctionne des deux côtés.
