/**
 * <GameRules /> — carte règles concise, affichée AVANT la partie.
 *
 * Contenu (3 points) :
 *   1. Comment répondre — buzz puis parler au micro OU saisir au clavier.
 *   2. Quoi répondre     — artiste ET/OU titre.
 *   3. Barème            — 1 bonne réponse = points ; les deux = double réponse.
 *
 * Réutilisée côté joueur (lobby d'attente) et côté host (option PreGameStart).
 * Aucune logique métier.
 *
 * feat/telephone-au-style-tv — variante `sombre` pour l'écran joueur, qui a
 * pris les codes de la TV. L'écran host garde la charte claire tant qu'il
 * n'est pas converti : la prop rend les deux possibles sans dupliquer.
 */

import { useTranslation } from 'react-i18next';
import { Card } from '../ui/index.js';

const TEL_CORAIL = '#FF5C4D';

export function GameRules({
  className,
  sombre = false,
}: {
  className?: string;
  sombre?: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const items = [
    { key: 'how', icon: '🎤', title: t('rules.howTitle'), body: t('rules.howBody') },
    { key: 'what', icon: '🎵', title: t('rules.whatTitle'), body: t('rules.whatBody') },
    { key: 'score', icon: '⭐', title: t('rules.scoreTitle'), body: t('rules.scoreBody') },
  ];
  const contenu = (
    <>
      <p
        className={`mb-3 text-center font-mono text-xs uppercase tracking-[0.22em] ${
          sombre ? '' : 'text-spritz-deep'
        }`}
        style={sombre ? { color: TEL_CORAIL } : undefined}
      >
        {t('rules.title')}
      </p>
      <ul className="space-y-3">
        {items.map((it) => (
          <li key={it.key} className="flex items-start gap-3">
            <span aria-hidden className="mt-0.5 text-xl leading-none">
              {it.icon}
            </span>
            <div className="flex-1">
              <p className={`font-display text-base ${sombre ? 'text-white' : 'text-ink'}`}>
                {it.title}
              </p>
              <p className={`text-sm ${sombre ? 'text-white/60' : 'text-ink-soft'}`}>{it.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </>
  );

  if (sombre) {
    return (
      <div
        className={`rounded-[20px] border border-white/[0.07] bg-[#191922] p-5 text-left shadow-[0_18px_50px_rgba(0,0,0,0.5)] ${className ?? ''}`}
      >
        {contenu}
      </div>
    );
  }
  return (
    <Card size="md" className={`bg-white text-left ${className ?? ''}`}>
      {contenu}
    </Card>
  );
}
