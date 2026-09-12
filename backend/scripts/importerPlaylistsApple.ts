/**
 * scripts/importerPlaylistsApple.ts — IMPORTER LES PLAYLISTS ÉDITORIALES
 * « Films et séries » D'APPLE MUSIC DANS LA BIBLIOTHÈQUE OFFICIELLE.
 *
 * Demande de Thomas : « maintenant des playlists sur séries et films — tu as
 * une base déjà sur Apple Music que l'on peut utiliser » (capture de la
 * rubrique Apple Music : Films et séries).
 *
 * POURQUOI PASSER PAR APPLE PLUTÔT QUE PAR NOTRE CATALOGUE
 * Les playlists films/séries existantes ont été montées à la main puis
 * rattachées à Apple après coup, et le rattachement n'a jamais abouti :
 * « Génériques de Séries TV » compte 85 titres dont 15 seulement jouables sur
 * Apple, « Génériques dessins animés » 15 sur 78. Une manche s'y arrête au
 * bout de quelques titres. En partant des playlists Apple, chaque piste a son
 * identifiant Apple par construction : rien à rattacher, rien à perdre.
 *
 * LE TITRE DU FILM VIENT DU NOM DE L'ALBUM
 * Apple nomme les albums de bande originale « <Film> (Original Motion Picture
 * Soundtrack) », « <Film> (Musique originale du film) »… On retire le suffixe
 * pour obtenir l'œuvre à deviner (work_title), qui est la réponse attendue en
 * mode `guess_mode = 'work'`.
 *
 * ON N'IMPORTE PAS CE DONT ON N'EST PAS SÛR
 * Un album sans marqueur de bande originale (« The Blue Notebooks (15 Years) »
 * de Max Richter, présent dans la playlist Apple) ne donne PAS le nom d'un
 * film : la piste est écartée et listée, jamais devinée.
 *
 * Usage :
 *   npx tsx scripts/importerPlaylistsApple.ts --liste
 *   npx tsx scripts/importerPlaylistsApple.ts --slug=films-bo-apple --dry-run
 *   npx tsx scripts/importerPlaylistsApple.ts --slug=films-bo-apple
 *   npx tsx scripts/importerPlaylistsApple.ts --tout --dry-run
 *
 * Idempotent : rejoue sans doublon (upsert sur le slug, pistes remplacées).
 */
import { PrismaClient, type Level, type OfficialVisibility } from '@prisma/client';
import { config } from 'dotenv';
import { getAppleDeveloperToken, isAppleMusicConfigured } from '../src/lib/appleDeveloperToken.js';

config();
const prisma = new PrismaClient();
const STOREFRONT = 'fr';

interface Source {
  /** Slug Tutti (préfixé official-pl- automatiquement). */
  slug: string;
  nameFr: string;
  nameEn: string;
  sousTitreFr: string;
  sousTitreEn: string;
  /** Identifiants des playlists Apple à fusionner dans celle-ci. */
  apple: string[];
  difficulte: Level;
  categorie: string;
}

/**
 * Les playlists retenues. Les compilations « les indispensables » d'un
 * COMPOSITEUR (Hans Zimmer, Morricone…) ne sont pas reprises telles quelles :
 * elles sont excellentes mais un joueur de bar ne reconnaît pas une cue de
 * score au hasard. On garde les sélections transversales, où chaque titre est
 * le thème principal d'un film que tout le monde a vu.
 */
