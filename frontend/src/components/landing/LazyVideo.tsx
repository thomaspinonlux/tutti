/**
 * Lazy video — IntersectionObserver charge la <source> seulement quand le
 * conteneur entre dans la viewport (économise bande passante mobile).
 *
 * Comportement :
 *   - Avant l'intersection : <video> sans <source>, juste poster JPG
 *   - À l'intersection : injecte <source>, video.load(), play() (muted+inline
 *     pour autoplay iOS Safari)
 *   - preload="metadata" pour démarrage rapide une fois la source attachée
 *   - playsInline + muted + loop : compat mobile + boucle silencieuse
 */

import { useEffect, useRef, useState } from 'react';

interface LazyVideoProps {
  src: string;
  poster: string;
  ariaLabel: string;
  type?: string;
}

export function LazyVideo({
  src,
  poster,
  ariaLabel,
  type = 'video/mp4',
}: LazyVideoProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      // Vieux navigateurs : on charge direct
      setShouldLoad(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShouldLoad(true);
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: '200px' }, // démarre 200px avant l'entrée pour préchauffer
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !shouldLoad) return;
    video.load();
    void video.play().catch(() => {
      // Autoplay bloqué (utilisateur n'a pas interagi) — fallback poster
    });
  }, [shouldLoad]);

  return (
    <div ref={containerRef} className="landing-hero-video">
      <video
        ref={videoRef}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        poster={poster}
        aria-label={ariaLabel}
      >
        {shouldLoad && <source src={src} type={type} />}
      </video>
    </div>
  );
}
