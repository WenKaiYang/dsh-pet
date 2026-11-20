import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { pruneSocialMessages, SocialMemoryStore } from './memory.ts';
import type { SocialMessage } from './types.ts';

let dir = '';
let file = '';
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pet-social-memory-'));
  file = join(dir, 'social-memory.json');
});
after(() => rmSync(dir, { recursive: true, force: true }));

const message = (sessionId: string, speakerId = 'a', targetId = 'b', ts = 1): SocialMessage => ({
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
