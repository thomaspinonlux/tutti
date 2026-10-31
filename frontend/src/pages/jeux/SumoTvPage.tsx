/**
 * /sumo — feat/jeux-manette (test, caché)
 * Sumo : écran TV. Les téléphones envoient un joystick (x, y) et « dash ».
 */
import { useRef, useState } from 'react';
import { useBoucle, useSalonTv } from '../../lib/jeux/salonManette.js';
import {
  CX,
  CY,
  HAUTEUR,
  LARGEUR,
  POINTS_VICTOIRE,
  RAYON_PALET,
  avancer,
  dash,
  finDeManche,
  nouveauPalet,
  nouvelleManche,
  rayonArene,
  type Palet,
} from '../../lib/jeux/sumoMoteur.js';
import { CadreTv, SalleAttente, TableauScores, dessinerCompte } from './CadreTv.js';

type Phase = 'attente' | 'compte' | 'jeu' | 'manche' | 'fini';

export function SumoTvPage(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('attente');
  const [resultat, setResultat] = useState('');
  const phaseRef = useRef<Phase>('attente');
  const palets = useRef<Palet[]>([]);
  const departA = useRef(0);
  const dernierEtat = useRef(0);
  const secondesRef = useRef(0);
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
    const neuf = ph === 'attente' || ph === 'fini';
    palets.current = js.map((j) => {
      const ancien = neuf ? undefined : palets.current.find((p) => p.id === j.id);
      const p = nouveauPalet(j.id, j.pseudo, j.couleur);
      p.score = ancien?.score ?? 0;
      return p;
    });
    nouvelleManche(palets.current);
    secondesRef.current = 0;
    departA.current = performance.now() + 3000;
    changerPhase('compte');
  };

  const { code, joueurs, joueursRef, envoyerEtat } = useSalonTv('sumo', {
    cmd: (m) => {
      const p = palets.current.find((x) => x.id === m.id);
      if (p) {
        p.jx = m.x ?? 0;
        p.jy = m.y ?? 0;
      }
    },
    action: (a) => {
      if (phaseRef.current !== 'jeu' || a.type !== 'dash') return;
      const p = palets.current.find((x) => x.id === a.id);
      if (p) dash(p, secondesRef.current);
    },
    lancer: () => lancer(),
    depart: (id) => {
      const p = palets.current.find((x) => x.id === id);
      if (p) p.vivant = false;
    },
  });

  useBoucle((dt, t) => {
    if (phaseRef.current === 'compte' && t >= departA.current) changerPhase('jeu');
    if (phaseRef.current === 'jeu') {
      secondesRef.current = (t - departA.current) / 1000;
      avancer(palets.current, dt, secondesRef.current);
      const fin = finDeManche(palets.current);
      if (fin.finie) {
        if (fin.gagnant) {
          fin.gagnant.score++;
          setResultat(`${fin.gagnant.pseudo} gagne la manche`);
          changerPhase(fin.gagnant.score >= POINTS_VICTOIRE ? 'fini' : 'manche');
        } else {
          setResultat(palets.current.length <= 1 ? `Tenu ${secondesRef.current.toFixed(1)} s` : 'Égalité, personne ne marque');
          changerPhase('manche');
        }
      }
    }
    const r = phaseRef.current === 'jeu' ? rayonArene(secondesRef.current) : rayonArene(0);
    dessiner(toile.current, palets.current, r, phaseRef.current, Math.ceil((departA.current - t) / 1000), secondesRef.current);
    if (t - dernierEtat.current > 250) {
      dernierEtat.current = t;
      const ph = phaseRef.current;
      envoyerEtat({
        phase: ph,
        texte: ph === 'compte' ? 'Prêt…' : ph === 'attente' ? 'En attente du départ' : '',
        perso: Object.fromEntries(
          palets.current.map((p) => [
            p.id,
            `${ph === 'jeu' ? (p.vivant ? (secondesRef.current >= p.dashA ? 'Dash prêt · ' : 'Dash en recharge · ') : 'Sorti · ') : ''}${p.score} pt${p.score > 1 ? 's' : ''} / ${POINTS_VICTOIRE}`,
          ]),
        ),
      });
    }
  });

  const classes = [...palets.current].sort((a, b) => b.score - a.score);
  const lignes = classes.map((p) => ({ id: p.id, pseudo: p.pseudo, couleur: p.couleur, valeur: `${p.score} pt${p.score > 1 ? 's' : ''}` }));

  return (
    <CadreTv
      emoji="🥋"
      titre="Sumo"
      code={code}
      largeur={LARGEUR}
      hauteur={HAUTEUR}
      bas={
        phase !== 'attente' && (
          <ol className="flex flex-wrap gap-3 text-lg">
            {lignes.map((l) => (
              <li key={l.id} className="rounded-full px-3 py-1 bg-white/10">
                <span style={{ color: l.couleur }} className="font-semibold">{l.pseudo}</span> <span className="text-white/60">{l.valeur}</span>
              </li>
            ))}
          </ol>
        )
      }
    >
      <canvas ref={toile} width={LARGEUR} height={HAUTEUR} className="w-full h-full rounded-2xl" />
      {phase === 'attente' && (
        <SalleAttente
          code={code}
          joueurs={joueurs}
          appel="Scannez pour monter sur le ring"
          regles={[
            'Le téléphone est un joystick : glisse le pouce',
            'DASH : une grosse poussée (recharge 2,5 s)',
            'Pousse les autres hors du cercle — il rétrécit !',
            `Dernier dedans = 1 point · premier à ${POINTS_VICTOIRE}`,
          ]}
          onLancer={lancer}
        />
      )}
      {phase === 'manche' && <TableauScores titre={resultat} lignes={lignes} bouton="Manche suivante ▶" onBouton={lancer} />}
      {phase === 'fini' && <TableauScores titre={`🏆 ${classes[0]?.pseudo ?? ''} gagne !`} lignes={lignes} bouton="Rejouer ↻" onBouton={lancer} />}
    </CadreTv>
  );
}

function dessiner(c: HTMLCanvasElement | null, palets: Palet[], r: number, phase: Phase, compte: number, secondes: number): void {
  const ctx = c?.getContext('2d');
  if (!c || !ctx) return;
  ctx.fillStyle = '#1a1410';
  ctx.fillRect(0, 0, LARGEUR, HAUTEUR);
  // Tatami
  ctx.fillStyle = '#c9b48a';
  ctx.beginPath();
  ctx.arc(CX, CY, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#7a1e1e';
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.moveTo(CX - 40, CY - 30);
  ctx.lineTo(CX - 40, CY + 30);
  ctx.moveTo(CX + 40, CY - 30);
  ctx.lineTo(CX + 40, CY + 30);
  ctx.stroke();
  for (const p of palets) {
    if (!p.vivant) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.arc(p.x + 5, p.y + 7, RAYON_PALET, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.couleur;
    ctx.beginPath();
    ctx.arc(p.x, p.y, RAYON_PALET, 0, Math.PI * 2);
    ctx.fill();
    // Anneau blanc quand le dash est prêt
    if (phase === 'jeu' && secondes >= p.dashA) {
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
    // Direction du joystick
    const n = Math.hypot(p.jx, p.jy);
    if (n > 0.15) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(p.x + (p.jx / Math.max(1, n)) * 20, p.y + (p.jy / Math.max(1, n)) * 20, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.pseudo, p.x, p.y - RAYON_PALET - 8);
  }
  if (phase === 'compte') dessinerCompte(ctx, LARGEUR, HAUTEUR, compte);
}
