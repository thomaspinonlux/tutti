/**
 * <TvCastButton /> — feat/tv-join-code-multidevice
 *
 * Bouton "📺 Écran TV" sur l'écran animateur → ouvre un modal qui affiche :
 *   - le CODE de salon court (5 chars, gros, majuscules) à taper sur /tv
 *   - un QR code encodant l'URL /tv/{CODE} (scan caméra 2e device → direct)
 *
 * Remplace l'ancien ExternalScreenButton qui appliquait l'écran TV au MÊME
 * appareil (piège iPad PWA standalone : 1 seul affichage plein écran par
 * device sur iOS). Ici c'est un 2e appareil qui rejoint.
 *
 * Bonus desktop : si la fenêtre supporte le multi-fenêtres (pas une PWA
 * standalone), propose aussi "Ouvrir ici dans une nouvelle fenêtre" comme
 * raccourci — jamais affiché en standalone iPad.
 */

import { useState } from 'react';
import { getShareableOrigin, isRealDesktop } from '../../lib/platform.js';
import { useTranslation } from 'react-i18next';
import { Button, Card } from '../ui/index.js';
import { QRCode } from './QRCode.js';

interface Props {
  /** Code court de salon (5 chars). null si pas encore dispo. */
  tvCode: string | null | undefined;
  /** Code joueur (short_code) — fallback pour /screen?session= si besoin. */
  shortCode: string;
}

export function TvCastButton({ tvCode, shortCode }: Props): JSX.Element | null {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  if (!tvCode) return null;

  // Plein écran "même appareil" : UNIQUEMENT sur un vrai desktop multi-fenêtres.
  // Jamais sur iPad/tablette/téléphone (même en navigateur, pas seulement PWA)
  // — window.open y redirige sur l'onglet courant = piège. Sur ces appareils :
  // uniquement code + QR pour qu'un 2e device rejoigne.
  const canOpenHere = isRealDesktop();

  const openHere = (): void => {
    window.open(`/screen?session=${encodeURIComponent(shortCode)}`, '_blank', 'noopener');
    setOpen(false);
  };

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        title={t('tvCast.openHint')}
      >
        {t('tvCast.button')}
      </Button>

      {open && (
        <TvCastFenetre
          tvCode={tvCode}
          onClose={() => setOpen(false)}
          onOuvrirIci={canOpenHere ? openHere : undefined}
        />
      )}
    </>
  );
}

/**
 * La fenêtre « Brancher l'écran joueurs » : code à taper sur /tv + QR code.
 * Partagée par la console (bouton ci-dessus) et par le téléphone de
 * l'animateur (feat/ecran-joueurs-telecommande) : même fenêtre des deux côtés.
 */
export function TvCastFenetre({
  tvCode,
  onClose,
  onOuvrirIci,
}: {
  tvCode: string;
  onClose: () => void;
  /** Ordinateur seulement : ouvrir l'écran dans une autre fenêtre. */
  onOuvrirIci?: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const joinUrl = `${getShareableOrigin()}/tv/${tvCode}`;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tvcast-title"
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <Card
        tone="cream"
        size="lg"
        className="max-w-md w-full text-center max-h-[calc(100dvh-2rem)] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="tvcast-title" className="font-display text-2xl mb-1">
          {t('tvCast.title')}
        </h3>
        <p className="font-editorial italic text-ink-soft text-sm mb-4">{t('tvCast.intro')}</p>

        {/* Code court gros */}
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-1">
          {t('tvCast.codeLabel')}
        </p>
        <p
          className="font-display text-5xl tracking-[0.3em] mb-1 select-all"
          aria-label={t('tvCast.codeAria', { code: tvCode.split('').join(' ') })}
        >
          {tvCode}
        </p>
        <p className="font-mono text-[11px] text-ink-soft mb-4">
          {t('tvCast.urlHint', { origin: new URL(getShareableOrigin()).host })}
        </p>

        {/* QR */}
        <div className="flex justify-center mb-4">
          <QRCode value={joinUrl} size={200} />
        </div>
        <p className="font-mono text-[11px] text-ink-soft mb-4">{t('tvCast.qrHint')}</p>

        <div className="flex flex-col gap-2">
          {onOuvrirIci && (
            <Button variant="secondary" size="sm" onClick={onOuvrirIci}>
              {t('tvCast.openHereButton')}
            </Button>
          )}
          <Button variant="secondary" size="md" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
