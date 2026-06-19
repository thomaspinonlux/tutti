/**
 * audioSink.ts — feat/tv-audio-output
 *
 * Résolution SHARED host ⇄ TV du sink audio (= quel appareil sort le son).
 *
 * Règles (calculées identiquement des deux côtés, source de vérité = polling
 * screen-state) :
 *
 *   1. audio_target !== 'tv'    → host (toggle host pas activé)
 *   2. !tv_audio_armed           → host (la TV n'a pas cliqué "Activer le son"
 *                                  → autoplay bloqué côté TV = zéro silence
 *                                  garanti)
 *   3. provider === 'youtube'    → tv
 *   4. provider === 'spotify'    → tv si tv_spotify_ready, sinon host
 *   5. provider === null/inconnu → host (defensive)
 *
 * Chaque appareil sait, pour le track en cours, s'il doit jouer ou se taire :
 *   - host  : audioSink === 'host' → useXAudioSync enabled, lit la track.
 *             audioSink !== 'host' → useXAudioSync désactivé + player muté.
 *   - TV    : audioSink === 'tv'   → useXAudioSync enabled, lit la track.
 *             audioSink !== 'tv'   → useXAudioSync désactivé.
 *
 * Bascule sans toucher started_at ni l'horloge serveur : seul le routing audio
 * change, le buzz + scoring restent identiques.
 */

export type AudioTarget = 'host' | 'tv';
export type AudioSink = 'host' | 'tv';
/** Provider du track — accepte l'union MusicProviderId du shared (incl. 'demo',
 *  'deezer', 'apple_music'). Seuls 'youtube'/'spotify' déclenchent la lecture
 *  côté TV ; les autres restent forcément sur host (defensive). */
export type AudioProvider = string;

export interface AudioSinkInputs {
  audio_target: AudioTarget | null | undefined;
  tv_audio_armed: boolean | null | undefined;
  tv_spotify_ready: boolean | null | undefined;
  provider: AudioProvider | null | undefined;
}

export function resolveAudioSink({
  audio_target,
  tv_audio_armed,
  tv_spotify_ready,
  provider,
}: AudioSinkInputs): AudioSink {
  if (audio_target !== 'tv') return 'host';
  if (!tv_audio_armed) return 'host';
  if (provider === 'youtube') return 'tv';
  if (provider === 'spotify') return tv_spotify_ready ? 'tv' : 'host';
  return 'host';
}
