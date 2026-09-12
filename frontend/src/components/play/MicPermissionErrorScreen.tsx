/**
 * <MicPermissionErrorScreen /> — affiché quand le joueur a refusé l'accès micro.
 * Donne des instructions de réautorisation adaptées à sa plateforme.
 */

import { useTranslation } from 'react-i18next';
import { detectPlatform, type Platform } from '../../lib/onboarding.js';

// feat/telephone-au-style-tv — l'écran joueur a pris les codes de la TV.
const CORAIL = '#FF5C4D';
const PANNEAU =
  'rounded-[20px] bg-[#191922] border border-white/[0.07] shadow-[0_18px_50px_rgba(0,0,0,0.5)]';

interface Props {
  onRetry: () => void | Promise<void>;
  busy?: boolean;
}

export function MicPermissionErrorScreen({ onRetry, busy }: Props): JSX.Element {
  const { t } = useTranslation();
  const platform: Platform = detectPlatform();
  const instructions =
    platform === 'ios'
      ? t('onboarding.micErrorIos')
      : platform === 'android'
        ? t('onboarding.micErrorAndroid')
        : t('onboarding.micErrorOther');

  return (
    <div className={`${PANNEAU} p-6`}>
      <p
        className="mb-2 text-center font-mono text-xs uppercase tracking-[0.24em]"
        style={{ color: CORAIL }}
      >
        {t('onboarding.micErrorEyebrow')}
      </p>
      <h2 className="mb-3 text-center font-display text-2xl leading-tight text-white">
        {t('onboarding.micErrorTitle')}
      </h2>
      <p className="mb-5 text-center font-editorial italic text-white/60">
        {t('onboarding.micErrorBody')}
      </p>

      <div className="mb-5 rounded-2xl border border-white/12 bg-white/[0.05] p-4">
        <p className="mb-2 font-mono text-xs uppercase tracking-wider text-white/50">
          {platform === 'ios'
            ? 'iOS Safari'
            : platform === 'android'
              ? 'Chrome Android'
              : t('onboarding.micErrorOtherLabel')}
        </p>
        <p className="whitespace-pre-line text-sm text-white/75">{instructions}</p>
      </div>

      <button
        type="button"
        className="w-full rounded-2xl px-4 py-3 font-bold text-[#0B0B0F] transition-transform active:scale-[0.98] disabled:opacity-40"
        style={{ backgroundColor: CORAIL }}
        onClick={() => void onRetry()}
        disabled={busy}
      >
        {busy ? t('onboarding.requesting') : t('onboarding.micErrorRetry')}
      </button>
    </div>
  );
}
