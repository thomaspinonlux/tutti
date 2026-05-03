/**
 * Wrapper API pour /api/admin/* — Phase 4
 *
 * Toutes ces routes nécessitent que l'utilisateur soit super admin
 * (process.env.SUPER_ADMIN_EMAILS côté backend). Les pages frontend
 * doivent se garder elles-mêmes via me().isSuperAdmin avant d'appeler.
 */

import { api } from './api.js';

export type MemberStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AdminMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: string;
  status: MemberStatus;
  email: string | null;
  invitation_code_used: string | null;
  approved_at: string | null;
  approved_by: string | null;
  referral_code: string | null;
  referrer_code: string | null;
  created_at: string;
  workspace: { id: string; name: string; plan: string };
}

export interface WhitelistEntry {
  id: string;
  email: string;
  note: string | null;
  added_by: string;
  created_at: string;
}

export interface InvitationCodeEntry {
  id: string;
  code: string;
  note: string | null;
  created_by: string;
  max_uses: number | null;
  uses_count: number;
  expires_at: string | null;
  first_used_at: string | null;
  created_at: string;
}

// ───── Members ────────────────────────────────────────────────────────────

export async function listMembers(status?: MemberStatus): Promise<AdminMember[]> {
  const qs = status ? `?status=${status}` : '';
  const data = await api<{ members: AdminMember[] }>(`/api/admin/members${qs}`);
  return data.members;
}

export async function approveMember(id: string): Promise<AdminMember> {
  const data = await api<{ member: AdminMember }>(
    `/api/admin/members/${encodeURIComponent(id)}/approve`,
    { method: 'POST' },
  );
  return data.member;
}

export async function rejectMember(id: string): Promise<AdminMember> {
  const data = await api<{ member: AdminMember }>(
    `/api/admin/members/${encodeURIComponent(id)}/reject`,
    { method: 'POST' },
  );
  return data.member;
}

// ───── Whitelist ──────────────────────────────────────────────────────────

export async function listWhitelist(): Promise<WhitelistEntry[]> {
  const data = await api<{ entries: WhitelistEntry[] }>('/api/admin/whitelist');
  return data.entries;
}

export async function addWhitelist(email: string, note?: string): Promise<WhitelistEntry> {
  const data = await api<{ entry: WhitelistEntry }>('/api/admin/whitelist', {
    method: 'POST',
    body: { email, note },
  });
  return data.entry;
}

export async function removeWhitelist(id: string): Promise<void> {
  await api(`/api/admin/whitelist/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ───── Invitations ────────────────────────────────────────────────────────

export async function listInvitations(): Promise<InvitationCodeEntry[]> {
  const data = await api<{ codes: InvitationCodeEntry[] }>('/api/admin/invitations');
  return data.codes;
}

export async function createInvitation(input: {
  code?: string;
  note?: string;
  max_uses?: number;
  expires_at?: string;
}): Promise<InvitationCodeEntry> {
  const data = await api<{ code: InvitationCodeEntry }>('/api/admin/invitations', {
    method: 'POST',
    body: input,
  });
  return data.code;
}

export async function deleteInvitation(id: string): Promise<void> {
  await api(`/api/admin/invitations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
