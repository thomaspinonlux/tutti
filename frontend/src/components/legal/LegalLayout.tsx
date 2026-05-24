/**
 * <LegalLayout /> — feat/youtube-compliance
 *
 * Coque partagée pour /privacy + /terms : header simple avec logo Tutti
 * et lien retour, container max-w-3xl, footer mention Kleos. Style cohérent
 * Tutti (cream/ink, font Fraunces pour H1, Inter pour body, JetBrains Mono
 * pour méta).
 *
 * Bilingue : le composant lit `i18n.language` et expose un toggle
 * Privacy/Terms FR/EN dans le footer.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MultiColorBar, TitleHandwritten, Underline } from '../ui/index.js';

interface Props {
  /** Titre affiché en H1 (déjà localisé). */
  title: string;
  /** Sous-titre éditorial (déjà localisé). */
  subtitle?: string;
  /** Date "Last updated" (déjà localisée). */
  lastUpdated: string;
  children: ReactNode;
}

export function LegalLayout({ title, subtitle, lastUpdated, children }: Props): JSX.Element {
  const { i18n } = useTranslation();
  const isFr = i18n.language?.startsWith('fr') ?? true;
  return (
    <main className="min-h-screen bg-cream text-ink flex flex-col">
      <MultiColorBar height="sm" />

      <header className="border-b-2 border-ink/15 bg-cream-2/40">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
          <Link to="/" className="flex items-center gap-2 font-display text-2xl hover:opacity-80">
            <span>🎵</span>
            <span>Tutti</span>
          </Link>
          <div className="flex items-center gap-4 text-xs font-mono text-ink-soft">
            <Link to="/privacy" className="hover:text-ink hover:underline">
              {isFr ? 'Confidentialité' : 'Privacy'}
            </Link>
            <Link to="/terms" className="hover:text-ink hover:underline">
              {isFr ? 'CGU' : 'Terms'}
            </Link>
            <button
              type="button"
              onClick={() => void i18n.changeLanguage(isFr ? 'en' : 'fr')}
              className="px-2 py-1 border border-ink/30 rounded hover:bg-ink/5 uppercase tracking-wider"
            >
              {isFr ? 'EN' : 'FR'}
            </button>
          </div>
        </div>
      </header>

      <article className="flex-1 max-w-3xl mx-auto w-full px-6 py-10">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-3">
          {isFr ? 'Légal · Tutti' : 'Legal · Tutti'}
        </p>
        <TitleHandwritten as="h1" className="mb-3">
          <Underline>{title}</Underline>
        </TitleHandwritten>
        {subtitle && <p className="font-editorial italic text-ink-2 text-lg mb-2">{subtitle}</p>}
        <p className="font-mono text-xs text-ink-soft mb-8">{lastUpdated}</p>
        <div className="legal-prose space-y-5 text-base leading-relaxed">{children}</div>
      </article>

      <footer className="border-t-2 border-ink/15 bg-cream-2/40 py-8 mt-12">
        <div className="max-w-3xl mx-auto px-6 text-center text-xs font-mono text-ink-soft space-y-2">
          <p>
            © 2026 <strong className="text-ink">Kleos Sàrl</strong> — Luxembourg · RCS B185164
          </p>
          <p>
            <a href="mailto:contact@tuttiparty.app" className="hover:underline">
              contact@tuttiparty.app
            </a>{' '}
            ·{' '}
            <Link to="/" className="hover:underline">
              tuttiparty.app
            </Link>
          </p>
        </div>
      </footer>
    </main>
  );
}

// ───── Helpers de mise en forme (sections / tableaux / listes) ───────────

interface SectionProps {
  id?: string;
  title: string;
  children: ReactNode;
}
export function LegalSection({ id, title, children }: SectionProps): JSX.Element {
  return (
    <section id={id} className="pt-4">
      <h2 className="font-display text-2xl md:text-3xl mb-3 mt-6 text-ink">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function LegalSubSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="mt-4">
      <h3 className="font-display text-lg md:text-xl mb-2 text-ink">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

interface LegalTableProps {
  headers: string[];
  rows: string[][];
}
export function LegalTable({ headers, rows }: LegalTableProps): JSX.Element {
  return (
    <div className="overflow-x-auto border-2 border-ink/20 rounded-lg bg-cream">
      <table className="w-full text-sm">
        <thead className="bg-ink/5">
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                className="text-left font-mono text-xs uppercase tracking-wider px-3 py-2 border-b border-ink/15"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-ink/10">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
