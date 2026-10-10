/**
 * /terms — Conditions d'utilisation (FR + EN).
 *
 * Mise à jour du 10 octobre 2026 : modèle de réservation de créneaux à
 * l'heure, payés par carte via Stripe ; plus de services API YouTube.
 */

import { useTranslation } from 'react-i18next';
import { LegalLayout, LegalSection } from '../../components/legal/LegalLayout.js';

export function TermsPage(): JSX.Element {
  const { i18n } = useTranslation();
  const isFr = i18n.language?.startsWith('fr') ?? true;
  return isFr ? <TermsFr /> : <TermsEn />;
}

const lien = 'text-spritz-deep hover:underline';

// ───── FR ─────────────────────────────────────────────────────────────────

function TermsFr(): JSX.Element {
  return (
    <LegalLayout
      title="Conditions d’utilisation"
      subtitle="Les règles qui régissent votre utilisation de Tutti."
      lastUpdated="Dernière mise à jour : 10 octobre 2026"
    >
      <p>
        Les présentes Conditions d’utilisation («&nbsp;Conditions&nbsp;») régissent votre accès et
        votre utilisation de <strong>Tutti</strong>, une plateforme de blind test et de quiz
        exploitée par <strong>Kleos Sàrl</strong> («&nbsp;Kleos&nbsp;», «&nbsp;nous&nbsp;»), société
        immatriculée au Luxembourg (RCS Luxembourg B185164), accessible sur{' '}
        <a href="https://tuttiparty.app" className={lien}>
          https://tuttiparty.app
        </a>{' '}
        (le «&nbsp;Service&nbsp;»).
      </p>
      <p>
        En créant un compte ou en utilisant le Service, vous acceptez d’être lié par ces Conditions.
        Si vous n’êtes pas d’accord, n’utilisez pas le Service.
      </p>

      <LegalSection title="1. Description du Service">
        <p>
          Tutti permet à un organisateur d’animer des soirées de blind test musical et de quiz.
          L’organisateur&nbsp;:
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li>réserve un créneau horaire depuis son compte&nbsp;;</li>
          <li>
            lance, pendant ce créneau, des parties de blind test ou de quiz à partir de la
            bibliothèque officielle de Tutti&nbsp;;
          </li>
          <li>
            invite des joueurs à rejoindre la partie via QR code, sans qu’ils aient à créer de
            compte.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="2. Comptes">
        <p>
          Pour réserver et animer des parties, vous devez créer un compte avec des informations
          exactes (prénom, nom, e-mail). Vous êtes responsable de la confidentialité de vos
          identifiants et de toute activité sous votre compte. Vous devez avoir l’âge de la majorité
          dans votre juridiction, ou avoir le consentement d’un parent ou tuteur légal.
        </p>
      </LegalSection>

      <LegalSection title="3. Réservations, prix et paiement">
        <ul className="list-disc pl-6 space-y-1">
          <li>
            Le Service est payant à l’heure, par créneau réservé. Le prix TTC est affiché avant le
            paiement, calculé au prorata des minutes réservées.
          </li>
          <li>
            Le paiement se fait par carte bancaire via Stripe. Le créneau est confirmé dès le
            paiement, et une facture est fournie.
          </li>
          <li>Un code de partie offerte, le cas échéant, se saisit au moment de la réservation.</li>
          <li>
            Une réservation qui n’est pas encore payée peut être annulée depuis votre compte. Pour
            toute question sur une réservation payée, écrivez-nous à contact@tuttiparty.app.
          </li>
          <li>Il n’y a ni abonnement ni prélèvement automatique.</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Utilisation acceptable">
        <p>
          En utilisant le Service, vous acceptez de <strong>ne pas</strong>&nbsp;:
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li>violer toute loi applicable&nbsp;;</li>
          <li>
            enregistrer, copier ou redistribuer la musique ou le contenu diffusés pendant les
            parties&nbsp;;
          </li>
          <li>
            utiliser le Service pour porter atteinte aux droits de propriété intellectuelle
            d’autrui&nbsp;;
          </li>
          <li>tenter d’obtenir un accès non autorisé au Service ou à ses systèmes liés&nbsp;;</li>
          <li>utiliser le Service pour transmettre du contenu nuisible, abusif ou illégal.</li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Musique, contenu et usage public">
        <p>
          La musique et les contenus diffusés pendant les parties restent la propriété de leurs
          ayants droit. Tutti ne stocke ni ne redistribue aucun fichier audio.
        </p>
        <p>
          Tutti est destiné à un usage privé. Une diffusion publique ou commerciale (bar,
          restaurant, événement payant) peut nécessiter des licences musicales (SACEM ou équivalent
          local), que l’organisateur doit obtenir lui-même. Contactez-nous à contact@tuttiparty.app
          pour un usage professionnel.
        </p>
      </LegalSection>

      <LegalSection title="6. Garanties et limitation de responsabilité">
        <p>
          Le Service est fourni «&nbsp;en l’état&nbsp;» et «&nbsp;tel que disponible&nbsp;», sans
          garantie d’aucune sorte, dans toute la mesure permise par la loi. Nous ne garantissons pas
          que le Service sera ininterrompu ou exempt d’erreurs, ni qu’un morceau ou un contenu
          particulier restera disponible.
        </p>
        <p>
          Dans toute la mesure permise par la loi, Kleos Sàrl ne pourra être tenue responsable de
          tout dommage indirect, accessoire ou consécutif découlant de votre utilisation du Service.
        </p>
      </LegalSection>

      <LegalSection title="7. Résiliation">
        <p>
          Nous pouvons suspendre ou résilier votre accès au Service si vous violez ces Conditions.
          Vous pouvez cesser d’utiliser le Service et demander la suppression de votre compte à tout
          moment (voir notre Politique de confidentialité).
        </p>
      </LegalSection>

      <LegalSection title="8. Modifications de ces Conditions">
        <p>
          Nous pouvons modifier ces Conditions de temps à autre. Nous mettrons à jour la date
          «&nbsp;Dernière mise à jour&nbsp;» et, le cas échéant, vous en informerons. Votre
          utilisation continue du Service après les modifications constitue votre acceptation des
          Conditions révisées.
        </p>
      </LegalSection>

      <LegalSection title="9. Droit applicable">
        <p>
          Ces Conditions sont régies par les lois du Grand-Duché de Luxembourg, sans égard aux
          principes de conflits de lois, et soumises à la compétence des tribunaux luxembourgeois
          compétents.
        </p>
      </LegalSection>

      <LegalSection title="10. Contact">
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
    </LegalLayout>
  );
}

