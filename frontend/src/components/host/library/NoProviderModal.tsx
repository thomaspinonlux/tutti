/**
 * Modal bloquant (Sujet 4 brief) — affiché quand le host clique "Lancer la
 * session" sur une playlist officielle SANS aucun compte (Spotify/YouTube)
 * connecté. 2 boutons connecter, pas de bypass.
 */

import { useTranslation } from 'react-i18next';
import { Button, Card } from '../../ui/index.js';

interface Props {
  open: boolean;
  onClose: () => void;
  onConnectSpotify: () => void;
  onConnectYoutube: () => void;
}

export function NoProviderModal({
  open,
  onClose,
  onConnectSpotify,
  onConnectYoutube,
}: Props): JSX.Element | null {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="no-provider-title"
      className="fixed inset-0 z-50 bg-ink/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} className="max-w-md w-full">
        <Card size="md" tone="cream">
          <p className="text-3xl mb-2 text-center" aria-hidden>
            🔌
          </p>
          <h2 id="no-provider-title" className="font-display text-2xl text-center mb-2">
            {t('host.session.modal.noProvider.title')}
          </h2>
          <p className="font-editorial italic text-ink-soft text-center mb-5">
            {t('host.session.modal.noProvider.body')}
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button onClick={onConnectSpotify} className="flex-1">
              🎵 {t('host.session.modal.noProvider.connectSpotify')}
            </Button>
            <Button variant="secondary" onClick={onConnectYoutube} className="flex-1">
              ▶ {t('host.session.modal.noProvider.connectYoutube')}
            </Button>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="w-full mt-3">
            {t('common.cancel')}
          </Button>
        </Card>
      </div>
    </div>
  );
}
