/**
 * audioUnlock.ts — fix/pwa-safari-audio-unlock
 *
 * Helpers PURE SYNC pour débloquer l'audio depuis un user gesture.
 *
 * Contexte Safari PWA standalone (macOS Sequoia / iOS 17+) :
 *   - Le user gesture est consommé IMMÉDIATEMENT, dès que le handler retourne
 *     ou await/then.
 *   - playVideo() / play() / activate() font partie des "media-engaging APIs"
 *     qui DOIVENT être appelées sync dans le tick du click (sinon `aborted by
 *     user agent`).
 *
 * Stratégie standard cross-browser :
 *   1. window.AudioContext().resume() — sync, juste lance l'unlock
 *   2. createBufferSource → connect → start(0) avec buffer silencieux 1 sample
 *      — c'est ce silent buffer joué dans le gesture qui marque la page comme
 *      "audio-enabled" pour Safari. À partir de là, les sources audio peuvent
 *      être créées async sans nouvelle interaction user.
 *
 * Idempotent : appeler 10× ne casse rien (les contextes sont réutilisés).
 *
 * IMPORTANT — Règle d'usage :
 *   ```ts
 *   const handleClick = (): void => {
 *     unlockAudioSync('start-button');   // ← SYNC, premier appel
 *     // ... puis async stuff:
 *     void doAsyncThing();
 *   };
 *   ```
 *   PAS d'await/then/setTimeout AVANT unlockAudioSync(). Le gesture serait
 *   déjà consommé et l'unlock échouerait silencieusement.
 */

// AudioContext singleton — on en crée UN seul par session, sinon Safari
// suspend l'ancien et créé du jitter.
let ctxRef: AudioContext | null = null;
let unlockedFlag = false;

/** True si l'app tourne en PWA standalone (Dock macOS / Home Screen iOS). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  } catch {
    /* ignore */
  }
  // iOS Safari legacy (< 16)
  const iosLegacy = (window.navigator as unknown as { standalone?: boolean }).standalone;
  return iosLegacy === true;
}

/**
 * Récupère (ou crée) l'AudioContext singleton. Préfixe webkit pour Safari < 14.
 * Renvoie null si l'API n'est pas dispo (très vieux navigateurs / tests Jest).
 */
function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctxRef) return ctxRef;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctxRef = new Ctor();
    return ctxRef;
  } catch (err) {
    console.warn('[Audio] AudioContext instantiation failed:', err);
    return null;
  }
}

/**
 * Débloque l'audio de la page de façon synchrone. À appeler EN PREMIER dans
 * un click/touch handler (avant tout await/then/setTimeout).
 *
 * @param source identifiant logique du gesture (pour les logs) :
 *               'start-game', 'force-audio-button', 'tap-to-start'…
 * @returns true si l'unlock a effectivement tenté quelque chose (AudioContext
 *          dispo), false si pas supporté.
 */
export function unlockAudioSync(source: string): boolean {
  const standalone = isStandalone();
  const ctx = getAudioContext();
  if (!ctx) {
    console.warn(`[Audio] unlockAudioSync(${source}) — AudioContext unavailable`);
    return false;
  }

  console.info(
    `[Audio] unlockAudioSync() called via ${source} | standalone=${standalone} | ctx.state=${ctx.state}`,
  );

  // 1. Resume sync (Safari nécessite ce kick depuis un gesture).
  if (ctx.state === 'suspended') {
    // .resume() retourne une Promise mais on N'AWAIT PAS — le simple fait de
    // déclencher l'appel dans le gesture suffit à marquer la page audio-OK.
    ctx.resume().then(
      () => console.info('[Audio] AudioContext resumed: success'),
      (err: unknown) => console.warn('[Audio] AudioContext resumed: error', err),
    );
  }

  // 2. Silent buffer (1 sample, 22050 Hz mono) — c'est l'astuce historique
  //    pour marquer la page audio-engaged côté Safari.
  try {
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    console.info('[Audio] Silent buffer played');
    unlockedFlag = true;
  } catch (err) {
    console.warn('[Audio] Silent buffer play failed:', err);
    return false;
  }
  return true;
}

/** True si unlockAudioSync() a réussi au moins une fois cette session. */
export function isAudioUnlocked(): boolean {
  return unlockedFlag;
}
