/**
 * <GameRules /> — carte règles concise, affichée AVANT la partie.
 *
 * Contenu (3 points) :
 *   1. Comment répondre — buzz puis parler au micro OU saisir au clavier.
 *   2. Quoi répondre     — artiste ET/OU titre.
 *   3. Barème            — 1 bonne réponse = points ; les deux = double réponse.
 *
 * Réutilisée côté joueur (lobby d'attente) et côté host (option PreGameStart).
 * Sobre, tokens Pop Cocktail (ink / spritz / cream), aucune logique métier.
 */

import { useTranslation } from 'react-i18next';
import { Card } from '../ui/index.js';

export function GameRules({ className }: { className?: string }): JSX.Element {
  const { t } = useTranslation();
  const items = [
    { key: 'how', icon: '🎤', title: t('rules.howTitle'), body: t('rules.howBody') },
    { key: 'what', icon: '🎵', title: t('rules.whatTitle'), body: t('rules.whatBody') },
    { key: 'score', icon: '⭐', title: t('rules.scoreTitle'), body: t('rules.scoreBody') },
  ];
  return (
    <Card size="md" className={`bg-white text-left ${className ?? ''}`}>
      <p className="text-xs font-mono uppercase tracking-wider text-spritz-deep mb-3 text-center">
        {t('rules.title')}
      </p>
      <ul className="space-y-3">
        {items.map((it) => (
          <li key={it.key} className="flex items-start gap-3">
            <span aria-hidden className="text-xl leading-none mt-0.5">
              {it.icon}
            </span>
            <div className="flex-1">
              <p className="font-display text-base text-ink">{it.title}</p>
              <p className="text-sm text-ink-soft">{it.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
