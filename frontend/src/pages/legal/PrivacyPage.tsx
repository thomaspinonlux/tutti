/**
 * /privacy — Politique de confidentialité (FR + EN).
 *
 * Mise à jour du 10 octobre 2026 : la musique est lue via Apple Music
 * (MusicKit), les réservations sont payées via Stripe ; plus de services
 * API YouTube dans le parcours client.
 */

import { useTranslation } from 'react-i18next';
import {
  LegalLayout,
  LegalSection,
  LegalSubSection,
  LegalTable,
} from '../../components/legal/LegalLayout.js';

export function PrivacyPage(): JSX.Element {
  const { i18n } = useTranslation();
  const isFr = i18n.language?.startsWith('fr') ?? true;
  return isFr ? <PrivacyFr /> : <PrivacyEn />;
}

const lien = 'text-spritz-deep hover:underline';

// ───── FR ─────────────────────────────────────────────────────────────────

function PrivacyFr(): JSX.Element {
  return (
    <LegalLayout
      title="Politique de confidentialité"
      subtitle="Comment Tutti collecte, utilise et protège vos données."
      lastUpdated="Dernière mise à jour : 10 octobre 2026"
    >
      <p>
        La présente Politique de confidentialité explique comment <strong>Kleos Sàrl</strong>{' '}
        («&nbsp;Kleos&nbsp;», «&nbsp;nous&nbsp;»), société immatriculée au Luxembourg (RCS
        Luxembourg B185164), collecte, utilise, stocke, partage et protège vos informations lorsque
        vous utilisez <strong>Tutti</strong>, notre plateforme de blind test et de quiz, accessible
        sur{' '}
        <a href="https://tuttiparty.app" className={lien}>
          https://tuttiparty.app
        </a>{' '}
        et via notre API à api.tuttiparty.app (le «&nbsp;Service&nbsp;»).
      </p>
      <p>En utilisant le Service, vous acceptez les pratiques décrites dans cette Politique.</p>

      <LegalSection title="1. Informations que nous collectons">
        <LegalSubSection title="1.1 Informations que vous fournissez">
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Informations de compte</strong>&nbsp;: prénom, nom, adresse e-mail et mot de
              passe (stocké sous forme hachée) lors de la création du compte.
            </li>
            <li>
              <strong>Réservations</strong>&nbsp;: date et horaires du créneau réservé, prix, statut
              de la réservation, code de partie offerte le cas échéant.
            </li>
            <li>
              <strong>Paiement</strong>&nbsp;: le paiement par carte est traité par Stripe. Nous ne
              recevons ni ne stockons votre numéro de carte ; nous conservons la référence du
              paiement et la facture.
            </li>
            <li>
              <strong>Réglages</strong>&nbsp;: préférences de partie et, si vous en indiquez une, la
              playlist de musique d’ambiance.
            </li>
          </ul>
        </LegalSubSection>

        <LegalSubSection title="1.2 Informations collectées automatiquement">
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Données d’utilisation</strong>&nbsp;: parties lancées (blind tests et quiz),
              playlists et thèmes joués, nombre de joueurs, durée, dates et horaires d’activité.
            </li>
            <li>
              <strong>Réponses vocales</strong>&nbsp;: lorsqu’un joueur répond à la voix, l’audio
              est envoyé à un service de transcription (voir Section 3) ; le texte transcrit est
              enregistré avec la réponse pour calculer les points.
            </li>
            <li>
              <strong>Données techniques</strong>&nbsp;: type de navigateur, type d’appareil et
              informations techniques similaires nécessaires au fonctionnement du Service.
            </li>
          </ul>
        </LegalSubSection>

        <LegalSubSection title="1.3 Joueurs (invités)">
          <p>
            Les joueurs qui rejoignent une partie via QR code le font{' '}
            <strong>sans créer de compte</strong>. Nous collectons uniquement le pseudo qu’ils
            choisissent ainsi que leurs réponses et scores pendant la partie.
          </p>
        </LegalSubSection>
      </LegalSection>

      <LegalSection title="2. Comment nous utilisons vos informations">
        <p>Nous utilisons les informations ci-dessus pour&nbsp;:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>créer et gérer votre compte&nbsp;;</li>
          <li>
            enregistrer vos réservations, encaisser les paiements et émettre les factures&nbsp;;
          </li>
          <li>
            fournir, exploiter et maintenir le Service, y compris la lecture de la musique&nbsp;;
          </li>
          <li>transcrire et évaluer les réponses vocales pendant les parties&nbsp;;</li>
          <li>
            envoyer des e-mails transactionnels (confirmation d’inscription, confirmation de
            réservation avec le mode d’emploi)&nbsp;;
          </li>
          <li>surveiller l’utilisation, prévenir les abus et améliorer le Service&nbsp;;</li>
          <li>nous conformer aux obligations légales, notamment comptables.</li>
        </ul>
        <p>
          Nous <strong>ne vendons pas</strong> vos informations personnelles.
        </p>
      </LegalSection>

      <LegalSection title="3. Prestataires avec qui nous partageons des informations">
        <p>
          Nous partageons les informations uniquement comme nécessaire au fonctionnement du Service,
          avec les prestataires suivants&nbsp;:
        </p>
        <LegalTable
          headers={['Prestataire', 'Finalité', 'Localisation']}
          rows={[
            ['Supabase', 'Base de données et comptes', 'Union européenne'],
            ['Vercel', 'Hébergement du site', 'Francfort, UE'],
            ['Railway', 'Hébergement du serveur / API', 'UE'],
            ['Stripe', 'Paiement des réservations et factures', 'Voir prestataire'],
            ['Apple (MusicKit)', 'Lecture de la musique pendant les parties', 'Voir prestataire'],
            [
              'Deepgram, AssemblyAI, OpenAI (Whisper)',
              'Transcription vocale des réponses des joueurs',
              'Voir prestataires',
            ],
            ['Resend', 'E-mails transactionnels', 'Voir prestataire'],
          ]}
        />
        <p>
          Chacun de ces prestataires traite les données pour notre compte et est soumis à ses
          propres obligations en matière de protection des données. Les pseudos et réponses des
          joueurs ne sont pas transmis à Apple.
        </p>
        <p>
          Nous pouvons également divulguer des informations si la loi, un règlement, une procédure
          légale ou une demande gouvernementale l’exige.
        </p>
      </LegalSection>

      <LegalSection title="4. Cookies et stockage local">
        <p>Tutti utilise des cookies, du stockage local et des jetons de session pour&nbsp;:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>vous maintenir connecté (jetons d’authentification)&nbsp;;</li>
          <li>mémoriser vos préférences (par exemple la langue)&nbsp;;</li>
          <li>faire fonctionner le Service en toute sécurité.</li>
        </ul>
        <p>
          La page de paiement Stripe peut placer ses propres cookies, régis par la politique de
          confidentialité de Stripe.
        </p>
      </LegalSection>

      <LegalSection title="5. Conservation des données">
        <p>
          Nous conservons vos informations de compte aussi longtemps que votre compte est actif. Les
          réservations, paiements et factures sont conservés pendant la durée exigée par les
          obligations légales et comptables.
        </p>
        <p>
          Vous pouvez demander la suppression de votre compte et des données associées à tout moment
          (voir Section 6).
        </p>
      </LegalSection>

      <LegalSection title="6. Vos droits">
        <LegalSubSection title="6.1 Accès, rectification et suppression">
          <p>
            Vous pouvez demander l’accès à vos données, leur rectification ou leur suppression en
            nous contactant à l’adresse indiquée en Section 8. Après vérification de la demande,
            nous supprimerons vos données personnelles, sauf celles dont la conservation est requise
            par la loi.
          </p>
        </LegalSubSection>
      </LegalSection>

      <LegalSection title="7. Sécurité des données">
        <p>
          Nous mettons en œuvre des mesures techniques et organisationnelles raisonnables pour
          protéger vos informations contre tout accès non autorisé, perte ou mauvaise utilisation.
          Cependant, aucune méthode de transmission ou de stockage n’est totalement sûre, et nous ne
          pouvons garantir une sécurité absolue.
        </p>
      </LegalSection>

      <LegalSection title="8. Contact">
        <p>
          Pour toute question concernant cette Politique, ou pour exercer vos droits,
          contactez-nous&nbsp;:
        </p>
        <p>
          <strong>Kleos Sàrl</strong>
          <br />
          E-mail&nbsp;:{' '}
          <a href="mailto:contact@tuttiparty.app" className={lien}>
            contact@tuttiparty.app
          </a>
          <br />
          Immatriculée au Luxembourg — RCS Luxembourg B185164
        </p>
      </LegalSection>

      <LegalSection title="9. Modifications de cette Politique">
        <p>
          Nous pouvons mettre à jour cette Politique de temps à autre. Nous actualiserons la date
          «&nbsp;Dernière mise à jour&nbsp;» en haut de cette page et, le cas échéant, vous en
          informerons. Votre utilisation continue du Service après les modifications constitue votre
          acceptation de la Politique révisée.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}

// ───── EN ─────────────────────────────────────────────────────────────────

function PrivacyEn(): JSX.Element {
  return (
    <LegalLayout
      title="Privacy Policy"
      subtitle="How Tutti collects, uses and protects your data."
      lastUpdated="Last updated: 10 October 2026"
    >
      <p>
        This Privacy Policy explains how <strong>Kleos Sàrl</strong> (“Kleos”, “we”), a company
        registered in Luxembourg (RCS Luxembourg B185164), collects, uses, stores, shares and
        protects your information when you use <strong>Tutti</strong>, our blind test and quiz
        platform, available at{' '}
        <a href="https://tuttiparty.app" className={lien}>
          https://tuttiparty.app
        </a>{' '}
        and through our API at api.tuttiparty.app (the “Service”).
      </p>
      <p>By using the Service, you agree to the practices described in this Policy.</p>

      <LegalSection title="1. Information we collect">
        <LegalSubSection title="1.1 Information you provide">
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Account information</strong>: first name, last name, email address and
              password (stored hashed) when you create an account.
            </li>
            <li>
              <strong>Bookings</strong>: date and times of the booked slot, price, booking status,
              free game code where applicable.
            </li>
            <li>
              <strong>Payment</strong>: card payments are processed by Stripe. We neither receive
              nor store your card number; we keep the payment reference and the invoice.
            </li>
            <li>
              <strong>Settings</strong>: game preferences and, if you provide one, the background
              music playlist.
            </li>
          </ul>
        </LegalSubSection>

        <LegalSubSection title="1.2 Information collected automatically">
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Usage data</strong>: games started (blind tests and quizzes), playlists and
              themes played, number of players, duration, activity dates and times.
            </li>
            <li>
              <strong>Voice answers</strong>: when a player answers by voice, the audio is sent to a
              transcription service (see Section 3); the transcribed text is stored with the answer
              to calculate points.
            </li>
            <li>
              <strong>Technical data</strong>: browser type, device type and similar technical
              information needed to run the Service.
            </li>
          </ul>
        </LegalSubSection>

        <LegalSubSection title="1.3 Players (guests)">
          <p>
            Players who join a game via QR code do so <strong>without creating an account</strong>.
            We only collect the nickname they choose and their answers and scores during the game.
          </p>
        </LegalSubSection>
      </LegalSection>

      <LegalSection title="2. How we use your information">
        <p>We use the information above to:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>create and manage your account;</li>
          <li>record your bookings, take payments and issue invoices;</li>
          <li>provide, operate and maintain the Service, including music playback;</li>
          <li>transcribe and assess voice answers during games;</li>
          <li>
            send transactional emails (sign-up confirmation, booking confirmation with the user
            guide);
          </li>
          <li>monitor usage, prevent abuse and improve the Service;</li>
          <li>comply with legal obligations, including accounting obligations.</li>
        </ul>
        <p>
          We <strong>do not sell</strong> your personal information.
        </p>
      </LegalSection>

      <LegalSection title="3. Providers we share information with">
        <p>We share information only as needed to run the Service, with the following providers:</p>
        <LegalTable
          headers={['Provider', 'Purpose', 'Location']}
          rows={[
            ['Supabase', 'Database and accounts', 'European Union'],
            ['Vercel', 'Website hosting', 'Frankfurt, EU'],
            ['Railway', 'Server / API hosting', 'EU'],
            ['Stripe', 'Booking payments and invoices', 'See provider'],
            ['Apple (MusicKit)', 'Music playback during games', 'See provider'],
            [
              'Deepgram, AssemblyAI, OpenAI (Whisper)',
              'Transcription of players’ voice answers',
              'See providers',
            ],
            ['Resend', 'Transactional emails', 'See provider'],
          ]}
        />
        <p>
          Each of these providers processes data on our behalf and is subject to its own data
          protection obligations. Players’ nicknames and answers are not sent to Apple.
        </p>
        <p>
          We may also disclose information if required by law, regulation, legal process or a
          government request.
        </p>
      </LegalSection>

      <LegalSection title="4. Cookies and local storage">
        <p>Tutti uses cookies, local storage and session tokens to:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>keep you signed in (authentication tokens);</li>
          <li>remember your preferences (for example the language);</li>
          <li>run the Service securely.</li>
        </ul>
        <p>Stripe’s payment page may set its own cookies, governed by Stripe’s privacy policy.</p>
      </LegalSection>

      <LegalSection title="5. Data retention">
        <p>
          We keep your account information for as long as your account is active. Bookings, payments
          and invoices are kept for the period required by legal and accounting obligations.
        </p>
        <p>
          You can ask us to delete your account and associated data at any time (see Section 6).
        </p>
      </LegalSection>

      <LegalSection title="6. Your rights">
        <LegalSubSection title="6.1 Access, correction and deletion">
          <p>
            You can ask to access, correct or delete your data by contacting us at the address in
            Section 8. Once the request is verified, we will delete your personal data, except data
            we are required by law to keep.
          </p>
        </LegalSubSection>
      </LegalSection>

      <LegalSection title="7. Data security">
        <p>
          We use reasonable technical and organisational measures to protect your information
          against unauthorised access, loss or misuse. However, no method of transmission or storage
          is completely secure, and we cannot guarantee absolute security.
        </p>
      </LegalSection>

      <LegalSection title="8. Contact">
        <p>For any question about this Policy, or to exercise your rights, contact us:</p>
        <p>
          <strong>Kleos Sàrl</strong>
          <br />
          Email:{' '}
          <a href="mailto:contact@tuttiparty.app" className={lien}>
            contact@tuttiparty.app
          </a>
          <br />
          Registered in Luxembourg — RCS Luxembourg B185164
        </p>
      </LegalSection>

      <LegalSection title="9. Changes to this Policy">
        <p>
          We may update this Policy from time to time. We will update the “Last updated” date at the
          top of this page and, where appropriate, notify you. Your continued use of the Service
          after changes means you accept the revised Policy.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
