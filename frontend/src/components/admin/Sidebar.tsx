/**
 * <Sidebar /> — navigation latérale de l'espace admin.
 *
 * 5 entrées (dashboard, tracks, quizz, settings, account) + LanguageSwitch
 * + bouton de déconnexion en bas.
 *
 * Sur mobile : peut être masquée puis ré-affichée via toggle (V2).
 * V1 : largeur fixe 240px, toujours visible sur ≥768px.
 */

import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/auth.js';
import { LanguageSwitch } from '../LanguageSwitch.js';
import { Button, MultiColorBar, TitleHandwritten } from '../ui/index.js';

interface NavItem {
  to: string;
  i18nKey: 'nav.dashboard' | 'nav.tracks' | 'nav.quizz' | 'nav.settings' | 'nav.account';
  icon: JSX.Element;
}

const NAV: NavItem[] = [
  { to: '/admin/dashboard', i18nKey: 'nav.dashboard', icon: <DashIcon /> },
  { to: '/admin/tracks', i18nKey: 'nav.tracks', icon: <DiscIcon /> },
  { to: '/admin/quizz', i18nKey: 'nav.quizz', icon: <BulbIcon /> },
  { to: '/admin/settings', i18nKey: 'nav.settings', icon: <CogIcon /> },
  { to: '/admin/account', i18nKey: 'nav.account', icon: <UserIcon /> },
];

export function Sidebar(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, signOut } = useAuthStore();

  const handleSignOut = async (): Promise<void> => {
    await signOut();
    navigate('/', { replace: true });
  };

  return (
    <aside className="hidden md:flex flex-col w-60 shrink-0 bg-cream-2 border-r-2 border-ink min-h-screen sticky top-0">
      <div className="px-5 pt-6 pb-4 border-b-2 border-ink relative">
        <div className="absolute -bottom-0.5 left-5 w-12 h-1.5 bg-spritz" />
        <TitleHandwritten as="h3" className="text-2xl">
          {t('common.brand')}
        </TitleHandwritten>
      </div>

      <nav className="flex-1 px-3 py-5 space-y-1">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded border-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-ink text-cream border-ink shadow-pop-sm'
                  : 'border-transparent text-ink hover:bg-cream hover:border-ink'
              }`
            }
          >
            <span className="w-5 h-5 shrink-0 flex items-center justify-center">{item.icon}</span>
            <span>{t(item.i18nKey)}</span>
          </NavLink>
        ))}
      </nav>

      <div className="px-4 pb-5 pt-4 border-t-2 border-ink space-y-3">
        <LanguageSwitch className="w-full justify-center" />
        {user?.email && (
          <p className="font-mono text-[10px] text-ink-soft truncate" title={user.email}>
            {user.email}
          </p>
        )}
        <Button variant="ghost" size="sm" onClick={() => void handleSignOut()} className="w-full">
          {t('common.signOut')}
        </Button>
      </div>

      <MultiColorBar height="sm" />
    </aside>
  );
}

// ───── Icons (inline SVG, héritage couleur via currentColor) ────────────────

function DashIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="3" y="3" width="6" height="8" rx="1" />
      <rect x="3" y="13" width="6" height="4" rx="1" />
      <rect x="11" y="3" width="6" height="4" rx="1" />
      <rect x="11" y="9" width="6" height="8" rx="1" />
    </svg>
  );
}

function DiscIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="10" cy="10" r="7" />
      <circle cx="10" cy="10" r="2" />
    </svg>
  );
}

function BulbIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M10 2a5 5 0 0 0-3 9v2h6v-2a5 5 0 0 0-3-9Z" />
      <path d="M8 16h4" />
      <path d="M9 18h2" />
    </svg>
  );
}

function CogIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="10" cy="10" r="2.5" />
      <path
        d="M10 2v3M10 15v3M2 10h3M15 10h3M4.5 4.5l2 2M13.5 13.5l2 2M4.5 15.5l2-2M13.5 6.5l2-2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function UserIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="10" cy="7" r="3" />
      <path d="M3 17c1-3 4-5 7-5s6 2 7 5" strokeLinecap="round" />
    </svg>
  );
}
