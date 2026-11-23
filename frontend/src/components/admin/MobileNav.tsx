/**
 * <MobileNav /> — navigation de l'espace admin sur téléphone (sous 768 px).
 *
 * La colonne latérale est cachée à cette largeur. Avant, la barre du bas
 * alignait toutes les entrées côte à côte : à neuf entrées, « Paramètres » et
 * « Compte » sortaient de l'écran, les libellés étaient coupés, et il n'y avait
 * AUCUN bouton de déconnexion ni choix de langue sur téléphone.
 *
 * fix/parcours-sans-impasse — une barre de quatre entrées au plus, puis
 * « Menu » : un panneau qui liste TOUTES les entrées (les mêmes que la colonne,
 * lues dans la même liste), la langue et la déconnexion.
 *
 * Au-dessus de 768 px, ce composant ne rend rien (md:hidden).
 */

import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/auth.js';
import { LanguageSwitch } from '../LanguageSwitch.js';
import { Icone } from '../ui/Icone.js';
import { entreesDuMenu, useDeconnexion, useRoleDuMenu, type NavItem } from './Sidebar.js';

/** Libellés courts de la barre : « Tableau de bord » n'y tient pas. */
const COURT: Partial<
  Record<NavItem['i18nKey'], 'navCourt.accueil' | 'navCourt.quiz' | 'navCourt.reserver'>
> = {
  'nav.dashboard': 'navCourt.accueil',
  'nav.quizz': 'navCourt.quiz',
  'nav.reserver': 'navCourt.reserver',
};

/** Entrées qui ont leur place dans la barre, dans cet ordre ; le reste est dans « Menu ». */
const DANS_LA_BARRE: Array<NavItem['i18nKey']> = [
  'nav.dashboard',
  'nav.quizz',
  'nav.arcade',
  'nav.reservations',
  'nav.reserver',
  'nav.library',
];

export function MobileNav(): JSX.Element {
  const { t } = useTranslation();
  const location = useLocation();
  const { user } = useAuthStore();
  const { isSuperAdmin, estProprietaire } = useRoleDuMenu();
  const { deconnexionEnCours, seDeconnecter } = useDeconnexion();
  const [ouvert, setOuvert] = useState(false);

  // Une page choisie dans le panneau : on le referme.
  useEffect(() => {
    setOuvert(false);
  }, [location.pathname]);

  const toutes = entreesDuMenu(isSuperAdmin, estProprietaire);
  const barre = DANS_LA_BARRE.map((cle) => toutes.find((e) => e.i18nKey === cle))
    .filter((e): e is NavItem => !!e)
    .slice(0, 4);

  const caseBarre = (actif: boolean): string =>
    `flex h-full min-h-[56px] w-full flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium leading-none transition-colors ${
      actif ? 'bg-cream-4 text-spritz' : 'text-ink'
    }`;
  const ligne = (actif: boolean): string =>
    `flex min-h-[52px] items-center gap-4 rounded-lg border-2 px-4 text-base font-medium ${
      actif
        ? 'border-spritz/40 bg-cream-4 text-spritz'
        : 'border-transparent text-ink active:bg-cream-3'
    }`;

  return (
    <>
      {ouvert && (
        <div
          id="menu-telephone"
          role="dialog"
          aria-modal="true"
          aria-label={t('navCourt.menu')}
          className="md:hidden fixed inset-0 z-40 flex flex-col bg-cream"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <div className="flex items-center justify-between border-b-2 border-hairline px-4 py-3">
            <p className="font-display text-2xl">{t('navCourt.menu')}</p>
            <button
              type="button"
              onClick={() => setOuvert(false)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border-2 border-hairline px-4 text-base font-medium"
            >
              <Icone nom="croix" />
              {t('common.close')}
            </button>
          </div>
          <nav
            className="flex-1 overflow-y-auto px-3 py-3 pb-[76px]"
            aria-label={t('navCourt.menu')}
          >
            <ul className="space-y-1">
              {toutes.map((e) => (
                <li key={e.to}>
                  <NavLink
                    to={e.to}
                    onClick={() => setOuvert(false)}
                    className={({ isActive }) => ligne(isActive)}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                      {e.icon}
                    </span>
                    <span>{t(e.i18nKey)}</span>
                  </NavLink>
                </li>
              ))}
              {isSuperAdmin && (
                <>
                  <li>
                    <NavLink
                      to="/admin/super-admin"
                      onClick={() => setOuvert(false)}
                      className={({ isActive }) => ligne(isActive)}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                        <Icone nom="etoile" />
                      </span>
                      <span>{t('admin.moderationNav')}</span>
                    </NavLink>
                  </li>
                  <li>
                    <NavLink
                      to="/admin/voice-analytics"
                      onClick={() => setOuvert(false)}
                      className={({ isActive }) => ligne(isActive)}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                        <Icone nom="micro" />
                      </span>
                      <span>Voice analytics</span>
                    </NavLink>
                  </li>
                </>
              )}
            </ul>
            <div className="mt-4 space-y-3 border-t-2 border-hairline px-1 pt-4">
              <LanguageSwitch className="w-full justify-center" />
              {user?.email && (
                <p className="truncate text-center font-mono text-xs text-ink-soft">{user.email}</p>
              )}
              <button
                type="button"
                onClick={() => void seDeconnecter()}
                disabled={deconnexionEnCours}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg border-2 border-hairline text-base font-medium disabled:opacity-50"
              >
                <Icone nom="sortie" />
                {t('common.signOut')}
              </button>
            </div>
          </nav>
        </div>
      )}

      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-[45] border-t-2 border-hairline bg-cream-2 shadow-pop-lg"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        aria-label="Navigation admin mobile"
      >
        <ul className="flex items-stretch">
          {barre.map((e) => (
            <li key={e.to} className="min-w-0 flex-1">
              <NavLink to={e.to} className={({ isActive }) => caseBarre(isActive && !ouvert)}>
                <span className="flex h-5 w-5 items-center justify-center text-lg" aria-hidden>
                  {e.icon}
                </span>
                <span className="max-w-full truncate">{t(COURT[e.i18nKey] ?? e.i18nKey)}</span>
              </NavLink>
            </li>
          ))}
          <li className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setOuvert((o) => !o)}
              aria-expanded={ouvert}
              aria-controls="menu-telephone"
              className={caseBarre(ouvert)}
            >
              <span className="flex h-5 w-5 items-center justify-center text-lg" aria-hidden>
                <Icone nom="menu" />
              </span>
              <span className="max-w-full truncate">{t('navCourt.menu')}</span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
