export const nav = {
  header: 'sticky top-0 z-50 border-b border-slate-700/50 bg-atlas-darker/85 backdrop-blur-xl',
  headerInner: 'flex h-16 items-center justify-between',

  navList: 'hidden md:flex items-center gap-1',

  navItem:
    'px-4 py-2 rounded-md font-display text-[13px] font-medium text-slate-400 uppercase tracking-wide hover:text-white hover:bg-white/5 transition-colors',
  navItemActive:
    'px-4 py-2 rounded-md font-display text-[13px] font-medium bg-white/8 text-white border border-white/8 uppercase tracking-wide',

  mobileMenuBtn: 'md:hidden p-2 text-slate-400 hover:text-white',

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
