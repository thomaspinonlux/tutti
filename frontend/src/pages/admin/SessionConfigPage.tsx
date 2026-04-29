/**
 * /admin/sessions/new — wizard de configuration de session.
 *
 * Refonte multi-round : la session est désormais un conteneur de manches.
 * Le wizard ne demande plus de playlist (elle sera choisie sur /host quand
 * l'host démarre le blind test).
 *
 * Si `?playlist=X` est présent dans l'URL (depuis le bouton "▶ Lancer un blind
 * test avec cette playlist"), on pré-créé la 1ʳᵉ manche après création de la
 * session. Sinon la session est vide et l'host choisira plus tard.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Team } from '@tutti/shared';
import { getPlaylist } from '../../lib/playlists.js';
import { createRound, createSession } from '../../lib/sessions.js';
import {
  Button,
  Card,
  Input,
  Pill,
  TitleHandwritten,
  Underline,
} from '../../components/ui/index.js';

const TEAM_COLORS = ['#ee6c2a', '#4a8b3f', '#c8336e', '#e8c547', '#6e3a6e', '#e89a64'] as const;
const DEFAULT_TEAM_NAMES = ['Pinots', 'Basilics', 'Frambois', 'Citrons', 'Prunes', 'Pamplemousses'];

function newTeam(idx: number): Team {
  return {
    id: crypto.randomUUID(),
    name: DEFAULT_TEAM_NAMES[idx] ?? `Équipe ${idx + 1}`,
    color: TEAM_COLORS[idx % TEAM_COLORS.length] ?? '#ee6c2a',
  };
}

export function SessionConfigPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const playlistId = params.get('playlist'); // optionnel — pré-créé round 1 si présent

  const [name, setName] = useState('');
  const [playlistName, setPlaylistName] = useState<string | null>(null);
  const [mode, setMode] = useState<'SOLO' | 'TEAMS'>('SOLO');
  const [teams, setTeams] = useState<Team[]>(() => [newTeam(0), newTeam(1)]);
  const [language, setLanguage] = useState<'fr' | 'en'>('fr');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!playlistId) return;
    void getPlaylist(playlistId)
      .then((p) => {
        setPlaylistName(p.name);
        setLanguage((p.language as 'fr' | 'en') ?? 'fr');
      })
      .catch(() => setPlaylistName(null));
  }, [playlistId]);

  const canAddTeam = teams.length < 6;
  const canRemoveTeam = teams.length > 2;

  const updateTeam = (id: string, patch: Partial<Team>): void => {
    setTeams((prev) => prev.map((tt) => (tt.id === id ? { ...tt, ...patch } : tt)));
  };
  const addTeam = (): void => {
    if (!canAddTeam) return;
    setTeams((prev) => [...prev, newTeam(prev.length)]);
  };
  const removeTeam = (id: string): void => {
    if (!canRemoveTeam) return;
    setTeams((prev) => prev.filter((tt) => tt.id !== id));
  };

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const session = await createSession({
        name: name.trim() || undefined,
        game_type: 'TRACKS',
        mode,
        teams_config: mode === 'TEAMS' ? teams : undefined,
        language,
      });
      // Si une playlist est passée en paramètre, on pré-crée la 1ʳᵉ manche
      // pour qu'elle soit prête au démarrage. L'host n'aura plus qu'à
      // cliquer "Démarrer le blind test" puis "Lancer cette manche".
      if (playlistId) {
        try {
          await createRound(session.id, playlistId);
        } catch {
          // Tolérant : la session existe, l'host pourra choisir manuellement.
        }
      }
      navigate(`/host?session=${encodeURIComponent(session.short_code)}`, { replace: true });
    } catch (err: unknown) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <TitleHandwritten as="h1" className="mb-3">
        <Underline>{t('sessionConfig.title')}</Underline>
      </TitleHandwritten>
      {playlistName && (
        <p className="font-editorial italic text-ink-2 mb-8">
          {t('sessionConfig.firstRoundWith', { name: playlistName })}
        </p>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
        <Card>
          <Input
            label={t('sessionConfig.nameLabel')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('sessionConfig.namePlaceholder')}
            hint={t('sessionConfig.nameHint')}
            maxLength={120}
          />
        </Card>

        <Card>
          <p className="text-xs font-mono uppercase tracking-wider text-ink/70 mb-3">
            {t('sessionConfig.mode')}
          </p>
          <div className="flex gap-2">
            <Pill active={mode === 'SOLO'} onClick={() => setMode('SOLO')}>
              {t('sessionConfig.modeSolo')}
            </Pill>
            <Pill active={mode === 'TEAMS'} onClick={() => setMode('TEAMS')}>
              {t('sessionConfig.modeTeams')}
            </Pill>
          </div>
          <p className="font-editorial italic text-xs text-ink-soft mt-3">
            {mode === 'SOLO' ? t('sessionConfig.modeSoloHint') : t('sessionConfig.modeTeamsHint')}
          </p>
        </Card>

        {mode === 'TEAMS' && (
          <Card>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-mono uppercase tracking-wider text-ink/70">
                {t('sessionConfig.teams')}
              </p>
              <span className="font-mono text-xs text-ink-soft">{teams.length}/6</span>
            </div>
            <ul className="space-y-2 mb-3">
              {teams.map((team, idx) => (
                <li key={team.id} className="flex items-center gap-2">
                  <input
                    type="color"
                    value={team.color}
                    onChange={(e) => updateTeam(team.id, { color: e.target.value })}
                    className="w-10 h-10 border-2 border-ink rounded cursor-pointer shrink-0"
                  />
                  <Input
                    type="text"
                    value={team.name}
                    onChange={(e) => updateTeam(team.id, { name: e.target.value })}
                    placeholder={t('sessionConfig.teamPlaceholder', { index: idx + 1 })}
                    required
                    minLength={1}
                    maxLength={40}
                    className="!mt-0"
                  />
                  <button
                    type="button"
                    onClick={() => removeTeam(team.id)}
                    disabled={!canRemoveTeam}
                    aria-label={t('sessionConfig.teamRemove')}
                    className="px-2 py-2 text-raspberry hover:text-raspberry-deep disabled:opacity-30 disabled:cursor-not-allowed text-sm font-mono"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addTeam}
              disabled={!canAddTeam}
            >
              + {t('sessionConfig.teamAdd')}
            </Button>
          </Card>
        )}

        <Card>
          <p className="text-xs font-mono uppercase tracking-wider text-ink/70 mb-3">
            {t('sessionConfig.language')}
          </p>
          <div className="flex gap-2">
            {(['fr', 'en'] as const).map((lng) => (
              <Pill key={lng} active={language === lng} onClick={() => setLanguage(lng)}>
                {lng.toUpperCase()}
              </Pill>
            ))}
          </div>
        </Card>

        {error && (
          <p role="alert" className="text-sm text-raspberry">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => navigate(-1)} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t('sessionConfig.creating') : t('sessionConfig.create')}
          </Button>
        </div>
      </form>
    </div>
  );
}
