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
      },
      borderWidth: {
        3: '3px',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
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
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'pop-in': 'pop-in 250ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        'confetti-fall': 'confetti-fall linear infinite',
        'color-pulse': 'color-pulse 18s ease-in-out infinite',
        'reveal-pop': 'reveal-pop 600ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        'buzz-shake': 'buzz-shake 400ms ease-in-out',
        'cover-blur-out': 'cover-blur-out 800ms ease-out forwards',
      },
    },
  },
  plugins: [],
};
