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
  /** 存在时进入配置成员群聊；缺省保持旧双人随机配对。 */
  readonly participantIds?: readonly string[];
  /** 群聊完整轮数，每轮每名有效宠物发言一次。 */
  readonly rounds: number;
  readonly showTimeline: boolean;
  readonly allowOwnerJoin: boolean;
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
  /** 旧双人消息有唯一接收者；群聊消息缺省。 */
  readonly targetId?: string;
  readonly text: string;
  readonly ts: number;
  readonly messageId?: string;
  readonly speakerType?: 'pet' | 'owner';
  readonly speakerName?: string;
  /** 排序后的成员 id 组合，隔离不同群聊的跨场历史。 */
  readonly groupKey?: string;
  /** 群聊成员快照，历史回看时还原未发言成员。 */
  readonly participantIds?: readonly string[];
  /** 持久化的最终状态只取非活跃值；旧消息缺省按 finished 兼容。 */
  readonly sessionStatus?: Exclude<SocialSessionStatus, 'active'>;
  /** 主人消息的回应状态；宠物消息缺省。 */
  readonly responseStatus?: 'pending' | 'answered' | 'unanswered';
}

/** 会话结束状态；失败原因只进日志，不写进社交正文。 */
export type SocialSessionStatus = 'active' | 'finished' | 'cancelled' | 'failed';

/** 面板使用的会话摘要，不包含锁编号或模型内部信息。 */
export interface SocialSessionSummary {
  readonly id: string;
  readonly status: SocialSessionStatus;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly participantIds: readonly string[];
  readonly participantNames: Readonly<Record<string, string>>;
  readonly revision: number;
  readonly messageCount: number;
}

/** 活跃会话与历史会话共用的只读时间线。 */
export interface SocialSessionSnapshot extends SocialSessionSummary {
  readonly messages: readonly SocialMessage[];
  readonly currentSpeakerId?: string;
  readonly ownerJoined: boolean;
  readonly allowOwnerJoin: boolean;
}
