/**
 * 社交台词生成：复用上游人设与模型调用，但把群聊历史转换成当前发言者视角。
 * 不读取主人私聊，不开放图片、动作或坐标指令。
 * @module dsh-pet/src/host/social/generate
 */
import { generateChat, type ChatGenerateResult, type ChatMemoryMessage } from '../chat.ts';
import { configuredModel } from '../model-selection.ts';
import { composeSystemPrompt, petPersona } from '../persona.ts';
import type { SocialMessage, SocialParticipant, SocialTopicSnapshot } from './types.ts';

/** 生成入口的依赖与上下文。 */
export interface SocialTurnInput {
  readonly ctx: Parameters<typeof generateChat>[0]['ctx'];
  readonly speaker: SocialParticipant;
  readonly participants: readonly SocialParticipant[];
  readonly messages: readonly SocialMessage[];
  readonly maxTextChars: number;
  readonly topic?: SocialTopicSnapshot;
  readonly now?: Date;
  /** 测试替身；生产缺省就是上游 generateChat。 */
  readonly generate?: typeof generateChat;
}

/** 共同社交历史 → 当前角色视角；连续的同角色消息合并，兼容多人会话。 */
export function socialHistoryFor(
  messages: readonly SocialMessage[],
  speaker: SocialParticipant,
  participants: readonly SocialParticipant[],
): ChatMemoryMessage[] {
  const names: Record<string, string> = Object.fromEntries(participants.map((pet) => [pet.id, pet.name]));
  const history: ChatMemoryMessage[] = [];
  for (const message of messages) {
    const role = message.speakerId === speaker.id ? 'assistant' : 'user';
    const name =
      message.speakerType === 'owner' ? '主人' : (message.speakerName ?? names[message.speakerId] ?? message.speakerId);
    const content = role === 'assistant' ? message.text : `${name}：${message.text}`;
    const previous = history[history.length - 1];
    if (previous?.role === role) {
      previous.content = `${previous.content}\n${content}`;
      previous.ts = message.ts;
    } else {
      history.push({ role, content, ts: message.ts });
    }
  }
  // 独立模式要求首条历史是 user。发起人再次发言时，第一条恰是自己的 assistant，
  // 补一条不冒充任何成员台词的开场上下文，既保留完整历史，也兼容宿主与独立模式。
  if (history[0]?.role === 'assistant') {
    history.unshift({ role: 'user', content: '你与其他成员开始了一场桌宠群聊。', ts: history[0].ts });
  }
  return history;
}

const STAGE_TEXT: Record<SocialTopicSnapshot['stage'], string> = {
  opening: '开场',
  expansion: '展开',
  followup: '追问',
  conflict: '分歧',
  closing: '收尾',
};

/** 去掉模型可能带回的格式包装，并按 Unicode 字符数截断。 */
export function cleanSocialText(raw: string, maxChars: number): string {
  const text = raw
    .replace(/```(?:text|markdown)?/gi, '')
    .replace(/\[动作:[^\]]*\]/g, '')
    .replace(/\[图:[^\]]*\]/g, '')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...text].slice(0, maxChars).join('').trim();
}

/** 生成当前角色的一句社交台词。 */
export async function generateSocialTurn(input: SocialTurnInput): Promise<ChatGenerateResult> {
  const { speaker, participants, messages, maxTextChars, topic } = input;
  const prompt = petPersona(speaker.conf, speaker.pet);
  const base = composeSystemPrompt({ prompt, name: speaker.name, id: speaker.id, now: input.now ?? new Date() });
  const others = participants
    .filter((pet) => pet.id !== speaker.id)
    .map((pet) => pet.name)
    .join('、');
  const topicBlock = topic
    ? `\n【当前话题】${topic.title}；阶段：${STAGE_TEXT[topic.stage]}。开场白：${topic.opener}。` +
      (topic.currentFollowUp ? ` 可围绕追问“${topic.currentFollowUp}”继续。` : '')
    : '';
  const system =
    base +
    topicBlock +
    `\n【桌宠群聊】你是当前发言者，其他桌宠成员是“${others || '暂无'}”。` +
    '历史里带名字的话来自其他成员，标记为“主人”的话来自主人；不带名字且由你说过的话属于你的上一句。' +
    '保持自己的身份、性格和说话习惯，回应最近的发言。不要把自己的身份换成其他宠物或主人。' +
    '只输出你自己的一两句短台词，不要代替其他成员说话，不要输出旁白、Markdown、动作、图片或坐标。';
  const latest = messages[messages.length - 1];
  const userText =
    messages.length === 0
      ? '现在由你主动跟大家聊一句轻松、自然的话。'
      : latest?.speakerType === 'owner'
        ? '现在轮到你回应主人在群聊里的话，直接从你的台词正文开始。'
        : '现在轮到你接着群聊最近的话题发言，直接从你的台词正文开始。';
  const result = await (input.generate ?? generateChat)({
    ctx: input.ctx,
    system,
    history: socialHistoryFor(messages, speaker, participants),
    userText,
    pool: [],
    actions: [],
    preferred: configuredModel(speaker.conf, 'chatModel'),
  });
  if (!result.ok) return result;
  const text = cleanSocialText(result.text, maxTextChars);
  if (!text) return { ok: false, reason: 'generate-error', message: '社交台词清洗后为空' };
  return { ok: true, text };
}
