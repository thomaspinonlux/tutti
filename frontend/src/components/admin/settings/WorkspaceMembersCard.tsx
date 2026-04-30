/**
 * <WorkspaceMembersCard /> — section Settings : membres workspace + invitation.
 *
 * Affiche :
 *   - Lien d'invitation (URL avec ?ref=CODE) + bouton "Copier"
 *   - Liste des membres existants (email + role + me indicator)
 *
 * V1 : envoi d'invitation par lien partagé (pas d'email automatique).
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../lib/api.js';
import { Badge, Button, Card } from '../../ui/index.js';

interface Member {
  id: string;
  role: 'OWNER' | 'HOST' | 'ANIMATOR';
  email: string | null;
  created_at: string;
  is_me: boolean;
}

interface MeResponse {
  referral_code: string | null;
  role: string | null;
}

export function WorkspaceMembersCard(): JSX.Element {
  const { t } = useTranslation();
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api<MeResponse>('/api/me'),
      api<{ members: Member[] }>('/api/workspaces/current/members'),
    ])
      .then(([me, ms]) => {
        if (cancelled) return;
        setReferralCode(me.referral_code);
        setMembers(ms.members);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const inviteUrl = referralCode
    ? `${window.location.origin}/auth/signup?ref=${referralCode}`
    : null;

  const copyInvite = async (): Promise<void> => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-2xl">{t('settings.membersTitle')}</h3>
        {referralCode && (
          <span className="font-mono text-xs text-ink-soft">
            {t('settings.referralCode')} : <strong>{referralCode}</strong>
          </span>
        )}
      </div>

      {inviteUrl && (
        <div className="mb-4 p-3 border-2 border-ink rounded bg-cream-2 flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={inviteUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 font-mono text-xs bg-transparent border-0 focus:outline-none truncate"
          />
          <Button size="sm" variant="secondary" onClick={() => void copyInvite()}>
            {copied ? `✓ ${t('common.copied')}` : t('common.copy')}
          </Button>
        </div>
      )}

      <p className="text-sm font-mono uppercase tracking-wider text-ink/70 mb-2">
        {t('settings.membersList')}
      </p>

      {error && (
        <p role="alert" className="text-raspberry text-sm">
          {error}
        </p>
      )}

      {members === null ? (
        <p className="font-mono text-xs text-ink-soft">{t('common.loading')}</p>
      ) : members.length === 0 ? (
        <p className="font-editorial italic text-sm text-ink-soft">{t('settings.noMembers')}</p>
      ) : (
        <ul className="space-y-1">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-2 px-3 py-1.5 border-2 border-ink rounded bg-cream"
            >
              <span className="flex-1 truncate text-sm">{m.email ?? '—'}</span>
              <Badge tone={m.role === 'OWNER' ? 'plum' : 'basil'}>{m.role}</Badge>
              {m.is_me && (
                <Badge tone="ink" tilt={1}>
                  {t('settings.you')}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] font-mono text-ink-soft mt-3">{t('settings.membersHint')}</p>
    </Card>
  );
}
