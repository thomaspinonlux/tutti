/**
 * fix/attentes-sans-issue — borne une promesse externe.
 *
 * Les bibliothèques audio (Spotify, YouTube, MusicKit), l'autorisation micro
 * et le pont natif rendent des promesses qui, dans certains cas réels — filtre
 * de contenu, dialogue système ignoré, réseau qui « pend » —, ne se résolvent
 * NI ne rejettent jamais. L'écran reste alors sur « chargement » ou
 * « configuration » pour toute la soirée, sans erreur et sans issue.
 */
export function borner<T>(promesse: Promise<T>, delaiMs: number, quoi: string): Promise<T> {
  return new Promise<T>((resoudre, rejeter) => {
    const minuteur = window.setTimeout(
      () => rejeter(new Error(`${quoi} : pas de réponse après ${Math.round(delaiMs / 1000)} s`)),
      delaiMs,
    );
    promesse.then(
      (valeur) => {
        window.clearTimeout(minuteur);
        resoudre(valeur);
      },
      (err: unknown) => {
        window.clearTimeout(minuteur);
        rejeter(err as Error);
      },
    );
  });
}
