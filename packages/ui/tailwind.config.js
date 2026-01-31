/** @type {import('tailwindcss').Config} */

// helper to allow opacity usage with CSS variables
function withOpacity(variableName) {
  return ({ opacityValue }) => {
    if (opacityValue !== undefined) {
      return `rgb(var(${variableName}) / ${opacityValue})`;
    }
    return `rgb(var(${variableName}))`;
  };
}

module.exports = {
  // use a preset so it doesn't overwrite the app's 'content' array
  theme: {
    extend: {
      colors: {
        frontend: withOpacity('--frontend'),
        backend: withOpacity('--backend'),
        systems: withOpacity('--systems'),
        devops: withOpacity('--devops'),
        data: withOpacity('--data'),
        security: withOpacity('--security'),
        business: withOpacity('--business'),
        core: withOpacity('--core'),
        
        'atlas-dark': withOpacity('--atlas-dark'),
        'atlas-panel': withOpacity('--atlas-panel'),
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'monospace'],
      }
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};