/**
 * /kart — feat/jeux-manette-2 (test, caché)
 * Kart à bonus : écran TV. Téléphone = volant (boutons ou penché) + BONUS.
 */
import { useRef, useState } from 'react';
import { useBoucle, useSalonTv } from '../../lib/jeux/salonManette.js';
import { CX, CY, DEMI, HAUTEUR, LARGEUR, RAYON_EXT, RAYON_INT } from '../../lib/courseMoteur.js';
import {
  NOM_BONUS,
  TOURS_KART,
  avancerKart,
  classementKart,
  nouvelleCourseKart,
  utiliserBonus,
  type CourseKart,
} from '../../lib/jeux/kartMoteur.js';
import { CadreTv, SalleAttente, TableauScores, dessinerCompte } from './CadreTv.js';

type Phase = 'attente' | 'compte' | 'jeu' | 'fini';
const rangTexte = (r: number): string => `${r}${r === 1 ? 'er' : 'e'}`;

export function KartTvPage(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('attente');
  const phaseRef = useRef<Phase>('attente');
  const course = useRef<CourseKart | null>(null);
  const departA = useRef(0);
  const finA = useRef<number | null>(null);
  const dernierEtat = useRef(0);
  const toile = useRef<HTMLCanvasElement>(null);

  const changerPhase = (p: Phase): void => {
    phaseRef.current = p;
    setPhase(p);
  };
  const lancer = (): void => {
    if (phaseRef.current === 'compte' || phaseRef.current === 'jeu') return;
    const js = joueursRef.current;
    if (js.length === 0) return;
    course.current = nouvelleCourseKart(js);
    finA.current = null;
    departA.current = performance.now() + 3000;
    changerPhase('compte');
  };

  const { code, joueurs, joueursRef, envoyerEtat } = useSalonTv('kart', {
    cmd: (m) => {
      const k = course.current?.karts.find((x) => x.id === m.id);
      if (k) {
        k.dir = m.x ?? 0;
        k.frein = m.d;
      }
    },
    action: (a) => {
      const c = course.current;
      if (phaseRef.current !== 'jeu' || !c || a.type !== 'bonus') return;
      const k = c.karts.find((x) => x.id === a.id);
      if (k) utiliserBonus(c, k, (performance.now() - departA.current) / 1000);
    },
    lancer: () => lancer(),
    depart: (id) => {
      const c = course.current;
      if (c) c.karts = c.karts.filter((k) => k.id !== id);
    },
  });

  useBoucle((dt, t) => {
    if (phaseRef.current === 'compte' && t >= departA.current) changerPhase('jeu');
    const c = course.current;
    const sec = (t - departA.current) / 1000;
    if (phaseRef.current === 'jeu' && c) {
      const arrivees = avancerKart(c, dt, sec, t - departA.current);
      if (arrivees.length > 0 && finA.current === null) finA.current = t + 15000;
      const tous = c.karts.length > 0 && c.karts.every((k) => k.finiA !== null);
      if (tous || (finA.current !== null && t >= finA.current)) changerPhase('fini');
    }
    dessiner(toile.current, c, sec, phaseRef.current, Math.ceil((departA.current - t) / 1000));
    if (t - dernierEtat.current > 250) {
      dernierEtat.current = t;
      const cl = c ? classementKart(c.karts) : [];
      const ph = phaseRef.current;
      envoyerEtat({
        phase: ph,
        texte: ph === 'attente' ? 'En attente du départ' : '',
        perso: Object.fromEntries(
          cl.map((k, i) => [
            k.id,
            k.finiA !== null
              ? `🏁 ${rangTexte(i + 1)} · ${(k.finiA / 1000).toFixed(1)} s`
              : `Tour ${Math.min(TOURS_KART, k.tours + 1)}/${TOURS_KART} · ${rangTexte(i + 1)} · ${k.bonus ? NOM_BONUS[k.bonus] : 'pas de bonus'}`,
          ]),
        ),
      });
    }
  });

  const cl = course.current ? classementKart(course.current.karts) : [];
  return (
    <CadreTv
      emoji="🏎️"
      titre="Kart à bonus"
      code={code}
      largeur={LARGEUR}
      hauteur={HAUTEUR}
      bas={
        phase === 'jeu' && (
          <ol className="flex flex-wrap gap-3 text-lg">
            {cl.map((k, i) => (
              <li key={k.id} className="rounded-full px-3 py-1 bg-white/10">
                <span className="font-mono">{i + 1}.</span> <span style={{ color: k.couleur }} className="font-semibold">{k.pseudo}</span>{' '}
                <span className="text-white/60">tour {Math.min(TOURS_KART, k.tours + 1)}/{TOURS_KART}</span>
                {k.bonus && <span className="ml-1">{NOM_BONUS[k.bonus].split(' ')[0]}</span>}
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
          appel="Scannez pour prendre un kart"
          regles={[
            `${TOURS_KART} tours · jusqu'à 8 pilotes`,
            'Volant : boutons ◀ ▶ ou téléphone penché',
            'Passe sur les boîtes ? pour un bonus, puis BONUS',
            '🚀 turbo · 🛢️ huile derrière toi · 🛡️ bouclier',
          ]}
          onLancer={lancer}
        />
      )}
      {phase === 'fini' && (
        <TableauScores
          titre="🏁 Arrivée"
          lignes={cl.map((k) => ({
            id: k.id,
            pseudo: k.pseudo,
            couleur: k.couleur,
            valeur: k.finiA !== null ? `${(k.finiA / 1000).toFixed(1)} s` : `${k.tours}/${TOURS_KART} tours`,
          }))}
          bouton="Rejouer ↻"
          onBouton={lancer}
        />
      )}
    </CadreTv>
  );
}

function dessiner(cv: HTMLCanvasElement | null, c: CourseKart | null, sec: number, phase: Phase, compte: number): void {
  const ctx = cv?.getContext('2d');
  if (!cv || !ctx) return;
  ctx.fillStyle = '#1d4a2a';
  ctx.fillRect(0, 0, LARGEUR, HAUTEUR);
  const stade = (r: number): void => {
    ctx.beginPath();
    ctx.moveTo(CX - DEMI, CY - r);
    ctx.lineTo(CX + DEMI, CY - r);
    ctx.arc(CX + DEMI, CY, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(CX - DEMI, CY + r);
    ctx.arc(CX - DEMI, CY, r, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.closePath();
  };
  ctx.fillStyle = '#44444e';
  stade(RAYON_EXT);
  ctx.fill();
  ctx.fillStyle = '#1d4a2a';
  stade(RAYON_INT);
  ctx.fill();
  // Bordures rouges et blanches
  ctx.lineWidth = 8;
  ctx.setLineDash([22, 22]);
  for (const coul of ['#e8e8e8', '#d63a2f']) {
    ctx.strokeStyle = coul;
    stade(RAYON_EXT);
    ctx.stroke();
    stade(RAYON_INT);
    ctx.stroke();
    ctx.lineDashOffset = 22;
  }
  ctx.lineDashOffset = 0;
  ctx.setLineDash([]);
  // Ligne d'arrivée
  const carre = 16;
  for (let y = CY + RAYON_INT; y < CY + RAYON_EXT; y += carre) {
    for (let k = 0; k < 2; k++) {
      ctx.fillStyle = (Math.floor((y - CY) / carre) + k) % 2 === 0 ? '#fff' : '#111';
      ctx.fillRect(CX - carre + k * carre, y, carre, carre);
    }
  }
  if (c) {
    // Boîtes à bonus
    for (const b of c.boites) {
      const dispo = sec >= b.dispoA;
      ctx.globalAlpha = dispo ? 1 : 0.15;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(sec * 1.5);
      ctx.fillStyle = '#f2c94c';
      ctx.fillRect(-14, -14, 28, 28);
      ctx.restore();
      ctx.fillStyle = '#111';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', b.x, b.y + 1);
      ctx.textBaseline = 'alphabetic';
    }
    ctx.globalAlpha = 1;
    // Flaques d'huile
    for (const f of c.flaques) {
      ctx.fillStyle = 'rgba(10,10,10,0.85)';
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, 26, 18, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(120,80,200,0.5)';
      ctx.beginPath();
      ctx.ellipse(f.x - 6, f.y - 4, 8, 5, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    // Karts
    for (const k of c.karts) {
      ctx.save();
      ctx.translate(k.x, k.y);
      ctx.rotate(k.angle);
      if (sec < k.turboJusqua) {
        ctx.fillStyle = '#ffb347';
        ctx.beginPath();
        ctx.moveTo(-18, -7);
        ctx.lineTo(-34 - Math.random() * 10, 0);
        ctx.lineTo(-18, 7);
        ctx.fill();
      }
      ctx.fillStyle = '#111';
      ctx.fillRect(-14, -13, 9, 5);
      ctx.fillRect(-14, 8, 9, 5);
      ctx.fillRect(7, -13, 9, 5);
      ctx.fillRect(7, 8, 9, 5);
      ctx.fillStyle = k.couleur;
      ctx.beginPath();
      ctx.moveTo(-16, -9);
      ctx.lineTo(18, -6);
      ctx.lineTo(18, 6);
      ctx.lineTo(-16, 9);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(-2, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (sec < k.bouclierJusqua) {
        ctx.strokeStyle = 'rgba(86,204,242,0.9)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(k.x, k.y, 24, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 17px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(sec < k.toupieJusqua ? `${k.pseudo} 💫` : k.pseudo, k.x, k.y - 24);
    }
  }
  if (phase === 'compte') dessinerCompte(ctx, LARGEUR, HAUTEUR, compte);
}
