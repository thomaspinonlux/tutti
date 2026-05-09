/**
 * Wrapper /api/me — Phase 4
 *
 * Renvoie l'identité utilisateur, son workspace, son statut d'approbation,
 * et son éventuel rôle de super admin.
 *
 * Pas de gating workspace — accessible même pour les comptes PENDING.
 */

import { api } from './api.js';

export interface MeResponse {
  user: { id: string; email: string | null };
  workspace: {
    id: string;
    name: string;
    plan: string;
    establishments?: unknown[];
  } | null;
  role: string | null;
  referral_code: string | null;
  hasWorkspace: boolean;
  memberStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  isSuperAdmin: boolean;
  /**
   * fix/disable-spotify-sdk-non-allowlist — true si l'user est allowlisté
   * pour Spotify. Frontend skip l'init du SDK + tous les appels providers
   * Spotify si false (défaut). Évite les NotFoundError cascade DOM cleanup
   * + le bruit dans la console pour les users normaux post-pivot YouTube.
   */
  spotify_allowlist: boolean;
  /**
   * feat/granular-tracks-quizz-access — flags par user pour gater l'UI
   * dashboard host. Backend revérifie sur POST /api/sessions création.
   */
  can_use_tracks: boolean;
  can_use_quizz: boolean;
}

export async function getMe(): Promise<MeResponse> {
  return api<MeResponse>('/api/me');
}
