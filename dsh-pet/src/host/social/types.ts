/**
 * 宠物社交的共享类型：只描述本模块的配置、参与者与记忆，不扩展上游主配置或状态协议。
 * @module dsh-pet/src/host/social/types
 */

/** 一次会话使用的不可变配置快照。 */
export interface SocialConfig {
  readonly version: 1;
  readonly enabled: boolean;
  readonly maxTurns: number;
  readonly turnGapMs: number;
  readonly historyMessages: number;
  readonly maxTextChars: number;
}

/** 当前成品配置中的一名社交参与者。 */
export interface SocialParticipant {
  readonly id: string;
  readonly entry: string;
  readonly name: string;
  readonly display: string;
  readonly conf: Record<string, unknown>;
  readonly pet: Record<string, unknown>;
}

/** 一条已经成功演出的社交台词。 */
export interface SocialMessage {
  readonly sessionId: string;
  readonly speakerId: string;
  readonly targetId: string;
  readonly text: string;
  readonly ts: number;
}

/** 会话结束状态；失败原因只进日志，不写进社交正文。 */
export type SocialSessionStatus = 'active' | 'finished' | 'cancelled' | 'failed';
