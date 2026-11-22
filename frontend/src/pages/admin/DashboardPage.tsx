/**
 * /admin/dashboard — point d'entrée de l'admin après login.
 *
 * Affiche "Bienvenue dans <establishment.name>" + 2 grandes cartes :
 *   - Tutti Tracks (illustration disque vinyle)
 *   - Tutti Quizz (illustration ampoule)
 *
 * INSTRUMENTATION TEMPORAIRE (Sujet 2 PR fix/buzz-size-and-dashboard-empty) :
 * logs `[DBG dashboard]` + ErrorBoundary capturent le bug "page reste vide
 * après navigate depuis /host". À retirer après diagnostic confirmé.
 */

import { ProchainePartie } from '../../components/admin/ProchainePartie.js';
import { PartieEnCours } from '../../components/admin/PartieEnCours.js';
import { ContactProCard } from '../../components/admin/ContactProCard.js';
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useEstablishment } from './AdminLayout.js';
import { Button, Card, TitleHandwritten, Swirl, Underline } from '../../components/ui/index.js';

// ───── DEBUG : ErrorBoundary temporaire ──────────────────────────────────
// À retirer après confirmation du diagnostic.
interface DebugBoundaryState {
  error: Error | null;
}
class DebugBoundary extends Component<{ children: ReactNode }, DebugBoundaryState> {
  state: DebugBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): DebugBoundaryState {
    return { error };
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    console.error('[DBG dashboard] CRASH', error, info);
  }
  render(): ReactNode {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, background: '#fee', color: '#900', border: '2px solid #900' }}>
          <strong>[DBG dashboard] Crash:</strong> {String(this.state.error)}
        </div>
      );
    }
    return this.props.children;
  }
}

export function DashboardPage(): JSX.Element {
  const { t } = useTranslation();
  const { establishment, loading, error } = useEstablishment();

  // Banner de confirmation après actions terminales (Fin de partie depuis
  // /host). Le query param ?notice=session-ended est posé par HostPage avant
  // navigate(). On l'affiche 4s puis on nettoie l'URL.
  //
  // IMPORTANT — les deps de l'effect contiennent UNIQUEMENT noticeKey. Inclure
  // searchParams ou setSearchParams faisait re-déclencher l'effect quand on
  // nettoyait l'URL, créant un cycle qui pouvait coïncider avec le mount
  // d'AdminLayout (Issue 1 : page reste vide après navigate).
  const [searchParams, setSearchParams] = useSearchParams();
  const noticeKey = searchParams.get('notice');
  const [noticeVisible, setNoticeVisible] = useState(Boolean(noticeKey));
  const setSearchParamsRef = useRef(setSearchParams);
  setSearchParamsRef.current = setSearchParams;

  useEffect(() => {
    if (!noticeKey) return;
    setNoticeVisible(true);
    const t1 = window.setTimeout(() => setNoticeVisible(false), 4000);
    const t2 = window.setTimeout(() => {
      // Nettoyage URL via ref : pas dans les deps pour éviter le cycle.
      setSearchParamsRef.current(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('notice');
          return next;
        },
        { replace: true },
      );
    }, 4500);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [noticeKey]);

  // Render structure : on rend toujours le wrapper + le banner notice, même
  // pendant le loading de l'establishment, pour que le toast soit visible
  // immédiatement après navigate (avant la fin du fetch /api/establishment).
  // Le contenu principal (header + cards) ne montre que quand establishment OK.
  return (
    <DebugBoundary>
      <div className="max-w-5xl mx-auto">
        {/* Banner de notice (toujours rendu, indépendant du loading establishment). */}
        {noticeKey === 'session-ended' && noticeVisible && (
          <div
            role="status"
            className="mb-6 px-4 py-3 border-2 border-basil bg-basil/10 text-basil-deep rounded-lg flex items-center gap-3 animate-fade-in"
          >
            <span className="text-2xl" aria-hidden>
              ✅
            </span>
            <span className="font-medium">{t('dashboard.noticeSessionEnded')}</span>
          </div>
        )}
        {noticeKey === 'session-cancelled' && noticeVisible && (
          <div
            role="status"
            className="mb-6 px-4 py-3 border-2 border-spritz bg-spritz/10 text-spritz-deep rounded-lg flex items-center gap-3 animate-fade-in"
          >
            <span className="text-2xl" aria-hidden>
              ↩️
            </span>
            <span className="font-medium">{t('dashboard.noticeSessionCancelled')}</span>
          </div>
        )}

        {error && (
          <p role="alert" className="text-raspberry mb-4">
            {t('common.error')} : {error}
          </p>
        )}

        {(loading || !establishment) && (
          <p className="font-mono text-ink-soft animate-fade-in">{t('common.loading')}</p>
        )}

        {establishment && <DashboardContent establishment={establishment} />}
      </div>
    </DebugBoundary>
  );
}

interface DashboardContentProps {
  // Pas de prop `t` typé : passer le TFunction de react-i18next à travers
  // une boundary de component créait une instantiation infinie côté TS
  // (TS2589). useTranslation est appelé directement dans DashboardContent.
  establishment: NonNullable<ReturnType<typeof useEstablishment>['establishment']>;
}

