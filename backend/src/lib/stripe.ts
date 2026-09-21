/**
 * stripe.ts — feat/reservation-de-creneaux
 *
 * Paiement d'un créneau déjà ACCEPTÉ par le propriétaire.
 *
 * AUCUNE DÉPENDANCE AJOUTÉE : on parle à l'API REST de Stripe avec fetch et on
 * vérifie la signature du webhook avec le HMAC de Node. Ajouter le paquet
 * `stripe` aurait modifié le fichier de verrouillage de pnpm ; un verrou
 * désaligné bloque le build Railway, et un backend qui ne démarre pas, on a
 * déjà donné (13/09).
 *
 * TANT QUE LES CLÉS NE SONT PAS POSÉES, rien ne casse : `stripeConfigure()`
 * renvoie false, le bouton « Payer » annonce que le paiement n'est pas encore
 * ouvert, et tout le reste (demande, acceptation, codes gratuits) fonctionne.
 *
 * Variables à poser dans Railway par le propriétaire :
 *   STRIPE_SECRET_KEY       sk_live_… (ou sk_test_… pour essayer)
 *   STRIPE_WEBHOOK_SECRET   whsec_… (donné par Stripe à la création du webhook)
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const API = 'https://api.stripe.com/v1';

export function stripeConfigure(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * Stripe attend du `application/x-www-form-urlencoded` avec des clés imbriquées
 * à crochets : line_items[0][price_data][currency]=eur.
 */
export function encoderFormulaire(objet: Record<string, unknown>, prefixe = ''): string[] {
  const paires: string[] = [];
  for (const [cle, valeur] of Object.entries(objet)) {
    if (valeur === undefined || valeur === null) continue;
    const nom = prefixe ? `${prefixe}[${cle}]` : cle;
    if (Array.isArray(valeur)) {
      valeur.forEach((v, i) => {
        if (v !== null && typeof v === 'object') {
          paires.push(...encoderFormulaire(v as Record<string, unknown>, `${nom}[${i}]`));
        } else {
          paires.push(`${encodeURIComponent(`${nom}[${i}]`)}=${encodeURIComponent(String(v))}`);
        }
      });
    } else if (typeof valeur === 'object') {
      paires.push(...encoderFormulaire(valeur as Record<string, unknown>, nom));
    } else {
      paires.push(`${encodeURIComponent(nom)}=${encodeURIComponent(String(valeur))}`);
    }
  }
  return paires;
}

export interface CheckoutDemande {
  reservationId: string;
  montantCents: number;
  devise: string;
  libelle: string;
  emailClient: string | null;
  urlSucces: string;
  urlAnnulation: string;
}

/** Ouvre une page de paiement Stripe et renvoie son adresse. */
export async function creerCheckout(d: CheckoutDemande): Promise<{ id: string; url: string }> {
  const cle = process.env.STRIPE_SECRET_KEY;
  if (!cle) throw new StripeError("Le paiement en ligne n'est pas encore ouvert.");
  const corps = encoderFormulaire({
    mode: 'payment',
    success_url: d.urlSucces,
    cancel_url: d.urlAnnulation,
    client_reference_id: d.reservationId,
    customer_email: d.emailClient ?? undefined,
    // La réservation est retrouvée par ces métadonnées dans le webhook.
    metadata: { reservation_id: d.reservationId },
    payment_intent_data: { metadata: { reservation_id: d.reservationId } },
    // feat/stripe-facture-tva — FACTURE ET TVA (revue du 21/09 avec le
    // planificateur Stripe). Thomas : « on mettra un prix TTC ».
    //  - le prix saisi à l'acceptation est TTC : la TVA est DANS le prix
    //    (tax_behavior inclusive), Stripe Tax la calcule et l'affiche ;
    //  - le bar peut saisir son n° de TVA et sa raison sociale : ils figurent
    //    sur la facture ;
    //  - une facture PDF est générée après chaque paiement ;
    //  - adresse de facturation demandée (nécessaire au calcul de la TVA).
    // Paramètres validés par une vraie création de session en mode test.
    customer_creation: 'always',
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    automatic_tax: { enabled: true },
    invoice_creation: {
      enabled: true,
      invoice_data: {
        description: d.libelle,
        metadata: { reservation_id: d.reservationId },
      },
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: d.devise,
          unit_amount: d.montantCents,
          tax_behavior: 'inclusive',
          product_data: { name: d.libelle },
        },
      },
    ],
  }).join('&');

  const reponse = await fetch(`${API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cle}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // Deux clics sur « Payer » ne créent pas deux paiements.
      'Idempotency-Key': `reservation-v2-${d.reservationId}-${d.montantCents}`,
    },
    body: corps,
  });
  const json = (await reponse.json().catch(() => ({}))) as {
    id?: string;
    url?: string;
    error?: { message?: string };
  };
  if (!reponse.ok || !json.id || !json.url) {
    throw new StripeError(json.error?.message ?? `Stripe a répondu ${reponse.status}`, reponse.status);
  }
  return { id: json.id, url: json.url };
}

/**
 * Vérifie l'en-tête `Stripe-Signature` d'un webhook.
 *
 * Format : `t=1690000000,v1=<hex>[,v1=<hex>…]`. La signature attendue est le
 * HMAC-SHA256 de `${t}.${corps brut}` avec le secret du webhook. On refuse au
 * delà de `toleranceSec` d'écart pour empêcher le rejeu d'un vieil appel.
 *
 * Le CORPS BRUT est indispensable : le JSON re-sérialisé ne donnerait pas les
 * mêmes octets, et la signature ne correspondrait jamais.
 */
export function signatureValide(
  corpsBrut: Buffer | string,
  entete: string | undefined,
  secret: string,
  maintenantSec = Math.floor(Date.now() / 1000),
  toleranceSec = 300,
): boolean {
  if (!entete || !secret) return false;
  const morceaux = entete.split(',').map((p) => p.trim().split('='));
  const t = morceaux.find(([k]) => k === 't')?.[1];
  const signatures = morceaux.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
  if (!t || signatures.length === 0) return false;
  const horodatage = Number(t);
  if (!Number.isFinite(horodatage) || Math.abs(maintenantSec - horodatage) > toleranceSec) return false;

  const charge = Buffer.concat([Buffer.from(`${t}.`, 'utf8'), Buffer.isBuffer(corpsBrut) ? corpsBrut : Buffer.from(corpsBrut, 'utf8')]);
  const attendue = Buffer.from(createHmac('sha256', secret).update(charge).digest('hex'), 'utf8');
  return signatures.some((s) => {
    const recue = Buffer.from(s, 'utf8');
    return recue.length === attendue.length && timingSafeEqual(recue, attendue);
  });
}
