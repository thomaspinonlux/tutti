# Stratégie responsive — Tutti

> Référence unique pour le comportement multi-tailles d'écran.
> Toute nouvelle page doit respecter ces règles ou justifier explicitement
> une dérogation dans le commentaire de tête du composant.

## Principe directeur : mobile-first

On code d'abord la version mobile (≥ 360px), puis on **enrichit** avec les
classes Tailwind `sm:`, `md:`, `lg:`, `xl:`, `2xl:`. Pas de `max-w` qui
casse en mobile, pas de width fixe en pixels, pas de `min-h-screen` non
contrôlée.

## Breakpoints Tailwind

| Préfixe  | Min width | Cible matérielle                        |
| -------- | --------- | --------------------------------------- |
| (mobile) | 0         | Téléphone portrait (360–430 px en réel) |
| `sm:`    | 640 px    | Téléphone paysage                       |
| `md:`    | 768 px    | Tablette portrait                       |
| `lg:`    | 1024 px   | Tablette paysage / petit laptop         |
| `xl:`    | 1280 px   | Ordi standard                           |
| `2xl:`   | 1536 px   | Grand écran / TV (mode `/screen`)       |

## Comportement par route

### `/` `/auth/signup` `/auth/login` (pages publiques)

**Responsive complet de 360 px à 2xl.** Aucun blocage, le texte s'adapte,
les boutons restent atteignables au pouce. Une seule colonne empilée
sur mobile, mise en valeur sur desktop.

### `/admin/*` (espace host)

- `< md` (téléphone) : **bloqué** via `<MinScreen min="md">` — message
  invitant à revenir depuis une tablette ou un ordinateur.
- `md` → `xl` : **2 colonnes** (sidebar de navigation + zone centrale).
  Pour les pages où un panneau de détail existe (ex. `PlaylistEditPage`),
  le panneau s'ouvre dans une **modale plein-écran** au lieu d'une 3ᵉ
  colonne.
- `≥ xl` : **3 colonnes** inline (sidebar + central + panneau détail).

### `/host` (iPad de l'animateur, étape 9+)

- `< lg` : **bloqué** via `<MinScreen min="lg">`.
- `lg` → `xl` : layout **2 × 2** (4 zones : équipes / morceau en cours /
  scoreboard / contrôles).
- `≥ xl` : layout **4 colonnes** inline.

### `/screen` (TV / écran public, étape 12+)

- Adaptatif de `lg` à `2xl`.
- `≥ 2xl` : polices très grandes (lecture à distance), animations généreuses.

### `/play` (téléphone joueur, étape 9+)

- **Mobile-first absolu.** L'expérience est optimisée pour 360–430 px.
  C'est l'écran le plus vu en pratique pendant une session.
- Sur grands écrans (`md+`), on **centre** le contenu avec
  `max-w-[500px] mx-auto` pour éviter les boutons étirés.
- Cibles tactiles ≥ 44 × 44 px (recommandation Apple HIG / Android).

## Outils

- **`useBreakpoint()`** (`frontend/src/lib/useBreakpoint.ts`) : hook
  retournant `isAtLeast(bp)` pour switcher la logique React (ex. ouvrir
  un panneau dans une modale plutôt qu'inline).
- **`<MinScreen min="md|lg|xl" />`** (`frontend/src/components/MinScreen.tsx`) :
  wrapper qui affiche un message Pop Cocktail si la viewport est en
  dessous du seuil. Lien automatique vers `/` ou `/play` selon le contexte.

## Checklist avant de livrer un nouvel écran

- [ ] Testé à 360 px de large dans Chrome DevTools.
- [ ] Testé à 768 px (tablette portrait), 1280 px (laptop), 1920 px (TV).
- [ ] Aucun débordement horizontal (overflow-x: hidden au pire, jamais
      en première intention).
- [ ] Boutons ≥ 44 × 44 px sur mobile/tablette.
- [ ] Texte ≥ 14 px sur mobile (16 px préférable pour le contenu).
- [ ] Si la route est dans `/admin/*` : `<MinScreen min="md">` est en place
      (via `AdminLayout` qui le fait déjà à la racine).
- [ ] Si la route est `/host` ou `/screen` : `<MinScreen>` en haut du
      composant avec le seuil correct.
- [ ] Pour `/play` : audit obligatoire à 375 × 667 (iPhone SE) ET
      414 × 896 (iPhone 11 Pro Max).

## Cas non couverts

Si tu rencontres un cas (ex. Apple Watch, frigo connecté…), arrête-toi
et demande au commanditaire avant de coder une solution.
