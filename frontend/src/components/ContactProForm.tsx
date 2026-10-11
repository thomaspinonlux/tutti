/**
 * <ContactProForm /> — feat/contact-pro
 *
 * Formulaire « Vous êtes un professionnel ? » : sur le site (variant landing)
 * et dans le back-office (variant app). Envoie à /api/contact-pro.
 */
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api.js';

type TypePro = 'bar' | 'restaurant' | 'evenementiel' | 'entreprise' | 'autre';

const TEXTES = {
  fr: {
    types: [
      ['bar', 'Bar'],
      ['restaurant', 'Restaurant'],
      ['evenementiel', 'Événementiel'],
      ['entreprise', 'Entreprise'],
      ['autre', 'Autre'],
    ] as Array<[TypePro, string]>,
    vousEtes: 'Vous êtes',
    nom: 'Votre nom',
    societe: 'Établissement ou société',
    email: 'E-mail',
    telephone: 'Téléphone (facultatif)',
    message: 'Votre message',
    messagePh: 'Nombre d’établissements, fréquence des soirées, type d’événements…',
    envoyer: 'Envoyer',
    envoi: 'Envoi…',
    merci:
      'Merci ! Votre message est bien parti : nous revenons vers vous très vite. Un e-mail de confirmation vient de vous être envoyé.',
  },
  en: {
    types: [
      ['bar', 'Bar'],
      ['restaurant', 'Restaurant'],
      ['evenementiel', 'Events'],
      ['entreprise', 'Company'],
      ['autre', 'Other'],
    ] as Array<[TypePro, string]>,
    vousEtes: 'You are',
    nom: 'Your name',
    societe: 'Venue or company',
    email: 'Email',
    telephone: 'Phone (optional)',
    message: 'Your message',
    messagePh: 'Number of venues, how often you run nights, type of events…',
    envoyer: 'Send',
    envoi: 'Sending…',
    merci:
      'Thank you! Your message has been sent: we’ll get back to you shortly. A confirmation email is on its way.',
  },
};

interface Props {
  variant: 'landing' | 'app';
  source: 'site' | 'compte';
  langue?: 'fr' | 'en';
  emailParDefaut?: string;
}

export function ContactProForm({
  variant,
  source,
  langue = 'fr',
  emailParDefaut = '',
}: Props): JSX.Element {
  const tx = TEXTES[langue];
  const [type, setType] = useState<TypePro>('bar');
  const [nom, setNom] = useState('');
  const [societe, setSociete] = useState('');
  const [email, setEmail] = useState(emailParDefaut);
  const [telephone, setTelephone] = useState('');
  const [message, setMessage] = useState('');
  const [piege, setPiege] = useState('');
  const [etat, setEtat] = useState<'idle' | 'envoi' | 'ok'>('idle');
  const [erreur, setErreur] = useState<string | null>(null);

  const sombre = variant === 'app';
  const champ = sombre
    ? 'w-full px-3 py-3 text-base rounded border-2 bg-white/[0.06] border-white/25 text-white placeholder:text-white/40'
    : 'w-full px-4 py-3 text-base rounded-xl border-2 border-[var(--landing-ink)] bg-[var(--landing-cream)] text-[var(--landing-ink)]';
  const libelle = sombre
    ? 'block text-sm font-semibold mb-1 text-white/80'
    : 'block text-sm font-semibold mb-1';

  const envoyer = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setEtat('envoi');
    setErreur(null);
    try {
      await api('/api/contact-pro', {
        method: 'POST',
        body: { nom, societe, type, email, telephone, message, source, langue, site_web: piege },
      });
      setEtat('ok');
    } catch (err: unknown) {
      setErreur(err instanceof ApiError ? err.message : (err as Error).message);
      setEtat('idle');
    }
  };

  if (etat === 'ok') {
    return (
      <p className={sombre ? 'text-base text-basil' : 'text-lg font-semibold'}>✅ {tx.merci}</p>
    );
  }

  return (
    <form onSubmit={(e) => void envoyer(e)} className="grid gap-4">
      <div>
        <span className={libelle}>{tx.vousEtes}</span>
        <div className="flex flex-wrap gap-2">
          {tx.types.map(([valeur, texte]) => {
            const actif = type === valeur;
            return (
              <button
                key={valeur}
                type="button"
                aria-pressed={actif}
                onClick={() => setType(valeur)}
                className={`px-4 py-2 rounded-full border-2 text-base font-semibold ${
                  sombre
                    ? actif
                      ? 'bg-spritz border-spritz text-white'
                      : 'border-white/40 text-white hover:border-white'
                    : actif
                      ? 'bg-[var(--landing-ink)] border-[var(--landing-ink)] text-[var(--landing-cream)]'
                      : 'border-[var(--landing-ink)] text-[var(--landing-ink)]'
                }`}
              >
                {texte}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className={libelle}>{tx.nom}</span>
          <input className={champ} required value={nom} onChange={(e) => setNom(e.target.value)} />
        </label>
        <label>
          <span className={libelle}>{tx.societe}</span>
          <input className={champ} value={societe} onChange={(e) => setSociete(e.target.value)} />
        </label>
        <label>
          <span className={libelle}>{tx.email}</span>
          <input
            className={champ}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          <span className={libelle}>{tx.telephone}</span>
          <input
            className={champ}
            type="tel"
            value={telephone}
            onChange={(e) => setTelephone(e.target.value)}
          />
        </label>
      </div>
      <label>
        <span className={libelle}>{tx.message}</span>
        <textarea
          className={`${champ} min-h-[120px]`}
          required
          placeholder={tx.messagePh}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </label>
      {/* Champ piège pour les robots : caché aux humains. */}
      <input
        type="text"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={piege}
        onChange={(e) => setPiege(e.target.value)}
        style={{ position: 'absolute', left: '-9999px', width: 1, height: 1 }}
      />
      {erreur && (
        <p className={sombre ? 'text-raspberry' : 'text-red-700 font-semibold'}>{erreur}</p>
      )}
      <div>
        <button
          type="submit"
          disabled={etat === 'envoi'}
          className={
            sombre
              ? 'px-6 py-3 rounded-lg bg-spritz text-white font-semibold text-lg disabled:opacity-60'
              : 'landing-btn-primary'
          }
        >
          {etat === 'envoi' ? tx.envoi : tx.envoyer}
        </button>
      </div>
    </form>
  );
}
