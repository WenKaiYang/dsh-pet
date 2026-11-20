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
