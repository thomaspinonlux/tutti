/**
 * <SuperAdminPage /> — Phase 4d
 *
 * Console super admin : gestion des comptes (membres pending), de la
 * whitelist email, et des codes invitation.
 *
 * Réservé aux comptes dont l'email est dans process.env.SUPER_ADMIN_EMAILS
 * (gating backend + redirect côté frontend si pas isSuperAdmin).
 */

import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  Card,
  Input,
  TitleHandwritten,
  Underline,
} from '../../components/ui/index.js';
import { useEstablishment } from './AdminLayout.js';
import {
  addWhitelist,
  approveMember,
  createInvitation,
  deleteInvitation,
  listInvitations,
  listMembers,
  listWhitelist,
  rejectMember,
  removeWhitelist,
  type AdminMember,
  type InvitationCodeEntry,
  type MemberStatus,
  type WhitelistEntry,
} from '../../lib/admin.js';

type Tab = 'members' | 'whitelist' | 'invitations';

export function SuperAdminPage(): JSX.Element {
  const { t } = useTranslation();
  const { me } = useEstablishment();
  const [tab, setTab] = useState<Tab>('members');

  if (me && !me.isSuperAdmin) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-2">
          {t('admin.superEyebrow')}
        </p>
        <TitleHandwritten as="h1">
          <Underline>{t('admin.superTitle')}</Underline>
        </TitleHandwritten>
      </header>

      <div className="flex gap-2 mb-6 flex-wrap" role="tablist">
        <TabButton active={tab === 'members'} onClick={() => setTab('members')}>
          {t('admin.tabMembers')}
        </TabButton>
        <TabButton active={tab === 'whitelist'} onClick={() => setTab('whitelist')}>
          {t('admin.tabWhitelist')}
        </TabButton>
        <TabButton active={tab === 'invitations'} onClick={() => setTab('invitations')}>
          {t('admin.tabInvitations')}
        </TabButton>
      </div>

      {tab === 'members' && <MembersTab />}
      {tab === 'whitelist' && <WhitelistTab />}
      {tab === 'invitations' && <InvitationsTab />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-4 py-2 border-2 border-ink rounded font-mono text-xs uppercase tracking-wider transition-colors ${
        active ? 'bg-spritz-deep text-cream' : 'bg-cream-2 text-ink hover:bg-cream-3'
      }`}
    >
      {children}
    </button>
  );
}

// ── Tab Members ─────────────────────────────────────────────────────────

function MembersTab(): JSX.Element {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<MemberStatus | 'ALL'>('PENDING');
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const m = await listMembers(filter === 'ALL' ? undefined : filter);
      setMembers(m);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const handleApprove = async (id: string): Promise<void> => {
    await approveMember(id);
    await refresh();
  };
  const handleReject = async (id: string): Promise<void> => {
    if (!window.confirm(t('admin.confirmReject'))) return;
    await rejectMember(id);
    await refresh();
  };

  return (
    <Card size="md">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <p className="font-mono text-xs uppercase tracking-wider text-ink-soft">
          {t('admin.membersHeader')}
        </p>
        <div className="flex gap-2">
          {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-2 py-1 font-mono text-[10px] uppercase tracking-wider border-2 border-ink rounded ${
                filter === f ? 'bg-ink text-cream' : 'bg-cream-2 text-ink'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="font-editorial italic text-ink-soft">{t('common.loading')}</p>}
      {error && (
        <p role="alert" className="text-sm text-raspberry">
          {error}
        </p>
      )}

      {!loading && members.length === 0 && (
        <p className="font-editorial italic text-ink-soft">{t('admin.membersEmpty')}</p>
      )}

      <ul className="space-y-2">
        {members.map((m) => (
          <li
            key={m.id}
            className="flex items-center gap-3 px-3 py-2 border-2 border-ink rounded bg-white flex-wrap"
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{m.email ?? '(email inconnu)'}</p>
              <p className="text-xs text-ink-soft truncate">
                {m.workspace.name} · {m.role} · {new Date(m.created_at).toLocaleDateString()}
                {m.invitation_code_used ? ` · code: ${m.invitation_code_used}` : ''}
                {m.referrer_code ? ` · parrain: ${m.referrer_code}` : ''}
              </p>
            </div>
            <Badge
              tone={
                m.status === 'APPROVED' ? 'basil' : m.status === 'PENDING' ? 'lemon' : 'raspberry'
              }
            >
              {m.status}
            </Badge>
            {m.status !== 'APPROVED' && (
              <Button variant="primary" size="sm" onClick={() => void handleApprove(m.id)}>
                {t('admin.approve')}
              </Button>
            )}
            {m.status !== 'REJECTED' && (
              <Button variant="ghost" size="sm" onClick={() => void handleReject(m.id)}>
                {t('admin.reject')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── Tab Whitelist ───────────────────────────────────────────────────────

function WhitelistTab(): JSX.Element {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<WhitelistEntry[]>([]);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      setEntries(await listWhitelist());
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleAdd = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addWhitelist(email.trim().toLowerCase(), note.trim() || undefined);
      setEmail('');
      setNote('');
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string): Promise<void> => {
    await removeWhitelist(id);
    await refresh();
  };

  return (
    <Card size="md">
      <p className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-3">
        {t('admin.whitelistHeader')}
      </p>
      <form onSubmit={handleAdd} className="space-y-2 mb-4">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('admin.whitelistEmailPlaceholder')}
          autoComplete="off"
        />
        <Input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('admin.whitelistNotePlaceholder')}
          autoComplete="off"
        />
        {error && (
          <p role="alert" className="text-sm text-raspberry">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="sm" disabled={busy || !email.trim()}>
          {busy ? t('common.loading') : t('admin.whitelistAdd')}
        </Button>
      </form>

      {entries.length === 0 && (
        <p className="font-editorial italic text-ink-soft">{t('admin.whitelistEmpty')}</p>
      )}
      <ul className="space-y-2">
        {entries.map((e) => (
          <li
            key={e.id}
            className="flex items-center gap-3 px-3 py-2 border-2 border-ink rounded bg-white"
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{e.email}</p>
              {e.note && <p className="text-xs text-ink-soft truncate">{e.note}</p>}
            </div>
            <Button variant="ghost" size="sm" onClick={() => void handleRemove(e.id)}>
              {t('admin.remove')}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── Tab Invitations ─────────────────────────────────────────────────────

function InvitationsTab(): JSX.Element {
  const { t } = useTranslation();
  const [codes, setCodes] = useState<InvitationCodeEntry[]>([]);
  const [note, setNote] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      setCodes(await listInvitations());
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleCreate = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createInvitation({
        note: note.trim() || undefined,
        max_uses: maxUses ? parseInt(maxUses, 10) : undefined,
      });
      setNote('');
      setMaxUses('');
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!window.confirm(t('admin.confirmDelete'))) return;
    await deleteInvitation(id);
    await refresh();
  };

  return (
    <Card size="md">
      <p className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-3">
        {t('admin.invitationsHeader')}
      </p>
      <form onSubmit={handleCreate} className="space-y-2 mb-4">
        <Input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('admin.invitationNotePlaceholder')}
          autoComplete="off"
        />
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
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? t('common.loading') : t('admin.invitationCreate')}
        </Button>
      </form>

      {codes.length === 0 && (
        <p className="font-editorial italic text-ink-soft">{t('admin.invitationsEmpty')}</p>
      )}
      <ul className="space-y-2">
        {codes.map((c) => (
          <li
            key={c.id}
            className="flex items-center gap-3 px-3 py-2 border-2 border-ink rounded bg-white flex-wrap"
          >
            <code className="font-mono text-sm bg-lemon/30 px-2 py-1 rounded shrink-0">
              {c.code}
            </code>
            <div className="flex-1 min-w-0">
              {c.note && <p className="text-xs truncate">{c.note}</p>}
              <p className="text-[10px] text-ink-soft">
                {c.uses_count}
                {c.max_uses ? `/${c.max_uses}` : ''} use(s)
                {c.expires_at ? ` · expire ${new Date(c.expires_at).toLocaleDateString()}` : ''}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => void handleDelete(c.id)}>
              {t('admin.remove')}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
