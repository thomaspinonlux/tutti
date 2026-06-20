/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // ─── Direction Pop Cocktail ─────────────────────────────────────────
      colors: {
        cream: {
          DEFAULT: '#f5ecd9',
          2: '#efe4cc',
          3: '#e6d8b8',
          4: '#d4c39e',
        },
        kraft: '#c2aa78',
        ink: {
          DEFAULT: '#1a1410',
          2: '#3d2f24',
          soft: '#6b5443',
          faded: '#9a8470',
        },
        spritz: {
          DEFAULT: '#ee6c2a',
          deep: '#c84e15',
        },
        basil: {
          DEFAULT: '#4a8b3f',
          deep: '#356a2c',
        },
        raspberry: {
          DEFAULT: '#c8336e',
          deep: '#9c1f53',
        },
        grapefruit: '#e89a64',
        lemon: '#e8c547',
        plum: '#6e3a6e',
        // feat/arcade-buttons-vinyl-buzzer — rose = action principale
        // (CTA, boutons primary). Pince entre raspberry (destructif, plus
        // saturé/rouge) et le rose tendre, garde la chaleur Pop Cocktail.
        rose: {
          DEFAULT: '#e85c8a',
          deep: '#c43b6e',
        },
      },
      fontFamily: {
        display: ['Caprasimo', 'serif'],
        editorial: ['Fraunces', 'serif'],
        sans: ['Outfit', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        // Ombres décalées fixes (style risographe)
        'pop-sm': '2px 2px 0 0 #1a1410',
        pop: '4px 4px 0 0 #1a1410',
        'pop-lg': '6px 6px 0 0 #1a1410',
        'pop-xl': '8px 8px 0 0 #1a1410',
        // feat/arcade-buttons-vinyl-buzzer — l'ombre dure de l'arcade. Alias
        // sémantique pour les boutons du nouveau système (press = translate
        // (4px,4px) + shadow-arcade-flat). Les ombres pop existantes restent
        // utilisables pour les Cards et autres surfaces.
        arcade: '4px 4px 0 0 #1a1410',
        'arcade-sm': '2px 2px 0 0 #1a1410',
        'arcade-flat': '0 0 0 0 #1a1410',
      },
      borderWidth: {
        3: '3px',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-out': {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        'pop-in': {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        // Festive mode B
        'confetti-fall': {
          '0%': { transform: 'translateY(-15vh) rotate(0deg)', opacity: '0' },
          '8%': { opacity: '0.7' },
          '92%': { opacity: '0.7' },
          '100%': { transform: 'translateY(110vh) rotate(720deg)', opacity: '0' },
        },
        'color-pulse': {
          '0%, 100%': { backgroundColor: 'rgba(238, 108, 42, 0.08)' }, // spritz
          '25%': { backgroundColor: 'rgba(74, 139, 63, 0.08)' }, // basil
          '50%': { backgroundColor: 'rgba(232, 197, 71, 0.08)' }, // lemon
          '75%': { backgroundColor: 'rgba(110, 58, 110, 0.08)' }, // plum
        },
        'reveal-pop': {
          '0%': { transform: 'scale(0.5) rotate(-3deg)', opacity: '0' },
          '60%': { transform: 'scale(1.08) rotate(1deg)', opacity: '1' },
          '100%': { transform: 'scale(1) rotate(0deg)', opacity: '1' },
        },
        'buzz-shake': {
          '0%, 100%': { transform: 'translateX(0) rotate(0deg)' },
          '25%': { transform: 'translateX(-6px) rotate(-2deg)' },
          '75%': { transform: 'translateX(6px) rotate(2deg)' },
        },
        'cover-blur-out': {
          '0%': { filter: 'blur(40px) saturate(0.4)', transform: 'scale(0.92)' },
          '100%': { filter: 'blur(0px) saturate(1)', transform: 'scale(1)' },
        },
        // Maquettes 06 + 07 — animations spécifiques par phase
        'float-question': {
          '0%, 100%': { transform: 'translateY(0) rotate(-3deg)' },
          '50%': { transform: 'translateY(-12px) rotate(3deg)' },
        },
        'tick-pulse': {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.05)' },
        },
        'dance-pulse': {
          // Bug 2 fix — translateX(-50%) supposait un élément absolute centré
          // (left: 50%). Le DanceMessage est en flow normal sur le tel —
          // translateX décalait toute la card 50% à gauche, créant la bande
          // noire qui dépasse de l'écran iPhone. Animation scale uniquement.
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.03)' },
        },
        'emoji-wave': {
          '0%, 100%': { transform: 'rotate(-15deg)' },
          '50%': { transform: 'rotate(15deg)' },
        },
        'toast-slide': {
          '0%': { opacity: '0', transform: 'translateY(-20px) scale(0.8)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'timer-enter': {
          '0%': {
            opacity: '0',
            transform: 'translateY(-50%) scale(0.5) rotate(-10deg)',
          },
          '100%': {
            opacity: '1',
            transform: 'translateY(-50%) scale(1) rotate(-3deg)',
          },
        },
        'pulse-buzz': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.4', transform: 'scale(0.8)' },
        },
        'btn-glow': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(238, 108, 42, 0.7)' },
          '50%': { boxShadow: '0 0 0 12px rgba(238, 108, 42, 0)' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'mic-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(216, 82, 122, 0.6)' },
          '50%': { boxShadow: '0 0 0 24px rgba(216, 82, 122, 0)' },
        },
        'valid-pop': {
          '0%': { transform: 'translate(0, -50%) scale(0.5)', opacity: '0' },
          '100%': { transform: 'translate(0, -50%) scale(1)', opacity: '1' },
        },
        // feat/arcade-buttons-vinyl-buzzer — vinyl en lecture (rotation infinie)
        'vinyl-spin': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        // Scratch au buzz : aller-retour rapide, garde l'angle final 0
        'vinyl-scratch': {
          '0%': { transform: 'rotate(0deg)' },
          '22%': { transform: 'rotate(-26deg)' },
          '50%': { transform: 'rotate(15deg)' },
          '74%': { transform: 'rotate(-7deg)' },
          '100%': { transform: 'rotate(0deg)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'fade-out': 'fade-out 500ms ease-out forwards',
        'pop-in': 'pop-in 250ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        'confetti-fall': 'confetti-fall linear infinite',
        'color-pulse': 'color-pulse 18s ease-in-out infinite',
        'reveal-pop': 'reveal-pop 600ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        'buzz-shake': 'buzz-shake 400ms ease-in-out',
        'cover-blur-out': 'cover-blur-out 800ms ease-out forwards',
        'float-question': 'float-question 3s ease-in-out infinite',
        'tick-pulse': 'tick-pulse 1s ease-in-out infinite',
        'dance-pulse': 'dance-pulse 1.5s ease-in-out infinite',
        'emoji-wave': 'emoji-wave 1.2s ease-in-out infinite',
        'toast-slide': 'toast-slide 500ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'timer-enter': 'timer-enter 500ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'pulse-buzz': 'pulse-buzz 1s ease-in-out infinite',
        'btn-glow': 'btn-glow 1.2s ease-in-out infinite',
        'slide-up': 'slide-up 600ms ease-out both',
        'mic-pulse': 'mic-pulse 1.2s ease-in-out infinite',
        'valid-pop': 'valid-pop 500ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        // Vinyl
        'vinyl-spin': 'vinyl-spin 1.9s linear infinite',
        'vinyl-scratch': 'vinyl-scratch 500ms cubic-bezier(0.3, 0.6, 0.4, 1) forwards',
      },
    },
  },
  plugins: [],
};
