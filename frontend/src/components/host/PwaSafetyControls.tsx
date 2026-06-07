/**
 * <PwaSafetyControls /> — feat/pwa-standalone-safety-controls
 *
 * Contrôles de secours visibles UNIQUEMENT en mode PWA standalone (iPad
 * home-screen, navigator.standalone OU display-mode: standalone). En mode
 * standalone l'utilisateur n'a PAS la barre URL → si l'UI plante ou si l'audio
 * est bloqué, il est coincé à moins de fermer l'app entièrement.
 *
 * Trois boutons :
 *   - 🔄 Recharger          : window.location.reload()
 *   - 🐛 Debug audio        : toggle localStorage.debugAudio + reload
 *   - (📺 Écran TV reste sur ExternalScreenButton, à côté)
 *
 * Affichage discret : 3 petits boutons icône dans le coin haut-droit, à côté
 * de ExternalScreenButton + MasterBadge. Pas affiché en mode navigateur
 * standard (la barre URL fournit déjà reload/devtools).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePwa } from '../../lib/usePwa.js';

export function PwaSafetyControls(): JSX.Element | null {
  const { isStandalone } = usePwa();
  const { t } = useTranslation();
  const [confirmReload, setConfirmReload] = useState(false);

  if (!isStandalone) return null;

  const handleReload = (): void => {
    if (!confirmReload) {
      setConfirmReload(true);
      window.setTimeout(() => setConfirmReload(false), 3000);
      return;
    }
    window.location.reload();
  };

  const handleToggleDebug = (): void => {
    try {
      const current = localStorage.getItem('debugAudio') === 'true';
      if (current) {
        localStorage.removeItem('debugAudio');
      } else {
        localStorage.setItem('debugAudio', 'true');
      }
      window.location.reload();
    } catch (err) {
      console.warn('[PwaSafetyControls] localStorage error', err);
    }
  };

  const debugActive = (() => {
    try {
      return localStorage.getItem('debugAudio') === 'true';
    } catch {
      return false;
    }
  })();

  return (
    <div className="flex gap-1 items-center" role="group" aria-label={t('host.pwaSafety.label')}>
      <button
        type="button"
        onClick={handleReload}
        className={`px-2 py-1 text-xs font-mono rounded border-2 border-ink ${
          confirmReload ? 'bg-raspberry text-cream' : 'bg-cream text-ink'
        }`}
        title={confirmReload ? t('host.pwaSafety.reloadConfirm') : t('host.pwaSafety.reloadHint')}
        aria-label={t('host.pwaSafety.reloadHint')}
      >
        {confirmReload ? '⚠️ ' : '🔄 '}
        {confirmReload ? t('host.pwaSafety.reloadConfirmShort') : t('host.pwaSafety.reloadShort')}
      </button>
      <button
        type="button"
        onClick={handleToggleDebug}
        className={`px-2 py-1 text-xs font-mono rounded border-2 border-ink ${
          debugActive ? 'bg-basil text-cream' : 'bg-cream text-ink'
        }`}
        title={debugActive ? t('host.pwaSafety.debugOnHint') : t('host.pwaSafety.debugOffHint')}
        aria-pressed={debugActive}
      >
        🐛 {debugActive ? t('host.pwaSafety.debugOn') : t('host.pwaSafety.debugOff')}
      </button>
    </div>
  );
}
