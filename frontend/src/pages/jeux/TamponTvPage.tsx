/**
 * /tamponneuses — feat/jeux-manette-2 (test, caché)
 * Auto-tamponneuses : écran TV. Téléphone = volant + TURBO.
 */
import { useRef, useState } from 'react';
import { useBoucle, useSalonTv } from '../../lib/jeux/salonManette.js';
import {
  HAUTEUR,
  LARGEUR,
  MARGE,
  MORT_SUBITE,
  POINTS_VICTOIRE,
  RAYON_AUTO,
  VIE,
  avancerTampon,
  finDeManche,
  nouvelleAuto,
  nouvelleManche,
  turbo,
  type Auto,
} from '../../lib/jeux/tamponMoteur.js';
import { CadreTv, SalleAttente, TableauScores, dessinerCompte } from './CadreTv.js';

type Phase = 'attente' | 'compte' | 'jeu' | 'manche' | 'fini';

export function TamponTvPage(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('attente');
  const [resultat, setResultat] = useState('');
  const phaseRef = useRef<Phase>('attente');
  const autos = useRef<Auto[]>([]);
  const departA = useRef(0);
  const secRef = useRef(0);
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
    autos.current = js.map((j) => {
      const ancien = neuf ? undefined : autos.current.find((a) => a.id === j.id);
      const a = nouvelleAuto(j.id, j.pseudo, j.couleur);
      a.score = ancien?.score ?? 0;
      return a;
    });
    nouvelleManche(autos.current);
    secRef.current = 0;
    departA.current = performance.now() + 3000;
    changerPhase('compte');
  };

  const { code, joueurs, joueursRef, envoyerEtat } = useSalonTv('tamponneuses', {
    cmd: (m) => {
      const a = autos.current.find((x) => x.id === m.id);
      if (a) {
        a.dir = m.x ?? 0;
        a.frein = m.d;
      }
    },
    action: (x) => {
      if (phaseRef.current !== 'jeu' || x.type !== 'turbo') return;
      const a = autos.current.find((y) => y.id === x.id);
      if (a) turbo(a, secRef.current);
    },
    lancer: () => lancer(),
    depart: (id) => {
      const a = autos.current.find((x) => x.id === id);
      if (a) a.vivant = false;
    },
  });

  useBoucle((dt, t) => {
    if (phaseRef.current === 'compte' && t >= departA.current) changerPhase('jeu');
    if (phaseRef.current === 'jeu') {
      secRef.current = (t - departA.current) / 1000;
      avancerTampon(autos.current, dt, secRef.current);
      const fin = finDeManche(autos.current);
      if (fin.finie) {
        if (fin.gagnant) {
          fin.gagnant.score++;
          setResultat(`${fin.gagnant.pseudo} gagne la manche`);
          changerPhase(fin.gagnant.score >= POINTS_VICTOIRE ? 'fini' : 'manche');
        } else {
          setResultat(autos.current.length <= 1 ? `Tenu ${secRef.current.toFixed(1)} s` : 'Égalité, personne ne marque');
          changerPhase('manche');
        }
      }
    }
    dessiner(toile.current, autos.current, secRef.current, phaseRef.current, Math.ceil((departA.current - t) / 1000));
    if (t - dernierEtat.current > 250) {
      dernierEtat.current = t;
      const ph = phaseRef.current;
      envoyerEtat({
        phase: ph,
        texte: ph === 'attente' ? 'En attente du départ' : '',
        perso: Object.fromEntries(
          autos.current.map((a) => [
            a.id,
            `${ph === 'jeu' ? (a.vivant ? `❤️ ${Math.ceil(a.vie)} · ${secRef.current >= a.turboPretA ? 'turbo prêt' : 'turbo en recharge'} · ` : 'Éliminé · ') : ''}${a.score} pt${a.score > 1 ? 's' : ''} / ${POINTS_VICTOIRE}`,
          ]),
        ),
      });
    }
  });

  const classes = [...autos.current].sort((a, b) => b.score - a.score);
  const lignes = classes.map((a) => ({ id: a.id, pseudo: a.pseudo, couleur: a.couleur, valeur: `${a.score} pt${a.score > 1 ? 's' : ''}` }));
  return (
    <CadreTv
      emoji="💥"
      titre="Auto-tamponneuses"
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
          appel="Scannez pour prendre une auto"
          regles={[
            'Ta voiture roule toute seule : dirige-la (boutons ou téléphone penché)',
            'Fonce avec l’AVANT de ta voiture : c’est l’autre qui prend les dégâts',
            'TURBO pour charger (recharge 3 s)',
            `Dernier qui roule = 1 point · premier à ${POINTS_VICTOIRE}`,
          ]}
          onLancer={lancer}
        />
      )}
      {phase === 'manche' && <TableauScores titre={resultat} lignes={lignes} bouton="Manche suivante ▶" onBouton={lancer} />}
      {phase === 'fini' && <TableauScores titre={`🏆 ${classes[0]?.pseudo ?? ''} gagne !`} lignes={lignes} bouton="Rejouer ↻" onBouton={lancer} />}
    </CadreTv>
  );
}

