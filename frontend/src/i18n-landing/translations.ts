/**
 * Tutti — Landing v2 traductions
 *
 * Système maison léger (Context + ce fichier) — séparé du i18next existant
 * pour ne pas polluer locales/fr.json admin/host/play. Switch via ?lang=fr|en
 * + localStorage persistant.
 */

export type LandingLang = 'fr' | 'en';

export interface LandingTranslations {
  nav: {
    products: string;
    howItWorks: string;
    pricing: string;
    faq: string;
    signin: string;
    home: string;
  };
  hero: {
    betaBadge: string;
    titleStart: string;
    titleEm: string;
    titleEnd: string;
    sub: string; // contient {strong1}, {strong2} via placeholders
    ctaPrimary: string;
    ctaSecondary: string;
    metaSpotify: string;
    metaLanguages: string;
    metaPrice: string;
    videoSticker: string;
    videoLabel: string;
  };
  products: {
    eyebrow: string;
    titleStart: string;
    titleEm: string;
    titleEnd: string;
    intro: string;
    tracks: {
      tag: string;
      nameStart: string;
      nameEm: string;
      desc: string;
      features: string[];
      cta: string;
    };
    quizz: {
      tag: string;
      nameStart: string;
      nameEm: string;
      desc: string;
      features: string[];
      cta: string;
    };
  };
  how: {
    eyebrow: string;
    titleStart: string;
    titleEm: string;
    titleEnd: string;
    intro: string;
    steps: Array<{ num: string; icon: string; title: string; desc: string }>;
  };
  features: {
    eyebrow: string;
    titleStart: string;
    titleEm: string;
    titleEnd: string;
    items: Array<{ tag: string; title: string; desc: string }>;
  };
  pricing: {
    eyebrow: string;
    titleStart: string;
    titleEm: string;
    titleEnd: string;
    intro: string;
    bestDeal: string;
    /** feat/offre-de-lancement — bandeau de la remise, au-dessus des colonnes. */
    offer?: { badge: string; text: string };
    columns: Array<{
      name: string;
      tag: string;
      highlighted?: boolean;
      /** `before` = prix plein, barré à l'écran. */
      rows: Array<{ label: string; amount: string; before?: string }>;
    }>;
    note: string;
  };
  useCases: {
    eyebrow: string;
    titleStart: string;
    titleEm: string;
    titleEnd: string;
    intro: string;
    tags: string[];
  };
  faq: {
    eyebrow: string;
    title: string;
    items: Array<{ q: string; a: string }>;
  };
  cta: {
    titleStart: string;
    titleEm: string;
    titleEnd: string;
    sub: string;
    button: string;
  };
  footer: {
    tagline: string;
    cols: {
      tutti: { title: string; links: Array<{ label: string; href: string }> };
      legal: { title: string; links: Array<{ label: string; href: string }> };
      contact: { title: string };
    };
    copyright: string;
    built: string;
  };
}

