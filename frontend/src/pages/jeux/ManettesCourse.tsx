/**
 * ManettesCourse.tsx — feat/jeux-manette-2
 * Manettes téléphone des jeux de course : volant (boutons ou téléphone
 * penché), pieds (sprint), moto (gaz + penché).
 */
import { useEffect, useRef, useState } from 'react';
import { useInclinaison } from '../../lib/jeux/inclinaison.js';

export type Emettre = (ev: string, data?: unknown, volatil?: boolean) => void;

const CLE_MODE = 'tutti.manette.volant';
type Mode = 'boutons' | 'pencher';

function lireMode(): Mode {
  try {
    return localStorage.getItem(CLE_MODE) === 'pencher' ? 'pencher' : 'boutons';
  } catch {
    return 'boutons';
  }
}

/** Zones « maintenir » multi-doigts : renvoie l'état g/d et les gestionnaires. */
function useZonesMaintenues(): {
  appui: { g: boolean; d: boolean };
  etat: React.MutableRefObject<{ g: boolean; d: boolean }>;
  zone: (cote: 'g' | 'd') => React.HTMLAttributes<HTMLDivElement>;
} {
  const doigts = useRef(new Map<number, 'g' | 'd'>());
  const etat = useRef({ g: false, d: false });
  const [appui, setAppui] = useState({ g: false, d: false });
  const maj = (): void => {
    const v = [...doigts.current.values()];
    const n = { g: v.includes('g'), d: v.includes('d') };
    etat.current = n;
    setAppui(n);
  };
  const lacher = (e: React.PointerEvent): void => {
    doigts.current.delete(e.pointerId);
    maj();
  };
  const zone = (cote: 'g' | 'd'): React.HTMLAttributes<HTMLDivElement> => ({
    onPointerDown: (e) => {
      e.preventDefault();
      doigts.current.set(e.pointerId, cote);
      maj();
    },
    onPointerUp: lacher,
    onPointerCancel: lacher,
    onPointerLeave: lacher,
  });
  return { appui, etat, zone };
}

function ChoixMode(props: { mode: Mode; changer: (m: Mode) => void; message?: string | null }): JSX.Element {
  const bouton = (m: Mode, txt: string): JSX.Element => (
    <button
      type="button"
      onClick={() => props.changer(m)}
      className={`flex-1 rounded-xl py-2 text-sm font-semibold ${props.mode === m ? 'bg-white text-black' : 'bg-white/10'}`}
    >
      {txt}
    </button>
  );
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        {bouton('boutons', '🎮 Boutons')}
        {bouton('pencher', '📱 Pencher le téléphone')}
      </div>
      {props.message && <p className="text-center text-[#FF5C4D] text-sm">{props.message}</p>}
    </div>
  );
}

/** Mode volant partagé : choix boutons / pencher, avec activation des capteurs. */
function useModeVolant(): {
  mode: Mode;
  changer: (m: Mode) => void;
  message: string | null;
  incl: ReturnType<typeof useInclinaison>;
} {
  const incl = useInclinaison();
  const [mode, setMode] = useState<Mode>('boutons');
  const [message, setMessage] = useState<string | null>(null);
  const changer = (m: Mode): void => {
    setMessage(null);
    if (m === 'pencher') {
      // Appelé dans le clic : l'iPhone exige un geste pour autoriser les capteurs.
      void incl.activer();
    } else incl.arreter();
    setMode(m);
    try {
      localStorage.setItem(CLE_MODE, m);
    } catch {
      /* rien */
    }
  };
  useEffect(() => {
    if (incl.etat === 'refuse') setMessage('Capteurs refusés : autorise « Mouvement et orientation » dans Safari, ou joue aux boutons.');
    if (incl.etat === 'indisponible') setMessage('Pas de capteur de mouvement ici : joue aux boutons.');
    if (incl.etat === 'refuse' || incl.etat === 'indisponible') setMode('boutons');
  }, [incl.etat]);
  // Le mode « pencher » mémorisé doit être réactivé par un appui (règle iPhone).
  const [propose] = useState(lireMode);
  useEffect(() => {
    if (propose === 'pencher') setMessage('Touche « Pencher le téléphone » pour réactiver le volant.');
  }, [propose]);
  return { mode, changer, message, incl };
}

