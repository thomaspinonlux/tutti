/**
 * Switch FR/EN — pill de boutons mono uppercase.
 * - aria-pressed pour l'état actif (lu par les lecteurs d'écran)
 * - met à jour state context + localStorage + URL searchParam
 */

import { useLandingI18n } from '../../i18n-landing/LandingI18nContext.js';

export function LangSwitch(): JSX.Element {
  const { lang, setLang } = useLandingI18n();
  return (
    <div
      className="landing-lang-switch"
      role="group"
      aria-label={lang === 'fr' ? 'Langue' : 'Language'}
    >
      <button
        type="button"
        aria-pressed={lang === 'fr'}
        aria-label="Français"
        onClick={() => setLang('fr')}
      >
        FR
      </button>
      <button
        type="button"
        aria-pressed={lang === 'en'}
        aria-label="English"
        onClick={() => setLang('en')}
      >
        EN
      </button>
    </div>
  );
}
