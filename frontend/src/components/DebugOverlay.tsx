/**
 * <DebugOverlay /> — feat/debug-audio-overlay
 *
 * Overlay temporaire pour diagnostiquer le bug audio PWA Safari où Thomas
 * ne peut pas accéder à l'Inspecteur web. Affiche en bas à droite les 30
 * derniers logs filtrés `[Audio]`, `[Player]`, `[PWA]` (cf. debugLogs.ts).
 *
 * Activation :
 *   - URL `?debug=audio` OU localStorage `debugAudio=true`
 *
 * Boutons :
 *   - 📋 Copier : copie tous les logs (jusqu'à 100) dans le presse-papier
 *   - 🗑️ Clear : vide le ring buffer
 *   - ✕ Fermer : masque (state local, ne change pas le flag activation)
 */

import { useEffect, useRef, useState } from 'react';
import {
  isDebugOverlayActive,
  subscribeDebugLogs,
  clearDebugLogs,
  type DebugLogEntry,
} from '../lib/debugLogs.js';

const LEVEL_COLOR: Record<DebugLogEntry['level'], string> = {
  log: '#9be39b', // pale green
  info: '#7be37b', // green
  warn: '#ffd166', // amber
  error: '#ff6b6b', // red
};

export function DebugOverlay(): JSX.Element | null {
  // Évaluation lazy : sample une fois au mount. Si l'utilisateur veut
  // activer après le boot, il doit reload (acceptable pour outil de debug).
  const [active] = useState<boolean>(() => isDebugOverlayActive());
  const [open, setOpen] = useState(true);
  const [logs, setLogs] = useState<readonly DebugLogEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!active) return;
    return subscribeDebugLogs((next) => setLogs(next));
  }, [active]);

  // Auto-scroll vers le bas à chaque nouveau log.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  if (!active || !open) return null;

  // Slice : montre les 30 derniers (lisible), mais copie expose les 100.
  const visible = logs.slice(-30);

  const handleCopy = async (): Promise<void> => {
    const txt = logs
      .map((l) => `${new Date(l.ts).toISOString()} [${l.level.toUpperCase()}] ${l.text}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(txt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn('[DebugOverlay] clipboard error', err);
    }
  };

  return (
    <div
      role="region"
      aria-label="Debug audio logs"
      style={{
        position: 'fixed',
        right: 8,
        bottom: 8,
        zIndex: 9999,
        maxWidth: 'min(440px, calc(100vw - 16px))',
        maxHeight: 320,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(0,0,0,0.85)',
        color: '#9be39b',
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 11,
        lineHeight: 1.35,
        border: '1px solid #2d3b2d',
        borderRadius: 8,
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 8px',
          borderBottom: '1px solid #2d3b2d',
          background: 'rgba(0,0,0,0.4)',
        }}
      >
        <span style={{ flex: 1, fontWeight: 700 }}>
          🔍 DEBUG [{logs.length}/{100}]
        </span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          style={btnStyle}
          aria-label="Copier les logs"
          title="Copier"
        >
          {copied ? '✓' : '📋'}
        </button>
        <button
          type="button"
          onClick={() => clearDebugLogs()}
          style={btnStyle}
          aria-label="Vider les logs"
          title="Clear"
        >
          🗑️
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={btnStyle}
          aria-label="Fermer"
          title="Fermer"
        >
          ✕
        </button>
      </header>
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 6,
          // Force wrap des longues lignes (URL Spotify, JSON…).
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        {visible.length === 0 ? (
          <p style={{ color: '#666', fontStyle: 'italic' }}>
            En attente de logs [Audio]/[Player]/[PWA]…
          </p>
        ) : (
          visible.map((l, i) => (
            <div key={`${l.ts}-${i}`} style={{ marginBottom: 2 }}>
              <span style={{ color: '#666' }}>{new Date(l.ts).toISOString().slice(11, 23)}</span>{' '}
              <span style={{ color: LEVEL_COLOR[l.level] }}>{l.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#9be39b',
  cursor: 'pointer',
  fontSize: 13,
  padding: '2px 4px',
  lineHeight: 1,
};
