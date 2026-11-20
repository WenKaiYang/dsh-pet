import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RouteResult } from '../http.ts';
import { createSocialRoute } from './route.ts';
import type { SocialSessionSnapshot } from './types.ts';

const snapshot: SocialSessionSnapshot = {
  id: 's1',
  status: 'active',
  startedAt: 1,
  updatedAt: 2,
  participantIds: ['a', 'b'],
  participantNames: { a: '薄荷', b: '可可' },
  revision: 2,
  messageCount: 1,
  messages: [{ sessionId: 's1', speakerId: 'a', text: '你好', ts: 1 }],
  ownerJoined: false,
  allowOwnerJoin: true,
};

function body(result: RouteResult | undefined): Record<string, unknown> {
  assert.equal(result?.kind, 'json');
  return (result as Extract<RouteResult, { kind: 'json' }>).obj as Record<string, unknown>;
}

test('时间线读取活跃会话并支持修订号不变响应', async () => {
  const route = createSocialRoute({
    sessions: async () => [snapshot],
    snapshotFor: async (id) => (id === 's1' ? snapshot : null),
    joinOwner: () => ({ ok: true }),
    sayOwner: async () => ({ ok: true }),
    leaveOwner: async () => true,
    cancel: () => true,
  });
  const list = body(await route('/dsh-pet-7340/social/sessions', 'GET'));
  assert.equal(list.ok, true);
  assert.equal((list.sessions as unknown[]).length, 1);
  const current = body(await route('/dsh-pet-7340/social/session?id=s1', 'GET'));
  assert.equal((current.session as SocialSessionSnapshot).participantIds.length, 2);
  assert.equal(body(await route('/dsh-pet-7340/social/session?id=s1&afterRevision=2', 'GET')).unchanged, true);
  assert.equal(await route('/dsh-pet-7340/state', 'GET'), undefined);
});

test('主人加入、发言、退出和结束均进入导演', async () => {
  const calls: string[] = [];
  const route = createSocialRoute({
    sessions: async () => [],
    snapshotFor: async () => null,
    joinOwner: () => {
      calls.push('join');
      return { ok: true };
    },
    sayOwner: async (text) => {
      calls.push(`say:${text}`);
      return { ok: true, message: snapshot.messages[0] };
    },
    leaveOwner: async () => {
      calls.push('leave');
      return true;
    },
    cancel: () => {
      calls.push('stop');
      return true;
    },
  });
  await route('/dsh-pet-7340/social/owner/join', 'POST');
  await route('/dsh-pet-7340/social/owner/messages', 'POST', JSON.stringify({ text: '大家好' }));
  await route('/dsh-pet-7340/social/owner/leave', 'POST');
  await route('/dsh-pet-7340/social/stop', 'POST');
  assert.deepEqual(calls, ['join', 'say:大家好', 'leave', 'stop']);
});

test('错误会话、输入和业务状态有明确应答', async () => {
  const route = createSocialRoute({
    sessions: async () => [],
    snapshotFor: async () => null,
    joinOwner: () => ({ ok: false, reason: 'no-session' }),
    sayOwner: async () => ({ ok: false, reason: 'not-joined' }),
    leaveOwner: async () => false,
    cancel: () => false,
  });
  const missing = await route('/dsh-pet-7340/social/session?id=none', 'GET');
  assert.equal(missing?.kind === 'json' && missing.status, 404);
  assert.equal(body(await route('/dsh-pet-7340/social/owner/join', 'POST')).error, 'no-session');
  assert.equal(body(await route('/dsh-pet-7340/social/owner/messages', 'POST', '{bad')).error, 'invalid-json');
  assert.equal(body(await route('/dsh-pet-7340/social/owner/messages', 'POST')).error, 'invalid-input');
  assert.equal(
    body(await route('/dsh-pet-7340/social/owner/messages', 'POST', '{"text":"大家好"}')).error,
    'not-joined',
  );
});
