/**
 * <AvecRetour /> — fix/parcours-sans-impasse
 *
 * L'écran des joueurs (/screen) est une page plein écran, sans menu : c'est ce
 * qu'on veut sur la TV. Mais ouvert DEPUIS le tableau de bord sur un iPad ou un
 * téléphone, il remplace le back-office et rien ne permettait d'en sortir.
 *
 * La page d'origine passe son adresse dans l'état de navigation
 * (`navigate(url, { state: { retour: '/admin/dashboard' } })`) : on affiche
 * alors un bouton de retour, discret, par-dessus l'écran. Une TV qui rejoint
 * par son code n'a pas cet état : rien ne s'affiche chez elle.
 */
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icone } from './ui/Icone.js';

export function AvecRetour({ children }: { children: ReactNode }): JSX.Element {
  const { t } = useTranslation();
  const location = useLocation();
  const vers = (location.state as { retour?: unknown } | null)?.retour;
  // Seulement une adresse interne du back-office.
  const retour = typeof vers === 'string' && vers.startsWith('/admin') ? vers : null;
  return (
    <>
      {children}
      {retour && (
        <Link
          to={retour}
          className="fixed left-3 z-[70] inline-flex items-center gap-2 rounded-lg border border-white/25 bg-black/60 px-4 py-2.5 text-base font-semibold text-white backdrop-blur hover:bg-black/80"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
        >
          <Icone nom="retour" />
          {t('common.retourTableauDeBord')}
        </Link>
      )}
    </>
  );
}
