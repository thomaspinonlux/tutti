/**
 * Wrappers /api/admin/users/* — feat/admin-users-and-email-notifications.
 */

import { api } from './api.js';

export type Tier = 'free' | 'premium';

export interface AdminUserSummary {
  id: string;
  user_id: string;
  email: string | null;
  role: string;
  status: string | null;
  is_blocked: boolean;
  blocked_at: string | null;
  created_at: string;
  last_seen_at: string | null;
  freemium_sessions_count: number;
  freemium_period_start: string;
  tier: Tier;
  can_use_tracks: boolean;
  can_use_quizz: boolean;
  workspace: { id: string; name: string; plan: string };
  sessions_total: number;
  sessions_this_month: number;
}

export interface AdminUserSession {
  id: string;
  short_code: string;
  name: string | null;
  game_type: string;
  status: string;
  mode: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  participants_count: number;
  duration_seconds: number | null;
  playlists: string[];
}

export interface AdminUserDetail extends AdminUserSummary {
  blocked_by: string | null;
  approved_at: string | null;
  referral_code: string | null;
  referrer_code: string | null;
  workspace: AdminUserSummary['workspace'] & {
    establishments: Array<{ id: string; name: string }>;
  };
  recent_sessions: AdminUserSession[];
  monthly_distribution: Array<{ month: string; count: number }>;
}

export async function listAdminUsers(): Promise<AdminUserSummary[]> {
  const data = await api<{ users: AdminUserSummary[] }>('/api/admin/users');
  return data.users;
}

export async function getAdminUser(id: string): Promise<AdminUserDetail> {
  const data = await api<{ user: AdminUserDetail }>(`/api/admin/users/${encodeURIComponent(id)}`);
  return data.user;
}

export interface AdminUserPatchResult {
  id: string;
  is_blocked: boolean;
  blocked_at: string | null;
  freemium_sessions_count: number;
  freemium_period_start: string;
  can_use_tracks: boolean;
  can_use_quizz: boolean;
}

export async function patchAdminUser(
  id: string,
  changes: {
    is_blocked?: boolean;
    reset_freemium?: boolean;
    can_use_tracks?: boolean;
    can_use_quizz?: boolean;
  },
): Promise<AdminUserPatchResult> {
  const data = await api<{ user: AdminUserPatchResult }>(
    `/api/admin/users/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: changes },
  );
  return data.user;
}
