/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_SOCKET_URL: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_SPOTIFY_CLIENT_ID: string;
  /** Origine web hébergée (ex. https://tuttiparty.app), utilisée par la coque
   *  native pour l'écran externe HDMI. Optionnelle : défaut prod si absente. */
  readonly VITE_WEB_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
