import { useTranslation } from 'react-i18next';
import { Card, TitleHandwritten, Underline } from '../../components/ui/index.js';

export function QuizzPage(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="max-w-3xl mx-auto">
      <TitleHandwritten as="h1" className="mb-6">
        <Underline>{t('quizz.title')}</Underline>
      </TitleHandwritten>
      <Card tone="basil" size="lg">
        <p className="font-editorial italic text-lg text-ink-2 mb-3">{t('quizz.comingSoon')}</p>
        <p className="text-sm text-ink-soft">{t('quizz.description')}</p>
      </Card>
    </div>
  );
}
