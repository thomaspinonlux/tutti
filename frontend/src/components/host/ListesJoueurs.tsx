/**
 * <ParticipantsList /> et <TeamsView /> — listes des joueurs de la console
 * (accueil du blind test, accueil du quiz, fenêtre « Gestion des joueurs »).
 *
 * fix/gestion-joueurs-lisible (26/11) — photo de Thomas : dans la fenêtre
 * « Gestion des joueurs », on ne voyait plus le NOM des joueurs. Le rôle, le
 * menu d'équipe et la croix tenaient sur la même ligne que le nom, sans
 * pouvoir rétrécir : le nom tombait à zéro et le menu d'équipe sortait de la
 * case. Impossible de savoir qui déplacer.
 *
 * Règle retenue, la même que dans le panneau « Joueurs » et sur le téléphone
 * de l'animateur : une fiche par joueur, le nom d'abord, sur toute la largeur,
 * puis les commandes en dessous. Les colonnes se comptent sur la place
 * réellement disponible (fenêtre, accueil, téléphone) et non sur la taille de
 * l'écran.
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Participant, ParticipantRole, Team } from '@tutti/shared';
import { isAnimatorRole } from '@tutti/shared';
import { Card } from '../ui/index.js';
import { Icone } from '../ui/Icone.js';
import { RoleSelector } from './RoleSelector.js';

/** Autant de colonnes que la place le permet, jamais moins large qu'une fiche. */
const GRILLE = 'grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))]';

function classesFiche(estAnimateur: boolean, dark: boolean): string {
  return [
    'min-w-0 rounded-xl border-2 px-3 py-2.5 space-y-2',
    estAnimateur
      ? 'border-basil bg-basil/15'
      : dark
        ? 'border-white/10 bg-white/[0.05]'
        : 'border-hairline bg-cream-2',
  ].join(' ');
}

/** Le nom, toujours entier : il passe à la ligne plutôt que d'être coupé. */
function NomJoueur({
  pseudo,
  estAnimateur,
  dark,
}: {
  pseudo: string;
  estAnimateur: boolean;
  dark: boolean;
}): JSX.Element {
  return (
    <p
      className={`min-w-0 flex-1 break-words text-base font-medium leading-snug ${dark ? 'text-white' : 'text-ink'}`}
    >
      {estAnimateur && (
        <span aria-hidden className="mr-1.5 inline-block align-[-2px] text-basil">
          <Icone nom="couronne" />
        </span>
      )}
      {pseudo}
    </p>
  );
}

function BoutonRetirer({ onClick }: { onClick: () => void }): JSX.Element {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      title={t('host.kickPlayer')}
      aria-label={t('host.kickPlayer')}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-raspberry/40 text-base text-raspberry transition-colors hover:bg-raspberry/15 active:bg-raspberry/25"
    >
      <Icone nom="croix" />
    </button>
  );
}

function BoutonAnimateur({
  estAnimateur,
  dark,
  onClick,
}: {
  estAnimateur: boolean;
  dark: boolean;
  onClick: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={estAnimateur}
      className={[
        'min-h-[40px] w-full rounded-lg border-2 px-3 font-mono text-xs transition-colors',
        estAnimateur
          ? 'border-basil bg-basil/10 text-basil hover:bg-basil/20'
          : dark
            ? 'border-white/15 text-white/70 hover:bg-white/10'
            : 'border-hairline text-ink-soft hover:bg-cream',
      ].join(' ')}
    >
      {estAnimateur ? t('host.masterRevoke') : t('host.masterAssign')}
    </button>
  );
}

