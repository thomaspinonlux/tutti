/**
 * Ingestion régional Latino + Italie depuis
 * backend/data/tutti-playlists-latino-italie.csv.
 *
 * Playlists :
 *   - Latino  · official-pl-latino  (équilibrée 3 niveaux, ≥15 par niveau)
 *   - Italie  · official-pl-italie  (Cutugno, Ramazzotti, Måneskin, etc.)
 *
 * Note : "Latino" coexiste avec "Latino Fiesta" (vague 1). Les deux restent.
 *
 * Jetable (campagne). Voir _ingestPlaylistsLib.ts pour la logique partagée.
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
loadEnv({ path: '/Users/thomaspinon/Documents/Claude Code/tutti/credentials.env.local' });
import { ingestPlaylists, type PlaylistMeta } from './_ingestPlaylistsLib.js';

const ROOT = '/Users/thomaspinon/Documents/Claude Code/tutti';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

const META: Record<string, PlaylistMeta> = {
  Latino: {
    slug: 'official-pl-latino',
    name_en: 'Latino',
    sub_fr: 'Du reggaetón au son cubain — 3 niveaux équilibrés',
    sub_en: 'From reggaetón to son cubano — balanced 3-level',
    category: 'genres',
  },
  Italie: {
    slug: 'official-pl-italie',
    name_en: 'Italia',
    sub_fr: 'Cutugno, Ramazzotti, Måneskin — la botte au complet',
    sub_en: 'Cutugno, Ramazzotti, Måneskin — full Italian songbook',
    category: 'genres',
  },
};

await ingestPlaylists({
  csvPath: `${ROOT}/backend/data/tutti-playlists-latino-italie.csv`,
  rollbackPath: `${ROOT}/latino-italie-rollback-${STAMP}.json`,
  meta: META,
  campaign: 'latino-italie',
});
process.exit(0);
