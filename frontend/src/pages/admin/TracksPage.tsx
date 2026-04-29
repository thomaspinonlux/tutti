import { useTranslation } from 'react-i18next';
import { Card, TitleHandwritten, Underline } from '../../components/ui/index.js';

export function TracksPage(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="max-w-3xl mx-auto">
      <TitleHandwritten as="h1" className="mb-6">
        <Underline>{t('tracks.title')}</Underline>
      </TitleHandwritten>
      <Card tone="spritz" size="lg">
        <p className="font-editorial italic text-lg text-ink-2 mb-3">{t('tracks.comingSoon')}</p>
        <p className="text-sm text-ink-soft">{t('tracks.description')}</p>
      </Card>
    </div>
  );
}