export function ParticipantsList({
  participants,
  showMasterToggle,
  onKick,
  onToggleMaster,
  onSetRole,
  dark = false,
}: {
  participants: Participant[];
  showMasterToggle: boolean;
  onKick: (id: string) => Promise<void>;
  onToggleMaster: (id: string) => Promise<void>;
  onSetRole?: (id: string, role: ParticipantRole) => Promise<void>;
  dark?: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const wrap = (children: ReactNode): JSX.Element =>
    dark ? (
      <div className="rounded-[20px] border border-white/[0.07] bg-[#181628]/80 p-3 backdrop-blur-xl sm:p-4">
        {children}
      </div>
    ) : (
      <Card>{children}</Card>
    );
  if (participants.length === 0) {
    return wrap(
      <p
        className={`font-editorial italic text-center py-6 ${dark ? 'text-white/45' : 'text-ink-soft'}`}
      >
        {t('host.waitingForPlayers')}
      </p>,
    );
  }
  return wrap(
    <ul className={GRILLE}>
      {participants.map((p) => {
        const estAnimateur = isAnimatorRole(p.role);
        return (
          <li key={p.id} className={classesFiche(estAnimateur, dark)}>
            <div className="flex items-center gap-2">
              <NomJoueur pseudo={p.pseudo} estAnimateur={estAnimateur} dark={dark} />
              <BoutonRetirer onClick={() => void onKick(p.id)} />
            </div>
            {onSetRole ? (
              <RoleSelector
                role={p.role}
                onSetRole={(r) => void onSetRole(p.id, r)}
                dark={dark}
                pleineLargeur
              />
            ) : (
              showMasterToggle && (
                <BoutonAnimateur
                  estAnimateur={estAnimateur}
                  dark={dark}
                  onClick={() => void onToggleMaster(p.id)}
                />
              )
            )}
          </li>
        );
      })}
    </ul>,
  );
}

export function TeamsView({
  teams,
  participants,
  showMasterToggle,
  onMove,
  onKick,
  onToggleMaster,
  onSetRole,
  dark = false,
}: {
  teams: Team[];
  participants: Participant[];
  showMasterToggle: boolean;
  onMove: (participantId: string, teamId: string | null) => Promise<void>;
  onKick: (id: string) => Promise<void>;
  onToggleMaster: (id: string) => Promise<void>;
  onSetRole?: (id: string, role: ParticipantRole) => Promise<void>;
  dark?: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    // auto-fit : deux équipes se partagent toute la largeur, six équipes
    // passent sur plusieurs rangées. Chaque colonne garde la place d'une fiche.
    <div className="grid items-start gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,17rem),1fr))]">
      {teams.map((team) => {
        const members = participants.filter((p) => p.team_id === team.id);
        const card = (
          <>
            <div className="mb-3 flex items-center justify-between gap-2">
              <span
                className={`min-w-0 break-words rounded-full px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider ${dark ? 'text-white' : 'bg-cream-4 text-spritz'}`}
                style={dark ? { backgroundColor: '#ffffff14' } : undefined}
              >
                {team.name}
              </span>
              <span
                className={`shrink-0 font-mono text-sm tabular-nums ${dark ? 'text-white/60' : 'text-ink-soft'}`}
              >
                {members.length}
              </span>
            </div>
            {members.length === 0 ? (
              <p
                className={`font-editorial italic text-sm py-2 ${dark ? 'text-white/50' : 'text-ink-soft'}`}
              >
                {t('host.teamEmpty')}
              </p>
            ) : (
              <ul className="space-y-2">
                {members.map((p) => {
                  const estAnimateur = isAnimatorRole(p.role);
                  return (
                    <li key={p.id} className={classesFiche(estAnimateur, dark)}>
                      <div className="flex items-center gap-2">
                        <NomJoueur pseudo={p.pseudo} estAnimateur={estAnimateur} dark={dark} />
                        <BoutonRetirer onClick={() => void onKick(p.id)} />
                      </div>
                      {onSetRole ? (
                        <RoleSelector
                          role={p.role}
                          onSetRole={(r) => void onSetRole(p.id, r)}
                          dark={dark}
                          pleineLargeur
                        />
                      ) : (
                        showMasterToggle && (
                          <BoutonAnimateur
                            estAnimateur={estAnimateur}
                            dark={dark}
                            onClick={() => void onToggleMaster(p.id)}
                          />
                        )
                      )}
                      {/* Sur une fiche étroite, le menu passe sous son libellé : le nom
                          de l'équipe reste lisible en entier. */}
                      <label className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span
                          className={`shrink-0 font-mono text-[11px] uppercase tracking-wider ${dark ? 'text-white/55' : 'text-ink-soft'}`}
                        >
                          {t('host.moveToTeam')}
                        </span>
                        <select
                          value={p.team_id ?? ''}
                          onChange={(e) => void onMove(p.id, e.target.value || null)}
                          className={`min-h-[40px] min-w-[8.5rem] max-w-full flex-1 truncate rounded-lg border-2 px-2 text-base ${dark ? 'border-white/20 bg-white/10 text-white' : 'border-hairline bg-cream text-ink'}`}
                        >
                          {teams.map((t2) => (
                            <option
                              key={t2.id}
                              value={t2.id}
                              className={dark ? 'text-ink' : undefined}
                            >
                              {t2.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        );
        return dark ? (
          <div
            key={team.id}
            className="min-w-0 rounded-2xl border-[3px] bg-[#181628]/80 p-3 backdrop-blur-xl sm:p-4"
            style={{ borderColor: team.color }}
          >
            {card}
          </div>
        ) : (
          <Card key={team.id} className="min-w-0 !border-3" style={{ borderColor: team.color }}>
            {card}
          </Card>
        );
      })}
    </div>
  );
}
