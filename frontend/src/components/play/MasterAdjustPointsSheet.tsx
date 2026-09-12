/**
 * MasterAdjustPointsSheet — sheet bottom-up sur tel pour ajuster les points
 * d'un joueur. Silencieux : la cumulative se met à jour mais aucun toast
 * public n'est déclenché (cf. brief : "pas d'affichage public pour
 * ajustement de points").
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
// feat/telephone-au-style-tv — le panneau de l'animateur reprend les codes
// de la TV, comme le reste du téléphone.
const CORAIL = '#FF5C4D';


export interface ParticipantOption {
  id: string;
  pseudo: string;
  team_id: string | null;
  total_points: number;
}

interface Props {
  open: boolean;
  participants: ParticipantOption[];
  onClose: () => void;
  onConfirm: (args: {
    target_participant_id: string;
    delta: number;
    reason?: string;
  }) => Promise<void>;
}

export function MasterAdjustPointsSheet(props: Props): JSX.Element | null {
  const { t } = useTranslation();
  const [targetId, setTargetId] = useState<string | null>(null);
  const [delta, setDelta] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!props.open) return null;

  const target = props.participants.find((p) => p.id === targetId) ?? null;
  const deltaNum = Number.parseInt(delta, 10);
  const deltaValid =
    !Number.isNaN(deltaNum) && deltaNum !== 0 && deltaNum >= -1000 && deltaNum <= 1000;
  const canConfirm = target && deltaValid && !submitting;

  const handleConfirm = async (): Promise<void> => {
    if (!target || !deltaValid) return;
    setSubmitting(true);
    setError(null);
    try {
      await props.onConfirm({
        target_participant_id: target.id,
        delta: deltaNum,
        reason: reason.trim() || undefined,
      });
      props.onClose();
      setTargetId(null);
      setDelta('');
      setReason('');
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-[500px] overflow-y-auto rounded-t-[24px] border-t border-white/10 bg-[#191922] text-white shadow-[0_-24px_70px_rgba(0,0,0,0.6)]">
        <div className="p-4">
          <div className="mb-4 flex items-center justify-between">
            <p className="font-display text-xl text-white">⚖ {t('play.masterAdjustTitle')}</p>
            <button
              type="button"
              onClick={props.onClose}
              aria-label={t('common.cancel')}
              className="text-2xl text-white/50 hover:text-white"
            >
              ✕
            </button>
          </div>

          <p className="mb-4 font-editorial text-sm italic text-white/60">
            {t('play.masterAdjustHint')}
          </p>

          <div className="mb-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="mb-2 font-mono text-xs uppercase tracking-wider text-white/50">
              {t('play.masterAdjustParticipant')}
            </p>
            {props.participants.length === 0 ? (
              <p className="py-3 font-editorial text-sm italic text-white/45">
                {t('host.waitingForPlayers')}
              </p>
            ) : (
              <ul className="space-y-1 max-h-48 overflow-y-auto">
                {props.participants.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setTargetId(p.id)}
                      className={[
                        'flex w-full items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-left text-sm',
                        targetId === p.id
                          ? 'border-[#FF5C4D]/60 bg-[#FF5C4D]/15 text-white'
                          : 'border-white/12 bg-white/[0.05] text-white/80 hover:bg-white/[0.1]',
                      ].join(' ')}
                    >
                      <span className="truncate font-medium">{p.pseudo}</span>
                      <span className="font-mono text-xs text-white/50">{p.total_points} pts</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mb-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <label className="block">
              <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.22em] text-white/55">
                {t('play.masterAdjustDelta')}
              </span>
              <input
                type="number"
                step="10"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
                placeholder="±50"
                required
                className="w-full rounded-2xl border border-white/15 bg-white/[0.07] px-3.5 py-2.5 text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-[#FF5C4D]/50"
              />
              <span className="mt-1 block font-mono text-[11px] text-white/45">
                {t('play.masterAdjustDeltaHint')}
              </span>
            </label>
          </div>

          <div className="mb-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <label className="block">
              <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.22em] text-white/55">
                {t('play.masterAdjustReason')}
              </span>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('play.masterAdjustReasonPlaceholder')}
                maxLength={200}
                className="w-full rounded-2xl border border-white/15 bg-white/[0.07] px-3.5 py-2.5 text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-[#FF5C4D]/50"
              />
            </label>
          </div>

          {error && (
            <p role="alert" className="mb-3 text-sm" style={{ color: CORAIL }}>
              {error}
            </p>
          )}

          <div className="sticky bottom-0 -mx-4 mb-4 flex gap-2 bg-[#191922] px-4 pt-3">
            <button
              type="button"
              onClick={props.onClose}
              disabled={submitting}
              className="flex-1 rounded-2xl border border-white/15 px-4 py-2.5 text-white/75 transition-colors hover:bg-white/[0.06] disabled:opacity-40"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={!canConfirm}
              className="flex-1 rounded-2xl px-4 py-2.5 font-bold text-[#0B0B0F] transition-transform active:scale-[0.98] disabled:opacity-40"
              style={{ backgroundColor: CORAIL }}
            >
              {submitting ? t('common.saving') : t('play.masterAdjustConfirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
