/**
 * <PwaUpdateBanner /> — feat/pwa-installable
 *
 * Toast discret bottom-right qui apparaît quand le SW a téléchargé une nouvelle
 * version. Volontairement non-modal : le host peut continuer sa session en cours,
 * la mise à jour s'appliquera au prochain reload manuel ou clic "Recharger".
 *
 * Pourquoi un prompt et pas auto-update :
 *   - Auto-update via skipWaiting reload la page = casse une partie en cours
 *     (perte du state, des sockets, du master qui pilote la TV…). On ne veut
 *     JAMAIS surprendre le host.
 *   - Le prompt apparaît dans tous les contextes (admin, host, play) ; le user
 *     décide quand recharger.
 */

import { useTranslation } from 'react-i18next';
import { usePwa } from '../lib/usePwa.js';

export function PwaUpdateBanner(): JSX.Element | null {
  const { t } = useTranslation();
  const { needsRefresh, applyUpdate, dismissUpdate } = usePwa();

  if (!needsRefresh) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 left-4 sm:left-auto z-50 max-w-sm border-2 border-ink rounded-lg bg-cream shadow-pop-lg p-4 animate-pop-in"
    >
      <div className="flex items-start gap-3">
        <div className="text-2xl leading-none" aria-hidden>
          ✨
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display font-semibold text-ink text-sm">{t('pwa.updateAvailable')}</p>
          <p className="font-mono text-xs text-ink-soft mt-1">{t('pwa.updateHint')}</p>
        </div>
      </div>
      <div className="flex gap-2 mt-3 justify-end">
        <button
          type="button"
          onClick={dismissUpdate}
          className="px-3 py-1.5 text-xs font-mono border-2 border-ink-soft text-ink-soft rounded hover:bg-ink-soft hover:text-cream transition"
        >
          {t('pwa.updateLater')}
        </button>
        <button
          type="button"
          onClick={applyUpdate}
          className="px-3 py-1.5 text-xs font-mono font-semibold border-2 border-ink bg-raspberry text-cream rounded shadow-pop hover:translate-y-px transition"
        >
          {t('pwa.updateNow')}
        </button>
      </div>
    </div>
  );
}