// ───── EN ─────────────────────────────────────────────────────────────────

function TermsEn(): JSX.Element {
  return (
    <LegalLayout
      title="Terms of Service"
      subtitle="The rules that govern your use of Tutti."
      lastUpdated="Last updated: 10 October 2026"
    >
      <p>
        These Terms of Service (“Terms”) govern your access to and use of <strong>Tutti</strong>, a
        blind test and quiz platform operated by <strong>Kleos Sàrl</strong> (“Kleos”, “we”), a
        company registered in Luxembourg (RCS Luxembourg B185164), available at{' '}
        <a href="https://tuttiparty.app" className={lien}>
          https://tuttiparty.app
        </a>{' '}
        (the “Service”).
      </p>
      <p>
        By creating an account or using the Service, you agree to be bound by these Terms. If you do
        not agree, do not use the Service.
      </p>

      <LegalSection title="1. Description of the Service">
        <p>Tutti lets an organiser host music blind test and quiz nights. The organiser:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>books a time slot from their account;</li>
          <li>during that slot, runs blind test or quiz games from Tutti’s official library;</li>
          <li>invites players to join via QR code, without them having to create an account.</li>
        </ul>
      </LegalSection>

      <LegalSection title="2. Accounts">
        <p>
          To book and host games, you must create an account with accurate information (first name,
          last name, email). You are responsible for keeping your credentials confidential and for
          all activity under your account. You must be of legal age in your jurisdiction, or have
          the consent of a parent or legal guardian.
        </p>
      </LegalSection>

      <LegalSection title="3. Bookings, prices and payment">
        <ul className="list-disc pl-6 space-y-1">
          <li>
            The Service is paid by the hour, per booked slot. The price including VAT is shown
            before payment, prorated to the minutes booked.
          </li>
          <li>
            Payment is by card via Stripe. The slot is confirmed as soon as payment is made, and an
            invoice is provided.
          </li>
          <li>A free game code, where applicable, is entered when booking.</li>
          <li>
            A booking that has not been paid yet can be cancelled from your account. For any
            question about a paid booking, write to contact@tuttiparty.app.
          </li>
          <li>There is no subscription and no automatic debit.</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Acceptable use">
        <p>
          By using the Service, you agree <strong>not</strong> to:
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li>break any applicable law;</li>
          <li>record, copy or redistribute the music or content played during games;</li>
          <li>use the Service to infringe others’ intellectual property rights;</li>
          <li>attempt to gain unauthorised access to the Service or its related systems;</li>
          <li>use the Service to transmit harmful, abusive or illegal content.</li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Music, content and public use">
        <p>
          The music and content played during games remain the property of their rights holders.
          Tutti does not store or redistribute any audio files.
        </p>
        <p>
          Tutti is intended for private use. Public or commercial use (bar, restaurant, paid event)
          may require music licences (SACEM or the local equivalent), which the organiser must
          obtain themselves. Contact us at contact@tuttiparty.app for professional use.
        </p>
      </LegalSection>

      <LegalSection title="6. Warranties and limitation of liability">
        <p>
          The Service is provided “as is” and “as available”, without warranty of any kind, to the
          fullest extent permitted by law. We do not guarantee that the Service will be
          uninterrupted or error-free, or that any particular track or content will remain
          available.
        </p>
        <p>
          To the fullest extent permitted by law, Kleos Sàrl shall not be liable for any indirect,
          incidental or consequential damages arising from your use of the Service.
        </p>
      </LegalSection>

      <LegalSection title="7. Termination">
        <p>
          We may suspend or terminate your access to the Service if you breach these Terms. You may
          stop using the Service and ask for your account to be deleted at any time (see our Privacy
          Policy).
        </p>
      </LegalSection>

      <LegalSection title="8. Changes to these Terms">
        <p>
          We may change these Terms from time to time. We will update the “Last updated” date and,
          where appropriate, notify you. Your continued use of the Service after changes means you
          accept the revised Terms.
        </p>
      </LegalSection>

      <LegalSection title="9. Governing law">
        <p>
          These Terms are governed by the laws of the Grand Duchy of Luxembourg, without regard to
          conflict-of-laws principles, and subject to the jurisdiction of the competent courts of
          Luxembourg.
        </p>
      </LegalSection>

      <LegalSection title="10. Contact">
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
    </LegalLayout>
  );
}