function JaugeVolant({ x }: { x: React.MutableRefObject<number> }): JSX.Element {
  const [v, setV] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setV(x.current), 50);
    return () => window.clearInterval(id);
  }, [x]);
  return (
    <div className="relative h-24 rounded-3xl bg-white/10 overflow-hidden">
      <div className="absolute inset-y-0 left-1/2 w-0.5 bg-white/30" />
      <div
        className="absolute top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white text-black flex items-center justify-center text-3xl"
        style={{ left: `${50 + v * 42}%`, transform: `translate(-50%, -50%) rotate(${v * 60}deg)` }}
      >
        🛞
      </div>
    </div>
  );
}

/**
 * Volant : kart, auto-tamponneuses, ski. Envoie { x: direction, d: frein }
 * toutes les 60 ms. Boutons : ◀ ▶ à maintenir (les deux = frein).
 */
export function ManetteVolant(props: {
  emettre: Emettre;
  action?: { label: string; type: string };
  frein?: boolean;
}): JSX.Element {
  const { emettre } = props;
  const { mode, changer, message, incl } = useModeVolant();
  const zones = useZonesMaintenues();
  const freinTilt = useRef(false);
  const [freinAff, setFreinAff] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      let x: number;
      let frein: boolean;
      if (mode === 'pencher') {
        x = incl.x.current;
        frein = freinTilt.current;
      } else {
        const { g, d } = zones.etat.current;
        frein = props.frein !== false && g && d;
        x = frein ? 0 : (d ? 1 : 0) - (g ? 1 : 0);
      }
      emettre('manette:cmd', { x, d: frein }, true);
    }, 60);
    return () => window.clearInterval(id);
  }, [emettre, mode, incl.x, zones.etat, props.frein]);

  const action = props.action && (
    <button
      type="button"
      onPointerDown={(e) => {
        e.preventDefault();
        emettre('manette:action', { type: props.action!.type });
      }}
      className="rounded-3xl bg-[#FF5C4D] py-6 text-3xl font-black active:scale-95"
    >
      {props.action.label}
    </button>
  );
  const classeZone = (actif: boolean): string =>
    `flex-1 flex items-center justify-center text-7xl rounded-3xl transition-colors ${actif ? 'bg-white/35' : 'bg-white/10'}`;

  return (
    <div className="flex-1 flex flex-col gap-3 min-h-0">
      <ChoixMode mode={mode} changer={changer} message={message} />
      {mode === 'boutons' ? (
        <>
          <div className="flex-1 flex gap-3 min-h-0">
            <div className={classeZone(zones.appui.g)} {...zones.zone('g')}>◀</div>
            <div className={classeZone(zones.appui.d)} {...zones.zone('d')}>▶</div>
          </div>
          {props.frein !== false && <p className="text-center text-white/50 text-sm">Les deux en même temps = frein.</p>}
        </>
      ) : (
        <>
          <p className="text-center text-white/60 text-sm">Tiens le téléphone écran vers toi et tourne-le comme un volant.</p>
          <JaugeVolant x={incl.x} />
          <button type="button" onClick={incl.recalibrer} className="text-white/60 text-sm underline">
            Remettre le volant droit
          </button>
          <div className="flex-1" />
          {props.frein !== false && (
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                freinTilt.current = true;
                setFreinAff(true);
              }}
              onPointerUp={() => {
                freinTilt.current = false;
                setFreinAff(false);
              }}
              onPointerCancel={() => {
                freinTilt.current = false;
                setFreinAff(false);
              }}
              onPointerLeave={() => {
                freinTilt.current = false;
                setFreinAff(false);
              }}
              className={`rounded-3xl py-5 text-2xl font-bold ${freinAff ? 'bg-white/40' : 'bg-white/15'}`}
            >
              FREIN
            </button>
          )}
        </>
      )}
      {action}
    </div>
  );
}

