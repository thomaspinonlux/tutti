/**
 * <PlancheDessinateur /> — feat/dessin-a-deviner
 *
 * Le téléphone du joueur qui dessine : le mot (lui seul le voit), la toile
 * où il dessine au doigt, la palette, annuler / tout effacer. Chaque trait
 * part au serveur par petits morceaux (toutes les 40 ms) et s'affiche en
 * direct sur la TV et les téléphones des autres.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Socket } from 'socket.io-client';
import type { TraitDessin } from '@tutti/shared';
import { COULEURS_DESSIN, EPAISSEURS_DESSIN, lireDessin } from '../../lib/dessin.js';
import { RATIO_TOILE, dessinerTraits } from './ToileDessin.js';

interface Props {
  socket: Socket | null;
  sessionId: string;
  questionIndex: number;
  /** null tant que le mot n'est pas arrivé. */
  mot: string | null;
  /** Secondes restantes (null = temps écoulé / révélé). */
  restant: number | null;
  actif: boolean;
}

const INTERVALLE_ENVOI_MS = 40;

export function PlancheDessinateur({ socket, sessionId, questionIndex, mot, restant, actif }: Props): JSX.Element {
  const { t } = useTranslation();
  const [couleur, setCouleur] = useState<string>(COULEURS_DESSIN[0]);
  const [epaisseur, setEpaisseur] = useState<number>(EPAISSEURS_DESSIN[1]);
  const [nbTraits, setNbTraits] = useState(0);

  const conteneur = useRef<HTMLDivElement>(null);
  const toile = useRef<HTMLCanvasElement>(null);
  const traits = useRef<TraitDessin[]>([]);
  const enCours = useRef<{ index: number; envoye: boolean; enAttente: number[] } | null>(null);
  const actifRef = useRef(actif);
  actifRef.current = actif;

  const largeur = (): number => conteneur.current?.clientWidth ?? 0;

  const redessiner = (): void => {
    const c = toile.current;
    const l = largeur();
    if (!c || l <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const h = l * RATIO_TOILE;
    if (c.width !== Math.round(l * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(l * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${l}px`;
      c.style.height = `${h}px`;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dessinerTraits(ctx, l, traits.current);
  };

  // Nouvelle question : toile vierge, puis rattrapage si la page a été
  // rechargée en plein dessin (les traits déjà envoyés sont au serveur).
  useEffect(() => {
    traits.current = [];
    enCours.current = null;
    setNbTraits(0);
    redessiner();
    let vivant = true;
    lireDessin(sessionId)
      .then((d) => {
        if (!vivant || !d || d.question_index !== questionIndex || traits.current.length > 0) return;
        traits.current = d.traits.map((tr) => ({ ...tr, p: [...tr.p] }));
        setNbTraits(traits.current.length);
        redessiner();
      })
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [sessionId, questionIndex]);

  useEffect(() => {
    const box = conteneur.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(() => redessiner());
    obs.observe(box);
    return () => obs.disconnect();
  }, []);

  // Envoi régulier des points en attente.
  const envoyer = (): void => {
    const cur = enCours.current;
    if (!cur || cur.enAttente.length === 0 || !socket) return;
    const trait = traits.current[cur.index];
    if (!trait) return;
    const p = cur.enAttente.splice(0, 800);
    socket.emit('dessin:trait', {
      q: questionIndex,
      i: cur.index,
      ...(cur.envoye ? {} : { c: trait.c, w: trait.w }),
      p,
    });
    cur.envoye = true;
  };
  useEffect(() => {
    const id = window.setInterval(envoyer, INTERVALLE_ENVOI_MS);
    return () => window.clearInterval(id);
  });

  const point = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    const k = 1000 / Math.max(1, r.width);
    return [
      Math.max(0, Math.min(1000, Math.round((e.clientX - r.left) * k))),
      Math.max(0, Math.min(Math.round(1000 * RATIO_TOILE), Math.round((e.clientY - r.top) * k))),
    ];
  };

  const debut = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!actifRef.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    envoyer();
    const [x, y] = point(e);
    traits.current.push({ c: couleur, w: epaisseur, p: [x, y] });
    enCours.current = { index: traits.current.length - 1, envoye: false, enAttente: [x, y] };
    setNbTraits(traits.current.length);
    redessiner();
  };

  const bouge = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const cur = enCours.current;
    if (!cur || !actifRef.current) return;
    e.preventDefault();
    const trait = traits.current[cur.index];
    if (!trait) return;
    const [x, y] = point(e);
    const px = trait.p[trait.p.length - 2]!;
    const py = trait.p[trait.p.length - 1]!;
    if (Math.abs(x - px) + Math.abs(y - py) < 3) return;
    trait.p.push(x, y);
    cur.enAttente.push(x, y);
    redessiner();
  };

  const fin = (): void => {
    envoyer();
    enCours.current = null;
  };

  const annuler = (): void => {
    if (!actif || traits.current.length === 0) return;
    envoyer();
    enCours.current = null;
    traits.current.pop();
    setNbTraits(traits.current.length);
    redessiner();
    socket?.emit('dessin:annuler');
  };

  const toutEffacer = (): void => {
    if (!actif || traits.current.length === 0) return;
    enCours.current = null;
    traits.current = [];
    setNbTraits(0);
    redessiner();
    socket?.emit('dessin:effacer');
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border-2 border-ink bg-lemon px-4 py-3 text-center">
        <p className="font-mono text-xs uppercase tracking-wider">{t('dessin.aToiDeDessiner')}</p>
        <p className="font-display text-4xl leading-tight break-words">{mot ?? '…'}</p>
        {restant !== null && (
          <p className="font-mono text-sm mt-1 tabular-nums">{t('dessin.secondes', { n: restant })}</p>
        )}
      </div>

      <div ref={conteneur} className="w-full">
        <canvas
          ref={toile}
          onPointerDown={debut}
          onPointerMove={bouge}
          onPointerUp={fin}
          onPointerCancel={fin}
          onPointerLeave={fin}
          className={`block rounded-xl border-2 border-ink bg-white ${actif ? '' : 'opacity-60'}`}
          style={{ touchAction: 'none' }}
          aria-label={t('dessin.toile')}
        />
      </div>

      <div className="flex flex-wrap gap-2 justify-center" role="group" aria-label={t('dessin.couleur')}>
        {COULEURS_DESSIN.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCouleur(c)}
            aria-pressed={c === couleur}
            aria-label={c === '#FFFFFF' ? t('dessin.gomme') : c}
            className={`h-9 w-9 rounded-full border-2 ${c === couleur ? 'border-ink ring-2 ring-offset-2 ring-ink' : 'border-ink/40'}`}
            style={{ background: c }}
          >
            {c === '#FFFFFF' ? '⌫' : ''}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-center gap-2">
        {EPAISSEURS_DESSIN.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setEpaisseur(w)}
            aria-pressed={w === epaisseur}
            aria-label={t('dessin.epaisseur', { n: w })}
            className={`h-10 w-12 rounded-lg border-2 flex items-center justify-center ${w === epaisseur ? 'border-ink bg-cream-2' : 'border-ink/30'}`}
          >
            <span className="rounded-full bg-ink" style={{ width: Math.max(4, w / 1.4), height: Math.max(4, w / 1.4) }} />
          </button>
        ))}
        <button
          type="button"
          onClick={annuler}
          disabled={!actif || nbTraits === 0}
          className="h-10 px-3 rounded-lg border-2 border-ink font-medium disabled:opacity-40"
        >
          ↶ {t('dessin.annuler')}
        </button>
        <button
          type="button"
          onClick={toutEffacer}
          disabled={!actif || nbTraits === 0}
          className="h-10 px-3 rounded-lg border-2 border-ink font-medium disabled:opacity-40"
        >
          {t('dessin.effacer')}
        </button>
      </div>
    </div>
  );
}
