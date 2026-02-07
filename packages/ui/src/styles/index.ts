/**
 * Shared Styles
 *
 * Tailwind class strings organized by category
 *
 * Usage:
 *   import { layout, typography, buttons } from '@atlas/ui/styles';
 *   <section className={layout.section}>
 *   <h1 className={typography.h1}>
 *   <button className={buttons.primary}>
 */

export { layout } from './layout';
export { typography } from './typography';
export { buttons, inputs } from './interactive';
export { cards, badges, card_buttons } from './cards';
export { nav } from './navigation';
export { hero, atlas, about, contact, demos } from './pages';
export { codeWindow, syntax } from './code-window';

// re-export everything as a single object for convenience
import { layout } from './layout';
import { typography } from './typography';
import { buttons, inputs } from './interactive';
import { cards, badges, card_buttons } from './cards';
import { nav } from './navigation';
import { hero, atlas, about, contact, demos } from './pages';
import { codeWindow, syntax } from './code-window';

export const styles = {
  layout,
  typography,
  buttons,
  card_buttons,
  inputs,
  cards,
  badges,
  nav,
  hero,
  atlas,
  about,
  contact,
  demos,
  codeWindow,
  syntax,
};
