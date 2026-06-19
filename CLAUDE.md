# CLAUDE.md

Guidance for AI assistants working in this repository. Read this before making changes.

## What Tutti is

Tutti is a real-time, multiplayer party-game platform for bars, restaurants and
home use. Two game types share one engine:

- **Tutti Tracks** — musical blind test (listen → buzz/voice → guess title & artist).
- **Tutti Quizz** — quiz packs (MCQ / true-false / free-text / estimation).

A typical session has a **host** (driving the game on an iPad/laptop), **players**
(on their phones), and optionally a **screen** (a TV showing the public view).

> **Language:** the product, UI copy, code comments, and commit messages are in
> **French**. Match that — write new comments and user-facing strings in French
> (with EN translations in the locale files). Identifiers/symbols stay in English.

## Monorepo layout

pnpm workspace (`pnpm-workspace.yaml`), three packages:

```
tutti/
├── frontend/   # @tutti/frontend — React 18 + Vite + Tailwind PWA (deployed to Vercel)
├── backend/    # @tutti/backend  — Node 20 + Express + Socket.IO + Prisma (deployed to Railway)
├── shared/     # @tutti/shared   — types + constants shared end-to-end
├── docs/       # RESPONSIVE.md, PLAYER_RESILIENCE.md (authoritative — read them)
└── design-references/  # static HTML mockups (Pop Cocktail art direction)
```

**Golden rule for `shared/`:** anything that crosses the wire (REST body/response
or any Socket.IO payload) must have its type defined in `shared/src/types/` and be
imported from `@tutti/shared` on both sides. Keep them in sync; do not duplicate
ad-hoc interfaces in frontend or backend.

## Commands

Run from the repo root unless noted. Requires Node ≥ 20 and pnpm ≥ 9.

```bash
pnpm install              # install all workspaces

pnpm dev                  # frontend + backend in parallel
pnpm dev:frontend         # http://localhost:5173
pnpm dev:backend          # http://localhost:3001

pnpm build                # build every package (-r)
pnpm typecheck            # tsc --noEmit across packages
pnpm lint                 # eslint, --max-warnings 0 (warnings fail)
pnpm format               # prettier --write
pnpm format:check         # prettier --check (CI-style)
```

Backend-specific (run inside `backend/`):

```bash
pnpm test                 # node --test over src/**/*.test.ts (tsx loader)
pnpm db:migrate           # prisma migrate deploy
pnpm db:seed              # prisma db seed (prisma/seed.ts)
pnpm db:studio            # prisma studio
```

There are also many one-off data/catalog scripts under `backend/scripts/` exposed
as `pnpm import:*`, `pnpm generate:*`, `pnpm validate:*`, etc. — see
`backend/package.json` scripts before writing a new one.

**Before finishing any change, run `pnpm typecheck` and `pnpm lint`.** A Husky
`pre-commit` hook runs `lint-staged` (Prettier) on staged files.

## Conventions that bite if ignored

- **TypeScript is maximally strict** (`tsconfig.base.json`): `strict`,
  `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`, `noImplicitReturns`,
  `noFallthroughCasesInSwitch`. Indexed access yields `T | undefined` — handle it.
- **ESM everywhere** (`"type": "module"`). Relative imports must include the
  **`.js` extension** even from `.ts`/`.tsx` files
  (e.g. `import { foo } from './foo.js'`). This is intentional, not a mistake.
- **Lint:** `no-explicit-any` is a warning, `no-console` allows only
  `warn`/`error`/`info` (no bare `console.log`). Prefix intentionally-unused
  vars/args with `_`.
- **API error shape** is uniform: `{ error: { code, message } }` with the matching
  HTTP status. The frontend throws a typed `ApiError` (`frontend/src/lib/api.ts`).
  Keep new endpoints consistent.
- **Validation:** request bodies are validated with **Zod** on the backend.
- **No hard-coded locale codes** in app logic — the i18n setup is data-driven
  (see Internationalisation below).

## Frontend architecture (`frontend/src`)

