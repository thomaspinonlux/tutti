/**
 * /pong — feat/jeux-manette (test, caché)
 * Pong : écran TV. Les téléphones envoient la position du doigt (y).
 */
import { useRef, useState } from 'react';
import { useBoucle, useSalonTv } from '../../lib/jeux/salonManette.js';
import {
  HAUTEUR,
  H_RAQUETTE,
  LARGEUR,
  L_RAQUETTE,
  POINTS_VICTOIRE,
  RAYON_BALLE,
  avancer,
  nouveauMatch,
  vainqueur,
  viser,
  type Match,
} from '../../lib/jeux/pongMoteur.js';
import { CadreTv, SalleAttente, TableauScores, dessinerCompte } from './CadreTv.js';

type Phase = 'attente' | 'compte' | 'jeu' | 'fini';

export function PongTvPage(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('attente');
  const phaseRef = useRef<Phase>('attente');
  const match = useRef<Match | null>(null);
  const departA = useRef(0);
  const dernierEtat = useRef(0);
  const toile = useRef<HTMLCanvasElement>(null);

  const changerPhase = (p: Phase): void => {
    phaseRef.current = p;
    setPhase(p);
  };

  const lancer = (): void => {
    const ph = phaseRef.current;
    if (ph === 'compte' || ph === 'jeu') return;
    const js = joueursRef.current;
    if (js.length === 0) return;
    match.current = nouveauMatch(js);
    departA.current = performance.now() + 3000;
    changerPhase('compte');
  };

  const { code, joueurs, joueursRef, envoyerEtat } = useSalonTv('pong', {
    cmd: (c) => {
      const r = match.current?.raquettes.find((x) => x.id === c.id);
      if (r && typeof c.y === 'number') viser(r, c.y);
    },
    lancer: () => lancer(),
    depart: (id) => {
      // Un joueur part en plein match : l'ordinateur reprend sa raquette.
      const r = match.current?.raquettes.find((x) => x.id === id);
      if (r) {
        r.id = 'ordi';
        r.pseudo = 'Ordinateur';
        r.couleur = '#9AA0A6';
      }
    },
  });

  useBoucle((dt, t) => {
    if (phaseRef.current === 'compte' && t >= departA.current) changerPhase('jeu');
    const m = match.current;
    if (phaseRef.current === 'jeu' && m) {
      avancer(m, dt, (t - departA.current) / 1000);
      if (vainqueur(m)) changerPhase('fini');
    }
    dessiner(toile.current, m, phaseRef.current, Math.ceil((departA.current - t) / 1000));
    if (t - dernierEtat.current > 250) {
      dernierEtat.current = t;
      const ph = phaseRef.current;
      envoyerEtat({
        phase: ph,
        texte: ph === 'compte' ? 'Prêt…' : ph === 'attente' ? 'En attente du départ' : '',
        perso: Object.fromEntries(
          (m?.raquettes ?? []).map((r) => {
            const moi = r.cote === 'g' ? m!.score.g : m!.score.d;
            const eux = r.cote === 'g' ? m!.score.d : m!.score.g;
            return [r.id, `${r.cote === 'g' ? 'Côté gauche' : 'Côté droit'} · ${moi} – ${eux}`];
          }),
        ),
      });
    }
  });

  const m = match.current;
  const gagne = m ? vainqueur(m) : null;
  const lignes = (m?.raquettes ?? [])
    .filter((r) => r.cote === gagne)
    .map((r) => ({ id: r.id, pseudo: r.pseudo, couleur: r.couleur, valeur: '' }));

  return (
    <CadreTv emoji="🏓" titre="Pong" code={code} largeur={LARGEUR} hauteur={HAUTEUR}>
      <canvas ref={toile} width={LARGEUR} height={HAUTEUR} className="w-full h-full rounded-2xl" />
      {phase === 'attente' && (
        <SalleAttente
          code={code}
          joueurs={joueurs}
          appel="Scannez pour prendre une raquette"
          regles={[
            'Glisse le doigt de haut en bas sur le téléphone',
            '1 contre 1 ou 2 contre 2 (seul : contre l’ordinateur)',
            'La balle accélère à chaque renvoi',
            `Premier à ${POINTS_VICTOIRE} points`,
          ]}
          onLancer={lancer}
        />
      )}
      {phase === 'fini' && m && (
        <TableauScores
          titre={`🏆 ${lignes.map((l) => l.pseudo).join(' & ')} gagne${lignes.length > 1 ? 'nt' : ''} !`}
          sousTitre={`${m.score.g} – ${m.score.d}`}
          lignes={lignes}
          bouton="Rejouer ↻"
          onBouton={lancer}
        />
      )}
    </CadreTv>
  );
}

function dessiner(c: HTMLCanvasElement | null, m: Match | null, phase: Phase, compte: number): void {
  const ctx = c?.getContext('2d');
  if (!c || !ctx) return;
  ctx.fillStyle = '#0a1a2f';
  ctx.fillRect(0, 0, LARGEUR, HAUTEUR);
  ctx.setLineDash([20, 20]);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(LARGEUR / 2, 0);
  ctx.lineTo(LARGEUR / 2, HAUTEUR);
  ctx.stroke();
  ctx.setLineDash([]);
  if (m) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 120px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(m.score.g), LARGEUR / 2 - 160, 140);
    ctx.fillText(String(m.score.d), LARGEUR / 2 + 160, 140);
    for (const r of m.raquettes) {
      ctx.fillStyle = r.couleur;
      ctx.fillRect(r.x - L_RAQUETTE / 2, r.y - H_RAQUETTE / 2, L_RAQUETTE, H_RAQUETTE);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillText(r.pseudo, r.x, r.y + H_RAQUETTE / 2 + 24);
    }
    if (m.serviceA === null) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(m.balle.x, m.balle.y, RAYON_BALLE, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (phase === 'compte') dessinerCompte(ctx, LARGEUR, HAUTEUR, compte);
}
