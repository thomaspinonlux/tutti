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
- [ ] Étape 3 — Authentification utilisateurs
- [ ] Étape 4 — Internationalisation (FR + EN)
- [ ] Étape 5 — Direction visuelle Pop Cocktail
- [ ] Étape 6 — Page d'accueil host + choix du jeu
- [ ] Étape 7 — Module Music Provider (Demo + Spotify)
- [ ] Étape 8 — Création et édition de playlists Tutti Tracks
- [ ] Étape 9 — Configuration de session + salle d'attente
- [ ] Étape 10 — Boucle de jeu Tutti Tracks
- [ ] Étape 11 — Reconnaissance vocale Whisper
- [ ] Étape 12 — Multi-écran (vue /screen + mode cast)
- [ ] Étape 13 — Podium et fin de partie
- [ ] Étape 14 — Ajustements de points + Master + Kick
- [ ] Étape 15 — Tutti Quizz
