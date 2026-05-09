/**
 * /admin/users/:id — détail user + activité (super-admin only).
 *
 * Affiche : infos compte + 50 dernières sessions + bar chart sessions/mois +
 * actions Bloquer/Débloquer + Réinitialiser compteur freemium.
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Button, Card, TitleHandwritten, Underline } from '../../components/ui/index.js';
import { getAdminUser, patchAdminUser, type AdminUserDetail } from '../../lib/adminUsers.js';

export function UserDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    void getAdminUser(id)
      .then(setUser)
      .catch((err) => setError((err as Error).message));
  }, [id]);

  if (error) {
    return (
      <div className="max-w-4xl mx-auto">
        <Card tone="cream" className="border-raspberry">
          <p role="alert" className="text-raspberry font-medium">
            {error}
          </p>
          <Link
            to="/admin/users"
            className="mt-3 inline-block font-mono text-sm text-ink-soft hover:underline"
          >
            ← Retour à la liste
          </Link>
        </Card>
      </div>
    );
  }
  if (!user) {
    return <p className="font-mono text-ink-soft animate-fade-in">Chargement…</p>;
  }

  const formatDate = (iso: string | null): string => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
  };

  const handleToggleBlock = async (): Promise<void> => {
    if (!user) return;
    const target = !user.is_blocked;
    if (
      target &&
      !window.confirm(`Bloquer ${user.email} ? L'utilisateur ne pourra plus accéder à Tutti.`)
    )
      return;
    setBusy(true);
    try {
      const res = await patchAdminUser(user.id, { is_blocked: target });
      setUser({
        ...user,
        is_blocked: res.is_blocked,
        blocked_at: res.blocked_at,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // feat/granular-tracks-quizz-access — toggle direct save permissions.
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const handleToggleTracks = async (): Promise<void> => {
    if (!user) return;
    setBusy(true);
    try {
      const res = await patchAdminUser(user.id, { can_use_tracks: !user.can_use_tracks });
      setUser({ ...user, can_use_tracks: res.can_use_tracks });
      setSavedFlash(`Accès Tracks ${res.can_use_tracks ? 'activé' : 'désactivé'} ✓`);
      window.setTimeout(() => setSavedFlash(null), 2500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const handleToggleQuizz = async (): Promise<void> => {
    if (!user) return;
    setBusy(true);
    try {
      const res = await patchAdminUser(user.id, { can_use_quizz: !user.can_use_quizz });
      setUser({ ...user, can_use_quizz: res.can_use_quizz });
      setSavedFlash(`Accès Quizz ${res.can_use_quizz ? 'activé' : 'désactivé'} ✓`);
      window.setTimeout(() => setSavedFlash(null), 2500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleResetFreemium = async (): Promise<void> => {
    if (!user) return;
    if (
      !window.confirm(
        'Réinitialiser le compteur freemium ? Le user pourra à nouveau lancer des sessions gratuites.',
      )
    )
      return;
    setBusy(true);
    try {
      const res = await patchAdminUser(user.id, { reset_freemium: true });
      setUser({
        ...user,
        freemium_sessions_count: res.freemium_sessions_count,
        freemium_period_start: res.freemium_period_start,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Bar chart simple — barres horizontales relatives au max sur 12 mois.
  const maxCount = Math.max(1, ...user.monthly_distribution.map((m) => m.count));

  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link
            to="/admin/users"
            className="font-mono text-sm text-ink-soft hover:underline mb-2 inline-block"
          >
            ← Tous les utilisateurs
          </Link>
          <TitleHandwritten as="h1">
            <Underline>{user.email ?? user.id}</Underline>
          </TitleHandwritten>
          <p className="font-mono text-xs text-ink-soft mt-1">
            {user.workspace.name} · {user.role} ·{' '}
            <span
              className={`inline-block px-2 py-0.5 border text-[10px] uppercase rounded ${
                user.tier === 'premium'
                  ? 'bg-spritz/15 border-spritz text-spritz-deep'
                  : 'bg-ink/10 border-ink text-ink'
              }`}
            >
              {user.tier}
            </span>
            {user.is_blocked && (
              <Badge tone="plum" className="ml-2">
                BLOQUÉ
              </Badge>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            type="button"
            variant={user.is_blocked ? 'primary' : 'secondary'}
            disabled={busy}
            onClick={() => void handleToggleBlock()}
          >
            {user.is_blocked ? '✓ Débloquer' : '🛑 Bloquer'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => void handleResetFreemium()}
          >
            🔄 Reset freemium
          </Button>
        </div>
      </header>

      {savedFlash && (
        <div
          role="status"
          className="mb-4 px-4 py-2 border-2 border-basil bg-basil/15 text-basil-deep rounded font-mono text-sm animate-fade-in"
        >
          {savedFlash}
        </div>
      )}

      {/* feat/granular-tracks-quizz-access — Permissions section */}
      <Card size="md" className="mb-6">
        <p className="text-xs font-mono uppercase tracking-wider text-ink-soft mb-3">Permissions</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="flex items-center justify-between p-3 border-2 border-ink rounded-lg cursor-pointer hover:bg-cream-2 transition-colors">
            <div>
              <p className="font-display text-base">🎵 Accès Blind Test (Tracks)</p>
              <p className="font-editorial italic text-xs text-ink-soft">
                Le user peut créer des sessions Tracks
              </p>
            </div>
            <input
              type="checkbox"
              checked={user.can_use_tracks}
              disabled={busy}
              onChange={() => void handleToggleTracks()}
              className="w-6 h-6 cursor-pointer accent-spritz"
            />
          </label>
          <label className="flex items-center justify-between p-3 border-2 border-ink rounded-lg cursor-pointer hover:bg-cream-2 transition-colors">
            <div>
              <p className="font-display text-base">❓ Accès Quizz</p>
              <p className="font-editorial italic text-xs text-ink-soft">
                Le user peut créer des sessions Quizz
              </p>
            </div>
            <input
              type="checkbox"
              checked={user.can_use_quizz}
              disabled={busy}
              onChange={() => void handleToggleQuizz()}
              className="w-6 h-6 cursor-pointer accent-basil"
            />
          </label>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card size="md">
          <p className="text-xs font-mono uppercase tracking-wider text-ink-soft mb-3">Identité</p>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-soft">Email</dt>
              <dd className="font-mono text-xs">{user.email ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">Rôle</dt>
              <dd>{user.role}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">Statut</dt>
              <dd>{user.status ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">Inscrit le</dt>
              <dd className="text-xs">{formatDate(user.created_at)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">Dernière connexion</dt>
              <dd className="text-xs">{formatDate(user.last_seen_at)}</dd>
            </div>
            {user.referral_code && (
              <div className="flex justify-between">
                <dt className="text-ink-soft">Code parrain</dt>
                <dd className="font-mono">{user.referral_code}</dd>
              </div>
            )}
          </dl>
        </Card>

        <Card size="md">
          <p className="text-xs font-mono uppercase tracking-wider text-ink-soft mb-3">Activité</p>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-soft">Sessions total</dt>
              <dd className="tabular-nums font-bold">{user.sessions_total}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">Sessions ce mois</dt>
              <dd className="tabular-nums font-bold">{user.sessions_this_month}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">Compteur freemium</dt>
              <dd className="tabular-nums">{user.freemium_sessions_count}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">Période depuis</dt>
              <dd className="text-xs">{formatDate(user.freemium_period_start)}</dd>
            </div>
            {user.is_blocked && user.blocked_at && (
              <div className="flex justify-between">
                <dt className="text-ink-soft">Bloqué le</dt>
                <dd className="text-xs text-raspberry">{formatDate(user.blocked_at)}</dd>
              </div>
            )}
          </dl>
        </Card>
      </div>

      <Card size="md" className="mb-6">
        <p className="text-xs font-mono uppercase tracking-wider text-ink-soft mb-3">
          Sessions / mois (12 derniers mois)
        </p>
        <div className="space-y-1">
          {user.monthly_distribution.map((m) => {
            const pct = (m.count / maxCount) * 100;
            return (
              <div key={m.month} className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-ink-soft w-16 shrink-0">{m.month}</span>
                <div className="flex-1 bg-cream-2 rounded h-4 overflow-hidden border border-ink/20">
                  <div className="h-full bg-spritz transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="font-mono text-xs tabular-nums w-8 text-right">{m.count}</span>
              </div>
            );
          })}
        </div>
      </Card>

      <Card size="md">
        <p className="text-xs font-mono uppercase tracking-wider text-ink-soft mb-3">
          50 dernières sessions
        </p>
        {user.recent_sessions.length === 0 ? (
          <p className="font-editorial italic text-ink-soft">Aucune session.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-ink-soft font-mono uppercase">
                <tr className="border-b border-ink/20">
                  <th className="text-left py-2">Date</th>
                  <th className="text-left py-2">Type</th>
                  <th className="text-left py-2">Code</th>
                  <th className="text-left py-2">Playlist(s)</th>
                  <th className="text-right py-2">Joueurs</th>
                  <th className="text-right py-2">Durée</th>
                  <th className="text-left py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {user.recent_sessions.map((s) => (
                  <tr key={s.id} className="border-b border-ink/10">
                    <td className="py-1.5">
                      {new Date(s.created_at).toLocaleDateString('fr-FR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit',
                      })}
                    </td>
                    <td className="py-1.5">
                      {s.game_type === 'TRACKS' ? '🎵' : '❓'} {s.game_type}
                    </td>
                    <td className="py-1.5 font-mono text-[10px]">{s.short_code}</td>
                    <td className="py-1.5 truncate max-w-[200px]">
                      {s.playlists.join(', ') || '—'}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{s.participants_count}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {s.duration_seconds !== null
                        ? `${Math.round(s.duration_seconds / 60)}m`
                        : '—'}
                    </td>
                    <td className="py-1.5">
                      <span
                        className={`inline-block px-1.5 py-0.5 text-[9px] uppercase rounded font-mono ${
                          s.status === 'ENDED'
                            ? 'bg-ink/10 text-ink'
                            : s.status === 'PLAYING'
                              ? 'bg-basil/15 text-basil-deep'
                              : 'bg-spritz/15 text-spritz-deep'
                        }`}
                      >
                        {s.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
