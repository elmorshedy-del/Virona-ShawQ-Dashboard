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
        sage: { 50: '#f0f4f8', 600: '#335c85', 700: '#214263', 800: '#162e47', 900: '#0f1f30' },
        copper: { 400: '#c98552', 500: '#b8723b', 600: '#9a5d2c' },
        gold: { 500: '#a88547', 600: '#8c6c34' },
        ink: '#1f1d1a',
      },
    },
  },
  plugins: [],
}
