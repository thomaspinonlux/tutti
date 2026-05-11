/**
 * <MobileNav /> — Bug 2 — barre de nav admin mobile (sub-md).
 *
 * Sidebar latérale est cachée < md (`hidden md:flex`). Sur mobile on
 * affiche une nav bottom-fixed avec icônes + labels courts. Inclut une
 * entrée Super admin si applicable.
 *
 * Au-dessus de md, ce composant ne rend rien (md:hidden).
 */

import { useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getMe } from '../../lib/me.js';

interface NavEntry {
  to: string;
  label: string;
  icon: ReactNode;
}

export function MobileNav(): JSX.Element {
  const { t } = useTranslation();
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    void getMe()
      .then((me) => setIsSuperAdmin(me.isSuperAdmin))
      .catch(() => {
        /* ignore */
      });
  }, []);

  const entries: NavEntry[] = [
    { to: '/admin/dashboard', label: t('nav.dashboard'), icon: '🏠' },
    { to: '/admin/tracks', label: t('nav.tracks'), icon: '🎵' },
    { to: '/admin/quizz', label: t('nav.quizz'), icon: '💡' },
    { to: '/admin/settings', label: t('nav.settings'), icon: '⚙️' },
    { to: '/admin/account', label: t('nav.account'), icon: '👤' },
  ];
  if (isSuperAdmin) {
    // fix/admin-users-integration — Users + Modération exposés en mobile aussi.
    entries.push({ to: '/admin/users', label: t('nav.users'), icon: '👥' });
    entries.push({ to: '/admin/super-admin', label: t('admin.moderationNav'), icon: '★' });
  }

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-cream-2 border-t-2 border-ink shadow-pop-lg"
      aria-label="Navigation admin mobile"
    >
      <ul className="flex justify-around items-stretch overflow-x-auto">
        {entries.map((e) => (
          <li key={e.to} className="flex-1 min-w-[60px]">
            <NavLink
              to={e.to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 px-2 py-2 text-[10px] font-mono uppercase tracking-wider transition-colors ${
                  isActive ? 'bg-ink text-cream' : 'text-ink hover:bg-cream-3'
                }`
              }
            >
              <span className="text-base" aria-hidden>
                {e.icon}
              </span>
              <span className="truncate max-w-full">{e.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
