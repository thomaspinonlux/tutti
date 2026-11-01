/**
 * inclinaison.ts — feat/jeux-manette-2
 * « Volant » : on tient le téléphone écran vers soi et on le tourne comme un
 * volant. On lit la gravité vue par le téléphone (devicemotion) et on mesure
 * l'angle de rotation par rapport à la position de départ (calibrage).
 * Le calibrage rend la mesure juste sur iPhone comme sur Android (leurs
 * signes sont inversés, la DIFFÉRENCE d'angle est la même).
 * iPhone : l'autorisation « Mouvement et orientation » doit être demandée
 * pendant un appui — d'où activer(), à appeler dans un onClick.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type EtatInclinaison = 'arret' | 'actif' | 'refuse' | 'indisponible';

const ANGLE_PLEIN = (32 * Math.PI) / 180; // braquage à fond
const ZONE_MORTE = (4 * Math.PI) / 180;

const borner = (v: number): number => Math.max(-1, Math.min(1, v));
const recaler = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Angle mesuré → direction -1..1 (droite = positif). Exporté pour les tests. */
export function directionDepuisAngle(angle: number, neutre: number): number {
  // Tourner le téléphone dans le sens des aiguilles d'une montre fait
  // DIMINUER atan2(ax, ay) : on inverse pour que « vers la droite » soit positif.
  const d = -recaler(angle - neutre);
  if (Math.abs(d) < ZONE_MORTE) return 0;
  return borner((d - Math.sign(d) * ZONE_MORTE) / (ANGLE_PLEIN - ZONE_MORTE));
}

export function useInclinaison(): {
  x: React.MutableRefObject<number>;
  etat: EtatInclinaison;
  activer: () => Promise<void>;
  arreter: () => void;
  recalibrer: () => void;
} {
  const x = useRef(0);
  const [etat, setEtat] = useState<EtatInclinaison>('arret');
  const neutre = useRef<number | null>(null);
  const lisse = useRef<{ ax: number; ay: number } | null>(null);
  const actif = useRef(false);
  const recu = useRef(false);

  const surMouvement = useCallback((e: DeviceMotionEvent): void => {
    if (!actif.current) return;
    const g = e.accelerationIncludingGravity;
    if (!g || g.x === null || g.y === null) return;
    recu.current = true;
    const p = lisse.current;
    lisse.current = p ? { ax: p.ax * 0.7 + g.x * 0.3, ay: p.ay * 0.7 + g.y * 0.3 } : { ax: g.x, ay: g.y };
    const { ax, ay } = lisse.current;
    if (Math.hypot(ax, ay) < 2) return; // téléphone presque à plat : mesure trop instable
    const a = Math.atan2(ax, ay);
    if (neutre.current === null) neutre.current = a;
    x.current = directionDepuisAngle(a, neutre.current);
  }, []);

  const arreter = useCallback((): void => {
    actif.current = false;
    x.current = 0;
    window.removeEventListener('devicemotion', surMouvement);
    setEtat('arret');
  }, [surMouvement]);

  const activer = useCallback(async (): Promise<void> => {
    const DM = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
    if (!DM) {
      setEtat('indisponible');
      return;
    }
    if (typeof DM.requestPermission === 'function') {
      try {
        const r = await DM.requestPermission();
        if (r !== 'granted') {
          setEtat('refuse');
          return;
        }
      } catch {
        setEtat('refuse');
        return;
      }
    }
    neutre.current = null;
    lisse.current = null;
    actif.current = true;
    recu.current = false;
    window.addEventListener('devicemotion', surMouvement);
    setEtat('actif');
    // Aucun capteur (ordinateur…) : on le dit au lieu de rester muet.
    window.setTimeout(() => {
      if (actif.current && !recu.current) {
        actif.current = false;
        window.removeEventListener('devicemotion', surMouvement);
        setEtat('indisponible');
      }
    }, 2000);
  }, [surMouvement]);

  const recalibrer = useCallback((): void => {
    neutre.current = null;
    x.current = 0;
  }, []);

  useEffect(() => () => window.removeEventListener('devicemotion', surMouvement), [surMouvement]);

  return { x, etat, activer, arreter, recalibrer };
}
