/**
 * FAQ section — 11 questions, accordion natif a11y.
 * Premier item porte une bordure top supplémentaire via style direct.
 */

import { useLandingI18n } from '../../i18n-landing/LandingI18nContext.js';
import { FAQItem } from './FAQItem.js';

export function FAQ(): JSX.Element {
  const { t } = useLandingI18n();
  return (
    <section
      id="faq"
      className="py-[70px] sm:py-[100px]"
      style={{ background: 'var(--landing-cream-deep)' }}
      aria-labelledby="faq-title"
    >
      <div className="landing-container">
        <span className="landing-eyebrow">{t.faq.eyebrow}</span>
        <h2
          id="faq-title"
          className="landing-section-title"
          style={{ textAlign: 'center', marginLeft: 'auto', marginRight: 'auto' }}
        >
          {t.faq.title}
        </h2>

        <div className="mx-auto max-w-[820px]">
          {t.faq.items.map((item, idx) => (
            <div
              key={`${idx}-${item.q}`}
              style={{
                borderTop: idx === 0 ? '1px solid rgba(26, 24, 20, 0.15)' : 'none',
              }}
            >
              <FAQItem question={item.q} answerHtml={item.a} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
