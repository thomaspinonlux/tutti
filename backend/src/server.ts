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
import { prisma } from './lib/prisma.js';
import { initSocketIO } from './socket/index.js';

const PORT = Number(process.env.PORT ?? 3001);
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const NODE_ENV = process.env.NODE_ENV ?? 'development';

const app = express();
const httpServer = createServer(app);

// ───── Middlewares globaux ────────────────────────────────────────────────

app.use(
  cors({
    origin: FRONTEND_URL,
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
