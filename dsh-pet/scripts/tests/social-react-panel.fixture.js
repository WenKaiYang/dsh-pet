import { createElement, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { makeSocialPanel } from '../../src/client/social/panel.ts';
import { injectSocialCss } from '../../src/client/social/styles.ts';

const Panel = makeSocialPanel({ h: createElement, useState, useEffect, useRef });
window.mountReactSocial = () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const disposeCss = injectSocialCss();
  const root = createRoot(container);
  root.render(createElement(Panel));
  return () => {
    root.unmount();
    container.remove();
    disposeCss();
  };
};
