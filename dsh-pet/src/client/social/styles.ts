import { SOCIAL_PANEL_CSS } from './panel-css.ts';

const STYLE_KEY = 'dsh-pet-social-panel';
let mountedCount = 0;
let styleTag: HTMLStyleElement | undefined;

export function injectSocialCss(): () => void {
  if (typeof document === 'undefined') return () => {};
  mountedCount += 1;
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.dataset.dshPetCss = STYLE_KEY;
    styleTag.textContent = SOCIAL_PANEL_CSS;
    document.head.appendChild(styleTag);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    mountedCount -= 1;
    if (mountedCount === 0 && styleTag) {
      styleTag.remove();
      styleTag = undefined;
    }
  };
}
