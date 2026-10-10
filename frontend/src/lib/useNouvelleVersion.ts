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
      void rechargerQuandLeCacheEstPret(ecran, locale);
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
      void rechargerQuandLeCacheEstPret(ecran, empreinteChargee() ?? '');
    }
  }, [peutRecharger, ecran]);
}

/**
 * fix/boucle-de-rechargement — UN RECHARGEMENT N'APPORTE LA NOUVELLE VERSION
 * QUE SI LE CACHE L'A DÉJÀ.
 *
 * Soirée du 09/10, 21 h 33 et 21 h 36 : des téléphones de joueurs ont
 * rechargé la page huit à dix fois en vingt secondes. Journal, en boucle :
 *   nouvelle version détectée (ancienne index-Dtx0fhaI, nouvelle index-h88S0j10)
 *   → rechargement
 *   nouvelle version détectée (ancienne index-Dtx0fhaI, …)   ← la MÊME
 *
 * La détection va bien sur le réseau (fetch no-store), mais le rechargement
 * passe par le service worker, qui sert l'index.html de son cache
 * (`navigateFallback`) : l'ANCIENNE page revient, la détection la revoit
 * ancienne, et on recharge encore. Jusqu'à ce que le service worker ait fini
 * de se mettre à jour, chaque rechargement est perdu — et pendant ce temps le
 * joueur ne peut rien faire, et chaque page remontée tire sur le serveur.
 *
 * Donc, avant de recharger : on demande au service worker de se mettre à
 * jour, et on attend qu'il ait PRIS LE CONTRÔLE (`controllerchange`) — c'est
 * le signal que le cache sert désormais la nouvelle page. Et on garde la
 * trace de la tentative : si la page revient avec la même empreinte après un
 * rechargement récent, on ne recharge plus à l'aveugle, on attend ce signal.
 */
const CLE_TENTATIVE = 'tutti:rechargement-tente';
const DELAI_ENTRE_TENTATIVES_MS = 2 * 60 * 1000;
const ATTENTE_SW_MAX_MS = 20_000;

function tentativeRecente(empreinte: string): boolean {
  try {
    const brut = sessionStorage.getItem(CLE_TENTATIVE);
    if (!brut) return false;
    const { empreinte: e, quand } = JSON.parse(brut) as { empreinte: string; quand: number };
    return e === empreinte && Date.now() - quand < DELAI_ENTRE_TENTATIVES_MS;
  } catch {
    return false;
  }
}

function noterTentative(empreinte: string): void {
  try {
    sessionStorage.setItem(CLE_TENTATIVE, JSON.stringify({ empreinte, quand: Date.now() }));
  } catch {
    /* stockage indisponible : on recharge quand même, une fois */
  }
}

async function attendreNouveauServiceWorker(): Promise<'pret' | 'sans-sw' | 'delai'> {
  if (!('serviceWorker' in navigator)) return 'sans-sw';
  const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  if (!reg) return 'sans-sw';
  return new Promise((resoudre) => {
    let fini = false;
    const conclure = (v: 'pret' | 'delai'): void => {
      if (fini) return;
      fini = true;
      navigator.serviceWorker.removeEventListener('controllerchange', surChangement);
      resoudre(v);
    };
    const surChangement = (): void => conclure('pret');
    navigator.serviceWorker.addEventListener('controllerchange', surChangement);
    // Un worker déjà en attente n'a besoin que du signal pour s'activer.
    reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
    void reg.update().catch(() => undefined);
    window.setTimeout(() => conclure('delai'), ATTENTE_SW_MAX_MS);
  });
}

async function rechargerQuandLeCacheEstPret(ecran: string, ancienne: string): Promise<void> {
  if (tentativeRecente(ancienne)) {
    // Le rechargement précédent a ramené la même page : le cache n'était pas
    // prêt. On ne tourne pas en rond, on attend le service worker.
    remoteLog('version', 'rechargement récent sans effet → on attend le cache', {
      ecran,
      ancienne,
    });
    const etat = await attendreNouveauServiceWorker();
    if (etat !== 'pret') {
      remoteLog('version', 'cache toujours pas prêt — on reste sur cette version', {
        ecran,
        ancienne,
        etat,
      });
      return;
    }
  } else {
    const etat = await attendreNouveauServiceWorker();
    remoteLog('version', 'nouvelle version en ligne → rechargement', { ecran, ancienne, etat });
  }
  noterTentative(ancienne);
  window.setTimeout(() => window.location.reload(), 300);
}
