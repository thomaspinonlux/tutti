/**
 * Footer landing — fond ink, logo light + 4 colonnes.
 */

import { useLandingI18n } from '../../i18n-landing/LandingI18nContext.js';

export function Footer(): JSX.Element {
  const { t } = useLandingI18n();
  return (
    <footer
      style={{
        background: 'var(--landing-ink)',
        color: 'rgba(245, 239, 224, 0.85)',
        padding: '64px 0 32px',
        fontSize: '14px',
      }}
    >
      <div className="landing-container">
        <div className="grid gap-9 sm:grid-cols-2 mb-12 md:[grid-template-columns:1.5fr_1fr_1fr_1fr]">
          <div>
            <img
              src="/logo-wordmark-light.svg"
              alt="Tutti"
              style={{ height: '56px', width: 'auto', marginBottom: '16px' }}
            />
            <p style={{ opacity: 0.7, maxWidth: '280px', lineHeight: 1.55 }}>{t.footer.tagline}</p>
          </div>

          <FooterCol title={t.footer.cols.tutti.title} links={t.footer.cols.tutti.links} />
          <FooterCol title={t.footer.cols.legal.title} links={t.footer.cols.legal.links} />

          <div>
            <h5 style={footerColTitleStyle}>{t.footer.cols.contact.title}</h5>
            <a
              href="mailto:contact@tuttiparty.app"
              style={footerLinkStyle}
              onMouseEnter={hover}
              onMouseLeave={unhover}
            >
              contact@tuttiparty.app
            </a>
            <a
              href="https://tuttiparty.app"
              style={footerLinkStyle}
              onMouseEnter={hover}
              onMouseLeave={unhover}
            >
              tuttiparty.app
            </a>
            <p style={{ opacity: 0.6, marginTop: '8px', fontSize: '13px' }}>
              Kleos Sàrl
              <br />
              1 rue de Chiny
              <br />
              L-1334 Luxembourg
              <br />
              RCS B185164
            </p>
          </div>
        </div>

        <div
          className="flex flex-wrap items-center justify-between gap-3"
          style={{
            borderTop: '1px solid rgba(245, 239, 224, 0.1)',
            paddingTop: '24px',
            fontSize: '13px',
            opacity: 0.6,
          }}
        >
          <span>{t.footer.copyright}</span>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '11px',
              letterSpacing: '0.08em',
            }}
          >
            {t.footer.built}
          </span>
        </div>
      </div>
    </footer>
  );
}

const footerColTitleStyle = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '11px',
  letterSpacing: '0.12em',
  textTransform: 'uppercase' as const,
  color: 'var(--landing-yellow)',
  marginBottom: '18px',
  fontWeight: 500,
};

const footerLinkStyle = {
  display: 'block',
  padding: '6px 0',
  color: 'rgba(245, 239, 224, 0.7)',
  textDecoration: 'none',
  transition: 'color 0.2s',
};

function hover(e: React.MouseEvent<HTMLAnchorElement>): void {
  (e.currentTarget as HTMLAnchorElement).style.color = 'var(--landing-cream)';
}
function unhover(e: React.MouseEvent<HTMLAnchorElement>): void {
  (e.currentTarget as HTMLAnchorElement).style.color = 'rgba(245, 239, 224, 0.7)';
}

interface FooterColProps {
  title: string;
  links: Array<{ label: string; href: string }>;
}

function FooterCol({ title, links }: FooterColProps): JSX.Element {
  return (
    <div>
      <h5 style={footerColTitleStyle}>{title}</h5>
      {links.map((link) => (
        <a
          key={link.href + link.label}
          href={link.href}
          style={footerLinkStyle}
          onMouseEnter={hover}
          onMouseLeave={unhover}
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}