function dessiner(cv: HTMLCanvasElement | null, autos: Auto[], sec: number, phase: Phase, compte: number): void {
  const ctx = cv?.getContext('2d');
  if (!cv || !ctx) return;
  ctx.fillStyle = '#141019';
  ctx.fillRect(0, 0, LARGEUR, HAUTEUR);
  // Piste métallique quadrillée
  ctx.fillStyle = '#2b2733';
  ctx.fillRect(MARGE, MARGE, LARGEUR - 2 * MARGE, HAUTEUR - 2 * MARGE);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = MARGE; x < LARGEUR - MARGE; x += 80) {
    ctx.moveTo(x, MARGE);
    ctx.lineTo(x, HAUTEUR - MARGE);
  }
  for (let y = MARGE; y < HAUTEUR - MARGE; y += 80) {
    ctx.moveTo(MARGE, y);
    ctx.lineTo(LARGEUR - MARGE, y);
  }
  ctx.stroke();
  const subite = phase === 'jeu' && sec > MORT_SUBITE;
  ctx.strokeStyle = subite ? (Math.floor(sec * 4) % 2 ? '#ff3b30' : '#ffcc00') : '#f2c94c';
  ctx.lineWidth = 10;
  ctx.strokeRect(MARGE, MARGE, LARGEUR - 2 * MARGE, HAUTEUR - 2 * MARGE);
  if (subite) {
    ctx.fillStyle = 'rgba(255,59,48,0.85)';
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MORT SUBITE !', LARGEUR / 2, 90);
  }
  for (const a of autos) {
    if (!a.vivant) continue;
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(a.angle);
    if (sec < a.turboJusqua) {
      ctx.fillStyle = '#ffb347';
      ctx.beginPath();
      ctx.moveTo(-RAYON_AUTO, -10);
      ctx.lineTo(-RAYON_AUTO - 22 - Math.random() * 12, 0);
      ctx.lineTo(-RAYON_AUTO, 10);
      ctx.fill();
    }
    // Pare-chocs (noir) puis carrosserie
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(0, 0, RAYON_AUTO, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = a.couleur;
    ctx.beginPath();
    ctx.moveTo(-RAYON_AUTO + 8, -RAYON_AUTO + 10);
    ctx.lineTo(RAYON_AUTO - 4, -RAYON_AUTO + 14);
    ctx.lineTo(RAYON_AUTO - 4, RAYON_AUTO - 14);
    ctx.lineTo(-RAYON_AUTO + 8, RAYON_AUTO - 10);
    ctx.closePath();
    ctx.fill();
    // Nez (l'avant qui protège)
    ctx.fillStyle = '#fff';
    ctx.fillRect(RAYON_AUTO - 10, -8, 6, 16);
    // Mât électrique
    ctx.fillStyle = '#ddd';
    ctx.beginPath();
    ctx.arc(-8, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Barre de vie
    const l = 56;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(a.x - l / 2, a.y - RAYON_AUTO - 18, l, 8);
    const f = Math.max(0, a.vie / VIE);
    ctx.fillStyle = f > 0.5 ? '#3fb47a' : f > 0.25 ? '#f2c94c' : '#eb5757';
    ctx.fillRect(a.x - l / 2, a.y - RAYON_AUTO - 18, l * f, 8);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(a.pseudo, a.x, a.y - RAYON_AUTO - 24);
  }
  if (phase === 'compte') dessinerCompte(ctx, LARGEUR, HAUTEUR, compte);
}
