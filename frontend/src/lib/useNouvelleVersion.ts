/**
 * useNouvelleVersion — L'APP SE RECHARGE SEULE QUAND UNE NOUVELLE VERSION EST
 * EN LIGNE, AU PREMIER MOMENT SÛR.
 *
 * Pourquoi (constaté le 03/09 par les journaux) : l'app iPad charge le site
 * une fois au démarrage et tourne ensuite des heures sans jamais recharger la
 * page. La mise à jour automatique du service worker ne s'applique qu'à la
 * prochaine ouverture — qui n'arrive jamais en soirée. Résultat : trois
 * corrections déployées et « toujours rien » sur l'iPad, parce qu'il faisait
 * tourner un code vieux de plusieurs heures.
 *
 * Principe : toutes les 60 s (et au retour au premier plan), on relit la page
 * d'accueil sans cache et on compare le nom du fichier principal
 * (`/assets/index-<empreinte>.js`) avec celui réellement chargé. S'il diffère,
 * une nouvelle version est en ligne : on recharge dès que l'appelant dit que
 * c'est sûr (jamais pendant un morceau). Une ligne part au journal serveur.
 */
import { useEffect, useRef } from 'react';
import { remoteLog } from './remoteLog.js';

const INTERVALLE_MS = 60_000;

function empreinteChargee(): string | null {
  const script = document.querySelector<HTMLScriptElement>(
    'script[type="module"][src*="/assets/index-"]',
  );
  const m = script?.src.match(/\/assets\/(index-[^/]+\.js)/);
  return m?.[1] ?? null;
}

async function empreinteEnLigne(): Promise<string | null> {
  try {
    const res = await fetch('/?v=' + Date.now(), { cache: 'no-store', credentials: 'omit' });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/\/assets\/(index-[^"']+\.js)/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export function useNouvelleVersion(peutRecharger: boolean, ecran: string): void {
  const nouvelleDisponible = useRef(false);
  const peutRef = useRef(peutRecharger);
  peutRef.current = peutRecharger;

  useEffect(() => {
    const locale = empreinteChargee();
    if (!locale) return;
    let arrete = false;

    const recharger = (): void => {
      remoteLog('version', 'nouvelle version en ligne → rechargement', { ecran, ancienne: locale });
      window.setTimeout(() => window.location.reload(), 300);
    };

    const verifier = async (): Promise<void> => {
      if (arrete) return;
      if (nouvelleDisponible.current) {
        if (peutRef.current) recharger();
        return;
      }
      const enLigne = await empreinteEnLigne();
      if (arrete || !enLigne || enLigne === locale) return;
      nouvelleDisponible.current = true;
      remoteLog('version', 'nouvelle version détectée', {
        ecran,
        ancienne: locale,
        nouvelle: enLigne,
        rechargeMaintenant: peutRef.current,
      });
      if (peutRef.current) recharger();
    };

    const id = window.setInterval(() => void verifier(), INTERVALLE_MS);
    const surRetour = (): void => {
      if (document.visibilityState === 'visible') void verifier();
    };
    document.addEventListener('visibilitychange', surRetour);
    void verifier();
    return () => {
      arrete = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', surRetour);
    };
  }, [ecran]);

  // Dès que l'appelant dit « c'est sûr » et qu'une version attend : on y va.
  useEffect(() => {
    if (peutRecharger && nouvelleDisponible.current) {
      remoteLog('version', 'moment sûr atteint → rechargement', { ecran });
      window.setTimeout(() => window.location.reload(), 300);
    }
  }, [peutRecharger, ecran]);
}
