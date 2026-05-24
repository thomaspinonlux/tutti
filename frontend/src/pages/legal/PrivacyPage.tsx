/**
 * /privacy — Privacy Policy (FR + EN).
 *
 * feat/youtube-compliance — page publique requise par YouTube API Services
 * Developer Policies. Lien depuis footer + signup checkbox.
 *
 * Source de référence : version EN (Thomas — Kleos Sàrl). FR = traduction
 * fidèle. En cas de divergence, EN prime pour la conformité Google.
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

// ───── FR ─────────────────────────────────────────────────────────────────

function PrivacyFr(): JSX.Element {
  return (
    <LegalLayout
      title="Politique de confidentialité"
      subtitle="Comment Tutti collecte, utilise et protège vos données."
      lastUpdated="Dernière mise à jour : 22 mai 2026"
    >
      <p>
        La présente Politique de confidentialité explique comment <strong>Kleos Sàrl</strong>{' '}
        («&nbsp;Kleos&nbsp;», «&nbsp;nous&nbsp;»), société immatriculée au Luxembourg (RCS
        Luxembourg B185164), collecte, utilise, stocke, partage et protège vos informations lorsque
        vous utilisez <strong>Tutti</strong>, notre plateforme de blind test et de quiz, accessible
        sur{' '}
        <a href="https://tuttiparty.app" className="text-spritz-deep hover:underline">
          https://tuttiparty.app
        </a>{' '}
        et via notre API à api.tuttiparty.app (le «&nbsp;Service&nbsp;»).
      </p>
      <p>En utilisant le Service, vous acceptez les pratiques décrites dans cette Politique.</p>

      <LegalSection title="1. Utilisation des services API YouTube">
        <p>
          Tutti utilise les <strong>services API YouTube</strong>. Plus précisément&nbsp;:
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            l’<strong>API YouTube Data v3</strong> pour rechercher des vidéos et récupérer leurs
            métadonnées publiques (titre, chaîne, ID vidéo, miniature) afin que les hosts puissent
            créer des playlists&nbsp;;
          </li>
          <li>
            l’<strong>API YouTube IFrame Player</strong> pour lire les vidéos YouTube pendant les
            sessions live.
          </li>
        </ul>
        <p>
          En utilisant Tutti, vous acceptez également d’être lié par les{' '}
          <a
            href="https://www.youtube.com/t/terms"
            className="text-spritz-deep hover:underline"
            target="_blank"
            rel="noreferrer noopener"
          >
            Conditions d’utilisation de YouTube
          </a>
          .
        </p>
        <p>
          Cette Politique intègre et renvoie à la{' '}
          <a
            href="http://www.google.com/policies/privacy"
            className="text-spritz-deep hover:underline"
            target="_blank"
            rel="noreferrer noopener"
          >
            Politique de confidentialité de Google
          </a>
          . Votre utilisation des services Google et YouTube via Tutti est régie par la Politique de
          confidentialité de Google en plus de la présente Politique.
        </p>
      </LegalSection>

      <LegalSection title="2. Informations que nous collectons">
        <LegalSubSection title="2.1 Informations que vous fournissez">
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Informations de compte</strong>&nbsp;: prénom, nom, adresse e-mail et mot de
              passe (stocké sous forme hachée) lors de la création du compte.
            </li>
            <li>
              <strong>Informations de workspace</strong>&nbsp;: un workspace est créé
              automatiquement pour votre compte.
            </li>
            <li>
              <strong>Contenu que vous créez</strong>&nbsp;: playlists, packs de quiz, noms de
              sessions et autres contenus générés dans le Service.
            </li>
          </ul>
        </LegalSubSection>

        <LegalSubSection title="2.2 Informations collectées automatiquement">
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Données d’utilisation</strong>&nbsp;: sessions lancées (blind tests et quiz),
              playlists utilisées, nombre de joueurs, durée de session, dates et horaires
              d’activité.
            </li>
            <li>
              <strong>Réponses vocales</strong>&nbsp;: lorsqu’un joueur répond à la voix, l’audio
              est traité pour transcription (voir Section 4).
            </li>
            <li>
              <strong>Données techniques</strong>&nbsp;: type de navigateur, type d’appareil et
              informations techniques similaires nécessaires au fonctionnement du Service.
            </li>
          </ul>
        </LegalSubSection>

        <LegalSubSection title="2.3 Données API YouTube">
          <p>
            Lorsque vous recherchez et ajoutez des morceaux à une playlist, Tutti accède aux données
            publiques YouTube suivantes et les stocke&nbsp;:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              l’<strong>ID vidéo YouTube</strong>&nbsp;;
            </li>
            <li>
              les métadonnées publiques de base&nbsp;: titre vidéo, nom de la chaîne/artiste, URL de
              la miniature.
            </li>
          </ul>
          <p className="mt-2">
            <strong>
              Tutti ne télécharge, ne met en cache, ni ne stocke aucun contenu audio ou vidéo
              YouTube.
            </strong>{' '}
            Toute lecture se fait exclusivement via le YouTube IFrame Player officiel, en streaming
            direct depuis YouTube.
          </p>
        </LegalSubSection>

        <LegalSubSection title="2.4 Joueurs (invités)">
          <p>
            Les joueurs qui rejoignent une session via QR code le font{' '}
            <strong>sans créer de compte</strong>. Nous collectons uniquement le pseudo qu’ils
            choisissent ainsi que leurs réponses et scores pendant la durée de la session.
          </p>
        </LegalSubSection>
      </LegalSection>

      <LegalSection title="3. Comment nous utilisons vos informations">
        <p>Nous utilisons les informations ci-dessus pour&nbsp;:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>créer et gérer votre compte et votre workspace&nbsp;;</li>
          <li>fournir, exploiter et maintenir le Service&nbsp;;</li>
          <li>
            permettre la création de playlists via l’API YouTube Data et la lecture via le YouTube
            IFrame Player&nbsp;;
          </li>
          <li>transcrire et évaluer les réponses vocales pendant les sessions&nbsp;;</li>
          <li>
            envoyer des e-mails transactionnels et de notification (par exemple, confirmations
            d’inscription)&nbsp;;
          </li>
          <li>surveiller l’utilisation, prévenir les abus et améliorer le Service&nbsp;;</li>
          <li>nous conformer aux obligations légales.</li>
        </ul>
        <p>
          Nous <strong>ne vendons pas</strong> vos informations personnelles.
        </p>
      </LegalSection>

      <LegalSection title="4. Comment nous traitons et partageons vos informations">
        <p>
          Nous partageons les informations uniquement comme nécessaire au fonctionnement du Service,
          avec les catégories de sous-traitants suivantes&nbsp;:
        </p>
        <LegalTable
          headers={['Prestataire', 'Finalité', 'Localisation']}
          rows={[
            [
              'Supabase',
              'Hébergement base de données (comptes, playlists, sessions)',
              'Union européenne',
            ],
            ['Vercel', 'Hébergement frontend', 'Francfort, UE'],
            ['Railway', 'Hébergement backend / API', 'UE'],
            [
              'Google / YouTube',
              'Recherche et lecture vidéo (services API YouTube)',
              'Infrastructure Google',
            ],
            [
              'OpenAI (Whisper), Deepgram, AssemblyAI',
              'Transcription vocale des réponses joueurs',
              'Voir prestataires',
            ],
            ['Resend', 'E-mails transactionnels et de notification', 'Voir prestataire'],
          ]}
        />
        <p>
          Chacun de ces prestataires traite les données pour notre compte et est soumis à ses
          propres obligations en matière de protection des données. Nous partageons les informations
          avec ces prestataires uniquement dans la mesure nécessaire à la fourniture du Service.
        </p>
        <p>
          Nous pouvons également divulguer des informations si la loi, un règlement, une procédure
          légale ou une demande gouvernementale l’exige.
        </p>
        <p>
          Les données API YouTube sont traitées conformément aux Conditions d’utilisation des
          services API YouTube et à la Politique de confidentialité de Google.
        </p>
      </LegalSection>

      <LegalSection title="5. Cookies et stockage local">
        <p>
          Tutti stocke, accède et collecte des informations directement ou indirectement sur ou
          depuis votre appareil, notamment en plaçant, accédant ou reconnaissant des cookies, du
          stockage local, des jetons de session ou technologies similaires. Nous utilisons ces
          technologies pour&nbsp;:
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li>vous maintenir connecté (jetons d’authentification)&nbsp;;</li>
          <li>mémoriser vos préférences&nbsp;;</li>
          <li>faire fonctionner le Service en toute sécurité.</li>
        </ul>
        <p>
          Le YouTube IFrame Player peut également placer des cookies sur votre appareil, régis par
          la Politique de confidentialité de Google.
        </p>
      </LegalSection>

      <LegalSection title="6. Conservation des données et rafraîchissement des données API YouTube">
        <p>
          Nous conservons vos informations de compte aussi longtemps que votre compte est actif.
        </p>
        <p>
          Conformément aux YouTube API Services Developer Policies, les{' '}
          <strong>
            données API YouTube stockées (telles que les métadonnées vidéo) sont rafraîchies ou
            supprimées au moins tous les 30 jours.
          </strong>{' '}
          Les métadonnées stockées qui ne sont plus nécessaires, ou qui ne peuvent plus être
          rafraîchies depuis l’API YouTube Data, sont supprimées.
        </p>
        <p>
          Vous pouvez demander la suppression de votre compte et des données associées à tout moment
          (voir Section 7).
        </p>
      </LegalSection>

      <LegalSection title="7. Vos choix : suppression et révocation d’accès">
        <LegalSubSection title="7.1 Supprimer vos données">
          <p>
            Vous pouvez demander la suppression de vos données stockées, y compris votre compte et
            toute Donnée API associée, en nous contactant à l’adresse indiquée en Section 9. Après
            vérification de la demande, nous supprimerons vos données personnelles stockées et les
            Données API YouTube associées, sauf si la conservation est requise par la loi.
          </p>
        </LegalSubSection>
        <LegalSubSection title="7.2 Révoquer l’accès Google / YouTube">
          <p>
            Si vous avez connecté votre compte Google ou YouTube à Tutti, vous pouvez révoquer
            l’accès de Tutti à vos données à tout moment via la page des paramètres de sécurité
            Google&nbsp;:{' '}
            <a
              href="https://myaccount.google.com/connections?filters=3,4&hl=fr"
              className="text-spritz-deep hover:underline"
              target="_blank"
              rel="noreferrer noopener"
            >
              https://myaccount.google.com/connections
            </a>
          </p>
          <p>La révocation empêchera Tutti d’accéder à vos données Google/YouTube autorisées.</p>
        </LegalSubSection>
      </LegalSection>

      <LegalSection title="8. Sécurité des données">
        <p>
          Nous mettons en œuvre des mesures techniques et organisationnelles raisonnables pour
          protéger vos informations contre tout accès non autorisé, perte ou mauvaise utilisation.
          Cependant, aucune méthode de transmission ou de stockage n’est totalement sûre, et nous ne
          pouvons garantir une sécurité absolue.
        </p>
      </LegalSection>

      <LegalSection title="9. Contact">
        <p>
          Pour toute question concernant cette Politique, ou pour exercer vos droits (y compris la
          suppression des données), contactez-nous&nbsp;:
        </p>
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

      <LegalSection title="10. Modifications de cette Politique">
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
      lastUpdated="Last updated: 22 May 2026"
    >
      <p>
        This Privacy Policy explains how <strong>Kleos Sàrl</strong> (“Kleos”, “we”, “us”, “our”), a
        company registered in Luxembourg (RCS Luxembourg B185164), collects, uses, stores, shares
        and protects your information when you use <strong>Tutti</strong>, our blind test and quiz
        platform, accessible at{' '}
        <a href="https://tuttiparty.app" className="text-spritz-deep hover:underline">
          https://tuttiparty.app
        </a>{' '}
        and through our API at api.tuttiparty.app (collectively, the “Service”).
      </p>
      <p>By using the Service, you agree to the practices described in this Privacy Policy.</p>

      <LegalSection title="1. Use of YouTube API Services">
        <p>
          Tutti uses <strong>YouTube API Services</strong>. Specifically, Tutti uses:
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            the <strong>YouTube Data API v3</strong> to search for videos and retrieve their public
            metadata (title, channel name, video ID, thumbnail), so that hosts can build music
            playlists; and
          </li>
          <li>
            the <strong>YouTube IFrame Player API</strong> to play YouTube videos during live blind
            test sessions.
          </li>
        </ul>
        <p>
          By using Tutti, you are also agreeing to be bound by the{' '}
          <a
            href="https://www.youtube.com/t/terms"
            className="text-spritz-deep hover:underline"
            target="_blank"
            rel="noreferrer noopener"
          >
            YouTube Terms of Service
          </a>
          .
        </p>
        <p>
          This Privacy Policy incorporates and refers to the{' '}
          <a
            href="http://www.google.com/policies/privacy"
            className="text-spritz-deep hover:underline"
            target="_blank"
            rel="noreferrer noopener"
          >
            Google Privacy Policy
          </a>
          . Your use of Google and YouTube services through Tutti is governed by the Google Privacy
          Policy in addition to this Privacy Policy.
        </p>
      </LegalSection>

      <LegalSection title="2. Information We Collect">
        <LegalSubSection title="2.1 Information you provide">
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Account information</strong>: first name, last name, email address, and
              password (stored in hashed form) when you create an account.
            </li>
            <li>
              <strong>Workspace information</strong>: a workspace is automatically created for your
              account.
            </li>
            <li>
              <strong>Content you create</strong>: playlists, quiz packs, session names, and other
              content you generate within the Service.
            </li>
          </ul>
        </LegalSubSection>

        <LegalSubSection title="2.2 Information collected automatically">
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Usage data</strong>: sessions you launch (blind tests and quizzes), playlists
              used, number of players, session duration, dates and times of activity.
            </li>
            <li>
              <strong>Voice responses</strong>: when a player answers using voice input, the audio
              is processed for transcription (see Section 4).
            </li>
            <li>
              <strong>Technical data</strong>: browser type, device type, and similar technical
              information necessary to operate the Service.
            </li>
          </ul>
        </LegalSubSection>

        <LegalSubSection title="2.3 YouTube API Data">
          <p>
            When you search for and add tracks to a playlist, Tutti accesses and stores the
            following public YouTube data:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              the <strong>YouTube video ID</strong>;
            </li>
            <li>basic public metadata: video title, channel/artist name, and thumbnail URL.</li>
          </ul>
          <p className="mt-2">
            <strong>
              Tutti does not download, cache, or store any YouTube audio or video content.
            </strong>{' '}
            All playback occurs exclusively through the official YouTube IFrame Player, streamed
            directly from YouTube.
          </p>
        </LegalSubSection>

        <LegalSubSection title="2.4 Players (guests)">
          <p>
            Players who join a session by scanning a QR code do so{' '}
            <strong>without creating an account</strong>. We collect only the nickname they choose
            and their in-session answers and scores for the duration of the session.
          </p>
        </LegalSubSection>
      </LegalSection>

      <LegalSection title="3. How We Use Your Information">
        <p>We use the information described above to:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>create and manage your account and workspace;</li>
          <li>provide, operate, and maintain the Service;</li>
          <li>
            enable playlist creation via the YouTube Data API and playback via the YouTube IFrame
            Player;
          </li>
          <li>transcribe and evaluate voice answers during sessions;</li>
          <li>send transactional and notification emails (for example, signup confirmations);</li>
          <li>monitor usage, prevent abuse, and improve the Service;</li>
          <li>comply with legal obligations.</li>
        </ul>
        <p>
          We do <strong>not</strong> sell your personal information.
        </p>
      </LegalSection>

      <LegalSection title="4. How We Process and Share Your Information">
        <p>
          We share information only as necessary to operate the Service, with the following
          categories of third-party processors:
        </p>
        <LegalTable
          headers={['Provider', 'Purpose', 'Location']}
          rows={[
            ['Supabase', 'Database hosting (account data, playlists, sessions)', 'European Union'],
            ['Vercel', 'Frontend hosting', 'Frankfurt, EU'],
            ['Railway', 'Backend / API hosting', 'EU'],
            [
              'Google / YouTube',
              'Video search and playback (YouTube API Services)',
              'Google infrastructure',
            ],
            [
              'OpenAI (Whisper), Deepgram, AssemblyAI',
              'Voice transcription of player answers',
              'See respective providers',
            ],
            ['Resend', 'Transactional and notification emails', 'See provider'],
          ]}
        />
        <p>
          Each of these providers processes data on our behalf and is bound by their own data
          protection obligations. We share information with these providers only to the extent
          necessary to deliver the Service.
        </p>
        <p>
          We may also disclose information if required by law, regulation, legal process, or
          governmental request.
        </p>
        <p>
          YouTube API Data is handled in accordance with the YouTube API Services Terms of Service
          and the Google Privacy Policy.
        </p>
      </LegalSection>

      <LegalSection title="5. Cookies and Local Storage">
        <p>
          Tutti stores, accesses, and collects information directly or indirectly on or from your
          device, including by placing, accessing, or recognising cookies, local storage, session
          tokens, or similar technologies on your device or browser. We use these technologies to:
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li>keep you signed in (authentication tokens);</li>
          <li>remember your preferences;</li>
          <li>operate the Service securely.</li>
        </ul>
        <p>
          The YouTube IFrame Player may also set cookies on your device, governed by the Google
          Privacy Policy.
        </p>
      </LegalSection>

      <LegalSection title="6. Data Retention and Refresh of YouTube API Data">
        <p>We retain your account information for as long as your account is active.</p>
        <p>
          In accordance with the YouTube API Services Developer Policies,{' '}
          <strong>
            stored YouTube API Data (such as video metadata) is refreshed or deleted at least every
            30 days.
          </strong>{' '}
          Stored metadata that is no longer needed, or that can no longer be refreshed from the
          YouTube Data API, is deleted.
        </p>
        <p>
          You may request deletion of your account and associated data at any time (see Section 7).
        </p>
      </LegalSection>

      <LegalSection title="7. Your Choices: Deleting Data and Revoking Access">
        <LegalSubSection title="7.1 Deleting your data">
          <p>
            You can request the deletion of your stored data, including your account and any
            associated API Data, by contacting us at the address in Section 9. Upon a verified
            request, we will delete your stored personal data and associated YouTube API Data,
            except where retention is required by law.
          </p>
        </LegalSubSection>
        <LegalSubSection title="7.2 Revoking Google / YouTube access">
          <p>
            If you connected your Google or YouTube account to Tutti, you can revoke Tutti’s access
            to your data at any time via the Google security settings page:{' '}
            <a
              href="https://myaccount.google.com/connections?filters=3,4&hl=en"
              className="text-spritz-deep hover:underline"
              target="_blank"
              rel="noreferrer noopener"
            >
              https://myaccount.google.com/connections
            </a>
          </p>
          <p>Revoking access will stop Tutti from accessing your authorised Google/YouTube data.</p>
        </LegalSubSection>
      </LegalSection>

      <LegalSection title="8. Data Security">
        <p>
          We implement reasonable technical and organisational measures to protect your information
          against unauthorised access, loss, or misuse. However, no method of transmission or
          storage is completely secure, and we cannot guarantee absolute security.
        </p>
      </LegalSection>

      <LegalSection title="9. Contact Information">
        <p>
          If you have any questions about this Privacy Policy, or wish to exercise your rights
          (including data deletion), please contact us:
        </p>
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

      <LegalSection title="10. Changes to This Privacy Policy">
        <p>
          We may update this Privacy Policy from time to time. We will update the “Last updated”
          date at the top of this page and, where appropriate, notify you. Your continued use of the
          Service after changes become effective constitutes acceptance of the revised Privacy
          Policy.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
