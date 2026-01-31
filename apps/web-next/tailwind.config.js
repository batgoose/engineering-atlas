/** @type {import('tailwindcss').Config} */
module.exports = {
  // use the shared config from packages/ui
  presets: [
    require('@atlas/ui/tailwind.config')
  ],
  
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    
    require.resolve('@atlas/ui/package.json').replace('package.json', 'src/**/*.{js,ts,jsx,tsx}')
  ],
  
  darkMode: 'class', 
};