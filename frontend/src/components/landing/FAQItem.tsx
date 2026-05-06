/**
 * FAQ accordion item.
 *
 * A11y :
 *   - <button type="button" aria-expanded aria-controls> pour la question
 *   - <div role="region" aria-labelledby> pour la réponse
 *   - attribut `hidden` plutôt que conditional render (préserve le DOM stable
 *     et évite les warnings React)
 *
 * Animation : la hauteur du panel est gérée par max-height CSS via attribut
 * data-open + transition (pas de Framer ici car le panel doit conserver son
 * `hidden` attribute pour l'a11y, et Framer height auto interfère avec
 * `hidden`). Approche minimale et robuste.
 */

import { useId, useState } from 'react';

interface FAQItemProps {
  question: string;
  answerHtml: string;
}

export function FAQItem({ question, answerHtml }: FAQItemProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const id = useId();
  const buttonId = `faq-q-${id}`;
  const panelId = `faq-a-${id}`;

  return (
    <div
      className="py-6"
      style={{
        borderBottom: '1px solid rgba(26, 24, 20, 0.15)',
        borderTop: 'var(--first-border, none)',
      }}
    >
      <button
        type="button"
        id={buttonId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="landing-faq-q"
      >
        <span>{question}</span>
        <span aria-hidden="true" className="landing-faq-icon">
          +
        </span>
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        hidden={!open}
        className="landing-faq-a"
        style={{
          paddingTop: open ? '14px' : 0,
          color: 'var(--landing-ink-soft)',
          fontSize: '16px',
          lineHeight: 1.65,
        }}
        dangerouslySetInnerHTML={{ __html: answerHtml }}
      />
    </div>
  );
}