- **Routing** lives in `App.tsx` (react-router v7). Big/heavy pages (host, play,
  screen, playlist editor, session config) are `lazy()`-loaded into separate chunks.
- **Route families & their audiences** (each has distinct responsive rules — see
  `docs/RESPONSIVE.md`, which `App.tsx` references in its header comment):
  - `/` and `/auth/*`, `/privacy`, `/terms` — public, mobile-first 360px→2xl.
  - `/admin/*` — authenticated workspace console (`AdminLayout` + `ProtectedRoute`);
    super-admin-only sub-routes are wrapped in `SuperAdminRouteGuard`.
  - `/host` — the host game console (authenticated, tablet/desktop).
  - `/play` — the player phone view (public, mobile-first absolute).
  - `/screen`, `/tv`, `/tv/:code` — the TV/public screen + second-device join.
- **State:** Zustand store for auth (`stores/auth.ts`) mirrors the Supabase session
  (Supabase is the source of truth, persisted in localStorage). Server state is
  fetched through typed helpers in `lib/` (`api.ts`, `sessions.ts`, `playlists.ts`,
  `library.ts`, …).
- **Components** are grouped by surface: `ui/` (design system), `admin/`, `host/`,
  `play/`, `landing/`, `legal/`, `auth/`.
- **Responsive tooling:** `<MinScreen min="md|lg|xl">` to gate content and the
  `useBreakpoint()` hook. Do not use raw pixel widths or uncontrolled `min-h-screen`.
- **Styling:** Tailwind with the **Pop Cocktail** design tokens
  (`frontend/tailwind.config.js`) — custom colors (`cream`, `spritz`, `basil`,
  `raspberry`…), display fonts, and offset "riso" `shadow-pop*`. Reuse tokens
  instead of arbitrary hex values.
- **PWA:** installable, `vite-plugin-pwa` with `autoUpdate`. The service worker
  never auto-reloads a live game — updates surface via `<PwaUpdateBanner />`.

## Backend architecture (`backend/src`)

- **Entry point** `server.ts` wires CORS (static allowlist + `*.vercel.app` preview
  regex), `express.json`, all routers under `/api/*`, `GET /api/health` (with a DB
  ping) and `/api/whisper/health`, then `initSocketIO`. It also starts background
  crons (YouTube data refresh for policy compliance; session auto-close).
- **Routes** (`routes/`) are thin Express routers mounted in `server.ts`. Gameplay
  is split: `gameplay.ts` (host-driven), `gameplayParticipant.ts` (buzz/answer),
  `gameplayQuizz.ts`, `sessionMaster.ts` (master-participant mode).
- **Middleware** (apply in order):
  - `requireAuth` — validates a Supabase JWT, sets `req.userId` / `req.userEmail`.
  - `requireWorkspace` — multi-tenancy: resolves the user's workspace and sets
    `req.workspaceId` (V1 = one workspace per user). Apply **after** `requireAuth`.
  - `requireMasterParticipant` — validates a participant JWT carrying `is_master`.
  - Super-admin gating is via `lib/superAdmin.ts` (email allowlist) on `/api/admin/*`.
- **Real-time** (`socket/index.ts`): one Socket.IO server, rooms keyed
  `session:{sessionId}`. **Dual auth** at handshake — host connects with a Supabase
  JWT, players with the participant JWT returned by `POST /api/sessions/:code/join`.
  Server emits `session:state`, `participant:joined/left/moved_team/kicked`,
  `session:started`, plus the per-track gameplay events. Use `broadcastToSession`.
- **Gameplay engine** lives in `lib/`: `gameState.ts` (in-memory active-track state),
  `gameplayCore.ts` / `gameplayQuizzCore.ts` (phase progression, snapshots,
  next-track/auto-end), scoring (`scores.ts`, `gameScoring.ts`, `quizzScoring.ts`),
  and answer matching (`voiceMatch*.ts`, `quizzMatch.ts`, alias generation). A track
  round runs through phases `phase1 → phase2 → phase3` (see `CurrentTrackState` and
  `PHASE_2_DURATION_MS` in shared types). **A round plays at most
  `DEFAULT_SESSION_SIZE` (15) tracks**, never the raw playlist pool — enforce via
  `getEffectiveRoundTrackCount`.
