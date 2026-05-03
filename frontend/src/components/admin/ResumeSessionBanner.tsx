/**
 * <ResumeSessionBanner /> — bandeau "Partie en cours" affiché en haut de
 * l'admin layout quand une session WAITING ou PLAYING existe dans le
 * workspace courant.
 *
 * Conditions d'affichage :
 *   - Au mount : fetch GET /api/sessions/current
 *   - Si une session est trouvée → affiche le banner
 *   - User peut "Reprendre" (navigate /host?session=CODE) ou "Ignorer"
 *     (sessionStorage dismiss flag)
 *   - Re-fetch à chaque navigation (pour invalider après end)
 *
 * Pas affiché sur /host /play /screen (déjà dans la session).
 */

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getCurrentSession, type CurrentActiveSession } from '../../lib/sessions.js';
import { Button } from '../ui/index.js';

const DISMISS_KEY = 'tutti.resume_banner_dismissed';

export function ResumeSessionBanner(): JSX.Element | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState<CurrentActiveSession | null>(null);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === '1');

  useEffect(() => {
    let cancelled = false;
    void getCurrentSession()
      .then((s) => {
        if (!cancelled) setSession(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (!session || dismissed) return null;

  const handleResume = (): void => {
    navigate(`/host?session=${session.short_code}`);
  };

  const handleDismiss = (): void => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  const isOld =
    session.started_at && Date.now() - new Date(session.started_at).getTime() > 30 * 60 * 1000;

  return (
    <div className="sticky top-0 z-40 bg-spritz border-b-2 border-ink shadow-pop-sm">
      <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-3 flex-wrap">
        <span className="text-xl">🎵</span>
        <div className="flex-1 min-w-0">
          <p className="font-display text-base">
            {t('resumeBanner.title')}
            {session.name && <span className="font-editorial italic"> — {session.name}</span>}
          </p>
          <p className="font-mono text-[11px] text-ink-soft truncate">
            {session.short_code} · {session.game_type === 'TRACKS' ? '🎵 Tracks' : '❓ Quizz'} ·{' '}
            {session.status === 'WAITING' ? t('resumeBanner.waiting') : t('resumeBanner.playing')}
            {isOld && ' · ' + t('resumeBanner.old')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleResume}>
            {t('resumeBanner.resume')} →
          </Button>
          <button
            type="button"
            onClick={handleDismiss}
            className="text-ink-soft hover:text-ink px-2 text-lg"
            aria-label={t('resumeBanner.dismiss')}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
