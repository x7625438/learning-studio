/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Cyber dark palette (sidebar + base)
        sidebar: {
          DEFAULT: '#0a0d14',
          hover: '#111620',
          active: '#151c2a',
          border: 'rgba(6, 182, 212, 0.08)',
        },
        // Cyber neon palette
        cyber: {
          50: '#e0f7ff',
          100: '#b3ecff',
          200: '#80deff',
          300: '#4dd0ff',
          400: '#1ac0ff',
          500: '#06b6d4',
          600: '#0096b4',
          700: '#00778c',
          800: '#005a66',
          900: '#003d44',
        },
        neon: {
          purple: '#a855f7',
          blue: '#3b82f6',
          cyan: '#06b6d4',
          pink: '#ec4899',
          green: '#10b981',
          orange: '#f97316',
          red: '#ef4444',
        },
        // Content area surface
        content: {
          bg: '#0f1318',
          card: 'rgba(15, 19, 24, 0.85)',
          cardHover: 'rgba(20, 25, 32, 0.9)',
          border: 'rgba(6, 182, 212, 0.12)',
          borderHover: 'rgba(6, 182, 212, 0.35)',
        },
        surface: {
          50: '#e2e8f0',
          100: '#cbd5e1',
          200: '#94a3b8',
          300: '#64748b',
          400: '#475569',
          500: '#334155',
          600: '#1e293b',
          700: '#0f172a',
          800: '#0a0f1a',
          900: '#050810',
        },
      },
      fontFamily: {
        sans: [
          '"LXGW WenKai Screen"',
          '"Plus Jakarta Sans"',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
        display: [
          '"LXGW WenKai Screen"',
          '"Plus Jakarta Sans"',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'Fira Code',
          'monospace',
        ],
      },
      width: {
        'sidebar': '240px',
        'sidebar-collapsed': '68px',
      },
      boxShadow: {
        'neon-cyan': '0 0 20px rgba(6, 182, 212, 0.25), 0 0 40px rgba(6, 182, 212, 0.1)',
        'neon-purple': '0 0 20px rgba(168, 85, 247, 0.25), 0 0 40px rgba(168, 85, 247, 0.1)',
        'neon-blue': '0 0 20px rgba(59, 130, 246, 0.25), 0 0 40px rgba(59, 130, 246, 0.1)',
        'neon-green': '0 0 20px rgba(16, 185, 129, 0.25)',
        'card': '0 4px 24px rgba(0, 0, 0, 0.5), 0 1px 2px rgba(0, 0, 0, 0.3)',
        'card-hover': '0 8px 40px rgba(0, 0, 0, 0.6), 0 0 20px rgba(6, 182, 212, 0.08)',
        'float': '0 20px 60px rgba(0, 0, 0, 0.5)',
        'inner-glow': 'inset 0 0 30px rgba(6, 182, 212, 0.03)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-up': 'slideUp 0.5s ease-out',
        'slide-down': 'slideDown 0.4s ease-out',
        'slide-left': 'slideLeft 0.4s ease-out',
        'slide-right': 'slideRight 0.4s ease-out',
        'scale-in': 'scaleIn 0.35s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float': 'float 6s ease-in-out infinite',
        'shimmer': 'shimmer 2.5s linear infinite',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
        'spin-slow': 'spin 8s linear infinite',
        'ping-slow': 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
        'bounce-subtle': 'bounceSubtle 0.6s ease-out',
        'morph': 'morph 0.4s ease-in-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-16px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideLeft: {
          '0%': { transform: 'translateX(20px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        slideRight: {
          '0%': { transform: 'translateX(-20px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.92)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-12px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        glowPulse: {
          '0%, 100%': { opacity: '0.5', filter: 'blur(20px)' },
          '50%': { opacity: '1', filter: 'blur(30px)' },
        },
        morph: {
          '0%': { borderRadius: '1rem' },
          '50%': { borderRadius: '1.5rem' },
          '100%': { borderRadius: '1rem' },
        },
        bounceSubtle: {
          '0%': { transform: 'scale(0.95)' },
          '50%': { transform: 'scale(1.02)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      screens: {
        'xs': '475px',
      },
      backdropBlur: {
        xs: '2px',
      },
      backgroundImage: {
        'grid': 'linear-gradient(rgba(6, 182, 212, 0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(6, 182, 212, 0.02) 1px, transparent 1px)',
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'noise': "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E\")",
      },
    },
  },
  plugins: [],
}
