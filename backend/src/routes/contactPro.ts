/**
 * Routes /api/contact-pro — feat/contact-pro
 *
 * Thomas : « vous êtes professionnel bar / restauration / société
 * d'événementiel et vous souhaitez utiliser notre outil pour vos
 * établissements ? Contactez-nous ». Formulaire public (site) et formulaire
 * du back-office (client connecté). Le message part par e-mail à l'équipe
 * (réponse directe possible : reply-to = l'adresse du demandeur), et un
 * accusé de réception part au demandeur.
 *
 * Pas d'enregistrement en base : l'e-mail EST la trace. Limite : 5 envois
 * par heure et par adresse IP, pour éviter les robots.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getNotificationRecipients, sendNotificationEmail } from '../lib/email.js';

const router = Router();

const TYPES = ['bar', 'restaurant', 'evenementiel', 'entreprise', 'autre'] as const;
const LIBELLE_TYPE: Record<(typeof TYPES)[number], string> = {
  bar: 'Bar',
  restaurant: 'Restaurant',
  evenementiel: "Société d'événementiel",
  entreprise: 'Entreprise',
  autre: 'Autre',
};

const schema = z.object({
  nom: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  societe: z.string().trim().max(160).optional().default(''),
  type: z.enum(TYPES).default('autre'),
  telephone: z.string().trim().max(40).optional().default(''),
  message: z.string().trim().min(1).max(3000),
  source: z.enum(['site', 'compte']).default('site'),
  langue: z.enum(['fr', 'en']).default('fr'),
  /** Champ piège invisible : un humain le laisse vide. */
  site_web: z.string().max(200).optional().default(''),
});

const envois = new Map<string, number[]>();
function tropDEnvois(ip: string): boolean {
  const maintenant = Date.now();
  const recents = (envois.get(ip) ?? []).filter((t) => maintenant - t < 3600_000);
  if (recents.length >= 5) return true;
  recents.push(maintenant);
  envois.set(ip, recents);
  return false;
}

function echapper(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

router.post('/contact-pro', async (req: Request, res: Response): Promise<void> => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Vérifie ton nom, ton e-mail et ton message.' },
    });
    return;
  }
  const d = parsed.data;
  // Robot : on répond OK sans rien envoyer.
  if (d.site_web) {
    res.json({ ok: true });
    return;
  }
  const ip =
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'inconnue';
  if (tropDEnvois(ip)) {
    res.status(429).json({
      error: {
        code: 'TROP_DE_MESSAGES',
        message: 'Trop de messages envoyés. Réessaie dans une heure.',
      },
    });
    return;
  }

  const lignes: Array<[string, string]> = [
    ['Nom', d.nom],
    ['E-mail', d.email],
    ['Établissement / société', d.societe || '—'],
    ['Type', LIBELLE_TYPE[d.type]],
    ['Téléphone', d.telephone || '—'],
    ['Envoyé depuis', d.source === 'compte' ? 'le back-office (compte client)' : 'le site'],
  ];
  const html =
    `<div style="font-family:system-ui,sans-serif;max-width:600px">` +
    `<h2 style="margin:0 0 12px">Demande professionnelle Tutti</h2>` +
    `<table style="border-collapse:collapse">${lignes
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 12px 4px 0;color:#666">${k}</td><td style="padding:4px 0"><strong>${echapper(v)}</strong></td></tr>`,
      )
      .join('')}</table>` +
    `<p style="margin-top:16px;white-space:pre-wrap">${echapper(d.message)}</p>` +
    `<p style="color:#888;font-size:12px">Répondre à cet e-mail répond directement à ${echapper(d.email)}.</p></div>`;

  const res1 = await sendNotificationEmail({
    to: getNotificationRecipients(),
    subject: `[Tutti Pro] ${LIBELLE_TYPE[d.type]} — ${d.societe || d.nom}`,
    html,
    replyTo: d.email,
  });
  console.info(
    `[ContactPro] ${d.type} ${d.email} source=${d.source} → ${res1.ok ? 'envoyé' : (res1.skipReason ?? res1.errorMessage)}`,
  );
  if (!res1.ok) {
    res.status(502).json({
      error: {
        code: 'ENVOI_IMPOSSIBLE',
        message: 'Le message n’a pas pu partir. Écris-nous directement à contact@tuttiparty.app.',
      },
    });
    return;
  }

  const en = d.langue === 'en';
  void sendNotificationEmail({
    to: [d.email],
    subject: en ? 'Tutti — we got your message' : 'Tutti — nous avons bien reçu ton message',
    html:
      `<div style="font-family:system-ui,sans-serif;max-width:560px;padding:24px;background:#F6EEDF;color:#1D1813;line-height:1.6">` +
      (en
        ? `<p>Hi ${echapper(d.nom)},</p><p>Thanks for your message. We'll get back to you shortly to talk about using Tutti in your venue or for your events.</p><p>In the meantime, you can try it: create an account at <a href="https://tuttiparty.app/auth/signup">tuttiparty.app</a> and book a slot.</p><p>The Tutti team</p>`
        : `<p>Bonjour ${echapper(d.nom)},</p><p>Merci pour ton message. Nous revenons vers toi très vite pour parler de l’utilisation de Tutti dans ton établissement ou pour tes événements.</p><p>En attendant, tu peux l’essayer : crée un compte sur <a href="https://tuttiparty.app/auth/signup">tuttiparty.app</a> et réserve un créneau.</p><p>L’équipe Tutti</p>`) +
      `</div>`,
  }).catch(() => undefined);

  res.json({ ok: true });
});

export default router;
