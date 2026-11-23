/**
 * CadreTv.tsx — feat/jeux-manette
 * Habillage commun des écrans TV des jeux téléphone-manette : en-tête,
 * salle d'attente (QR code + joueurs + départ) et tableau des scores.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icone } from '../../components/ui/Icone.js';
import { getShareableOrigin } from '../../lib/platform.js';
import { QRCode } from '../../components/host/QRCode.js';
import type { JoueurSalon } from '../../lib/jeux/salonManette.js';

export const urlManette = (code: string): string => `${getShareableOrigin()}/manette/${code}`;

/**
 * Panneau posé sur le jeu (salle d'attente, scores) et cadre qui le porte.
 * Sur une TV le panneau recouvre exactement l'image. Sous 1024 px (iPad
 * debout, téléphone) l'image est trop basse pour le contenir : le bouton
 * « Départ » sortait de l'écran sans qu'on puisse défiler. Là, l'image (premier
 * enfant du cadre) et le panneau partagent une même case de grille : l'image
 * reste en haut à ses proportions, le panneau prend la hauteur qu'il lui faut,
 * le cadre grandit avec lui et la page défile.
 */
export const SUPERPOSE = 'relative lg:absolute lg:inset-0';
export const CADRE_JEU =
  'relative w-full max-w-[1600px] lg:[aspect-ratio:var(--ratio)] max-lg:grid max-lg:grid-cols-1 max-lg:[&>*]:col-start-1 max-lg:[&>*]:row-start-1 max-lg:[&>:first-child]:h-auto max-lg:[&>:first-child]:self-start max-lg:[&>:first-child]:[aspect-ratio:var(--ratio)]';
/** Les proportions du jeu, lues par le cadre (TV) ou par l'image (sous 1024 px). */
export const styleCadre = (largeur: number, hauteur: number): CSSProperties =>
  ({ '--ratio': `${largeur} / ${hauteur}` }) as CSSProperties;

/** Bouton secondaire « Changer de jeu » des tableaux de fin de partie. */
export function ChangerDeJeu(): JSX.Element {
  return (
    <Link
      to="/admin/arcade"
      className="rounded-xl border border-white/30 px-6 py-3 text-2xl font-bold hover:bg-white/10"
    >
      Changer de jeu
    </Link>
  );
}

/** Adresse à taper sur le téléphone quand on ne scanne pas le QR code. */
export const ADRESSE_MANETTE = 'tuttiparty.app/manette';

/**
 * En-tête commun des écrans de jeu — fix/parcours-arcade.
 * À gauche le retour vers la liste des jeux (l'écran n'avait aucune sortie),
 * à droite l'adresse et le code à taper pour qui ne scanne pas.
 */
export function EnTeteJeu(props: { titre: string; code: string | null }): JSX.Element {
  return (
    <div className="w-full max-w-[1600px] flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <div className="flex items-center gap-4 min-w-0">
        <Link
          to="/admin/arcade"
          className="shrink-0 inline-flex items-center gap-2 rounded-lg border border-white/25 px-4 py-2 text-lg font-semibold hover:bg-white/10"
        >
          <Icone nom="retour" />
          Tous les jeux
        </Link>
        <h1 className="font-display text-2xl sm:text-4xl truncate">
          {props.titre} <span className="text-white/40 text-xl font-mono">test</span>
        </h1>
      </div>
      {props.code && (
        <p className="font-mono text-lg sm:text-2xl">
          {ADRESSE_MANETTE} ·{' '}
          <span className="text-[#FF3366] font-bold tracking-[0.3em]">{props.code}</span>
        </p>
      )}
    </div>
  );
}

/** Rappel affiché dans la salle d'attente, sous le QR code. */
export function SansScanner(props: { code: string | null }): JSX.Element | null {
  if (!props.code) return null;
  return (
    <p className="text-white/75 text-lg">
      Sans scanner : ouvrir <span className="font-mono text-white">{ADRESSE_MANETTE}</span> et taper{' '}
      <span className="font-mono font-bold text-[#FF3366] tracking-[0.2em]">{props.code}</span>
    </p>
  );
}

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
    <div className="min-h-screen bg-[#0E0D17] text-white flex flex-col items-center p-4 gap-4">
      <EnTeteJeu titre={props.titre} code={props.code} />
      <div className={CADRE_JEU} style={styleCadre(props.largeur, props.hauteur)}>
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
    <div
      className={`${SUPERPOSE} flex flex-col lg:flex-row items-center justify-center gap-6 lg:gap-10 bg-black/85 lg:bg-black/70 rounded-2xl p-6`}
    >
      {props.code && (
        <div className="rounded-2xl bg-white p-4 shrink-0">
          <QRCode value={urlManette(props.code)} size={260} />
        </div>
      )}
      <div className="space-y-3 max-w-xl min-w-0">
        <p className="font-display text-4xl">{props.appel}</p>
        <ul className="text-white/75 text-xl space-y-1">
          {props.regles.map((r) => (
            <li key={r}>• {r}</li>
          ))}
        </ul>
        <ul className="flex flex-wrap gap-2 min-h-[2.5rem]">
          {props.joueurs.map((j) => (
            <li
              key={j.id}
              className="rounded-full px-3 py-1 font-semibold text-black"
              style={{ background: j.couleur }}
            >
              {j.pseudo}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={props.onLancer}
          disabled={props.joueurs.length < min}
          className="mt-2 rounded-xl bg-[#FF3366] px-6 py-3 text-2xl font-bold disabled:opacity-40"
        >
          Départ ▶
        </button>
        <p className="text-white/50 text-sm">Un joueur peut aussi lancer depuis son téléphone.</p>
        <SansScanner code={props.code} />
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
    <div
      className={`${SUPERPOSE} flex flex-col items-center justify-center gap-4 bg-black/85 lg:bg-black/75 rounded-2xl p-6`}
    >
      <p className="font-display text-4xl lg:text-6xl text-center">{props.titre}</p>
      {props.sousTitre && <p className="text-2xl text-white/70 text-center">{props.sousTitre}</p>}
      <ol className="space-y-2 text-xl lg:text-3xl">
        {props.lignes.map((l, i) => (
          <li key={l.id} className="flex items-center gap-3">
            <span className="w-12 text-right">{`${i + 1}.`}</span>
            <span className="inline-block h-5 w-5 rounded-full" style={{ background: l.couleur }} />
            <span className="font-semibold">{l.pseudo}</span>
            <span className="text-white/60 font-mono text-xl">{l.valeur}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={props.onBouton}
          className="rounded-xl bg-[#FF3366] px-6 py-3 text-2xl font-bold"
        >
          {props.bouton}
        </button>
        <ChangerDeJeu />
      </div>
    </div>
  );
}

/** Grand chiffre du compte à rebours, à dessiner par-dessus le canvas. */
export function dessinerCompte(
  ctx: CanvasRenderingContext2D,
  l: number,
  h: number,
  n: number,
): void {
  if (n <= 0) return;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, l, h);
  ctx.fillStyle = '#FF3366';
  ctx.font = 'bold 260px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), l / 2, h / 2);
  ctx.textBaseline = 'alphabetic';
}
