/**
 * /ski — feat/jeux-manette-2 (test, caché)
 * Slalom : écran TV coupé en couloirs, un par skieur, même tracé pour tous.
 */
import { useRef, useState } from 'react';
import { useBoucle, useSalonTv } from '../../lib/jeux/salonManette.js';
import {
  LARGEUR_PISTE,
  LARGEUR_PORTE,
  LONGUEUR,
  PENALITE_PORTE,
  avancerSki,
  classementSki,
  genererParcours,
  nouveauSkieur,
  tempsFinal,
  type Parcours,
  type Skieur,
} from '../../lib/jeux/skiMoteur.js';
import { CadreTv, SalleAttente, TableauScores, dessinerCompte } from './CadreTv.js';

type Phase = 'attente' | 'compte' | 'jeu' | 'fini';
const L = 1600;
const H = 900;
const rangTexte = (r: number): string => `${r}${r === 1 ? 'er' : 'e'}`;

export function SkiTvPage(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('attente');
  const phaseRef = useRef<Phase>('attente');
  const skieurs = useRef<Skieur[]>([]);
  const parcours = useRef<Parcours | null>(null);
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
    parcours.current = genererParcours();
    skieurs.current = js.map((j) => nouveauSkieur(j.id, j.pseudo, j.couleur));
    finA.current = null;
    departA.current = performance.now() + 3000;
    changerPhase('compte');
  };

  const { code, joueurs, joueursRef, envoyerEtat } = useSalonTv('ski', {
    cmd: (m) => {
      const s = skieurs.current.find((x) => x.id === m.id);
      if (s) s.dir = m.x ?? 0;
    },
    lancer: () => lancer(),
    depart: (id) => {
      skieurs.current = skieurs.current.filter((s) => s.id !== id);
    },
  });

  useBoucle((dt, t) => {
    if (phaseRef.current === 'compte' && t >= departA.current) changerPhase('jeu');
    const p = parcours.current;
    const ms = t - departA.current;
    if (phaseRef.current === 'jeu' && p) {
      avancerSki(skieurs.current, p, dt, ms / 1000, ms);
      const ss = skieurs.current;
      if (ss.some((s) => s.finiA !== null) && finA.current === null) finA.current = t + 30000;
      const tous = ss.length > 0 && ss.every((s) => s.finiA !== null);
      if (tous || (finA.current !== null && t >= finA.current)) changerPhase('fini');
    }
    dessiner(toile.current, skieurs.current, p, ms, phaseRef.current, Math.ceil(-ms / 1000));
    if (t - dernierEtat.current > 250) {
      dernierEtat.current = t;
      const cl = classementSki(skieurs.current);
      const nb = p?.portes.length ?? 0;
      const ph = phaseRef.current;
      envoyerEtat({
        phase: ph,
        texte: ph === 'attente' ? 'En attente du départ' : '',
        perso: Object.fromEntries(
          cl.map((s, i) => {
            const tf = tempsFinal(s);
            return [
              s.id,
              tf !== null
                ? `🏁 ${rangTexte(i + 1)} · ${tf.toFixed(1)} s${s.ratees.length ? ` (+${s.ratees.length * PENALITE_PORTE} s)` : ''}`
                : `Porte ${Math.min(nb, s.porte + 1)}/${nb} · ${s.ratees.length} ratée${s.ratees.length > 1 ? 's' : ''}`,
            ];
          }),
        ),
      });
    }
  });

  const cl = classementSki(skieurs.current);
  return (
    <CadreTv emoji="⛷️" titre="Slalom" code={code} largeur={L} hauteur={H}>
      <canvas ref={toile} width={L} height={H} className="w-full h-full rounded-2xl" />
      {phase === 'attente' && (
        <SalleAttente
          code={code}
          joueurs={joueurs}
          appel="Scannez pour prendre le départ"
          regles={[
            'Dirige ton skieur : boutons ◀ ▶ ou téléphone penché',
            'Passe ENTRE les deux drapeaux de chaque porte',
            `Porte ratée : +${PENALITE_PORTE} s · sapin : chute`,
            'Même descente pour tout le monde, le meilleur temps gagne',
          ]}
          onLancer={lancer}
        />
      )}
      {phase === 'fini' && (
        <TableauScores
          titre="🏁 Arrivée"
          lignes={cl.map((s) => {
            const tf = tempsFinal(s);
            return {
              id: s.id,
              pseudo: s.pseudo,
              couleur: s.couleur,
              valeur: tf !== null ? `${tf.toFixed(1)} s${s.ratees.length ? ` (dont +${s.ratees.length * PENALITE_PORTE} s)` : ''}` : 'pas arrivé',
            };
          })}
          bouton="Rejouer ↻"
          onBouton={lancer}
        />
      )}
    </CadreTv>
  );
}

