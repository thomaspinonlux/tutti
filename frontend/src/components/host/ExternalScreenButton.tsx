/**
 * <ExternalScreenButton /> — bouton 📺 + popup d'auto-projection sur écran TV.
 *
 * Comportement :
 *   - Au mount, si plusieurs écrans détectés (Window Management API) ET pas
 *     de choix mémorisé → popup "Écran externe détecté. Projeter ?" [Oui][Non]
 *   - Bouton 📺 toujours visible : clic = ouvre /screen?session=CODE
 *     (positionné sur écran externe si détecté, sinon nouvel onglet manuel)
 *   - Choix mémorisé en localStorage pour la session.
 *
 * feat/pwa-standalone-safety-controls — en mode PWA standalone (iPad PWA),
 * window.open() est bloqué/redirigé sur la fenêtre courante → trap (l'host
 * se retrouve sur /screen sans moyen de revenir). Dans ce mode, si aucun
 * écran secondaire n'est détecté, on affiche un modal "Aucun écran détecté"
 * avec bouton retour, AU LIEU d'ouvrir /screen et de bloquer l'host.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useExternalScreen } from '../../lib/useExternalScreen.js';
import { usePwa } from '../../lib/usePwa.js';
import { Button, Card } from '../ui/index.js';

interface Props {
  shortCode: string;
}

export function ExternalScreenButton({ shortCode }: Props): JSX.Element {
  const { t } = useTranslation();
  const { isStandalone } = usePwa();
  const {
    apiSupported,
    hasExternalScreen,
    detected,
    shouldPromptAutoOpen,
    openOnExternalScreen,
    rememberChoice,
  } = useExternalScreen();
  const [showPrompt, setShowPrompt] = useState(false);
  const [opened, setOpened] = useState(false);
  /** feat/pwa-standalone-safety-controls — modal "no screen detected" pour
   *  éviter le trap PWA standalone. */
  const [showNoScreenModal, setShowNoScreenModal] = useState(false);

  // Auto-popup au 1er mount si écran détecté + pas de choix mémorisé
  useEffect(() => {
    if (detected && shouldPromptAutoOpen && !opened) {
      setShowPrompt(true);
    }
  }, [detected, shouldPromptAutoOpen, opened]);

  const handleAccept = async (): Promise<void> => {
    rememberChoice(true);
    setShowPrompt(false);
    const ok = await openOnExternalScreen(shortCode);
    if (ok) setOpened(true);
  };

  const handleReject = (): void => {
    rememberChoice(false);
    setShowPrompt(false);
  };

  const handleManualOpen = async (): Promise<void> => {
    // PWA standalone + no external screen → window.open ne s'ouvrira pas
    // dans une vraie nouvelle fenêtre. Afficher un modal d'info au lieu
    // de naviguer hors host.
    if (isStandalone && !hasExternalScreen) {
      setShowNoScreenModal(true);
      return;
    }
    const ok = await openOnExternalScreen(shortCode);
    if (ok) setOpened(true);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void handleManualOpen()}
        title={t('host.externalScreen.openHint')}
      >
        📺 {t('host.externalScreen.openButton')}
      </Button>

      {showPrompt && (
        <div
          className="fixed inset-0 bg-ink/50 z-50 flex items-center justify-center p-6 animate-fade-in"
          onClick={handleReject}
        >
          <Card
            tone="cream"
            size="lg"
            className="max-w-md text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-display text-3xl mb-2">📺</p>
            <h3 className="font-display text-2xl mb-2">{t('host.externalScreen.detected')}</h3>
            <p className="font-editorial italic text-ink-soft mb-4">
              {t('host.externalScreen.detectedHint')}
            </p>
            <div className="flex gap-2 justify-center">
              <Button variant="secondary" onClick={handleReject}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void handleAccept()}>
                {t('host.externalScreen.projectNow')}
              </Button>
            </div>
            {!apiSupported && (
              <p className="text-[11px] font-mono text-ink-soft mt-3">
                {t('host.externalScreen.apiUnsupported')}
              </p>
            )}
            {apiSupported && !hasExternalScreen && (
              <p className="text-[11px] font-mono text-ink-soft mt-3">
                {t('host.externalScreen.noExternalDetected')}
              </p>
            )}
          </Card>
        </div>
      )}

      {showNoScreenModal && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="no-screen-title"
          className="fixed inset-0 bg-ink/50 z-50 flex items-center justify-center p-6 animate-fade-in"
          onClick={() => setShowNoScreenModal(false)}
        >
          <Card
            tone="cream"
            size="lg"
            className="max-w-md text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-display text-3xl mb-2" aria-hidden>
              📺
            </p>
            <h3 id="no-screen-title" className="font-display text-2xl mb-2">
              {t('host.externalScreen.noScreenStandaloneTitle')}
            </h3>
            <p className="font-editorial italic text-ink-soft mb-4">
              {t('host.externalScreen.noScreenStandaloneBody')}
            </p>
            <div className="flex justify-center">
              <Button onClick={() => setShowNoScreenModal(false)}>
                {t('host.externalScreen.noScreenBackButton')}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
