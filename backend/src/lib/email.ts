/**
 * Service email via Resend — feat/admin-users-and-email-notifications.
 *
 * Helper minimaliste pour envoyer des notifications transactionnelles.
 * Lecture lazy de l'env (RESEND_API_KEY, MAIL_FROM, NOTIFICATION_EMAILS).
 *
 * Si RESEND_API_KEY absent → no-op silencieux + warn (dev local + envs
 * sans email config). Évite de casser le boot serveur.
 *
 * Usage :
 *   import { sendNotificationEmail, getNotificationRecipients } from './email.js';
 *   await sendNotificationEmail({
 *     to: getNotificationRecipients(),
 *     subject: '...',
 *     html: '...',
 *   });
 *
 * Toujours appelé avec try/catch côté caller car l'envoi NE doit JAMAIS
 * bloquer la flow business (signup, etc.).
 */

import { Resend } from 'resend';

let cachedResend: Resend | null = null;

function getResend(): Resend | null {
  if (cachedResend) return cachedResend;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[Email] RESEND_API_KEY absent → emails désactivés (no-op)');
    return null;
  }
  cachedResend = new Resend(key);
  return cachedResend;
}

function getMailFrom(): string {
  return process.env.MAIL_FROM ?? 'Tutti <noreply@send.komptoir.lu>';
}

/**
 * Liste des destinataires des notifications admin (signup, etc.).
 * Format env : "a@b.com,c@d.com" (séparateur virgule).
 */
export function getNotificationRecipients(): string[] {
  const raw = process.env.NOTIFICATION_EMAILS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

interface SendArgs {
  to: string[];
  subject: string;
  html: string;
}

export interface SendResult {
  ok: boolean;
  /** Resend message id si succès. */
  id?: string;
  /** Code Resend ("validation_error", "rate_limit_exceeded"…) si échec. */
  errorName?: string;
  /** Message lisible si échec (ex: "domain not verified"). */
  errorMessage?: string;
  /** HTTP status retourné par Resend si applicable. */
  statusCode?: number;
  /** Raison d'un skip (no recipients, no api key). */
  skipReason?: 'no_api_key' | 'no_recipients';
}

/**
 * Envoi un email transactionnel via Resend. No-op si SDK pas configuré
 * (RESEND_API_KEY absent) ou destinataires vides.
 *
 * Retourne un SendResult détaillé pour le logging et l'endpoint de test
 * /api/admin/test-email. fix/email-notification-not-sent — anciennement
 * boolean, étendu pour propager statusCode + errorName + errorMessage
 * (Resend 403 "domain not verified" était silencieux côté caller).
 */
export async function sendNotificationEmail(args: SendArgs): Promise<SendResult> {
  const resend = getResend();
  if (!resend) {
    return { ok: false, skipReason: 'no_api_key' };
  }
  if (args.to.length === 0) {
    console.warn('[Email] No recipients, skip send');
    return { ok: false, skipReason: 'no_recipients' };
  }
  const from = getMailFrom();
  try {
    const result = await resend.emails.send({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
    });
    if (result.error) {
      // Resend SDK loggue déjà sa propre erreur, mais on expose une trace
      // explicite pour Railway logs avec from + to + subject pour pouvoir
      // diagnostiquer sans dump le payload html.
      const err = result.error as { message?: string; name?: string; statusCode?: number };
      console.error(
        `[Email] Resend rejected from="${from}" to="${args.to.join(',')}" subject="${args.subject}" → ${err.statusCode ?? '?'} ${err.name ?? 'error'}: ${err.message ?? 'unknown'}`,
      );
      // Hint actionnable pour le cas le plus fréquent (domaine non vérifié).
      if (err.statusCode === 403 && /domain.*not verified/i.test(err.message ?? '')) {
        console.error(
          `[Email] HINT: vérifie le domaine sur https://resend.com/domains, ou change MAIL_FROM vers un domaine déjà vérifié.`,
        );
      }
      return {
        ok: false,
        errorName: err.name,
        errorMessage: err.message,
        statusCode: err.statusCode,
      };
    }
    console.info(
      `[Email] Sent from="${from}" to="${args.to.join(',')}" subject="${args.subject}" id=${result.data?.id}`,
    );
    return { ok: true, id: result.data?.id };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[Email] Send threw from="${from}" to="${args.to.join(',')}" subject="${args.subject}":`,
      err,
    );
    return { ok: false, errorMessage: message };
  }
}

// ───── Templates ──────────────────────────────────────────────────────────

interface SignupNotifVars {
  email: string;
  name: string | null;
  locale: string;
  signupAt: Date;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!;
  });
}

export function renderSignupNotificationHtml(vars: SignupNotifVars): string {
  const dateFr = vars.signupAt.toLocaleString('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  });
  const e = escapeHtml(vars.email);
  const n = escapeHtml(vars.name ?? '—');
  const l = escapeHtml(vars.locale);
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fefae0;color:#1a1a1a">
  <h2 style="color:#7a8a9a;margin:0 0 16px">🎉 Nouvelle inscription Tutti</h2>
  <p>Une nouvelle personne vient de s'inscrire sur Tutti.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:8px 0;color:#666"><strong>Email :</strong></td><td style="padding:8px 0">${e}</td></tr>
    <tr><td style="padding:8px 0;color:#666"><strong>Nom :</strong></td><td style="padding:8px 0">${n}</td></tr>
    <tr><td style="padding:8px 0;color:#666"><strong>Date :</strong></td><td style="padding:8px 0">${dateFr}</td></tr>
    <tr><td style="padding:8px 0;color:#666"><strong>Tier :</strong></td><td style="padding:8px 0">Gratuit (par défaut)</td></tr>
    <tr><td style="padding:8px 0;color:#666"><strong>Locale :</strong></td><td style="padding:8px 0">${l}</td></tr>
  </table>
  <p style="margin-top:24px"><a href="https://tuttiparty.app/admin/users" style="background:#7a8a9a;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block">Voir le compte</a></p>
  <p style="color:#999;font-size:12px;margin-top:32px">Tutti — édité par Kleos Sàrl, Luxembourg</p>
</div>`;
}
