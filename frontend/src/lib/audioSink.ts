/**
 * audioSink.ts — feat/audio-auto-routing
 *
 * Résolution SHARED host ⇄ TV du sink audio (= quel appareil sort le son).
 *
 * ROUTING AUTOMATIQUE (plus de toggle manuel `audio_target`) : la règle est
 * "si un écran TV EXTERNE prêt existe → le son sort UNIQUEMENT sur la TV, la
 * console se mute ; sinon → console". JAMAIS les deux à la fois.
 *
 * La présence d'un écran TV externe prêt est portée par `tv_audio_armed` :
 * un appareil /screen (autre que la console) qui a débloqué l'autoplay POST
 * `tv-audio-armed=true` (heartbeat 30s, TTL backend 60s). La garde same-device
 * (2e fenêtre sur la même console) est faite côté TvAudioOutput qui n'arme
 * jamais dans ce cas → tv_audio_armed reste false → sink reste 'host'.
 *
 * Règles (calculées identiquement des deux côtés, source de vérité = polling
 * screen-state) :
 *
 *   1. !tv_audio_armed           → host (aucun écran TV externe prêt → console)
 *   2. provider === 'youtube'    → tv
 *   3. provider === 'spotify'    → tv si tv_spotify_ready, sinon host
 *   4. provider === null/inconnu → host (defensive)
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
  tv_audio_armed: boolean | null | undefined;
  tv_spotify_ready: boolean | null | undefined;
  provider: AudioProvider | null | undefined;
}

export function resolveAudioSink({
  tv_audio_armed,
  tv_spotify_ready,
  provider,
}: AudioSinkInputs): AudioSink {
  if (!tv_audio_armed) return 'host'; // pas d'écran TV externe prêt → console
  if (provider === 'youtube') return 'tv';
  if (provider === 'spotify') return tv_spotify_ready ? 'tv' : 'host';
  return 'host';
}
