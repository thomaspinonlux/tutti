/**
 * <SharePlaylistModal /> — Phase 5
 *
 * Dialog qui génère un code court pour partager une playlist. L'autre
 * animateur saisit ce code via /admin/import-playlist?code=XXX pour
 * cloner la playlist dans son workspace.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input } from '../../ui/index.js';
import { createPlaylistShareCode, type PlaylistShareEntry } from '../../../lib/playlists.js';

interface Props {
  playlistId: string;
  playlistName: string;
  open: boolean;
  onClose: () => void;
}

export function SharePlaylistModal({
  playlistId,
  playlistName,
  open,
  onClose,
}: Props): JSX.Element | null {
  const { t } = useTranslation();
  const [share, setShare] = useState<PlaylistShareEntry | null>(null);
  const [maxUses, setMaxUses] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const handleGenerate = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const entry = await createPlaylistShareCode(playlistId, {
        max_uses: maxUses ? parseInt(maxUses, 10) : undefined,
      });
      setShare(entry);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(share.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleClose = (): void => {
    setShare(null);
    setMaxUses('');
    setError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-ink/40 z-50 flex items-center justify-center p-4">
      <Card size="md" className="max-w-md w-full" tone="cream">
        <header className="mb-3">
          <p className="font-mono text-xs uppercase tracking-wider text-spritz-deep">
            {t('playlists.shareEyebrow')}
          </p>
          <p className="font-display text-xl truncate">{playlistName}</p>
        </header>

        {!share ? (
          <div className="space-y-3">
            <p className="font-editorial italic text-sm text-ink-2">{t('playlists.shareIntro')}</p>
            <Input
              type="number"
              min={1}
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder={t('admin.invitationMaxUsesPlaceholder')}
              autoComplete="off"
            />
            {error && (
              <p role="alert" className="text-sm text-raspberry">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleGenerate()}
                disabled={busy}
              >
                {busy ? t('common.loading') : t('playlists.shareGenerate')}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleClose}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="font-mono text-xs uppercase tracking-wider text-ink-soft">
              {t('playlists.shareCodeReady')}
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-2xl tracking-[0.3em] bg-lemon/30 px-3 py-2 rounded border-2 border-ink text-center">
                {share.code}
              </code>
              <Button variant="primary" size="sm" onClick={() => void handleCopy()}>
                {copied ? '✓' : t('playlists.shareCopy')}
              </Button>
            </div>
            <p className="font-editorial italic text-xs text-ink-soft">
              {t('playlists.shareInstructions')}
            </p>
            <Button variant="ghost" size="sm" onClick={handleClose}>
              {t('common.close')}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
