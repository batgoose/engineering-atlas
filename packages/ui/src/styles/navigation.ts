/**
 * Navigation Styles
 *
 * Header, nav items, and navigation-related components
 */

export const nav = {
  // header bar
  header: 'sticky top-0 z-50 border-b border-slate-800 bg-atlas-dark/80 backdrop-blur-md',
  headerInner: 'flex h-16 items-center justify-between',

  // logo
  logo: 'text-xl font-bold',
  logoAccent: 'text-cyan-400',

  // nav list
  navList: 'hidden md:flex items-center gap-1',

  // nav items
  navItem:
    'px-4 py-2 rounded-md text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800/50 transition-colors',
  navItemActive: 'px-4 py-2 rounded-md text-sm font-medium bg-slate-800 text-white',

  // mobile menu button
  mobileMenuBtn: 'md:hidden p-2 text-slate-400 hover:text-white',

  // framework switcher
  switcherBtn:
    'flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 rounded-full shadow-lg hover:bg-slate-700 transition-colors',
  switcherDropdown:
    'absolute bottom-14 right-0 mb-2 py-2 w-40 bg-slate-800 border border-slate-700 rounded-lg shadow-xl',
  switcherItem:
    'w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-white hover:bg-slate-700',
  switcherItemDisabled:
    'w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-slate-500 cursor-not-allowed',
  switcherItemActive:
    'w-full px-3 py-2 text-left text-sm flex items-center gap-2 bg-slate-700 text-white',
};
