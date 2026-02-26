/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#070B14',
          surface: '#0D1220',
          card: 'rgba(255,255,255,0.03)',
          hover: 'rgba(255,255,255,0.05)',
        },
        border: {
          DEFAULT: 'rgba(255,255,255,0.07)',
          hover: 'rgba(255,255,255,0.15)',
          active: 'rgba(99,102,241,0.5)',
        },
        accent: {
          DEFAULT: '#6366F1',
          hover: '#818CF8',
          muted: 'rgba(99,102,241,0.15)',
          glow: 'rgba(99,102,241,0.3)',
        },
        text: {
          primary: '#F1F5F9',
          secondary: '#94A3B8',
          muted: '#475569',
        },
        success: {
          DEFAULT: '#10B981',
          muted: 'rgba(16,185,129,0.15)',
        },
        warning: {
          DEFAULT: '#F59E0B',
          muted: 'rgba(245,158,11,0.15)',
        },
        danger: {
          DEFAULT: '#EF4444',
          muted: 'rgba(239,68,68,0.15)',
        },
      },
      fontFamily: {
        sans: ['Inter var', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        'gradient-accent': 'linear-gradient(135deg, #6366F1, #8B5CF6)',
        'gradient-success': 'linear-gradient(135deg, #10B981, #059669)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-slow': 'pulse 3s infinite',
        'shimmer': 'shimmer 2s infinite',
        'spin-slow': 'spin 3s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      boxShadow: {
        'glow': '0 0 20px rgba(99,102,241,0.3)',
        'glow-sm': '0 0 10px rgba(99,102,241,0.2)',
        'card': '0 4px 24px rgba(0,0,0,0.4)',
        'modal': '0 25px 50px rgba(0,0,0,0.8)',
      },
    },
  },
  plugins: [],
};
