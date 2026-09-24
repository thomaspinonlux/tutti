/**
 * ReservationsPage.tsx — feat/reservation-de-creneaux — CÔTÉ PROPRIÉTAIRE
 *
 * Thomas : « je donne mon accord sur le créneau […] et moi je garde toujours
 * un compte disponible ».
 *
 * Trois blocs : les demandes à traiter (accepter en fixant le prix, ou
 * refuser), le planning des créneaux confirmés, et les codes de parties
 * offertes. Plus les bornes de durée proposées aux clients.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input, TitleHandwritten, Underline } from '../../components/ui/index.js';
import {
  LIBELLE_STATUT,
  accepterReservation,
  annulerReservationGestion,
  creerCode,
  desactiverCode,
  ecrireReglagesGestion,
  lireReglagesGestion,
  listerCodes,
  listerReservations,
  refuserReservation,
  texteCreneau,
  texteMontant,
  type CodeGratuit,
  type ReservationGestion,
} from '../../lib/reservations.js';

export function ReservationsPage(): JSX.Element {
  const [lignes, setLignes] = useState<ReservationGestion[] | null>(null);
  const [capacite, setCapacite] = useState<number | null>(null);
  const [comptes, setComptes] = useState<number | null>(null);
  const [codes, setCodes] = useState<CodeGratuit[]>([]);
  const [prix, setPrix] = useState<Record<string, string>>({});
  const [nouveauCode, setNouveauCode] = useState({ note: '', utilisations: '1' });
  const [reglages, setReglages] = useState({
    min: '',
    max: '',
    ouverture: '',
    // feat/reservation-automatique — tarif horaire, en euros à l'écran.
    tarif: '',
    tarifSoir: '',
    heureSoir: '',
    joursSoir: '',
    auto: false,
    // feat/client-avec-son-compte — grille réduite + validation des comptes.
    tarifPropre: '',
    tarifPropreSoir: '',
    autoComptes: false,
    // feat/offre-de-lancement — remise affichée au client.
    reductionPct: '',
    reductionLibelle: '',
    reductionFin: '',
  });
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const recharger = useCallback(async (): Promise<void> => {
    try {
      const [r, c, g] = await Promise.all([
        listerReservations(),
        listerCodes(),
        lireReglagesGestion(),
      ]);
      setLignes(r.reservations);
      setCapacite(r.capacite);
      setComptes(r.comptes_actifs);
      setCodes(c.codes);
      setReglages({
        min: String(g.duree_min_minutes),
        max: String(g.duree_max_minutes),
        ouverture: String(g.ouverture_avant_minutes),
        tarif: (g.tarif_horaire_cents / 100).toFixed(2),
        tarifSoir: (g.tarif_horaire_soir_cents / 100).toFixed(2),
        heureSoir: String(g.heure_soiree_debut),
        joursSoir: g.jours_soiree,
        auto: g.validation_automatique,
        tarifPropre: (g.tarif_horaire_propre_cents / 100).toFixed(2),
        tarifPropreSoir: (g.tarif_horaire_propre_soir_cents / 100).toFixed(2),
        autoComptes: g.validation_auto_comptes,
        reductionPct: String(g.reduction_pct),
        reductionLibelle: g.reduction_libelle,
        reductionFin: g.reduction_fin ? g.reduction_fin.slice(0, 10) : '',
      });
    } catch (err: unknown) {
      setErreur((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void recharger();
  }, [recharger]);

  const agir = async (action: () => Promise<unknown>, message?: string): Promise<void> => {
    setOccupe(true);
    setErreur(null);
    setInfo(null);
    try {
      await action();
      if (message) setInfo(message);
      await recharger();
    } catch (err: unknown) {
      setErreur((err as Error).message);
    } finally {
      setOccupe(false);
    }
  };

  const accepter = (r: ReservationGestion): void => {
    if (r.code_gratuit) {
      void agir(() => accepterReservation(r.id, 0), 'Acceptée — partie offerte (code).');
      return;
    }
    const saisi = (prix[r.id] ?? '').replace(',', '.').trim();
    const euros = Number(saisi);
    if (saisi === '' || !Number.isFinite(euros) || euros < 0) {
      setErreur('Indique un prix en euros (0 pour offrir la partie).');
      return;
    }
    const cents = Math.round(euros * 100);
    void agir(
      () => accepterReservation(r.id, cents),
      cents === 0
        ? 'Acceptée — partie offerte.'
        : `Acceptée à ${texteMontant(cents)} : le client est prévenu par e-mail.`,
    );
  };

  const refuser = (r: ReservationGestion): void => {
    const motif = window.prompt('Motif du refus (facultatif, envoyé au client) :') ?? undefined;
    void agir(
      () => refuserReservation(r.id, motif || undefined),
      'Demande refusée, client prévenu.',
    );
  };

  const annuler = (r: ReservationGestion): void => {
    if (!window.confirm(`Annuler la réservation de ${r.client} ?`)) return;
    void agir(async () => {
      const res = await annulerReservationGestion(r.id);
      if (res.rembourser_dans_stripe) {
        window.alert(
          'Cette réservation était payée : pense à rembourser le client depuis ton tableau de bord Stripe.',
        );
      }
    }, 'Réservation annulée.');
  };

  const demandes = (lignes ?? []).filter((r) => r.statut === 'DEMANDEE');
  const planning = (lignes ?? []).filter(
    (r) =>
      ['ACCEPTEE', 'PAYEE', 'GRATUITE'].includes(r.statut) &&
      new Date(r.fin).getTime() > Date.now(),
  );

  return (
    <div className="max-w-5xl mx-auto">
      <TitleHandwritten as="h1" className="mb-2">
        <Underline>Réservations</Underline>
      </TitleHandwritten>
      <p className="font-editorial text-sm text-ink-soft mb-6">
        {comptes !== null && capacite !== null
          ? `${comptes} compte${comptes > 1 ? 's' : ''} Apple Music actif${comptes > 1 ? 's' : ''} : ${capacite} partie${capacite > 1 ? 's' : ''} client${capacite > 1 ? 's' : ''} en même temps au maximum, un compte reste à la brasserie.`
          : 'Chargement…'}
      </p>

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

      <Card size="lg" className="mb-6">
        <h2 className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-3">
          Demandes à traiter ({demandes.length})
        </h2>
        {demandes.length === 0 ? (
          <p className="font-editorial italic text-sm text-ink-soft">Aucune demande en attente.</p>
        ) : (
          <ul className="divide-y divide-cream-4">
            {demandes.map((r) => (
              <li key={r.id} className="py-3 flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[240px]">
                  <p className="font-mono text-sm">{texteCreneau(r.debut, r.fin)}</p>
                  <p className="font-mono text-[11px] text-ink-soft">
                    {r.client} · {r.email ?? 'e-mail inconnu'}
                    {r.code_gratuit && ` · code ${r.code_gratuit}`}
                  </p>
                  {r.message_client && (
                    <p className="font-editorial text-xs mt-1">« {r.message_client} »</p>
                  )}
                </div>
                {!r.code_gratuit && (
                  <div className="w-32">
                    <Input
                      dark
                      label="Prix (€)"
                      inputMode="decimal"
                      value={prix[r.id] ?? ''}
                      onChange={(e) => setPrix((p) => ({ ...p, [r.id]: e.target.value }))}
                      placeholder="0 = offert"
                      disabled={occupe}
                    />
                  </div>
                )}
                <Button onClick={() => accepter(r)} disabled={occupe}>
                  {r.code_gratuit ? 'Accepter (offerte)' : 'Accepter'}
                </Button>
                <Button variant="ghost" onClick={() => refuser(r)} disabled={occupe}>
                  Refuser
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card size="lg" className="mb-6">
        <h2 className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-3">
          Planning confirmé ({planning.length})
        </h2>
        {planning.length === 0 ? (
          <p className="font-editorial italic text-sm text-ink-soft">Aucun créneau à venir.</p>
        ) : (
          <ul className="divide-y divide-cream-4">
            {planning.map((r) => (
              <li key={r.id} className="py-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[240px]">
                  <p className="font-mono text-sm">{texteCreneau(r.debut, r.fin)}</p>
                  <p className="font-mono text-[11px] text-ink-soft">
                    {r.client} · {LIBELLE_STATUT[r.statut]} · {texteMontant(r.prix_cents)}
                  </p>
                </div>
                <Button variant="ghost" onClick={() => annuler(r)} disabled={occupe}>
                  Annuler
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card size="lg" className="mb-6">
        <h2 className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-3">
          Codes parties offertes
        </h2>
        <div className="flex flex-wrap gap-3 items-end mb-4">
          <div className="flex-1 min-w-[200px]">
            <Input
              dark
              label="Pour qui / pourquoi"
              value={nouveauCode.note}
              onChange={(e) => setNouveauCode((c) => ({ ...c, note: e.target.value }))}
              placeholder="Anniversaire Julie, partenaire…"
              disabled={occupe}
            />
          </div>
          <div className="w-32">
            <Input
              dark
              label="Utilisations"
              inputMode="numeric"
              value={nouveauCode.utilisations}
              onChange={(e) => setNouveauCode((c) => ({ ...c, utilisations: e.target.value }))}
              disabled={occupe}
            />
          </div>
          <Button
            onClick={() =>
              void agir(async () => {
                const n = Math.max(
                  1,
                  Math.min(1000, Number.parseInt(nouveauCode.utilisations, 10) || 1),
                );
                const cree = await creerCode({
                  note: nouveauCode.note.trim() || undefined,
                  utilisations_max: n,
                });
                setNouveauCode({ note: '', utilisations: '1' });
                setInfo(`Code créé : ${cree.code.code}`);
              })
            }
            disabled={occupe}
          >
            Créer un code
          </Button>
        </div>
        {codes.length === 0 ? (
          <p className="font-editorial italic text-sm text-ink-soft">Aucun code.</p>
        ) : (
          <ul className="divide-y divide-cream-4">
            {codes.map((c) => (
              <li key={c.id} className="py-2 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[220px]">
                  <p className="font-mono text-sm select-all">{c.code}</p>
                  <p className="font-mono text-[11px] text-ink-soft">
                    {c.utilisations}/{c.utilisations_max} utilisé{c.utilisations_max > 1 ? 's' : ''}
                    {c.note && ` · ${c.note}`}
                    {!c.actif && ' · désactivé'}
                  </p>
                </div>
                {c.actif && (
                  <Button
                    variant="ghost"
                    onClick={() => void agir(() => desactiverCode(c.id), 'Code désactivé.')}
                    disabled={occupe}
                  >
                    Désactiver
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card size="lg">
        <h2 className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-3">Réglages</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="w-44">
            <Input
              dark
              label="Durée min (minutes)"
              inputMode="numeric"
              value={reglages.min}
              onChange={(e) => setReglages((g) => ({ ...g, min: e.target.value }))}
              disabled={occupe}
            />
          </div>
          <div className="w-44">
            <Input
              dark
              label="Durée max (minutes)"
              inputMode="numeric"
              value={reglages.max}
              onChange={(e) => setReglages((g) => ({ ...g, max: e.target.value }))}
              disabled={occupe}
            />
          </div>
          <div className="w-52">
            <Input
              dark
              label="Ouverture avant (minutes)"
              inputMode="numeric"
              value={reglages.ouverture}
              onChange={(e) => setReglages((g) => ({ ...g, ouverture: e.target.value }))}
              disabled={occupe}
            />
          </div>
          <div className="w-44">
            <Input
              dark
              label="Tarif horaire (€)"
              inputMode="decimal"
              value={reglages.tarif}
              onChange={(e) => setReglages((g) => ({ ...g, tarif: e.target.value }))}
              disabled={occupe}
            />
          </div>
          <div className="w-52">
            <Input
              dark
              label="Tarif horaire soirée (€)"
              inputMode="decimal"
              value={reglages.tarifSoir}
              onChange={(e) => setReglages((g) => ({ ...g, tarifSoir: e.target.value }))}
              disabled={occupe}
            />
          </div>
          <div className="w-40">
            <Input
              dark
              label="Soirée à partir de (h)"
              inputMode="numeric"
              value={reglages.heureSoir}
              onChange={(e) => setReglages((g) => ({ ...g, heureSoir: e.target.value }))}
              disabled={occupe}
            />
          </div>
          <div className="w-48">
            <Input
              dark
              label="Jours soirée (1=lundi)"
              value={reglages.joursSoir}
              onChange={(e) => setReglages((g) => ({ ...g, joursSoir: e.target.value }))}
              disabled={occupe}
            />
          </div>
          <div className="w-52">
            <Input
              dark
              label="Tarif compte du client (€/h)"
              inputMode="decimal"
              value={reglages.tarifPropre}
              onChange={(e) => setReglages((g) => ({ ...g, tarifPropre: e.target.value }))}
              disabled={occupe}
            />
          </div>
          <div className="w-56">
            <Input
              dark
              label="Tarif compte du client soirée (€/h)"
              inputMode="decimal"
              value={reglages.tarifPropreSoir}
              onChange={(e) => setReglages((g) => ({ ...g, tarifPropreSoir: e.target.value }))}
              disabled={occupe}
            />
          </div>
          {/* feat/offre-de-lancement — remise affichée, prix plein barré. */}
          <div className="w-32">
            <Input
              dark
              label="Remise (%)"
              inputMode="numeric"
              value={reglages.reductionPct}
              onChange={(e) => setReglages((g) => ({ ...g, reductionPct: e.target.value }))}
              disabled={occupe}
            />
          </div>
          <div className="w-60">
            <Input
              dark
              label="Nom de l’offre"
              value={reglages.reductionLibelle}
              onChange={(e) => setReglages((g) => ({ ...g, reductionLibelle: e.target.value }))}
              disabled={occupe}
            />
          </div>
          <div className="w-48">
            <Input
              dark
              type="date"
              label="Fin de l’offre"
              value={reglages.reductionFin}
              onChange={(e) => setReglages((g) => ({ ...g, reductionFin: e.target.value }))}
              disabled={occupe}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={reglages.auto}
              onChange={(e) => setReglages((g) => ({ ...g, auto: e.target.checked }))}
              disabled={occupe}
            />
            Réservation et validation automatiques
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={reglages.autoComptes}
              onChange={(e) => setReglages((g) => ({ ...g, autoComptes: e.target.checked }))}
              disabled={occupe}
            />
            Valider les nouveaux comptes automatiquement
          </label>
          <Button
            onClick={() =>
              void agir(
                () =>
                  ecrireReglagesGestion({
                    duree_min_minutes: Number.parseInt(reglages.min, 10),
                    duree_max_minutes: Number.parseInt(reglages.max, 10),
                    ouverture_avant_minutes: Number.parseInt(reglages.ouverture, 10),
                    tarif_horaire_cents: Math.round(Number(reglages.tarif.replace(',', '.')) * 100),
                    tarif_horaire_soir_cents: Math.round(
                      Number(reglages.tarifSoir.replace(',', '.')) * 100,
                    ),
                    heure_soiree_debut: Number.parseInt(reglages.heureSoir, 10),
                    jours_soiree: reglages.joursSoir.trim(),
                    validation_automatique: reglages.auto,
                    tarif_horaire_propre_cents: Math.round(
                      Number(reglages.tarifPropre.replace(',', '.') || '0') * 100,
                    ),
                    tarif_horaire_propre_soir_cents: Math.round(
                      Number(reglages.tarifPropreSoir.replace(',', '.') || '0') * 100,
                    ),
                    validation_auto_comptes: reglages.autoComptes,
                    reduction_pct: Number.parseInt(reglages.reductionPct || '0', 10),
                    reduction_libelle: reglages.reductionLibelle.trim(),
                    reduction_fin: reglages.reductionFin
                      ? new Date(`${reglages.reductionFin}T23:59:59`).toISOString()
                      : null,
                  }),
                'Réglages enregistrés.',
              )
            }
            disabled={occupe}
          >
            Enregistrer
          </Button>
        </div>
        <p className="font-editorial italic text-sm text-ink-soft mt-3">
          Tarif horaire à 0 € = pas de réservation automatique : chaque demande attend ton accord et
          ton prix. Le tarif « compte du client » s’applique aux maisons que tu as basculées sur
          leur propre abonnement Apple Music (page Utilisateurs) ; à 0 €, elles paient la grille
          normale. Une remise supérieure à 0 % affiche partout le prix plein barré et le nom de
          l’offre.
        </p>
      </Card>
    </div>
  );
}
