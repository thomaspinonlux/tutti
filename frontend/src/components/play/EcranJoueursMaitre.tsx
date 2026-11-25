/**
 * <EcranJoueursMaitre /> — feat/ecran-joueurs-telecommande
 *
 * Thomas, 25/11 : « une fois qu'on a lancé la partie, qu'on puisse accéder
 * facilement à ce QR code pour l'écran joueur » — pour brancher un écran de
 * plus en cours de soirée (un iPad sur la terrasse, une TV dans une autre
 * salle) sans retourner à la console.
 *
 * Un bouton « Écran joueurs » sur le téléphone de l'animateur, visible de la
 * salle d'attente à la fin de la partie. Il ouvre la MÊME fenêtre que le
 * bouton de la console (code à taper sur /tv + QR code). Le code est demandé
 * au serveur à l'ouverture : seul un animateur le reçoit.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { masterCodeEcran } from '../../lib/sessions.js';
import { TvCastFenetre } from '../host/TvCastButton.js';
import { Icone } from '../ui/Icone.js';

export function EcranJoueursMaitre({
  sessionId,
  token,
}: {
  sessionId: string;
  token: string;
}): JSX.Element {
  const { t } = useTranslation();
  const [code, setCode] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const ouvrir = (): void => {
    if (charge) return;
    setErreur(null);
    if (code) {
      setOuvert(true);
      return;
    }
    setCharge(true);
    masterCodeEcran(sessionId, token)
      .then((c) => {
        if (c) {
          setCode(c);
          setOuvert(true);
        } else setErreur(t('tvCast.indisponible'));
      })
      .catch(() => setErreur(t('tvCast.indisponible')))
      .finally(() => setCharge(false));
  };

  return (
    <>
      <button
        type="button"
        onClick={ouvrir}
        disabled={charge}
        className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-white/20 px-4 text-sm font-semibold text-white/85 transition-colors active:bg-white/10 disabled:opacity-50"
      >
        <Icone nom="ecran" />
        {t('tvCast.button')}
      </button>
      {erreur && (
        <p role="alert" className="mt-2 text-sm text-[#FF3366]">
          {erreur}
        </p>
      )}
      {ouvert && code && <TvCastFenetre tvCode={code} onClose={() => setOuvert(false)} />}
    </>
  );
}
