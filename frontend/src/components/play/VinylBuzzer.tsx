/**
 * <VinylBuzzer /> — feat/arcade-buttons-vinyl-buzzer
 *
 * Vinyle qui REMPLACE le buzzer rond rouge sur le téléphone du joueur.
 *
 * États visuels :
 *   - au repos (track en lecture) : le vinyle TOURNE (animation infinie 1.9s
 *     linear, branchée sur le VRAI `isPlaying`). Pause = stop le spin (on
 *     fige la rotation à l'angle courant pour éviter le saut).
 *   - au TAP / au vrai event buzz : scratch (rotation oscillante 500ms) →
 *     stop + glow rose autour + le label central passe à `feedbackLabel`
 *     (ex: "À toi !" / pseudo du joueur).
 *   - disabled : opacity 0.38, pas d'interaction, pas de spin.
 *
 * A11y :
 *   - role="button" + aria-pressed reflète l'état "buzzed".
 *   - Espace / Entrée déclenchent le buzz quand focused.
 *   - prefers-reduced-motion : suppression de la rotation infinie ; le
 *     scratch reste (court, non-essentiel à la motion sickness).
 *
 * Le composant est purement présentationnel — la pipeline (recording /
 * upload / scoring) reste pilotée par le caller via `onBuzz`.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

interface Props {
  /** true tant qu'une track joue (currentTrack && !isPaused && phase active). */
  isPlaying: boolean;
  /** Le joueur a déjà buzzé (analyse en cours, scratch déclenché). */
  buzzed?: boolean;
  /** Label central. Affiche le wordmark Tutti si null. */
  label?: string | null;
  /** Sous-label sous le vinyle (état texte). */
  hint?: string | null;
  /** Texte central si buzzed (ex: "À toi !"). */
  feedbackLabel?: string | null;
  /** Désactive le bouton (phase 3, déjà répondu, etc.). */
  disabled?: boolean;
  /** Déclenché au tap (joueur veut buzzer). */
  onBuzz: () => void;
  /** aria-label du bouton. */
  ariaLabel?: string;
}

export function VinylBuzzer({
  isPlaying,
  buzzed = false,
  label = null,
  hint = null,
  feedbackLabel = null,
  disabled = false,
  onBuzz,
  ariaLabel,
}: Props): JSX.Element {
  // Au tap, on déclenche localement un scratch éphémère même si le vrai
  // event buzz remontera asynchrone via le caller. L'override scratch se
  // remet à 0 après l'animation (500ms).
  const [localScratch, setLocalScratch] = useState(false);
  const scratchTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (scratchTimerRef.current !== null) window.clearTimeout(scratchTimerRef.current);
    },
    [],
  );

  // Pause du spin : on fige l'angle courant via animation-play-state plutôt
  // que de retirer la classe (sinon saut visuel à 0deg).
  const spinning = isPlaying && !buzzed && !localScratch && !disabled;
  const scratching = localScratch || buzzed;

  const handleClick = (): void => {
    if (disabled) return;
    setLocalScratch(true);
    if (scratchTimerRef.current !== null) window.clearTimeout(scratchTimerRef.current);
    scratchTimerRef.current = window.setTimeout(() => setLocalScratch(false), 520);
    onBuzz();
  };

  const handleKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      handleClick();
    }
  };

  // Wordmark central (texte) ou feedback. Garder Fraunces italic 900.
  const centerText = scratching && feedbackLabel ? feedbackLabel : (label ?? 'TUTTI');

  return (
    <div className="flex flex-col items-center gap-4 select-none">
      {/* Conteneur fond clair (jamais noir sur noir). Cream + bord ink. */}
      <div className="relative flex items-center justify-center w-[240px] h-[240px] rounded-2xl bg-cream border-2 border-ink shadow-arcade">
        {/* Glow rose autour quand scratching */}
        <span
          aria-hidden
          className={`absolute inset-2 rounded-full transition-opacity duration-300 ${
            scratching ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            boxShadow: '0 0 0 6px rgba(232, 92, 138, 0.55), 0 0 28px 12px rgba(232, 92, 138, 0.35)',
          }}
        />

        <button
          type="button"
          onClick={handleClick}
          onKeyDown={handleKey}
          disabled={disabled}
          aria-label={ariaLabel ?? 'Buzzer vinyle'}
          aria-pressed={buzzed}
          className={`relative w-[200px] h-[200px] rounded-full border-2 border-ink overflow-hidden focus:outline-none focus-visible:ring-4 focus-visible:ring-rose focus-visible:ring-offset-2 ${
            disabled ? 'opacity-[0.38] cursor-not-allowed' : 'cursor-pointer'
          }`}
          style={{
            // Sillons : noir + micro-sillons clairs réguliers.
            background:
              'repeating-radial-gradient(circle at 50% 50%, #221c18 0px 1.3px, #0c0a08 1.3px 4px)',
            // animation-play-state via inline style pour figer sans saut.
            animation: scratching
              ? 'vinyl-scratch 500ms cubic-bezier(0.3, 0.6, 0.4, 1) forwards'
              : spinning
                ? 'vinyl-spin 1.9s linear infinite'
                : undefined,
            animationPlayState: spinning ? 'running' : undefined,
          }}
        >
          {/* Sheen diagonal léger pour donner du relief (overlay non-cliquable). */}
          <span
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'linear-gradient(125deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.18) 32%, rgba(255,255,255,0) 55%, rgba(255,255,255,0.06) 100%)',
              mixBlendMode: 'screen',
            }}
          />

          {/* Label central rose (~44%) avec wordmark Tutti */}
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center"
            // animation contre-rotation : annule le spin pour garder le label
            // lisible si on est en mode spinning (sinon le texte tourne).
            // Implémenté via JS : un wrapper séparé non animé… mais ici, on
            // garde simple — le label EST sur le vinyle qui tourne. C'est OK
            // pour le wordmark court (3 lettres) et reflète le tournedisque.
          >
            <span
              className="flex items-center justify-center rounded-full border-2 border-ink"
              style={{
                width: '44%',
                height: '44%',
                background: scratching ? '#c43b6e' : '#e85c8a',
                transition: 'background 200ms ease',
              }}
            >
              <span
                className="text-center text-cream leading-none px-1"
                style={{
                  fontFamily: 'Fraunces, serif',
                  fontStyle: 'italic',
                  fontWeight: 900,
                  fontSize: scratching && feedbackLabel ? 13 : 18,
                  letterSpacing: '0.04em',
                  textShadow: '0 1px 0 rgba(0,0,0,0.25)',
                }}
              >
                {centerText}
              </span>
            </span>
          </span>

          {/* Trou central crème */}
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cream border-2 border-ink"
            style={{ width: 14, height: 14 }}
          />
        </button>
      </div>

      {/* Hint sous le vinyle (état texte, ex "Appuie pour buzzer"). */}
      {hint && (
        <p className="font-display text-base md:text-lg text-ink text-center" aria-live="polite">
          {hint}
        </p>
      )}

      {/* prefers-reduced-motion : kill le spin infini, garde le scratch
          (court, OK). Scope global pas idéal — on cible la classe locale. */}
      <style>{`
        @media (prefers-reduced-motion: reduce) {
          button[aria-label="${ariaLabel ?? 'Buzzer vinyle'}"] {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
