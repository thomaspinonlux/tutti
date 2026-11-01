/**
 * /moto — feat/jeux-manette-2 (test, caché)
 * Moto cross vue de côté : une ligne par pilote, même terrain pour tous.
 */
import { useRef, useState } from 'react';
import { useBoucle, useSalonTv } from '../../lib/jeux/salonManette.js';
import {
  LONGUEUR,
  avancerPilote,
  classementMoto,
  genererTerrain,
  nouveauPilote,
  sol,
  type Pilote,
  type Point,
} from '../../lib/jeux/motoMoteur.js';
import { CadreTv, SalleAttente, TableauScores, dessinerCompte } from './CadreTv.js';

type Phase = 'attente' | 'compte' | 'jeu' | 'fini';
const L = 1600;
const H = 900;
const rangTexte = (r: number): string => `${r}${r === 1 ? 'er' : 'e'}`;

export function MotoTvPage(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('attente');
  const phaseRef = useRef<Phase>('attente');
  const pilotes = useRef<Pilote[]>([]);
  const terrain = useRef<Point[]>([]);
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
    terrain.current = genererTerrain();
    pilotes.current = js.map((j) => nouveauPilote(j.id, j.pseudo, j.couleur));
    finA.current = null;
    departA.current = performance.now() + 3000;
    changerPhase('compte');
  };

  const { code, joueurs, joueursRef, envoyerEtat } = useSalonTv('moto', {
    cmd: (m) => {
      const p = pilotes.current.find((x) => x.id === m.id);
      if (p) {
        p.gaz = m.g;
        p.penche = m.x ?? 0;
      }
    },
    lancer: () => lancer(),
    depart: (id) => {
      pilotes.current = pilotes.current.filter((p) => p.id !== id);
    },
  });

  useBoucle((dt, t) => {
    if (phaseRef.current === 'compte' && t >= departA.current) changerPhase('jeu');
    const ms = t - departA.current;
    if (phaseRef.current === 'jeu') {
      for (const p of pilotes.current) avancerPilote(p, terrain.current, dt, ms / 1000, ms);
      const ps = pilotes.current;
      if (ps.some((p) => p.finiA !== null) && finA.current === null) finA.current = t + 20000;
      const tous = ps.length > 0 && ps.every((p) => p.finiA !== null);
      if (tous || (finA.current !== null && t >= finA.current)) changerPhase('fini');
    }
    dessiner(toile.current, pilotes.current, terrain.current, ms, phaseRef.current, Math.ceil(-ms / 1000));
    if (t - dernierEtat.current > 250) {
      dernierEtat.current = t;
      const cl = classementMoto(pilotes.current);
      const ph = phaseRef.current;
      envoyerEtat({
        phase: ph,
        texte: ph === 'attente' ? 'En attente du départ' : '',
        perso: Object.fromEntries(
          cl.map((p, i) => [
            p.id,
            p.finiA !== null
              ? `🏁 ${rangTexte(i + 1)} · ${(p.finiA / 1000).toFixed(1)} s`
              : `${ms / 1000 < p.chuteJusqua ? '💥 Chute ! · ' : p.air ? '✈️ En l’air · ' : ''}${Math.round((p.x / LONGUEUR) * 100)} % · ${rangTexte(i + 1)}`,
          ]),
        ),
      });
    }
  });

  const cl = classementMoto(pilotes.current);
  return (
    <CadreTv emoji="🏍️" titre="Moto cross" code={code} largeur={L} hauteur={H}>
      <canvas ref={toile} width={L} height={H} className="w-full h-full rounded-2xl" />
      {phase === 'attente' && (
        <SalleAttente
          code={code}
          joueurs={joueurs}
          appel="Scannez pour enfourcher une moto"
          regles={[
            'GAZ pour avancer (à maintenir)',
            'En l’air : ↶ en arrière / ↷ en avant pour retomber à plat',
            'Mauvaise réception = chute (1,5 s)',
            'Même terrain pour tous · jusqu’à 6 pilotes',
          ]}
          onLancer={lancer}
        />
      )}
      {phase === 'fini' && (
        <TableauScores
          titre="🏁 Arrivée"
          lignes={cl.map((p) => ({
            id: p.id,
            pseudo: p.pseudo,
            couleur: p.couleur,
            valeur: `${p.finiA !== null ? `${(p.finiA / 1000).toFixed(1)} s` : `${Math.round((p.x / LONGUEUR) * 100)} %`} · ${p.chutes} chute${p.chutes > 1 ? 's' : ''}`,
          }))}
          bouton="Rejouer ↻"
          onBouton={lancer}
        />
      )}
    </CadreTv>
  );
}

