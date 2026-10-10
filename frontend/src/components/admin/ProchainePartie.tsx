/**
 * <ProchainePartie /> — feat/parcours-client-simplifie
 *
 * Thomas : le jour J, le client ne doit pas chercher. En haut du tableau de
 * bord : « Ta partie de ce soir », puis UN clic → la console avec le QR code.
 * La partie est créée avec les réglages par défaut de l'app (tout le monde
 * joue, sans animateur, en solo, en français) ; « Autres réglages » ouvre le
 * formulaire complet.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  lireReglagesReservation,
  mesReservations,
  texteCreneau,
  type Reservation,
} from '../../lib/reservations.js';
import { Button, Card } from '../ui/index.js';
import { useEstablishment } from '../../pages/admin/AdminLayout.js';

const JOUABLES = new Set(['PAYEE', 'GRATUITE']);

function memeJour(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

export function ProchainePartie(): JSX.Element | null {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [resa, setResa] = useState<Reservation | null>(null);
  const [ouvertureMin, setOuvertureMin] = useState(30);
  const [maintenant, setMaintenant] = useState(() => new Date());
  const [enCours, setEnCours] = useState<'TRACKS' | 'QUIZZ' | null>(null);
  const { me } = useEstablishment();
  const estClient = !!me && me.role !== 'OWNER' && !me.isSuperAdmin;

  useEffect(() => {
    let vivant = true;
    Promise.all([mesReservations(), lireReglagesReservation()])
      .then(([{ reservations }, reglages]) => {
        if (!vivant) return;
        setOuvertureMin(reglages.ouverture_avant_minutes);
        const now = new Date();
        const prochaine = reservations
          .filter(
            (r) => (JOUABLES.has(r.statut) || r.statut === 'ACCEPTEE') && new Date(r.fin) > now,
          )
          .sort((a, b) => a.debut.localeCompare(b.debut))[0];
        setResa(prochaine ?? null);
      })
      .catch(() => undefined);
    const id = window.setInterval(() => setMaintenant(new Date()), 30_000);
    return () => {
      vivant = false;
      window.clearInterval(id);
    };
  }, []);

  // feat/parcours-rapide — un client sans partie prévue voit d'abord où réserver.
  if (!resa) {
    if (!estClient) return null;
    return (
      <Card size="lg" className="mb-6">
        <p className="font-display text-xl mb-1">Pas encore de soirée prévue</p>
        <p className="text-sm mb-4">
          Choisis ton créneau et paie en ligne : c’est réservé tout de suite.
        </p>
        <Link to="/admin/reserver">
          <Button>Réserver ma soirée</Button>
        </Link>
      </Card>
    );
  }

  const debut = new Date(resa.debut);
  const ouvreA = new Date(debut.getTime() - ouvertureMin * 60_000);
  const ouvert = maintenant >= ouvreA;
  const titre = memeJour(debut, maintenant) ? t('quizTheme.nextToday') : t('quizTheme.nextLater');

  // feat/parcours-rapide — Thomas : les réglages font partie du fil de
  // lancement. « Lancer » ouvre l'écran de réglages déjà rempli (animateur,
  // voix ou clavier, solo ou équipes, langue) ; un clic de plus lance la partie.
  const lancer = (type: 'TRACKS' | 'QUIZZ'): void => {
    setEnCours(type);
    navigate(type === 'QUIZZ' ? '/admin/sessions/new?type=quizz' : '/admin/sessions/new');
  };

  return (
    <Card tone="lemon" size="md" className="mb-6">
      <p className="font-mono text-xs uppercase tracking-[0.2em] mb-1">{titre}</p>
      <p className="font-display text-2xl mb-3">{texteCreneau(resa.debut, resa.fin)}</p>

      {resa.statut === 'ACCEPTEE' ? (
        <>
          <p className="text-sm mb-3">{t('quizTheme.toPay')}</p>
          <Link to="/admin/reserver" className="underline font-semibold">
            {t('quizTheme.payLink')}
          </Link>
        </>
      ) : ouvert ? (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <Button size="lg" disabled={!!enCours} onClick={() => lancer('TRACKS')}>
              {enCours === 'TRACKS' ? '…' : t('quizTheme.launchTracks')}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              disabled={!!enCours}
              onClick={() => lancer('QUIZZ')}
            >
              {enCours === 'QUIZZ' ? '…' : t('quizTheme.launchQuiz')}
            </Button>
            <Link to="/admin/sessions/new">
              <Button size="lg" variant="ghost">
                ⚙️ {t('quizTheme.otherSettings')}
              </Button>
            </Link>
          </div>
        </>
      ) : (
        <p className="text-sm">
          {t('quizTheme.opensAt', {
            time: ouvreA.toLocaleTimeString(i18n.language?.startsWith('en') ? 'en-GB' : 'fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Europe/Luxembourg',
            }),
          })}
        </p>
      )}
    </Card>
  );
}
