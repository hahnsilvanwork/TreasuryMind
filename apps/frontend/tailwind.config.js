/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Geist Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono Variable"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Ripple-blue → cyan brand ramp
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#4ea6ff',
          500: '#0a6cf5',
          600: '#0858d6',
          700: '#0a47a8',
          800: '#0d3c87',
          900: '#10316b',
        },
        cyan: {
          400: '#22d3ee',
          500: '#06b6d4',
        },
        // warm neutral canvas + ink (less "default slate")
        canvas: '#faf9f7',
        hairline: '#ebe7e1',
        ink: '#14151a',
        muted: '#6b6961',
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
        cardhover: '0 4px 12px rgba(16,24,40,0.08), 0 2px 4px rgba(16,24,40,0.04)',
        glow: '0 0 0 1px rgba(10,108,245,0.10), 0 8px 30px rgba(10,108,245,0.12)',
      },
      keyframes: {
        'fade-up': { '0%': { opacity: 0, transform: 'translateY(8px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
      },
      animation: {
        'fade-up': 'fade-up 0.5s cubic-bezier(0.16,1,0.3,1) both',
        'spin-slow': 'spin-slow 18s linear infinite',
      },
    },
  },
  plugins: [],
};
