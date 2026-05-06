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

// Issue 2 fix : dismiss PAR session (clé inclut session.id) au lieu d'un flag
// global qui cachait la bannière de TOUTES les sessions futures jusqu'à
// fermeture onglet. Avec la clé per-session, dismisser la bannière d'une
// session A n'empêche pas l'apparition pour la session B suivante.
const DISMISS_KEY_PREFIX = 'tutti.resume_banner_dismissed:';

export function ResumeSessionBanner(): JSX.Element | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState<CurrentActiveSession | null>(null);
  const [dismissedSessionId, setDismissedSessionId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getCurrentSession()
      .then((s) => {
        if (cancelled) return;
        setSession(s);
        // Re-lit le flag dismiss pour la session courante (per-session).
        if (s) {
          const dismissed = sessionStorage.getItem(DISMISS_KEY_PREFIX + s.id) === '1';
          setDismissedSessionId(dismissed ? s.id : null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (!session) return null;
  if (dismissedSessionId === session.id) return null;

  const handleResume = (): void => {
    navigate(`/host?session=${session.short_code}`);
  };

  const handleDismiss = (): void => {
    sessionStorage.setItem(DISMISS_KEY_PREFIX + session.id, '1');
    setDismissedSessionId(session.id);
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
