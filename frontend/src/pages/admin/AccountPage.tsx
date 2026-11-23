import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/auth.js';
import { Button, Card, TitleHandwritten, Underline } from '../../components/ui/index.js';
import { useDeconnexion } from '../../components/admin/Sidebar.js';

export function AccountPage(): JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  // La déconnexion n'existait que dans la colonne : la page Compte est l'endroit
  // où on la cherche, sur tous les appareils.
  const { deconnexionEnCours, seDeconnecter } = useDeconnexion();
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
        <div className="mt-6">
          <Button
            variant="secondary"
            onClick={() => void seDeconnecter()}
            disabled={deconnexionEnCours}
          >
            {t('common.signOut')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
