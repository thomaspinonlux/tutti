/**
 * <MinScreen min="md|lg|xl" /> — bloque le rendu si la viewport est sous
 * le breakpoint requis. Affiche un message Pop Cocktail expliquant
 * pourquoi et proposant une action (revenir avec un appareil plus grand,
 * ou aller jouer sur /play depuis le téléphone).
 *
 * Référence : docs/RESPONSIVE.md
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useBreakpoint, type Breakpoint } from '../lib/useBreakpoint.js';
import { MultiColorBar, TitleHandwritten, Underline, Button } from './ui/index.js';

interface Props {
  min: Breakpoint;
  /** Optionnel : route suggérée pour rediriger l'utilisateur (par défaut '/'). */
  redirectTo?: string;
  /** Optionnel : libellé du CTA (par défaut "Retour à l'accueil"). */
  redirectLabel?: string;
  children: ReactNode;
}

const HUMAN_BP: Record<Breakpoint, string> = {
  sm: '640 px',
  md: '768 px',
  lg: '1024 px',
  xl: '1280 px',
  '2xl': '1536 px',
};

export function MinScreen({ min, redirectTo = '/', redirectLabel, children }: Props): JSX.Element {
  const { t } = useTranslation();
  const { isAtLeast } = useBreakpoint();

  if (isAtLeast(min)) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <MultiColorBar height="md" />
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-4">
            {t('responsive.tooSmallEyebrow')}
          </p>
          <TitleHandwritten as="h1" className="mb-4">
            <Underline>{t('responsive.tooSmallTitle')}</Underline>
          </TitleHandwritten>
          <p className="font-editorial italic text-ink-2 mb-2">
            {t('responsive.tooSmallBody', { width: HUMAN_BP[min] })}
          </p>
          <p className="text-sm text-ink-soft mb-8">{t('responsive.tooSmallHint')}</p>
          <Link to={redirectTo}>
            <Button variant="primary" size="md">
              {redirectLabel ?? t('responsive.tooSmallCta')}
            </Button>
          </Link>
        </div>
      </main>
      <MultiColorBar height="md" />
    </div>
  );
}
