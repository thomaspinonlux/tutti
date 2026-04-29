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
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'pop-in': 'pop-in 250ms cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  plugins: [],
};
