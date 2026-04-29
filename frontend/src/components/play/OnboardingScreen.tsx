/**
 * <OnboardingScreen /> — tutoriel buzz vocal pour les nouveaux joueurs.
 *
 * Affiché entre l'inscription (pseudo+équipe) et la salle d'attente.
 * Au clic "J'ai compris", on demande la permission micro via getUserMedia.
 * Si refusée, on bascule sur l'écran d'instructions (cf. MicPermissionErrorScreen).
 *
 * Si le joueur a déjà joué (hasPlayedBefore() === true) : version condensée
 * avec bouton "Skip" et "Revoir le tutoriel".
 */

import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, TitleHandwritten, Underline } from '../ui/index.js';

interface Props {
  /** L'utilisateur a déjà joué : version condensée. */
  condensed?: boolean;
  /** Demande de micro + appelle onGranted en cas de succès, onDenied sinon. */
  onContinue: () => void | Promise<void>;
  /** Bascule de "condensé" vers "complet" à la demande du joueur. */
  onShowFull?: () => void;
  /** True quand on est en train d'appeler getUserMedia. */
  busy?: boolean;
}

export function OnboardingScreen({ condensed, onContinue, onShowFull, busy }: Props): JSX.Element {
  if (condensed) {
    return <CondensedOnboarding onContinue={onContinue} onShowFull={onShowFull} busy={busy} />;
  }
  return <FullOnboarding onContinue={onContinue} busy={busy} />;
}

function FullOnboarding({
  onContinue,
  busy,
}: {
  onContinue: () => void | Promise<void>;
  busy?: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <Card size="lg" className="bg-white">
      <header className="text-center mb-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-2">
          {t('onboarding.eyebrow')}
        </p>
        <TitleHandwritten as="h2">
          <Underline>{t('onboarding.welcome')}</Underline>
        </TitleHandwritten>
      </header>

      <p className="font-editorial italic text-ink-2 text-center mb-6">{t('onboarding.intro')}</p>

      <ol className="space-y-4 mb-6">
        <Step
          icon={<BuzzerIcon />}
          number="1"
          title={t('onboarding.step1Title')}
          body={t('onboarding.step1Body')}
        />
        <Step
          icon={<MicIcon />}
          number="2"
          title={t('onboarding.step2Title')}
          body={t('onboarding.step2Body')}
        />
        <Step
          icon={<StarIcon />}
          number="3"
          title={t('onboarding.step3Title')}
          body={t('onboarding.step3Body')}
        />
      </ol>

      <div className="border-2 border-ink rounded-lg bg-cream-2 p-4 mb-6">
        <p className="text-xs font-mono uppercase tracking-wider text-ink-soft mb-2">
          {t('onboarding.examplesLabel')}
        </p>
        <ul className="space-y-2">
          <li className="flex items-center gap-2">
            <Badge tone="cream" tilt={-1}>
              {t('onboarding.example1Said')}
            </Badge>
            <span className="text-ink-soft">→</span>
            <Badge tone="basil" tilt={1}>
              {t('onboarding.example1Score')}
            </Badge>
          </li>
          <li className="flex items-center gap-2">
            <Badge tone="cream" tilt={-1}>
              {t('onboarding.example2Said')}
            </Badge>
            <span className="text-ink-soft">→</span>
            <Badge tone="spritz" tilt={1}>
              {t('onboarding.example2Score')}
            </Badge>
          </li>
        </ul>
      </div>

      <Button
        type="button"
        size="lg"
        className="w-full"
        onClick={() => void onContinue()}
        disabled={busy}
      >
        {busy ? t('onboarding.requesting') : t('onboarding.cta')}
      </Button>
      <p className="font-mono text-xs text-ink-soft mt-3 text-center">
        {t('onboarding.micConsent')}
      </p>
    </Card>
  );
}

function CondensedOnboarding({
  onContinue,
  onShowFull,
  busy,
}: {
  onContinue: () => void | Promise<void>;
  onShowFull?: () => void;
  busy?: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <Card size="md" tone="cream" className="text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-2">
        {t('onboarding.welcomeBackEyebrow')}
      </p>
      <TitleHandwritten as="h2" className="mb-3">
        {t('onboarding.welcomeBack')}
      </TitleHandwritten>
      <p className="font-editorial italic text-ink-2 mb-6">{t('onboarding.condensedHint')}</p>

      <div className="space-y-2">
        <Button size="lg" className="w-full" onClick={() => void onContinue()} disabled={busy}>
          {busy ? t('onboarding.requesting') : t('onboarding.skipCta')}
        </Button>
        {onShowFull && (
          <Button variant="ghost" size="sm" className="w-full" onClick={onShowFull} disabled={busy}>
            {t('onboarding.reviewTutorial')}
          </Button>
        )}
      </div>
    </Card>
  );
}

function Step({
  icon,
  number,
  title,
  body,
}: {
  icon: JSX.Element;
  number: string;
  title: string;
  body: string;
}): JSX.Element {
  return (
    <li className="flex items-start gap-3">
      <div className="w-12 h-12 shrink-0 border-2 border-ink rounded bg-cream-2 flex items-center justify-center text-ink">
        {icon}
      </div>
      <div className="flex-1">
        <p className="font-display text-base mb-0.5">
          <span className="text-spritz-deep mr-1">{number}.</span>
          {title}
        </p>
        <p className="text-sm text-ink-soft">{body}</p>
      </div>
    </li>
  );
}

// ── Icons SVG inline (Pop Cocktail, currentColor) ──────────────────────────

function BuzzerIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
      <circle cx="16" cy="18" r="9" fill="#ee6c2a" stroke="#1a1410" strokeWidth="2" />
      <circle cx="16" cy="18" r="4" fill="#c84e15" stroke="#1a1410" strokeWidth="1.5" />
      <path d="M9 9 L13 13" stroke="#1a1410" strokeWidth="2" strokeLinecap="round" />
      <path d="M23 9 L19 13" stroke="#1a1410" strokeWidth="2" strokeLinecap="round" />
      <path d="M16 5 L16 10" stroke="#1a1410" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function MicIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
      <rect
        x="12"
        y="6"
        width="8"
        height="16"
        rx="4"
        fill="#4a8b3f"
        stroke="#1a1410"
        strokeWidth="2"
      />
      <path
        d="M9 16 a7 7 0 0 0 14 0"
        fill="none"
        stroke="#1a1410"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="16"
        y1="23"
        x2="16"
        y2="28"
        stroke="#1a1410"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="12"
        y1="28"
        x2="20"
        y2="28"
        stroke="#1a1410"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StarIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
      <polygon
        points="16,4 19,12 28,12 21,18 23,27 16,22 9,27 11,18 4,12 13,12"
        fill="#e8c547"
        stroke="#1a1410"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
