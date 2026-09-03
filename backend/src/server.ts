/**
 * Tutti backend — point d'entrée du serveur.
 *
 * Étape 1 (Hello World) :
 * - Express + middleware CORS
 * - Endpoint GET /api/health → { status: "ok", ... }
 * - Socket.IO initialisé (pas encore d'événements métier)
 *
 * Au fil des étapes du plan de dev, ce fichier orchestrera les routes,
 * middlewares (auth, tenant), et les handlers Socket.IO.
 */

import 'dotenv/config';
import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import type { HealthResponse } from '@tutti/shared';
import workspacesRouter from './routes/workspaces.js';
import authRouter from './routes/auth.js';
import meRouter from './routes/me.js';
import establishmentRouter from './routes/establishment.js';
import musicRouter from './routes/music.js';
import playlistsRouter from './routes/playlists.js';
import questionSetsRouter from './routes/questionSets.js';
import sessionsRouter from './routes/sessions.js';
import gameplayRouter from './routes/gameplay.js';
import gameplayParticipantRouter from './routes/gameplayParticipant.js';
import gameplayQuizzRouter from './routes/gameplayQuizz.js';
import sessionMasterRouter from './routes/sessionMaster.js';
import spotifyAuthRouter from './music/spotify/auth.js';
import appleAuthRouter from './routes/appleAuth.js';
import { logAppleMusicKeyStatus } from './lib/appleDeveloperToken.js';
import spotifyApiRouter from './routes/spotify.js';
import adminRouter from './routes/admin.js';
import adminAliasesRouter from './routes/adminAliases.js';
import adminLibraryRouter from './routes/adminLibrary.js';
import adminSongTagsRouter from './routes/adminSongTags.js';
import adminUsersRouter from './routes/adminUsers.js';
import adminQuizLibraryRouter from './routes/adminQuizLibrary.js';
import quizLibraryRouter from './routes/quizLibrary.js';
import libraryRouter from './routes/library.js';
import libraryPublicRouter from './routes/libraryPublic.js';
import youtubeAuthRouter from './routes/youtubeAuth.js';
import screenStateRouter from './routes/screenState.js';
import clientLogRouter from './routes/clientLog.js';
import tvRouter from './routes/tv.js';
import { prisma } from './lib/prisma.js';
import { initSocketIO } from './socket/index.js';

const PORT = Number(process.env.PORT ?? 3001);
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const NODE_ENV = process.env.NODE_ENV ?? 'development';

// refactor/single-cors-list — la liste des origines autorisées vit dans
// lib/allowedOrigins.ts, module SANS dépendance, importé par l'API (ici) ET
// par Socket.IO (socket/index.ts). Elle était dupliquée dans les deux
// fichiers ; corriger une copie sans l'autre a cassé l'app native (API ok,
// temps réel refusé). Une seule source désormais.
import { isOriginAllowed } from './lib/allowedOrigins.js';
export { isOriginAllowed };

const app = express();
const httpServer = createServer(app);

// ───── Middlewares globaux ────────────────────────────────────────────────

app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) return callback(null, true);
      callback(new Error(`CORS blocked: origin ${origin} not allowed`));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));

// ───── Routes ─────────────────────────────────────────────────────────────

app.get('/api/health', async (_req, res) => {
  // Vérification rapide DB pour le health check (timeout court).
  let dbStatus: 'ok' | 'down' = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = 'down';
  }

  const response: HealthResponse = {
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '0.0.1',
    // feat/health-commit-sha — SHA du commit déployé, pour vérifier sans auth
    // quel code tourne réellement (Railway le fournit sur les deploys GitHub).
    commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? 'unknown',
  };
  res.json(response);
});

// Healthcheck Whisper : valide que OPENAI_API_KEY est présente + auth OK
// auprès d'OpenAI (sans transcription, juste GET /v1/models).
app.get('/api/whisper/health', async (_req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ status: 'down', reason: 'OPENAI_API_KEY missing' });
    return;
  }
  try {
    const r = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) {
      res.status(503).json({ status: 'down', reason: `OpenAI ${r.status}` });
      return;
    }
    const data = (await r.json()) as { data?: Array<{ id: string }> };
    const hasWhisper = (data.data ?? []).some((m) => m.id === 'whisper-1');
    res.json({
      status: 'ok',
      whisper_available: hasWhisper,
      models_count: data.data?.length ?? 0,
    });
  } catch (err) {
    res.status(503).json({
      status: 'down',
      reason: err instanceof Error ? err.message : 'unknown',
    });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/me', meRouter);
app.use('/api/workspaces', workspacesRouter);
app.use('/api/establishment', establishmentRouter);
app.use('/api/music', musicRouter);
app.use('/api/playlists', playlistsRouter);
app.use('/api/question-sets', questionSetsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/sessions/:id/rounds/:roundId', gameplayRouter);
app.use('/api/sessions/:id/rounds/:roundId', gameplayParticipantRouter);
app.use('/api/sessions/:id/quizz', gameplayQuizzRouter);
app.use('/api/sessions/:id/master', sessionMasterRouter);
app.use('/api/auth/spotify', spotifyAuthRouter);
app.use('/api/auth/apple', appleAuthRouter);
app.use('/api/spotify', spotifyApiRouter);
// feat/tv-carousel-polish — cover mosaïque dynamique. Route publique
// (servie aussi au /screen TV sans auth). Cache headers agressifs côté
// handler (24h CDN-friendly).
app.get('/api/library-cover/:slug.jpg', async (req, res) => {
  try {
    const { generateLibraryCover } = await import('./lib/libraryCover.js');
    const entry = await generateLibraryCover(req.params.slug);
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    res.set('Content-Type', entry.contentType);
    res.send(entry.buffer);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'NOT_FOUND') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Playlist introuvable' } });
      return;
    }
    if (msg === 'NO_COVERS') {
      res.status(404).json({ error: { code: 'NO_COVERS', message: 'Pas de covers dispo' } });
      return;
    }
    console.error('[GET /api/library-cover] error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: msg } });
  }
});

app.use('/api/admin', adminRouter);
app.use('/api/admin/aliases', adminAliasesRouter);
app.use('/api/admin/library', adminLibraryRouter);
app.use('/api/admin/library', adminQuizLibraryRouter);
app.use('/api/admin/song-tags', adminSongTagsRouter);
app.use('/api/admin/users', adminUsersRouter);
app.use('/api/library', quizLibraryRouter);
app.use('/api/library', libraryRouter);
app.use('/api/library-public', libraryPublicRouter);
app.use('/api/auth/youtube', youtubeAuthRouter);
app.use('/api/workspace', screenStateRouter);
app.use('/api', clientLogRouter);
app.use('/api/tv', tvRouter);

// 404 par défaut
app.use((_req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Route non trouvée' },
  });
});

