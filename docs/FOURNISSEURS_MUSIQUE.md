# Fournisseurs de musique — état des lieux

Dernière vérification : 13 septembre 2026.

## Apple Music — retenu

MusicKit JS lit le morceau entier dans le navigateur, à partir d'un
abonnement personnel de l'utilisateur. C'est la seule voie exploitable
aujourd'hui. Un abonnement = un flux simultané.

## Spotify — écarté

Le mode développement est plafonné à 25 utilisateurs authentifiés.
Passer au quota étendu exige 250 000 utilisateurs actifs mensuels
déclarés, plafond commercial inatteignable pour Tutti.

## Deezer — écarté

Trois blocages indépendants, chacun suffisant :

1. **Création d'application fermée.** developers.deezer.com refuse tout
   nouvel enregistrement depuis début 2024. Confirmé encore ouvert sans
   réponse sur le forum officiel en avril 2026 : « There's no information
   on when they'll reopen registration for that, or if they'll reopen it
   at all. » Sans App ID, pas d'OAuth, donc pas de SDK, donc pas de
   lecture complète. Le SDK `dz.js` sert toujours depuis le CDN mais on
   ne peut pas s'y connecter.

2. **L'API publique ne donne que l'extrait.** api.deezer.com répond sans
   clé (`/track/{id}`, `/search`, `/playlist/{id}`) mais le champ
   `preview` pointe un MP3 mesuré à **29,99 s**, imposé par Deezer : on
   ne choisit pas le point de départ. Inutilisable pour un blind test.

3. **Usage commercial interdit.** Les conditions d'utilisation le disent
   sans ambiguïté : « the use of the Services is strictly limited for a
   non-commercial purpose and in a non-commercial environment », et le
   développeur ne doit tirer aucun revenu direct ou indirect du service.

Ce que l'API Deezer reste utile à faire : rapprocher un catalogue par
ISRC, vérifier la disponibilité par pays, récupérer des pochettes. Rien
qui touche à la lecture.

> Je ne suis pas juriste — le point 3 mérite une lecture par un
> professionnel avant toute décision d'exploitation.
