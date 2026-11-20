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
  rounds: 1,
  showTimeline: true,
  allowOwnerJoin: true,
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
  const says: { petId: string; leaf: string; data: unknown }[] = [];
  const speakers: string[] = [];
  const memory: SocialMemoryApi = {
    recentFor: async () => [],
    recentForGroup: async () => [],
    setResponseStatus: async (messageId, status) => {
      const index = messages.findIndex((message) => message.messageId === messageId);
      if (index >= 0) messages[index] = { ...messages[index], responseStatus: status };
      return index >= 0;
    },
    listSessions: async () => [],
    session: async () => null,
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
    state: { writePet: (petId, leaf, data) => says.push({ petId, leaf: String(leaf), data }) },
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

test('配置成员不设固定上限，50 只宠物按顺序完成一轮群聊', async () => {
  const participants = Array.from({ length: 50 }, (_, index) => pet(`p${index}`));
  const { director, messages, speakers, lock } = setup({
    readConfig: () => ({ ...config, participantIds: participants.map((item) => item.id), rounds: 1 }),
    readParticipants: () => participants,
  });
  const result = await director.start('p0');
  assert.equal(result.ok, true);
  assert.deepEqual(
    speakers,
    participants.map((item) => item.id),
  );
  assert.equal(messages.length, 50);
  assert.equal(new Set(messages.map((message) => message.groupKey)).size, 1);
  assert.equal(
    messages.every((message) => message.targetId === undefined),
    true,
  );
  assert.equal(
    participants.some((item) => lock.locked(item.id)),
    false,
  );
});

test('群聊跳过不可用成员并按完整轮次发言', async () => {
  const { director, speakers } = setup({
    readConfig: () => ({ ...config, participantIds: ['a', 'b', 'c'], rounds: 2 }),
    readParticipants: () => [pet('a'), pet('b', 'none'), pet('c')],
  });
  const result = await director.start('a');
  assert.equal(result.ok, true);
  assert.deepEqual(speakers, ['a', 'c', 'a', 'c']);
});

test('最后一轮接受的主人消息也会得到回应后才自然结束', async () => {
  let release: ((result: ChatGenerateResult) => void) | undefined;
  let fourthStarted: (() => void) | undefined;
  const fourth = new Promise<void>((resolve) => (fourthStarted = resolve));
  let calls = 0;
  const { director, messages, speakers } = setup({
    generate: async ({ speaker }) => {
      speakers.push(speaker.id);
      calls += 1;
      if (calls === 4) {
        fourthStarted?.();
        return new Promise<ChatGenerateResult>((resolve) => (release = resolve));
      }
      return { ok: true, text: `${speaker.id} 的台词` };
    },
  });
  const running = director.start('a');
  await fourth;
  assert.equal(director.joinOwner().ok, true);
  const accepted = await director.sayOwner('周末一起野餐吗？');
  assert.equal(accepted.ok, true);
  release?.({ ok: true, text: '最后一轮' });
  const result = await running;
  assert.equal(result.ok, true);
  assert.deepEqual(speakers, ['a', 'b', 'a', 'b', 'a']);
  const owner = messages.find((message) => message.speakerType === 'owner');
  assert.equal(owner?.responseStatus, 'answered');
});

test('主人在同一次生成期间连续发言按 FIFO 各得到一次回应', async () => {
  let release: ((result: ChatGenerateResult) => void) | undefined;
  let fourthStarted: (() => void) | undefined;
  const fourth = new Promise<void>((resolve) => (fourthStarted = resolve));
  let calls = 0;
  const responseSnapshots: string[][] = [];
  const { director, messages, speakers } = setup({
    generate: async ({ speaker }) => {
      speakers.push(speaker.id);
      calls += 1;
      if (calls === 4) {
        fourthStarted?.();
        return new Promise<ChatGenerateResult>((resolve) => (release = resolve));
      }
      if (calls > 4) {
        responseSnapshots.push(
          messages.filter((message) => message.speakerType === 'owner').map((message) => message.responseStatus ?? ''),
        );
        return { ok: true, text: `回应 ${calls - 4}` };
      }
      return { ok: true, text: `${speaker.id} 的台词` };
    },
  });
  const running = director.start('a');
  await fourth;
  director.joinOwner();
  assert.equal((await director.sayOwner('第一条')).ok, true);
  assert.equal((await director.sayOwner('第二条')).ok, true);
  release?.({ ok: true, text: '最后一轮' });
  const result = await running;
  assert.equal(result.ok, true);
  assert.deepEqual(speakers, ['a', 'b', 'a', 'b', 'a', 'b']);
  assert.deepEqual(responseSnapshots, [
    ['pending', 'pending'],
    ['answered', 'pending'],
  ]);
  assert.deepEqual(
    messages.filter((message) => message.speakerType === 'owner').map((message) => message.responseStatus),
    ['answered', 'answered'],
  );
});

test('话题会话把快照传给生成器，并按白名单同步动作', async () => {
  const foodTopic = {
    id: 'food',
    title: '周末吃什么',
    keywords: ['美食', '零食'],
    opener: '想吃点什么？',
    followUps: ['喜欢什么口味'],
    conflictKeywords: ['不要'],
  };
  const members = ['a', 'b'].map((id) => ({
    ...pet(id),
    conf: {
      whisperPrompt: id === 'a' ? '喜欢美食' : '喜欢零食',
      animations: { clicks: ['点击回应-开心跃动'] },
    },
    pet: { id },
  }));
  let topicSeen: unknown;
  const { director, messages, says } = setup({
    readConfig: () => ({
      ...config,
      participantIds: ['a', 'b'],
      topics: [foodTopic],
      groupSize: { min: 2, max: 2 },
    }),
    readParticipants: () => members,
    generate: async ({ topic }) => {
      topicSeen = topic;
      return { ok: true, text: '太开心啦！' };
    },
  });
  const result = await director.start('a');
  assert.equal(result.ok, true);
  assert.equal((topicSeen as { title: string } | undefined)?.title, '周末吃什么');
  assert.equal(messages[0]?.topic?.title, '周末吃什么');
  const anim = says.find((item) => item.leaf === 'anim');
  assert.equal(anim?.petId, 'a');
  assert.deepEqual(anim?.data, { name: '点击回应-开心跃动' });
});

test('主人退出后排队消息保留为未回应，不再补生成', async () => {
  let release: ((result: ChatGenerateResult) => void) | undefined;
  let notifyStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => (notifyStarted = resolve));
  let first = true;
  const { director, messages, speakers } = setup({
    generate: async ({ speaker }) => {
      speakers.push(speaker.id);
      if (first) {
        first = false;
        notifyStarted?.();
        return new Promise<ChatGenerateResult>((resolve) => (release = resolve));
      }
      return { ok: true, text: `${speaker.id} 的台词` };
    },
  });
  const running = director.start('a');
  await started;
  director.joinOwner();
  await director.sayOwner('这句不用回应了');
  await director.leaveOwner();
  release?.({ ok: true, text: '第一句' });
  const result = await running;
  assert.equal(result.ok, true);
  assert.equal(speakers.length, 4);
  assert.equal(messages.find((message) => message.speakerType === 'owner')?.responseStatus, 'unanswered');
});
