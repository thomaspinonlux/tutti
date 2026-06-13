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
import { useTranslation } from 'react-i18next';
import { Button, Card } from '../ui/index.js';
import { QRCode } from './QRCode.js';
import { usePwa } from '../../lib/usePwa.js';

interface Props {
  /** Code court de salon (5 chars). null si pas encore dispo. */
  tvCode: string | null | undefined;
  /** Code joueur (short_code) — fallback pour /screen?session= si besoin. */
  shortCode: string;
}

export function TvCastButton({ tvCode, shortCode }: Props): JSX.Element | null {
  const { t } = useTranslation();
  const { isStandalone } = usePwa();
  const [open, setOpen] = useState(false);

  if (!tvCode) return null;

  const joinUrl = `${window.location.origin}/tv/${tvCode}`;
  // Plein écran "même appareil" : seulement hors PWA standalone (desktop
  // multi-fenêtres). En PWA iPad, window.open piège → on ne le propose pas.
  const canOpenHere = !isStandalone;

  const openHere = (): void => {
    window.open(`/screen?session=${encodeURIComponent(shortCode)}`, '_blank', 'noopener');
    setOpen(false);
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} title={t('tvCast.openHint')}>
        📺 {t('tvCast.button')}
      </Button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="tvcast-title"
          className="fixed inset-0 bg-ink/60 z-50 flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setOpen(false)}
        >
          <Card
            tone="cream"
            size="lg"
            className="max-w-md w-full text-center"
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
              {t('tvCast.urlHint', { origin: window.location.host })}
            </p>

            {/* QR */}
            <div className="flex justify-center mb-4">
              <QRCode value={joinUrl} size={200} />
            </div>
            <p className="font-mono text-[11px] text-ink-soft mb-4">{t('tvCast.qrHint')}</p>

            <div className="flex flex-col gap-2">
              {canOpenHere && (
                <Button variant="secondary" size="sm" onClick={openHere}>
                  🖥️ {t('tvCast.openHereButton')}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                {t('common.close')}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
