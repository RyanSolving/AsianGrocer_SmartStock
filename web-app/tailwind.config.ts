import type { Config } from 'tailwindcss'

/**
 * Asian Grocer design tokens.
 *
 * - `forest` is the brand: dark green for chrome and primary actions.
 * - `brand` is kept as an alias of `forest` so older class names follow the brand.
 * - `slate` is overridden with a warm, green-tinted neutral scale, so every existing
 *   neutral class (text, borders, surfaces) matches the forest palette.
 * - Status colours (`success`, `warning`, `danger`) are never used for decoration.
 */
const forest = {
  DEFAULT: '#37604C',
  50: '#eef3ef',
  100: '#dbe7de',
  200: '#b9d0c0',
  300: '#8fb39b',
  400: '#5e8c6f',
  500: '#45765b',
  600: '#37604C',
  700: '#2b503e',
  800: '#123326',
  900: '#0e2a1f',
  950: '#081a13',
}

const neutral = {
  50: '#f6f5f1',
  100: '#efeee9',
  200: '#e4e2dc',
  300: '#cfccc4',
  400: '#98a09a',
  500: '#5b6660',
  600: '#47524c',
  700: '#323c37',
  800: '#222b27',
  900: '#14201b',
  950: '#0b1410',
}

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        red: { 50: '#fcf0ee', 200: '#efc6bf', 300: '#e4a095', 400: '#cc7061', 500: '#B53C2B', 600: '#B53C2B', 700: '#933123', 900: '#632118' },
        forest,
        brand: forest,
        slate: neutral,
        ground: '#f6f5f1',
        surface: '#ffffff',
        line: '#e4e2dc',
        ink: '#14201b',
        muted: '#5b6660',
        accent: '#2BB673',
        info: '#3E2BB5',
        success: { DEFAULT: '#176b43', soft: '#e6f4ec' },
        warning: { DEFAULT: '#706317', marker: '#B5A32B', soft: '#f7f4de' },
        danger: { DEFAULT: '#B53C2B', soft: '#fdecea' },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        control: '10px',
        card: '16px',
      },
      boxShadow: {
        panel: '0 1px 2px rgba(20, 32, 27, 0.04), 0 8px 24px rgba(20, 32, 27, 0.06)',
        raised: '0 -1px 0 rgba(20, 32, 27, 0.04), 0 12px 32px rgba(20, 32, 27, 0.14)',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        'sheet-in': { from: { transform: 'translateY(16px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        'sheet-in': 'sheet-in 180ms cubic-bezier(0.22, 1, 0.36, 1)',
        'fade-in': 'fade-in 150ms ease-out',
      },
    },
  },
  plugins: [],
}

export default config
