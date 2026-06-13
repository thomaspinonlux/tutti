/**
 * <TvJoinPage /> — feat/tv-join-code-multidevice
 *
 * Page de jonction d'un 2e device au salon.
 *   - /tv         : saisie manuelle du code (insensible à la casse)
 *   - /tv/:code   : accès direct (encodé dans le QR de l'écran animateur)
 *
 * Après résolution du code → choix de RÔLE explicite :
 *   - "Écran TV"          → /screen?workspace=<id> (affichage salle, read-only,
 *                           sync ScreenState #79)
 *   - "Manette / Animateur" → /play?session=<join_code> (pilotage joueur, peut
 *                           devenir animateur mode B)
 *
 * Sortie permanente visible (retour accueil) quel que soit l'état.
 *
 * La limite iOS (1 seul affichage plein écran par device) n'est plus un piège :
 * c'est un 2e appareil qui rejoint, chacun garde sa vue.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Input,
  MultiColorBar,
  TitleHandwritten,
  Underline,
} from '../components/ui/index.js';
import { normalizeTvCode, resolveTvCode, type TvResolveResult } from '../lib/tv.js';

type Phase = 'input' | 'resolving' | 'role' | 'error';

export function TvJoinPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { code: codeParam } = useParams<{ code?: string }>();

  const [phase, setPhase] = useState<Phase>(codeParam ? 'resolving' : 'input');
  const [codeInput, setCodeInput] = useState(codeParam ? normalizeTvCode(codeParam) : '');
  const [resolved, setResolved] = useState<TvResolveResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doResolve = async (rawCode: string): Promise<void> => {
    const code = normalizeTvCode(rawCode);
    if (code.length < 4) {
      setError(t('tv.errorTooShort'));
      setPhase('error');
      return;
    }
    setPhase('resolving');
    setError(null);
    try {
      const r = await resolveTvCode(code);
      setResolved(r);
      setPhase('role');
    } catch {
      setError(t('tv.errorNotFound', { code }));
      setPhase('error');
    }
  };

  // Accès direct /tv/:code → résolution auto au mount.
  useEffect(() => {
    if (codeParam) void doResolve(codeParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeParam]);

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    void doResolve(codeInput);
  };

  const chooseScreen = (): void => {
    if (!resolved) return;
    navigate(`/screen?workspace=${encodeURIComponent(resolved.workspace_id)}`);
  };
  const chooseController = (): void => {
    if (!resolved) return;
    navigate(`/play?session=${encodeURIComponent(resolved.join_code)}`);
  };

  return (
    <div className="min-h-screen flex flex-col bg-cream relative overflow-hidden">
      <MultiColorBar height="md" />
      <main className="flex-1 flex items-center justify-center p-6 relative z-10">
        <div className="max-w-md w-full text-center">
          <p className="font-mono text-sm uppercase tracking-[0.3em] text-spritz-deep mb-3">
            {t('common.brand')}
          </p>
          <TitleHandwritten as="h1" className="mb-6 text-5xl">
            <Underline>{t('tv.title')}</Underline>
          </TitleHandwritten>

          {/* ── Saisie code ── */}
          {(phase === 'input' || phase === 'error') && (
            <Card size="md" tone="cream">
              <p className="font-editorial italic text-ink-soft mb-4 text-sm">{t('tv.subtitle')}</p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                  label={t('tv.codeLabel')}
                  value={codeInput}
                  onChange={(e) => setCodeInput(normalizeTvCode(e.target.value))}
                  placeholder="ABC23"
                  autoFocus
                  maxLength={5}
                  inputMode="text"
                  autoCapitalize="characters"
                  className="text-center font-mono text-2xl tracking-[0.4em] uppercase"
                />
                {phase === 'error' && error && (
                  <p role="alert" className="text-raspberry text-sm">
                    {error}
                  </p>
                )}
                <Button type="submit" variant="primary" size="lg" className="w-full">
                  {t('tv.joinButton')}
                </Button>
              </form>
            </Card>
          )}

          {/* ── Résolution en cours ── */}
          {phase === 'resolving' && (
            <p className="font-mono text-ink-soft animate-pulse">{t('tv.resolving')}</p>
          )}

          {/* ── Choix de rôle ── */}
          {phase === 'role' && resolved && (
            <Card size="md" tone="cream">
              {resolved.session_name && (
                <p className="font-display text-lg mb-1">{resolved.session_name}</p>
              )}
              <p className="font-editorial italic text-ink-soft mb-5 text-sm">
                {t('tv.roleQuestion')}
              </p>
              <div className="space-y-3">
                <Button variant="primary" size="lg" className="w-full" onClick={chooseScreen}>
                  📺 {t('tv.roleScreen')}
                </Button>
                <p className="font-mono text-[11px] text-ink-soft -mt-1">
                  {t('tv.roleScreenHint')}
                </p>
                <Button variant="secondary" size="lg" className="w-full" onClick={chooseController}>
                  🎮 {t('tv.roleController')}
                </Button>
                <p className="font-mono text-[11px] text-ink-soft -mt-1">
                  {t('tv.roleControllerHint')}
                </p>
              </div>
            </Card>
          )}

          {/* ── Sortie permanente ── */}
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mt-6 font-mono text-xs text-ink-soft underline"
          >
            ← {t('tv.exit')}
          </button>
        </div>
      </main>
      <MultiColorBar height="md" />
    </div>
  );
}
