/**
 * Probe multi-app : au moins UNE app dry-run est-elle drainée (cap levé) ?
 * exit 0 = au moins une DRAINED, exit 7 = toutes CAPPED, exit 1 = pas de creds.
 * Pool = SPOTIFY_DRYRUN*, SPOTIFY_DRYRUN2*, SPOTIFY_DRYRUN3*. JAMAIS l'app prod.
 * Jetable (campagne enrichissement). Utilisé par la boucle auto-grappille.
 */
import 'dotenv/config';

const APPS: Array<[string, string, string]> = [
  ['DRYRUN', 'SPOTIFY_DRYRUN_CLIENT_ID', 'SPOTIFY_DRYRUN_CLIENT_SECRET'],
  ['DRYRUN2', 'SPOTIFY_DRYRUN2_CLIENT_ID', 'SPOTIFY_DRYRUN2_CLIENT_SECRET'],
  ['DRYRUN3', 'SPOTIFY_DRYRUN3_CLIENT_ID', 'SPOTIFY_DRYRUN3_CLIENT_SECRET'],
];

async function probeOne(id?: string, secret?: string): Promise<'DRAINED' | 'CAPPED' | 'ERR'> {
  if (!id || !secret) return 'ERR';
  const auth = Buffer.from(id + ':' + secret).toString('base64');
  const tk = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + auth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!tk.ok) return 'ERR';
  const j = (await tk.json()) as { access_token: string };
  const r = await fetch('https://api.spotify.com/v1/search?q=test&type=track&limit=1', {
    headers: { Authorization: 'Bearer ' + j.access_token },
  });
  if (r.status === 200) return 'DRAINED';
  if (r.status === 429) return 'CAPPED';
  return 'ERR';
}

async function main(): Promise<void> {
  const present = APPS.filter(([, idk, sk]) => process.env[idk] && process.env[sk]);
  if (present.length === 0) {
    console.log('NO_CREDS');
    process.exit(1);
  }
  let anyDrained = false;
  let anyCapped = false;
  for (const [name, idk, sk] of present) {
    const r = await probeOne(process.env[idk], process.env[sk]);
    console.log(`${name}: ${r}`);
    if (r === 'DRAINED') anyDrained = true;
    if (r === 'CAPPED') anyCapped = true;
  }
  if (anyDrained) {
    console.log('POOL_DRAINED');
    process.exit(0);
  }
  if (anyCapped) {
    console.log('POOL_CAPPED');
    process.exit(7);
  }
  process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
