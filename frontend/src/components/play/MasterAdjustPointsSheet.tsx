/**
 * MasterAdjustPointsSheet — sheet bottom-up sur tel pour ajuster les points
 * d'un joueur. Silencieux : la cumulative se met à jour mais aucun toast
 * public n'est déclenché (cf. brief : "pas d'affichage public pour
 * ajustement de points").
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input } from '../ui/index.js';

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
      className="fixed inset-0 z-50 bg-ink/40 flex items-end justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="w-full max-w-[500px] bg-cream max-h-[90vh] overflow-y-auto rounded-t-2xl border-t-3 border-ink shadow-pop">
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <p className="font-display text-xl">⚖ {t('play.masterAdjustTitle')}</p>
            <button
              type="button"
              onClick={props.onClose}
              aria-label={t('common.cancel')}
              className="text-2xl text-ink-soft hover:text-ink"
            >
              ✕
            </button>
          </div>

          <p className="font-editorial italic text-sm text-ink-soft mb-4">
            {t('play.masterAdjustHint')}
          </p>

          <Card>
            <p className="text-xs font-mono uppercase tracking-wider text-ink-soft mb-2">
              {t('play.masterAdjustParticipant')}
            </p>
            {props.participants.length === 0 ? (
              <p className="font-editorial italic text-sm text-ink-soft py-3">
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
                        'w-full text-left flex items-center justify-between gap-2 px-3 py-2 border-2 rounded text-sm',
                        targetId === p.id
                          ? 'border-spritz-deep bg-spritz/15'
                          : 'border-ink bg-white hover:bg-cream-2',
                      ].join(' ')}
                    >
                      <span className="font-medium truncate">{p.pseudo}</span>
                      <span className="font-mono text-xs text-ink-soft">{p.total_points} pts</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <Input
              label={t('play.masterAdjustDelta')}
              type="number"
              step="10"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder="±50"
              hint={t('play.masterAdjustDeltaHint')}
              required
            />
          </Card>

          <Card>
            <Input
              label={t('play.masterAdjustReason')}
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('play.masterAdjustReasonPlaceholder')}
              maxLength={200}
            />
          </Card>

          {error && (
            <p role="alert" className="text-sm text-raspberry mb-3">
              {error}
            </p>
          )}

          <div className="flex gap-2 mb-4 sticky bottom-0 bg-cream pt-3 -mx-4 px-4">
            <Button
              variant="ghost"
              size="md"
              onClick={props.onClose}
              disabled={submitting}
              className="flex-1"
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => void handleConfirm()}
              disabled={!canConfirm}
              className="flex-1"
            >
              {submitting ? t('common.saving') : t('play.masterAdjustConfirm')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
