/**
 * /admin/arcade — feat/back-office-en-familles
 *
 * Thomas, 22/11 : « les jeux d'arcade, j'aimerais bien qu'on les mette en ligne
 * et qu'on les teste […] que je puisse y accéder directement au back-office ».
 *
 * Les dix jeux téléphone-manette existaient déjà, sans aucun lien : on y
 * arrivait en tapant l'adresse. Cette page les liste. Elle est réservée au
 * PROPRIÉTAIRE du compte tant que les jeux sont en test : un client qui
 * taperait l'adresse est renvoyé à l'accueil.
 *
 * Chaque jeu s'ouvre dans un nouvel onglet : c'est l'écran à mettre sur la TV.
 * Il affiche son QR code ; le téléphone des joueurs devient la manette.
 */
import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getMe } from '../../lib/me.js';
import { Button, Card, TitleHandwritten, Underline } from '../../components/ui/index.js';

interface JeuArcade {
  chemin: string;
  nom: string;
  /** Les règles affichées par le jeu dans sa salle d'attente, résumées. */
  resume: string;
}

const JEUX: JeuArcade[] = [
  { chemin: '/kart', nom: 'Kart à bonus', resume: "Course jusqu'à 8 pilotes. Volant au pouce ou en penchant le téléphone, bonus à ramasser." },
  { chemin: '/course', nom: 'Course', resume: "Course jusqu'à 8 pilotes. Le téléphone envoie gauche ou droite." },
  { chemin: '/moto', nom: 'Moto cross', resume: 'Gaz à maintenir, équilibre à garder en l’air pour retomber à plat.' },
  { chemin: '/ski', nom: 'Slalom', resume: 'Passer entre les deux drapeaux de chaque porte. Porte ratée : pénalité.' },
  { chemin: '/sprint', nom: 'Sprint 100 m', resume: 'Taper gauche, droite, gauche, droite le plus vite possible.' },
  { chemin: '/sumo', nom: 'Sumo', resume: 'Pousser les autres hors du cercle, qui rétrécit.' },
  { chemin: '/tamponneuses', nom: 'Auto-tamponneuses', resume: 'Foncer avec l’avant de sa voiture pour faire des dégâts aux autres.' },
  { chemin: '/serpents', nom: 'Serpents lumineux', resume: 'Le serpent avance seul et laisse un mur. Toucher un mur élimine.' },
  { chemin: '/pong', nom: 'Pong', resume: '1 contre 1 ou 2 contre 2. Seul : contre l’ordinateur.' },
  { chemin: '/reflexe', nom: 'Réflexe', resume: 'Vert : taper le plus vite possible. Orange : piège, ne pas taper.' },
];

export function ArcadePage(): JSX.Element {
  const { t } = useTranslation();
  // null = rôle pas encore connu : on n'affiche rien, on ne renvoie personne.
  const [autorise, setAutorise] = useState<boolean | null>(null);

  useEffect(() => {
    let vivant = true;
    getMe()
      .then((me) => vivant && setAutorise(me.role === 'OWNER' || me.isSuperAdmin))
      .catch(() => vivant && setAutorise(false));
    return () => {
      vivant = false;
    };
  }, []);

  if (autorise === null) {
    return <p className="font-mono text-ink-soft">{t('common.loading')}</p>;
  }
  if (!autorise) return <Navigate to="/admin/dashboard" replace />;

  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-6">
        <TitleHandwritten as="h1" className="mb-3">
          <Underline>{t('arcade.titre')}</Underline>{' '}
          <span className="font-mono text-base uppercase tracking-wider text-ink-soft">{t('arcade.enTest')}</span>
        </TitleHandwritten>
        <p className="font-editorial italic text-lg text-ink-2">{t('arcade.intro')}</p>
        <p className="text-sm text-ink-soft mt-1">{t('arcade.visible')}</p>
      </header>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {JEUX.map((jeu) => (
          <li key={jeu.chemin} className="min-w-0">
            <Card size="md" className="h-full flex flex-col gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-display text-2xl break-words">{jeu.nom}</p>
                <p className="text-sm text-ink-soft mt-1">{jeu.resume}</p>
              </div>
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={() => window.open(jeu.chemin, '_blank', 'noopener')}
                >
                  {t('arcade.ouvrir')}
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <p className="mt-6">
        <Link to="/admin/dashboard" className="underline text-ink-2">
          {t('arcade.retour')}
        </Link>
      </p>
    </div>
  );
}
