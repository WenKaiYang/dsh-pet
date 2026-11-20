/**
 * 社交功能独立配置：文件缺失或非法时安全降级，不碰上游主配置合并与保存链路。
 * @module dsh-pet/src/host/social/config
 */
import { readFileSync } from 'node:fs';
import type { LoggerLike } from '../log-file.ts';
import type { SocialConfig, SocialTopicCard } from './types.ts';

/** 默认关闭：未主动创建配置并启用时，不注册菜单也不产生模型调用。 */
export const DEFAULT_SOCIAL_CONFIG: SocialConfig = {
  version: 1,
  enabled: false,
  maxTurns: 4,
  turnGapMs: 1200,
  historyMessages: 6,
  maxTextChars: 80,
  rounds: 1,
  showTimeline: true,
  allowOwnerJoin: true,
  groupSize: undefined,
  topics: undefined,
};

/** 读取一个整数字段；非法值回默认，不用夹取掩盖配置错误。 */
function integerField(
  raw: Record<string, unknown>,
  key: 'maxTurns' | 'turnGapMs' | 'historyMessages' | 'maxTextChars' | 'rounds',
  min: number,
  max: number,
  file: string,
  log?: LoggerLike,
): number {
  const value = raw[key];
  if (value === undefined) return DEFAULT_SOCIAL_CONFIG[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    log?.warn?.(`[dsh-pet] 社交配置 ${key} 非法，已回默认值：${file}`);
    return DEFAULT_SOCIAL_CONFIG[key];
  }
  if (key === 'maxTurns' && value % 2 !== 0) {
    log?.warn?.(`[dsh-pet] 社交配置 maxTurns 必须是偶数，已回默认值：${file}`);
    return DEFAULT_SOCIAL_CONFIG.maxTurns;
  }
  return value;
}

/** 成员列表不设置长度上限；非法项单独剔除并去重，缺失才走旧双人模式。 */
function participantField(raw: Record<string, unknown>, file: string, log?: LoggerLike): readonly string[] | undefined {
  if (raw.participantIds === undefined) return undefined;
  if (!Array.isArray(raw.participantIds)) {
    log?.warn?.(`[dsh-pet] 社交配置 participantIds 必须是数组，已回旧双人模式：${file}`);
    return undefined;
  }
  const valid = raw.participantIds.filter((id): id is string => typeof id === 'string' && id.trim() !== '');
  if (valid.length !== raw.participantIds.length) {
    log?.warn?.(`[dsh-pet] 社交配置 participantIds 含非法成员 id，已剔除：${file}`);
  }
  return [...new Set(valid.map((id) => id.trim()))];
}

function booleanField(raw: Record<string, unknown>, key: 'showTimeline' | 'allowOwnerJoin'): boolean {
  return raw[key] === undefined ? DEFAULT_SOCIAL_CONFIG[key] : raw[key] === true;
}

function stringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = item.trim();
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

/** 归一化一张话题卡；缺标题、开场白或关键词时返回 null。 */
export function normalizeTopicCard(raw: unknown, index: number): SocialTopicCard | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const card = raw as Record<string, unknown>;
  const id = typeof card.id === 'string' && card.id.trim() ? card.id.trim() : `topic-${index}`;
  const title = typeof card.title === 'string' ? card.title.trim() : '';
  const opener = typeof card.opener === 'string' ? card.opener.trim() : '';
  const keywords = stringList(card.keywords, 10);
  const followUps = stringList(card.followUps, 8);
  const conflictKeywords = stringList(card.conflictKeywords, 8);
  if (!title || !opener || keywords.length === 0) return null;
  return { id, title, keywords, opener, followUps, conflictKeywords };
}

/** 读取并去重话题卡；非法卡单独剔除，不影响其余社交配置。 */
function topicsField(
  raw: Record<string, unknown>,
  file: string,
  log?: LoggerLike,
): readonly SocialTopicCard[] | undefined {
  if (raw.topics === undefined) return undefined;
  if (!Array.isArray(raw.topics)) {
    log?.warn?.(`[dsh-pet] 社交配置 topics 必须是数组，已忽略话题配置：${file}`);
    return undefined;
  }
  const seen = new Set<string>();
  const topics: SocialTopicCard[] = [];
  raw.topics.forEach((item, index) => {
    const card = normalizeTopicCard(item, index);
    if (!card || seen.has(card.id)) return;
    seen.add(card.id);
    topics.push(card);
  });
  if (topics.length === 0) {
    log?.warn?.(`[dsh-pet] 社交配置 topics 没有可用话题卡，已忽略：${file}`);
    return undefined;
  }
  return topics;
}

/** 成员人数区间；min 至少 2，max 不小于 min，非法时缺省。 */
function groupSizeField(raw: Record<string, unknown>, file: string, log?: LoggerLike): SocialConfig['groupSize'] {
  if (raw.groupSize === undefined) return undefined;
  const value = raw.groupSize;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    log?.warn?.(`[dsh-pet] 社交配置 groupSize 必须是对象，已忽略：${file}`);
    return undefined;
  }
  const group = value as Record<string, unknown>;
  const min = typeof group.min === 'number' && Number.isInteger(group.min) ? group.min : NaN;
  const max = typeof group.max === 'number' && Number.isInteger(group.max) ? group.max : NaN;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 2 || max > 8 || max < min) {
    log?.warn?.(`[dsh-pet] 社交配置 groupSize 必须满足 2 ≤ min ≤ max ≤ 8，已忽略：${file}`);
    return undefined;
  }
  return { min, max };
}

/** 读取社交配置；文件不存在 = 全默认，JSON 或根结构损坏 = 全默认。 */
export function readSocialConfig(file: string, log?: LoggerLike): SocialConfig {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return { ...DEFAULT_SOCIAL_CONFIG };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    log?.warn?.(
      `[dsh-pet] 社交配置无法解析，功能保持关闭：${file}（${error instanceof Error ? error.message : String(error)}）`,
    );
    return { ...DEFAULT_SOCIAL_CONFIG };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    log?.warn?.(`[dsh-pet] 社交配置根节点必须是对象，功能保持关闭：${file}`);
    return { ...DEFAULT_SOCIAL_CONFIG };
  }
  const value = parsed as Record<string, unknown>;
  if (value.version !== undefined && value.version !== 1) {
    log?.warn?.(`[dsh-pet] 社交配置 version 只支持 1，功能保持关闭：${file}`);
    return { ...DEFAULT_SOCIAL_CONFIG };
  }
  return {
    version: 1,
    enabled: value.enabled === true,
    maxTurns: integerField(value, 'maxTurns', 2, 8, file, log),
    turnGapMs: integerField(value, 'turnGapMs', 500, 5000, file, log),
    historyMessages: integerField(value, 'historyMessages', 0, 20, file, log),
    maxTextChars: integerField(value, 'maxTextChars', 20, 200, file, log),
    participantIds: participantField(value, file, log),
    rounds: integerField(value, 'rounds', 1, 8, file, log),
    showTimeline: booleanField(value, 'showTimeline'),
    allowOwnerJoin: booleanField(value, 'allowOwnerJoin'),
    groupSize: groupSizeField(value, file, log),
    topics: topicsField(value, file, log),
  };
}
