/**
 * /serpents — feat/jeux-manette (test, caché)
 * Serpents lumineux : écran TV. Les téléphones envoient « gauche » / « droite ».
 */
import { useRef, useState } from 'react';
import { useBoucle, useSalonTv } from '../../lib/jeux/salonManette.js';
import {
  CASE,
  COLS,
  LIGNES,
  POINTS_VICTOIRE,
  avancer,
  finDeManche,
  nouveauSerpent,
  nouvelleManche,
  tourner,
  vitesse,
  type Arene,
  type Serpent,
} from '../../lib/jeux/serpentsMoteur.js';
import { CadreTv, SalleAttente, TableauScores, dessinerCompte } from './CadreTv.js';

type Phase = 'attente' | 'compte' | 'jeu' | 'manche' | 'fini';
const L = COLS * CASE;
const H = LIGNES * CASE;

export function SerpentsTvPage(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('attente');
  const [resultat, setResultat] = useState('');
  const phaseRef = useRef<Phase>('attente');
  const serpents = useRef<Serpent[]>([]);
  const arene = useRef<Arene | null>(null);
  const departA = useRef(0);
  const cumul = useRef(0);
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
    const neuf = ph === 'attente' || ph === 'fini';
    // On garde les scores entre manches ; les nouveaux arrivants rejoignent à 0.
    serpents.current = js.map((j) => {
      const ancien = neuf ? undefined : serpents.current.find((s) => s.id === j.id);
      const s = nouveauSerpent(j.id, j.pseudo, j.couleur);
      s.score = ancien?.score ?? 0;
      return s;
    });
    arene.current = nouvelleManche(serpents.current);
    cumul.current = 0;
    departA.current = performance.now() + 3000;
    changerPhase('compte');
  };

  const { code, joueurs, joueursRef, envoyerEtat } = useSalonTv('serpents', {
    action: (a) => {
      if (phaseRef.current !== 'jeu') return;
      const s = serpents.current.find((x) => x.id === a.id);
      if (s?.vivant && (a.type === 'g' || a.type === 'd')) tourner(s, a.type === 'g' ? -1 : 1);
    },
    lancer: () => lancer(),
    depart: (id) => {
      const s = serpents.current.find((x) => x.id === id);
      if (s) s.vivant = false;
    },
  });

  useBoucle((dt, t) => {
    if (phaseRef.current === 'compte' && t >= departA.current) changerPhase('jeu');
    const ar = arene.current;
    if (phaseRef.current === 'jeu' && ar) {
      const secondes = (t - departA.current) / 1000;
      cumul.current += dt;
      const periode = 1 / vitesse(secondes);
      while (cumul.current >= periode && phaseRef.current === 'jeu') {
        cumul.current -= periode;
        avancer(ar);
        const fin = finDeManche(ar);
        if (fin.finie) {
          if (fin.gagnant) {
            fin.gagnant.score++;
            setResultat(`${fin.gagnant.pseudo} gagne la manche`);
            changerPhase(fin.gagnant.score >= POINTS_VICTOIRE ? 'fini' : 'manche');
          } else {
            setResultat(serpents.current.length <= 1 ? `Tenu ${secondes.toFixed(1)} s` : 'Égalité, personne ne marque');
            changerPhase('manche');
          }
        }
      }
    }
    dessiner(toile.current, serpents.current, phaseRef.current, Math.ceil((departA.current - t) / 1000));
    if (t - dernierEtat.current > 250) {
      dernierEtat.current = t;
      const ph = phaseRef.current;
      envoyerEtat({
        phase: ph,
        texte: ph === 'compte' ? 'Prêt…' : ph === 'jeu' ? '' : ph === 'attente' ? 'En attente du départ' : '',
        perso: Object.fromEntries(
          serpents.current.map((s) => [
            s.id,
            `${ph === 'jeu' ? (s.vivant ? 'En vie' : 'Éliminé') : ''}${ph === 'jeu' ? ' · ' : ''}${s.score} pt${s.score > 1 ? 's' : ''} / ${POINTS_VICTOIRE}`,
          ]),
        ),
      });
    }
  });

  const classes = [...serpents.current].sort((a, b) => b.score - a.score);
  const lignes = classes.map((s) => ({ id: s.id, pseudo: s.pseudo, couleur: s.couleur, valeur: `${s.score} pt${s.score > 1 ? 's' : ''}` }));

  return (
    <CadreTv
      emoji="🐍"
      titre="Serpents lumineux"
      code={code}
      largeur={L}
      hauteur={H}
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
      <canvas ref={toile} width={L} height={H} className="w-full h-full rounded-2xl" />
      {phase === 'attente' && (
        <SalleAttente
          code={code}
          joueurs={joueurs}
          appel="Scannez pour prendre un serpent"
          regles={[
            'Ton serpent avance tout seul et laisse un mur derrière lui',
            '◀ ▶ sur le téléphone : tourner',
            'Touche un mur ou un bord : éliminé',
            `Dernier en vie = 1 point · premier à ${POINTS_VICTOIRE}`,
          ]}
          onLancer={lancer}
        />
      )}
      {phase === 'manche' && <TableauScores titre={resultat} lignes={lignes} bouton="Manche suivante ▶" onBouton={lancer} />}
      {phase === 'fini' && <TableauScores titre={`🏆 ${classes[0]?.pseudo ?? ''} gagne !`} lignes={lignes} bouton="Rejouer ↻" onBouton={lancer} />}
    </CadreTv>
  );
}

function dessiner(c: HTMLCanvasElement | null, serpents: Serpent[], phase: Phase, compte: number): void {
  const ctx = c?.getContext('2d');
  if (!c || !ctx) return;
  ctx.fillStyle = '#07070c';
  ctx.fillRect(0, 0, L, H);
  // Quadrillage discret
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= L; x += CASE * 5) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
  }
  for (let y = 0; y <= H; y += CASE * 5) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(L, y + 0.5);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, L - 4, H - 4);
  const centre = (v: number): number => v * CASE + CASE / 2;
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
  for (const s of serpents) {
    if (s.trace.length === 0) continue;
    ctx.globalAlpha = s.vivant ? 1 : 0.3;
    ctx.strokeStyle = s.couleur;
    ctx.lineWidth = CASE - 2;
    ctx.beginPath();
    ctx.moveTo(centre(s.trace[0]![0]), centre(s.trace[0]![1]));
    for (let i = 1; i < s.trace.length; i++) ctx.lineTo(centre(s.trace[i]![0]), centre(s.trace[i]![1]));
    ctx.stroke();
    const tete = s.trace[s.trace.length - 1]!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(tete[0] * CASE - 2, tete[1] * CASE - 2, CASE + 4, CASE + 4);
    ctx.fillStyle = s.couleur;
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(s.pseudo, centre(tete[0]), tete[1] * CASE - 10);
  }
  ctx.globalAlpha = 1;
  if (phase === 'compte') dessinerCompte(ctx, L, H, compte);
}
