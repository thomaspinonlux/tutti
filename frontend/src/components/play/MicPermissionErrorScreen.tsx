/**
 * <MicPermissionErrorScreen /> — affiché quand le joueur a refusé l'accès micro.
 * Donne des instructions de réautorisation adaptées à sa plateforme.
 */

import { useTranslation } from 'react-i18next';
import { Button, Card, TitleHandwritten, Underline } from '../ui/index.js';
import { detectPlatform, type Platform } from '../../lib/onboarding.js';

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
    <Card size="lg" tone="raspberry">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-raspberry-deep mb-2 text-center">
        {t('onboarding.micErrorEyebrow')}
      </p>
      <TitleHandwritten as="h2" className="text-center mb-3">
        <Underline>{t('onboarding.micErrorTitle')}</Underline>
      </TitleHandwritten>
      <p className="font-editorial italic text-ink-2 text-center mb-5">
        {t('onboarding.micErrorBody')}
      </p>

      <div className="border-2 border-ink rounded-lg bg-white p-4 mb-5">
        <p className="text-xs font-mono uppercase tracking-wider text-ink-soft mb-2">
          {platform === 'ios'
            ? 'iOS Safari'
            : platform === 'android'
              ? 'Chrome Android'
              : t('onboarding.micErrorOtherLabel')}
        </p>
        <p className="text-sm text-ink-2 whitespace-pre-line">{instructions}</p>
      </div>

      <Button size="lg" className="w-full" onClick={() => void onRetry()} disabled={busy}>
        {busy ? t('onboarding.requesting') : t('onboarding.micErrorRetry')}
      </Button>
    </Card>
  );
}
