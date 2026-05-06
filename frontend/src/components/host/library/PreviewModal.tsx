/**
 * Modal preview (Sujet 4 brief) — affiché avant lancement effectif d'une
 * playlist officielle. Montre la disponibilité des tracks selon les comptes
 * connectés du host.
 *
 *   < 50% jouables → red warning
 *   < 80% jouables → orange warning
 *   ≥ 80%          → green normal
 */

import { useTranslation } from 'react-i18next';
import { Button, Card } from '../../ui/index.js';
import type { LibraryPlaylistDetail } from '../../../lib/library.js';
import type { PlayabilityReport } from '../../../lib/providerSelection.js';

interface Props {
  open: boolean;
  playlist: LibraryPlaylistDetail | null;
  report: PlayabilityReport | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function PreviewModal({
  open,
  playlist,
  report,
  busy,
  onCancel,
  onConfirm,
}: Props): JSX.Element | null {
  const { t, i18n } = useTranslation();
  if (!open || !playlist || !report) return null;

  const lang = i18n.language?.startsWith('en') ? 'en' : 'fr';
  const name = lang === 'en' ? playlist.name_en : playlist.name_fr;
  const ratio = report.total > 0 ? report.playable / report.total : 0;
  const tone =
    ratio < 0.5
      ? 'border-raspberry text-raspberry-deep bg-raspberry/10'
      : ratio < 0.8
        ? 'border-spritz text-spritz-deep bg-spritz/10'
        : 'border-basil text-basil-deep bg-basil/10';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-title"
      className="fixed inset-0 z-50 bg-ink/60 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-w-lg w-full max-h-[90vh] flex flex-col"
      >
        <Card size="md" tone="cream" className="flex flex-col max-h-full overflow-hidden">
          {/* Header */}
          <h2 id="preview-title" className="font-display text-2xl mb-2">
            {t('host.session.modal.preview.title')}
          </h2>
          <p className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-1">
            ⭐ {t('host.session.officialBadge')}
          </p>
          <p className="font-medium mb-1">{name}</p>
          <p className="font-mono text-xs text-ink-soft mb-3">
            {playlist.theme ?? '—'} · {playlist.difficulty.toLowerCase()} ·{' '}
            {playlist.locale_primary} · {playlist.track_count} {t('playlists.tracksCount')}
          </p>

          {/* Ratio coloré + warning explicite si <50% (Issue 3 polish brief V2) */}
          <div className={`px-3 py-3 border-2 rounded-lg mb-3 ${tone}`}>
            <p className="font-display text-2xl tabular-nums">
              {report.playable} / {report.total}
            </p>
            <p className="text-sm">{t('host.session.modal.preview.tracksAvailable')}</p>
            {report.via_spotify > 0 && (
              <p className="text-xs font-mono mt-1">via Spotify : {report.via_spotify}</p>
            )}
            {report.via_youtube > 0 && (
              <p className="text-xs font-mono">via YouTube : {report.via_youtube}</p>
            )}
            {ratio < 0.5 && (
              <p className="text-xs font-bold mt-2">
                ⚠️ {t('host.session.modal.preview.warningLow')}
              </p>
            )}
          </div>

          {/* Liste tracks scrollable (Issue 3 brief) */}
          <div className="flex-1 min-h-0 overflow-y-auto border-2 border-ink/20 rounded mb-3 bg-cream-2">
            <ol className="divide-y divide-ink/10">
              {playlist.tracks.map((tr) => (
                <li key={tr.id} className="flex items-baseline gap-2 px-3 py-1.5 text-sm">
                  <span className="font-mono text-[11px] tabular-nums text-ink-soft w-6">
                    {tr.position}.
                  </span>
                  <span className="flex-1 truncate">
                    <span className="font-medium">{tr.title}</span>
                    <span className="text-ink-soft"> — {tr.artist}</span>
                    {tr.year ? <span className="text-ink-faded text-xs"> · {tr.year}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {/* Boutons actions */}
          <div className="flex gap-2 shrink-0">
            <Button variant="ghost" onClick={onCancel} className="flex-1" disabled={busy}>
              {t('host.session.modal.preview.cancel')}
            </Button>
            <Button onClick={onConfirm} className="flex-1" disabled={busy || report.playable === 0}>
              {busy ? '…' : t('host.session.modal.preview.start')}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
