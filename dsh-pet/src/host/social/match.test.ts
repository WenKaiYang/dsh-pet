import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scoreMember, selectTopicParticipants } from './match.ts';
import type { SocialConfig, SocialParticipant, SocialTopicCard } from './types.ts';

const topic: SocialTopicCard = {
  id: 'food',
  title: '周末吃什么',
  keywords: ['美食', '零食'],
  opener: '想吃什么？',
  followUps: [],
  conflictKeywords: [],
};

const pet = (id: string, persona: string): SocialParticipant => ({
  id,
  entry: 'main',
  name: id,
  display: 'web',
  conf: { whisperPrompt: persona },
  pet: { id },
});

const config: SocialConfig = {
  version: 1,
  enabled: true,
  maxTurns: 4,
  turnGapMs: 500,
  historyMessages: 6,
  maxTextChars: 80,
  participantIds: ['a', 'b', 'c'],
  rounds: 1,
  showTimeline: true,
  allowOwnerJoin: true,
  groupSize: { min: 2, max: 2 },
  topics: [topic],
};

test('相关性高且近期发言少的成员评分更高', () => {
  const relevant = scoreMember(pet('b', '喜欢美食零食'), topic, 0);
  const quietRelevant = scoreMember(pet('c', '喜欢美食'), topic, 1);
  assert.ok(relevant.score > quietRelevant.score);
});

test('发起人排在首位，其余成员按评分和人数上限选择', () => {
  const initiator = pet('a', '喜欢美食');
  const selected = selectTopicParticipants({
    initiator,
    eligible: [initiator, pet('b', '喜欢零食'), pet('c', '喜欢旅行')],
    config,
    topic,
    recentCounts: {},
  });
  assert.deepEqual(
    selected.map((item) => item.id),
    ['a', 'b'],
  );
});
