/**
 * <RoleSelector /> — feat/multi-animator-roles (sorti de HostPage pour servir
 * aussi pendant la partie, feat/roles-en-partie, Thomas 17/11) : Joueur /
 * Animateur joueur / Animateur seul.
 */

import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ParticipantRole } from '@tutti/shared';

// feat/multi-animator-roles — sélecteur 3 rôles (segmented control). Multi-
// animateurs : chaque joueur peut être basculé indépendamment.
export function RoleSelector({
  role,
  onSetRole,
  compact,
  dark = false,
  pleineLargeur = false,
}: {
  role: ParticipantRole;
  onSetRole: (role: ParticipantRole) => void;
  compact?: boolean;
  dark?: boolean;
  /**
   * feat/joueurs-panneau-lisible (20/11) — occupe toute la largeur, trois
   * parts égales, libellés qui passent à la ligne au lieu de déborder.
   */
  pleineLargeur?: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const dernierAppuiRef = useRef(0);
  const opts: { value: ParticipantRole; label: string; title: string }[] = [
    { value: 'PLAYER', label: t('host.rolePlayer'), title: t('host.rolePlayerHint') },
    {
      value: 'ANIMATOR_PLAYING',
      label: t('host.roleAnimatorPlaying'),
      title: t('host.roleAnimatorPlayingHint'),
    },
    {
      value: 'ANIMATOR_FULL',
      label: t('host.roleAnimatorFull'),
      title: t('host.roleAnimatorFullHint'),
    },
  ];
  return (
    <div
      role="group"
      aria-label={t('host.roleLabel')}
      className={`${pleineLargeur ? 'flex w-full' : 'inline-flex shrink-0'} rounded-lg overflow-hidden border-2 ${dark ? 'border-white/15' : 'border-ink'}`}
    >
      {opts.map((o) => {
        const active = o.value === role;
        return (
          <button
            key={o.value}
            type="button"
            title={o.title}
            aria-pressed={active}
            // fix/role-en-un-appui (06/11, 2e passe) — le journal serveur ne
            // montre qu'UNE requête pour deux appuis : sur l'iPad, le 1er appui
            // ne déclenchait pas le clic (il passait le bouton en « survol »,
            // gris), seul le 2e partait (vert). On agit dès que le doigt se
            // lève (un défilement donne pointercancel, pas pointerup : pas de
            // changement de rôle en faisant défiler la liste) ; le clic reste
            // pour le clavier, sans doublon.
            onPointerUp={(e) => {
              if (e.pointerType === 'mouse' && e.button !== 0) return;
              dernierAppuiRef.current = Date.now();
              if (!active) onSetRole(o.value);
            }}
            onClick={() => {
              if (Date.now() - dernierAppuiRef.current < 1000) return;
              if (!active) onSetRole(o.value);
            }}
            className={[
              pleineLargeur
                ? 'flex-1 min-w-0 text-[11px] leading-tight px-1 py-1.5 text-center'
                : compact
                  ? 'text-[10px] px-1.5 py-0.5'
                  : 'text-xs px-2 py-1',
              'font-mono transition-colors border-r-2 last:border-r-0',
              dark ? 'border-white/15' : 'border-ink',
              active
                ? 'bg-basil text-white'
                : dark
                  ? 'bg-white/[0.06] text-white/60'
                  : 'bg-cream text-ink-soft',
            ].join(' ')}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

