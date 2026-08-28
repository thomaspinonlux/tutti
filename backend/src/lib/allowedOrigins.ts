/**
 * allowedOrigins.ts — SOURCE UNIQUE des origines autorisées (CORS).
 *
 * refactor/single-cors-list — cette liste existait EN DOUBLE : une copie dans
 * server.ts (API REST) et une dans socket/index.ts (Socket.IO), « pour éviter
 * l'import circulaire ». Résultat concret : le correctif de l'origine native
 * `capacitor://tuttiparty.app` n'a été appliqué qu'à une copie, l'API
 * répondait mais le temps réel refusait la connexion → « Socket: websocket
 * error » plein écran dans l'app iPad, sans que rien ne signale l'oubli.
 *
 * Ce module n'importe RIEN du reste du backend : server.ts et socket/index.ts
 * peuvent tous les deux l'importer sans cycle. Toute nouvelle origine s'ajoute
 * ICI et nulle part ailleurs.
 */

const STATIC_ALLOWED_ORIGINS = [
  'https://tuttiparty.app',
  'https://www.tuttiparty.app',
  'https://tutti-brown.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  // Coques natives (Capacitor) : l'app iOS sert la WebView depuis
  // capacitor://localhost, Android depuis http(s)://localhost. Ces origines ne
  // sont pas des sites web → on les autorise explicitement (l'app native est
  // notre propre client). Sans ça : « load fail » après connexion (CORS).
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'https://localhost',
];

/**
 * fix/native-origin-hostname — la coque iOS peut servir la WebView sous un
 * hostname personnalisé (`server.hostname` de capacitor.config.ts) : l'origine
 * devient alors `capacitor://<hostname>`. ⚠️ Sur iOS le schéma reste TOUJOURS
 * `capacitor` (WKWebView interdit d'enregistrer http/https). On accepte donc
 * tout `capacitor://` / `ionic://` dont l'hôte est un de NOS domaines — c'est
 * notre propre client, jamais un site tiers (un navigateur ne peut pas forger
 * une origine à schéma custom).
 */
const NATIVE_SCHEMES = ['capacitor', 'ionic'];
const NATIVE_HOSTS = ['localhost', 'tuttiparty.app', 'www.tuttiparty.app', 'app.tuttiparty'];
for (const scheme of NATIVE_SCHEMES) {
  for (const host of NATIVE_HOSTS) STATIC_ALLOWED_ORIGINS.push(`${scheme}://${host}`);
}

const allowedOrigins = new Set(STATIC_ALLOWED_ORIGINS);
const FRONTEND_URL = process.env.FRONTEND_URL;
if (FRONTEND_URL) allowedOrigins.add(FRONTEND_URL);

export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // requêtes server-to-server / curl / sans Origin header
  if (allowedOrigins.has(origin)) return true;
  // Preview deploys Vercel : *.vercel.app appartenant au projet tutti
  if (/^https:\/\/tutti-[a-z0-9-]+\.vercel\.app$/.test(origin)) return true;
  return false;
}
