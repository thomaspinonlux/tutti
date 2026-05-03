/**
 * /admin/dashboard — point d'entrée de l'admin après login.
 *
 * Affiche "Bienvenue dans <establishment.name>" + 2 grandes cartes :
 *   - Tutti Tracks (illustration disque vinyle)
 *   - Tutti Quizz (illustration ampoule)
 */

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useEstablishment } from './AdminLayout.js';
import { Button, Card, TitleHandwritten, Swirl, Underline } from '../../components/ui/index.js';
import { GettingStartedChecklist } from '../../components/admin/dashboard/GettingStartedChecklist.js';

export function DashboardPage(): JSX.Element {
  const { t } = useTranslation();
  const { establishment, loading, error } = useEstablishment();

  if (error) {
    return (
      <p role="alert" className="text-raspberry">
        {t('common.error')} : {error}
      </p>
    );
  }
  if (loading || !establishment) {
    return <p className="font-mono text-ink-soft animate-fade-in">{t('common.loading')}</p>;
  }

  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-8 flex items-start justify-between flex-wrap gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-3">
            {t('dashboard.welcomeTo')}
          </p>
          <TitleHandwritten as="h1" className="mb-4">
            {/* Pivot B2C — on n'affiche plus le nom d'établissement.
                Brand Tutti en titre. Si l'utilisateur veut personnaliser
                ses parties, il peut nommer chaque session individuellement. */}
            <Swirl>{t('common.brand')}</Swirl>
          </TitleHandwritten>
          <p className="font-editorial italic text-lg text-ink-2">{t('dashboard.chooseGame')}</p>
        </div>
        <Link to="/admin/sessions/new">
          <Button size="lg">▶ {t('dashboard.newSession')}</Button>
        </Link>
      </header>

      <GettingStartedChecklist />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <GameCard
          to="/admin/tracks"
          tone="spritz"
          icon={<VinylIllustration />}
          title={t('dashboard.tracksTitle')}
          tagline={t('dashboard.tracksTagline')}
          description={t('dashboard.tracksDescription')}
          cta={t('dashboard.tracksCta')}
        />
        <GameCard
          to="/admin/quizz"
          tone="basil"
          icon={<BulbIllustration />}
          title={t('dashboard.quizzTitle')}
          tagline={t('dashboard.quizzTagline')}
          description={t('dashboard.quizzDescription')}
          cta={t('dashboard.quizzCta')}
        />
      </div>
    </div>
  );
}

interface GameCardProps {
  to: string;
  tone: 'spritz' | 'basil';
  icon: JSX.Element;
  title: string;
  tagline: string;
  description: string;
  cta: string;
}

function GameCard({
  to,
  tone,
  icon,
  title,
  tagline,
  description,
  cta,
}: GameCardProps): JSX.Element {
  return (
    <Link to={to} className="group block">
      <Card
        tone={tone}
        size="lg"
        className="h-full transition-transform group-hover:-translate-y-1 group-hover:shadow-pop-xl"
      >
        <div className="flex justify-center mb-4 text-ink">{icon}</div>
        <TitleHandwritten as="h2" className="text-center mb-2">
          <Underline>{title}</Underline>
        </TitleHandwritten>
        <p className="font-editorial italic text-center text-ink-2 mb-3">{tagline}</p>
        <p className="text-sm text-ink-soft text-center mb-5">{description}</p>
        <div className="flex justify-center">
          <Button variant={tone === 'spritz' ? 'primary' : 'secondary'} size="md">
            {cta} →
          </Button>
        </div>
      </Card>
    </Link>
  );
}

// ───── Illustrations Pop Cocktail ──────────────────────────────────────────

function VinylIllustration(): JSX.Element {
  return (
    <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden>
      <circle cx="60" cy="60" r="56" fill="#1a1410" stroke="#1a1410" strokeWidth="2" />
      <circle cx="60" cy="60" r="42" fill="none" stroke="#3d2f24" strokeWidth="0.5" />
      <circle cx="60" cy="60" r="34" fill="none" stroke="#3d2f24" strokeWidth="0.5" />
      <circle cx="60" cy="60" r="26" fill="none" stroke="#3d2f24" strokeWidth="0.5" />
      <circle cx="60" cy="60" r="18" fill="#ee6c2a" stroke="#1a1410" strokeWidth="2" />
      <circle cx="60" cy="60" r="3" fill="#1a1410" />
      <path d="M82 40 L92 28" stroke="#c8336e" strokeWidth="3" strokeLinecap="round" />
      <circle cx="92" cy="28" r="3" fill="#c8336e" />
    </svg>
  );
}

function BulbIllustration(): JSX.Element {
  return (
    <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden>
      <path
        d="M60 18c-15 0-26 11-26 26 0 10 5 18 13 23v8c0 2 2 4 4 4h18c2 0 4-2 4-4v-8c8-5 13-13 13-23 0-15-11-26-26-26z"
        fill="#e8c547"
        stroke="#1a1410"
        strokeWidth="3"
      />
      <rect x="50" y="86" width="20" height="6" fill="#6b5443" stroke="#1a1410" strokeWidth="2" />
      <rect x="52" y="94" width="16" height="6" fill="#6b5443" stroke="#1a1410" strokeWidth="2" />
      <line
        x1="56"
        y1="100"
        x2="64"
        y2="106"
        stroke="#1a1410"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M60 30 L60 50 M52 50 L60 60 L68 50"
        stroke="#1a1410"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M30 22 l6 6" stroke="#ee6c2a" strokeWidth="2" strokeLinecap="round" />
      <path d="M90 22 l-6 6" stroke="#ee6c2a" strokeWidth="2" strokeLinecap="round" />
      <path d="M22 50 h6" stroke="#ee6c2a" strokeWidth="2" strokeLinecap="round" />
      <path d="M92 50 h6" stroke="#ee6c2a" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