const SOURCES: Source[] = [
  {
    slug: 'films-bo-apple',
    nameFr: 'Musiques de film — Les incontournables',
    nameEn: 'Movie Scores — The Essentials',
    sousTitreFr: 'Le thème, le film à trouver',
    sousTitreEn: 'Name the movie from its theme',
    apple: ['pl.3b89144df9054dc3a8502c8a74cc1686', 'pl.244c649d1443463c96da02b6726b04ae', 'pl.c6450d9d225b419e8b712d0c32307af9'],
    difficulte: 'MEDIUM',
    categorie: 'special',
  },
  {
    slug: 'films-bo-80s-apple',
    nameFr: 'Bandes originales — Années 80',
    nameEn: 'Movie Soundtracks — The 80s',
    sousTitreFr: 'Le cinéma des années 80',
    sousTitreEn: '80s cinema',
    apple: ['pl.5cd406a04902496aaa8cfbbaa4cb0375'],
    difficulte: 'MEDIUM',
    categorie: 'special',
  },
  {
    slug: 'films-bo-2000s-apple',
    nameFr: 'Bandes originales — Années 2000',
    nameEn: 'Movie Soundtracks — The 2000s',
    sousTitreFr: 'Le cinéma des années 2000',
    sousTitreEn: '2000s cinema',
    apple: ['pl.59bf7e6dbc034c92b8094f3350f98f17'],
    difficulte: 'MEDIUM',
    categorie: 'special',
  },
  {
    slug: 'films-bo-2010s-apple',
    nameFr: 'Bandes originales — Années 2010',
    nameEn: 'Movie Soundtracks — The 2010s',
    sousTitreFr: 'Le cinéma des années 2010',
    sousTitreEn: '2010s cinema',
    apple: ['pl.da39bf02adc7475b90fbd6a78acfe231'],
    difficulte: 'MEDIUM',
    categorie: 'special',
  },
  {
    slug: 'films-frissons-apple',
    nameFr: 'Bandes originales — Frissons',
    nameEn: 'Movie Soundtracks — Thrills & Chills',
    sousTitreFr: 'Thrillers et films d’horreur',
    sousTitreEn: 'Thrillers and horror',
    apple: ['pl.9abc6de89da84f61b440f5d0cb7144f0', 'pl.1379d8bdc0c84a999548926728d5af8d'],
    difficulte: 'EXPERT',
    categorie: 'special',
  },
  {
    slug: 'james-bond-apple',
    nameFr: 'James Bond — Génériques',
    nameEn: 'James Bond — Themes',
    sousTitreFr: 'De Dr No à Mourir peut attendre',
    sousTitreEn: 'From Dr No to No Time to Die',
    apple: ['pl.035c92175bcd4696a9f3f8c7589b51ed'],
    difficulte: 'MEDIUM',
    categorie: 'special',
  },
  {
    slug: 'comedies-musicales-apple',
    nameFr: 'Comédies musicales — Au cinéma',
    nameEn: 'Musicals — On Screen',
    sousTitreFr: 'La magie des comédies musicales',
    sousTitreEn: 'Movie musicals',
    apple: ['pl.94b3430e6f394a3581355a14570eaafa', 'pl.10d8d8b4d51349df9f3ae7961f7baa14'],
    difficulte: 'MEDIUM',
    categorie: 'special',
  },
];

// ───── Le nom du film, extrait du nom de l'album ─────────────────────────────

/**
 * Marqueurs qui disent « cet album est une bande originale ». Sans l'un d'eux,
 * on ne sait pas de quel film il s'agit — et on préfère écarter la piste
 * plutôt que faire deviner un nom d'album.
 */
const MARQUEURS_BO = [
  'motion picture',
  'soundtrack',
  'original score',
  'music from the',
  'musique originale',
  'musique du film',
  'bande originale',
  'limited series',
  'television series',
  'hbo series',
  'netflix series',
  'from the film',
  'b.o.f',
];

/** Suffixes d'édition sans intérêt pour le nom de l'œuvre. */
const SUFFIXES_EDITION =
  /\s*[-–—]\s*(ep|single|deluxe\b.*|expanded\b.*|remaster\w*\b.*|.*anniversary.*|collector.*)$/i;

/** Retire tous les groupes entre parenthèses ou crochets en fin de chaîne. */
function sansGroupesFinaux(s: string): string {
  let out = s.trim();
  let avant: string;
  do {
    avant = out;
    out = out.replace(/\s*[([][^()[\]]*[)\]]\s*$/, '').trim();
  } while (out !== avant && out.length > 0);
  return out;
}

/**
 * Deuxième source, aussi sûre que la première : le titre du morceau nomme
 * lui-même l'œuvre — « Gonna Fly Now (Theme From "Rocky") », « Theme from
 * Jurassic Park », « The Godfather Waltz ». On ne lit QUE la forme explicite
 * « theme from X » ; on ne devine jamais à partir d'un titre quelconque.
 */
