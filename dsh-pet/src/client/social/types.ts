/** 群聊时间线的客户端传输类型；不依赖宿主 Node 模块。 */
export type SocialSpeakerType = 'pet' | 'owner';
export type SocialResponseStatus = 'pending' | 'answered' | 'unanswered';
export type SocialTopicStage = 'opening' | 'expansion' | 'followup' | 'conflict' | 'closing';

export interface SocialTopicSnapshot {
  topicId: string;
  title: string;
  opener: string;
  stage: SocialTopicStage;
  usedFollowUps: string[];
  currentFollowUp?: string;
}

export interface SocialMessage {
  sessionId: string;
  speakerId: string;
  speakerType?: SocialSpeakerType;
  speakerName?: string;
  targetId?: string;
  text: string;
  ts: number;
  responseStatus?: SocialResponseStatus;
  topic?: SocialTopicSnapshot;
}

export interface SocialSession {
  id: string;
  status: 'active' | 'finished' | 'cancelled' | 'failed';
  startedAt: number;
  updatedAt: number;
  participantIds: string[];
  participantNames: Record<string, string>;
  revision: number;
  messageCount: number;
  messages: SocialMessage[];
  ownerJoined: boolean;
  allowOwnerJoin: boolean;
  currentSpeakerId?: string;
  topic?: SocialTopicSnapshot;
}
