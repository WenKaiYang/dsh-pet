import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatGenerateInput, ChatGenerateResult } from '../chat.ts';
import { cleanSocialText, generateSocialTurn, socialHistoryFor } from './generate.ts';
import type { SocialMessage, SocialParticipant } from './types.ts';

const pet = (id: string, name: string, persona: string): SocialParticipant => ({
  id,
  entry: 'main',
  name,
  display: 'web',
  conf: { whisperPrompt: persona },
  pet: { id, name },
});
const a = pet('a', '薄荷', '安静温柔');
const b = pet('b', '可可', '活泼直率');
const history: SocialMessage[] = [
  { sessionId: 's', speakerId: 'a', targetId: 'b', text: '今天还好吗？', ts: 1 },
  { sessionId: 's', speakerId: 'b', targetId: 'a', text: '很好呀！', ts: 2 },
];

test('历史按当前发言者重新映射，保留对方名字，并满足独立模式的首条 user 约束', () => {
  assert.deepEqual(socialHistoryFor(history, a, [a, b]), [
    { role: 'user', content: '你与其他成员开始了一场桌宠群聊。', ts: 1 },
    { role: 'assistant', content: '今天还好吗？', ts: 1 },
    { role: 'user', content: '可可：很好呀！', ts: 2 },
  ]);
  assert.deepEqual(socialHistoryFor(history, b, [a, b])[0], { role: 'user', content: '薄荷：今天还好吗？', ts: 1 });
});

test('清洗格式标记并按字符数截断', () => {
  assert.equal(cleanSocialText('```text\n**你好** [动作:跳] [图:笑] 😀😀```', 20), '你好 😀😀');
  assert.equal([...cleanSocialText('😀😀😀', 2)].length, 2);
});

test('生成使用人设和空图片动作池，不把社交内容写成主人原文', async () => {
  let captured: ChatGenerateInput | undefined;
  const generate = async (input: ChatGenerateInput): Promise<ChatGenerateResult> => {
    captured = input;
    return { ok: true, text: '我很好，你呢？' };
  };
  const result = await generateSocialTurn({
    ctx: {} as ChatGenerateInput['ctx'],
    speaker: a,
    participants: [a, b],
    messages: history,
    maxTextChars: 80,
    generate,
  });
  assert.deepEqual(result, { ok: true, text: '我很好，你呢？' });
  assert.ok(captured);
  assert.match(captured.system, /安静温柔/);
  assert.match(captured.system, /桌宠群聊/);
  assert.deepEqual(captured.pool, []);
  assert.deepEqual(captured.actions, []);
  assert.equal(captured.history[0]?.role, 'user');
  assert.equal(captured.history[2]?.content, '可可：很好呀！');
});

test('话题快照进入生成上下文，模型仍只收到空动作图片池', async () => {
  let captured: ChatGenerateInput | undefined;
  const generate = async (input: ChatGenerateInput): Promise<ChatGenerateResult> => {
    captured = input;
    return { ok: true, text: '围绕话题回应一句' };
  };
  const topic = {
    topicId: 'food',
    title: '周末吃什么',
    opener: '想吃点什么？',
    stage: 'followup' as const,
    usedFollowUps: ['喜欢什么口味'],
    currentFollowUp: '要不要换餐厅',
  };
  await generateSocialTurn({
    ctx: {} as ChatGenerateInput['ctx'],
    speaker: a,
    participants: [a, b],
    messages: history,
    maxTextChars: 80,
    topic,
    generate,
  });
  assert.ok(captured);
  assert.match(captured.system, /周末吃什么/);
  assert.match(captured.system, /追问/);
  assert.match(captured.system, /要不要换餐厅/);
  assert.deepEqual(captured.pool, []);
  assert.deepEqual(captured.actions, []);
});

test('多人连续发言与主人消息合并为有序 user 历史', () => {
  const c = pet('c', '团子', '安静');
  const messages: SocialMessage[] = [
    ...history,
    { sessionId: 's', speakerId: 'c', speakerName: '团子', text: '我也来了', ts: 3 },
    { sessionId: 's', speakerId: 'owner', speakerType: 'owner', text: '大家好', ts: 4 },
  ];
  const mapped = socialHistoryFor(messages, a, [a, b, c]);
  assert.equal(mapped.length, 3);
  assert.equal(mapped[2]?.role, 'user');
  assert.equal(mapped[2]?.content, '可可：很好呀！\n团子：我也来了\n主人：大家好');
});
