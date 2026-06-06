/**
 * <ContentBlockerWarning /> — feat/detect-content-blocker-youtube
 *
 * Overlay informatif affiché côté host quand le YouTube IFrame Player ne
 * peut pas s'initialiser à cause d'un Content Blocker Safari (1Blocker,
 * AdGuard, etc.) qui filtre `youtube.com` ou `googlevideo.com`.
 *
 * Déclenché par `useYouTubePlayer.blockedByContentFilter === true`.
 *
 * Variantes :
 *   - Browser Safari standard → instructions Réglages → Sites web → Bloqueurs
 *   - PWA standalone → instructions spécifiques "ouvre dans Safari, désactive,
 *     puis recharge la PWA" (les Content Blockers ne peuvent pas être désactivés
 *     depuis la PWA elle-même).
 *
 * Bouton "J'ai désactivé, recharger" → window.location.reload(). Pas de
 * dismiss persistent : l'overlay ré-apparaîtra à chaque page si le blocker
 * est toujours actif, c'est volontaire (sinon Thomas ne saurait pas pourquoi
 * ça ne joue pas).
 */

import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

interface Props {
  /** True si la PWA tourne en mode standalone (cf. usePwa.isStandalone). */
  isStandalone?: boolean;
  /** Optionnel : callback custom à la place de location.reload (tests). */
  onReload?: () => void;
}

export function ContentBlockerWarning({ isStandalone, onReload }: Props): JSX.Element {
  const { t } = useTranslation();

  const handleReload = (): void => {
    if (onReload) {
      onReload();
    } else {
      window.location.reload();
    }
  };

  return (
    <motion.div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="content-blocker-title"
      aria-describedby="content-blocker-body"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-ink/70 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ scale: 0.92, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="bg-cream border-2 border-ink rounded-xl shadow-pop-lg max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto"
      >
        <header className="flex items-start gap-3 mb-4">
          <div className="text-3xl leading-none shrink-0" aria-hidden>
            ⚠️
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="content-blocker-title" className="font-display text-xl text-ink leading-tight">
              {t('contentBlocker.title')}
            </h2>
          </div>
        </header>

        <div id="content-blocker-body" className="space-y-4 text-sm text-ink leading-relaxed">
          <p>{t('contentBlocker.body')}</p>

          {isStandalone ? (
            <PwaInstructions />
          ) : (
            <>
              <Option
                index={1}
                title={t('contentBlocker.option1.title')}
                steps={[
                  t('contentBlocker.option1.step1'),
                  t('contentBlocker.option1.step2'),
                  t('contentBlocker.option1.step3'),
                ]}
              />
              <Option
                index={2}
                title={t('contentBlocker.option2.title')}
                steps={[t('contentBlocker.option2.step1')]}
              />
            </>
          )}
        </div>

        <div className="mt-6 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <button
            type="button"
            onClick={handleReload}
            className="px-4 py-2 font-display text-base bg-raspberry text-cream border-2 border-ink rounded-md shadow-pop-sm hover:shadow-pop transition-shadow"
          >
            {t('contentBlocker.reloadButton')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Option({
  index,
  title,
  steps,
}: {
  index: number;
  title: string;
  steps: string[];
}): JSX.Element {
  return (
    <section className="bg-cream-2 border border-ink/20 rounded-lg p-3">
      <p className="font-display text-base mb-2">
        <span className="text-raspberry font-bold">{index}.</span> {title}
      </p>
      <ol className="list-decimal list-inside space-y-1 text-xs text-ink-soft">
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    </section>
  );
}

function PwaInstructions(): JSX.Element {
  const { t } = useTranslation();
  return (
    <section className="bg-spritz/10 border-2 border-spritz rounded-lg p-3">
      <p className="font-display text-base mb-2 flex items-center gap-2">
        <span aria-hidden>📱</span> {t('contentBlocker.pwa.title')}
      </p>
      <p className="text-xs text-ink-soft mb-2">{t('contentBlocker.pwa.intro')}</p>
      <ol className="list-decimal list-inside space-y-1 text-xs text-ink-soft">
        <li>{t('contentBlocker.pwa.step1')}</li>
        <li>{t('contentBlocker.pwa.step2')}</li>
        <li>{t('contentBlocker.pwa.step3')}</li>
        <li>{t('contentBlocker.pwa.step4')}</li>
      </ol>
    </section>
  );
}
