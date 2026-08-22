/** @type {import('tailwindcss').Config} */
import typography from '@tailwindcss/typography';

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f4ff',
          100: '#dbe4ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
        },
        pf: {
          borderPrimary: '#e4d8ff',
          borderSoft: '#e5def8',
          borderHeader: '#e6dcff',
          borderInput: '#d9d0ff',
          borderDotted: '#daccff',
          borderChip: '#dad0ff',
          borderMemo: '#e3d9ff',
          bgSoft: '#f8f5ff',
          bgPanel: '#f5f1ff'
        }
      }
    },
  },
  plugins: [typography],
}
