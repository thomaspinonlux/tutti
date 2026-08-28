/**
 * <LyricsOverlay /> — paroles synchronisées sur l'écran joueurs.
 *
 * Affiché UNIQUEMENT sur demande explicite de l'animateur, et seulement après
 * révélation du morceau (double garde : serveur + appelant).
 *
 * Synchronisation : boucle `requestAnimationFrame` qui relit la position réelle
 * du lecteur à chaque frame. On ne passe pas par un état React cadencé à 1 Hz —
 * le changement de ligne doit tomber exactement sur le timestamp.
 *
 * Lisibilité TV (1080p, ~6 m) : ligne courante très grande, voisines atténuées.
 * Aucune police nouvelle — on réutilise celles de l'écran TV.
 */

import { useEffect, useRef, useState } from 'react';
import { findLineIndex, type LrcLine } from '../../lib/lyrics.js';

interface Props {
  lines: LrcLine[];
  /** Position réelle du lecteur, en ms. Relue à chaque frame. */
  getPositionMs: () => number;
  paused: boolean;
}

/**
 * Correction globale de latence d'affichage (ms). Positif = les paroles
 * apparaissent plus tôt. Centralisé ici pour n'avoir qu'un seul endroit à
 * régler si la TV accuse un retard de rendu.
 */
// fix/lyrics-lead — la position voyage console → serveur → TV (~0,5-1 s de
// retard perçu). On AVANCE donc l'affichage de 700 ms : la ligne apparaît au
// moment où elle est réellement chantée dans la salle.
export const LYRICS_OFFSET_MS = 700;

/** Au-delà de ce silence, on affiche l'indicateur musical à la place du texte. */
const SILENCE_GAP_MS = 6000;

export function LyricsOverlay({ lines, getPositionMs, paused }: Props): JSX.Element | null {
  const [index, setIndex] = useState(-1);
  const rafRef = useRef<number | null>(null);
  // Évite un setState par frame : on ne re-rend que si la ligne change.
  const lastIndexRef = useRef(-1);

  useEffect(() => {
    if (lines.length === 0) return;

    const tick = (): void => {
      const pos = getPositionMs() + LYRICS_OFFSET_MS;
      const next = findLineIndex(lines, pos);
      if (next !== lastIndexRef.current) {
        lastIndexRef.current = next;
        setIndex(next);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // `paused` est dans les deps pour relancer la boucle à la reprise : la
    // position ne bouge pas en pause, mais le rendu doit rester cohérent.
  }, [lines, getPositionMs, paused]);

  if (lines.length === 0) return null;

  const current = index >= 0 ? (lines[index] ?? null) : null;
  const next1 = lines[index + 1];
  const next2 = lines[index + 2];
  const prev = index > 0 ? lines[index - 1] : null;

  // Avant la première parole, ou pendant un long interlude (ligne vide, ou
  // prochain timestamp très éloigné) → indicateur musical plutôt qu'une phrase
  // figée à l'écran.
  const gapToNext = next1 && current ? next1.t_ms - current.t_ms : 0;
  const inSilence =
    current === null || current.text.length === 0 || (gapToNext > SILENCE_GAP_MS && !!next1);

  return (
    <div
      className="flex flex-col items-center justify-center w-full h-full px-8 text-center select-none"
      aria-live="off"
    >
      {/* fix/lyrics-block-scroll — un BLOC de 4 phrases, toutes lisibles de
          loin, qui déroule d'un cran à chaque ligne chantée (transition douce).
          La phrase en cours est la plus grosse ; celles qui suivent restent
          assez grandes pour être lues en avance, comme un karaoké. */}
      {prev?.text ? (
        <p className="font-display text-3xl xl:text-4xl text-cream/30 mb-5 line-clamp-1 transition-all duration-300">
          {prev.text}
        </p>
      ) : (
        <div className="mb-5 h-10" aria-hidden />
      )}

      {inSilence ? (
        <p className="font-display text-6xl xl:text-7xl text-cream/60 tracking-[0.3em] animate-pulse">
          ♪ ♪ ♪
        </p>
      ) : (
        <p className="font-display text-[56px] leading-[1.08] xl:text-7xl text-cream drop-shadow-lg transition-all duration-300 max-w-[94%]">
          {current?.text}
        </p>
      )}

      <div className="mt-7 space-y-3">
        {next1?.text ? (
          <p className="font-display text-4xl xl:text-5xl text-cream/60 line-clamp-1 transition-all duration-300">
            {next1.text}
          </p>
        ) : null}
        {next2?.text ? (
          <p className="font-display text-3xl xl:text-4xl text-cream/35 line-clamp-1 transition-all duration-300">
            {next2.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
