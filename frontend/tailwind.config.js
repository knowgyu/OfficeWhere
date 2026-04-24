/** @type {import('tailwindcss').Config} */
const mdColor = (token) => `var(--md-sys-color-${token})`;

module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Pretendard Variable',
          'Pretendard',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Malgun Gothic',
          '맑은 고딕',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Cascadia Code',
          'Menlo',
          'monospace',
        ],
      },
      colors: {
        primary: {
          DEFAULT: mdColor('primary'),
          on: mdColor('on-primary'),
          container: mdColor('primary-container'),
          'on-container': mdColor('on-primary-container'),
        },
        secondary: {
          DEFAULT: mdColor('secondary'),
          on: mdColor('on-secondary'),
          container: mdColor('secondary-container'),
          'on-container': mdColor('on-secondary-container'),
        },
        tertiary: {
          DEFAULT: mdColor('tertiary'),
          on: mdColor('on-tertiary'),
          container: mdColor('tertiary-container'),
          'on-container': mdColor('on-tertiary-container'),
        },
        danger: {
          DEFAULT: mdColor('error'),
          on: mdColor('on-error'),
          container: mdColor('error-container'),
          'on-container': mdColor('on-error-container'),
        },
        warn: {
          DEFAULT: mdColor('warning'),
          container: mdColor('warning-container'),
          'on-container': mdColor('on-warning-container'),
        },
        ok: {
          DEFAULT: mdColor('success'),
          container: mdColor('success-container'),
          'on-container': mdColor('on-success-container'),
        },
        surface: {
          DEFAULT: mdColor('surface'),
          on: mdColor('on-surface'),
          variant: mdColor('surface-variant'),
          'on-variant': mdColor('on-surface-variant'),
          lowest: mdColor('surface-container-lowest'),
          low: mdColor('surface-container-low'),
          container: mdColor('surface-container'),
          high: mdColor('surface-container-high'),
          highest: mdColor('surface-container-highest'),
          dim: mdColor('surface-dim'),
          bright: mdColor('surface-bright'),
        },
        outline: {
          DEFAULT: mdColor('outline'),
          variant: mdColor('outline-variant'),
        },
        background: mdColor('background'),
      },
      borderRadius: {
        xs: 'var(--md-shape-xs)',
        sm: 'var(--md-shape-sm)',
        md: 'var(--md-shape-md)',
        lg: 'var(--md-shape-lg)',
        xl: 'var(--md-shape-xl)',
        full: 'var(--md-shape-full)',
      },
      boxShadow: {
        'elev-1': 'var(--md-elev-1)',
        'elev-2': 'var(--md-elev-2)',
        'elev-3': 'var(--md-elev-3)',
        'elev-4': 'var(--md-elev-4)',
        'elev-5': 'var(--md-elev-5)',
      },
      transitionTimingFunction: {
        'md-standard': 'cubic-bezier(0.2, 0, 0, 1)',
        'md-emphasized': 'cubic-bezier(0.2, 0, 0, 1)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
        'slide-up': {
          '0%': { transform: 'translateY(16px)', opacity: 0 },
          '100%': { transform: 'translateY(0)', opacity: 1 },
        },
        'scale-in': {
          '0%': { transform: 'scale(0.96)', opacity: 0 },
          '100%': { transform: 'scale(1)', opacity: 1 },
        },
      },
      animation: {
        'fade-in': 'fade-in 140ms cubic-bezier(0.2, 0, 0, 1) both',
        'slide-up': 'slide-up 200ms cubic-bezier(0.2, 0, 0, 1) both',
        'scale-in': 'scale-in 180ms cubic-bezier(0.2, 0, 0, 1) both',
      },
    },
  },
  plugins: [],
};
