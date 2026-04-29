/**
 * /admin/settings — édition de l'établissement courant.
 *
 * Champs : nom, couleur d'accent, logo (upload Supabase Storage),
 * langue par défaut, source musicale active.
 *
 * Critère étape 6 : changer le nom puis valider, le nouveau nom doit
 * apparaître dans la sidebar et le dashboard sans rechargement.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useEstablishment } from './AdminLayout.js';
import { api, ApiError } from '../../lib/api.js';
import { uploadEstablishmentLogo } from '../../lib/upload.js';
import { Button, Card, Input, TitleHandwritten, Underline } from '../../components/ui/index.js';

const PROVIDERS = [
  { id: 'demo', i18n: 'settings.providerDemo', enabled: true },
  { id: 'spotify', i18n: 'settings.providerSpotify', enabled: false },
  { id: 'deezer', i18n: 'settings.providerDeezer', enabled: false },
  { id: 'apple_music', i18n: 'settings.providerAppleMusic', enabled: false },
] as const;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function SettingsPage(): JSX.Element {
  const { t } = useTranslation();
  const { establishment, refetch, loading, error: fetchError } = useEstablishment();

  const [name, setName] = useState('');
  const [brandingColor, setBrandingColor] = useState('');
  const [defaultLanguage, setDefaultLanguage] = useState<'fr' | 'en'>('fr');
  const [activeProvider, setActiveProvider] = useState<(typeof PROVIDERS)[number]['id']>('demo');

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  useEffect(() => {
    if (!establishment) return;
    setName(establishment.name);
    setBrandingColor(establishment.branding_color ?? '');
    setDefaultLanguage((establishment.default_language as 'fr' | 'en') ?? 'fr');
    setActiveProvider(establishment.active_provider as (typeof PROVIDERS)[number]['id']);
  }, [establishment]);

  if (loading || !establishment) {
    return <p className="font-mono text-ink-soft">{t('common.loading')}</p>;
  }
  if (fetchError) {
    return (
      <p role="alert" className="text-raspberry">
        {t('common.error')} : {fetchError}
      </p>
    );
  }

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSaveState('saving');
    setSaveError(null);
    try {
      await api('/api/establishment', {
        method: 'PATCH',
        body: {
          name: name.trim(),
          branding_color: brandingColor || null,
          default_language: defaultLanguage,
          active_provider: activeProvider,
        },
      });
      await refetch();
      setSaveState('saved');
      window.setTimeout(() => setSaveState('idle'), 2000);
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      setSaveError(msg);
      setSaveState('error');
    }
  };

  const handleLogoUpload = async (file: File | null): Promise<void> => {
    if (!file) return;
    setLogoUploading(true);
    setLogoError(null);
    try {
      const { publicUrl } = await uploadEstablishmentLogo(establishment.workspace_id, file);
      await api('/api/establishment', {
        method: 'PATCH',
        body: { branding_logo: publicUrl },
      });
      await refetch();
    } catch (err: unknown) {
      setLogoError((err as Error).message ?? t('settings.uploadFailed'));
    } finally {
      setLogoUploading(false);
    }
  };

  const handleLogoRemove = async (): Promise<void> => {
    setLogoUploading(true);
    try {
      await api('/api/establishment', {
        method: 'PATCH',
        body: { branding_logo: null },
      });
      await refetch();
    } finally {
      setLogoUploading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <TitleHandwritten as="h1" className="mb-2">
        <Underline>{t('settings.title')}</Underline>
      </TitleHandwritten>
      <p className="font-editorial italic text-ink-2 mb-8">{t('settings.description')}</p>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
        <Card>
          <Input
            label={t('settings.establishmentName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            hint={t('settings.establishmentNameHint')}
            required
            minLength={2}
            maxLength={120}
          />
        </Card>

        <Card>
          <label className="block">
            <span className="text-xs font-mono uppercase tracking-wider text-ink/70 mb-2 block">
              {t('settings.brandingLogo')}
            </span>
            <div className="flex items-center gap-4">
              {establishment.branding_logo ? (
                <img
                  src={establishment.branding_logo}
                  alt=""
                  className="w-16 h-16 object-contain border-2 border-ink rounded bg-cream"
                />
              ) : (
                <div className="w-16 h-16 border-2 border-dashed border-ink-faded rounded bg-cream/30" />
              )}
              <div className="flex-1 flex flex-wrap items-center gap-2">
                <label className="cursor-pointer inline-flex">
                  <span className="px-3 py-1.5 text-sm bg-cream text-ink border-2 border-ink rounded shadow-pop-sm hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5 transition-all font-bold">
                    {logoUploading
                      ? t('settings.brandingLogoUploading')
                      : t('settings.brandingLogoCta')}
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden"
                    disabled={logoUploading}
                    onChange={(e) => void handleLogoUpload(e.target.files?.[0] ?? null)}
                  />
                </label>
                {establishment.branding_logo && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={logoUploading}
                    onClick={() => void handleLogoRemove()}
                  >
                    {t('settings.brandingLogoRemove')}
                  </Button>
                )}
              </div>
            </div>
            <span className="block text-xs text-ink-soft mt-2 italic">
              {t('settings.brandingLogoHint')}
            </span>
            {logoError && (
              <span role="alert" className="block text-xs text-raspberry mt-2 font-medium">
                {logoError}
              </span>
            )}
          </label>
        </Card>

        <Card>
          <label className="block">
            <span className="text-xs font-mono uppercase tracking-wider text-ink/70 mb-2 block">
              {t('settings.brandingColor')}
            </span>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={brandingColor || '#ee6c2a'}
                onChange={(e) => setBrandingColor(e.target.value)}
                className="w-12 h-12 border-2 border-ink rounded cursor-pointer"
              />
              <input
                type="text"
                value={brandingColor}
                onChange={(e) => setBrandingColor(e.target.value)}
                placeholder="#ee6c2a"
                pattern="^#[0-9a-fA-F]{6}$"
                className="flex-1 px-3 py-2 border-2 border-ink rounded bg-cream/30 font-mono text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-spritz"
              />
            </div>
            <span className="block text-xs text-ink-soft mt-2 italic">
              {t('settings.brandingColorHint')}
            </span>
          </label>
        </Card>

        <Card>
          <label className="block">
            <span className="text-xs font-mono uppercase tracking-wider text-ink/70 mb-2 block">
              {t('settings.defaultLanguage')}
            </span>
            <div className="flex gap-2">
              {(['fr', 'en'] as const).map((lng) => (
                <button
                  key={lng}
                  type="button"
                  onClick={() => setDefaultLanguage(lng)}
                  aria-pressed={defaultLanguage === lng}
                  className={`flex-1 px-3 py-2 border-2 border-ink rounded font-medium transition-colors ${
                    defaultLanguage === lng
                      ? 'bg-ink text-cream shadow-pop-sm'
                      : 'bg-cream text-ink hover:bg-cream-2'
                  }`}
                >
                  {t(lng === 'fr' ? 'settings.languageFr' : 'settings.languageEn')}
                </button>
              ))}
            </div>
          </label>
        </Card>

        <Card>
          <label className="block">
            <span className="text-xs font-mono uppercase tracking-wider text-ink/70 mb-2 block">
              {t('settings.activeProvider')}
            </span>
            <select
              value={activeProvider}
              onChange={(e) =>
                setActiveProvider(e.target.value as (typeof PROVIDERS)[number]['id'])
              }
              className="w-full px-3 py-2 border-2 border-ink rounded bg-cream/30 focus:bg-white focus:outline-none focus:ring-2 focus:ring-spritz"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.enabled}>
                  {t(p.i18n as 'settings.providerDemo')}
                </option>
              ))}
            </select>
          </label>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saveState === 'saving'}>
            {saveState === 'saving' ? t('common.saving') : t('common.save')}
          </Button>
          {saveState === 'saved' && (
            <span className="text-sm font-medium text-basil-deep animate-fade-in">
              {t('common.saved')}
            </span>
          )}
          {saveState === 'error' && saveError && (
            <span role="alert" className="text-sm text-raspberry">
              {saveError}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
