/**
 * routes/stripeWebhook.ts — feat/reservation-de-creneaux
 *
 * Stripe prévient ici quand un paiement est encaissé. C'est LA seule source
 * qui fait passer une réservation en PAYEE : le retour du navigateur sur
 * « paiement=ok » ne prouve rien (on peut taper l'adresse à la main).
 *
 * Monté AVANT express.json, avec express.raw : la signature porte sur les
 * octets exacts envoyés par Stripe.
 */
import express, { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { signatureValide } from '../lib/stripe.js';

const router: Router = Router();

router.post('/', express.raw({ type: 'application/json', limit: '1mb' }), async (req: Request, res: Response): Promise<void> => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[Stripe] webhook reçu mais STRIPE_WEBHOOK_SECRET absent — ignoré');
    res.status(503).send('webhook non configuré');
    return;
  }
  const corps = req.body as Buffer;
  if (!signatureValide(corps, req.header('stripe-signature'), secret)) {
    console.warn('[Stripe] signature de webhook REFUSÉE');
    res.status(400).send('signature invalide');
    return;
  }

  let evenement: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    evenement = JSON.parse(corps.toString('utf8'));
  } catch {
    res.status(400).send('corps illisible');
    return;
  }

  if (evenement.type === 'checkout.session.completed' || evenement.type === 'checkout.session.async_payment_succeeded') {
    const objet = evenement.data?.object ?? {};
    const checkoutId = typeof objet.id === 'string' ? objet.id : null;
    const paye = objet.payment_status === 'paid';
    const metadata = (objet.metadata ?? {}) as Record<string, unknown>;
    const reservationId = typeof metadata.reservation_id === 'string' ? metadata.reservation_id : null;
    const paymentIntent = typeof objet.payment_intent === 'string' ? objet.payment_intent : null;

    if (paye && reservationId) {
      // Idempotent : Stripe peut renvoyer le même événement plusieurs fois.
      // On ne bascule que depuis ACCEPTEE, et seulement pour CE paiement.
      const maj = await prisma.reservation.updateMany({
        where: {
          id: reservationId,
          statut: 'ACCEPTEE',
          ...(checkoutId ? { stripe_checkout_id: checkoutId } : {}),
        },
        data: { statut: 'PAYEE', payee_le: new Date(), stripe_payment_intent: paymentIntent },
      });
      console.info(
        `[Stripe] paiement encaissé réservation=${reservationId} checkout=${checkoutId} → ${maj.count ? 'PAYEE' : 'déjà traitée ou inconnue'}`,
      );
    }
  }
  // Toujours 200 une fois la signature vérifiée : sinon Stripe relance en boucle.
  res.json({ recu: true });
});

export default router;
