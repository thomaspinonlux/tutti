/**
 * /course — feat/course-test
 * L'écran TV de la course : ouvre un salon, affiche le QR code, fait tourner
 * la course (moteur courseMoteur) et la dessine. Les téléphones ne font
 * qu'envoyer gauche / droite.
 */
import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { connecterJeu } from '../../lib/socket.js';
import { getShareableOrigin } from '../../lib/platform.js';
import { QRCode } from '../../components/host/QRCode.js';
import {
  HAUTEUR,
  LARGEUR,
  RAYON_EXT,
  RAYON_INT,
  TOURS,
  avancer,
  classement,
  nouvelleVoiture,
  type Voiture,
} from '../../lib/courseMoteur.js';

type Phase = 'attente' | 'compte' | 'course' | 'fini';

export function CourseTvPage(): JSX.Element {
  const [code, setCode] = useState<string | null>(null);
  const [joueurs, setJoueurs] = useState<Array<{ id: string; pseudo: string; couleur: string }>>([]);
  const [phase, setPhase] = useState<Phase>('attente');
  const [podium, setPodium] = useState<Voiture[]>([]);
  const toile = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const voitures = useRef<Voiture[]>([]);
  const phaseRef = useRef<Phase>('attente');
  const departA = useRef(0);
  const finA = useRef<number | null>(null);
  const joueursRef = useRef(joueurs);
  joueursRef.current = joueurs;

  const changerPhase = (p: Phase): void => {
    phaseRef.current = p;
    setPhase(p);
  };

  const lancer = (): void => {
    if (phaseRef.current === 'compte' || phaseRef.current === 'course') return;
    if (joueursRef.current.length === 0) return;
    voitures.current = joueursRef.current.map((j, i) => nouvelleVoiture(j.id, j.pseudo, j.couleur, i));
    finA.current = null;
    setPodium([]);
    departA.current = performance.now() + 3000;
    changerPhase('compte');
  };
  const lancerRef = useRef(lancer);
  lancerRef.current = lancer;

  // ── Salon ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const s = connecterJeu();
    socketRef.current = s;
    const ouvrir = (): void => {
      s.emit('course:ouvrir', {}, (r: { ok: boolean; code: string }) => {
        if (r?.ok) {
          setCode(r.code);
          setJoueurs([]);
          voitures.current = [];
          changerPhase('attente');
        }
      });
    };
    s.on('connect', ouvrir);
    s.on('course:joueur', (j: { id: string; pseudo: string; couleur: string }) => {
      setJoueurs((l) => [...l.filter((x) => x.id !== j.id), j]);
      // Arrivé en pleine course : il prendra le départ suivant.
    });
    s.on('course:depart', (m: { id: string }) => {
      setJoueurs((l) => l.filter((x) => x.id !== m.id));
      voitures.current = voitures.current.filter((v) => v.id !== m.id);
    });
    s.on('course:cmd', (m: { id: string; g: boolean; d: boolean }) => {
      const v = voitures.current.find((x) => x.id === m.id);
      if (v) {
        v.g = m.g;
        v.d = m.d;
      }
    });
    s.on('course:lancer', () => lancerRef.current());
    return () => {
      s.disconnect();
    };
  }, []);

  // ── Boucle de jeu : calcul + dessin (60 i/s) + état aux téléphones (5/s) ──
  useEffect(() => {
    let id = 0;
    let avant = performance.now();
    let dernierEnvoi = 0;
    const boucle = (t: number): void => {
      const dt = Math.min(0.05, (t - avant) / 1000);
      avant = t;
      const ph = phaseRef.current;
      if (ph === 'compte' && t >= departA.current) changerPhase('course');
      if (phaseRef.current === 'course') {
        const tempsMs = t - departA.current;
        const arrivees = avancer(voitures.current, dt, true, tempsMs);
        if (arrivees.length > 0 && finA.current === null) finA.current = t + 15000;
        const tousFinis = voitures.current.every((v) => v.finiA !== null);
        if ((finA.current !== null && t >= finA.current) || (voitures.current.length > 0 && tousFinis)) {
          setPodium(classement(voitures.current));
          changerPhase('fini');
        }
      }
      dessiner(toile.current, voitures.current, phaseRef.current, Math.ceil((departA.current - t) / 1000));
      if (t - dernierEnvoi > 200 && socketRef.current) {
        dernierEnvoi = t;
        const cl = classement(voitures.current);
        socketRef.current.emit('course:etat', {
          phase: phaseRef.current,
          tours: TOURS,
          voitures: cl.map((v, i) => ({ id: v.id, rang: i + 1, tour: Math.min(TOURS, v.tours + 1), fini: v.finiA !== null })),
        });
      }
      id = requestAnimationFrame(boucle);
    };
    id = requestAnimationFrame(boucle);
    return () => cancelAnimationFrame(id);
  }, []);

  const url = code ? `${getShareableOrigin()}/course/${code}` : '';
  const cl = classement(voitures.current);

  return (
    <div className="min-h-screen bg-[#0B0B0F] text-white flex flex-col items-center p-4 gap-4">
      <div className="w-full max-w-[1600px] flex items-center justify-between gap-4">
        <h1 className="font-display text-4xl">🏎️ Course <span className="text-white/40 text-xl font-mono">test</span></h1>
        {code && (
          <p className="font-mono text-2xl">
            tuttiparty.app/course · <span className="text-[#FF5C4D] font-bold tracking-[0.3em]">{code}</span>
          </p>
        )}
      </div>
      <div className="relative w-full max-w-[1600px]" style={{ aspectRatio: `${LARGEUR} / ${HAUTEUR}` }}>
        <canvas ref={toile} width={LARGEUR} height={HAUTEUR} className="w-full h-full rounded-2xl" />
        {phase === 'attente' && (
          <div className="absolute inset-0 flex items-center justify-center gap-10 bg-black/60 rounded-2xl">
            {code && (
              <div className="rounded-2xl bg-white p-4">
                <QRCode value={url} size={260} />
              </div>
            )}
            <div className="space-y-3 max-w-md">
              <p className="font-display text-4xl">Scannez pour prendre le volant</p>
              <p className="text-white/70 text-xl">{TOURS} tours · jusqu'à 8 pilotes</p>
              <ul className="flex flex-wrap gap-2">
                {joueurs.map((j) => (
                  <li key={j.id} className="rounded-full px-3 py-1 font-semibold text-black" style={{ background: j.couleur }}>
                    {j.pseudo}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={lancer}
                disabled={joueurs.length === 0}
                className="mt-2 rounded-xl bg-[#FF5C4D] px-6 py-3 text-2xl font-bold disabled:opacity-40"
              >
                Départ ▶
              </button>
              <p className="text-white/50 text-sm">Un pilote peut aussi lancer depuis son téléphone.</p>
            </div>
          </div>
        )}
        {phase === 'fini' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70 rounded-2xl">
            <p className="font-display text-6xl">🏁 Arrivée</p>
            <ol className="space-y-2 text-3xl">
              {podium.map((v, i) => (
                <li key={v.id} className="flex items-center gap-3">
                  <span className="w-12 text-right">{['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`}</span>
                  <span className="inline-block h-5 w-5 rounded-full" style={{ background: v.couleur }} />
                  <span className="font-semibold">{v.pseudo}</span>
                  <span className="text-white/60 font-mono text-xl">
                    {v.finiA !== null ? `${(v.finiA / 1000).toFixed(1)} s` : `${v.tours}/${TOURS} tours`}
                  </span>
                </li>
              ))}
            </ol>
            <button type="button" onClick={lancer} className="rounded-xl bg-[#FF5C4D] px-6 py-3 text-2xl font-bold">
              Rejouer ↻
            </button>
          </div>
        )}
      </div>
      {phase === 'course' && (
        <ol className="flex flex-wrap gap-3 text-lg">
          {cl.map((v, i) => (
            <li key={v.id} className="rounded-full px-3 py-1 bg-white/10">
              <span className="font-mono">{i + 1}.</span>{' '}
              <span style={{ color: v.couleur }} className="font-semibold">{v.pseudo}</span>{' '}
              <span className="text-white/60">tour {Math.min(TOURS, v.tours + 1)}/{TOURS}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── Dessin ────────────────────────────────────────────────────────────────

function dessiner(c: HTMLCanvasElement | null, voitures: Voiture[], phase: Phase, compte: number): void {
  const ctx = c?.getContext('2d');
  if (!c || !ctx) return;
  const cx = 800;
  const cy = 450;
  const demi = 350;
  // Herbe
  ctx.fillStyle = '#163d22';
  ctx.fillRect(0, 0, LARGEUR, HAUTEUR);
  // Route : stade (segment + rayon)
  const stade = (r: number): void => {
    ctx.beginPath();
    ctx.moveTo(cx - demi, cy - r);
    ctx.lineTo(cx + demi, cy - r);
    ctx.arc(cx + demi, cy, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(cx - demi, cy + r);
    ctx.arc(cx - demi, cy, r, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.closePath();
  };
  ctx.fillStyle = '#3a3a42';
  stade(RAYON_EXT);
  ctx.fill();
  ctx.fillStyle = '#163d22';
  stade(RAYON_INT);
  ctx.fill();
  // Bordures
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#e8e8e8';
  stade(RAYON_EXT);
  ctx.stroke();
  stade(RAYON_INT);
  ctx.stroke();
  // Ligne médiane pointillée
  ctx.setLineDash([24, 24]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  stade((RAYON_INT + RAYON_EXT) / 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // Ligne d'arrivée (damier)
  const carre = 16;
  for (let y = cy + RAYON_INT; y < cy + RAYON_EXT; y += carre) {
    for (let k = 0; k < 2; k++) {
      ctx.fillStyle = (Math.floor((y - cy) / carre) + k) % 2 === 0 ? '#fff' : '#111';
      ctx.fillRect(cx - carre + k * carre, y, carre, carre);
    }
  }
  // Voitures
  for (const v of voitures) {
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(v.angle);
    ctx.fillStyle = v.couleur;
    ctx.beginPath();
    ctx.roundRect(-18, -10, 36, 20, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(2, -7, 9, 14);
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(v.pseudo, v.x, v.y - 22);
  }
  // Compte à rebours
  if (phase === 'compte' && compte > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, LARGEUR, HAUTEUR);
    ctx.fillStyle = '#FF5C4D';
    ctx.font = 'bold 260px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(compte), cx, cy);
    ctx.textBaseline = 'alphabetic';
  }
}
