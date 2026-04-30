/**
 * <QuizzAnswersList /> — liste participants côté host avec indicateur si répondu.
 * En phase asking : affiche un check vert si le joueur a soumis.
 */

import { useTranslation } from 'react-i18next';
import type { Participant } from '@tutti/shared';
import { Card } from '../../ui/index.js';

interface Props {
  participants: Participant[];
  submittedSet: Set<string>;
}

export function QuizzAnswersList({ participants, submittedSet }: Props): JSX.Element {
  const { t } = useTranslation();
  const active = participants.filter((p) => !p.is_kicked);

  return (
    <Card size="sm">
      <p className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-2">
        {t('hostQuizz.answersTitle')}
      </p>
      <ul className="space-y-1">
        {active.map((p) => {
          const submitted = submittedSet.has(p.id);
          return (
            <li
              key={p.id}
              className={`flex items-center gap-2 px-2 py-1 rounded text-sm transition-colors ${
                submitted ? 'bg-basil/30' : 'bg-cream'
              }`}
            >
              <span className="w-4 text-center">{submitted ? '✓' : '·'}</span>
              <span className="flex-1 truncate">{p.pseudo}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
