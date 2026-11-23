/**
 * <Icone /> — direction « Électro-Pop Clubbing » (22/11).
 *
 * La fiche de style retenue par Thomas : « Iconographie exclusivement composée
 * de tracés vectoriels d'une épaisseur constante de 2 px, aux terminaisons
 * arrondies. Aucun émoji n'est toléré dans l'interface. »
 *
 * Un seul composant remplace les émojis qui servaient de pictogrammes. Le
 * tracé prend la couleur du texte (`currentColor`) et sa taille (1em) : on le
 * pose là où se trouvait l'émoji, sans autre réglage.
 */
import type { ReactNode } from 'react';

const TRACES = {
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </>
  ),
  lecture: <path d="M7 5l12 7-12 7z" />,
  suivant: (
    <>
      <path d="M5 5l10 7-10 7z" />
      <path d="M19 5v14" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  reculer: (
    <>
      <path d="M11 18l-8-6 8-6z" />
      <path d="M21 18l-8-6 8-6z" />
    </>
  ),
  avancer: (
    <>
      <path d="M13 6l8 6-8 6z" />
      <path d="M3 6l8 6-8 6z" />
    </>
  ),
  micro: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </>
  ),
  son: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 6a8.5 8.5 0 0 1 0 12" />
    </>
  ),
  manette: (
    <>
      <rect x="2" y="7" width="20" height="11" rx="5.5" />
      <path d="M7 11v3M5.5 12.5h3" />
      <path d="M16 11.5v.01M18 13.5v.01" />
    </>
  ),
  couronne: <path d="M4 18h16l1.5-10-5 4L12 5l-4.5 7-5-4z" />,
  cadenas: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  alerte: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4" />
      <path d="M12 17.2v.01" />
    </>
  ),
  ampoule: (
    <>
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
    </>
  ),
  telephone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18h2" />
    </>
  ),
  ecran: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </>
  ),
  maison: (
    <>
      <path d="M4 11l8-7 8 7" />
      <path d="M6 10v10h12V10" />
    </>
  ),
  note: (
    <>
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </>
  ),
  casque: (
    <>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <rect x="3" y="14" width="4" height="6" rx="1.5" />
      <rect x="17" y="14" width="4" height="6" rx="1.5" />
    </>
  ),
  calendrier: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16" />
      <path d="M8 3v4M16 3v4" />
    </>
  ),
  reglages: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
    </>
  ),
  personne: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  personnes: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" />
      <path d="M18 14.5a6 6 0 0 1 3.5 5.5" />
    </>
  ),
  recherche: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </>
  ),
  liste: (
    <>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
      <path d="M9 3h6v3H9z" />
      <path d="M9 11h6M9 15h4" />
    </>
  ),
  dossier: (
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" />
    </>
  ),
  corbeille: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
    </>
  ),
  oeil: (
    <>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  recharger: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 6.3" />
      <path d="M20 4v7h-7" />
    </>
  ),
  points: (
    <>
      <path d="M5 8h6M8 5v6" />
      <path d="M13 17h6" />
      <path d="M18 5L6 19" />
    </>
  ),
  interdit: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </>
  ),
  trophee: (
    <>
      <path d="M8 4h8v6a4 4 0 0 1-8 0z" />
      <path d="M8 6H4a4 4 0 0 0 4 4.5" />
      <path d="M16 6h4a4 4 0 0 1-4 4.5" />
      <path d="M12 14v4" />
      <path d="M8 21h8" />
    </>
  ),
  cible: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <path d="M12 12v.01" />
    </>
  ),
  etoile: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
  courrier: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 7l8.5 6 8.5-6" />
    </>
  ),
  horloge: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  croix: <path d="M6 6l12 12M18 6L6 18" />,
  prise: (
    <>
      <path d="M9 3v5M15 3v5" />
      <path d="M6 8h12v3a6 6 0 0 1-12 0z" />
      <path d="M12 17v4" />
    </>
  ),
  automate: (
    <>
      <rect x="5" y="8" width="14" height="11" rx="2" />
      <path d="M12 4v4" />
      <path d="M9.5 13v.01M14.5 13v.01" />
      <path d="M2.5 12v4M21.5 12v4" />
    </>
  ),
  installer: (
    <>
      <path d="M12 4v11" />
      <path d="M7 11l5 5 5-5" />
      <path d="M5 20h14" />
    </>
  ),
  crayon: <path d="M4 20l1-4L16 5l3 3L8 19z" />,
  retour: <path d="M15 5l-7 7 7 7" />,
  sortie: (
    <>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 8l-4 4 4 4" />
      <path d="M6 12h9" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type NomIcone = keyof typeof TRACES;

interface Props {
  nom: NomIcone;
  /** Taille et alignement ; par défaut la taille du texte voisin. */
  className?: string;
  /** Texte lu par les lecteurs d'écran ; sans lui l'icône est décorative. */
  titre?: string;
}

export function Icone({ nom, className, titre }: Props): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'inline-block h-[1em] w-[1em] align-[-0.125em]'}
      role={titre ? 'img' : undefined}
      aria-label={titre}
      aria-hidden={titre ? undefined : true}
    >
      {TRACES[nom]}
    </svg>
  );
}

/**
 * Le rang d'un podium (1, 2, 3) dans une pastille — remplace les médailles.
 * Or, argent, bronze : les couleurs « score » de la fiche de style.
 */
const TEINTES_RANG = ['#FFE600', '#C9CCD6', '#E0915A'];

export function Rang({ rang, className }: { rang: number; className?: string }): JSX.Element {
  const teinte = TEINTES_RANG[rang - 1] ?? 'rgba(255,255,255,0.18)';
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-mono font-bold tabular-nums leading-none ${
        className ?? 'h-[1.5em] w-[1.5em] text-[0.8em]'
      }`}
      style={{ background: teinte, color: rang <= 3 ? '#0E0D17' : '#FFFFFF' }}
    >
      {rang}
    </span>
  );
}
