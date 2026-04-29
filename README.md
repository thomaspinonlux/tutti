# Tutti

Plateforme de jeux interactifs multijoueurs (Blind Test musical + Quizz) pour bars, restaurants et particuliers.

## Stack

- **Frontend** : React 18 + TypeScript + Vite + Tailwind CSS + Socket.IO Client
- **Backend** : Node.js 20+ + Express + TypeScript + Socket.IO + Prisma
- **DB & Auth** : PostgreSQL + Supabase (Auth + Storage)
- **Hosting** : Vercel (frontend) + Railway (backend) + Supabase (DB)

## Structure

```
tutti/
├── frontend/          # App React (Vercel)
├── backend/           # Serveur Node + Socket.IO (Railway)
├── shared/            # Types et utilitaires partagés
└── design-references/ # Maquettes HTML de référence (Pop Cocktail)
```

## Développement local

### Prérequis

- Node.js ≥ 20
- pnpm ≥ 9 (`brew install pnpm`)

### Installation

```bash
pnpm install
```

### Lancer en local

```bash
# Tout en parallèle (frontend + backend)
pnpm dev

# Ou séparément
pnpm dev:frontend    # http://localhost:5173
pnpm dev:backend     # http://localhost:3001
```

### Scripts disponibles

```bash
pnpm build        # Build tous les packages
pnpm lint         # Lint TypeScript
pnpm typecheck    # Vérification de types
pnpm format       # Formatage Prettier
```

## Stratégie responsive

Toutes les règles (breakpoints, comportement par route, cibles tactiles, checklist) sont dans **[`docs/RESPONSIVE.md`](docs/RESPONSIVE.md)**.

**TL;DR** :

- Mobile-first systématique (≥ 360 px).
- `/admin/*` : bloqué sub-md, 2 cols md→xl (panel droit en modale), 3 cols xl+.
- `/host` (étape 9+) : bloqué sub-lg, 2 × 2 lg→xl, 4 cols xl+.
- `/screen` (étape 12+) : adaptatif lg→2xl, polices XL pour TV en 2xl.
- `/play` (étape 9+) : mobile-first absolu (375–430 px = la majorité de l'usage), centré max 500 px sur grands écrans.
- Pages publiques : 360 px → 2xl, sans blocage.

Outils : `<MinScreen min="md|lg|xl">` + `useBreakpoint()`.

## Internationalisation

V1 supporte **français** (défaut) et **anglais**. Détection automatique de la langue du navigateur, switch manuel via le composant `<LanguageSwitch />` (persisté en localStorage).

### Ajouter une nouvelle langue

Procédure complète, sans modification de code applicatif :

1. **Frontend** — créer `frontend/src/locales/<code>.json` (par exemple `de.json` pour l'allemand). Copier la structure de `fr.json` et traduire toutes les valeurs.
2. **Frontend** — dans `frontend/src/i18n/index.ts` :
   - importer `import de from '../locales/de.json'`
   - ajouter `de: { translation: de }` à `resources`
   - ajouter `'de'` à `SUPPORTED_LOCALES`
3. **Backend** — créer `backend/src/locales/<code>.json` avec la même structure que `fr.json`.
4. **Backend** — dans `backend/src/lib/i18n.ts` :
   - importer `import de from '../locales/de.json' with { type: 'json' }`
   - ajouter `de` à `RESOURCES`
5. C'est tout : le `<LanguageSwitch />` détecte automatiquement la nouvelle langue, et l'API accepte la nouvelle valeur dans le header `Accept-Language`.

Aucune logique applicative ne référence les codes de langue en dur.

## Variables d'environnement

Voir `backend/.env.example` et `frontend/.env.example`.

**Ne JAMAIS committer** les vrais fichiers `.env*` ni `credentials.env.local`.

## Production

- **Frontend** : https://tutti-brown.vercel.app
- **Backend** : https://accomplished-embrace-production-1807.up.railway.app
- **Repo** : https://github.com/thomaspinonlux/tutti

Tout commit poussé sur `main` redéploie automatiquement les deux services.

## Avancement V1

- [x] **Étape 1 — Setup repo + Hello World + déploiement auto** ✅ (validé le 2026-04-29)
- [x] **Étape 2 — Base de données et schéma Prisma** ✅ (validé le 2026-04-29)
- [x] **Étape 3 — Authentification utilisateurs (email/password Supabase)** ✅ (validé le 2026-04-29)
- [x] **Étape 4 — Internationalisation (FR + EN)** ✅ (validé le 2026-04-29)
- [x] **Étape 5 — Direction visuelle Pop Cocktail** ✅ (validé le 2026-04-29)
- [x] **Étape 6 — Page d'accueil host + sidebar + paramètres établissement** ✅ (validé le 2026-04-29)
- [x] **Étape 7 — Module Music Provider (Demo + Spotify)** ✅ (validé le 2026-04-29)
- [x] **Étape 8 — Création et édition de playlists Tutti Tracks** ✅ (validé le 2026-04-29)
- [ ] Étape 8 — Création et édition de playlists Tutti Tracks
- [ ] Étape 9 — Configuration de session + salle d'attente
- [ ] Étape 10 — Boucle de jeu Tutti Tracks
- [ ] Étape 11 — Reconnaissance vocale Whisper
- [ ] Étape 12 — Multi-écran (vue /screen + mode cast)
- [ ] Étape 13 — Podium et fin de partie
- [ ] Étape 14 — Ajustements de points + Master + Kick
- [ ] Étape 15 — Tutti Quizz
