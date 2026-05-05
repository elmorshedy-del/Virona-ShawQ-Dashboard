module.exports = {
  content: ["./dental_demo.html"],
  theme: {
    extend: {
      fontFamily: {
        display: ['Fraunces', 'serif'],
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
      },
      colors: {
        cream: { 50: '#ffffff', 100: '#fcfcfc', 200: '#f3f4f6', 300: '#e5e7eb' },
        sage: { 50: '#eaeee9', 600: '#4a5c4f', 700: '#3a4a3f', 800: '#2c382f', 900: '#1f2823' },
        copper: { 400: '#c98552', 500: '#b8723b', 600: '#9a5d2c' },
        gold: { 500: '#a88547', 600: '#8c6c34' },
        ink: '#1f1d1a',
      },
    },
  },
  plugins: [],
}
