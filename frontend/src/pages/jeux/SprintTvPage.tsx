/**
 * /sprint — feat/jeux-manette-2 (test, caché)
 * Sprint 100 m : écran TV. Le téléphone a deux pieds à taper en alternance.
 */
import { useRef, useState } from 'react';
import { useBoucle, useSalonTv } from '../../lib/jeux/salonManette.js';
import { DISTANCE, cadence, classementSprint, nouveauCoureur, pas, recharger, type Coureur } from '../../lib/jeux/sprintMoteur.js';
import { CadreTv, SalleAttente, TableauScores, dessinerCompte } from './CadreTv.js';

type Phase = 'attente' | 'compte' | 'jeu' | 'fini';
const L = 1600;
const H = 900;
const DEBUT = 170;
const FIN = 1480;
const rangTexte = (r: number): string => `${r}${r === 1 ? 'er' : 'e'}`;

export function SprintTvPage(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('attente');
  const [record, setRecord] = useState<{ pseudo: string; s: number } | null>(null);
  const phaseRef = useRef<Phase>('attente');
  const coureurs = useRef<Coureur[]>([]);
  const affiche = useRef(new Map<string, number>()); // position lissée
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
    coureurs.current = js.map((j) => nouveauCoureur(j.id, j.pseudo, j.couleur));
    affiche.current = new Map();
    finA.current = null;
    departA.current = performance.now() + 3000;
    changerPhase('compte');
  };

  const { code, joueurs, joueursRef, envoyerEtat } = useSalonTv('sprint', {
    action: (a) => {
      if (phaseRef.current !== 'jeu' || (a.type !== 'g' && a.type !== 'd')) return;
      const c = coureurs.current.find((x) => x.id === a.id);
      if (c) pas(c, a.type, performance.now() - departA.current);
    },
    lancer: () => lancer(),
    depart: (id) => {
      coureurs.current = coureurs.current.filter((c) => c.id !== id);
    },
  });

  useBoucle((dt, t) => {
    if (phaseRef.current === 'compte' && t >= departA.current) changerPhase('jeu');
    const ms = t - departA.current;
    if (phaseRef.current === 'jeu') {
      recharger(coureurs.current, dt);
      const cs = coureurs.current;
      if (cs.some((c) => c.finiA !== null) && finA.current === null) finA.current = t + 20000;
      const tous = cs.length > 0 && cs.every((c) => c.finiA !== null);
      if (tous || (finA.current !== null && t >= finA.current) || ms > 90_000) {
        const meilleur = classementSprint(cs)[0];
        if (meilleur?.finiA != null) {
          const s = meilleur.finiA / 1000;
          setRecord((r) => (r && r.s <= s ? r : { pseudo: meilleur.pseudo, s }));
        }
        changerPhase('fini');
      }
    }
    for (const c of coureurs.current) {
      const a = affiche.current.get(c.id) ?? 0;
      affiche.current.set(c.id, a + (c.m - a) * Math.min(1, dt * 12));
    }
    dessiner(toile.current, coureurs.current, affiche.current, ms, phaseRef.current, Math.ceil(-ms / 1000));
    if (t - dernierEtat.current > 250) {
      dernierEtat.current = t;
      const cl = classementSprint(coureurs.current);
      const ph = phaseRef.current;
      envoyerEtat({
        phase: ph,
        texte: ph === 'attente' ? 'En attente du départ' : '',
        perso: Object.fromEntries(
          cl.map((c, i) => [
            c.id,
            c.finiA !== null ? `🏁 ${rangTexte(i + 1)} · ${(c.finiA / 1000).toFixed(2)} s` : `${c.m} m · ${rangTexte(i + 1)}`,
          ]),
        ),
      });
    }
  });

  const cl = classementSprint(coureurs.current);
  return (
    <CadreTv emoji="🏃" titre="Sprint 100 m" code={code} largeur={L} hauteur={H}>
      <canvas ref={toile} width={L} height={H} className="w-full h-full rounded-2xl" />
      {phase === 'attente' && (
        <SalleAttente
          code={code}
          joueurs={joueurs}
          appel="Scannez pour entrer sur la piste"
          regles={[
            'Tape GAUCHE, DROITE, GAUCHE, DROITE le plus vite possible',
            '2 fois le même pied ne compte pas',
            '1 pas = 1 mètre · 100 m',
            'Record du monde : 9,58 s',
          ]}
          onLancer={lancer}
        />
      )}
      {phase === 'fini' && (
        <TableauScores
          titre="🏁 Arrivée"
          sousTitre={record ? `Record du salon : ${record.pseudo} en ${record.s.toFixed(2)} s` : undefined}
          lignes={cl.map((c) => ({
            id: c.id,
            pseudo: c.pseudo,
            couleur: c.couleur,
            valeur: c.finiA !== null ? `${(c.finiA / 1000).toFixed(2)} s` : `${c.m} m`,
          }))}
          bouton="Rejouer ↻"
          onBouton={lancer}
        />
      )}
    </CadreTv>
  );
}

