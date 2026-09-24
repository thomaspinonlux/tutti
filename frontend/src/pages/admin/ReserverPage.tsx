/**
 * ReserverPage.tsx — feat/reservation-de-creneaux — CÔTÉ CLIENT
 *
 * Thomas : « je veux que les clients qui veulent acheter une partie puissent
 * se connecter, payer et choisir leur créneau ».
 *
 * Le client choisit un jour, une heure de début et une heure de fin (durée
 * libre entre les bornes réglées par le propriétaire), ajoute s'il en a un
 * code de partie offerte, et envoie. Le propriétaire accepte en fixant le
 * prix ; le client revient ici payer.
 *
 * Accessible aux comptes EN ATTENTE : c'est par cette demande qu'un nouveau
 * client se fait connaître.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, Input, TitleHandwritten, Underline } from '../../components/ui/index.js';
import {
  LIBELLE_STATUT,
  annulerMaReservation,
  demanderCreneau,
  lireReglagesReservation,
  mesReservations,
  payerReservation,
  texteCreneau,
  texteMontant,
  verifierDisponibilite,
  devisCreneau,
  type Devis,
  type ReglagesPublics,
  type Reservation,
} from '../../lib/reservations.js';

/** « 12,00 € ». */
function euros(cents: number): string {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

/** « 3 novembre ». */
function texteJour(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

/** Tarif horaire : prix plein barré dès qu'une offre tourne. */
function TarifHoraire({ cents, pct }: { cents: number; pct: number }): JSX.Element {
  if (pct <= 0) return <strong>{euros(cents)}</strong>;
  return (
    <>
      <span className="line-through opacity-60">{euros(cents)}</span>{' '}
      <strong className="text-basil not-italic">
        {euros(Math.round((cents * (100 - pct)) / 100))}
      </strong>
    </>
  );
}

function dureeLisible(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

/** Jour + heures saisis → bornes du créneau. Une fin avant le début = le lendemain. */
function bornes(jour: string, debut: string, fin: string): { debut: Date; fin: Date } | null {
  if (!jour || !debut || !fin) return null;
  const d = new Date(`${jour}T${debut}`);
  let f = new Date(`${jour}T${fin}`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(f.getTime())) return null;
  if (f.getTime() <= d.getTime()) f = new Date(f.getTime() + 24 * 3600_000);
  return { debut: d, fin: f };
}

export function ReserverPage(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const [reglages, setReglages] = useState<ReglagesPublics | null>(null);
  const [liste, setListe] = useState<Reservation[] | null>(null);
  const [jour, setJour] = useState('');
  const [heureDebut, setHeureDebut] = useState('20:00');
  const [heureFin, setHeureFin] = useState('23:00');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [libre, setLibre] = useState<boolean | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // feat/reservation-automatique — prix calculé pendant la saisie.
  const [devis, setDevis] = useState<Devis | null>(null);
  const prixCents = devis?.prix_cents ?? null;

  const recharger = useCallback(async (): Promise<void> => {
    try {
      const [r, m] = await Promise.all([lireReglagesReservation(), mesReservations()]);
      setReglages(r);
      setListe(m.reservations);
    } catch (err: unknown) {
      setErreur((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void recharger();
  }, [recharger]);

  // Retour de Stripe. Le paiement n'est CONFIRMÉ que par Stripe côté serveur :
  // on l'annonce comme en cours, et on relit la liste quelques secondes après.
  useEffect(() => {
    const retour = params.get('paiement');
    if (!retour) return;
    if (retour === 'ok') {
      setInfo('Paiement reçu par Stripe — la confirmation arrive dans quelques secondes.');
      const id = window.setTimeout(() => void recharger(), 4000);
      return () => window.clearTimeout(id);
    }
    if (retour === 'annule')
      setErreur('Paiement annulé. Ta réservation reste acceptée : tu peux la payer plus tard.');
    params.delete('paiement');
    params.delete('r');
    setParams(params, { replace: true });
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const creneau = useMemo(() => bornes(jour, heureDebut, heureFin), [jour, heureDebut, heureFin]);
  const dureeMinutes = creneau
    ? Math.round((creneau.fin.getTime() - creneau.debut.getTime()) / 60_000)
    : 0;
  const dureeHorsBornes =
    !!creneau &&
    !!reglages &&
    (dureeMinutes < reglages.duree_min_minutes || dureeMinutes > reglages.duree_max_minutes);

  // Disponibilité vérifiée pendant la saisie, pour ne pas envoyer pour rien.
  useEffect(() => {
    setLibre(null);
    if (!creneau || dureeHorsBornes) return;
    const id = window.setTimeout(() => {
      verifierDisponibilite(creneau.debut.toISOString(), creneau.fin.toISOString())
        .then((r) => setLibre(r.libre))
        .catch(() => setLibre(null));
    }, 400);
    return () => window.clearTimeout(id);
  }, [creneau, dureeHorsBornes]);

  // Le prix suit le créneau saisi, comme la disponibilité.
  useEffect(() => {
    setDevis(null);
    if (!creneau || dureeHorsBornes || !reglages?.tarif_horaire_cents) return;
    const id = window.setTimeout(() => {
      devisCreneau(creneau.debut.toISOString(), creneau.fin.toISOString())
        .then(setDevis)
        .catch(() => setDevis(null));
    }, 400);
    return () => window.clearTimeout(id);
  }, [creneau, dureeHorsBornes, reglages]);

  const auto = !!reglages?.reservation_automatique;
  const gratuitAvecCode = code.trim().length > 0;

  const envoyer = async (): Promise<void> => {
    if (!creneau) {
      setErreur('Choisis un jour, une heure de début et une heure de fin.');
      return;
    }
    setOccupe(true);
    setErreur(null);
    setInfo(null);
    try {
      const { reservation } = await demanderCreneau({
        debut: creneau.debut.toISOString(),
        fin: creneau.fin.toISOString(),
        message: message.trim() || undefined,
        code: code.trim() || undefined,
      });
      setCode('');
      setMessage('');
      // Réservation automatique : on enchaîne directement sur le paiement.
      if (reservation.statut === 'ACCEPTEE' && (reservation.prix_cents ?? 0) > 0) {
        const { url } = await payerReservation(reservation.id);
        window.location.href = url;
        return;
      }
      setInfo(
        reservation.statut === 'GRATUITE'
          ? 'Créneau confirmé — partie offerte. À très vite !'
          : 'Demande envoyée. Tu recevras un e-mail dès qu’elle sera acceptée.',
      );
      await recharger();
    } catch (err: unknown) {
      setErreur((err as Error).message);
    } finally {
      setOccupe(false);
    }
  };

  const payer = async (id: string): Promise<void> => {
    setOccupe(true);
    setErreur(null);
    try {
      const { url } = await payerReservation(id);
      window.location.href = url;
    } catch (err: unknown) {
      setErreur((err as Error).message);
      setOccupe(false);
    }
  };

  const annuler = async (id: string): Promise<void> => {
    if (!window.confirm('Annuler cette réservation ?')) return;
    setOccupe(true);
    try {
      await annulerMaReservation(id);
      await recharger();
    } catch (err: unknown) {
      setErreur((err as Error).message);
    } finally {
      setOccupe(false);
    }
  };

  const aujourdhui = new Date().toISOString().slice(0, 10);

  return (
    <div className="max-w-3xl mx-auto">
      <TitleHandwritten as="h1" className="mb-2">
        <Underline>Réserver une partie</Underline>
      </TitleHandwritten>
      <p className="font-editorial text-sm text-ink-soft mb-6">
        Choisis ton créneau et envoie ta demande. Nous la validons, puis tu règles en ligne. Le jour
        J, tu ouvres ta partie depuis ton compte
        {reglages ? ` jusqu’à ${reglages.ouverture_avant_minutes} min avant le début` : ''}.
      </p>

      {reglages?.reservation_automatique && (
        <Card size="lg" className="mb-6">
          <p className="font-mono text-sm">
            Réservation immédiate : choisis ton créneau, paie en ligne, et joue. Pas d’accord à
            attendre.
          </p>
          <p className="font-editorial italic text-sm text-ink-soft mt-1">
            Tarif à l’heure :{' '}
            <TarifHoraire cents={reglages.tarif_horaire_cents} pct={reglages.reduction_pct} /> de
            l’heure,{' '}
            <TarifHoraire cents={reglages.tarif_horaire_soir_cents} pct={reglages.reduction_pct} />{' '}
            à partir de {reglages.heure_soiree_debut} h le vendredi et le samedi.
          </p>
          {/* feat/offre-de-lancement — la remise se voit, elle ne se devine pas. */}
          {reglages.reduction_pct > 0 && (
            <p className="font-mono text-sm text-basil mt-2">
              <span className="inline-block rounded-full bg-basil px-2 py-0.5 text-xs text-white mr-2">
                −{reglages.reduction_pct} %
              </span>
              {reglages.reduction_libelle || 'Offre spéciale'}
              {reglages.reduction_fin && ` — jusqu’au ${texteJour(reglages.reduction_fin)}`}
            </p>
          )}
        </Card>
      )}

      {reglages && reglages.capacite === 0 && (
        <Card size="lg" className="mb-6">
          <p className="font-mono text-sm text-raspberry">
            Les réservations ne sont pas ouvertes pour le moment.
          </p>
        </Card>
      )}

      <Card size="lg" className="mb-6">
        <h2 className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-4">
          Nouveau créneau
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <label className="block">
            <span className="block text-xs font-mono uppercase tracking-wider mb-1 text-white/50">
              Jour
            </span>
            <input
              type="date"
              min={aujourdhui}
              value={jour}
              onChange={(e) => setJour(e.target.value)}
              disabled={occupe}
              className="w-full px-3 py-2 border-2 rounded bg-white/[0.06] border-white/10 text-white [color-scheme:dark]"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-mono uppercase tracking-wider mb-1 text-white/50">
              Début
            </span>
            <input
              type="time"
              step={900}
              value={heureDebut}
              onChange={(e) => setHeureDebut(e.target.value)}
              disabled={occupe}
              className="w-full px-3 py-2 border-2 rounded bg-white/[0.06] border-white/10 text-white [color-scheme:dark]"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-mono uppercase tracking-wider mb-1 text-white/50">
              Fin
            </span>
            <input
              type="time"
              step={900}
              value={heureFin}
              onChange={(e) => setHeureFin(e.target.value)}
              disabled={occupe}
              className="w-full px-3 py-2 border-2 rounded bg-white/[0.06] border-white/10 text-white [color-scheme:dark]"
            />
          </label>
        </div>

        {creneau && (
          <p className="font-mono text-xs mb-3">
            {texteCreneau(creneau.debut.toISOString(), creneau.fin.toISOString())} ·{' '}
            {dureeLisible(dureeMinutes)}
            {dureeHorsBornes && reglages && (
              <span className="text-raspberry">
                {' '}
                — durée entre {dureeLisible(reglages.duree_min_minutes)} et{' '}
                {dureeLisible(reglages.duree_max_minutes)}
              </span>
            )}
            {!dureeHorsBornes && libre === true && (
              <span className="text-basil"> — disponible</span>
            )}
            {!dureeHorsBornes && libre === false && (
              <span className="text-raspberry"> — complet sur cet horaire</span>
            )}
          </p>
        )}

        {/* feat/reservation-automatique — le prix s'affiche avant d'envoyer. */}
        {prixCents !== null && !dureeHorsBornes && (
          <p className="font-mono text-sm mb-3">
            Prix :{' '}
            {devis && devis.reduction_pct > 0 && devis.prix_plein_cents !== null && (
              <span className="text-ink-soft line-through mr-2">
                {euros(devis.prix_plein_cents)}
              </span>
            )}
            <strong>{euros(prixCents)}</strong> TTC
            {devis && devis.reduction_pct > 0 && (
              <span className="text-basil">
                {' '}
                — {devis.reduction_libelle || 'Offre spéciale'} −{devis.reduction_pct} % (tu
                économises {euros((devis.prix_plein_cents ?? 0) - prixCents)})
              </span>
            )}
            {gratuitAvecCode && <span className="text-basil"> — offert avec ton code</span>}
            {auto && !gratuitAvecCode && (
              <span className="text-ink-soft"> · paiement à l’étape suivante</span>
            )}
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <Input
            dark
            label="Code partie offerte (facultatif)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="TUTTI-XXXX-XXXX"
            disabled={occupe}
          />
          <Input
            dark
            label="Message (facultatif)"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Anniversaire, nombre de joueurs…"
            disabled={occupe}
          />
        </div>
        <Button
          onClick={() => void envoyer()}
          disabled={
            occupe || !creneau || dureeHorsBornes || libre === false || reglages?.capacite === 0
          }
        >
          {occupe
            ? 'Envoi…'
            : auto && !gratuitAvecCode
              ? 'Réserver et payer'
              : 'Demander ce créneau'}
        </Button>
      </Card>

      {erreur && (
        <Card size="lg" className="mb-6">
          <p className="font-mono text-sm text-raspberry">{erreur}</p>
        </Card>
      )}
      {info && (
        <Card size="lg" className="mb-6">
          <p className="font-mono text-sm">{info}</p>
        </Card>
      )}

      <Card size="lg">
        <h2 className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-3">
          Mes réservations
        </h2>
        {liste === null ? (
          <p className="font-mono text-sm text-ink-soft">Chargement…</p>
        ) : liste.length === 0 ? (
          <p className="font-editorial italic text-sm text-ink-soft">
            Aucune réservation pour l’instant.
          </p>
        ) : (
          <ul className="divide-y divide-cream-4">
            {liste.map((r) => (
              <li key={r.id} className="py-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[220px]">
                  <p className="font-mono text-sm">{texteCreneau(r.debut, r.fin)}</p>
                  <p className="font-mono text-[11px] text-ink-soft">
                    {LIBELLE_STATUT[r.statut]}
                    {r.prix_cents !== null && ` · ${texteMontant(r.prix_cents)}`}
                    {r.code_gratuit && ' · code offert'}
                    {r.statut === 'REFUSEE' && r.motif_refus && ` · ${r.motif_refus}`}
                  </p>
                </div>
                {r.statut === 'ACCEPTEE' && (r.prix_cents ?? 0) > 0 && (
                  <Button
                    onClick={() => void payer(r.id)}
                    disabled={occupe || !reglages?.paiement_ouvert}
                  >
                    {reglages?.paiement_ouvert
                      ? `Payer ${texteMontant(r.prix_cents)}`
                      : 'Paiement bientôt ouvert'}
                  </Button>
                )}
                {(r.statut === 'DEMANDEE' || r.statut === 'ACCEPTEE') && (
                  <Button variant="ghost" onClick={() => void annuler(r.id)} disabled={occupe}>
                    Annuler
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
