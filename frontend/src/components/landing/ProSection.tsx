/**
 * ProSection — feat/contact-pro
 *
 * Thomas : « vous êtes professionnel bar / restauration / société
 * d'événementiel et vous souhaitez utiliser notre outil pour vos
 * établissements ? Contactez-nous ».
 */
import { useLandingI18n } from '../../i18n-landing/LandingI18nContext.js';
import { ContactProForm } from '../ContactProForm.js';
import { HighlightYellow } from './HighlightYellow.js';

const TEXTES = {
  fr: {
    eyebrow: 'Professionnels',
    titreDebut: 'Bar, restaurant, ',
    titreEm: 'événementiel',
    titreFin: ' ?',
    intro:
      'Vous souhaitez utiliser Tutti régulièrement dans vos établissements ou pour les événements de vos clients ? Écrivez-nous : nous préparons avec vous une formule adaptée à votre rythme.',
    points: [
      'Des soirées blind test et quiz clé en main pour vos clients',
      'Plusieurs établissements ou plusieurs soirées par semaine',
      'Un interlocuteur dédié pour démarrer',
    ],
  },
  en: {
    eyebrow: 'Professionals',
    titreDebut: 'Bar, restaurant, ',
    titreEm: 'events',
    titreFin: '?',
    intro:
      'Want to use Tutti regularly in your venues or for your clients’ events? Write to us: we’ll set up an offer that fits how often you play.',
    points: [
      'Turnkey blind test and quiz nights for your customers',
      'Several venues or several nights a week',
      'A dedicated contact to get started',
    ],
  },
};

export function ProSection(): JSX.Element {
  const { lang } = useLandingI18n();
  const tx = TEXTES[lang];
  return (
    <section id="pro" className="py-[70px] sm:py-[100px]" aria-labelledby="pro-title">
      <div className="landing-container grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
        <div>
          <span className="landing-eyebrow">{tx.eyebrow}</span>
          <h2 id="pro-title" className="landing-section-title">
            {tx.titreDebut}
            <HighlightYellow>{tx.titreEm}</HighlightYellow>
            {tx.titreFin}
          </h2>
          <p className="landing-section-intro">{tx.intro}</p>
          <ul className="grid gap-3 text-lg">
            {tx.points.map((p) => (
              <li key={p} className="flex gap-3">
                <span aria-hidden>✓</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <div
          className="rounded-2xl p-6 sm:p-8"
          style={{
            border: '2px solid var(--landing-ink)',
            background: 'var(--landing-cream-deep, #fff)',
          }}
        >
          <ContactProForm variant="landing" source="site" langue={lang} />
        </div>
      </div>
    </section>
  );
}
