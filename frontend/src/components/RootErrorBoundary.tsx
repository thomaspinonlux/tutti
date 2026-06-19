/**
 * <RootErrorBoundary /> — feat/root-error-boundary
 *
 * Dernier rempart : capture TOUT throw au render dans l'arbre React (routeur +
 * pages incluses) et affiche un écran d'erreur lisible + bouton Recharger AU
 * LIEU de démonter tout l'arbre (= écran blanc / app brickée, ex. iPad).
 *
 * - Styles INLINE volontaires : l'écran d'erreur doit s'afficher même si le
 *   crash vient du CSS/Tailwind ou d'un provider.
 * - Erreur VISIBLE : message + stack à l'écran (pas seulement console) → on peut
 *   lire la cause sur un iPad sans devtools. Aussi loggée via console.error
 *   (capturée par installDebugLogCapture / DebugOverlay).
 * - Reset léger : "Réessayer" retente le render (utile si l'erreur était
 *   transitoire) ; "Recharger" relance la page complète.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
  stack: string | null;
}

export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log visible (console + capture debug overlay). Ne JAMAIS rethrow.
    console.error('[RootErrorBoundary] render crash:', error, info.componentStack);
    this.setState({ stack: info.componentStack ?? null });
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleRetry = (): void => {
    this.setState({ error: null, stack: null });
  };

  render(): ReactNode {
    const { error, stack } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 24,
          background: '#fefae0',
          color: '#211d1a',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 48, lineHeight: 1 }} aria-hidden>
          🎛️
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Oups — une erreur est survenue</h1>
        <p style={{ fontSize: 15, maxWidth: 460, margin: 0, opacity: 0.8 }}>
          L'écran a planté mais l'app n'est pas perdue. Recharge pour repartir.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              background: '#e8723f',
              color: '#fefae0',
              border: '2px solid #211d1a',
              borderRadius: 10,
              padding: '10px 20px',
              fontSize: 16,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '3px 3px 0 #211d1a',
            }}
          >
            Recharger
          </button>
          <button
            type="button"
            onClick={this.handleRetry}
            style={{
              background: 'transparent',
              color: '#211d1a',
              border: '2px solid #211d1a',
              borderRadius: 10,
              padding: '10px 20px',
              fontSize: 16,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Réessayer
          </button>
        </div>
        {/* Erreur VISIBLE à l'écran (lisible sur iPad sans devtools). */}
        <details
          style={{
            marginTop: 8,
            maxWidth: 560,
            width: '100%',
            textAlign: 'left',
            fontSize: 12,
          }}
        >
          <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: 8 }}>
            Détail technique
          </summary>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              background: '#211d1a',
              color: '#fefae0',
              padding: 12,
              borderRadius: 8,
              maxHeight: 240,
              overflow: 'auto',
              margin: 0,
            }}
          >
            {error.name}: {error.message}
            {stack ? `\n${stack}` : ''}
          </pre>
        </details>
      </div>
    );
  }
}
