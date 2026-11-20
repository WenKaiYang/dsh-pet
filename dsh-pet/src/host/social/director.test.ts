import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatGenerateResult } from '../chat.ts';
import { LockStore } from '../lock.ts';
import { SleepStore } from '../sleep.ts';
import { SocialDirector, type SocialDirectorDeps, type SocialMemoryApi } from './director.ts';
import type { SocialConfig, SocialMessage, SocialParticipant } from './types.ts';

const config: SocialConfig = {
  version: 1,
  enabled: true,
  maxTurns: 4,
  turnGapMs: 500,
  historyMessages: 6,
  maxTextChars: 80,
};
const pet = (id: string, display = 'web'): SocialParticipant => ({
  id,
  entry: 'main',
  name: id === 'a' ? '薄荷' : id === 'b' ? '可可' : id,
  display,
  conf: { whisperPrompt: `${id} 的人设` },
  pet: { id, display },
});

function setup(overrides: Partial<SocialDirectorDeps> = {}) {
  const lock = new LockStore();
  const sleep = new SleepStore();
  const messages: SocialMessage[] = [];
  const says: { petId: string; data: unknown }[] = [];
  const speakers: string[] = [];
  const memory: SocialMemoryApi = {
    recentFor: async () => [],
    append: async (message) => {
      messages.push(message);
      return true;
    },
  };
  const deps: SocialDirectorDeps = {
    readConfig: () => config,
    readParticipants: () => [pet('a'), pet('b')],
    voiceConfigured: () => true,
    memory,
    generate: async ({ speaker }): Promise<ChatGenerateResult> => {
      speakers.push(speaker.id);
      return { ok: true, text: `${speaker.id} 的台词` };
    },
    lock,
    sleep,
    state: { writePet: (petId, _leaf, data) => says.push({ petId, data }) },
    log: { warn() {} },
    now: () => 1000,
    random: () => 0,
    delay: async () => undefined,
    ...overrides,
  };
  return { director: new SocialDirector(deps), deps, lock, sleep, messages, says, speakers };
}

test('完整四轮按 A/B/A/B 发言，保存记忆并释放双方锁', async () => {
  const { director, lock, messages, says, speakers } = setup();
  const result = await director.start('a');
  assert.deepEqual(result, { ok: true, sessionId: 'social-rs-1', partnerId: 'b', status: 'finished' });
  assert.deepEqual(speakers, ['a', 'b', 'a', 'b']);
  assert.equal(messages.length, 4);
  assert.equal(says.filter((say) => (say.data as { text?: string }).text?.includes('的台词')).length, 4);
  assert.equal(lock.locked('a'), false);
  assert.equal(lock.locked('b'), false);
});

test('没有伙伴时不调用模型', async () => {
  let called = false;
  const { director, says } = setup({
    readParticipants: () => [pet('a')],
    generate: async () => {
      called = true;
      return { ok: true, text: '不应生成' };
    },
  });
  assert.deepEqual(await director.start('a'), { ok: false, reason: 'unavailable' });
  assert.equal(called, false);
  assert.equal((says[0]?.data as { text?: string }).text, '现在没有能陪我聊天的伙伴。');
});

test('组锁第二只失败时回滚第一只', async () => {
  const real = new LockStore();
  const guarded: SocialDirectorDeps['lock'] = {
    acquire: (args) =>
      args.petId === 'b' && !args.lockId
        ? { ok: false, reason: 'locked', expiresAt: 1, message: 'busy' }
        : real.acquire(args),
    release: (args) => real.release(args),
    current: (petId) => real.current(petId),
    locked: (petId) => real.locked(petId),
  };
  const { director } = setup({ lock: guarded });
  assert.deepEqual(await director.start('a'), { ok: false, reason: 'lock-failed' });
  assert.equal(real.locked('a'), false);
  assert.equal(real.locked('b'), false);
});

test('取消后晚到的模型结果不写气泡或记忆', async () => {
  let release: ((result: ChatGenerateResult) => void) | undefined;
  let started: (() => void) | undefined;
  const generationStarted = new Promise<void>((resolve) => (started = resolve));
  const { director, lock, messages, says } = setup({
    generate: () => {
      started?.();
      return new Promise<ChatGenerateResult>((resolve) => (release = resolve));
    },
  });
  const running = director.start('a');
  await generationStarted;
  assert.equal(director.cancel(), true);
  assert.equal(lock.locked('a'), false);
  assert.equal(lock.locked('b'), false);
  release?.({ ok: true, text: '晚到的话' });
  const result = await running;
  assert.equal(result.ok, false);
  assert.equal(messages.length, 0);
  assert.equal(says.length, 0);
  assert.equal(lock.locked('a'), false);
  assert.equal(lock.locked('b'), false);
});

test('活动会话不允许叠加，生成失败也会释放锁', async () => {
  let release: ((result: ChatGenerateResult) => void) | undefined;
  const { director, lock } = setup({
    generate: () => new Promise<ChatGenerateResult>((resolve) => (release = resolve)),
  });
  const running = director.start('a');
  assert.deepEqual(await director.start('a'), { ok: false, reason: 'busy' });
  release?.({ ok: false, reason: 'generate-error', message: 'test failure' });
  const result = await running;
  assert.equal(result.ok, false);
  assert.equal(lock.locked('a'), false);
  assert.equal(lock.locked('b'), false);
});

test('用户强制抢占任一锁后，结果不再演出', async () => {
  const { director, lock, says } = setup({
    generate: async () => {
      lock.release({ petId: 'b', force: true });
      return { ok: true, text: '不应显示' };
    },
  });
  const result = await director.start('a');
  assert.equal(result.ok, false);
  assert.equal(says.length, 0);
  assert.equal(lock.locked('a'), false);
});
