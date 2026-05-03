/**
 * <ImportPlaylistPage /> — Phase 5
 *
 * Page d'import d'une playlist via code de partage. URL :
 *   /admin/import-playlist?code=XXXXXX (auto-fill)
 *   ou /admin/import-playlist (saisie manuelle)
 *
 * 1. Saisie code (ou pré-rempli via query param)
 * 2. Preview de la playlist source (nom, level, tracks_count, cover)
 * 3. Bouton "Importer dans mon workspace" → clone + redirect vers /admin/tracks/:id
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  Card,
  Input,
  TitleHandwritten,
  Underline,
} from '../../components/ui/index.js';
import {
  getPlaylistSharePreview,
  importPlaylistFromShare,
  type PlaylistSharePreview,
} from '../../lib/playlists.js';

export function ImportPlaylistPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialCode = params.get('code')?.toUpperCase() ?? '';
  const [code, setCode] = useState(initialCode);
  const [preview, setPreview] = useState<PlaylistSharePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-fetch preview si code dans URL
  useEffect(() => {
    if (initialCode && initialCode.length >= 4) {
      void handleFetchPreview(initialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFetchPreview = async (c: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const p = await getPlaylistSharePreview(c);
      setPreview(p);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async (): Promise<void> => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const result = await importPlaylistFromShare(preview.code);
      navigate(`/admin/tracks/${result.playlist.id}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (code.trim().length >= 4) {
      void handleFetchPreview(code.trim().toUpperCase());
    }
  };

  return (
    <div className="max-w-2xl">
      <header className="mb-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-2">
          {t('playlists.importEyebrow')}
        </p>
        <TitleHandwritten as="h1">
          <Underline>{t('playlists.importTitle')}</Underline>
        </TitleHandwritten>
      </header>

      <Card size="md" className="mb-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder={t('playlists.importCodePlaceholder')}
            maxLength={8}
            autoComplete="off"
            className="flex-1"
          />
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={busy || code.trim().length < 4}
          >
            {busy ? t('common.loading') : t('playlists.importPreview')}
          </Button>
        </form>
      </Card>

      {error && (
        <Card size="sm" tone="raspberry">
          <p role="alert" className="text-sm text-raspberry">
            {error}
          </p>
        </Card>
      )}

      {preview && (
        <Card size="md" tone="cream">
          <p className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-3">
            {t('playlists.importPreviewLabel')}
          </p>
          <div className="flex items-center gap-4">
            {preview.playlist.cover_url ? (
              <img
                src={preview.playlist.cover_url}
                alt=""
                className="w-20 h-20 border-2 border-ink rounded object-cover"
              />
            ) : (
              <div className="w-20 h-20 border-2 border-ink rounded bg-cream-3 flex items-center justify-center">
                <span className="font-display text-3xl text-ink-soft">♪</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-display text-2xl truncate">{preview.playlist.name}</p>
              {preview.playlist.description && (
                <p className="font-editorial italic text-sm text-ink-2 truncate">
                  {preview.playlist.description}
                </p>
              )}
              <div className="flex gap-2 mt-2 flex-wrap">
                <Badge tone="lemon">{preview.playlist.level}</Badge>
                <Badge tone="basil">
                  {preview.playlist.tracks_count} {t('playlists.tracks')}
                </Badge>
                <Badge tone="ink">{preview.playlist.language.toUpperCase()}</Badge>
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button variant="primary" size="md" onClick={() => void handleImport()} disabled={busy}>
              {busy ? t('common.loading') : t('playlists.importConfirm')}
            </Button>
            <Link to="/admin/tracks">
              <Button variant="ghost" size="md">
                {t('common.cancel')}
              </Button>
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
