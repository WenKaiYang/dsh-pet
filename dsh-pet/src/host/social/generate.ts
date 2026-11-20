/**
 * 社交台词生成：复用上游人设与模型调用，但把历史转换成当前发言者视角。
 * 不读取主人聊天，不开放图片、动作或坐标指令。
 * @module dsh-pet/src/host/social/generate
 */
import { generateChat, type ChatGenerateResult, type ChatMemoryMessage } from '../chat.ts';
import { configuredModel } from '../model-selection.ts';
import { composeSystemPrompt, petPersona } from '../persona.ts';
import type { SocialMessage, SocialParticipant } from './types.ts';

/** 生成入口的依赖与上下文。 */
export interface SocialTurnInput {
  readonly ctx: Parameters<typeof generateChat>[0]['ctx'];
  readonly speaker: SocialParticipant;
  readonly target: SocialParticipant;
  readonly messages: readonly SocialMessage[];
  readonly maxTextChars: number;
  readonly now?: Date;
  /** 测试替身；生产缺省就是上游 generateChat。 */
  readonly generate?: typeof generateChat;
}

/** 共同社交历史 → 当前角色视角：自己是 assistant，对方是 user，但正文明确带对方名字。 */
export function socialHistoryFor(
  messages: readonly SocialMessage[],
  speaker: SocialParticipant,
  target: SocialParticipant,
): ChatMemoryMessage[] {
  const names: Record<string, string> = { [speaker.id]: speaker.name, [target.id]: target.name };
  const history: ChatMemoryMessage[] = messages.map((message) => ({
    role: message.speakerId === speaker.id ? 'assistant' : 'user',
    content:
      message.speakerId === speaker.id
        ? message.text
        : `${names[message.speakerId] ?? message.speakerId}：${message.text}`,
    ts: message.ts,
  }));
  // 独立模式要求首条历史是 user。发起人再次发言时，第一条恰是自己的 assistant，
  // 补一条不冒充对方台词的开场上下文，既保留完整历史，也兼容宿主与独立模式。
  if (history[0]?.role === 'assistant') {
    history.unshift({ role: 'user', content: `${target.name}与你开始了一场桌宠对话。`, ts: history[0].ts });
  }
  return history;
}

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
  const { speaker, target, messages, maxTextChars } = input;
  const prompt = petPersona(speaker.conf, speaker.pet);
  const base = composeSystemPrompt({ prompt, name: speaker.name, id: speaker.id, now: input.now ?? new Date() });
  const system =
    base +
    `\n【社交场景】你正在和另一只桌宠“${target.name}”交流，不是在跟主人聊天。` +
    '双方都是桌宠。历史里带名字的话来自对方，不带名字且由你说过的话属于你的上一句。' +
    '保持自己的身份、性格和说话习惯，回应对方最近说的话。' +
    '只输出你自己的一两句短台词，不要代替对方说话，不要输出旁白、Markdown、动作、图片或坐标。';
  const userText =
    messages.length === 0
      ? `现在由你主动跟“${target.name}”聊一句轻松、自然的话。`
      : `现在轮到你回应“${target.name}”，直接从你的台词正文开始。`;
  const result = await (input.generate ?? generateChat)({
    ctx: input.ctx,
    system,
    history: socialHistoryFor(messages, speaker, target),
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
