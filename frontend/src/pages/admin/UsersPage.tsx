/**
 * /admin/users — gestion utilisateurs (super-admin only).
 *
 * Tableau triable + recherche email/nom. Tri ascendant/descendant sur
 * toutes les colonnes (réutilise pattern PR /admin/library).
 *
 * Colonnes : Email, Date inscription, Dernière connexion, Sessions total,
 * Sessions ce mois, Tier (free/premium), Statut (Actif/Bloqué), Actions.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Input, TitleHandwritten, Underline } from '../../components/ui/index.js';
import { listAdminUsers, type AdminUserSummary } from '../../lib/adminUsers.js';

type SortKey =
  | 'email'
  | 'created_at'
  | 'last_seen_at'
  | 'sessions_total'
  | 'sessions_this_month'
  | 'tier'
  | 'is_blocked'
  | 'can_use_tracks'
  | 'can_use_quizz';
type SortOrder = 'asc' | 'desc' | null;

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function compareUsers(a: AdminUserSummary, b: AdminUserSummary, key: SortKey): number {
  switch (key) {
    case 'email':
      return (a.email ?? '').localeCompare(b.email ?? '', 'fr', { sensitivity: 'base' });
    case 'created_at':
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    case 'last_seen_at': {
      const av = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0;
      const bv = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0;
      return av - bv;
    }
    case 'sessions_total':
      return a.sessions_total - b.sessions_total;
    case 'sessions_this_month':
      return a.sessions_this_month - b.sessions_this_month;
    case 'tier':
      return a.tier.localeCompare(b.tier);
    case 'is_blocked':
      return Number(a.is_blocked) - Number(b.is_blocked);
    case 'can_use_tracks':
      return Number(a.can_use_tracks) - Number(b.can_use_tracks);
    case 'can_use_quizz':
      return Number(a.can_use_quizz) - Number(b.can_use_quizz);
  }
}

export function UsersPage(): JSX.Element {
  const [users, setUsers] = useState<AdminUserSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(null);

  useEffect(() => {
    void listAdminUsers()
      .then(setUsers)
      .catch((err) => setError((err as Error).message));
  }, []);

  const handleSort = (k: SortKey): void => {
    if (sortKey !== k) {
      setSortKey(k);
      setSortOrder('asc');
      return;
    }
    if (sortOrder === 'asc') {
      setSortOrder('desc');
      return;
    }
    setSortKey(null);
    setSortOrder(null);
  };

  const filteredSorted = useMemo(() => {
    if (!users) return null;
    const q = normalize(query);
    let arr = users;
    if (q) {
      arr = arr.filter((u) => normalize(u.email ?? '').includes(q));
    }
    if (sortKey && sortOrder) {
      arr = [...arr].sort((a, b) => compareUsers(a, b, sortKey));
      if (sortOrder === 'desc') arr.reverse();
    }
    return arr;
  }, [users, query, sortKey, sortOrder]);

  const formatDate = (iso: string | null): string => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-2">
          Super-admin
        </p>
        <TitleHandwritten as="h1">
          <Underline>Utilisateurs</Underline>
        </TitleHandwritten>
        <p className="font-editorial italic text-ink-2 mt-1">
          Gestion comptes, sessions, blocage manuel, reset compteur freemium.
        </p>
      </header>

      <div className="mb-4 max-w-md">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher par email…"
        />
      </div>

      {error && (
        <Card tone="cream" className="border-raspberry mb-4">
          <p role="alert" className="text-raspberry font-medium">
            {error}
          </p>
        </Card>
      )}

      {!filteredSorted ? (
        <p className="font-mono text-ink-soft animate-fade-in">Chargement…</p>
      ) : filteredSorted.length === 0 ? (
        <Card tone="cream" size="lg" className="text-center">
          <p className="font-editorial italic text-ink-soft">Aucun utilisateur trouvé.</p>
        </Card>
      ) : (
        <div className="border-2 border-ink rounded-lg overflow-x-auto bg-cream">
          <table className="w-full text-sm">
            <thead className="bg-ink text-cream font-mono text-xs uppercase tracking-wider">
              <tr>
                <Th k="email" sk={sortKey} so={sortOrder} on={handleSort} align="left">
                  Email
                </Th>
                <Th k="created_at" sk={sortKey} so={sortOrder} on={handleSort} align="left">
                  Inscription
                </Th>
                <Th k="last_seen_at" sk={sortKey} so={sortOrder} on={handleSort} align="left">
                  Dernière connexion
                </Th>
                <Th k="sessions_total" sk={sortKey} so={sortOrder} on={handleSort} align="right">
                  Total
                </Th>
                <Th
                  k="sessions_this_month"
                  sk={sortKey}
                  so={sortOrder}
                  on={handleSort}
                  align="right"
                >
                  Ce mois
                </Th>
                <Th k="tier" sk={sortKey} so={sortOrder} on={handleSort} align="left">
                  Tier
                </Th>
                <Th k="can_use_tracks" sk={sortKey} so={sortOrder} on={handleSort} align="center">
                  Tracks
                </Th>
                <Th k="can_use_quizz" sk={sortKey} so={sortOrder} on={handleSort} align="center">
                  Quizz
                </Th>
                <Th k="is_blocked" sk={sortKey} so={sortOrder} on={handleSort} align="left">
                  Statut
                </Th>
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSorted.map((u) => (
                <tr key={u.id} className="border-t border-ink/20 hover:bg-cream-2">
                  <td className="px-3 py-2 font-medium">
                    <Link to={`/admin/users/${u.id}`} className="hover:underline">
                      {u.email ?? '—'}
                    </Link>
                    <p className="text-[10px] font-mono text-ink-soft">{u.workspace.name}</p>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-soft">{formatDate(u.created_at)}</td>
                  <td className="px-3 py-2 text-xs text-ink-soft">{formatDate(u.last_seen_at)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{u.sessions_total}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{u.sessions_this_month}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block px-2 py-0.5 border text-[11px] font-mono uppercase rounded ${
                        u.tier === 'premium'
                          ? 'bg-spritz/15 border-spritz text-spritz-deep'
                          : 'bg-ink/10 border-ink text-ink'
                      }`}
                    >
                      {u.tier}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {u.can_use_tracks ? (
                      <span className="text-basil-deep" title="Accès Tracks autorisé">
                        ✅
                      </span>
                    ) : (
                      <span className="text-raspberry" title="Accès Tracks bloqué">
                        ❌
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {u.can_use_quizz ? (
                      <span className="text-basil-deep" title="Accès Quizz autorisé">
                        ✅
                      </span>
                    ) : (
                      <span className="text-raspberry" title="Accès Quizz bloqué">
                        ❌
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block px-2 py-0.5 border text-[11px] font-mono uppercase rounded ${
                        u.is_blocked
                          ? 'bg-raspberry/15 border-raspberry text-raspberry-deep'
                          : 'bg-basil/15 border-basil text-basil-deep'
                      }`}
                    >
                      {u.is_blocked ? 'Bloqué' : 'Actif'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/admin/users/${u.id}`}
                      className="text-spritz-deep font-medium hover:underline"
                    >
                      Détail →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface ThProps {
  k: SortKey;
  sk: SortKey | null;
  so: SortOrder;
  on: (k: SortKey) => void;
  align: 'left' | 'right' | 'center';
  children: React.ReactNode;
}
function Th({ k, sk, so, on, align, children }: ThProps): JSX.Element {
  const active = sk === k && so !== null;
  const arrow = active ? (so === 'asc' ? ' ↑' : ' ↓') : '';
  const alignClass =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  const activeClass = active ? 'bg-spritz/30 text-cream' : 'hover:bg-ink/80';
  return (
    <th
      scope="col"
      className={`px-3 py-2 ${alignClass} cursor-pointer select-none transition-colors ${activeClass}`}
      onClick={() => on(k)}
      aria-sort={active ? (so === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <span aria-hidden className="font-bold">
          {arrow}
        </span>
      </span>
    </th>
  );
}
