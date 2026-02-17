/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Primary accent (neon lime green)
        accent: {
          50:  '#f2ffe0',
          100: '#e0ffb3',
          200: '#c4ff66',
          300: '#a8ff33',
          400: '#8cff05',
          500: '#7de604',
          600: '#6ecc04',
          700: '#5fad05',
          800: '#4f8e06',
          900: '#3f6e07',
        },
        // Surface palette (dark teal neutrals)
        surface: {
          950: '#162529',
          900: '#1f3338',
          850: '#253d43',
          800: '#2c4850',
          700: '#3a5860',
          600: '#415f66',
          500: '#5a7a80',
          400: '#86a6a6',
          300: '#97a3a6',
          200: '#bedcda',
          100: '#e0eef2',
          50:  '#e8f3f5',
        },
        // Semantic colors
        danger: {
          DEFAULT: '#f44336',
          light:   '#ff7373',
          dark:    '#8b1a12',
        },
        warning: {
          DEFAULT: '#ff9e2c',
          light:   '#ffc170',
          dark:    '#7a4400',
        },
        success: {
          DEFAULT: '#4ade80',
          light:   '#6aefaa',
          dark:    '#166534',
        },
      },
      fontFamily: {
        sans: ['Poppins', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
