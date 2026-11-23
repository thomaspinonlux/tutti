/**
 * <AvecRetour /> — fix/parcours-sans-impasse
 *
 * L'écran des joueurs (/screen) est une page plein écran, sans menu : c'est ce
 * qu'on veut sur la TV. Mais ouvert DEPUIS le tableau de bord sur un iPad ou un
 * téléphone, ou choisi par erreur sur la page du code TV, il remplace tout le
 * reste et rien ne permettait d'en sortir.
 *
 * La page d'origine passe son adresse dans l'état de navigation
 * (`navigate(url, { state: { retour: '/admin/dashboard' } })`) : on affiche
 * alors un bouton de retour par-dessus l'écran. Il s'efface au bout de
 * quelques secondes pour ne pas rester sur l'image (l'iPad peut être recopié
 * sur la TV) et revient dès qu'on touche l'écran ou qu'on bouge la souris.
 * Une TV arrivée par son adresse n'a pas cet état : rien ne s'affiche.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icone } from './ui/Icone.js';

const VISIBLE_MS = 6000;

export function AvecRetour({ children }: { children: ReactNode }): JSX.Element {
  const { t } = useTranslation();
  const location = useLocation();
  const vers = (location.state as { retour?: unknown } | null)?.retour;
  // Seulement une adresse interne connue.
  const retour =
    typeof vers === 'string' && (vers.startsWith('/admin') || vers === '/tv') ? vers : null;
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!retour) return;
    let minuteur = window.setTimeout(() => setVisible(false), VISIBLE_MS);
    const montrer = (): void => {
      setVisible(true);
      window.clearTimeout(minuteur);
      minuteur = window.setTimeout(() => setVisible(false), VISIBLE_MS);
    };
    window.addEventListener('pointerdown', montrer);
    window.addEventListener('pointermove', montrer);
    window.addEventListener('keydown', montrer);
    return () => {
      window.clearTimeout(minuteur);
      window.removeEventListener('pointerdown', montrer);
      window.removeEventListener('pointermove', montrer);
      window.removeEventListener('keydown', montrer);
    };
  }, [retour]);

  return (
    <>
      {children}
      {retour && (
        <Link
          to={retour}
          aria-hidden={!visible}
          tabIndex={visible ? 0 : -1}
          className={`fixed left-3 z-[70] inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-white/25 bg-black/60 px-4 text-base font-semibold text-white backdrop-blur transition-opacity duration-300 hover:bg-black/80 ${
            visible ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
        >
          <Icone nom="retour" />
          {retour.startsWith('/admin') ? t('common.retourTableauDeBord') : t('common.retour')}
        </Link>
      )}
    </>
  );
}
