/**
 * autoTagSongs.ts — feat/song-tags-classification (ÉTAPE 3, passe de tagging auto)
 *
 * DÉDUIT les tags (themes / langue / niveau / œuvre) des 2434 songs depuis les
 * playlists officielles d'origine + heuristiques titre/artiste. PAR DÉFAUT =
 * DRY-RUN : écrit un RAPPORT + un CSV par-song sur disque, AUCUNE écriture DB.
 *
 *   railway run pnpm exec tsx scripts/autoTagSongs.ts          # dry-run (rapport)
 *   railway run pnpm exec tsx scripts/autoTagSongs.ts --apply  # écrit en DB (après GO)
 *
 * Sources de déduction (jamais en aveugle) :
 *   - themes[]   : union des thèmes des playlists où la song apparaît
 *                  (mapping name_fr/theme → lib des 52 thèmes validés).
 *   - langue     : locale des playlists + heuristique titre (diacritiques/mots
 *                  FR vs anglais) + artiste francophone (apparaît dans ≥1
 *                  playlist FR). Une song peut être franco ET inter.
 *   - level 1/2/3: suffixe du nom de playlist (Facile/Moyen/Difficile) ; min si
 *                  plusieurs ; null si aucun signal (jamais deviné).
 *   - work_kind  : si la song vient d'une œuvre (thème ciné/série/dessin/jeu/
 *                  comédie musicale). work_title laissé null (rempli à la main
 *                  en ÉTAPE 4 — non dérivable automatiquement de façon fiable).
 *
 * tags_reviewed reste false partout (ÉTAPE 4 le passera à true après révision).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma.js';
import { SONG_THEME_SLUGS, WORK_THEME_SLUGS } from '../src/lib/songThemes.js';

const APPLY = process.argv.includes('--apply');
// fileURLToPath (et non .pathname) pour décoder les espaces du chemin ("Claude
// Code" → pas "Claude%20Code").
const OUT_DIR = fileURLToPath(new URL('../../exports/', import.meta.url));
const STAMP = '2026-06-14';

// ── Mapping playlist → thèmes (slugs des 52) ───────────────────────────────
function mapPlaylistToThemes(name: string, theme: string | null): string[] {
  const out = new Set<string>();
  const n = name.toLowerCase();
  const th = (theme ?? '').toLowerCase();
  const add = (...ts: string[]): void => ts.forEach((t) => out.add(t));

  // Décennies
  if (/ann[ée]es?\s*60|y[ée]y[ée]/.test(n)) add('annees_60');
  if (/ann[ée]es?\s*70|\b70s\b/.test(n)) add('annees_70');
  if (/ann[ée]es?\s*80|\b80s\b/.test(n)) add('annees_80');
  if (/ann[ée]es?\s*90|\b90s\b/.test(n)) add('annees_90');
  if (/ann[ée]es?\s*2000|2000s/.test(n)) add('annees_2000');
  if (/ann[ée]es?\s*2010|2010s/.test(n)) add('annees_2010');
  if (/ann[ée]es?\s*2020|2020s/.test(n)) add('annees_2020');
  // Genres
  if (/italo\s*disco/.test(n)) add('italo_disco');
  if (/disco|funk/.test(n)) add('disco_funk');
  if (/metal|hard\s*rock/.test(n)) add('metal');
  if (/punk/.test(n)) add('punk');
  if (/new\s*wave|synthpop/.test(n)) add('new_wave');
  if (/britpop/.test(n)) add('britpop');
  if (/electro|edm/.test(n)) add('electro_edm');
  if (/french\s*touch/.test(n)) add('french_touch');
  if (/rap\s*fran[çc]ais/.test(n)) add('rap_fr');
  if (/rap\s*us/.test(n)) add('rap_us');
  if (/hip-?hop\s*fr/.test(n)) add('hiphop_fr');
  if (/reggae|bob\s*marley/.test(n)) add('reggae');
  if (/soul|r&b|rnb/.test(n)) add('soul_rnb');
  if (/\bcountry\b/.test(n)) add('country');
  if (/latino/.test(n)) add('latino');
  if (/afrobeat/.test(n)) add('afrobeats');
  if (/rock\s*fran[çc]ais/.test(n)) add('rock');
  // Ambiances / occasions
  if (/ap[ée]ro|afterwork/.test(n)) add('apero');
  // "été" en mot ISOLÉ uniquement (sinon "Vari-été" FR matchait à tort → 397
  // faux positifs summer). Préfixe début/espace/apostrophe, pas une lettre.
  if (/(^|[\s'])[ée]t[ée]([\s'—-]|$)|piscine|summer|tubes\s*de\s*l/.test(n)) add('ete');
  if (/roadtrip|road\s*trip/.test(n)) add('roadtrip');
  if (/anniversaire/.test(n)) add('anniversaire');
  if (/mariage|wedding|first\s*dance/.test(n)) add('mariage');
  if (/amour|saint-valentin|\blove\b/.test(n)) add('amour');
  if (/halloween|frisson/.test(n)) add('halloween');
  if (/no[ëe]l|christmas/.test(n)) add('noel');
  if (/nouvel\s*an|compte\s*à\s*rebours|\bparty\b/.test(n)) add('nouvel_an');
  if (/chants?\s*de\s*stade/.test(n)) add('chants_stade');
  if (/karaok[ée]/.test(n)) add('karaoke');
  if (/boomer/.test(n)) add('boomers');
  if (/enfants?|4\s*à\s*8/.test(n)) add('enfants');
  // Œuvres
  if (/musique\s*de\s*film|cin[ée]ma|bandes?\s*originales?/.test(n)) add('cinema');
  if (/s[ée]ries?\s*tv|g[ée]n[ée]riques?\s*de\s*s[ée]ries/.test(n)) add('series_tv');
  if (/club\s*doroth[ée]e|dessins?\s*anim[ée]s/.test(n)) add('dessins_animes');
  if (/disney/.test(n)) add('disney');
  if (/jeux?\s*vid[ée]o/.test(n)) add('jeux_video');
  if (/james\s*bond/.test(n)) add('james_bond');
  if (/com[ée]dies?\s*musicales?/.test(n)) add('comedies_musicales');
  if (/eurovision/.test(n)) add('eurovision');
  // Formats
  if (/one-?hit\s*wonders?/.test(n)) add('one_hit_wonders');
  if (/\bduos?\b/.test(n)) add('duos');
  if (/reprises?/.test(n)) add('reprises');
  if (/boys?\s*bands?|girls?\s*bands?/.test(n)) add('boys_girls_bands');
  if (/\bpubs?\b/.test(n)) add('pubs');
  if (/chanson\s*fran[çc]aise\s*classique/.test(n)) add('chanson_fr_classique');
  if (/italie\s*classique/.test(n)) add('italie_classique');
  // Fallback slug theme `genre`/`decade` déjà couverts par le nom.
  void th;
  return [...out].filter((t) => SONG_THEME_SLUGS.has(t));
}

function parseLevel(name: string): 1 | 2 | 3 | null {
  const n = name.toLowerCase();
  if (/facile|easy/.test(n)) return 1;
  if (/moyen|medium/.test(n)) return 2;
  if (/difficile|hard|expert/.test(n)) return 3;
  return null; // "Mix" ou pas de signal
}

const FRENCH_STOPWORDS = new Set(
  'le la les un une des du de et ou je tu il elle nous vous on mon ma mes ton ta pour avec sans dans sur qui que quoi est suis es ai as amour coeur cœur vie nuit jour ne pas plus moi toi nos vos ce cette ces aux'.split(
    ' ',
  ),
);
const ENGLISH_STOPWORDS = new Set(
  'the you your my me we are is in of and to a an i it that this on no never love baby girl boy night day feel want need know don t can'.split(
    ' ',
  ),
);
const FRENCH_DIACRITICS = /[àâäéèêëïîôùûüÿçœæ]/i;

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-zàâäéèêëïîôùûüÿçœæ'\s]/g, ' ')
    .split(/[\s']+/)
    .filter(Boolean);
}
function isFrenchTitle(title: string): boolean {
  if (FRENCH_DIACRITICS.test(title)) return true;
  return tokens(title).some((t) => FRENCH_STOPWORDS.has(t));
}
function isEnglishTitle(title: string): boolean {
  if (FRENCH_DIACRITICS.test(title)) return false;
  return tokens(title).some((t) => ENGLISH_STOPWORDS.has(t));
}

function frenchContextName(name: string): boolean {
  return /vari[ée]t[ée]\s*fr|chanson\s*fran|rap\s*fran|rock\s*fran|hip-?hop\s*fr|y[ée]y[ée]|cin[ée]ma\s*fran|com[ée]dies?\s*musicales?\s*fran|disney\s*en\s*fran|club\s*doroth/.test(
    name.toLowerCase(),
  );
}

const WORK_KIND_BY_THEME: Record<string, string> = {
  cinema: 'film',
  series_tv: 'serie',
  dessins_animes: 'dessin_anime',
  disney: 'dessin_anime',
  jeux_video: 'jeu_video',
  comedies_musicales: 'comedie_musicale',
  james_bond: 'film',
};

interface SongRow {
  id: string;
  canonical_title: string;
  artist: { canonical_name: string };
  catalog_tracks: {
    playlist: { name_fr: string; theme: string | null; locale_primary: string };
  }[];
}

async function main(): Promise<void> {
  const songs = (await prisma.song.findMany({
    select: {
      id: true,
      canonical_title: true,
      artist: { select: { canonical_name: true } },
      catalog_tracks: {
        select: {
          playlist: { select: { name_fr: true, theme: true, locale_primary: true } },
        },
      },
    },
  })) as SongRow[];

  // Pass 1 : artistes francophones = artistes avec ≥1 song dans une playlist FR.
  const francoArtists = new Set<string>();
  for (const s of songs) {
    const fr = s.catalog_tracks.some(
      (t) => t.playlist.locale_primary === 'fr' || frenchContextName(t.playlist.name_fr),
    );
    if (fr) francoArtists.add(s.artist.canonical_name);
  }

  interface Proposed {
    id: string;
    title: string;
    artist: string;
    themes: string[];
    is_francophone: boolean;
    is_international: boolean;
    level: number | null;
    work_kind: string | null;
    lowConfidenceLang: boolean;
    reason: string;
    nPlaylists: number;
  }
  const proposed: Proposed[] = [];

  for (const s of songs) {
    const pls = s.catalog_tracks.map((t) => t.playlist);
    const themes = new Set<string>();
    const levels: number[] = [];
    let frContext = false;
    let intlContext = false;
    for (const p of pls) {
      mapPlaylistToThemes(p.name_fr, p.theme).forEach((t) => themes.add(t));
      const lv = parseLevel(p.name_fr);
      if (lv !== null) levels.push(lv);
      if (p.locale_primary === 'fr' || frenchContextName(p.name_fr)) frContext = true;
      if (p.locale_primary === 'international') intlContext = true;
    }
    const themeArr = [...themes];
    const level = levels.length ? Math.min(...levels) : null;

    const frTitle = isFrenchTitle(s.canonical_title);
    const enTitle = isEnglishTitle(s.canonical_title);
    const artistFranco = francoArtists.has(s.artist.canonical_name);

    const is_francophone = frContext || frTitle || artistFranco;
    const is_international = intlContext || (enTitle && !frTitle);

    // Confiance faible : flags posés SANS corroboration titre/artiste, OU
    // titre ambigu (ni FR ni EN détecté), OU les deux flags sans signal fort.
    const titleSignal = frTitle || enTitle;
    const lowConfidenceLang =
      (!titleSignal && !artistFranco) || // seulement la locale playlist
      (is_francophone && is_international && !titleSignal) || // both sans signal
      (!is_francophone && !is_international); // rien résolu
    const reason =
      [
        frContext ? 'plFR' : '',
        intlContext ? 'plINTL' : '',
        frTitle ? 'titreFR' : '',
        enTitle ? 'titreEN' : '',
        artistFranco ? 'artisteFR' : '',
      ]
        .filter(Boolean)
        .join('+') || 'aucun-signal';

    const oeuvre = themeArr.find((t) => WORK_THEME_SLUGS.has(t) && WORK_KIND_BY_THEME[t]);
    const work_kind = oeuvre ? (WORK_KIND_BY_THEME[oeuvre] ?? null) : null;

    proposed.push({
      id: s.id,
      title: s.canonical_title,
      artist: s.artist.canonical_name,
      themes: themeArr,
      is_francophone,
      is_international,
      level,
      work_kind,
      lowConfidenceLang,
      reason,
      nPlaylists: pls.length,
    });
  }

  // ── Stats ────────────────────────────────────────────────────────────────
  const total = proposed.length;
  const withTheme = proposed.filter((p) => p.themes.length > 0).length;
  const orphans = proposed.filter((p) => p.nPlaylists === 0).length;
  const francoOnly = proposed.filter((p) => p.is_francophone && !p.is_international).length;
  const interOnly = proposed.filter((p) => !p.is_francophone && p.is_international).length;
  const both = proposed.filter((p) => p.is_francophone && p.is_international).length;
  const neither = proposed.filter((p) => !p.is_francophone && !p.is_international).length;
  const lvl = { 1: 0, 2: 0, 3: 0, null: 0 } as Record<string, number>;
  for (const p of proposed) lvl[p.level === null ? 'null' : String(p.level)]++;
  const themeFreq = new Map<string, number>();
  for (const p of proposed) for (const t of p.themes) themeFreq.set(t, (themeFreq.get(t) ?? 0) + 1);
  const topThemes = [...themeFreq.entries()].sort((a, b) => b[1] - a[1]);
  const lowConf = proposed.filter((p) => p.lowConfidenceLang);
  const workKindCount = proposed.filter((p) => p.work_kind !== null).length;

  // Échantillon 30 lignes douteuses (réparties, déterministe).
  const sample: Proposed[] = [];
  const step = Math.max(1, Math.floor(lowConf.length / 30));
  for (let i = 0; i < lowConf.length && sample.length < 30; i += step) sample.push(lowConf[i]!);

  // ── Rapport markdown ──────────────────────────────────────────────────────
  const md: string[] = [];
  md.push(`# ÉTAPE 3 — Rapport de tagging auto (DRY-RUN, ${STAMP})`);
  md.push('');
  md.push(`> Aucune écriture DB. Généré par \`scripts/autoTagSongs.ts\` (sans --apply).`);
  md.push('');
  md.push('## Totaux');
  md.push(`- Songs : **${total}**`);
  md.push(`- Avec ≥1 thème : **${withTheme}** (${((withTheme / total) * 100).toFixed(1)}%)`);
  md.push(
    `- Sans thème (dont orphelines hors playlist) : **${total - withTheme}** (orphelines : ${orphans})`,
  );
  md.push('');
  md.push('## Langue');
  md.push('| catégorie | nb | % |');
  md.push('|---|---|---|');
  md.push(`| francophone seul | ${francoOnly} | ${((francoOnly / total) * 100).toFixed(1)}% |`);
  md.push(`| international seul | ${interOnly} | ${((interOnly / total) * 100).toFixed(1)}% |`);
  md.push(`| les deux | ${both} | ${((both / total) * 100).toFixed(1)}% |`);
  md.push(`| ni l'un ni l'autre | ${neither} | ${((neither / total) * 100).toFixed(1)}% |`);
  md.push('');
  md.push('## Niveau');
  md.push('| niveau | nb |');
  md.push('|---|---|');
  md.push(`| 1 | ${lvl['1']} |`);
  md.push(`| 2 | ${lvl['2']} |`);
  md.push(`| 3 | ${lvl['3']} |`);
  md.push(`| null (pas de signal) | ${lvl['null']} |`);
  md.push('');
  md.push('## Thèmes par fréquence');
  md.push('| thème | nb songs |');
  md.push('|---|---|');
  for (const [t, c] of topThemes) md.push(`| ${t} | ${c} |`);
  md.push('');
  md.push('## Œuvres');
  md.push(`- work_kind renseigné : **${workKindCount}**`);
  md.push(
    `- work_title rempli : **0** (non dérivable automatiquement → saisie humaine en ÉTAPE 4)`,
  );
  md.push('');
  md.push('## Fiabilité langue');
  md.push(
    `- Langue à **faible confiance** (devinée sur locale seule / titre ambigu / non résolue) : **${lowConf.length}** (${((lowConf.length / total) * 100).toFixed(1)}%)`,
  );
  md.push('');
  md.push('### Échantillon de 30 lignes douteuses (à juger)');
  md.push('| titre | artiste | playlists | franco | inter | signal |');
  md.push('|---|---|---|---|---|---|');
  for (const p of sample) {
    md.push(
      `| ${p.title.replace(/\|/g, '/')} | ${p.artist.replace(/\|/g, '/')} | ${p.nPlaylists} | ${p.is_francophone ? '✓' : ''} | ${p.is_international ? '✓' : ''} | ${p.reason} |`,
    );
  }
  md.push('');

  mkdirSync(OUT_DIR, { recursive: true });
  const mdPath = `${OUT_DIR}etape3-tagging-report-${STAMP}.md`;
  writeFileSync(mdPath, md.join('\n'), 'utf8');

  // CSV par-song (review complet + base d'apply).
  const csv: string[] = [
    'song_id,title,artist,themes,is_francophone,is_international,level,work_kind,lang_confidence',
  ];
  const esc = (s: string): string => `"${s.replace(/"/g, '""')}"`;
  for (const p of proposed) {
    csv.push(
      [
        p.id,
        esc(p.title),
        esc(p.artist),
        esc(p.themes.join('|')),
        p.is_francophone,
        p.is_international,
        p.level ?? '',
        p.work_kind ?? '',
        p.lowConfidenceLang ? 'low' : 'ok',
      ].join(','),
    );
  }
  const csvPath = `${OUT_DIR}etape3-proposed-tags-${STAMP}.csv`;
  writeFileSync(csvPath, csv.join('\n'), 'utf8');

  // Résumé stdout
  console.log('=== RÉSUMÉ ===');
  console.log(`total=${total} withTheme=${withTheme} orphans=${orphans}`);
  console.log(
    `lang: francoSeul=${francoOnly} interSeul=${interOnly} both=${both} neither=${neither}`,
  );
  console.log(`level: 1=${lvl['1']} 2=${lvl['2']} 3=${lvl['3']} null=${lvl['null']}`);
  console.log(
    `lowConfidenceLang=${lowConf.length} (${((lowConf.length / total) * 100).toFixed(1)}%)`,
  );
  console.log(`work_kind=${workKindCount} work_title=0`);
  console.log(
    'topThemes:',
    topThemes
      .slice(0, 12)
      .map(([t, c]) => `${t}:${c}`)
      .join(' '),
  );
  console.log(`rapport: ${mdPath}`);
  console.log(`csv: ${csvPath}`);

  if (!APPLY) {
    console.log('DRY-RUN — aucune écriture DB.');
    return;
  }

  // ── ÉCRITURE (--apply) ─────────────────────────────────────────────────────
  // Écrit EXACTEMENT `proposed[]` (la même structure qui a produit le CSV) →
  // "ce que montre le CSV = ce qui s'écrit". SET (remplace) sur themes →
  // idempotent (re-run = même état). tags_reviewed/work_title NON touchés.
  console.log(
    `--apply : écriture de ${proposed.length} songs (themes en SET/remplace, idempotent)...`,
  );
  const CONC = 20;
  let written = 0;
  for (let i = 0; i < proposed.length; i += CONC) {
    const chunk = proposed.slice(i, i + CONC);
    await Promise.all(
      chunk.map((p) =>
        prisma.song.update({
          where: { id: p.id },
          data: {
            themes: { set: p.themes }, // SET = remplace tout le tableau (pas append)
            is_francophone: p.is_francophone,
            is_international: p.is_international,
            level: p.level, // null si aucun signal de niveau
            work_kind: p.work_kind, // null si pas une œuvre
            tags_reviewed: false, // reste false — ÉTAPE 4 le passera à true
            // work_title : volontairement NON touché (reste null → saisie ÉTAPE 4)
          },
        }),
      ),
    );
    written += chunk.length;
    if (written % 400 === 0 || written === proposed.length) {
      console.log(`  ${written}/${proposed.length}`);
    }
  }
  console.log('écriture terminée. Vérification DB (garde-fou 3)...');

  // ── VÉRIFICATION : la distribution DB doit égaler le rapport ────────────────
  const [
    dbFrancoOnly,
    dbInterOnly,
    dbBoth,
    dbNeither,
    dbL1,
    dbL2,
    dbL3,
    dbLnull,
    dbReviewedTrue,
    dbWorkKind,
    dbAnnees90,
    dbAnnees2000,
    dbEte,
  ] = await Promise.all([
    prisma.song.count({ where: { is_francophone: true, is_international: false } }),
    prisma.song.count({ where: { is_francophone: false, is_international: true } }),
    prisma.song.count({ where: { is_francophone: true, is_international: true } }),
    prisma.song.count({ where: { is_francophone: false, is_international: false } }),
    prisma.song.count({ where: { level: 1 } }),
    prisma.song.count({ where: { level: 2 } }),
    prisma.song.count({ where: { level: 3 } }),
    prisma.song.count({ where: { level: null } }),
    prisma.song.count({ where: { tags_reviewed: true } }),
    prisma.song.count({ where: { work_kind: { not: null } } }),
    prisma.song.count({ where: { themes: { has: 'annees_90' } } }),
    prisma.song.count({ where: { themes: { has: 'annees_2000' } } }),
    prisma.song.count({ where: { themes: { has: 'ete' } } }),
  ]);

  const checks: [string, number, number][] = [
    ['franco seul', dbFrancoOnly, francoOnly],
    ['inter seul', dbInterOnly, interOnly],
    ['les deux', dbBoth, both],
    ['ni-ni', dbNeither, neither],
    ['level 1', dbL1, lvl['1']!],
    ['level 2', dbL2, lvl['2']!],
    ['level 3', dbL3, lvl['3']!],
    ['level null', dbLnull, lvl['null']!],
    ['work_kind', dbWorkKind, workKindCount],
    ['theme annees_90', dbAnnees90, themeFreq.get('annees_90') ?? -1],
    ['theme annees_2000', dbAnnees2000, themeFreq.get('annees_2000') ?? -1],
    ['theme ete', dbEte, themeFreq.get('ete') ?? -1],
  ];
  let allOk = true;
  for (const [label, got, exp] of checks) {
    const ok = got === exp;
    if (!ok) allOk = false;
    console.log(`  ${ok ? 'OK   ' : 'ÉCART'} ${label}: DB=${got} attendu=${exp}`);
  }
  const reviewedOk = dbReviewedTrue === 0;
  if (!reviewedOk) allOk = false;
  console.log(
    `  ${reviewedOk ? 'OK   ' : 'ÉCART'} tags_reviewed=true (doit être 0): ${dbReviewedTrue}`,
  );

  if (!allOk) {
    console.error('!!! ÉCART détecté entre DB et rapport — STOP. Vérifier avant tout autre run.');
    process.exit(1);
  }
  console.log('✅ Distribution DB == rapport. Écriture conforme.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
