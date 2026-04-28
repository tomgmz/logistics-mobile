/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0F2A4A',
          light:   '#1A3D6B',
          dark:    '#081828',
        },

        surface: {
          bg:      '#0a0a0a',
          card:    '#141414',
          raised:  '#1a1a1a',
          elevated:'#1e1e1e',
          border:  '#2a2a2a',
          divider: '#3a3a3a',
          overlay: '#444444',
        },

        ink: {
          primary:   '#ffffff',
          secondary: '#d4d4d4',
          muted:     '#999999',
          faint:     '#818181',
          disabled:  '#555555',
        },

        cyan: {
          DEFAULT: '#4df9ed',
          dim:     'rgba(77,249,237,0.12)',
          glow:    'rgba(77,249,237,0.06)',
          border:  'rgba(77,249,237,0.30)',
          accent:  'rgba(77,249,237,0.15)',
        },

        error: {
          DEFAULT: '#ff4d4d',
          dim:     'rgba(255,77,77,0.10)',
        },

        success: {
          DEFAULT: '#3af626',
        },
      },

      borderRadius: {
        '2xl': '16px',
        '3xl': '24px',
      },

      fontSize: {
        '2xs': ['10px', { lineHeight: '14px' }],
        '3xs': ['9px',  { lineHeight: '12px' }],
      },

      boxShadow: {
        'card-dark':    '0 2px 8px rgba(0,0,0,0.5)',
        'card-dark-lg': '0 4px 16px rgba(0,0,0,0.6)',
      },
    },
  },
  plugins: [],
}