/**
 * Ingestion vague 2 — 6 playlists thématiques multi-niveaux depuis
 * backend/data/tutti-playlists-vague2.csv.
 *
 * Playlists (créées si absentes, réutilisées sinon) :
 *   - Intros légendaires           · official-pl-intros-legendaires
 *   - Génériques films & séries    · official-pl-generiques-films-series
 *   - Disco dancefloor             · official-pl-disco-dancefloor
 *   - Rap FR culte                 · official-pl-rap-fr-culte
 *   - Tubes de l'été               · official-pl-tubes-de-l-ete
 *   - Slows cultes                 · official-pl-slows-cultes
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
  'Intros légendaires': {
    slug: 'official-pl-intros-legendaires',
    name_en: 'Legendary Intros',
    sub_fr: '3 secondes et c’est gagné — riffs et ouvertures iconiques',
    sub_en: 'Three seconds and you know — iconic riffs',
    category: 'originals',
  },
  'Génériques films & séries': {
    slug: 'official-pl-generiques-films-series',
    name_en: 'Movie & TV Themes',
    sub_fr: 'BO et thèmes de séries — la madeleine garantie',
    sub_en: 'Soundtracks and TV themes — guaranteed nostalgia',
    category: 'originals',
  },
  'Disco dancefloor': {
    slug: 'official-pl-disco-dancefloor',
    name_en: 'Disco Dancefloor',
    sub_fr: 'Boule à facettes obligatoire',
    sub_en: 'Mirror ball mandatory',
    category: 'genres',
  },
  'Rap FR culte': {
    slug: 'official-pl-rap-fr-culte',
    name_en: 'Iconic FR Rap',
    sub_fr: 'IAM, NTM, Stromae, Orelsan, PNL — le panthéon FR',
    sub_en: 'The French rap canon, from IAM to PNL',
    category: 'genres',
  },
  "Tubes de l'été": {
    slug: 'official-pl-tubes-de-l-ete',
    name_en: 'Summer Smashes',
    sub_fr: 'Plage, terrasse, autoradio — les hymnes estivaux',
    sub_en: 'Beach, terrace, road trip — summer anthems',
    category: 'originals',
  },
  'Slows cultes': {
    slug: 'official-pl-slows-cultes',
    name_en: 'Iconic Slow Dances',
    sub_fr: 'Briquet en l’air, c’est l’heure du slow',
    sub_en: 'Lighters up — slow dance hour',
    category: 'genres',
  },
};

await ingestPlaylists({
  csvPath: `${ROOT}/backend/data/tutti-playlists-vague2.csv`,
  rollbackPath: `${ROOT}/vague2-rollback-${STAMP}.json`,
  meta: META,
  campaign: 'vague2',
});
process.exit(0);
