import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SocialParticipant, SocialTopicCard } from './types.ts';
import {
  isRepeatedSocialText,
  nextFollowUp,
  openTopicSnapshot,
  scoreTopic,
  selectTopic,
  stageForTopic,
} from './topics.ts';

const pet = (id: string, persona: string): SocialParticipant => ({
  id,
  entry: 'main',
  name: id,
  display: 'web',
  conf: { whisperPrompt: persona },
  pet: { id },
});

const food: SocialTopicCard = {
  id: 'food',
  title: '周末吃什么',
  keywords: ['美食', '零食', '口味'],
  opener: '周末想吃点什么？',
  followUps: ['喜欢什么口味', '要不要换餐厅'],
  conflictKeywords: ['不要', '拒绝'],
};

test('话题按成员人设关键词评分并选择最高分话题', () => {
  const travel: SocialTopicCard = {
    id: 'travel',
    title: '去哪里玩',
    keywords: ['旅行', '风景'],
    opener: '周末去哪玩？',
    followUps: [],
    conflictKeywords: [],
  };
  const members = [pet('a', '喜欢美食和零食'), pet('b', '安静')];
  assert.equal(scoreTopic(food, members), 2);
  assert.equal(selectTopic([travel, food], members)?.id, 'food');
});

test('追问按配置顺序选择未使用项', () => {
  const used = ['喜欢什么口味'];
  assert.equal(nextFollowUp(food, used), '要不要换餐厅');
  assert.equal(nextFollowUp(food, [...food.followUps]), undefined);
});

test('话题阶段按开场、冲突和收尾推进', () => {
  assert.equal(
    stageForTopic({
      messageCount: 0,
      totalTurns: 4,
      latestText: '',
      recentTexts: [],
      usedFollowUps: [],
      conflictKeywords: food.conflictKeywords,
    }),
    'opening',
  );
  assert.equal(
    stageForTopic({
      messageCount: 1,
      totalTurns: 4,
      latestText: '我拒绝这个提议',
      recentTexts: ['我拒绝'],
      usedFollowUps: [],
      conflictKeywords: food.conflictKeywords,
    }),
    'conflict',
  );
  assert.equal(
    stageForTopic({
      messageCount: 3,
      totalTurns: 4,
      latestText: '差不多吧',
      recentTexts: ['差不多吧'],
      usedFollowUps: ['喜欢什么口味'],
      conflictKeywords: food.conflictKeywords,
    }),
    'closing',
  );
});

test('重复台词按完全相同或高重叠识别', () => {
  assert.equal(isRepeatedSocialText('今天天气真好呀', ['今天天气真好呀']), true);
  assert.equal(isRepeatedSocialText('今天晚上我们去吃火锅吧', ['今天晚上我们去吃烤肉吧']), false);
});

test('开场快照固定话题元数据', () => {
  assert.deepEqual(openTopicSnapshot(food), {
    topicId: 'food',
    title: '周末吃什么',
    opener: '周末想吃点什么？',
    stage: 'opening',
    usedFollowUps: [],
  });
});
