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
import spotifyApiRouter from './routes/spotify.js';
import adminRouter from './routes/admin.js';
import adminAliasesRouter from './routes/adminAliases.js';
import adminLibraryRouter from './routes/adminLibrary.js';
import adminSongTagsRouter from './routes/adminSongTags.js';
import adminUsersRouter from './routes/adminUsers.js';
import adminQuizLibraryRouter from './routes/adminQuizLibrary.js';
import quizLibraryRouter from './routes/quizLibrary.js';
import libraryRouter from './routes/library.js';
import youtubeAuthRouter from './routes/youtubeAuth.js';
import screenStateRouter from './routes/screenState.js';
import tvRouter from './routes/tv.js';
import { prisma } from './lib/prisma.js';
import { initSocketIO } from './socket/index.js';

const PORT = Number(process.env.PORT ?? 3001);
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const NODE_ENV = process.env.NODE_ENV ?? 'development';

/**
 * CORS whitelist — origines autorisées à appeler l'API + Socket.IO.
 *
 * Prod : domaines custom + URL Vercel temporaire pour debug.
 * Dev  : localhost (Vite par défaut + 3000 si jamais).
 *
 * On accepte en plus FRONTEND_URL si configuré (override env), et tous les
 * sous-domaines *.vercel.app pour les preview deploys.
 */
const STATIC_ALLOWED_ORIGINS = [
  'https://tuttiparty.app',
  'https://www.tuttiparty.app',
  'https://tutti-brown.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
];

const allowedOrigins = new Set(STATIC_ALLOWED_ORIGINS);
if (FRONTEND_URL) allowedOrigins.add(FRONTEND_URL);

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // requêtes server-to-server / curl / sans Origin header
  if (allowedOrigins.has(origin)) return true;
  // Preview deploys Vercel : *.vercel.app appartenant au projet tutti
  if (/^https:\/\/tutti-[a-z0-9-]+\.vercel\.app$/.test(origin)) return true;
  return false;
}

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
app.use('/api/auth/youtube', youtubeAuthRouter);
app.use('/api/workspace', screenStateRouter);
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
const shutdown = (signal: string): void => {
  console.info(`[tutti-backend] signal ${signal} reçu — arrêt en cours...`);
  io.close();
  httpServer.close(() => {
    void prisma.$disconnect().finally(() => {
      console.info('[tutti-backend] arrêté proprement');
      process.exit(0);
    });
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
