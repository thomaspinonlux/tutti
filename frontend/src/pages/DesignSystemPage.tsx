/**
 * Page /_design-system — vitrine de tous les composants UI Pop Cocktail.
 *
 * Visible uniquement en dev (gate via import.meta.env.DEV).
 * Sert de référence visuelle pour vérifier la cohérence du design system.
 */

import { useState } from 'react';
import {
  Button,
  Card,
  Modal,
  Badge,
  Input,
  MultiColorBar,
  Pill,
  TitleHandwritten,
  Underline,
  Swirl,
  Confetti,
  fireConfetti,
} from '../components/ui/index.js';

export function DesignSystemPage(): JSX.Element {
  const [modalOpen, setModalOpen] = useState(false);
  const [activePill, setActivePill] = useState<string>('all');
  const [confettiKey, setConfettiKey] = useState(0);

  return (
    <main className="min-h-screen pb-16">
      <MultiColorBar height="lg" />

      <header className="max-w-5xl mx-auto px-8 pt-12 pb-8 border-b-2 border-ink relative">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-3">
          Tutti · design system · Pop Cocktail
        </p>
        <TitleHandwritten as="h1">
          Direction <Swirl>artistique</Swirl> <Underline>Pop Cocktail</Underline>
        </TitleHandwritten>
        <p className="mt-4 max-w-2xl text-ink-2 italic font-editorial">
          Festif mais sophistiqué — comme une affiche imprimée de bar à cocktails.
        </p>
      </header>

      <section className="max-w-5xl mx-auto px-8 mt-12 space-y-12">
        {/* ─── Palette ─── */}
        <Section title="Palette">
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {[
              ['cream', 'bg-cream'],
              ['spritz', 'bg-spritz'],
              ['basil', 'bg-basil'],
              ['raspberry', 'bg-raspberry'],
              ['lemon', 'bg-lemon'],
              ['plum', 'bg-plum'],
            ].map(([name, cls]) => (
              <div key={name} className="text-center">
                <div className={`h-20 border-2 border-ink rounded ${cls} shadow-pop`} />
                <p className="mt-2 font-mono text-xs uppercase">{name}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* ─── Typographies ─── */}
        <Section title="Typographies">
          <Card>
            <p className="font-display text-4xl mb-4">Caprasimo — display, moments d'impact</p>
            <p className="font-editorial italic text-2xl text-raspberry-deep mb-4">
              Fraunces italique — éditorial, signature
            </p>
            <p className="text-lg mb-2">Outfit — UI, boutons, labels</p>
            <p className="font-mono text-sm">JetBrains Mono — codes, scores, métadonnées</p>
          </Card>
        </Section>

        {/* ─── Buttons ─── */}
        <Section title="Buttons">
          <div className="flex flex-wrap gap-3 items-end">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="ghost">Ghost</Button>
          </div>
          <div className="flex flex-wrap gap-3 mt-4 items-end">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
            <Button disabled>Disabled</Button>
          </div>
        </Section>

        {/* ─── Cards ─── */}
        <Section title="Cards">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(['default', 'spritz', 'basil', 'raspberry', 'lemon', 'plum'] as const).map((tone) => (
              <Card key={tone} tone={tone} size="sm">
                <p className="font-display text-lg capitalize">{tone}</p>
                <p className="text-sm text-ink-soft">Carte avec accent {tone}.</p>
              </Card>
            ))}
          </div>
        </Section>

        {/* ─── Inputs ─── */}
        <Section title="Inputs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
            <Input label="Pseudo" placeholder="Ton pseudo" />
            <Input
              label="Email"
              type="email"
              placeholder="toi@exemple.com"
              hint="On t'enverra un mail de confirmation."
            />
            <Input label="Mot de passe" type="password" error="Trop court (8 caractères min.)" />
            <Input label="Code session" placeholder="KOMP-7K2X" />
          </div>
        </Section>

        {/* ─── Badges ─── */}
        <Section title="Badges (équipes & tags)">
          <div className="flex flex-wrap gap-2">
            <Badge tone="spritz" tilt={-2}>
              Pinots
            </Badge>
            <Badge tone="basil" tilt={1}>
              Basilics
            </Badge>
            <Badge tone="raspberry" tilt={-1}>
              Frambois
            </Badge>
            <Badge tone="lemon" tilt={2}>
              Citrons
            </Badge>
            <Badge tone="plum" tilt={-1}>
              Prunes
            </Badge>
            <Badge tone="ink">Master</Badge>
            <Badge tone="cream">Demo</Badge>
          </div>
        </Section>

        {/* ─── Pills ─── */}
        <Section title="Pills (filtres)">
          <div className="flex flex-wrap gap-2">
            {['all', 'easy', 'medium', 'expert'].map((p) => (
              <Pill key={p} active={activePill === p} onClick={() => setActivePill(p)}>
                {p}
              </Pill>
            ))}
          </div>
        </Section>

        {/* ─── MultiColorBar ─── */}
        <Section title="MultiColorBar (signature)">
          <MultiColorBar height="sm" className="mb-2" />
          <MultiColorBar height="md" className="mb-2" />
          <MultiColorBar height="lg" />
        </Section>

        {/* ─── TitleHandwritten ─── */}
        <Section title="TitleHandwritten">
          <Card>
            <TitleHandwritten as="h2">
              Bienvenue chez <Underline>Tutti</Underline>
            </TitleHandwritten>
            <TitleHandwritten as="h3" className="mt-6">
              Manche en <Swirl>cours</Swirl>
            </TitleHandwritten>
          </Card>
        </Section>

        {/* ─── Modal ─── */}
        <Section title="Modal">
          <Button onClick={() => setModalOpen(true)} variant="secondary">
            Ouvrir une modal
          </Button>
          <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Ajustement de points">
            <p className="text-ink-2 mb-4">Choisis la raison de l'ajustement et le montant.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setModalOpen(false)}>
                Annuler
              </Button>
              <Button variant="primary" size="sm" onClick={() => setModalOpen(false)}>
                Valider
              </Button>
            </div>
          </Modal>
        </Section>

        {/* ─── Confetti ─── */}
        <Section title="Confetti">
          <Button
            variant="primary"
            onClick={() => {
              fireConfetti();
              setConfettiKey((k) => k + 1);
            }}
          >
            Tirer une salve
          </Button>
          <Confetti trigger={confettiKey > 0} />
        </Section>
      </section>

      <MultiColorBar height="lg" className="mt-16" />
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section>
      <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-4 pb-1 border-b border-cream-4">
        {title}
      </h2>
      {children}
    </section>
  );
}