function dessiner(cv: HTMLCanvasElement | null, ss: Skieur[], p: Parcours | null, ms: number, phase: Phase, compte: number): void {
  const ctx = cv?.getContext('2d');
  if (!cv || !ctx) return;
  ctx.fillStyle = '#dfe9f3';
  ctx.fillRect(0, 0, L, H);
  const n = Math.max(1, ss.length);
  const col = L / n;
  const echelle = Math.min(1, col / LARGEUR_PISTE);
  ss.forEach((s, i) => {
    const x0 = i * col + (col - LARGEUR_PISTE * echelle) / 2;
    const camera = s.y - 220 / echelle; // le skieur reste dans le haut de l'écran
    const versEcran = (x: number, y: number): [number, number] => [x0 + x * echelle, (y - camera) * echelle];
    ctx.save();
    ctx.beginPath();
    ctx.rect(i * col, 0, col, H);
    ctx.clip();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x0, 0, LARGEUR_PISTE * echelle, H);
    // Traces de la piste
    ctx.strokeStyle = 'rgba(120,150,190,0.25)';
    ctx.lineWidth = 2;
    for (let k = 0; k < 6; k++) {
      const yy = ((k * 170 - camera * echelle) % (H + 200) + H + 200) % (H + 200) - 100;
      ctx.beginPath();
      ctx.moveTo(x0 + 20, yy);
      ctx.lineTo(x0 + LARGEUR_PISTE * echelle - 20, yy + 40);
      ctx.stroke();
    }
    if (p) {
      const vu = (y: number): boolean => y > camera - 60 && y < camera + H / echelle + 60;
      p.sapins.forEach((t) => {
        if (!vu(t.y)) return;
        const [x, y] = versEcran(t.x, t.y);
        const r = 18 * echelle;
        ctx.fillStyle = '#6b4a2b';
        ctx.fillRect(x - r * 0.15, y + r * 0.6, r * 0.3, r * 0.5);
        ctx.fillStyle = '#1f6b3a';
        ctx.beginPath();
        ctx.moveTo(x, y - r * 1.2);
        ctx.lineTo(x + r, y + r * 0.7);
        ctx.lineTo(x - r, y + r * 0.7);
        ctx.closePath();
        ctx.fill();
      });
      p.portes.forEach((g, k) => {
        if (!vu(g.y)) return;
        const passee = k < s.porte;
        const ratee = s.ratees.includes(k);
        const coul = ratee ? '#999' : k % 2 === 0 ? '#d63a2f' : '#2f6fd6';
        for (const cote of [-1, 1]) {
          const [x, y] = versEcran(g.x + (cote * LARGEUR_PORTE) / 2, g.y);
          ctx.strokeStyle = '#333';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y - 30 * echelle);
          ctx.stroke();
          ctx.fillStyle = coul;
          ctx.globalAlpha = passee && !ratee ? 0.45 : 1;
          ctx.fillRect(x, y - 30 * echelle, cote * 16 * echelle, 12 * echelle);
          ctx.globalAlpha = 1;
        }
        if (ratee) {
          const [x, y] = versEcran(g.x, g.y);
          ctx.fillStyle = '#d63a2f';
          ctx.font = `bold ${22 * echelle}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('✗', x, y);
        }
      });
      // Arrivée
      if (vu(LONGUEUR)) {
        const [x, y] = versEcran(0, LONGUEUR);
        ctx.fillStyle = '#111';
        for (let k = 0; k < LARGEUR_PISTE; k += 20) {
          if ((k / 20) % 2 === 0) ctx.fillRect(x + k * echelle, y, 20 * echelle, 10 * echelle);
        }
      }
    }
    // Skieur
    const [sx, sy] = versEcran(s.x, s.y);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(-s.dir * 0.5);
    ctx.fillStyle = '#222';
    ctx.fillRect(-9 * echelle, -14 * echelle, 3 * echelle, 30 * echelle);
    ctx.fillRect(6 * echelle, -14 * echelle, 3 * echelle, 30 * echelle);
    ctx.fillStyle = s.couleur;
    ctx.beginPath();
    ctx.arc(0, 0, 11 * echelle, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (ms / 1000 < s.chuteJusqua) {
      ctx.font = `bold ${22 * echelle}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('💥', sx, sy - 22 * echelle);
    }
    ctx.restore();
    // Bandeau du couloir
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(i * col, 0, col, 40);
    ctx.fillStyle = s.couleur;
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(s.pseudo, i * col + 10, 27);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'right';
    const tf = tempsFinal(s);
    ctx.fillText(tf !== null ? `${tf.toFixed(1)} s` : `${s.ratees.length ? `+${s.ratees.length * PENALITE_PORTE}s ` : ''}${Math.round((s.y / LONGUEUR) * 100)}%`, (i + 1) * col - 10, 27);
    if (i > 0) {
      ctx.fillStyle = '#8aa0b8';
      ctx.fillRect(i * col - 2, 0, 4, H);
    }
  });
  if (phase === 'jeu') {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(L / 2 - 90, H - 56, 180, 46);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 32px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.max(0, ms / 1000).toFixed(1)} s`, L / 2, H - 22);
  }
  if (phase === 'compte') dessinerCompte(ctx, L, H, compte);
}
