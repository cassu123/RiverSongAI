/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      screens: {
        'rail': '1200px',
      },
      // ── Material You 3 color roles ────────────────────────────────────────
      colors: {
        // Primary
        primary:             'var(--md-primary)',
        'on-primary':        'var(--md-on-primary)',
        'primary-container': 'var(--md-primary-container)',
        'on-primary-container': 'var(--md-on-primary-container)',
        // Secondary
        secondary:             'var(--md-secondary)',
        'on-secondary':        'var(--md-on-secondary)',
        'secondary-container': 'var(--md-secondary-container)',
        'on-secondary-container': 'var(--md-on-secondary-container)',
        // Tertiary
        tertiary:             'var(--md-tertiary)',
        'on-tertiary':        'var(--md-on-tertiary)',
        'tertiary-container': 'var(--md-tertiary-container)',
        'on-tertiary-container': 'var(--md-on-tertiary-container)',
        // Error
        error:             'var(--md-error)',
        'on-error':        'var(--md-on-error)',
        'error-container': 'var(--md-error-container)',
        'on-error-container': 'var(--md-on-error-container)',
        // Surface
        background:    'var(--md-background)',
        'on-background': 'var(--md-on-background)',
        surface:       'var(--md-surface)',
        'on-surface':  'var(--md-on-surface)',
        'surface-variant': 'var(--md-surface-variant)',
        'on-surface-variant': 'var(--md-on-surface-variant)',
        'surface-container-lowest':  'var(--md-surface-container-lowest)',
        'surface-container-low':     'var(--md-surface-container-low)',
        'surface-container':         'var(--md-surface-container)',
        'surface-container-high':    'var(--md-surface-container-high)',
        'surface-container-highest': 'var(--md-surface-container-highest)',
        // Outline
        outline:         'var(--md-outline)',
        'outline-variant': 'var(--md-outline-variant)',
        // Inverse
        'inverse-surface':    'var(--md-inverse-surface)',
        'inverse-on-surface': 'var(--md-inverse-on-surface)',
        'inverse-primary':    'var(--md-inverse-primary)',
        scrim: 'var(--md-scrim)',
      },

      // ── Material You type scale ───────────────────────────────────────────
      fontFamily: {
        sans:  ['Roboto', 'system-ui', 'sans-serif'],
        mono:  ['Roboto Mono', 'monospace'],
      },
      fontSize: {
        // Display
        'display-lg': ['3.5625rem', { lineHeight: '4rem',    letterSpacing: '-0.016em' }],
        'display-md': ['2.8125rem', { lineHeight: '3.25rem', letterSpacing: '0' }],
        'display-sm': ['2.25rem',   { lineHeight: '2.75rem', letterSpacing: '0' }],
        // Headline
        'headline-lg': ['2rem',    { lineHeight: '2.5rem',  letterSpacing: '0' }],
        'headline-md': ['1.75rem', { lineHeight: '2.25rem', letterSpacing: '0' }],
        'headline-sm': ['1.5rem',  { lineHeight: '2rem',    letterSpacing: '0' }],
        // Title
        'title-lg': ['1.375rem', { lineHeight: '1.75rem', letterSpacing: '0' }],
        'title-md': ['1rem',     { lineHeight: '1.5rem',  letterSpacing: '0.009em', fontWeight: '500' }],
        'title-sm': ['0.875rem', { lineHeight: '1.25rem', letterSpacing: '0.006em', fontWeight: '500' }],
        // Body
        'body-lg': ['1rem',     { lineHeight: '1.5rem',  letterSpacing: '0.031em' }],
        'body-md': ['0.875rem', { lineHeight: '1.25rem', letterSpacing: '0.016em' }],
        'body-sm': ['0.75rem',  { lineHeight: '1rem',    letterSpacing: '0.025em' }],
        // Label
        'label-lg': ['0.875rem', { lineHeight: '1.25rem', letterSpacing: '0.006em', fontWeight: '500' }],
        'label-md': ['0.75rem',  { lineHeight: '1rem',    letterSpacing: '0.031em', fontWeight: '500' }],
        'label-sm': ['0.6875rem',{ lineHeight: '1rem',    letterSpacing: '0.031em', fontWeight: '500' }],
      },

      // ── M3 elevation & shape ─────────────────────────────────────────────
      borderRadius: {
        'none':    '0',
        'xs':      '4px',
        'sm':      '8px',
        'md':      '12px',
        'lg':      '16px',
        'xl':      '20px',
        '2xl':     '24px',
        '3xl':     '28px',
        'full':    '9999px',
      },
      boxShadow: {
        // M3 elevation tokens (dark theme — lighter shadows)
        'elevation-1': '0px 1px 2px rgba(0,0,0,.3), 0px 1px 3px 1px rgba(0,0,0,.15)',
        'elevation-2': '0px 1px 2px rgba(0,0,0,.3), 0px 2px 6px 2px rgba(0,0,0,.15)',
        'elevation-3': '0px 4px 8px 3px rgba(0,0,0,.15), 0px 1px 3px rgba(0,0,0,.3)',
        'elevation-4': '0px 6px 10px 4px rgba(0,0,0,.15), 0px 2px 3px rgba(0,0,0,.3)',
        'elevation-5': '0px 8px 12px 6px rgba(0,0,0,.15), 0px 4px 4px rgba(0,0,0,.3)',
      },

      // ── State layer opacities ─────────────────────────────────────────────
      opacity: {
        'state-hover':   '0.08',
        'state-focus':   '0.12',
        'state-pressed': '0.12',
        'state-dragged': '0.16',
      },

      // ── Animation ────────────────────────────────────────────────────────
      transitionDuration: {
        'short1': '50ms',
        'short2': '100ms',
        'short3': '150ms',
        'short4': '200ms',
        'medium1': '250ms',
        'medium2': '300ms',
        'medium3': '350ms',
        'medium4': '400ms',
        'long1': '450ms',
        'long2': '500ms',
      },
      transitionTimingFunction: {
        'standard':           'cubic-bezier(0.2, 0, 0, 1)',
        'standard-accelerate':'cubic-bezier(0.3, 0, 1, 1)',
        'standard-decelerate':'cubic-bezier(0, 0, 0, 1)',
        'emphasized':         'cubic-bezier(0.2, 0, 0, 1)',
      },
    },
  },
  plugins: [],
}
