/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Direction Pop Cocktail — sera étendue à l'étape 5.
      colors: {
        cream: '#f5ecd9',
        spritz: '#ee6c2a',
        basil: '#4a8b3f',
        raspberry: '#c8336e',
        lemon: '#e8c547',
        plum: '#6e3a6e',
        ink: '#1a1410',
      },
    },
  },
  plugins: [],
};
