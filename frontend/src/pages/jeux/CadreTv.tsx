/**
 * CadreTv.tsx — feat/jeux-manette
 * Habillage commun des écrans TV des jeux téléphone-manette : en-tête,
 * salle d'attente (QR code + joueurs + départ) et tableau des scores.
 */
import type { ReactNode } from 'react';
import { getShareableOrigin } from '../../lib/platform.js';
import { QRCode } from '../../components/host/QRCode.js';
import type { JoueurSalon } from '../../lib/jeux/salonManette.js';

export const urlManette = (code: string): string => `${getShareableOrigin()}/manette/${code}`;

export function CadreTv(props: {
  emoji: string;
  titre: string;
  code: string | null;
  largeur: number;
  hauteur: number;
  children: ReactNode;
  bas?: ReactNode;
}): JSX.Element {
  return (
    <div className="min-h-screen bg-[#0B0B0F] text-white flex flex-col items-center p-4 gap-4">
      <div className="w-full max-w-[1600px] flex items-center justify-between gap-4">
        <h1 className="font-display text-4xl">
          {props.emoji} {props.titre} <span className="text-white/40 text-xl font-mono">test</span>
        </h1>
        {props.code && (
          <p className="font-mono text-2xl">
            tuttiparty.app/manette · <span className="text-[#FF5C4D] font-bold tracking-[0.3em]">{props.code}</span>
          </p>
        )}
      </div>
      <div className="relative w-full max-w-[1600px]" style={{ aspectRatio: `${props.largeur} / ${props.hauteur}` }}>
        {props.children}
      </div>
      {props.bas}
    </div>
  );
}

export function SalleAttente(props: {
  code: string | null;
  joueurs: JoueurSalon[];
  appel: string;
  regles: string[];
  onLancer: () => void;
  min?: number;
}): JSX.Element {
  const min = props.min ?? 1;
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-10 bg-black/70 rounded-2xl p-6">
      {props.code && (
        <div className="rounded-2xl bg-white p-4 shrink-0">
          <QRCode value={urlManette(props.code)} size={260} />
        </div>
      )}
      <div className="space-y-3 max-w-xl">
        <p className="font-display text-4xl">{props.appel}</p>
        <ul className="text-white/75 text-xl space-y-1">
          {props.regles.map((r) => (
            <li key={r}>• {r}</li>
          ))}
        </ul>
        <ul className="flex flex-wrap gap-2 min-h-[2.5rem]">
          {props.joueurs.map((j) => (
            <li key={j.id} className="rounded-full px-3 py-1 font-semibold text-black" style={{ background: j.couleur }}>
              {j.pseudo}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={props.onLancer}
          disabled={props.joueurs.length < min}
          className="mt-2 rounded-xl bg-[#FF5C4D] px-6 py-3 text-2xl font-bold disabled:opacity-40"
        >
          Départ ▶
        </button>
        <p className="text-white/50 text-sm">Un joueur peut aussi lancer depuis son téléphone.</p>
      </div>
    </div>
  );
}

export interface LigneScore {
  id: string;
  pseudo: string;
  couleur: string;
  valeur: string;
}

export function TableauScores(props: {
  titre: string;
  sousTitre?: string;
  lignes: LigneScore[];
  bouton: string;
  onBouton: () => void;
}): JSX.Element {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/75 rounded-2xl p-6">
      <p className="font-display text-6xl text-center">{props.titre}</p>
      {props.sousTitre && <p className="text-2xl text-white/70 text-center">{props.sousTitre}</p>}
      <ol className="space-y-2 text-3xl">
        {props.lignes.map((l, i) => (
          <li key={l.id} className="flex items-center gap-3">
            <span className="w-12 text-right">{['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`}</span>
            <span className="inline-block h-5 w-5 rounded-full" style={{ background: l.couleur }} />
            <span className="font-semibold">{l.pseudo}</span>
            <span className="text-white/60 font-mono text-xl">{l.valeur}</span>
          </li>
        ))}
      </ol>
      <button type="button" onClick={props.onBouton} className="rounded-xl bg-[#FF5C4D] px-6 py-3 text-2xl font-bold">
        {props.bouton}
      </button>
    </div>
  );
}

/** Grand chiffre du compte à rebours, à dessiner par-dessus le canvas. */
export function dessinerCompte(ctx: CanvasRenderingContext2D, l: number, h: number, n: number): void {
  if (n <= 0) return;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, l, h);
  ctx.fillStyle = '#FF5C4D';
  ctx.font = 'bold 260px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), l / 2, h / 2);
  ctx.textBaseline = 'alphabetic';
}
