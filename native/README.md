# Tutti — coque native (Capacitor)

Emballe l'app web Tutti (`../frontend`) en **application iPad native** (cible B du
plan natif, cf. [`../docs/NATIVE.md`](../docs/NATIVE.md)). Même code que le web —
seule la coque change. Ce dossier est **volontairement hors du workspace pnpm**
pour ne pas toucher au build/déploiement web : on y installe les deps séparément.

> ⚠️ La compilation iOS nécessite un **Mac + Xcode**. Impossible depuis le
> sandbox / la CI Linux. Les étapes ci-dessous se font sur ta machine.

## Prérequis

- macOS avec Xcode + CocoaPods (`sudo gem install cocoapods`)
- Node/pnpm (déjà utilisés par le repo)
- Un compte Apple Developer (99 $/an) pour signer et publier

## Première installation

```bash
cd native
pnpm install            # deps de la coque (Capacitor)
pnpm run build:web      # build le frontend → ../frontend/dist
pnpm run add:ios        # crée le projet Xcode natif dans native/ios/
pnpm run sync           # copie le web + synchronise les plugins
pnpm run open:ios       # ouvre Xcode → Run sur un iPad / simulateur
```

## Cycle de dev

À chaque changement du frontend :

```bash
pnpm run sync           # rebuild web + cap copy + cap sync
```

Ou, pour recharger à chaud sans rebuild : lancer `pnpm -C ../frontend dev`,
décommenter le bloc `server.url` de `capacitor.config.ts` (IP de ta machine),
puis `pnpm run sync` une fois.

## Ponts natifs inclus (phases 1 & 2)

Deux plugins Capacitor locaux sont livrés dans `plugins/` et déclarés comme
dépendances `file:` de cette coque — `cap sync` les intègre automatiquement :

1. **`plugins/tutti-musickit`** (phase 1) — plugin Swift `ApplicationMusicPlayer`
   exposant `authorize/play/pause/resume/seek/getStatus`. Côté JS, il est branché
   via `frontend/src/lib/nativeMusicKit.ts` + `useAppleMusicPlayer` (chemin natif
   quand `supportsNativeAppleMusic()`). → Apple Music full-track sans autoplay.
2. **`plugins/tutti-external-screen`** (phase 2) — plugin Swift qui affiche la
   route `/screen` sur un écran externe (2ᵉ `UIWindow`/`WKWebView`). Piloté par
   `useExternalPlayerScreen`. → l'iPad sort l'écran joueurs sur la TV.

### Prérequis Apple — À FAIRE UNE FOIS, SUR LE PORTAIL

> Sans ceci, l'app se lance mais Apple Music est refusé sur TOUT appareil, avec
> l'erreur « The requesting app does not have the necessary permissions » et
> AUCUNE fenêtre d'autorisation. Diagnostiqué le 10/09/2026 après trois builds
> à chercher ailleurs : la liste Réglages → Confidentialité → Médias et Apple
> Music reste vide, désinstaller l'app ne change rien, et les trois portes
> (MusicKit, StoreKit, MPMediaLibrary) répondent « refusé » en 0 ms.

- **developer.apple.com → Certificates, Identifiers & Profiles → Identifiers →
  `app.tuttiparty` → App Services → cocher MusicKit → Save.**

### Réglages du projet iOS — NE PAS LES FAIRE À LA MAIN DANS XCODE

`native/ios/` est gitignoré et **régénéré à chaque build** par `cap add ios` :
tout réglage coché à la main dans Xcode disparaît au build suivant. Ces trois
points sont donc appliqués par `codemagic.yaml`, étape 5, après `cap sync` :

- **`UIBackgroundModes = [audio]`** (son quand l'écran se verrouille).
- **`NSAppleMusicUsageDescription`** (accès médiathèque) et
  **`NSMicrophoneUsageDescription`** (reconnaissance vocale).
- Cible de déploiement **iOS 15+** (MusicKit `ApplicationMusicPlayer`), forcée
  dans le Podfile et le projet.

Pour un build local dans Xcode, il faut les cocher à la main après chaque
`cap add ios`.

> ⚠️ Le code Swift des plugins n'a pas pu être compilé hors Xcode : à builder et
> valider sur device. Si aucun plugin n'est présent au runtime, l'app native
> retombe proprement sur le chemin web (MusicKit JS + overlay autoplay).
