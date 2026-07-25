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

## Prochaines étapes (ponts natifs — phases 1 & 2 du plan)

Ces éléments ne sont PAS encore implémentés ici — la coque de la phase 0 se
contente d'emballer le web. À venir :

1. **Pont MusicKit natif** (phase 1) — un plugin Capacitor Swift exposant
   `play(appleId)` / `pause()`, branché via `supportsNativeAppleMusic()` de
   `frontend/src/lib/platform.ts`. → Apple Music full-track sans blocage autoplay.
2. **Sortie écran joueurs** (phase 2) — une seconde `WKWebView` sur l'`UIScreen`
   externe affichant la route `/screen`, rendue localement (latence TV nulle).
3. Dans Xcode : activer **Background Modes → Audio** (son qui continue écran
   verrouillé) et déclarer l'usage du **micro** (reconnaissance vocale).

Tant que ces ponts ne sont pas là, l'app native se comporte comme le web
(Apple Music via MusicKit JS, avec l'overlay de secours autoplay déjà en place).