function DashboardContent({ establishment }: DashboardContentProps): JSX.Element {
  const { t } = useTranslation();
  // feat/granular-tracks-quizz-access — récup flags via getMe au mount
  // (existing useEstablishment context fournit l'establishment mais pas
  // les flags de permission ; on appelle getMe direct ici).
  const [canUseTracks, setCanUseTracks] = useState(true);
  const [canUseQuizz, setCanUseQuizz] = useState(true);
  // feat/back-office-en-familles — l'arcade est en test : seul le
  // propriétaire du compte voit sa carte (inconnu au départ = cachée).
  const [estProprietaire, setEstProprietaire] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void import('../../lib/me.js').then(({ getMe }) =>
      getMe()
        .then((me) => {
          if (cancelled) return;
          setCanUseTracks(me.can_use_tracks);
          setCanUseQuizz(me.can_use_quizz);
          setEstProprietaire(me.role === 'OWNER' || me.isSuperAdmin);
        })
        .catch(() => {
          /* fallback : laisse true (rétro-compat) */
        }),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  const noAccess = !canUseTracks && !canUseQuizz;
  return (
    <>
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
        <div className="flex items-center gap-2 flex-wrap">
          {/* Feature 3 — bouton "Écran TV" global avec workspaceId en param URL
              pour fonctionner cross-browser/profil (pas dépendant des cookies
              admin). Le polling /api/workspace/screen-state/:workspaceId lit
              la DB et calcule l'état déterministe. */}
          {/* feat/deux-cartes — Thomas : « Écran TV doit être Écran joueurs, et
              un vrai bouton avec une tête de bouton ». Fini le lien souligné. */}
          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={() =>
              window.open(
                `/screen?workspace=${encodeURIComponent(establishment.workspace_id)}`,
                '_blank',
                'noopener',
              )
            }
          >
            📺 {t('dashboard.openTvScreen')}
          </Button>
          {/* feat/deux-cartes — le bouton « Nouvelle session » quitte l'en-tête :
              on lance depuis les cartes Tutti Blind Test / Tutti Quizz. */}
        </div>
      </header>

      {/* fix/partie-tuee-en-se-connectant — la partie en cours d'abord. */}
      <PartieEnCours className="mb-6" />

      {/* feat/parcours-client-simplifie — le jour J : un clic, la console. */}
      <ProchainePartie />

      {noAccess && (
        <Card tone="cream" size="lg" className="text-center mb-6 border-raspberry">
          <p className="text-3xl mb-2" aria-hidden>
            🚫
          </p>
          <p className="font-display text-xl mb-2">{t('dashboard.noAccessTitle')}</p>
          <p className="font-editorial italic text-ink-2">{t('dashboard.noAccessHint')}</p>
        </Card>
      )}

      {/* feat/deux-cartes — Thomas : « il faut le bouton Tutti Quizz et Tutti
          Blind Test, mais au lieu de marquer lancer playlist on utilise le
          bouton Lancer nouvelle session ». Les deux cartes mènent au wizard de
          session ; la playlist se choisit ensuite. Visibles par tous, clients
          compris : c'est LEUR point d'entrée. */}
      {/* feat/back-office-en-familles — Thomas, 22/11 : « le back-office où on
          a accès aux quiz et autres, il faut remettre ça en propre ». Une carte
          par famille de jeu : blind test, blind test simple, quiz, jeux de
          salon, et l'arcade (en test, propriétaire seul). */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <GameCard
          to={canUseTracks ? '/admin/sessions/new' : null}
          tone="spritz"
          icon={<VinylIllustration />}
          title={t('dashboard.tracksTitle')}
          tagline={t('dashboard.tracksTagline')}
          description={t('dashboard.tracksDescription')}
          cta={t('dashboard.launchNewSession')}
          disabled={!canUseTracks}
          disabledTooltip={t('dashboard.accessForbidden')}
        />
        <GameCard
          to={canUseQuizz ? '/admin/sessions/new?type=quizz&famille=blind_test' : null}
          tone="lemon"
          icon={<ExtraitIllustration />}
          title={t('dashboard.simpleTitle')}
          tagline={t('dashboard.simpleTagline')}
          description={t('dashboard.simpleDescription')}
          cta={t('dashboard.launchNewSession')}
          disabled={!canUseQuizz}
          disabledTooltip={t('dashboard.accessForbidden')}
        />
        <GameCard
          to={canUseQuizz ? '/admin/sessions/new?type=quizz' : null}
          tone="basil"
          icon={<BulbIllustration />}
          title={t('dashboard.quizzTitle')}
          tagline={t('dashboard.quizzTagline')}
          description={t('dashboard.quizzDescription')}
          cta={t('dashboard.launchNewSession')}
          disabled={!canUseQuizz}
          disabledTooltip={t('dashboard.accessForbidden')}
        />
        <GameCard
          to={canUseQuizz ? '/admin/sessions/new?type=quizz&famille=jeux' : null}
          tone="plum"
          icon={<SalonIllustration />}
          title={t('dashboard.salonTitle')}
          tagline={t('dashboard.salonTagline')}
          description={t('dashboard.salonDescription')}
          cta={t('dashboard.launchNewSession')}
          disabled={!canUseQuizz}
          disabledTooltip={t('dashboard.accessForbidden')}
        />
        {estProprietaire && (
          <GameCard
            to="/admin/arcade"
            tone="cream"
            icon={<ArcadeIllustration />}
            title={t('dashboard.arcadeTitle')}
            tagline={t('dashboard.arcadeTagline')}
            description={t('dashboard.arcadeDescription')}
            cta={t('dashboard.arcadeCta')}
          />
        )}
      </div>

      {/* feat/contact-pro — les professionnels peuvent nous écrire. */}
      <div className="mt-8">
        <ContactProCard />
      </div>
    </>
  );
}

interface GameCardProps {
  to: string | null;
  tone: 'spritz' | 'basil' | 'lemon' | 'plum' | 'cream';
  icon: JSX.Element;
  title: string;
  tagline: string;
  description: string;
  cta: string;
  disabled?: boolean;
  disabledTooltip?: string;
}

function GameCard({
  to,
  tone,
  icon,
  title,
  tagline,
  description,
  cta,
  disabled,
  disabledTooltip,
}: GameCardProps): JSX.Element {
  const inner = (
    <Card
      tone={tone}
      size="lg"
      className={`h-full transition-transform ${
        disabled
          ? 'opacity-50 grayscale cursor-not-allowed'
          : 'group-hover:-translate-y-1 group-hover:shadow-pop-xl'
      }`}
    >
      <div className="flex justify-center mb-4 text-ink">{icon}</div>
      <TitleHandwritten as="h2" className="text-center mb-2">
        <Underline>{title}</Underline>
      </TitleHandwritten>
      <p className="font-editorial italic text-center text-ink-2 mb-3">{tagline}</p>
      <p className="text-sm text-ink-soft text-center mb-5">{description}</p>
      <div className="flex justify-center">
        <Button variant={tone === 'spritz' ? 'primary' : 'secondary'} size="md" disabled={disabled}>
          {disabled ? `🚫 ${cta}` : `${cta} →`}
        </Button>
      </div>
    </Card>
  );
  if (disabled || !to) {
    return (
      <div className="group block" title={disabledTooltip ?? ''} aria-disabled="true">
        {inner}
      </div>
    );
  }
  return (
    <Link to={to} className="group block">
      {inner}
    </Link>
  );
}

// ───── Illustrations Pop Cocktail ──────────────────────────────────────────

function VinylIllustration(): JSX.Element {
  return (
    <svg viewBox="0 0 64 64" className="w-16 h-16" aria-hidden>
      <circle cx="32" cy="32" r="28" fill="#0B0B0F" stroke="#FF5C4D" strokeWidth="3" />
      <circle cx="32" cy="32" r="18" fill="none" stroke="#3a3a48" strokeWidth="2" />
      <circle cx="32" cy="32" r="9" fill="#FF5C4D" />
      <circle cx="32" cy="32" r="2.5" fill="#0B0B0F" />
    </svg>
  );
}

/** Blind test simple : un disque et l'extrait de 30 secondes. */
function ExtraitIllustration(): JSX.Element {
  return (
    <svg viewBox="0 0 64 64" className="w-16 h-16" aria-hidden>
      <circle cx="32" cy="32" r="28" fill="#0B0B0F" stroke="#e8c547" strokeWidth="3" />
      <circle cx="32" cy="32" r="18" fill="#e8c547" />
      <text x="32" y="38" textAnchor="middle" fontSize="16" fontWeight="700" fill="#0B0B0F" fontFamily="monospace">
        30
      </text>
    </svg>
  );
}

/** Jeux de salon : un crayon et une bulle. */
function SalonIllustration(): JSX.Element {
  return (
    <svg viewBox="0 0 64 64" className="w-16 h-16" aria-hidden>
      <path
        d="M10 14h34a6 6 0 0 1 6 6v16a6 6 0 0 1-6 6H26l-10 9v-9h-6a6 6 0 0 1-6-6V20a6 6 0 0 1 6-6z"
        fill="#fff"
        stroke="#1a1410"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path d="M40 46l14-14 6 6-14 14-8 2z" fill="#FF5C4D" stroke="#1a1410" strokeWidth="3" strokeLinejoin="round" />
      <path d="M16 24h20M16 32h12" stroke="#1a1410" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Arcade : une manette. */
function ArcadeIllustration(): JSX.Element {
  return (
    <svg viewBox="0 0 64 64" className="w-16 h-16" aria-hidden>
      <rect x="6" y="20" width="52" height="28" rx="14" fill="#0B0B0F" stroke="#1a1410" strokeWidth="3" />
      <path d="M18 34h10M23 29v10" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <circle cx="42" cy="31" r="3.5" fill="#FF5C4D" />
      <circle cx="49" cy="38" r="3.5" fill="#3FB47A" />
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
