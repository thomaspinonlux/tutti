/**
 * /admin/library/audit — corriger manuellement les tracks officielles non
 * jouables (super-admin only).
 *
 * Liste TOUS les tracks où youtube_id est null OU is_playable=false. Pour
 * chaque : préview infos + champ input pour saisir un nouveau youtube_id
 * (accepte ID brut 11 chars OU URL YouTube/youtu.be/shorts).
 *
 * Save = PATCH /api/admin/library/tracks/:id { youtube_id }. Le backend
 * régénère cover_url thumbnail YT auto.
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Input, TitleHandwritten, Underline } from '../../components/ui/index.js';
import {
  listUnplayableTracks,
  patchOfficialTrack,
  type UnplayableTrack,
} from '../../lib/adminLibrary.js';

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function extractYoutubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (YT_ID_RE.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtu.be')) {
      const id = url.pathname.replace(/^\//, '');
      return YT_ID_RE.test(id) ? id : null;
    }
    if (url.hostname.includes('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v && YT_ID_RE.test(v)) return v;
      const m = url.pathname.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1] ?? null;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

export function LibraryAuditPage(): JSX.Element {
  const [tracks, setTracks] = useState<UnplayableTrack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [fixed, setFixed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void listUnplayableTracks()
      .then((data) => {
        if (cancelled) return;
        setTracks(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleTracks = useMemo(() => {
    if (!tracks) return null;
    return tracks.filter((t) => !fixed.has(t.id));
  }, [tracks, fixed]);

  const handleSave = async (
    e: FormEvent<HTMLFormElement>,
    track: UnplayableTrack,
  ): Promise<void> => {
    e.preventDefault();
    const raw = edits[track.id] ?? '';
    const newId = extractYoutubeId(raw);
    if (!newId) {
      setError(
        `youtube_id invalide pour "${track.artist} — ${track.title}". Attendu : 11 chars ou URL YouTube.`,
      );
      return;
    }
    setSaving((prev) => ({ ...prev, [track.id]: true }));
    setError(null);
    try {
      await patchOfficialTrack(track.id, { youtube_id: newId });
      setFixed((prev) => {
        const next = new Set(prev);
        next.add(track.id);
        return next;
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving((prev) => ({ ...prev, [track.id]: false }));
    }
  };

  const handleSearchYouTube = (track: UnplayableTrack): void => {
    const q = encodeURIComponent(`${track.artist} ${track.title}`);
    window.open(`https://www.youtube.com/results?search_query=${q}`, '_blank', 'noreferrer');
  };

  if (error && !tracks) {
    return (
      <div className="max-w-4xl mx-auto">
        <Card tone="cream" className="border-raspberry">
          <p role="alert" className="text-raspberry font-medium">
            {error}
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-6">
        <Link
          to="/admin/library"
          className="font-mono text-sm text-ink-soft hover:underline mb-2 inline-block"
        >
          ← Retour à la bibliothèque
        </Link>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-2">
          Super-admin · Bibliothèque officielle
        </p>
        <TitleHandwritten as="h1" className="mb-3">
          Audit <Underline>tracks non jouables</Underline>
        </TitleHandwritten>
        <p className="font-editorial italic text-ink-2 mb-4">
          Tracks où l'import automatique a échoué (youtube_id manquant ou flag is_playable=false).
          Saisis un youtube_id ou une URL YouTube pour corriger directement en DB.
        </p>
        <div className="flex items-center gap-3 text-sm font-mono mb-4 flex-wrap">
          {tracks && (
            <>
              <span className="px-3 py-1 bg-raspberry/10 border-2 border-raspberry rounded-full">
                À corriger : <strong>{visibleTracks?.length ?? 0}</strong>
              </span>
              <span className="px-3 py-1 bg-basil/20 border-2 border-basil rounded-full">
                ✓ Fixés : <strong>{fixed.size}</strong>
              </span>
              <span className="px-3 py-1 bg-cream border-2 border-ink rounded-full">
                Total : <strong>{tracks.length}</strong>
              </span>
            </>
          )}
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-4 px-4 py-3 border-2 border-raspberry bg-raspberry/10 text-raspberry-deep rounded-lg font-mono text-sm"
        >
          {error}
        </div>
      )}

      {!tracks ? (
        <p className="font-mono text-ink-soft animate-fade-in">Chargement…</p>
      ) : visibleTracks && visibleTracks.length === 0 ? (
        <Card tone="cream" size="lg" className="text-center">
          <p className="text-3xl mb-2" aria-hidden>
            🎉
          </p>
          <p className="font-editorial italic text-ink-soft">
            Aucun track à corriger. Tous les tracks officiels ont un youtube_id valide.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {visibleTracks?.map((track) => {
            const isSaving = saving[track.id] ?? false;
            return (
              <Card key={track.id} size="md" className="border-2 border-raspberry/50">
                <div className="flex items-start gap-3 mb-3 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <div className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-1">
                      {track.playlist_slug} · #{track.position}
                    </div>
                    <div className="font-display text-lg leading-tight">{track.title}</div>
                    <div className="font-editorial italic text-ink-2">{track.artist}</div>
                    {track.year && (
                      <div className="font-mono text-xs text-ink-soft mt-1">{track.year}</div>
                    )}
                    {track.playability_reason && (
                      <div className="font-mono text-xs text-raspberry mt-1">
                        Raison : {track.playability_reason}
                      </div>
                    )}
                    {track.youtube_id && (
                      <div className="font-mono text-xs mt-2 break-all">
                        Actuel :{' '}
                        <a
                          href={`https://www.youtube.com/watch?v=${track.youtube_id}`}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-raspberry hover:underline"
                        >
                          {track.youtube_id} ↗
                        </a>{' '}
                        (mais flag is_playable=false)
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSearchYouTube(track)}
                  >
                    🔍 Chercher sur YouTube
                  </Button>
                </div>

                <form
                  onSubmit={(e) => void handleSave(e, track)}
                  className="flex items-end gap-2 flex-wrap"
                >
                  <div className="flex-1 min-w-[200px]">
                    <Input
                      label="Nouveau youtube_id ou URL"
                      value={edits[track.id] ?? ''}
                      onChange={(e) =>
                        setEdits((prev) => ({ ...prev, [track.id]: e.target.value }))
                      }
                      placeholder="ex: dQw4w9WgXcQ ou https://youtu.be/..."
                      disabled={isSaving}
                    />
                  </div>
                  <Button type="submit" size="md" disabled={isSaving}>
                    {isSaving ? '…' : '✓ Save'}
                  </Button>
                </form>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
