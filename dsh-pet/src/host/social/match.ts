/**
 * 话题成员评分：只在配置候选池内选择，按关键词相关性、近期发言平衡和稳定性排序。
 * 不调用模型，不读取锁以外的外部状态；可用性由调度层先过滤。
 * @module dsh-pet/src/host/social/match
 */
import type { SocialConfig, SocialParticipant, SocialTopicCard } from './types.ts';
import { keywordHits, petPersonaText } from './topics.ts';

export interface MemberScore {
  readonly participant: SocialParticipant;
  readonly score: number;
  readonly recentCount: number;
}

/** 计算单只宠物与话题的本地相关性；近期发言越多，平衡分越低。 */
export function scoreMember(participant: SocialParticipant, topic: SocialTopicCard, recentCount: number): MemberScore {
  const persona = [participant.name, petPersonaText(participant)].join(' ');
  const relevance = keywordHits(persona, topic.keywords);
  const balance = Math.min(recentCount, 8) * 0.15;
  return { participant, score: relevance - balance, recentCount };
}

function compareScores(a: MemberScore, b: MemberScore): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.recentCount !== b.recentCount) return a.recentCount - b.recentCount;
  return a.participant.id.localeCompare(b.participant.id);
}

/**
 * 从已过滤的可用成员中选择话题成员。
 * 发起人固定排在首位；其余成员按评分排序。候选不足时保留实际可用成员，由调度层判断是否满 2 只。
 */
export function selectTopicParticipants(args: {
  readonly initiator: SocialParticipant;
  readonly eligible: readonly SocialParticipant[];
  readonly config: SocialConfig;
  readonly topic: SocialTopicCard;
  readonly recentCounts: Readonly<Record<string, number>>;
}): SocialParticipant[] {
  const { initiator, eligible, config, topic, recentCounts } = args;
  if (config.participantIds && !config.participantIds.includes(initiator.id)) return [];
  const pool = config.participantIds ? eligible.filter((pet) => config.participantIds!.includes(pet.id)) : eligible;
  const min = config.groupSize?.min ?? 2;
  const max = Math.max(min, config.groupSize?.max ?? 3);
  const scored = pool
    .filter((pet) => pet.id !== initiator.id)
    .map((pet) => scoreMember(pet, topic, recentCounts[pet.id] ?? 0))
    .sort(compareScores);
  const rest = scored.slice(0, Math.max(0, max - 1)).map((item) => item.participant);
  return [initiator, ...rest];
}
