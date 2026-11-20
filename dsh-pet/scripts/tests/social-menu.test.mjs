import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

function setup() {
  const calls = [];
  let mountOptions;
  function PetSprite() {}
  const context = {
    PetSprite,
    BASE: 'http://127.0.0.1:3080/dsh-pet-7340',
    OPEN_LABEL: {},
    OPEN_TARGET: 'standalone',
    OPEN_SHORTCUT_HINT: '',
    S: {
      isSleepAllowedAction: () => true,
      postAction: (url, body) => {
        calls.push({ url, body });
        return Promise.resolve();
      },
      mountSocialDialog: (options) => {
        mountOptions = options;
        return { close: () => options.onClose() };
      },
    },
    window: { __dshPetDebug: {} },
    console,
  };
  vm.runInNewContext(
    readFileSync(new URL('../../runtime/electron-helper/sprite/menu.js', import.meta.url), 'utf8'),
    context,
  );
  const sprite = new PetSprite();
  Object.assign(sprite, {
    pet: { id: 'main' },
    sleeping: false,
    frozen: false,
    socialMount: null,
    socialOpen: false,
    chatOpen: false,
    todoOpen: false,
    menuOpen: false,
    closeMenu() {},
    hit: { getBoundingClientRect: () => ({ right: 100, top: 50 }) },
    visibleClampRect: () => ({ x: 0, y: 0, w: 800, h: 600 }),
    syncInputBusy() {},
    setInteractive() {},
  });
  return { sprite, calls, mountOptions: () => mountOptions, context };
}

test('桌面“查看群聊”菜单打开共享弹窗并保留原点击上报', () => {
  const { sprite, calls, mountOptions, context } = setup();
  sprite.onMenuAction({ action: 'third-party', owner: 'pet-social', label: '查看群聊' });
  assert.equal(sprite.socialOpen, true);
  assert.equal(context.window.__dshPetDebug.socialOpen, true);
  assert.equal(mountOptions().baseUrl, 'http://127.0.0.1:3080/dsh-pet-7340/social');
  assert.equal(calls[0].body.owner, 'pet-social');
  sprite.toggleSocial();
  assert.equal(sprite.socialOpen, false);
  assert.equal(sprite.socialMount, null);
  assert.equal(context.window.__dshPetDebug.socialOpen, false);
});
