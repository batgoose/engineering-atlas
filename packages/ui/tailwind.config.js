/** @type {import('tailwindcss').Config} */

function withOpacity(variableName) {
  return ({ opacityValue }) => {
    if (opacityValue !== undefined) {
      return `rgb(var(${variableName}) / ${opacityValue})`;
    }
    return `rgb(var(${variableName}))`;
  };
}

module.exports = {
  theme: {
    extend: {
      fontFamily: {
        display: ['"Chakra Petch"', 'system-ui', 'sans-serif'],
        body: ['"Familjen Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        frontend: withOpacity('--frontend'),
        'frontend-light': withOpacity('--frontend-light'),
        'frontend-bright': withOpacity('--frontend-bright'),
        'atlas-dark': withOpacity('--atlas-dark'),
        'atlas-darker': withOpacity('--atlas-darker'),
        'atlas-panel': withOpacity('--atlas-panel'),
      },
      backgroundImage: {
        'cosmic-metallic': `
          url("data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PScwIDAgMjAwIDIwMCcgeG1sbnM9J2h0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnJz48ZmlsdGVyIGlkPSdub2lzZUZpbHRlcic+PGZlVHVyYnVsZW5jZSB0eXBlPSdmcmFjdGFsTm9pc2UnIGJhc2VGcmVxdWVuY3k9JzIuODUnIG51bU9jdGF2ZXM9JzMnIHN0aXRjaFRpbGVzPSdzdGl0Y2gnLz48L2ZpbHRlcj48cmVjdCB3aWR0aD0nMTAwJScgaGVpZ2h0PScxMDAlJyBvcGFjaXR5PScwLjQ1JyBmaWx0ZXI9J3VybCgjbm9pc2VGaWx0ZXIpJy8+PC9zdmc+"),
          linear-gradient(180deg, #D97736 0%, #A63C14 100%)
        `,
        'techwoven-blue': `
          repeating-linear-gradient(45deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 4px),
          repeating-linear-gradient(-45deg, rgba(0,0,0,0.2) 0px, rgba(0,0,0,0.2) 1px, transparent 1px, transparent 4px),
          linear-gradient(to bottom, #182235, #141b29)
        `,
      },
      boxShadow: {
        'metallic-edge': 'inset 0 1px 0 0 rgba(255, 255, 255, 0.15), 0 4px 6px rgba(0,0,0,0.4)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
