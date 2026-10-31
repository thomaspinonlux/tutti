/**
 * /reflexe — feat/jeux-manette (test, caché)
 * Réflexe : écran TV. Les téléphones passent au vert en même temps que la TV
 * et mesurent eux-mêmes le temps de réaction.
 */
import { useRef, useState } from 'react';
import { useBoucle, useSalonTv, type EtatManette } from '../../lib/jeux/salonManette.js';
import {
  ATTENTE_GO_MS,
  MANCHES,
  classerManche,
  tirerManche,
  type Etape,
  type LigneManche,
  type Reponse,
} from '../../lib/jeux/reflexeRegles.js';
import { CadreTv, SalleAttente, TableauScores } from './CadreTv.js';

type Phase = 'attente' | 'jeu' | 'fini';
const DUREE_PIEGE = 900;
const DUREE_RESULTAT = 4500;
const ANTICIPATION_MS = 90; // en dessous, personne ne réagit : c'est un pari

export function ReflexeTvPage(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('attente');
  const [etape, setEtape] = useState<Etape>('pret');
  const [manche, setManche] = useState(1);
  const [lignes, setLignes] = useState<LigneManche[]>([]);
  const phaseRef = useRef<Phase>('attente');
  const etapeRef = useRef<Etape>('pret');
  const mancheRef = useRef(1);
  const debutManche = useRef(0);
  const plan = useRef<{ goA: number; piegeA: number | null }>({ goA: 0, piegeA: null });
  const goA = useRef(0);
  const resultatA = useRef(0);
  const reponses = useRef(new Map<string, Reponse>());
  const scores = useRef(new Map<string, number>());
  const participants = useRef<string[]>([]);
  const dernierEtat = useRef(0);

  const etat = (): EtatManette => ({
    phase: phaseRef.current === 'jeu' ? 'jeu' : phaseRef.current,
    texte: phaseRef.current === 'attente' ? 'En attente du départ' : '',
    reflexe: { etape: etapeRef.current, manche: mancheRef.current },
    perso: Object.fromEntries(
      participants.current.map((id) => {
        const l = lignesRef.current.find((x) => x.id === id);
        const total = scores.current.get(id) ?? 0;
        const detail =
          etapeRef.current === 'resultat' && l
            ? l.faux
              ? 'Faux départ ! · '
              : l.ms !== null
                ? `${l.ms} ms (+${l.points}) · `
                : 'Trop tard · '
            : '';
        return [id, `${detail}${total} pt${Math.abs(total) > 1 ? 's' : ''}`];
      }),
    ),
  });
  const lignesRef = useRef<LigneManche[]>([]);

  const changerEtape = (e: Etape): void => {
    etapeRef.current = e;
    setEtape(e);
    envoyerEtat(etat());
  };
  const changerPhase = (p: Phase): void => {
    phaseRef.current = p;
    setPhase(p);
    envoyerEtat(etat());
  };

  const preparerManche = (n: number, t: number): void => {
    mancheRef.current = n;
    setManche(n);
    reponses.current = new Map();
    lignesRef.current = [];
    setLignes([]);
    const tir = tirerManche(n);
    debutManche.current = t;
    const piegeA = tir.piegeMs === null ? null : t + tir.piegeMs;
    const go = piegeA === null ? t + tir.attenteMs : Math.max(t + tir.attenteMs, piegeA + DUREE_PIEGE + 800);
    plan.current = { goA: go, piegeA };
    changerEtape('pret');
  };

  const lancer = (): void => {
    if (phaseRef.current === 'jeu') return;
    const js = joueursRef.current;
    if (js.length === 0) return;
    participants.current = js.map((j) => j.id);
    scores.current = new Map(js.map((j) => [j.id, 0]));
    phaseRef.current = 'jeu';
    setPhase('jeu');
    preparerManche(1, performance.now() + 1500);
  };

  const { code, joueurs, joueursRef, envoyerEtat } = useSalonTv('reflexe', {
    action: (a) => {
      if (phaseRef.current !== 'jeu' || a.manche !== mancheRef.current) return;
      if (!participants.current.includes(a.id) || reponses.current.has(a.id)) return;
      const e = etapeRef.current;
      if (a.type === 'faux' && e !== 'resultat') reponses.current.set(a.id, { id: a.id, ms: null });
      if (a.type === 'tap' && e === 'go' && typeof a.ms === 'number') {
        reponses.current.set(a.id, { id: a.id, ms: a.ms < ANTICIPATION_MS ? null : a.ms });
      }
    },
    lancer: () => lancer(),
    depart: (id) => {
      participants.current = participants.current.filter((x) => x !== id);
    },
  });

  useBoucle((_dt, t) => {
    if (phaseRef.current === 'jeu') {
      const e = etapeRef.current;
      const p = plan.current;
      if (e === 'pret' && p.piegeA !== null && t >= p.piegeA && t < p.piegeA + DUREE_PIEGE) changerEtape('piege');
      else if (e === 'piege' && p.piegeA !== null && t >= p.piegeA + DUREE_PIEGE) {
        p.piegeA = null; // un seul piège par manche
        changerEtape('pret');
      } else if (e === 'pret' && t >= p.goA) {
        goA.current = t;
        changerEtape('go');
      } else if (e === 'go') {
        const tous = participants.current.every((id) => reponses.current.has(id));
        if (tous || t - goA.current >= ATTENTE_GO_MS) {
          const l = classerManche(participants.current, reponses.current);
          for (const x of l) scores.current.set(x.id, (scores.current.get(x.id) ?? 0) + x.points);
          lignesRef.current = l;
          setLignes(l);
          resultatA.current = t;
          changerEtape('resultat');
        }
      } else if (e === 'resultat' && t - resultatA.current >= DUREE_RESULTAT) {
        if (mancheRef.current >= MANCHES) changerPhase('fini');
        else preparerManche(mancheRef.current + 1, t);
      }
    }
    if (t - dernierEtat.current > 1000) {
      dernierEtat.current = t;
      envoyerEtat(etat());
    }
  });

  const nom = (id: string): { pseudo: string; couleur: string } =>
    joueurs.find((j) => j.id === id) ?? { pseudo: '(parti)', couleur: '#666' };
  const classement = [...scores.current.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, s]) => ({ id, ...nom(id), valeur: `${s} pt${Math.abs(s) > 1 ? 's' : ''}` }));

  const fond =
    phase !== 'jeu'
      ? '#14141c'
      : etape === 'go'
        ? '#1fae5b'
        : etape === 'piege'
          ? '#f2994a'
          : etape === 'resultat'
            ? '#14141c'
            : '#b3261e';

  return (
    <CadreTv emoji="⚡" titre="Réflexe" code={code} largeur={16} hauteur={9}>
      <div className="w-full h-full rounded-2xl flex flex-col items-center justify-center gap-6 p-8" style={{ background: fond }}>
        {phase === 'jeu' && (
          <p className="absolute top-4 left-6 text-2xl font-mono text-white/80">
            Manche {manche}/{MANCHES}
          </p>
        )}
        {phase === 'jeu' && etape === 'pret' && <p className="font-display text-[9rem] leading-none">Attendez…</p>}
        {phase === 'jeu' && etape === 'piege' && <p className="font-display text-[9rem] leading-none">PIÈGE !</p>}
        {phase === 'jeu' && etape === 'go' && <p className="font-display text-[11rem] leading-none">TAPEZ !</p>}
        {phase === 'jeu' && etape === 'resultat' && (
          <ol className="space-y-2 text-3xl">
            {lignes.map((l, i) => (
              <li key={l.id} className="flex items-center gap-3">
                <span className="w-12 text-right">{l.ms !== null ? (['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`) : '·'}</span>
                <span className="inline-block h-5 w-5 rounded-full" style={{ background: nom(l.id).couleur }} />
                <span className="font-semibold">{nom(l.id).pseudo}</span>
                <span className="font-mono text-2xl text-white/70">
                  {l.faux ? 'faux départ' : l.ms !== null ? `${l.ms} ms` : 'trop tard'}
                </span>
                <span className="font-mono text-2xl">{l.points > 0 ? `+${l.points}` : l.points}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      {phase === 'attente' && (
        <SalleAttente
          code={code}
          joueurs={joueurs}
          appel="Scannez pour tester vos réflexes"
          regles={[
            `${MANCHES} manches · regardez votre téléphone`,
            'Rouge : attendez · VERT : tapez le plus vite possible',
            'Orange = piège : ne tapez pas !',
            'Taper trop tôt = faux départ (−2)',
          ]}
          onLancer={lancer}
        />
      )}
      {phase === 'fini' && (
        <TableauScores titre={`🏆 ${classement[0]?.pseudo ?? ''} gagne !`} lignes={classement} bouton="Rejouer ↻" onBouton={lancer} />
      )}
    </CadreTv>
  );
}
