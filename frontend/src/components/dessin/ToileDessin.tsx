/**
 * <ToileDessin /> — feat/dessin-a-deviner
 * Affiche les traits du dessin sur une toile blanche 4:3, à n'importe quelle
 * taille (coordonnées 0..1000 rapportées à la largeur affichée).
 */
import { useEffect, useRef } from 'react';
import type { TraitDessin } from '@tutti/shared';

export const RATIO_TOILE = 3 / 4; // hauteur / largeur

export function dessinerTraits(ctx: CanvasRenderingContext2D, largeur: number, traits: TraitDessin[]): void {
  const hauteur = largeur * RATIO_TOILE;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, largeur, hauteur);
  const k = largeur / 1000;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const t of traits) {
    if (t.p.length < 2) continue;
    ctx.strokeStyle = t.c;
    ctx.fillStyle = t.c;
    ctx.lineWidth = Math.max(1, t.w * k);
    if (t.p.length === 2) {
      // Un simple point.
      ctx.beginPath();
      ctx.arc(t.p[0]! * k, t.p[1]! * k, Math.max(0.5, (t.w * k) / 2), 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(t.p[0]! * k, t.p[1]! * k);
    for (let i = 2; i < t.p.length; i += 2) ctx.lineTo(t.p[i]! * k, t.p[i + 1]! * k);
    ctx.stroke();
  }
}

interface Props {
  traits: TraitDessin[];
  /** Change à chaque modification des traits (les tableaux sont mutés). */
  version: number;
  className?: string;
}

export function ToileDessin({ traits, version, className = '' }: Props): JSX.Element {
  const conteneur = useRef<HTMLDivElement>(null);
  const toile = useRef<HTMLCanvasElement>(null);
  const traitsRef = useRef(traits);
  traitsRef.current = traits;

  const redessiner = (): void => {
    const c = toile.current;
    const box = conteneur.current;
    if (!c || !box) return;
    const largeur = box.clientWidth;
    if (largeur <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const h = largeur * RATIO_TOILE;
    if (c.width !== Math.round(largeur * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(largeur * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${largeur}px`;
      c.style.height = `${h}px`;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dessinerTraits(ctx, largeur, traitsRef.current);
  };

  useEffect(() => {
    const id = requestAnimationFrame(redessiner);
    return () => cancelAnimationFrame(id);
  }, [version, traits]);

  useEffect(() => {
    const box = conteneur.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(() => redessiner());
    obs.observe(box);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={conteneur} className={`w-full ${className}`}>
      <canvas ref={toile} className="block rounded-xl bg-white shadow-lg" />
    </div>
  );
}
