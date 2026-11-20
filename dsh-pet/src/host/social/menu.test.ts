import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MenuRegistry } from '../menu.ts';
import { createSocialMenu, SOCIAL_MENU_OWNER, SOCIAL_MENU_START, SOCIAL_MENU_STOP } from './menu.ts';

/** 等一个微任务回合，让菜单循环消费闩锁。 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('菜单复用同一注册表，开始与结束事件分别进入 director', async () => {
  const registry = new MenuRegistry();
  const sections: unknown[] = [];
  const started: string[] = [];
  let cancelled = 0;
  const menu = createSocialMenu({
    menuRegistry: registry,
    state: { writeSection: (_name, data) => sections.push(data) },
    director: {
      start: async (petId) => {
        started.push(petId);
        return { ok: false, reason: 'cancelled' };
      },
      cancel: () => {
        cancelled += 1;
        return true;
      },
    },
    log: {},
  });
  menu.start();
  assert.equal(registry.snapshot()[0]?.owner, SOCIAL_MENU_OWNER);
  registry.click({ owner: SOCIAL_MENU_OWNER, label: SOCIAL_MENU_START, pet: 'a' });
  registry.click({ owner: SOCIAL_MENU_OWNER, label: SOCIAL_MENU_STOP, pet: 'a' });
  await flush();
  assert.deepEqual(started, ['a']);
  assert.equal(cancelled, 1);
  await menu.stop();
  assert.equal(registry.snapshot().length, 0);
  assert.equal(sections.length, 2);
});

test('重复 start 不创建第二个消费者，stop 幂等', async () => {
  const registry = new MenuRegistry();
  const menu = createSocialMenu({
    menuRegistry: registry,
    state: { writeSection() {} },
    director: { start: async () => ({ ok: false, reason: 'disabled' }), cancel: () => false },
    log: {},
  });
  menu.start();
  menu.start();
  assert.equal(registry.snapshot().length, 3);
  await menu.stop();
  await menu.stop();
  assert.equal(registry.snapshot().length, 0);
});
