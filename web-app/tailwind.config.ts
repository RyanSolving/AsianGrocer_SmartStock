import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef5ff',
          100: '#d7e8ff',
          500: '#0070f3',
          600: '#005fd0',
          700: '#004cab',
        },
      },
      boxShadow: {
        panel: '0 8px 30px rgba(16, 24, 40, 0.08)',
      },
    },
  },
  plugins: [],
}

export default config
