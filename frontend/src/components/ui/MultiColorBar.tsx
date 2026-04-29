/**
 * <MultiColorBar /> — bandeau signature 5 couleurs (spritz / basil / raspberry / lemon / plum).
 *
 * À placer en haut ou en bas des écrans pour la signature visuelle Tutti.
 */

interface Props {
  className?: string;
  height?: 'sm' | 'md' | 'lg';
}

const HEIGHTS = { sm: 'h-1', md: 'h-1.5', lg: 'h-2' } as const;

export function MultiColorBar({ className, height = 'md' }: Props): JSX.Element {
  return (
    <div aria-hidden className={`flex w-full ${HEIGHTS[height]} ${className ?? ''}`}>
      <div className="flex-1 bg-spritz" />
      <div className="flex-1 bg-basil" />
      <div className="flex-1 bg-raspberry" />
      <div className="flex-1 bg-lemon" />
      <div className="flex-1 bg-plum" />
    </div>
  );
}