// ───── Socket.IO (étape 9+ : auth + rooms par session) ────────────────────

const io = initSocketIO(httpServer);

// ───── Démarrage ──────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.info(`[tutti-backend] démarré en mode ${NODE_ENV} sur http://localhost:${PORT}`);
  console.info(`[tutti-backend] CORS autorisé pour: ${FRONTEND_URL}`);
  // Audit des providers musique chargés (Phase 3 — préparation YouTube)
  const spotifyOk = Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
  const youtubeOk = Boolean(process.env.YOUTUBE_API_KEY);
  console.info(
    `[tutti-backend] providers — spotify=${spotifyOk ? 'OK' : 'MISSING'} youtube=${youtubeOk ? 'OK' : 'MISSING'}`,
  );
  // feat/apple-music — valide le parsing de la clé MusicKit au boot (log clair).
  logAppleMusicKeyStatus();
  // feat/youtube-compliance — démarre le cron de refresh data YouTube
  // (YouTube API Services Developer Policies III.E.4 : refresh ou suppression
  // au moins tous les 30 jours). Skip en tests / dev sans YT API key.
  if (youtubeOk && NODE_ENV === 'production') {
    void import('./lib/youtubeRefresh.js').then(({ startYouTubeRefreshCron }) => {
      startYouTubeRefreshCron();
    });
  } else if (!youtubeOk) {
    console.warn(
      '[tutti-backend] YT refresh cron skip — YOUTUBE_API_KEY absent (compliance 30j NOT enforced)',
    );
  }

  // fix/restrict-banners-to-host-pages — démarre le cron d'auto-close des
  // sessions inactives (> 2h sans activité → status=ENDED). Évite les
  // sessions zombies qui polluent le dashboard host + bloquent la TV.
  // Pas conditionné à NODE_ENV : utile aussi en staging/dev.
  if (NODE_ENV !== 'test') {
    void import('./lib/sessionAutoClose.js').then(({ startSessionAutoCloseCron }) => {
      startSessionAutoCloseCron();
    });
  }
});

// Gestion propre des arrêts
// fix/serveur-qui-s-arrete — LE PROCESSUS NE DOIT PLUS TOMBER SUR UNE ERREUR
// ISOLÉE. Express 4 n'attrape pas les erreurs des gestionnaires asynchrones :
// un simple hoquet de la base pendant un lancement de manche remontait jusqu'à
// Node, qui arrête le processus par défaut. Au redémarrage, la manche en cours
// est perdue (l'état vit en mémoire), tous les buzz sont refusés et la TV
// retombe en attente — en pleine soirée. On journalise et on continue : un
// serveur qui a raté une requête vaut infiniment mieux qu'un serveur mort.
process.on('unhandledRejection', (raison: unknown) => {
  console.error('[tutti-backend] promesse rejetée non traitée :', raison);
});
process.on('uncaughtException', (err: Error) => {
  console.error('[tutti-backend] exception non traitée :', err);
});

const shutdown = (signal: string): void => {
  console.info(`[tutti-backend] signal ${signal} reçu — arrêt en cours...`);
  // fix/arret-qui-traine — un délai de garde force la sortie.
  // L'arrêt fermait deux fois le même serveur, n'attendait rien et n'arrêtait
  // aucune tâche périodique : un redéploiement pouvait rester suspendu jusqu'à
  // ce que la plateforme tue le conteneur brutalement.
  const sortieForcee = setTimeout(() => {
    console.warn('[tutti-backend] arrêt forcé après 10 s');
    process.exit(0);
  }, 10_000);
  sortieForcee.unref();

  void Promise.resolve(io.close())
    .catch((err: unknown) => console.warn('[tutti-backend] fermeture socket :', err))
    .finally(() => {
      void prisma.$disconnect().finally(() => {
        console.info('[tutti-backend] arrêté proprement');
        process.exit(0);
      });
    });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
