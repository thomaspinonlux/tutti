/**
 * <JoinQrCorner /> — feat/tv-join-qr-codes
 *
 * QR de rejoindre la partie, petit et discret en coin. Réutilise le lien de
 * join existant (`/play?session=<short_code>`) — PAS de nouveau code.
 *
 * Deux usages :
 *   - statique (sélection animateur, grille TV) : affichage seul ;
 *   - cliquable (`onClick`) côté animateur pendant la partie : un clic toggle
 *     l'overlay QR géant sur la TV (`active` reflète l'état courant).
 */

import { useTranslation } from 'react-i18next';
import { QRCode } from './QRCode.js';

interface Props {
  /** short_code de la session (= code de join existant). */
  joinCode: string;
  size?: number;
  /** Si fourni → rendu cliquable (toggle overlay TV côté animateur). */
  onClick?: () => void;
  /** État visuel "QR affiché en grand sur la TV". */
  active?: boolean;
  /** Override position (par défaut coin bas-droit, fixe). */
  className?: string;
}

export function JoinQrCorner({
  joinCode,
  size = 96,
  onClick,
  active = false,
  className,
}: Props): JSX.Element {
  const { t } = useTranslation();
  const url = `${window.location.origin}/play?session=${joinCode}`;

  // Label sous le QR : reflète l'action courante (agrandir / fermer / statique).
  const actionLabel = onClick
    ? active
      ? t('host.joinQr.close')
      : t('host.joinQr.tapToEnlarge')
    : t('host.joinQr.label');

  const inner = (
    <>
      <QRCode value={url} size={size} className="!p-2 !shadow-pop !border-2" />
      <span className="mt-1 font-mono text-[9px] uppercase tracking-wider text-ink-soft text-center leading-tight">
        {actionLabel}
      </span>
    </>
  );

  const position = className ?? 'fixed bottom-4 right-4 z-40';

  if (onClick) {
    return (
      // Conteneur relatif : la croix de fermeture est un bouton SŒUR (pas
      // imbriqué) positionné en haut-droite du QR agrandi.
      <div className={`${position} flex flex-col items-center`}>
        <div className="relative">
          <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            aria-label={active ? t('host.joinQr.close') : t('host.joinQr.tapToEnlarge')}
            className={`flex flex-col items-center rounded-xl p-1 transition-transform hover:-translate-y-0.5 ${
              active ? 'ring-4 ring-spritz ring-offset-2 ring-offset-cream' : ''
            }`}
          >
            {inner}
          </button>

          {/* feat/qr-overlay-close — croix bien visible quand le QR géant est
              affiché sur la TV : 1 tap évident pour refermer (postQrOverlay(false)
              via le même onClick toggle). Le re-clic sur le QR reste possible. */}
          {active && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClick();
              }}
              aria-label={t('host.joinQr.close')}
              className="absolute -top-3 -right-3 z-10 flex h-11 w-11 items-center justify-center rounded-full border-2 border-ink bg-raspberry text-cream shadow-pop-lg font-display text-2xl leading-none transition-transform active:scale-90"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`${position} flex flex-col items-center pointer-events-none`}>{inner}</div>
  );
}