- **Music providers** (`music/`): a registry pattern. `registry.ts` resolves a
  `MusicProvider` by id (`demo`, `spotify`, `youtube`) given a tenant context. To add
  a provider: implement `MusicProvider` in a new folder, add a `case` in
  `getProvider()`, and (if exposed) add it to `LIST_PROVIDERS`. Touch nothing else.
- **External integrations:** Supabase (auth + storage), OpenAI Whisper +
  Deepgram/AssemblyAI (voice recognition cascade), Spotify & YouTube (catalog/audio),
  Resend (email), Anthropic SDK (alias/tagging tooling).

## Database & Prisma

- Schema: `backend/prisma/schema.prisma` (PostgreSQL on Supabase, with RLS enabled
  via migration). Core models: `Workspace` / `WorkspaceMember` (multi-tenancy +
  roles/status), `Establishment`, `Playlist` / `Song` / `Artist` / `Track` /
  `PlaylistTrack`, `QuestionSet` / `Question`, `Session` / `SessionRound` /
  `Participant` / `ScoreEvent`, `VoiceTranscript`, and the `Official*` curated
  catalog (`OfficialPlaylist`, `OfficialQuizPack`, …).
- **Migration workflow:** edit `schema.prisma`, then create a migration
  (`pnpm --filter @tutti/backend exec prisma migrate dev --name <change>`). Migrations
  are timestamped folders under `backend/prisma/migrations/` and applied in
  production via `prisma migrate deploy` (Railway start command). Never hand-edit an
  applied migration; add a new one.
- `prisma generate` runs as part of `backend` build. Seed logic is `prisma/seed.ts`.

## Internationalisation

V1 ships **fr** (default) and **en**. Frontend uses i18next
(`frontend/src/i18n/index.ts` + `locales/*.json`); the marketing landing has its own
lightweight `i18n-landing/`. Backend localises responses from `Accept-Language` via
`lib/i18n.ts` + `backend/src/locales/*.json`. Adding a language is **data-only** — no
app-logic change (see README "Ajouter une nouvelle langue" for the exact steps).

## Player resilience (non-negotiable for `/play`)

Phones leave and return constantly during a real bar night. The player flow must
survive it (`docs/PLAYER_RESILIENCE.md`, `frontend/src/lib/socket.ts`): identity is
persisted in localStorage per `short_code`, Socket.IO reconnects aggressively
(`Infinity` attempts, 2s base / 30s cap), the server never deletes a disconnected
participant (only explicit kick / session end), Wake Lock holds the screen during
`PLAYING`, and a connection indicator + return toast give feedback.

## Environment & deployment

- Env vars: copy `backend/.env.example` → `backend/.env` and
  `frontend/.env.example` → `frontend/.env.local`. **Never commit real `.env*` or
  `credentials.env.local`.** Frontend vars are `VITE_`-prefixed.
- **Frontend → Vercel** (`vercel.json`): builds `@tutti/frontend`, SPA rewrite to
  `index.html`, immutable caching for `/assets/*`.
- **Backend → Railway** (`railway.json`): Nixpacks builds shared + backend; start
  runs `prisma migrate deploy` then `node dist/server.js`; health check
  `/api/health`.
- **Any push to `main` auto-deploys both services.** This repo also runs sessions on
  feature branches — develop and push to the branch you were assigned, open a draft
  PR, and never push to `main` without explicit permission.

## Where to look first

- Cross-cutting types/constants → `shared/src/`.
- A REST endpoint → `backend/src/routes/` (mounted in `server.ts`).
- Real-time behaviour → `backend/src/socket/index.ts` + `lib/gameState*.ts`.
- A page or its data flow → `frontend/src/pages/` + the matching `frontend/src/lib/*`.
- Responsive / layout questions → `docs/RESPONSIVE.md`.
- Player reconnection / session persistence → `docs/PLAYER_RESILIENCE.md`.
