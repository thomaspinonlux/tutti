/**
 * ComptesApplePage.tsx — feat/parc-comptes-apple
 *
 * Parc de comptes Apple Music partagés. RÉSERVÉ AU PROPRIÉTAIRE : cet écran
 * n'apparaît pas pour les clients, et l'API le refuse de toute façon
 * (requireOwner). Les personnes qui lancent une partie ne voient jamais cette
 * page ni le compte qui leur est attribué — la réservation est automatique.
 *
 * Un abonnement Apple Music = UN flux. Six comptes = six soirées en parallèle.
 *
 * AUCUN MOT DE PASSE : Apple ne délivre de Music User Token que par
 * MusicKit.authorize(), donc une connexion faite dans SA fenêtre. On ne
 * récupère et ne conserve que ce jeton.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input, TitleHandwritten, Underline } from '../../components/ui/index.js';
import {
  ajouterCompteApple,
  listerComptesApple,
  majCompteApple,
  resignerCompteApple,
  supprimerCompteApple,
  type CompteApple,
  type EtatParc,
} from '../../lib/appleMusic.js';

export function ComptesApplePage(): JSX.Element {
  const [comptes, setComptes] = useState<CompteApple[] | null>(null);
  const [etat, setEtat] = useState<EtatParc | null>(null);
  const [libelle, setLibelle] = useState('');
  const [email, setEmail] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const recharger = useCallback(async (): Promise<void> => {
    try {
      const d = await listerComptesApple();
      setComptes(d.comptes);
      setEtat(d.etat);
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

  const ajouter = (): void => {
    const nom = libelle.trim();
    if (!nom) {
      setErreur('Donnez un nom à ce compte (« Compte 1 », « Bar Nord »…).');
      return;
    }
    void agir(async () => {
      await ajouterCompteApple(nom, email.trim() || undefined);
      setLibelle('');
      setEmail('');
    }, `Compte « ${nom} » ajouté au parc.`);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <TitleHandwritten as="h1" className="mb-2">
        <Underline>Comptes Apple Music</Underline>
      </TitleHandwritten>
      <p className="font-editorial text-sm text-ink-soft mb-6">
        Un abonnement Apple Music ne diffuse qu&apos;un seul flux à la fois. Pour faire tourner
        plusieurs soirées en même temps, il faut autant de comptes que de parties simultanées.
        Chaque partie en réserve un automatiquement et le rend à la fin — les personnes qui lancent
        une partie ne voient rien de tout ça.
      </p>

      {etat && (
        <Card size="lg" className="mb-6">
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-ink-soft mb-1">
                Comptes actifs
              </p>
              <p className="font-mono text-2xl">{etat.total}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-ink-soft mb-1">
                Parties en cours
              </p>
              <p className="font-mono text-2xl">{etat.occupes}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-ink-soft mb-1">
                Parties possibles maintenant
              </p>
              <p className="font-mono text-2xl">{etat.disponibles}</p>
            </div>
          </div>
          {etat.total === 0 && (
            <p className="font-editorial italic text-sm text-ink-soft border-l-2 border-cream-4 pl-3 mt-4">
              Aucun compte enregistré : les parties utilisent le compte Apple Music connecté dans
              les réglages, et une seule peut tourner à la fois.
            </p>
          )}
        </Card>
      )}

      <Card size="lg" className="mb-6">
        <h2 className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-3">
          Ajouter un compte
        </h2>
        <p className="font-editorial text-sm text-ink-soft mb-4">
          La fenêtre Apple va s&apos;ouvrir : connectez-vous avec <strong>le compte à
          enregistrer</strong>. Aucun mot de passe ne nous est transmis ni conservé — Apple ne nous
          renvoie qu&apos;un jeton d&apos;accès.
        </p>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[180px]">
            <label className="font-mono text-[10px] uppercase tracking-wider text-ink-soft block mb-1">
              Nom du compte
            </label>
            <Input
              value={libelle}
              onChange={(e) => setLibelle(e.target.value)}
              placeholder="Compte 1"
              disabled={occupe}
            />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="font-mono text-[10px] uppercase tracking-wider text-ink-soft block mb-1">
              E-mail (facultatif, pour s&apos;y retrouver)
            </label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="compte1@exemple.com"
              disabled={occupe}
            />
          </div>
          <Button onClick={ajouter} disabled={occupe}>
            {occupe ? 'Connexion…' : 'Se connecter à Apple'}
          </Button>
        </div>
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
          Le parc {comptes ? `(${comptes.length})` : ''}
        </h2>
        {comptes === null ? (
          <p className="font-mono text-sm text-ink-soft">Chargement…</p>
        ) : comptes.length === 0 ? (
          <p className="font-editorial italic text-sm text-ink-soft">
            Le parc est vide. Ajoutez un compte ci-dessus.
          </p>
        ) : (
          <ul className="divide-y divide-cream-4">
            {comptes.map((c) => (
              <li key={c.id} className="py-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[200px]">
                  <p className="font-mono text-sm">
                    {c.libelle}
                    {!c.actif && <span className="text-ink-soft"> — mis de côté</span>}
                  </p>
                  <p className="font-mono text-[11px] text-ink-soft">
                    {c.account_email ?? 'e-mail non renseigné'}
                    {c.occupe_par ? ` · occupé par « ${c.occupe_par.nom} »` : ' · libre'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void agir(
                      () => resignerCompteApple(c.id),
                      `Jeton de « ${c.libelle} » renouvelé.`,
                    )
                  }
                  disabled={occupe}
                >
                  Re-signer
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void agir(
                      () => majCompteApple(c.id, { actif: !c.actif }),
                      c.actif ? `« ${c.libelle} » mis de côté.` : `« ${c.libelle} » réactivé.`,
                    )
                  }
                  disabled={occupe}
                >
                  {c.actif ? 'Mettre de côté' : 'Réactiver'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void agir(
                      () => supprimerCompteApple(c.id),
                      `« ${c.libelle} » retiré du parc.`,
                    )
                  }
                  disabled={occupe || c.occupe_par !== null}
                >
                  Retirer
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