function dessiner(cv: HTMLCanvasElement | null, cs: Coureur[], aff: Map<string, number>, ms: number, phase: Phase, compte: number): void {
  const ctx = cv?.getContext('2d');
  if (!cv || !ctx) return;
  ctx.fillStyle = '#2e6b3a';
  ctx.fillRect(0, 0, L, H);
  const n = Math.max(1, cs.length);
  const couloir = Math.min(110, 760 / n);
  const haut = (H - couloir * n) / 2;
  ctx.fillStyle = '#b5482f';
  ctx.fillRect(0, haut, L, couloir * n);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= n; i++) {
    ctx.beginPath();
    ctx.moveTo(0, haut + i * couloir);
    ctx.lineTo(L, haut + i * couloir);
    ctx.stroke();
  }
  const xDe = (m: number): number => DEBUT + (m / DISTANCE) * (FIN - DEBUT);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (let m = 10; m < DISTANCE; m += 10) {
    ctx.fillRect(xDe(m) - 1, haut, 2, couloir * n);
    ctx.fillText(`${m}`, xDe(m), haut - 10);
  }
  // Départ et arrivée (damier)
  ctx.fillStyle = '#fff';
  ctx.fillRect(xDe(0) - 3, haut, 6, couloir * n);
  const carre = 14;
  for (let y = haut; y < haut + couloir * n; y += carre) {
    for (let k = 0; k < 2; k++) {
      ctx.fillStyle = (Math.floor((y - haut) / carre) + k) % 2 === 0 ? '#fff' : '#111';
      ctx.fillRect(xDe(DISTANCE) + k * carre, y, carre, carre);
    }
  }
  cs.forEach((c, i) => {
    const y = haut + i * couloir + couloir / 2;
    const m = aff.get(c.id) ?? 0;
    const x = xDe(m);
    const cad = cadence(c, ms);
    const bond = c.finiA === null && phase === 'jeu' ? Math.abs(Math.sin(ms / 60)) * Math.min(1, cad / 6) * 10 : 0;
    // Coureur : tête + corps
    ctx.fillStyle = c.couleur;
    ctx.beginPath();
    ctx.arc(x, y - 12 - bond, Math.min(16, couloir / 5), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c.couleur;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x, y - bond);
    ctx.lineTo(x - 6, y + Math.min(26, couloir / 3) - bond);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.min(20, couloir / 3.5)}px system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(c.pseudo, DEBUT - 20, y + 6);
    ctx.textAlign = 'left';
    ctx.fillText(c.finiA !== null ? `${(c.finiA / 1000).toFixed(2)} s` : phase === 'jeu' ? `${cad}/s` : '', Math.min(x + 26, FIN + 40), y + 6);
  });
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 54px ui-monospace, monospace';
  ctx.textAlign = 'center';
  if (phase === 'jeu') ctx.fillText(`${Math.max(0, ms / 1000).toFixed(2)} s`, L / 2, H - 24);
  if (phase === 'compte') dessinerCompte(ctx, L, H, compte);
}
