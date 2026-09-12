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
// feat/telephone-au-style-tv — l'accueil du joueur prend les codes de la TV.
const CORAIL = '#FF5C4D';
const PANNEAU =
  'rounded-[20px] bg-[#191922] border border-white/[0.07] shadow-[0_18px_50px_rgba(0,0,0,0.5)]';

function BoutonPlein({
  children,
  ...rest
}: { children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      {...rest}
      className="w-full rounded-2xl px-4 py-3 font-bold text-[#0B0B0F] transition-transform active:scale-[0.98] disabled:opacity-40"
      style={{ backgroundColor: CORAIL }}
    >
      {children}
    </button>
  );
}

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
    <div className={`${PANNEAU} p-6`}>
      <header className="mb-6 text-center">
        <p
          className="mb-2 font-mono text-xs uppercase tracking-[0.24em]"
          style={{ color: CORAIL }}
        >
          {t('onboarding.eyebrow')}
        </p>
        <h2 className="font-display text-2xl leading-tight text-white">
          {t('onboarding.welcome')}
        </h2>
      </header>

      <p className="mb-6 text-center font-editorial italic text-white/60">
        {t('onboarding.intro')}
      </p>

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

      <div className="mb-6 rounded-2xl border border-white/12 bg-white/[0.05] p-4">
        <p className="mb-2 font-mono text-xs uppercase tracking-wider text-white/50">
          {t('onboarding.examplesLabel')}
        </p>
        <ul className="space-y-2">
          <li className="flex items-center gap-2">
            <span className="rounded-full border border-white/15 bg-white/[0.07] px-2.5 py-0.5 text-sm text-white/80">
              {t('onboarding.example1Said')}
            </span>
            <span className="text-white/40">→</span>
            <span className="rounded-full border border-[#4ade80]/40 bg-[#4ade80]/15 px-2.5 py-0.5 text-sm font-bold text-[#4ade80]">
              {t('onboarding.example1Score')}
            </span>
          </li>
          <li className="flex items-center gap-2">
            <span className="rounded-full border border-white/15 bg-white/[0.07] px-2.5 py-0.5 text-sm text-white/80">
              {t('onboarding.example2Said')}
            </span>
            <span className="text-white/40">→</span>
            <span
              className="rounded-full px-2.5 py-0.5 text-sm font-bold text-[#0B0B0F]"
              style={{ backgroundColor: CORAIL }}
            >
              {t('onboarding.example2Score')}
            </span>
          </li>
        </ul>
      </div>

      <BoutonPlein type="button" onClick={() => void onContinue()} disabled={busy}>
        {busy ? t('onboarding.requesting') : t('onboarding.cta')}
      </BoutonPlein>
      <p className="mt-3 text-center font-mono text-xs text-white/45">
        {t('onboarding.micConsent')}
      </p>
    </div>
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
    <div className={`${PANNEAU} p-5 text-center`}>
      <p className="mb-2 font-mono text-xs uppercase tracking-[0.24em]" style={{ color: CORAIL }}>
        {t('onboarding.welcomeBackEyebrow')}
      </p>
      <h2 className="mb-3 font-display text-2xl leading-tight text-white">
        {t('onboarding.welcomeBack')}
      </h2>
      <p className="mb-6 font-editorial italic text-white/60">{t('onboarding.condensedHint')}</p>

      <div className="space-y-2">
        <BoutonPlein type="button" onClick={() => void onContinue()} disabled={busy}>
          {busy ? t('onboarding.requesting') : t('onboarding.skipCta')}
        </BoutonPlein>
        {onShowFull && (
          <button
            type="button"
            className="w-full rounded-2xl border border-white/15 px-4 py-2.5 text-sm text-white/70 transition-colors hover:bg-white/[0.06] disabled:opacity-40"
            onClick={onShowFull}
            disabled={busy}
          >
            {t('onboarding.reviewTutorial')}
          </button>
        )}
      </div>
    </div>
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
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.06] text-white/80">
        {icon}
      </div>
      <div className="flex-1">
        <p className="mb-0.5 font-display text-base text-white">
          <span className="mr-1" style={{ color: CORAIL }}>
            {number}.
          </span>
          {title}
        </p>
        <p className="text-sm text-white/60">{body}</p>
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
