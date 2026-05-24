/**
 * /terms — Terms of Service (FR + EN).
 *
 * feat/youtube-compliance — page publique requise par YouTube API Services
 * Developer Policies. Lien depuis footer + signup checkbox obligatoire.
 *
 * Source de référence : version EN (Thomas — Kleos Sàrl). FR = traduction
 * fidèle. En cas de divergence, EN prime pour la conformité Google.
 */

import { useTranslation } from 'react-i18next';
import { LegalLayout, LegalSection } from '../../components/legal/LegalLayout.js';

export function TermsPage(): JSX.Element {
  const { i18n } = useTranslation();
  const isFr = i18n.language?.startsWith('fr') ?? true;
  return isFr ? <TermsFr /> : <TermsEn />;
}

// ───── FR ─────────────────────────────────────────────────────────────────

function TermsFr(): JSX.Element {
  return (
    <LegalLayout
      title="Conditions d’utilisation"
      subtitle="Les règles qui régissent votre utilisation de Tutti."
      lastUpdated="Dernière mise à jour : 22 mai 2026"
    >
      <p>
        Les présentes Conditions d’utilisation («&nbsp;Conditions&nbsp;») régissent votre accès et
        votre utilisation de <strong>Tutti</strong>, une plateforme de blind test et de quiz
        exploitée par <strong>Kleos Sàrl</strong> («&nbsp;Kleos&nbsp;», «&nbsp;nous&nbsp;»), société
        immatriculée au Luxembourg (RCS Luxembourg B185164), accessible sur{' '}
        <a href="https://tuttiparty.app" className="text-spritz-deep hover:underline">
          https://tuttiparty.app
        </a>{' '}
        (le «&nbsp;Service&nbsp;»).
      </p>
      <p>
        En créant un compte ou en utilisant le Service, vous acceptez d’être lié par ces Conditions.
        Si vous n’êtes pas d’accord, n’utilisez pas le Service.
      </p>

      <LegalSection title="1. Acceptation des Conditions d’utilisation de YouTube">
        <p>
          Tutti utilise les services API YouTube, notamment l’API YouTube Data v3 et l’API YouTube
          IFrame Player.
        </p>
        <p>
          <strong>
            En utilisant Tutti, vous acceptez d’être lié par les Conditions d’utilisation de
            YouTube, disponibles à l’adresse{' '}
            <a
              href="https://www.youtube.com/t/terms"
              className="text-spritz-deep hover:underline"
              target="_blank"
              rel="noreferrer noopener"
            >
              https://www.youtube.com/t/terms
            </a>
            .
          </strong>
        </p>
        <p>
          Votre utilisation du contenu et des fonctionnalités YouTube via Tutti est également
          soumise à la Politique de confidentialité de Google, disponible à l’adresse{' '}
          <a
            href="http://www.google.com/policies/privacy"
            className="text-spritz-deep hover:underline"
            target="_blank"
            rel="noreferrer noopener"
          >
            http://www.google.com/policies/privacy
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="2. Description du Service">
        <p>
          Tutti permet aux hosts de créer et d’animer des blind tests musicaux et des quiz
          multimédias. Les hosts peuvent&nbsp;:
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            rechercher des morceaux via l’API YouTube Data v3 et construire des playlists&nbsp;;
          </li>
          <li>
            lancer des sessions live dans lesquelles les vidéos YouTube sont lues via le YouTube
            IFrame Player officiel&nbsp;;
          </li>
          <li>
            inviter des joueurs à rejoindre les sessions via QR code, sans nécessiter la création
            d’un compte.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Comptes">
        <p>
          Pour animer des sessions, vous devez créer un compte avec des informations exactes
          (prénom, nom, e-mail). Vous êtes responsable de la confidentialité de vos identifiants et
          de toute activité sous votre compte. Vous devez avoir l’âge de la majorité dans votre
          juridiction, ou avoir le consentement d’un parent ou tuteur légal.
        </p>
      </LegalSection>

      <LegalSection title="4. Utilisation acceptable">
        <p>
          En utilisant le Service, vous acceptez de <strong>ne pas</strong>&nbsp;:
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li>violer les Conditions d’utilisation de YouTube ou toute loi applicable&nbsp;;</li>
          <li>
            télécharger, mettre en cache, copier ou stocker du contenu audio ou vidéo YouTube en
            dehors du YouTube IFrame Player officiel&nbsp;;
          </li>
          <li>
            tenter de contourner, désactiver ou interférer avec la publicité, la monétisation ou
            toute mesure technique de YouTube&nbsp;;
          </li>
          <li>
            utiliser le Service pour porter atteinte aux droits de propriété intellectuelle
            d’autrui&nbsp;;
          </li>
          <li>tenter d’obtenir un accès non autorisé au Service ou à ses systèmes liés&nbsp;;</li>
          <li>utiliser le Service pour transmettre du contenu nuisible, abusif ou illégal.</li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Contenu et attribution">
        <p>
          Tutti affiche le contenu YouTube via le YouTube IFrame Player officiel et fournit
          l’attribution (titre, artiste/chaîne et lien vers la vidéo YouTube d’origine). Tout
          contenu YouTube reste la propriété de ses ayants droit respectifs et est soumis aux
          Conditions d’utilisation de YouTube.
        </p>
        <p>
          Le contenu que vous créez dans Tutti (playlists, packs de quiz) reste votre propriété,
          mais vous nous accordez une licence limitée pour l’héberger et l’afficher dans la mesure
          nécessaire au fonctionnement du Service.
        </p>
      </LegalSection>

      <LegalSection title="6. Abonnements et paiements">
        <p>
          Certaines fonctionnalités peuvent nécessiter un abonnement payant. Les conditions de
          tarification et de facturation vous seront présentées avant l’achat. Le cas échéant, les
          conditions de paiement sont décrites au point de vente.
        </p>
      </LegalSection>

      <LegalSection title="7. Garanties et limitation de responsabilité">
        <p>
          Le Service est fourni «&nbsp;en l’état&nbsp;» et «&nbsp;tel que disponible&nbsp;», sans
          garantie d’aucune sorte, dans toute la mesure permise par la loi. Nous ne garantissons pas
          que le Service sera ininterrompu, exempt d’erreurs, ou qu’un contenu YouTube particulier
          restera disponible.
        </p>
        <p>
          Dans toute la mesure permise par la loi, Kleos Sàrl ne pourra être tenue responsable de
          tout dommage indirect, accessoire ou consécutif découlant de votre utilisation du Service.
        </p>
      </LegalSection>

      <LegalSection title="8. Résiliation">
        <p>
          Nous pouvons suspendre ou résilier votre accès au Service à tout moment si vous violez ces
          Conditions ou les Conditions d’utilisation de YouTube. Vous pouvez cesser d’utiliser le
          Service et demander la suppression de votre compte à tout moment (voir notre Politique de
          confidentialité).
        </p>
      </LegalSection>

      <LegalSection title="9. Modifications de ces Conditions">
        <p>
          Nous pouvons modifier ces Conditions de temps à autre. Nous mettrons à jour la date
          «&nbsp;Dernière mise à jour&nbsp;» et, le cas échéant, vous en informerons. Votre
          utilisation continue du Service après les modifications constitue votre acceptation des
          Conditions révisées.
        </p>
      </LegalSection>

      <LegalSection title="10. Droit applicable">
        <p>
          Ces Conditions sont régies par les lois du Grand-Duché de Luxembourg, sans égard aux
          principes de conflits de lois, et soumises à la compétence des tribunaux luxembourgeois
          compétents.
        </p>
      </LegalSection>

      <LegalSection title="11. Contact">
        <p>
          <strong>Kleos Sàrl</strong>
          <br />
          E-mail&nbsp;:{' '}
          <a href="mailto:contact@tuttiparty.app" className="text-spritz-deep hover:underline">
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
      lastUpdated="Last updated: 22 May 2026"
    >
      <p>
        These Terms of Service (“Terms”) govern your access to and use of <strong>Tutti</strong>, a
        blind test and quiz platform operated by <strong>Kleos Sàrl</strong> (“Kleos”, “we”, “us”,
        “our”), a company registered in Luxembourg (RCS Luxembourg B185164), accessible at{' '}
        <a href="https://tuttiparty.app" className="text-spritz-deep hover:underline">
          https://tuttiparty.app
        </a>{' '}
        (the “Service”).
      </p>
      <p>
        By creating an account or otherwise using the Service, you agree to be bound by these Terms.
        If you do not agree, do not use the Service.
      </p>

      <LegalSection title="1. Agreement to YouTube Terms of Service">
        <p>
          Tutti uses YouTube API Services, including the YouTube Data API v3 and the YouTube IFrame
          Player API.
        </p>
        <p>
          <strong>
            By using Tutti, you are agreeing to be bound by the YouTube Terms of Service, available
            at{' '}
            <a
              href="https://www.youtube.com/t/terms"
              className="text-spritz-deep hover:underline"
              target="_blank"
              rel="noreferrer noopener"
            >
              https://www.youtube.com/t/terms
            </a>
            .
          </strong>
        </p>
        <p>
          Your use of YouTube content and features through Tutti is also subject to the Google
          Privacy Policy, available at{' '}
          <a
            href="http://www.google.com/policies/privacy"
            className="text-spritz-deep hover:underline"
            target="_blank"
            rel="noreferrer noopener"
          >
            http://www.google.com/policies/privacy
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="2. Description of the Service">
        <p>
          Tutti allows hosts to create and run musical blind tests and multimedia quizzes. Hosts
          can:
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li>search for tracks using the YouTube Data API v3 and build playlists;</li>
          <li>
            launch live sessions in which YouTube videos are played through the official YouTube
            IFrame Player;
          </li>
          <li>
            invite players to join sessions via a QR code, without requiring players to create an
            account.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Accounts">
        <p>
          To host sessions, you must create an account with accurate information (first name, last
          name, email). You are responsible for maintaining the confidentiality of your credentials
          and for all activity under your account. You must be of the age of majority in your
          jurisdiction, or have the consent of a parent or legal guardian.
        </p>
      </LegalSection>

      <LegalSection title="4. Acceptable Use">
        <p>
          When using the Service, you agree <strong>not</strong> to:
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li>violate the YouTube Terms of Service or any applicable law;</li>
          <li>
            download, cache, copy, or store YouTube audio or video content outside the official
            YouTube IFrame Player;
          </li>
          <li>
            attempt to circumvent, disable, or interfere with YouTube’s advertising, monetisation,
            or any technical measures;
          </li>
          <li>use the Service to infringe the intellectual property rights of others;</li>
          <li>attempt to gain unauthorised access to the Service or its related systems;</li>
          <li>use the Service to transmit harmful, abusive, or unlawful content.</li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Content and Attribution">
        <p>
          Tutti displays YouTube content via the official YouTube IFrame Player and provides
          attribution (title, artist/channel, and a link back to the original YouTube video). All
          YouTube content remains the property of its respective rights holders and is subject to
          the YouTube Terms of Service.
        </p>
        <p>
          Content you create within Tutti (playlists, quiz packs) remains yours, but you grant us a
          limited licence to host and display it as necessary to operate the Service.
        </p>
      </LegalSection>

      <LegalSection title="6. Subscriptions and Payments">
        <p>
          Certain features may require a paid subscription. Pricing and billing terms will be
          presented to you before purchase. Where applicable, payment terms are described at the
          point of sale.
        </p>
      </LegalSection>

      <LegalSection title="7. Disclaimers and Limitation of Liability">
        <p>
          The Service is provided “as is” and “as available”, without warranties of any kind, to the
          maximum extent permitted by law. We do not guarantee that the Service will be
          uninterrupted, error-free, or that any particular YouTube content will remain available.
        </p>
        <p>
          To the maximum extent permitted by law, Kleos Sàrl shall not be liable for any indirect,
          incidental, or consequential damages arising from your use of the Service.
        </p>
      </LegalSection>

      <LegalSection title="8. Termination">
        <p>
          We may suspend or terminate your access to the Service at any time if you breach these
          Terms or the YouTube Terms of Service. You may stop using the Service and request deletion
          of your account at any time (see our Privacy Policy).
        </p>
      </LegalSection>

      <LegalSection title="9. Changes to These Terms">
        <p>
          We may modify these Terms from time to time. We will update the “Last updated” date and,
          where appropriate, notify you. Your continued use of the Service after changes become
          effective constitutes acceptance of the revised Terms.
        </p>
      </LegalSection>

      <LegalSection title="10. Governing Law">
        <p>
          These Terms are governed by the laws of the Grand Duchy of Luxembourg, without regard to
          conflict of law principles, and subject to the jurisdiction of the competent courts of
          Luxembourg.
        </p>
      </LegalSection>

      <LegalSection title="11. Contact">
        <p>
          <strong>Kleos Sàrl</strong>
          <br />
          Email:{' '}
          <a href="mailto:contact@tuttiparty.app" className="text-spritz-deep hover:underline">
            contact@tuttiparty.app
          </a>
          <br />
          Registered in Luxembourg — RCS Luxembourg B185164
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
