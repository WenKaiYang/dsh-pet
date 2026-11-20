import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { DEFAULT_SOCIAL_CONFIG, readSocialConfig } from './config.ts';

let dir = '';
let file = '';
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pet-social-config-'));
  file = join(dir, 'social-config.json');
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('缺失文件默认关闭', () => {
  assert.deepEqual(readSocialConfig(file), DEFAULT_SOCIAL_CONFIG);
});

test('合法配置逐字段读取', () => {
  writeFileSync(
    file,
    JSON.stringify({ version: 1, enabled: true, maxTurns: 6, turnGapMs: 800, historyMessages: 4, maxTextChars: 60 }),
  );
  assert.deepEqual(readSocialConfig(file), {
    version: 1,
    enabled: true,
    maxTurns: 6,
    turnGapMs: 800,
    historyMessages: 4,
    maxTextChars: 60,
    participantIds: undefined,
    rounds: 1,
    showTimeline: true,
    allowOwnerJoin: true,
    groupSize: undefined,
    topics: undefined,
  });
});

test('非法字段独立回默认，奇数回合不静默加一', () => {
  writeFileSync(
    file,
    JSON.stringify({ version: 1, enabled: true, maxTurns: 3, turnGapMs: 499, historyMessages: 0, maxTextChars: 201 }),
  );
  const conf = readSocialConfig(file);
  assert.equal(conf.enabled, true);
  assert.equal(conf.maxTurns, 4);
  assert.equal(conf.turnGapMs, 1200);
  assert.equal(conf.historyMessages, 0);
  assert.equal(conf.maxTextChars, 80);
});

test('损坏 JSON 与不支持的版本均安全关闭', () => {
  writeFileSync(file, '{bad');
  assert.equal(readSocialConfig(file).enabled, false);
  writeFileSync(file, JSON.stringify({ version: 2, enabled: true }));
  assert.equal(readSocialConfig(file).enabled, false);
});

test('群聊成员去重且不设置人数上限，旧配置仍走双人模式', () => {
  const participantIds = Array.from({ length: 50 }, (_, index) => `pet-${index}`);
  writeFileSync(
    file,
    JSON.stringify({
      enabled: true,
      participantIds: [...participantIds, 'pet-1', ''],
      rounds: 3,
      showTimeline: false,
      allowOwnerJoin: false,
    }),
  );
  const conf = readSocialConfig(file);
  assert.deepEqual(conf.participantIds, participantIds);
  assert.equal(conf.rounds, 3);
  assert.equal(conf.showTimeline, false);
  assert.equal(conf.allowOwnerJoin, false);
});

test('话题卡与人数区间被规范化，非法项单独忽略', () => {
  writeFileSync(
    file,
    JSON.stringify({
      enabled: true,
      groupSize: { min: 2, max: 3 },
      topics: [
        {
          id: 'food',
          title: '吃什么',
          keywords: ['美食'],
          opener: '想吃点什么？',
          followUps: ['口味'],
          conflictKeywords: ['不要'],
        },
        { id: '', title: '', keywords: [] },
        { id: 'food', title: '重复', keywords: ['重复'], opener: '重复' },
      ],
    }),
  );
  const conf = readSocialConfig(file);
  assert.deepEqual(conf.groupSize, { min: 2, max: 3 });
  assert.deepEqual(conf.topics, [
    {
      id: 'food',
      title: '吃什么',
      keywords: ['美食'],
      opener: '想吃点什么？',
      followUps: ['口味'],
      conflictKeywords: ['不要'],
    },
  ]);
});

test('非法人数区间回退缺省，不夹取掩盖配置错误', () => {
  writeFileSync(file, JSON.stringify({ enabled: true, groupSize: { min: 1, max: 1 } }));
  assert.equal(readSocialConfig(file).groupSize, undefined);
});
