import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/auth.js';
import { Card, TitleHandwritten, Underline } from '../../components/ui/index.js';

export function AccountPage(): JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  return (
    <div className="max-w-3xl mx-auto">
      <TitleHandwritten as="h1" className="mb-6">
        <Underline>{t('account.title')}</Underline>
      </TitleHandwritten>
      <Card size="lg">
        <dl className="mb-6">
          <dt className="font-mono text-[10px] uppercase tracking-wider text-ink-soft mb-1">
            {t('account.email')}
          </dt>
          <dd className="font-mono text-base">{user?.email ?? '—'}</dd>
        </dl>
        <p className="font-editorial italic text-sm text-ink-soft border-l-2 border-cream-4 pl-3">
          {t('account.comingSoon')}
        </p>
      </Card>
    </div>
  );
}
