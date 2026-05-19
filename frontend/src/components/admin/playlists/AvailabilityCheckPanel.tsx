/**
 * <AvailabilityCheckPanel /> — feat/playlist-cache-and-availability-check
 *
 * Bouton "🔍 Vérifier la disponibilité des morceaux" + résultat inline.
 *
 *   - mode="workspace" : appelle POST /api/playlists/:id/check-availability
 *   - mode="library"   : appelle POST /api/library/playlists/:id/check-availability
 *
 * Le mode est passé en prop pour découpler le panel du fetch (le caller
 * fournit la fonction). Permet de réutiliser sur LibraryPlaylistDetailPage
 * sans dupliquer la UI.
 *
 * État :
 *   - idle    : bouton "🔍 Vérifier"
 *   - loading : bouton disabled + spinner
 *   - done    : badge OK ou liste des indisponibles + reason traduite
 */

import { useState } from 'react';
import type { AvailabilityCheckResult } from '../../../lib/playlists.js';
import { Button, Card } from '../../ui/index.js';

interface Props {
  playlistId: string;
  mode: 'workspace' | 'library';
  onCheck: (id: string) => Promise<AvailabilityCheckResult>;
}

/** Mapping des reason codes backend → label FR lisible (i18n à venir). */
function reasonLabel(reason: string): string {
  switch (reason) {
    case 'video_removed':
      return 'Vidéo supprimée ou inexistante';
    case 'private_video':
      return 'Vidéo privée';
    case 'not_embeddable':
      return 'Lecture intégrée désactivée';
    case 'blocked_FR':
      return 'Bloquée en France';
    case 'blocked_LU':
      return 'Bloquée au Luxembourg';
    case 'not_in_allowed_regions':
      return 'Pas autorisée en FR/LU';
    case 'no_response':
      return 'Pas de réponse YouTube API';
    default:
      return reason;
  }
}

export function AvailabilityCheckPanel({ playlistId, mode, onCheck }: Props): JSX.Element {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AvailabilityCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await onCheck(playlistId);
      setResult(res);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const allOk = result && result.unavailable.length === 0;
  const hasIssues = result && result.unavailable.length > 0;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <Button
          type="button"
          variant={result ? 'ghost' : 'secondary'}
          size="sm"
          disabled={loading}
          onClick={() => void handleClick()}
        >
          {loading
            ? '⏳ Vérification…'
            : result
              ? '🔄 Re-vérifier'
              : '🔍 Vérifier la disponibilité des morceaux'}
        </Button>
        {result && (
          <span className="font-mono text-xs text-ink-soft">
            Vérifié {new Date(result.checked_at).toLocaleString('fr-FR')}
          </span>
        )}
      </div>

      {error && (
        <Card tone="cream" size="sm" className="border-raspberry">
          <p role="alert" className="text-raspberry text-sm font-medium">
            {error}
          </p>
        </Card>
      )}

      {allOk && (
        <Card
          tone="cream"
          size="sm"
          className="border-basil bg-basil/10 animate-fade-in"
          aria-live="polite"
        >
          <p className="text-basil-deep font-medium text-sm">
            ✅ Tous les {result.total} morceaux sont disponibles
          </p>
        </Card>
      )}

      {hasIssues && (
        <Card
          tone="cream"
          size="sm"
          className="border-raspberry bg-raspberry/10 animate-fade-in"
          aria-live="polite"
        >
          <p className="text-raspberry-deep font-medium text-sm mb-2">
            ⚠️ {result.playable}/{result.total} morceaux disponibles. {result.unavailable.length}{' '}
            indisponible{result.unavailable.length > 1 ? 's' : ''} :
          </p>
          <ul className="space-y-1.5">
            {result.unavailable.map((u) => (
              <li
                key={u.track_id}
                className="px-2 py-1.5 border border-raspberry/40 bg-cream rounded text-xs font-mono flex items-start gap-2 flex-wrap"
              >
                <span className="font-medium not-italic font-sans">
                  {u.artist} — {u.title}
                </span>
                <span className="text-ink-soft">→ {reasonLabel(u.reason)}</span>
              </li>
            ))}
          </ul>
          {mode === 'workspace' && (
            <p className="font-editorial italic text-xs text-ink-soft mt-2">
              Astuce : supprime et remplace ces morceaux via le panneau de droite.
            </p>
          )}
          {mode === 'library' && (
            <p className="font-editorial italic text-xs text-ink-soft mt-2">
              Les super-admins peuvent corriger ces morceaux depuis /admin/library/audit.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
