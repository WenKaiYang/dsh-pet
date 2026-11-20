/**
 * 话题规则层：本地话题卡评分、追问选择、阶段推进与冷场重复检测。
 * 纯函数，不读配置文件、不调用模型、不访问状态存储。
 * @module dsh-pet/src/host/social/topics
 */
import type { SocialParticipant, SocialTopicCard, SocialTopicSnapshot, SocialTopicStage } from './types.ts';

/** 去掉空白与标点，用于本地关键词和重复判断；不做语义向量化。 */
export function normalizeSocialText(text: string): string {
  return text.replace(/[\s，。！？、,.!?；;：:“”‘’""''~～…\-—_]/g, '').toLowerCase();
}

function bigrams(text: string): Set<string> {
  const normalized = normalizeSocialText(text);
  const out = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) out.add(normalized.slice(index, index + 2));
  return out;
}

/** 话题关键词与一名宠物名/人设的命中次数。 */
export function keywordHits(text: string, keywords: readonly string[]): number {
  const normalized = normalizeSocialText(text);
  return keywords.reduce(
    (count, keyword) => (normalized.includes(normalizeSocialText(keyword)) ? count + 1 : count),
    0,
  );
}

/** 话题对候选成员的相关性评分；只看本地名字与人设文本。 */
export function scoreTopic(card: SocialTopicCard, participants: readonly SocialParticipant[]): number {
  return participants.reduce((score, pet) => {
    const persona = [pet.name, petPersonaText(pet)].join(' ');
    return score + keywordHits(persona, card.keywords);
  }, 0);
}

/** 选择相关性最高的话题；同分按配置顺序，保证测试和重启结果可预测。 */
export function selectTopic(
  cards: readonly SocialTopicCard[],
  participants: readonly SocialParticipant[],
): SocialTopicCard | undefined {
  let best: SocialTopicCard | undefined;
  let bestScore = -1;
  for (const card of cards) {
    const score = scoreTopic(card, participants);
    if (score > bestScore) {
      best = card;
      bestScore = score;
    }
  }
  return best;
}

/** 人设正文轻量取值；与调度层 eligible 使用同一字段来源。 */
export function petPersonaText(pet: SocialParticipant): string {
  const entry = pet.conf as { whisperPrompt?: unknown };
  const instance = pet.pet as { whisperPrompt?: unknown };
  const prompt = typeof instance.whisperPrompt === 'string' ? instance.whisperPrompt : entry.whisperPrompt;
  return typeof prompt === 'string' ? prompt : '';
}

/** 生成会话开场话题快照。 */
export function openTopicSnapshot(card: SocialTopicCard): SocialTopicSnapshot {
  return {
    topicId: card.id,
    title: card.title,
    opener: card.opener,
    stage: 'opening',
    usedFollowUps: [],
  };
}

/** 选择下一条尚未使用的追问；没有可用追问时返回 undefined。 */
export function nextFollowUp(card: SocialTopicCard, used: readonly string[]): string | undefined {
  const usedSet = new Set(used);
  return card.followUps.find((followUp) => !usedSet.has(followUp));
}

export interface TopicStageInput {
  readonly messageCount: number;
  readonly totalTurns: number;
  readonly latestText: string;
  readonly recentTexts: readonly string[];
  readonly usedFollowUps: readonly string[];
  readonly conflictKeywords: readonly string[];
}

/** 按已发言数、剩余预算和冲突关键词推进阶段；首版不在一场内自动换题。 */
export function stageForTopic(input: TopicStageInput): SocialTopicStage {
  const { messageCount, totalTurns, latestText, recentTexts, usedFollowUps, conflictKeywords } = input;
  if (messageCount === 0) return 'opening';
  const conflictText = normalizeSocialText([latestText, ...recentTexts.slice(-3)].join(' '));
  const hasConflict = conflictKeywords.some((keyword) => conflictText.includes(normalizeSocialText(keyword)));
  if (hasConflict) return 'conflict';
  if (messageCount >= Math.max(1, totalTurns - 1)) return 'closing';
  if (usedFollowUps.length > 0) return 'followup';
  return messageCount < Math.max(1, Math.ceil(totalTurns / 2)) ? 'expansion' : 'followup';
}

/** 本地重复/冷场判断：只对比上一条相邻台词，避免把交替发言误判为重复。 */
export function isRepeatedSocialText(text: string, recentTexts: readonly string[]): boolean {
  const normalized = normalizeSocialText(text);
  if (!normalized) return false;
  const previous = recentTexts[recentTexts.length - 1];
  if (previous === undefined) return false;
  const old = normalizeSocialText(previous);
  if (normalized === old) return true;
  if (!old) return false;
  const current = bigrams(normalized);
  const oldGrams = bigrams(old);
  if (current.size === 0 || oldGrams.size === 0) return false;
  let shared = 0;
  for (const gram of current) if (oldGrams.has(gram)) shared += 1;
  const overlap = shared / Math.min(current.size, oldGrams.size);
  return overlap >= 0.75;
}