function dessiner(cv: HTMLCanvasElement | null, ps: Pilote[], terr: Point[], ms: number, phase: Phase, compte: number): void {
  const ctx = cv?.getContext('2d');
  if (!cv || !ctx) return;
  ctx.fillStyle = '#87b8e0';
  ctx.fillRect(0, 0, L, H);
  const n = Math.max(1, ps.length);
  const ligne = H / n;
  const echelle = Math.min(1, ligne / 300);
  ps.forEach((p, i) => {
    const y0 = i * ligne;
    const solY = y0 + ligne - 30 * echelle; // hauteur 0 du terrain à l'écran
    const camera = p.x - 260 / echelle;
    const ecranX = (x: number): number => (x - camera) * echelle;
    const ecranY = (h: number): number => solY - h * echelle;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y0, L, ligne);
    ctx.clip();
    // Ciel en dégradé discret
    ctx.fillStyle = i % 2 === 0 ? '#9cc6e8' : '#8fbde3';
    ctx.fillRect(0, y0, L, ligne);
    // Terrain
    if (terr.length > 1) {
      ctx.fillStyle = '#8a5a34';
      ctx.beginPath();
      ctx.moveTo(0, y0 + ligne);
      const xMin = camera - 50;
      const xMax = camera + L / echelle + 50;
      ctx.lineTo(0, ecranY(sol(terr, xMin).h));
      for (const [x, h] of terr) {
        if (x < xMin || x > xMax) continue;
        ctx.lineTo(ecranX(x), ecranY(h));
      }
      ctx.lineTo(L, ecranY(sol(terr, xMax).h));
      ctx.lineTo(L, y0 + ligne);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#5b3a1f';
      ctx.lineWidth = 4 * echelle;
      ctx.stroke();
      // Arrivée
      const xa = ecranX(LONGUEUR);
      if (xa > -20 && xa < L + 20) {
        for (let k = 0; k < 8; k++) {
          ctx.fillStyle = k % 2 === 0 ? '#fff' : '#111';
          ctx.fillRect(xa, solY - (k + 1) * 14 * echelle, 10 * echelle, 14 * echelle);
        }
      }
    }
    // Moto
    const x = ecranX(p.x);
    const y = ecranY(p.h);
    const chute = ms / 1000 < p.chuteJusqua;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-(chute ? 1.4 : p.assiette));
    const r = 13 * echelle;
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 5 * echelle;
    for (const cx of [-24 * echelle, 24 * echelle]) {
      ctx.beginPath();
      ctx.arc(cx, -r, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = p.couleur;
    ctx.beginPath();
    ctx.moveTo(-26 * echelle, -r);
    ctx.lineTo(24 * echelle, -r);
    ctx.lineTo(12 * echelle, -r - 16 * echelle);
    ctx.lineTo(-14 * echelle, -r - 14 * echelle);
    ctx.closePath();
    ctx.fill();
    // Pilote
    const penche = Math.max(-1, Math.min(1, p.penche));
    ctx.fillStyle = p.couleur;
    ctx.fillRect(-6 * echelle + penche * 6 * echelle, -r - 38 * echelle, 10 * echelle, 24 * echelle);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(penche * 10 * echelle, -r - 44 * echelle, 8 * echelle, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (chute) {
      ctx.font = `bold ${26 * echelle}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('💥', x, y - 70 * echelle);
    }
    ctx.restore();
    // Bandeau : nom, progression
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, y0, L, 30);
    ctx.fillStyle = p.couleur;
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(p.pseudo, 10, y0 + 21);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(220, y0 + 11, 900, 8);
    ctx.fillStyle = p.couleur;
    ctx.fillRect(220, y0 + 11, 900 * Math.min(1, p.x / LONGUEUR), 8);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'right';
    ctx.fillText(p.finiA !== null ? `🏁 ${(p.finiA / 1000).toFixed(1)} s` : `${p.chutes} chute${p.chutes > 1 ? 's' : ''}`, L - 10, y0 + 21);
    if (i > 0) {
      ctx.fillStyle = '#2d2d2d';
      ctx.fillRect(0, y0 - 2, L, 4);
    }
  });
  if (phase === 'jeu') {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(L / 2 - 90, H - 52, 180, 44);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 30px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.max(0, ms / 1000).toFixed(1)} s`, L / 2, H - 20);
  }
  if (phase === 'compte') dessinerCompte(ctx, L, H, compte);
}