/** Sprint : PIED GAUCHE / PIED DROIT, chaque appui = une action. */
export function ManettePieds({ emettre }: { emettre: Emettre }): JSX.Element {
  const [flash, setFlash] = useState<'g' | 'd' | null>(null);
  const appui = (cote: 'g' | 'd') => (e: React.PointerEvent): void => {
    e.preventDefault();
    emettre('manette:action', { type: cote });
    setFlash(cote);
    window.setTimeout(() => setFlash((f) => (f === cote ? null : f)), 90);
  };
  const zone = (actif: boolean): string =>
    `flex-1 flex flex-col items-center justify-center gap-2 rounded-3xl transition-colors ${actif ? 'bg-white/40' : 'bg-white/10'}`;
  return (
    <div className="flex-1 flex flex-col gap-2 min-h-0">
      <p className="text-center text-white/60 text-sm">Gauche, droite, gauche, droite… le plus vite possible !</p>
      <div className="flex-1 flex gap-3">
        <div className={zone(flash === 'g')} onPointerDown={appui('g')}>
          <span className="text-6xl">🦶</span>
          <span className="font-bold text-xl">GAUCHE</span>
        </div>
        <div className={zone(flash === 'd')} onPointerDown={appui('d')}>
          <span className="text-6xl" style={{ transform: 'scaleX(-1)' }}>🦶</span>
          <span className="font-bold text-xl">DROITE</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Moto : GAZ à maintenir ; en l'air, se pencher en arrière (↶) ou en avant
 * (↷) — avec des boutons ou en penchant le téléphone. Envoie { g: gaz, x: penché }.
 */
export function ManetteMoto({ emettre }: { emettre: Emettre }): JSX.Element {
  const { mode, changer, message, incl } = useModeVolant();
  const zones = useZonesMaintenues();
  const gaz = useRef(false);
  const [gazAff, setGazAff] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      const { g, d } = zones.etat.current;
      const x = mode === 'pencher' ? incl.x.current : (d ? 1 : 0) - (g ? 1 : 0);
      emettre('manette:cmd', { g: gaz.current, x }, true);
    }, 60);
    return () => window.clearInterval(id);
  }, [emettre, mode, incl.x, zones.etat]);

  const tenirGaz = (v: boolean) => (e: React.PointerEvent): void => {
    e.preventDefault();
    gaz.current = v;
    setGazAff(v);
  };
  const classeZone = (actif: boolean): string =>
    `flex-1 flex flex-col items-center justify-center rounded-3xl transition-colors ${actif ? 'bg-white/35' : 'bg-white/10'}`;

  return (
    <div className="flex-1 flex flex-col gap-3 min-h-0">
      <ChoixMode mode={mode} changer={changer} message={message} />
      <div className="flex-1 flex gap-3 min-h-0">
        {mode === 'boutons' ? (
          <div className="flex-1 flex flex-col gap-3">
            <div className={classeZone(zones.appui.g)} {...zones.zone('g')}>
              <span className="text-5xl">↶</span>
              <span className="text-sm">en arrière</span>
            </div>
            <div className={classeZone(zones.appui.d)} {...zones.zone('d')}>
              <span className="text-5xl">↷</span>
              <span className="text-sm">en avant</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col gap-2 justify-center">
            <p className="text-center text-white/60 text-sm">Tourne le téléphone : à gauche = en arrière, à droite = en avant.</p>
            <JaugeVolant x={incl.x} />
            <button type="button" onClick={incl.recalibrer} className="text-white/60 text-sm underline">
              Remettre droit
            </button>
          </div>
        )}
        <div
          className={`flex-1 flex items-center justify-center rounded-3xl text-4xl font-black ${gazAff ? 'bg-[#ff8a7d]' : 'bg-[#FF5C4D]'}`}
          onPointerDown={tenirGaz(true)}
          onPointerUp={tenirGaz(false)}
          onPointerCancel={tenirGaz(false)}
          onPointerLeave={tenirGaz(false)}
        >
          GAZ
        </div>
      </div>
      <p className="text-center text-white/50 text-sm">En l'air, penche-toi pour retomber à plat, sinon c'est la chute.</p>
    </div>
  );
}
