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
  assert.deepEqual(socialHistoryFor(history, a, b), [
    { role: 'user', content: '可可与你开始了一场桌宠对话。', ts: 1 },
    { role: 'assistant', content: '今天还好吗？', ts: 1 },
    { role: 'user', content: '可可：很好呀！', ts: 2 },
  ]);
  assert.deepEqual(socialHistoryFor(history, b, a)[0], { role: 'user', content: '薄荷：今天还好吗？', ts: 1 });
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
    target: b,
    messages: history,
    maxTextChars: 80,
    generate,
  });
  assert.deepEqual(result, { ok: true, text: '我很好，你呢？' });
  assert.ok(captured);
  assert.match(captured.system, /安静温柔/);
  assert.match(captured.system, /不是在跟主人聊天/);
  assert.deepEqual(captured.pool, []);
  assert.deepEqual(captured.actions, []);
  assert.equal(captured.history[0]?.role, 'user');
  assert.equal(captured.history[2]?.content, '可可：很好呀！');
});
