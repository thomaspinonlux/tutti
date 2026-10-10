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
  /** Pièces jointes hébergées (Resend va chercher le fichier à l'URL `path`). */
  attachments?: Array<{ filename: string; path: string }>;
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
      ...(args.attachments?.length ? { attachments: args.attachments } : {}),
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

// ───── Welcome email (feat/welcome-email-user-signup) ─────────────────────
//
// Email envoyé directement au user juste après signup. Confirme la bonne
// réception de l'inscription + onboarding rapide en 4 étapes. Sujet :
//   FR : "Bienvenue sur Tutti — ton inscription est bien reçue"
//   EN : "Welcome to Tutti — your signup is confirmed"
//
// Sélection FR/EN basée sur args.locale (commence par "en" → EN, sinon FR).
// Réutilise le pipeline sendNotificationEmail (logs + Resend + SendResult).

interface WelcomeEmailVars {
  locale: string;
  /** feat/signup-firstname-lastname — utilisé pour la salutation perso. */
  firstName?: string | null;
}

/** Renvoie le sujet localisé. */
export function welcomeEmailSubject(locale: string): string {
  return locale.startsWith('en') ? 'Welcome to Tutti' : 'Bienvenue sur Tutti';
}

export function renderWelcomeEmailHtml(vars: WelcomeEmailVars): string {
  const en = vars.locale.startsWith('en');
  const prenom = vars.firstName?.trim();
  const bouton = (href: string, texte: string): string =>
    `<a href="${href}" style="background:#FF5C4D;color:#fff;padding:12px 22px;text-decoration:none;border-radius:999px;display:inline-block;font-weight:bold">${texte}</a>`;
  const cadre = (corps: string, pied: string): string =>
    `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:28px;background:#F6EEDF;color:#1D1813;line-height:1.6;font-size:15px">${corps}` +
    `<p style="color:#6B5E51;font-size:12px;margin-top:36px;border-top:1px solid #E3D6C2;padding-top:14px">${pied}</p></div>`;
  if (en) {
    return cadre(
      `<h1 style="font-size:24px;margin:0 0 12px">Welcome to Tutti 🎉</h1>` +
        `<p>${prenom ? `Hi ${escapeHtml(prenom)},` : 'Hi there,'}</p>` +
        `<p>Your sign-up is confirmed: you can book your night right now. Tutti is a blind test and quiz night on your TV: your guests play from their phones, with nothing to install.</p>` +
        `<h2 style="font-size:18px;margin:24px 0 6px">How it works</h2>` +
        `<ol style="padding-left:20px;margin:0">` +
        `<li>Book a slot: pick the day, start and end time, and pay by card.</li>` +
        `<li>On the day, the start button appears on your dashboard 30 minutes before.</li>` +
        `<li>Your guests scan the QR code on the TV and play.</li>` +
        `</ol>` +
        `<p style="margin-top:22px">${bouton('https://tuttiparty.app/admin/reserver', 'Book a game')}</p>` +
        `<p style="margin-top:18px">Everything is explained step by step in the <a href="https://tuttiparty.app/guide.html?lang=en" style="color:#C23B2E">user guide</a>.</p>`,
      `Tutti — Kleos Sàrl, Luxembourg<br/>A question? Reply to this email or write to contact@tuttiparty.app`,
    );
  }
  return cadre(
    `<h1 style="font-size:24px;margin:0 0 12px">Bienvenue sur Tutti 🎉</h1>` +
      `<p>${prenom ? `Salut ${escapeHtml(prenom)},` : 'Salut,'}</p>` +
      `<p>Ton inscription est bien reçue : tu peux réserver ta soirée dès maintenant. Tutti, c’est une soirée blind test et quiz sur ta télé : tes invités jouent avec leur téléphone, sans rien installer.</p>` +
      `<h2 style="font-size:18px;margin:24px 0 6px">Comment ça marche</h2>` +
      `<ol style="padding-left:20px;margin:0">` +
      `<li>Réserve un créneau : le jour, l’heure de début et de fin, puis paiement par carte.</li>` +
      `<li>Le jour J, le bouton de lancement apparaît sur ton tableau de bord 30 minutes avant.</li>` +
      `<li>Tes invités scannent le QR code sur la télé et jouent.</li>` +
      `</ol>` +
      `<p style="margin-top:22px">${bouton('https://tuttiparty.app/admin/reserver', 'Réserver une partie')}</p>` +
      `<p style="margin-top:18px">Tout est expliqué pas à pas dans le <a href="https://tuttiparty.app/guide.html?lang=fr" style="color:#C23B2E">mode d’emploi</a>.</p>`,
    `Tutti — Kleos Sàrl, Luxembourg<br/>Une question ? Réponds à cet e-mail ou écris à contact@tuttiparty.app`,
  );
}

