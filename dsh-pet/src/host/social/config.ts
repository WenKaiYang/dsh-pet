/**
 * 社交功能独立配置：文件缺失或非法时安全降级，不碰上游主配置合并与保存链路。
 * @module dsh-pet/src/host/social/config
 */
import { readFileSync } from 'node:fs';
import type { LoggerLike } from '../log-file.ts';
import type { SocialConfig } from './types.ts';

/** 默认关闭：未主动创建配置并启用时，不注册菜单也不产生模型调用。 */
export const DEFAULT_SOCIAL_CONFIG: SocialConfig = {
  version: 1,
  enabled: false,
  maxTurns: 4,
  turnGapMs: 1200,
  historyMessages: 6,
  maxTextChars: 80,
};

/** 读取一个整数字段；非法值回默认，不用夹取掩盖配置错误。 */
function integerField(
  raw: Record<string, unknown>,
  key: 'maxTurns' | 'turnGapMs' | 'historyMessages' | 'maxTextChars',
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
  };
}
