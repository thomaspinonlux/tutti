/**
 * <PwaInstallButton /> — feat/pwa-installable
 *
 * Bouton discret "📲 Installer Tutti" :
 *   - Chrome/Edge (desktop + Android) : déclenche le prompt natif via
 *     `beforeinstallprompt`.
 *   - iOS Safari : pas de prompt natif possible. On affiche une mini-note
 *     guidant l'utilisateur vers Partager → "Sur l'écran d'accueil".
 *   - Déjà installé (standalone) : le composant retourne null (pas d'intérêt).
 *   - Pas supporté (Firefox desktop sans flag) : retourne null aussi.
 *
 * À placer dans le master menu (host) — pas dans le flow joueur (cible pro).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePwa } from '../lib/usePwa.js';

interface Props {
  /** Classe additionnelle pour le bouton (ex: 'w-full' dans une liste menu). */
  className?: string;
}

export function PwaInstallButton({ className }: Props): JSX.Element | null {
  const { t } = useTranslation();
  const { canInstall, promptInstall, isStandalone, isIos } = usePwa();
  const [iosHint, setIosHint] = useState(false);

  // Déjà installé → on n'affiche rien.
  if (isStandalone) return null;

  // Ni install natif ni iOS → navigateur non supporté (Firefox desktop par ex.).
  // On masque le bouton plutôt que d'afficher un truc qui ne fait rien.
  if (!canInstall && !isIos) return null;

  const handleClick = async (): Promise<void> => {
    if (isIos) {
      setIosHint((v) => !v);
      return;
    }
    const outcome = await promptInstall();
    if (outcome === 'unavailable') {
      // Le navigateur a rétracté l'event entre deux renders — montre la note iOS
      // par défaut (instructions génériques).
      setIosHint(true);
    }
  };

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => void handleClick()}
        className="w-full flex items-center gap-2 px-3 py-2 rounded border-2 border-ink bg-cream text-ink font-mono text-xs hover:bg-spritz/30 transition"
      >
        <span aria-hidden>📲</span>
        <span className="flex-1 text-left">{t('pwa.installCta')}</span>
      </button>
      {iosHint && (
        <p
          role="status"
          className="mt-2 font-mono text-[11px] text-ink-soft leading-snug border-l-2 border-spritz pl-2"
        >
          {t('pwa.iosHint')}
        </p>
      )}
    </div>
  );
}
