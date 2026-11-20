import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { pruneSocialMessages, socialGroupKey, SocialMemoryStore } from './memory.ts';
import type { SocialMessage } from './types.ts';

let dir = '';
let file = '';
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pet-social-memory-'));
  file = join(dir, 'social-memory.json');
});
after(() => rmSync(dir, { recursive: true, force: true }));

const message = (sessionId: string, speakerId = 'a', targetId: string | undefined = 'b', ts = 1): SocialMessage => ({
  sessionId,
  speakerId,
  targetId,
  text: `${sessionId}-${speakerId}`,
  ts,
});

test('追加与同对宠物双向历史查询', async () => {
  const store = new SocialMemoryStore({ file });
  assert.equal(await store.append(message('s1', 'a', 'b', 1)), true);
  assert.equal(await store.append(message('s1', 'b', 'a', 2)), true);
  assert.equal(await store.append(message('s2', 'a', 'c', 3)), true);
  assert.deepEqual(
    (await store.recentFor('a', 'b', 1)).map((m) => m.text),
    ['s1-b'],
  );
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).length, 3);
});

test('损坏文件按空历史降级，下一次追加可恢复', async () => {
  writeFileSync(file, '{bad');
  const store = new SocialMemoryStore({ file });
  assert.deepEqual(await store.recentFor('a', 'b', 6), []);
  assert.equal(await store.append(message('ok')), true);
  assert.deepEqual(
    (await store.recentFor('a', 'b', 6)).map((m) => m.sessionId),
    ['ok'],
  );
});

test('容量同时限制场次与消息数', () => {
  const many = Array.from({ length: 30 }, (_, i) => message(`s${i}`, 'a', 'b', i));
  const sessions = pruneSocialMessages(many, 3, 200);
  assert.deepEqual([...new Set(sessions.map((m) => m.sessionId))], ['s27', 's28', 's29']);
  assert.deepEqual(
    pruneSocialMessages(many, 20, 4).map((m) => m.sessionId),
    ['s26', 's27', 's28', 's29'],
  );
});

test('并发追加不会丢失记录', async () => {
  const concurrentFile = join(dir, 'concurrent.json');
  const store = new SocialMemoryStore({ file: concurrentFile });
  await Promise.all(Array.from({ length: 12 }, (_, i) => store.append(message('same', 'a', 'b', i))));
  assert.equal((await store.recentFor('a', 'b', 20)).length, 12);
});

test('群聊只读取相同成员组合，历史保留成员快照', async () => {
  const groupFile = join(dir, 'group.json');
  const store = new SocialMemoryStore({ file: groupFile });
  const groupKey = socialGroupKey(['b', 'a']);
  await store.append({
    ...message('group-1', 'a', undefined, 1),
    groupKey,
    participantIds: ['a', 'b'],
    speakerName: '薄荷',
  });
  await store.append({ ...message('group-2', 'a', undefined, 2), groupKey: socialGroupKey(['a', 'c']) });
  assert.deepEqual(
    (await store.recentForGroup(groupKey, 10)).map((item) => item.sessionId),
    ['group-1'],
  );
  const snapshot = await store.session('group-1');
  assert.deepEqual(snapshot?.participantIds, ['a', 'b']);
  assert.deepEqual(snapshot?.participantNames, { a: '薄荷' });
});

test('主人回应状态可更新，历史把遗留等待状态降级为未回应', async () => {
  const ownerFile = join(dir, 'owner.json');
  const store = new SocialMemoryStore({ file: ownerFile });
  await store.append({
    sessionId: 'owner-session',
    messageId: 'owner-1',
    speakerId: 'owner',
    speakerType: 'owner',
    text: '大家好',
    ts: 1,
    responseStatus: 'pending',
  });
  assert.equal((await store.session('owner-session'))?.messages[0]?.responseStatus, 'unanswered');
  assert.equal(await store.setResponseStatus('owner-1', 'answered'), true);
  assert.equal((await store.session('owner-session'))?.messages[0]?.responseStatus, 'answered');
});

test('历史保留取消或失败的最终状态，旧记录默认正常结束', async () => {
  const statusFile = join(dir, 'status.json');
  const store = new SocialMemoryStore({ file: statusFile });
  await store.append(message('cancelled-session'));
  assert.equal((await store.session('cancelled-session'))?.status, 'finished');
  assert.equal(await store.setSessionStatus('cancelled-session', 'cancelled'), true);
  assert.equal((await store.session('cancelled-session'))?.status, 'cancelled');
  assert.equal((await store.listSessions())[0]?.status, 'cancelled');
});