// ───── Confirmation de réservation + mode d'emploi (feat/guide-reservation) ─
//
// Envoyé au client dès que son créneau est confirmé : paiement Stripe
// encaissé (webhook) ou partie offerte par code. Le mode d'emploi part en
// pièce jointe PDF et en lien vers la page du site (/guide.html).

export const GUIDE_URL = 'https://tuttiparty.app/guide.html';
export const GUIDE_PDF = {
  fr: {
    filename: 'Tutti-mode-emploi.pdf',
    path: 'https://tuttiparty.app/guide/tutti-mode-emploi-fr.pdf',
  },
  en: { filename: 'Tutti-user-guide.pdf', path: 'https://tuttiparty.app/guide/tutti-guide-en.pdf' },
} as const;

interface ConfirmationVars {
  locale: string;
  /** Texte du créneau, ex. « vendredi 17 octobre, 20:00 → 23:00 ». */
  creneau: string;
  /** null = partie offerte. */
  prixCents: number | null;
}

export function confirmationReservationEmail(vars: ConfirmationVars): {
  subject: string;
  html: string;
  attachments: Array<{ filename: string; path: string }>;
} {
  const en = vars.locale.startsWith('en');
  const creneau = escapeHtml(vars.creneau);
  const prix =
    vars.prixCents === null || vars.prixCents === 0
      ? null
      : en
        ? `€${(vars.prixCents / 100).toFixed(2)}`
        : `${(vars.prixCents / 100).toFixed(2).replace('.', ',')} €`;
  const bouton = (href: string, texte: string): string =>
    `<a href="${href}" style="background:#FF5C4D;color:#fff;padding:12px 22px;text-decoration:none;border-radius:999px;display:inline-block;font-weight:bold">${texte}</a>`;
  const cadre = (corps: string): string =>
    `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:28px;background:#F6EEDF;color:#1D1813;line-height:1.6;font-size:15px">${corps}` +
    `<p style="color:#6B5E51;font-size:12px;margin-top:36px;border-top:1px solid #E3D6C2;padding-top:14px">Tutti — Kleos Sàrl, Luxembourg · contact@tuttiparty.app</p></div>`;
  if (en) {
    return {
      subject: `Tutti — your game is booked (${vars.creneau})`,
      attachments: [GUIDE_PDF.en],
      html: cadre(
        `<h1 style="font-size:24px;margin:0 0 12px">Your game is booked 🎉</h1>` +
          `<p>Slot: <strong>${creneau}</strong>${prix ? ` — paid: <strong>${prix}</strong>` : ' — <strong>free game</strong>'}.</p>` +
          `<p>On the day, the start button appears on your dashboard <strong>30 minutes before</strong> the slot.</p>` +
          `<h2 style="font-size:18px;margin:24px 0 6px">Your user guide</h2>` +
          `<p>Everything you need for the night — connecting the TV, choosing who hosts, how points work — is in the guide attached to this email (PDF), and online:</p>` +
          `<p>${bouton(`${GUIDE_URL}?lang=en`, 'Read the user guide')}</p>` +
          `<p style="margin-top:20px">${bouton('https://tuttiparty.app/admin', 'My dashboard')}</p>`,
      ),
    };
  }
  return {
    subject: `Tutti — ta partie est réservée (${vars.creneau})`,
    attachments: [GUIDE_PDF.fr],
    html: cadre(
      `<h1 style="font-size:24px;margin:0 0 12px">Ta partie est réservée 🎉</h1>` +
        `<p>Créneau : <strong>${creneau}</strong>${prix ? ` — payé : <strong>${prix}</strong>` : ' — <strong>partie offerte</strong>'}.</p>` +
        `<p>Le jour J, le bouton de lancement apparaît sur ton tableau de bord <strong>30 minutes avant</strong> le début.</p>` +
        `<h2 style="font-size:18px;margin:24px 0 6px">Ton mode d’emploi</h2>` +
        `<p>Tout ce qu’il faut pour la soirée — brancher la télé, choisir qui anime, les règles des points — est dans le mode d’emploi joint à cet e-mail (PDF), et en ligne :</p>` +
        `<p>${bouton(`${GUIDE_URL}?lang=fr`, 'Lire le mode d’emploi')}</p>` +
        `<p style="margin-top:20px">${bouton('https://tuttiparty.app/admin', 'Mon tableau de bord')}</p>`,
    ),
  };
}