export const translations: Record<LandingLang, LandingTranslations> = {
  fr: {
    nav: {
      products: 'Produits',
      howItWorks: 'Comment ça marche',
      pricing: 'Tarifs',
      faq: 'FAQ',
      signin: 'Se connecter',
      home: 'Tutti — Accueil',
    },
    hero: {
      betaBadge: 'En phase beta — accès sur invitation',
      titleStart: 'Le blind test & quiz ',
      titleEm: 'premium',
      titleEnd: ' pour vos soirées.',
      sub: "Tutti rassemble deux jeux taillés pour vos soirées privées : <strong>Tutti Tracks</strong>, le blind test musical via Spotify et YouTube, et <strong>Tutti Quizz</strong>, le quiz multimédia multi-formats. Tes amis scannent un QR code, et c'est parti. Sans installation, sans création de compte côté joueurs.",
      ctaPrimary: 'Démarrer une partie',
      ctaSecondary: 'Voir comment ça marche',
      metaSpotify: '<strong>Spotify + YouTube</strong> intégrés',
      metaLanguages: '<strong>FR / EN / IT / ES</strong>',
      metaPrice: 'À partir de <strong>2,50 €</strong> de l’heure',
      videoSticker: '2 min de démo',
      videoLabel: 'Démonstration de Tutti',
    },
    products: {
      eyebrow: 'Deux produits, une plateforme',
      titleStart: "Tutti, c'est ",
      titleEm: 'deux jeux',
      titleEnd: ' pour vos soirées.',
      intro:
        'Chaque produit a sa propre signature, ses formules et sa bibliothèque de contenu officielle. Tu peux jouer à un seul, ou combiner les deux dans la même soirée avec le pack All-Access.',
      tracks: {
        tag: '♪ Blind test musical',
        nameStart: 'Tutti ',
        nameEm: 'Tracks',
        desc: 'Le blind test premium qui transforme ton salon en plateau de jeu. Buzz, chante, tape la réponse — Tutti Tracks comprend la voix grâce à Whisper, et tolère les fautes et les accents.',
        features: [
          'Spotify Premium et YouTube intégrés',
          'Réponse à la voix ou par texte',
          'Bibliothèque officielle de playlists thématiques',
          'Crée tes propres listes en cherchant sur Spotify ou YouTube',
          'Importe tes playlists Spotify existantes',
          'Scoring temps réel, podium, ajustement manuel',
        ],
        cta: 'Lancer un blind test →',
      },
      quizz: {
        tag: '? Quiz multimédia',
        nameStart: 'Tutti ',
        nameEm: 'Quizz',
        desc: 'Le quiz multi-formats pensé pour animer une soirée entière. QCM, vrai/faux, réponse libre, estimation — chaque format change le rythme du jeu et fait monter la tension.',
        features: [
          '4 formats de questions (QCM, vrai/faux, réponse libre, estimation)',
          'Bibliothèque officielle multilingue (cinéma, géo, culture, etc.)',
          'Crée tes propres quiz en quelques minutes',
          'Partage tes quiz publiquement ou en privé',
          'Scoring temps réel, podium animé',
          'Idéal pour pendaison de crémaillère, EVJF, anniversaires',
        ],
        cta: 'Lancer un quiz →',
      },
    },
    how: {
      eyebrow: 'Comment ça marche',
      titleStart: 'Trois étapes, ',
      titleEm: 'zéro friction',
      titleEnd: '.',
      intro: 'Que tu choisisses Tutti Tracks ou Tutti Quizz, le déroulé est le même.',
      steps: [
        {
          num: '01',
          icon: '🎧',
          title: 'Choisis ta partie',
          desc: 'Sélectionne un blind test ou un quiz. Pioche dans la bibliothèque officielle Tutti, importe une de tes playlists Spotify, ou crée ta propre liste de morceaux et tes propres questions.',
        },
        {
          num: '02',
          icon: '📱',
          title: 'Tes amis scannent',
          desc: "Affiche le QR code à l'écran TV. Les joueurs scannent avec leur téléphone — pas d'app à installer, pas de compte à créer. Ils choisissent un pseudo, et c'est parti.",
        },
        {
          num: '03',
          icon: '🎤',
          title: 'Vous jouez',
          desc: 'Première note, premier buzz. Réponse à la voix ou par texte. Score en temps réel, podium animé, soirée mémorable.',
        },
      ],
    },
    features: {
      eyebrow: 'Fonctionnalités',
      titleStart: 'Pensé pour ',
      titleEm: 'animer',
      titleEnd: ', pas pour configurer.',
      items: [
        {
          tag: 'Multi-source',
          title: 'Spotify + YouTube',
          desc: 'Combine les deux dans la même partie de Tutti Tracks. La musique est lue depuis ton propre compte authentifié. Aucun fichier audio stocké ni redistribué par Tutti.',
        },
        {
          tag: 'Reconnaissance vocale',
          title: 'Whisper intégré',
          desc: "Buzz, dis l'artiste et le titre — Tutti comprend, même avec ton accent ou tes hésitations. Les enregistrements vocaux ne sont jamais conservés.",
        },
        {
          tag: 'Bibliothèque officielle',
          title: 'Du contenu prêt à jouer',
          desc: "Playlists thématiques par décennie ou genre, packs de quiz par sujet et par langue. Le tout sélectionné à la main par l'équipe Tutti.",
        },
        {
          tag: 'Création custom',
          title: 'Tes listes, tes questions',
          desc: 'Crée tes propres playlists de blind test en cherchant directement sur Spotify ou YouTube. Rédige tes propres quiz en QCM, vrai/faux, réponse libre ou estimation.',
        },
        {
          tag: 'Sans friction',
          title: "Pas d'app pour les joueurs",
          desc: "Tes invités scannent un QR code et jouent depuis leur navigateur. Pas d'inscription, pas de téléchargement, aucune barrière à l'entrée.",
        },
        {
          tag: 'International',
          title: '4 langues prises en charge',
          desc: 'Interface en français, anglais, italien et espagnol. Chaque langue a sa propre bibliothèque de contenu officiel adaptée.',
        },
      ],
    },
    pricing: {
      eyebrow: 'Tarifs',
      titleStart: 'Tu paies ',
      titleEm: 'la session',
      titleEnd: ", pas l'abonnement.",
      intro:
        "Pas d'engagement, pas de mensualité. Tu choisis le produit et la durée qui collent à ta soirée. Si la fête s'étend, tu peux étendre la session à tout moment.",
      bestDeal: 'Clé en main',
      offer: {
        badge: 'Offre de lancement · −50 %',
        text: 'Jusqu’au 31 octobre 2026, toutes les heures sont à moitié prix. Les montants barrés sont les tarifs normaux.',
      },
      columns: [
        {
          name: 'Ton compte Apple Music',
          tag: 'Tu joues avec ton abonnement',
          rows: [
            { label: 'L’heure, en semaine', before: '5,00', amount: '2,50' },
            { label: 'L’heure, vendredi & samedi soir', before: '9,00', amount: '4,50' },
            { label: 'Soirée de 3 h (20 h → 23 h)', before: '27,00', amount: '13,50' },
          ],
        },
        {
          name: 'Compte fourni par Tutti',
          tag: 'Rien à installer, on s’occupe de la musique',
          highlighted: true,
          rows: [
            { label: 'L’heure, en semaine', before: '8,00', amount: '4,00' },
            { label: 'L’heure, vendredi & samedi soir', before: '15,00', amount: '7,50' },
            { label: 'Soirée de 3 h (20 h → 23 h)', before: '45,00', amount: '22,50' },
          ],
        },
      ],
      note: "Prix TTC, au prorata des minutes : tu ne paies que le temps réservé. Paiement sécurisé via Stripe. <strong>Offre de lancement : −50 % sur toutes les heures jusqu'au 31 octobre 2026.</strong> Tarif soirée le vendredi et le samedi à partir de 18 h. Tu réserves ton créneau depuis ton compte, tu paies, tu joues.",
    },
    useCases: {
      eyebrow: 'Pour qui',
      titleStart: "Tutti s'invite à ",
      titleEm: 'toutes',
      titleEnd: ' tes soirées.',
      intro:
        "Quelques cas d'usage qu'on voit régulièrement. La liste n'est pas fermée — Tutti s'adapte à tous les formats de soirée privée.",
      tags: [
        '🎂 Anniversaires',
        '💍 EVJF / EVG',
        '🎉 Soirées entre amis',
        '🏡 Pendaison de crémaillère',
        '👰 Mariages',
        '🎄 Fêtes de fin d’année',
        '🏖️ Vacances entre potes',
        "🏢 Événements d'entreprise",
        '🍷 Apéro dînatoire',
        '🎓 Soirées étudiantes',
      ],
    },
    faq: {
      eyebrow: 'Questions fréquentes',
      title: 'Tout ce que tu te demandes.',
      items: [
        {
          q: "Qu'est-ce que Tutti ?",
          a: "Tutti est une plateforme premium éditée depuis le Luxembourg par Kleos Sàrl. Elle propose deux produits pour vos soirées privées : <strong>Tutti Tracks</strong> (blind test musical avec Spotify et YouTube) et <strong>Tutti Quizz</strong> (quiz multimédia multi-formats). Les joueurs rejoignent la partie en scannant un QR code, sans installer d'application ni créer de compte.",
        },
        {
          q: 'Faut-il un compte Spotify Premium ?',
          a: "Pour utiliser Spotify comme source de musique sur Tutti Tracks, oui — l'animateur (la personne qui pilote la soirée) doit avoir un compte Spotify Premium. La musique est lue directement depuis son compte authentifié via le SDK officiel de Spotify. <strong>Tutti ne stocke ni ne redistribue aucun fichier audio.</strong> Si l'animateur n'a pas Spotify Premium, YouTube est une alternative gratuite. Les joueurs n'ont besoin d'aucun compte.",
        },
        {
          q: 'Mes invités doivent-ils créer un compte ou installer une application ?',
          a: "Non. Les joueurs scannent simplement le QR code affiché à l'écran TV avec leur téléphone. Ils choisissent un pseudo et c'est parti. Aucune installation, aucun compte, aucune donnée personnelle exigée.",
        },
        {
          q: 'Comment fonctionne la reconnaissance vocale ?',
          a: 'Quand un joueur buzze sur Tutti Tracks, son téléphone enregistre quelques secondes de voix. Cet audio est transmis à Whisper (OpenAI) pour transcription, puis <strong>immédiatement supprimé</strong>. Tutti ne conserve aucun enregistrement vocal. La reconnaissance accepte les fautes mineures, les accents et les variantes orthographiques.',
        },
        {
          q: 'Quelles sont les sources de contenu pour Tutti Tracks et Tutti Quizz ?',
          a: '<strong>Pour Tutti Tracks :</strong> tu peux jouer avec la bibliothèque officielle Tutti (playlists thématiques par catégorie, décennie ou langue), créer ta propre liste en cherchant directement sur Spotify et YouTube depuis l’app, ou importer une de tes playlists Spotify existantes. <strong>Pour Tutti Quizz :</strong> tu as accès à la bibliothèque officielle (packs multilingues prêts à jouer) et tu peux créer tes propres quiz en mélangeant QCM, vrai/faux, réponse libre et estimation.',
        },
        {
          q: 'Combien de joueurs peuvent participer ?',
          a: "Tutti est conçu pour fluidifier les sessions de 2 à 30 joueurs simultanés. Au-delà, l'expérience reste fonctionnelle mais le format perd un peu de son rythme — on recommande alors de jouer en équipes.",
        },
        {
          q: 'Quelles langues sont supportées ?',
          a: "L'interface de Tutti est disponible en <strong>français, anglais, italien et espagnol</strong>. Chaque langue dispose de sa propre bibliothèque de contenu officiel adaptée. Tu peux changer la langue à tout moment, même au milieu d'une partie.",
        },
        {
          q: 'Est-ce que la musique a de la pub ?',
          a: "Avec Spotify Premium, jamais. Avec YouTube, ça dépend du compte de l'animateur — si vous avez YouTube Premium, pas de pub. Sinon, on essaie de minimiser l'impact en ne lisant qu'un extrait court de chaque morceau.",
        },
        {
          q: 'Comment se passe le paiement ?',
          a: "Tu réserves un créneau depuis ton compte et tu paies par carte via Stripe. Le prix se calcule à l'heure, au prorata des minutes, avec un tarif majoré le vendredi et le samedi à partir de 18 h. Pas d'abonnement, pas de prélèvement automatique. <strong>Offre de lancement : −50 % sur toutes les heures jusqu'au 31 octobre 2026.</strong> Si tu joues avec ton propre abonnement Apple Music, le tarif est encore plus bas.",
        },
        {
          q: "Qu'arrive-t-il à mes données personnelles ?",
          a: 'Tutti respecte le RGPD. Nous collectons uniquement le strict minimum (email, pseudo, playlists, scores). Les enregistrements vocaux ne sont jamais conservés. Tu peux exporter ou supprimer ton compte à tout moment. Tutti est édité par <strong>Kleos Sàrl</strong>, société luxembourgeoise (Union européenne). Voir notre <a class="landing-faq-link" href="/privacy">politique de confidentialité</a> pour le détail.',
        },
        {
          q: 'Puis-je utiliser Tutti dans un cadre commercial ?',
          a: 'Tutti est destiné à un usage privé entre amis ou en famille. Une utilisation publique ou commerciale (bar, événement payant, restaurant) nécessite des licences musicales spécifiques (SACEM ou équivalent local) que tu dois obtenir indépendamment. Contacte-nous à <a class="landing-faq-link" href="mailto:contact@tuttiparty.app">contact@tuttiparty.app</a> pour discuter d’un usage professionnel.',
        },
      ],
    },
    cta: {
      titleStart: 'Prêt à mettre tes amis ',
      titleEm: 'au défi',
      titleEnd: ' ?',
      sub: 'Demande ton accès beta et lance ta première soirée Tutti dans la semaine.',
      button: 'Demander un accès',
    },
    footer: {
      tagline:
        'Le blind test musical et le quiz multimédia premium pour vos soirées privées. Édité avec ❤ depuis le Luxembourg par Kleos Sàrl.',
      cols: {
        tutti: {
          title: 'Tutti',
          links: [
            { label: 'Produits', href: '#products' },
            { label: 'Comment ça marche', href: '#how' },
            { label: 'Fonctionnalités', href: '#features' },
            { label: 'Tarifs', href: '#pricing' },
            { label: 'FAQ', href: '#faq' },
          ],
        },
        legal: {
          title: 'Légal',
          links: [
            { label: 'Confidentialité', href: '/privacy' },
            { label: 'CGU', href: '/terms' },
            { label: 'Mentions légales', href: '/legal' },
          ],
        },
        contact: { title: 'Contact' },
      },
      copyright: '© 2026 Kleos Sàrl. Tous droits réservés.',
      built: 'BUILT IN LUXEMBOURG · MADE FOR THE WORLD',
    },
  },
  en: {
    nav: {
      products: 'Products',
      howItWorks: 'How it works',
      pricing: 'Pricing',
      faq: 'FAQ',
      signin: 'Sign in',
      home: 'Tutti — Home',
    },
    hero: {
      betaBadge: 'Currently in beta — invite-only access',
      titleStart: 'The ',
      titleEm: 'premium',
      titleEnd: ' blind test & quiz for your parties.',
      sub: "Tutti brings together two games built for your private parties: <strong>Tutti Tracks</strong>, the music blind test via Spotify and YouTube, and <strong>Tutti Quizz</strong>, the multimedia quiz in multiple formats. Your friends scan a QR code, and you're off. No install, no account needed for players.",
      ctaPrimary: 'Start a game',
      ctaSecondary: 'See how it works',
      metaSpotify: '<strong>Spotify + YouTube</strong> built-in',
      metaLanguages: '<strong>EN / FR / IT / ES</strong>',
      metaPrice: 'From <strong>€2.50</strong> per hour',
      videoSticker: '2-min demo',
      videoLabel: 'Tutti demo',
    },
    products: {
      eyebrow: 'Two products, one platform',
      titleStart: 'Tutti is ',
      titleEm: 'two games',
      titleEnd: ' for your parties.',
      intro:
        'Each product has its own signature, pricing and official content library. Play just one, or combine both in the same evening with the All-Access pack.',
      tracks: {
        tag: '♪ Music blind test',
        nameStart: 'Tutti ',
        nameEm: 'Tracks',
        desc: 'The premium music blind test that turns any living room into a game show. Buzz, sing, type the answer — Tutti Tracks understands voice via Whisper and forgives typos and accents.',
        features: [
          'Spotify Premium and YouTube built-in',
          'Voice or text answers',
          'Official library of themed playlists',
          'Build your own lists by searching Spotify or YouTube directly',
          'Import your existing Spotify playlists',
          'Real-time scoring, podium, manual host adjustments',
        ],
        cta: 'Start a blind test →',
      },
      quizz: {
        tag: '? Multimedia quiz',
        nameStart: 'Tutti ',
        nameEm: 'Quizz',
        desc: 'The multi-format quiz built to power a whole evening. Multiple choice, true/false, free answer, estimation — each format changes the rhythm and raises the tension.',
        features: [
          '4 question formats (MCQ, true/false, free answer, estimation)',
          'Official multilingual library (cinema, geography, culture, etc.)',
          'Build your own quiz in minutes',
          'Share your quiz publicly or privately',
          'Real-time scoring, animated podium',
          'Ideal for housewarmings, bachelor parties, birthdays',
        ],
        cta: 'Start a quiz →',
      },
    },
    how: {
      eyebrow: 'How it works',
      titleStart: 'Three steps, ',
      titleEm: 'zero friction',
      titleEnd: '.',
      intro: 'Whether you pick Tutti Tracks or Tutti Quizz, the flow is the same.',
      steps: [
        {
          num: '01',
          icon: '🎧',
          title: 'Pick your game',
          desc: 'Pick a blind test or a quiz. Choose from the official Tutti library, import one of your Spotify playlists, or build your own track list and questions.',
        },
        {
          num: '02',
          icon: '📱',
          title: 'Friends scan in',
          desc: "Show the QR code on the TV. Players scan with their phone — no app to install, no account to create. They pick a nickname and they're in.",
        },
        {
          num: '03',
          icon: '🎤',
          title: 'You play',
          desc: 'First note, first buzz. Answer by voice or by typing. Real-time scoring, animated podium, unforgettable night.',
        },
      ],
    },
    features: {
      eyebrow: 'Features',
      titleStart: 'Built to ',
      titleEm: 'host',
      titleEnd: ', not to configure.',
      items: [
        {
          tag: 'Multi-source',
          title: 'Spotify + YouTube',
          desc: 'Mix both in a single Tutti Tracks game. Music plays from your own authenticated account. No audio files stored or redistributed by Tutti.',
        },
        {
          tag: 'Voice recognition',
          title: 'Whisper built-in',
          desc: 'Buzz, speak the artist and song title — Tutti understands, even with your accent or hesitations. Voice recordings are never stored.',
        },
        {
          tag: 'Official library',
          title: 'Content ready to play',
          desc: 'Themed playlists by decade or genre, quiz packs by topic and language. All hand-picked by the Tutti team.',
        },
        {
          tag: 'Custom creation',
          title: 'Your lists, your questions',
          desc: 'Build your own blind test lists by searching Spotify or YouTube directly. Write your own quiz in MCQ, true/false, free answer or estimation.',
        },
        {
          tag: 'Frictionless',
          title: 'No app for players',
          desc: 'Your guests scan a QR code and play from their browser. No signup, no download, no friction.',
        },
        {
          tag: 'International',
          title: '4 languages supported',
          desc: 'Interface in English, French, Italian and Spanish. Each language has its own adapted official content library.',
        },
      ],
    },
    pricing: {
      eyebrow: 'Pricing',
      titleStart: 'You pay per ',
      titleEm: 'session',
      titleEnd: ', never a subscription.',
      intro:
        'No commitment, no monthly fee. Pick the product and length that fit your night. Party going long? Extend the session anytime.',
      bestDeal: 'Turnkey',
      offer: {
        badge: 'Launch offer · −50%',
        text: 'Until 31 October 2026 every hour is half price. Struck-through figures are the regular rates.',
      },
      columns: [
        {
          name: 'Your Apple Music account',
          tag: 'You play with your own subscription',
          rows: [
            { label: 'Per hour, weekdays', before: '5.00', amount: '2.50' },
            { label: 'Per hour, Friday & Saturday night', before: '9.00', amount: '4.50' },
            { label: '3-hour night (8 PM → 11 PM)', before: '27.00', amount: '13.50' },
          ],
        },
        {
          name: 'Account provided by Tutti',
          tag: 'Nothing to set up, we handle the music',
          highlighted: true,
          rows: [
            { label: 'Per hour, weekdays', before: '8.00', amount: '4.00' },
            { label: 'Per hour, Friday & Saturday night', before: '15.00', amount: '7.50' },
            { label: '3-hour night (8 PM → 11 PM)', before: '45.00', amount: '22.50' },
          ],
        },
      ],
      note: 'Prices include VAT and are prorated to the minute: you only pay for the time you book. Secure payment via Stripe. <strong>Launch offer: 50% off every hour until 31 October 2026.</strong> Evening rate applies on Friday and Saturday from 6 PM. Book your slot from your account, pay, play.',
    },
    useCases: {
      eyebrow: 'For whom',
      titleStart: 'Tutti shows up at ',
      titleEm: 'every',
      titleEnd: ' party.',
      intro:
        "A few patterns we see regularly. The list isn't fixed — Tutti adapts to every kind of private gathering.",
      tags: [
        '🎂 Birthdays',
        '💍 Bachelor & bachelorette parties',
        '🎉 Friend gatherings',
        '🏡 Housewarmings',
        '👰 Weddings',
        '🎄 Year-end parties',
        '🏖️ Group vacations',
        '🏢 Company events',
        '🍷 Dinner parties',
        '🎓 Student parties',
      ],
    },
    faq: {
      eyebrow: 'Frequently asked',
      title: 'Everything you might wonder.',
      items: [
        {
          q: 'What is Tutti?',
          a: 'Tutti is a premium platform built in Luxembourg by Kleos Sàrl. It offers two products for your private parties: <strong>Tutti Tracks</strong> (music blind test with Spotify and YouTube) and <strong>Tutti Quizz</strong> (multi-format multimedia quiz). Players join a game by scanning a QR code — no app to install, no account to create.',
        },
        {
          q: 'Do I need a Spotify Premium account?',
          a: "To use Spotify as a music source on Tutti Tracks, yes — the host (the person running the night) needs their own Spotify Premium account. Music plays directly from that authenticated account via Spotify's official SDK. <strong>Tutti never stores or redistributes any audio files.</strong> If the host doesn't have Spotify Premium, YouTube is a free alternative. Players never need any account.",
        },
        {
          q: 'Do my guests need to create an account or install an app?',
          a: "No. Players just scan the QR code shown on the TV screen with their phone. They pick a nickname and they're in. No install, no account, no personal data required.",
        },
        {
          q: 'How does voice recognition work?',
          a: 'When a player buzzes on Tutti Tracks, their phone records a few seconds of voice. That audio is sent to Whisper (OpenAI) for transcription, then <strong>immediately deleted</strong>. Tutti never keeps any voice recordings. Recognition tolerates minor typos, accents, and spelling variants.',
        },
        {
          q: 'What are the content sources for Tutti Tracks and Tutti Quizz?',
          a: '<strong>For Tutti Tracks:</strong> play with the official Tutti library (themed playlists by category, decade, or language), build your own list by searching Spotify or YouTube directly inside the app, or import one of your existing Spotify playlists. <strong>For Tutti Quizz:</strong> use the official library (multilingual packs ready to play) or build your own quiz mixing MCQ, true/false, free answer, and estimation.',
        },
        {
          q: 'How many players can join?',
          a: "Tutti is built for smooth sessions with 2 to 30 simultaneous players. Beyond that, it still works but the rhythm changes a bit — we'd recommend team mode at that point.",
        },
        {
          q: 'What languages are supported?',
          a: "Tutti's interface is available in <strong>English, French, Italian, and Spanish</strong>. Each language has its own adapted official content library. You can switch language at any time, even mid-game.",
        },
        {
          q: 'Are there ads on the music?',
          a: "With Spotify Premium, never. With YouTube, it depends on the host's account — if you have YouTube Premium, no ads. Otherwise, we try to minimize the impact by playing only short clips of each track.",
        },
        {
          q: 'How does payment work?',
          a: 'You book a slot from your account and pay by card via Stripe. The price is hourly, prorated to the minute, with an evening rate on Friday and Saturday from 6 PM. No subscription, no auto-debit. <strong>Launch offer: 50% off every hour until 31 October 2026.</strong> Playing with your own Apple Music subscription costs even less.',
        },
        {
          q: 'What about my personal data?',
          a: 'Tutti is GDPR-compliant. We collect only the minimum needed (email, nickname, playlists, scores). Voice recordings are never stored. You can export or delete your account at any time. Tutti is published by <strong>Kleos Sàrl</strong>, a Luxembourg (EU) company. See our <a class="landing-faq-link" href="/privacy">privacy policy</a> for details.',
        },
        {
          q: 'Can I use Tutti in a commercial setting?',
          a: 'Tutti is intended for private use among friends or family. Public or commercial use (bars, ticketed events, restaurants) requires specific music licenses (SACEM or local equivalent) that you must secure independently. Reach out to <a class="landing-faq-link" href="mailto:contact@tuttiparty.app">contact@tuttiparty.app</a> to discuss professional use.',
        },
      ],
    },
    cta: {
      titleStart: 'Ready to ',
      titleEm: 'challenge',
      titleEnd: ' your friends?',
      sub: 'Request beta access and host your first Tutti night within the week.',
      button: 'Request access',
    },
    footer: {
      tagline:
        'The premium music blind test and multimedia quiz for your private parties. Crafted with ❤ in Luxembourg by Kleos Sàrl.',
      cols: {
        tutti: {
          title: 'Tutti',
          links: [
            { label: 'Products', href: '#products' },
            { label: 'How it works', href: '#how' },
            { label: 'Features', href: '#features' },
            { label: 'Pricing', href: '#pricing' },
            { label: 'FAQ', href: '#faq' },
          ],
        },
        legal: {
          title: 'Legal',
          links: [
            { label: 'Privacy', href: '/privacy' },
            { label: 'Terms', href: '/terms' },
            { label: 'Legal notice', href: '/legal' },
          ],
        },
        contact: { title: 'Contact' },
      },
      copyright: '© 2026 Kleos Sàrl. All rights reserved.',
      built: 'BUILT IN LUXEMBOURG · MADE FOR THE WORLD',
    },
  },
};