export function oeuvreDepuisTitre(titre: string | null | undefined): string | null {
  if (!titre) return null;
  const m =
    /(?:th[eè]me|theme)\s+(?:from|de|du|d')\s*[«"“']?\s*([^"”»()\[\]]+?)\s*[»"”']?\s*[)\]]?\s*$/i.exec(
      titre.trim(),
    );
  const nom = m?.[1]?.trim();
  if (!nom || nom.length < 2) return null;
  // « Theme from the Motion Picture » ne nomme aucun film.
  if (MARQUEURS_BO.some((x) => nom.toLowerCase().includes(x))) return null;
  return nom;
}

export function oeuvreDepuisAlbum(album: string | null | undefined): string | null {
  if (!album) return null;
  const brut = album.trim();
  if (!MARQUEURS_BO.some((m) => brut.toLowerCase().includes(m))) return null;

  let nom = sansGroupesFinaux(brut);
  // Forme « Rocky - Original Motion Picture Score », sans parenthèses.
  const tiret = nom.split(/\s+[-–—]\s+/);
  if (tiret.length > 1 && MARQUEURS_BO.some((m) => tiret.slice(1).join(' ').toLowerCase().includes(m))) {
    nom = tiret[0];
  }
  nom = nom.replace(SUFFIXES_EDITION, '').replace(/\s*[,:;]\s*$/, '').trim();
  // La saison ne fait pas partie du nom de la série : on devine « Game of
  // Thrones », pas « Game of Thrones: Season 8 ».
  nom = nom
    .replace(/\s*[,:;]?\s*(season|saison|series|série|vol\.?|volume)\s*\d+\s*$/i, '')
    .replace(/\s*[,:;]\s*$/, '')
    .trim();
  // S'il ne reste que le marqueur (« Original Soundtrack »), on n'a pas de film.
  if (MARQUEURS_BO.some((m) => nom.toLowerCase() === m || nom.toLowerCase().includes(m))) return null;
  return nom.length >= 2 ? nom : null;
}

// ───── Apple ────────────────────────────────────────────────────────────────

interface PisteApple {
  appleId: string;
  titre: string;
  artiste: string;
  album: string | null;
  annee: number | null;
  cover: string | null;
}

async function appel(chemin: string, jeton: string): Promise<any> {
  for (let essai = 0; essai < 3; essai++) {
    const r = await fetch(`https://api.music.apple.com${chemin}`, {
      headers: { Authorization: `Bearer ${jeton}` },
    });
    if (r.status === 429) {
      await new Promise((res) => setTimeout(res, 2000 * (essai + 1)));
      continue;
    }
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${chemin}`);
    return r.json();
  }
  throw new Error(`Apple sature (429) — ${chemin}`);
}

function cover(artwork: { url?: string } | undefined): string | null {
  return artwork?.url ? artwork.url.replace('{w}', '600').replace('{h}', '600') : null;
}

async function pistesDeLaPlaylist(appleId: string, jeton: string): Promise<PisteApple[]> {
  const out: PisteApple[] = [];
  let chemin: string | null = `/v1/catalog/${STOREFRONT}/playlists/${appleId}/tracks?limit=100`;
  while (chemin) {
    const d: any = await appel(chemin, jeton);
    for (const t of d.data ?? []) {
      const a = t.attributes ?? {};
      out.push({
        appleId: t.id,
        titre: a.name ?? '',
        artiste: a.artistName ?? '',
        album: a.albumName ?? null,
        annee: a.releaseDate ? Number.parseInt(String(a.releaseDate).slice(0, 4), 10) : null,
        cover: cover(a.artwork),
      });
    }
    chemin = d.next ? `${d.next}${d.next.includes('?') ? '&' : '?'}limit=100` : null;
  }
  return out;
}

// ───── Import ───────────────────────────────────────────────────────────────

interface Retenue extends PisteApple {
  oeuvre: string;
}

async function traiter(src: Source, jeton: string, dryRun: boolean): Promise<void> {
  const vues = new Set<string>();
  const retenues: Retenue[] = [];
  const ecartees: { titre: string; artiste: string; album: string | null }[] = [];

  for (const appleId of src.apple) {
    for (const p of await pistesDeLaPlaylist(appleId, jeton)) {
      if (vues.has(p.appleId)) continue;
      vues.add(p.appleId);
      const oeuvre = oeuvreDepuisAlbum(p.album) ?? oeuvreDepuisTitre(p.titre);
      if (!oeuvre) {
        ecartees.push({ titre: p.titre, artiste: p.artiste, album: p.album });
        continue;
      }
      // Un même film ne doit pas revenir trois fois dans la manche.
      if (retenues.some((r) => r.oeuvre.toLowerCase() === oeuvre.toLowerCase())) continue;
      retenues.push({ ...p, oeuvre });
    }
  }

  const slug = `official-pl-${src.slug}`;
  console.log(`\n=== ${src.nameFr} (${slug}) ===`);
  console.log(`  ${vues.size} pistes Apple → ${retenues.length} retenues, ${ecartees.length} écartées`);
  if (dryRun) {
    retenues.slice(0, 40).forEach((r, i) =>
      console.log(`   ${String(i + 1).padStart(3)}. ${r.oeuvre}  ←  « ${r.titre} » / ${r.artiste}`),
    );
    if (ecartees.length) {
      console.log('  — écartées (album sans marqueur de bande originale) :');
      ecartees.slice(0, 15).forEach((e) => console.log(`      « ${e.titre} » / ${e.artiste} — ${e.album}`));
    }
    return;
  }

  const pl = await prisma.officialPlaylist.upsert({
    where: { slug },
    create: {
      slug,
      name_fr: src.nameFr,
      name_en: src.nameEn,
      subtitle_fr: src.sousTitreFr,
      subtitle_en: src.sousTitreEn,
      locale_primary: 'fr-FR',
      theme: src.slug,
      difficulty: src.difficulte,
      // Privée au départ : Thomas relit la liste des films avant de l'ouvrir.
      visibility: 'private' as OfficialVisibility,
      category: src.categorie,
      guess_mode: 'work',
      // Ces playlists n'existent QUE par Apple : rien à jouer ailleurs.
      forced_source: 'apple_music',
      track_count: retenues.length,
      cover_url: retenues[0]?.cover ?? null,
    },
    update: {
      name_fr: src.nameFr,
      name_en: src.nameEn,
      subtitle_fr: src.sousTitreFr,
      subtitle_en: src.sousTitreEn,
      difficulty: src.difficulte,
      category: src.categorie,
      guess_mode: 'work',
      forced_source: 'apple_music',
      track_count: retenues.length,
      cover_url: retenues[0]?.cover ?? null,
    },
  });

  await prisma.officialPlaylistTrack.deleteMany({ where: { playlist_id: pl.id } });
  await prisma.officialPlaylistTrack.createMany({
    data: retenues.map((r, i) => ({
      playlist_id: pl.id,
      position: i + 1,
      // La réponse à deviner est l'ŒUVRE ; le titre reste affiché à la
      // révélation (« Time », de Hans Zimmer, pour Inception).
      title: r.titre,
      artist: r.artiste,
      work_title: r.oeuvre,
      year: r.annee,
      difficulty: src.difficulte,
      apple_music_id: r.appleId,
      cover_url: r.cover,
      is_playable: true,
      aliases_source: 'heuristic',
    })),
  });
  console.log(`  ✓ ${retenues.length} pistes écrites (privée, source verrouillée sur Apple)`);
}

async function main(): Promise<void> {
  if (!isAppleMusicConfigured()) {
    console.error('Identifiants Apple absents.');
    process.exit(1);
  }
  const args = process.argv.slice(2);
  if (args.includes('--liste')) {
    SOURCES.forEach((s) => console.log(`${s.slug.padEnd(28)} ${s.nameFr}  (${s.apple.length} playlist(s) Apple)`));
    return;
  }
  const dryRun = args.includes('--dry-run');
  const seul = args.find((a) => a.startsWith('--slug='))?.slice('--slug='.length);
  const choisies = seul ? SOURCES.filter((s) => s.slug === seul) : SOURCES;
  if (choisies.length === 0) {
    console.error(`Aucune source nommée « ${seul} ». --liste pour les voir.`);
    process.exit(1);
  }
  const { token } = getAppleDeveloperToken();
  for (const s of choisies) await traiter(s, token, dryRun);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
