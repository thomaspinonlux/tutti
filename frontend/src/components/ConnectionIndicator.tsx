/**
 * <ConnectionIndicator socket={s} /> — petite pastille en haut à droite
 * indiquant l'état de la connexion Socket.IO du joueur.
 *
 * État :
 *   - 'connected' : pastille verte, statique
 *   - 'reconnecting' : pastille orange clignotante
 *   - 'offline' : pastille rouge, statique
 *
 * Cf. docs/PLAYER_RESILIENCE.md.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Socket } from 'socket.io-client';

type State = 'connected' | 'reconnecting' | 'offline';

interface Props {
  socket: Socket | null;
  className?: string;
}

export function ConnectionIndicator({ socket, className }: Props): JSX.Element {
  const { t } = useTranslation();
  const [state, setState] = useState<State>(socket?.connected ? 'connected' : 'offline');

  useEffect(() => {
    if (!socket) {
      setState('offline');
      return;
    }
    setState(socket.connected ? 'connected' : 'reconnecting');

    const onConnect = (): void => setState('connected');
    const onDisconnect = (): void => setState('reconnecting');
    const onReconnectAttempt = (): void => setState('reconnecting');
    const onReconnectFailed = (): void => setState('offline');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    socket.io.on('reconnect_failed', onReconnectFailed);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.io.off('reconnect_failed', onReconnectFailed);
    };
  }, [socket]);

  const tone =
    state === 'connected'
      ? 'bg-basil'
      : state === 'reconnecting'
        ? 'bg-spritz animate-pulse'
        : 'bg-raspberry';
  const label =
    state === 'connected'
      ? t('connection.connected')
      : state === 'reconnecting'
        ? t('connection.reconnecting')
        : t('connection.offline');

  return (
    <div
      role="status"
      aria-label={label}
      title={label}
      className={`inline-flex items-center gap-1.5 ${className ?? ''}`}
    >
      <span className={`w-2.5 h-2.5 rounded-full border border-ink ${tone}`} aria-hidden />
    </div>
  );
}
