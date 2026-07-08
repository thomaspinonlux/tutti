/**
 * Card pack quizz officiel Tutti (feat/quiz-launch-host-ui).
 *
 * Sœur de OfficialPlaylistCard mais pour /api/library/quiz-packs.
 *   - Affichage name selon UI lang (FR/EN)
 *   - Badge "Officiel Tutti" pastille discrète top-right
 *   - Badge difficulté + question_count + locale + category
 *   - Si locked (premium_only sans accès) : opacity 60% + cadenas overlay
 */

import { useTranslation } from 'react-i18next';
import type { LibraryQuizPackSummary } from '../../../lib/library.js';
import { Badge, Card } from '../../ui/index.js';

interface Props {
  pack: LibraryQuizPackSummary;
  onPick: () => void;
  onLockedClick?: () => void;
  disabled?: boolean;
  /** Variante sombre (console iPad) — défaut clair Pop Cocktail. */
  dark?: boolean;
}

export function OfficialQuizPackCard({
  pack,
  onPick,
  onLockedClick,
  disabled,
  dark,
}: Props): JSX.Element {
  const { i18n, t } = useTranslation();
  const lang = i18n.language?.startsWith('en') ? 'en' : 'fr';
  const name = lang === 'en' ? pack.name_en : pack.name_fr;

  const handleClick = (): void => {
    if (pack.locked) {
      onLockedClick?.();
      return;
    }
    onPick();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className="group text-left disabled:opacity-50 relative"
    >
      <Card
        size="sm"
        className={`h-full transition-transform group-hover:-translate-y-0.5 group-hover:shadow-pop-lg relative ${
          pack.locked ? 'opacity-60' : ''
        } ${dark ? '!bg-[#15151d]/80 !border !border-white/10' : ''}`}
      >
        {/* Badge "Officiel Tutti" en haut-droite */}
        <span
          className={`absolute top-2 right-2 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded-full ${
            dark
              ? 'bg-white/10 border border-white/15 text-white/70'
              : 'bg-spritz/20 border border-spritz text-spritz-deep'
          }`}
          aria-label={t('host.session.officialBadge')}
        >
          ⭐ {t('host.session.officialBadge')}
        </span>

        <div className="flex items-start gap-2 mb-2 pr-20">
          <Badge
            tone={
              pack.difficulty === 'EASY' ? 'basil' : pack.difficulty === 'MEDIUM' ? 'lemon' : 'plum'
            }
            tilt={-1}
          >
            {pack.difficulty}
          </Badge>
        </div>

        <p className={`font-display text-lg mb-1 truncate ${dark ? 'text-white' : ''}`}>{name}</p>

        <p className={`font-mono text-xs mb-2 ${dark ? 'text-white/50' : 'text-ink-soft'}`}>
          {pack.question_count} {t('host.session.quizPackQuestionCount')} · {pack.locale_primary}
          {pack.category ? ` · ${pack.category}` : ''}
        </p>

        {/* Cadenas overlay si locked */}
        {pack.locked && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              className={`rounded-lg px-3 py-2 text-center shadow-pop ${
                dark
                  ? 'bg-[#0B0B0F]/85 border border-white/15 text-white'
                  : 'bg-cream/90 border-2 border-ink'
              }`}
            >
              <span className="text-3xl block mb-1" aria-hidden>
                🔒
              </span>
              <p className="font-mono text-[10px] uppercase tracking-wider">
                {t('host.session.premiumRequired')}
              </p>
            </div>
          </div>
        )}
      </Card>
    </button>
  );
}
