/**
 * appleMusic.ts — client des routes /api/auth/apple/* (feat/apple-music étape 4).
 *
 * Le developer token (JWT app-level) est minté côté backend ; MusicKit JS s'en
 * sert pour s'initialiser + appeler l'Apple Music API. Le Music User Token
 * (compte abonné du host) est obtenu côté navigateur via MusicKit.authorize()
 * puis persité via connectAppleMusic().
 */

import { api } from './api.js';
import { loadMusicKitSdk } from './musickitLoader.js';
import { supportsNativeAppleMusic } from './platform.js';
import { nativeMusicKit } from './nativeMusicKit.js';

export async function getAppleDeveloperToken(): Promise<{ token: string; expires_at: string }> {
  return api('/api/auth/apple/developer-token');
}

export interface AppleMusicStatus {
  connected: boolean;
  configured: boolean;
  account_email: string | null;
  expires_at: string | null;
  connected_at: string | null;
}

export async function getAppleMusicStatus(): Promise<AppleMusicStatus> {
  return api('/api/auth/apple/status');
}

export async function connectAppleMusic(
  musicUserToken: string,
): Promise<{ ok: boolean; expires_at: string }> {
  return api('/api/auth/apple/connect', {
    method: 'POST',
    body: { music_user_token: musicUserToken },
  });
}

export async function disconnectAppleMusic(): Promise<void> {
  await api('/api/auth/apple/disconnect', { method: 'DELETE' });
}

export interface ApplePublicTokens {
  developer_token: string;
  developer_token_expires_at: string;
  music_user_token: string;
  music_user_token_expires_at: string | null;
}

/** feat/tv-audio-output — tokens pour la TV publique (gated session active). */
export async function getApplePublicTokens(workspaceId: string): Promise<ApplePublicTokens> {
  return api(`/api/auth/apple/token-public/${encodeURIComponent(workspaceId)}`);
}

/**
 * Connexion interactive Apple Music : charge MusicKit, configure avec le
 * developer token, ouvre le popup Apple (MusicKit.authorize) où le host se
 * logue avec son compte abonné, puis persiste le Music User Token via
 * /connect. À appeler depuis un CLIC utilisateur (popup bloqué sinon).
 */
export async function authorizeAppleMusic(): Promise<{ expires_at: string }> {
  // Coque native (iPad/Mac) : le popup web `MusicKit.authorize()` (window.open)
  // ne peut PAS s'ouvrir dans la WebView → connexion bloquée sur « chargement ».
  // On passe par le plugin natif : dialogue d'autorisation iOS + Music User
  // Token via StoreKit, puis persistance /connect (même finalité, sans popup).
  if (supportsNativeAppleMusic() && nativeMusicKit.isAvailable()) {
    const { token } = await getAppleDeveloperToken();
    const { userToken } = await nativeMusicKit.getUserToken(token);
    if (!userToken) {
      throw new Error('Autorisation Apple Music annulée.');
    }
    return connectAppleMusic(userToken);
  }

  const { token } = await getAppleDeveloperToken();
  const MusicKit = await loadMusicKitSdk();
  const music = await MusicKit.configure({
    developerToken: token,
    app: { name: 'Tutti', build: '1.0.0' },
  });
  const musicUserToken = await music.authorize();
  if (!musicUserToken) {
    throw new Error('Autorisation Apple Music annulée.');
  }
  return connectAppleMusic(musicUserToken);
}

// ─── feat/parc-comptes-apple ────────────────────────────────────────────────
//
// Parc de comptes Apple Music partagés : un abonnement ne porte qu'un flux,
// donc N soirées en parallèle demandent N comptes. Réservé au propriétaire.
//
// AUCUN MOT DE PASSE NE TRANSITE : Apple ne délivre de Music User Token que
// par MusicKit.authorize(), c'est-à-dire une connexion faite par une personne
// dans la fenêtre Apple. On ne récupère et ne conserve que ce jeton.

export interface CompteApple {
  id: string;
  libelle: string;
  account_email: string | null;
  actif: boolean;
  expires_at: string | null;
  verifie_le: string | null;
  created_at: string;
  /** Partie qui occupe ce compte en ce moment, null s'il est libre. */
  occupe_par: { id: string; nom: string } | null;
}

export interface EtatParc {
  total: number;
  occupes: number;
  disponibles: number;
}

export async function listerComptesApple(): Promise<{
  comptes: CompteApple[];
  etat: EtatParc;
}> {
  return api('/api/comptes-apple');
}

/**
 * Ajoute un compte au parc. Ouvre la fenêtre Apple : la personne s'y connecte
 * AVEC LE COMPTE À ENREGISTRER, et seul le jeton nous revient.
 * À appeler depuis un CLIC (sinon la fenêtre est bloquée par le navigateur).
 */
export async function ajouterCompteApple(
  libelle: string,
  accountEmail?: string,
): Promise<{ compte: CompteApple; etat: EtatParc }> {
  const { token } = await getAppleDeveloperToken();
  const MusicKit = await loadMusicKitSdk();
  const music = await MusicKit.configure({
    developerToken: token,
    app: { name: 'Tutti', build: '1.0.0' },
  });
  // Une session precedente peut rester ouverte : on se deconnecte d'abord,
  // sinon Apple re-signe le MEME compte et on enregistre deux fois le meme.
  try {
    await music.unauthorize?.();
  } catch {
    /* pas de session ouverte : rien a faire */
  }
  const musicUserToken = await music.authorize();
  if (!musicUserToken) throw new Error('Connexion Apple Music annulée.');
  return api('/api/comptes-apple', {
    method: 'POST',
    body: {
      libelle,
      music_user_token: musicUserToken,
      ...(accountEmail ? { account_email: accountEmail } : {}),
    },
  });
}

export async function majCompteApple(
  id: string,
  champs: { libelle?: string; actif?: boolean },
): Promise<{ etat: EtatParc }> {
  return api(`/api/comptes-apple/${encodeURIComponent(id)}`, { method: 'PATCH', body: champs });
}

/** Re-signature : le jeton Apple a expiré, on en repose un neuf sur ce compte. */
export async function resignerCompteApple(id: string): Promise<{ etat: EtatParc }> {
  const { token } = await getAppleDeveloperToken();
  const MusicKit = await loadMusicKitSdk();
  const music = await MusicKit.configure({
    developerToken: token,
    app: { name: 'Tutti', build: '1.0.0' },
  });
  try {
    await music.unauthorize?.();
  } catch {
    /* rien a faire */
  }
  const musicUserToken = await music.authorize();
  if (!musicUserToken) throw new Error('Connexion Apple Music annulée.');
  return api(`/api/comptes-apple/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { music_user_token: musicUserToken },
  });
}

export async function supprimerCompteApple(id: string): Promise<{ etat: EtatParc }> {
  return api(`/api/comptes-apple/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
