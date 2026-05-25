/**
 * <VoiceButton /> — feat/voice-button-redesign (PR 2/4 voice cascade)
 *
 * Bouton micro de réponse vocale réutilisable (TRACKS + QUIZZ). 4 états
 * visuels distincts avec animations Framer Motion. Branché sur le système
 * de reconnaissance vocale existant (Whisper) — pas de cascade Web Speech /
 * Deepgram (ce sera PR C de la cascade).
 *
 * États :
 *   - idle       : coral red + pulse subtil (respiration). "Appuie pour répondre"
 *   - listening  : slate blue + ripple concentrique. "Parle maintenant…"
 *   - processing : spinner discret. "Vérification…"
 *   - success    : flash basil + scale bounce. "Bonne réponse !"
 *   - fail       : flash raspberry + shake. "Mauvaise réponse"
 *
 * A11y :
 *   - aria-label dynamique selon état
 *   - aria-pressed reflète l'état d'enregistrement
 *   - aria-live="polite" sur le label texte sous le bouton
 *   - Focus ring spritz visible
 *   - Toggle via barre Espace (capturé par la div parent quand focus)
 *
 * Le bouton est purement présentationnel : c'est au caller d'orchestrer la
 * pipeline (getUserMedia / MediaRecorder / POST voice-answer / matching).
 * Les transitions d'état sont déclenchées par le caller via la prop `state`.
 */

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export type VoiceButtonState = 'idle' | 'listening' | 'processing' | 'success' | 'fail';

interface Props {
  state: VoiceButtonState;
  /** Appelé au tap quand state === 'idle' (démarrer enregistrement). */
  onStart: () => void;
  /** Appelé au tap quand state === 'listening' (arrêter enregistrement). */
  onStop: () => void;
  /** Texte sous le bouton (déjà localisé). Si null → label défaut selon état. */
  labelOverride?: string | null;
  /** Transcript affiché en sous-titre pendant listening / après processing. */
  transcript?: string | null;
  /** Désactive le bouton (ex: phase 3 host, pas le moment de buzzer). */
  disabled?: boolean;
  /** Labels i18n. Si non fournis → fallback FR hardcodé. */
  labels?: {
    idle?: string;
    listening?: string;
    processing?: string;
    success?: string;
    fail?: string;
    ariaIdle?: string;
    ariaListening?: string;
  };
}

const DEFAULT_LABELS = {
  idle: 'Appuie pour répondre',
  listening: 'Parle maintenant…',
  processing: 'Vérification…',
  success: 'Bonne réponse !',
  fail: 'Mauvaise réponse',
  ariaIdle: 'Appuyer pour parler',
  ariaListening: 'Appuyer pour arrêter',
};

export function VoiceButton({
  state,
  onStart,
  onStop,
  labelOverride,
  transcript,
  disabled,
  labels,
}: Props): JSX.Element {
  const L = { ...DEFAULT_LABELS, ...(labels ?? {}) };
  const btnRef = useRef<HTMLButtonElement | null>(null);

  // Toggle via barre Espace (capturée tant que le bouton a le focus visible).
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.code !== 'Space') return;
      if (document.activeElement !== btnRef.current) return;
      e.preventDefault();
      if (disabled) return;
      if (state === 'idle') onStart();
      else if (state === 'listening') onStop();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state, onStart, onStop, disabled]);

  const handleClick = (): void => {
    if (disabled) return;
    if (state === 'idle') onStart();
    else if (state === 'listening') onStop();
    // processing/success/fail : tap ignoré (état piloté par le caller)
  };

  // Background color selon état.
  const bg =
    state === 'idle'
      ? 'bg-[#e76f51]' // coral red
      : state === 'listening'
        ? 'bg-[#7a8a9a]' // slate blue-grey
        : state === 'processing'
          ? 'bg-[#7a8a9a]'
          : state === 'success'
            ? 'bg-[#10b981]' // emerald
            : 'bg-[#ef4444]'; // red

  const label = labelOverride ?? L[state] ?? L.idle;
  const ariaLabel = state === 'listening' ? L.ariaListening : L.ariaIdle;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative flex items-center justify-center">
        {/* Ripple concentriques en listening — 3 cercles décalés */}
        <AnimatePresence>
          {state === 'listening' && (
            <>
              {[0, 0.6, 1.2].map((delay) => (
                <motion.span
                  key={delay}
                  aria-hidden
                  initial={{ scale: 0.8, opacity: 0.6 }}
                  animate={{ scale: 2, opacity: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{
                    duration: 1.8,
                    delay,
                    repeat: Infinity,
                    ease: 'easeOut',
                  }}
                  className="absolute inset-0 rounded-full border-4 border-[#7a8a9a]"
                  style={{ width: '100%', height: '100%' }}
                />
              ))}
            </>
          )}
        </AnimatePresence>

        <motion.button
          ref={btnRef}
          type="button"
          onClick={handleClick}
          disabled={disabled || state === 'processing'}
          aria-label={ariaLabel}
          aria-pressed={state === 'listening'}
          // Variants pour transitions d'état (scale bounce sur success, shake sur fail).
          animate={
            state === 'success'
              ? { scale: [1, 1.15, 1], rotate: 0 }
              : state === 'fail'
                ? { scale: 1, rotate: [0, -6, 6, -4, 4, 0] }
                : state === 'idle'
                  ? { scale: [1, 1.04, 1], rotate: 0 }
                  : { scale: 1, rotate: 0 }
          }
          transition={
            state === 'idle'
              ? { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }
              : state === 'success'
                ? { duration: 0.5, ease: 'easeOut' }
                : state === 'fail'
                  ? { duration: 0.5, ease: 'easeInOut' }
                  : { duration: 0.25 }
          }
          className={[
            'relative w-24 h-24 md:w-32 md:h-32 rounded-full',
            'flex items-center justify-center',
            'text-white shadow-pop-lg border-[6px] border-ink',
            'transition-colors',
            'focus:outline-none focus-visible:ring-4 focus-visible:ring-spritz focus-visible:ring-offset-2',
            disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer active:translate-y-0.5',
            bg,
          ].join(' ')}
        >
          {/* Icône micro (SVG inline, pas de dep) */}
          <MicIcon className="w-10 h-10 md:w-12 md:h-12" />

          {/* Spinner processing */}
          {state === 'processing' && (
            <span
              aria-hidden
              className="absolute inset-1 rounded-full border-4 border-white/40 border-t-white animate-spin"
            />
          )}
        </motion.button>
      </div>

      {/* Label texte sous le bouton — change selon état */}
      <div className="text-center min-h-[3rem]" aria-live="polite">
        <p
          className={[
            'font-display text-base md:text-lg',
            state === 'success'
              ? 'text-basil-deep'
              : state === 'fail'
                ? 'text-raspberry-deep'
                : 'text-ink',
          ].join(' ')}
        >
          {label}
        </p>
        {transcript && (state === 'listening' || state === 'processing') && (
          <p className="font-editorial italic text-sm text-ink-soft mt-1 max-w-[280px] mx-auto">
            « {transcript} »
          </p>
        )}
      </div>
    </div>
  );
}

function MicIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M5 11a7 7 0 0 0 14 0" fill="none" />
      <line x1="12" y1="18" x2="12" y2="21" />
      <line x1="9" y1="21" x2="15" y2="21" />
    </svg>
  );
}
