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

// ───── Voice Cascade Analytics (feat/voice-cascade-l3-assemblyai) ────────

export interface VoiceAnalyticsRow {
  level: string;
  count: number;
  avg_latency_ms: number | null;
  avg_confidence: number | null;
}

/** fix/ios-voice-cascade-mic-and-buzz-refused — top morceaux qui ratent le
 * match le plus. Permet à l'admin d'enrichir les aliases pour les titres
 * problématiques (accents difficiles, faux amis, etc.). */
export interface VoiceAnalyticsFailedTrack {
  track_id: string;
  title: string | null;
  artist: string | null;
  attempts: number;
  /** 0-1, ratio (matched_artist OR matched_title) / total. */
  match_rate: number;
}

export interface VoiceAnalytics {
  window_days: number;
  since: string;
  total: number;
  distribution: VoiceAnalyticsRow[];
  summary: {
    l1_count: number;
    l2_count: number;
    l2_fallback_count: number;
    l3_count: number;
    l1_avg_latency_ms: number | null;
    l2_avg_latency_ms: number | null;
    l3_avg_latency_ms: number | null;
    escalation_rate_l2_l3: number;
  };
  cost_estimate_eur: {
    deepgram: number;
    whisper_fallback: number;
    assemblyai: number;
    total: number;
  };
  /** Top 10 tracks où le matching échoue le plus (≥3 tentatives). */
  top_failed_tracks: VoiceAnalyticsFailedTrack[];
}

export async function getVoiceAnalytics(days = 7): Promise<VoiceAnalytics> {
  return await api<VoiceAnalytics>(
    `/api/admin/voice-analytics?days=${encodeURIComponent(String(days))}`,
  );
}

// ───── AI aliases (feat/ai-aliases-voice-matching) ────────────────────────

export interface AliasTrackRow {
  track_id: string;
  title: string;
  artist: string;
  aliases: string[];
  aliases_generated_at: string | null;
  aliases_source: string | null;
}

export interface AliasListResponse {
  page: number;
  pageSize: number;
  total: number;
  tracks: AliasTrackRow[];
}

export interface AliasGenerateResponse {
  total: number;
  processed: number;
  failed: number;
  cost_estimate_eur: number;
  tokens?: { input: number; output: number };
  results: Array<{
    track_id: string;
    title: string;
    artist: string;
    aliases: string[];
    success: boolean;
    error: string | null;
  }>;
}

export async function listAliases(args: {
  hasAliases?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<AliasListResponse> {
  const params = new URLSearchParams();
  if (args.hasAliases !== undefined) params.set('hasAliases', String(args.hasAliases));
  if (args.page) params.set('page', String(args.page));
  if (args.pageSize) params.set('pageSize', String(args.pageSize));
  const qs = params.toString();
  return await api<AliasListResponse>(`/api/admin/aliases${qs ? `?${qs}` : ''}`);
}

export async function generateAliasesBatch(args: {
  trackIds?: string[];
  missingOnly?: boolean;
  all?: boolean;
  limit?: number;
  locale?: 'fr' | 'en';
}): Promise<AliasGenerateResponse> {
  return await api<AliasGenerateResponse>('/api/admin/aliases/generate', {
    method: 'POST',
    body: args,
  });
}

export async function patchTrackAliases(
  trackId: string,
  aliases: string[],
): Promise<AliasTrackRow> {
  return await api<AliasTrackRow>(`/api/admin/aliases/${encodeURIComponent(trackId)}`, {
    method: 'PATCH',
    body: { aliases },
  });
}

export async function regenerateTrackAliases(
  trackId: string,
  locale?: 'fr' | 'en',
): Promise<AliasTrackRow> {
  const qs = locale ? `?locale=${locale}` : '';
  return await api<AliasTrackRow>(
    `/api/admin/aliases/${encodeURIComponent(trackId)}/regenerate${qs}`,
    { method: 'POST' },
  );
}

// ───── Artist aliases (fix/aliases-quality-v2-and-artists) ───────────────

export interface AliasArtistRow {
  artist_id: string;
  name: string;
  aliases: string[];
  aliases_generated_at: string | null;
  aliases_source: string | null;
}

export interface AliasArtistListResponse {
  page: number;
  pageSize: number;
  total: number;
  artists: AliasArtistRow[];
}

export interface AliasArtistGenerateResponse {
  total: number;
  processed: number;
  failed: number;
  cost_estimate_eur: number;
  tokens?: { input: number; output: number };
  results: Array<{
    artist_id: string;
    name: string;
    aliases: string[];
    success: boolean;
    error: string | null;
  }>;
}

export async function listArtistAliases(args: {
  hasAliases?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<AliasArtistListResponse> {
  const params = new URLSearchParams();
  if (args.hasAliases !== undefined) params.set('hasAliases', String(args.hasAliases));
  if (args.page) params.set('page', String(args.page));
  if (args.pageSize) params.set('pageSize', String(args.pageSize));
  const qs = params.toString();
  return await api<AliasArtistListResponse>(`/api/admin/aliases/artists${qs ? `?${qs}` : ''}`);
}

export async function generateArtistAliasesBatch(args: {
  artistIds?: string[];
  missingOnly?: boolean;
  all?: boolean;
  limit?: number;
  locale?: 'fr' | 'en';
}): Promise<AliasArtistGenerateResponse> {
  return await api<AliasArtistGenerateResponse>('/api/admin/aliases/generate-artists', {
    method: 'POST',
    body: args,
  });
}

export async function patchArtistAliases(
  artistId: string,
  aliases: string[],
): Promise<AliasArtistRow> {
  return await api<AliasArtistRow>(`/api/admin/aliases/artists/${encodeURIComponent(artistId)}`, {
    method: 'PATCH',
    body: { aliases },
  });
}

export async function regenerateArtistAliasesById(
  artistId: string,
  locale?: 'fr' | 'en',
): Promise<AliasArtistRow> {
  const qs = locale ? `?locale=${locale}` : '';
  return await api<AliasArtistRow>(
    `/api/admin/aliases/artists/${encodeURIComponent(artistId)}/regenerate${qs}`,
    { method: 'POST' },
  );
}
