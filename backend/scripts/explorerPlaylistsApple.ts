/**
 * scripts/explorerPlaylistsApple.ts — QUE PROPOSE APPLE MUSIC EN « FILMS ET SÉRIES » ?
 *
 * Thomas : « tu as une base déjà sur Apple Music que l'on peut utiliser » —
 * capture de la rubrique Films et séries (Musique de film : les indispensables,
 * James Bond : les indispensables, B.O. des années 90, Cinéma des années 30…).
 *
 * Ce script NE MODIFIE RIEN. Il interroge le catalogue Apple (storefront FR)
 * avec le jeton développeur et affiche, pour chaque recherche, les playlists
 * éditoriales trouvées : identifiant, nom, curateur, nombre de titres. Sert à
 * décider ce qui vaut la peine d'être importé avant d'écrire quoi que ce soit.
 *
 *   npx tsx scripts/explorerPlaylistsApple.ts "musique de film" "james bond"
 *   npx tsx scripts/explorerPlaylistsApple.ts --pistes=pl.xxxxx   (liste les titres)
 */
import { config } from 'dotenv';
import { getAppleDeveloperToken, isAppleMusicConfigured } from '../src/lib/appleDeveloperToken.js';

config();
const STOREFRONT = 'fr';

async function appel(chemin: string, jeton: string): Promise<any> {
  const r = await fetch(`https://api.music.apple.com${chemin}`, {
    headers: { Authorization: `Bearer ${jeton}` },
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${chemin}`);
  return r.json();
}

async function main(): Promise<void> {
  if (!isAppleMusicConfigured()) {
    console.error('Identifiants Apple absents (APPLE_TEAM_ID / KEY_ID / PRIVATE_KEY).');
    process.exit(1);
  }
  const { token: jeton } = getAppleDeveloperToken();
  const args = process.argv.slice(2);
  const pistes = args.find((a) => a.startsWith('--pistes='))?.slice('--pistes='.length);

  if (pistes) {
    const d = await appel(`/v1/catalog/${STOREFRONT}/playlists/${pistes}`, jeton);
    const pl = d.data?.[0];
    console.log(`${pl?.attributes?.name} — ${pl?.attributes?.curatorName ?? '?'}`);
    const titres = pl?.relationships?.tracks?.data ?? [];
    console.log(`${titres.length} titres :`);
    titres.forEach((t: any, i: number) =>
      console.log(
        `  ${String(i + 1).padStart(3)}. ${t.attributes?.name} — ${t.attributes?.artistName}` +
          `  [${t.id}] ${t.attributes?.albumName ?? ''}`,
      ),
    );
    return;
  }

  const termes = args.length ? args : ['musique de film', 'bande originale', 'série tv'];
  for (const terme of termes) {
    const d = await appel(
      `/v1/catalog/${STOREFRONT}/search?term=${encodeURIComponent(terme)}&types=playlists&limit=25`,
      jeton,
    );
    const pls = d.results?.playlists?.data ?? [];
    console.log(`\n=== « ${terme} » — ${pls.length} playlists ===`);
    for (const pl of pls) {
      const a = pl.attributes ?? {};
      console.log(
        `  ${pl.id.padEnd(24)} ${String(a.name).slice(0, 46).padEnd(48)} ${a.curatorName ?? ''}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
