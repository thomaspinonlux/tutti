import { Link } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.js';

export function HomePage(): JSX.Element {
  const { session } = useAuthStore();

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 bg-cream text-ink">
      <h1 className="text-6xl font-bold mb-2">Tutti</h1>
      <p className="text-lg text-ink/70 mb-8 italic">
        Plateforme de jeux interactifs pour bars et particuliers
      </p>

      <div className="flex gap-4">
        {session ? (
          <Link
            to="/admin"
            className="px-6 py-3 bg-spritz text-white border-2 border-ink rounded shadow-[6px_6px_0_0_#1a1410] hover:shadow-[3px_3px_0_0_#1a1410] hover:translate-x-[3px] hover:translate-y-[3px] transition-all font-bold"
          >
            Aller au dashboard
          </Link>
        ) : (
          <>
            <Link
              to="/auth/signup"
              className="px-6 py-3 bg-spritz text-white border-2 border-ink rounded shadow-[6px_6px_0_0_#1a1410] hover:shadow-[3px_3px_0_0_#1a1410] hover:translate-x-[3px] hover:translate-y-[3px] transition-all font-bold"
            >
              Créer un compte
            </Link>
            <Link
              to="/auth/login"
              className="px-6 py-3 bg-white text-ink border-2 border-ink rounded shadow-[6px_6px_0_0_#1a1410] hover:shadow-[3px_3px_0_0_#1a1410] hover:translate-x-[3px] hover:translate-y-[3px] transition-all font-bold"
            >
              Se connecter
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
