/**
 * 社交会话状态机：配置成员、整组取锁、轮流发言、主人队列、演出、记忆与清理。
 * 所有外部能力显式注入；不新建上游 store，也不拥有菜单或 HTTP 循环。
 * @module dsh-pet/src/host/social/director
 */
import type { ChatGenerateResult } from '../chat.ts';
import type { LockStore } from '../lock.ts';
import type { LoggerLike } from '../log-file.ts';
import { petPersona } from '../persona.ts';
import type { SleepStore } from '../sleep.ts';
import type { PollStateStore } from '../state.ts';
import { isDisplayed, pickVoiceSurface } from '../surface.ts';
import { socialGroupKey } from './memory.ts';
import type {
  SocialConfig,
  SocialMessage,
  SocialParticipant,
  SocialSessionSnapshot,
  SocialSessionStatus,
  SocialSessionSummary,
} from './types.ts';

/** 一场运行中的会话；取消只打断等待，不假设底层模型流可中止。 */
interface ActiveSession {
  readonly id: string;
  readonly participants: readonly SocialParticipant[];
  readonly config: SocialConfig;
  readonly groupKey?: string;
  readonly locks: Map<string, string>;
  readonly cancelPromise: Promise<void>;
  readonly startedAt: number;
  readonly context: SocialMessage[];
  readonly messages: SocialMessage[];
  readonly ownerQueue: SocialMessage[];
  changePromise: Promise<void>;
  notifyChange: () => void;
  status: SocialSessionStatus;
  notifyCancel: () => void;
  updatedAt: number;
  revision: number;
  messageSeq: number;
  ownerReplySeq: number;
  ownerIncoming: number;
  ownerJoined: boolean;
  pendingOwnerId?: string;
  currentSpeakerId?: string;
}

/** 社交记忆的最小消费面。 */
export interface SocialMemoryApi {
  recentFor(petA: string, petB: string, limit: number): Promise<SocialMessage[]>;
  recentForGroup(groupKey: string, limit: number): Promise<SocialMessage[]>;
  append(message: SocialMessage): Promise<boolean>;
  setResponseStatus(messageId: string, status: 'answered' | 'unanswered'): Promise<boolean>;
  setSessionStatus?(sessionId: string, status: Exclude<SocialSessionStatus, 'active'>): Promise<boolean>;
  listSessions(): Promise<SocialSessionSummary[]>;
  session(sessionId: string): Promise<SocialSessionSnapshot | null>;
}

/** 社交生成器的最小消费面。 */
export type SocialTurnGenerator = (input: {
  speaker: SocialParticipant;
  participants: readonly SocialParticipant[];
  messages: readonly SocialMessage[];
  maxTextChars: number;
}) => Promise<ChatGenerateResult>;

/** 会话状态机依赖。 */
export interface SocialDirectorDeps {
  readonly readConfig: () => SocialConfig;
  readonly readParticipants: () => SocialParticipant[];
  readonly voiceConfigured: () => boolean;
  readonly memory: SocialMemoryApi;
  readonly generate: SocialTurnGenerator;
  readonly lock: Pick<LockStore, 'acquire' | 'release' | 'current' | 'locked'>;
  readonly sleep: Pick<SleepStore, 'sleeping'>;
  readonly state: Pick<PollStateStore, 'writePet'>;
  readonly log: LoggerLike;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly delay?: (ms: number) => Promise<void>;
}

/** 启动结果保留旧双人响应形状，伙伴是成员列表中的第二位。 */
export type SocialStartResult =
  | { ok: true; sessionId: string; partnerId: string; status: SocialSessionStatus }
  | {
      ok: false;
      reason: 'disabled' | 'busy' | 'unavailable' | 'lock-failed' | 'generate-error' | 'cancelled';
    };

export type SocialOwnerResult =
  | { ok: true; message?: SocialMessage }
  | { ok: false; reason: 'disabled' | 'no-session' | 'not-joined' | 'left' | 'invalid-input' | 'storage-error' };

/** 从上游成品配置项构造参与者；空 id 不进入社交列表。 */
export function socialParticipantOf(
  entry: string,
  conf: Record<string, unknown>,
  pet: Record<string, unknown>,
): SocialParticipant | null {
  const id = String(pet.id ?? '').trim();
  if (!id) return null;
  return { id, entry, name: String(pet.name || id), display: String(pet.display ?? ''), conf, pet };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

/** 默认回合间隔；测试环境保留定时器，生产不钉住宿主进程。 */
function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (process.env.NODE_TEST_CONTEXT === undefined) timer.unref?.();
  });
}

/** 一场群聊的创建、查询与调度。 */
export class SocialDirector {
  declare private readonly deps: SocialDirectorDeps;
  declare private session: ActiveSession | null;
  declare private seq: number;
  declare private disposed: boolean;

  constructor(deps: SocialDirectorDeps) {
    this.deps = deps;
    this.session = null;
    this.seq = 0;
    this.disposed = false;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** 当前是否有会话；用于菜单提示与测试。 */
  active(): boolean {
    return this.session?.status === 'active';
  }

  /** 当前活跃会话的面板快照。 */
  activeSnapshot(): SocialSessionSnapshot | null {
    const session = this.session;
    return session ? this.snapshot(session) : null;
  }

  /** 活跃会话覆盖内存，历史会话读取持久化记忆。 */
  async snapshotFor(sessionId: string): Promise<SocialSessionSnapshot | null> {
    if (this.session?.id === sessionId) return this.snapshot(this.session);
    return this.deps.memory.session(sessionId);
  }

  /** 会话列表去重，活跃场优先。 */
  async sessions(): Promise<SocialSessionSummary[]> {
    const history = await this.deps.memory.listSessions();
    const active = this.session;
    if (!active) return history;
    return [this.snapshot(active), ...history.filter((item) => item.id !== active.id)];
  }

  /** 发起一场互动；Promise 在本场完全清理后返回。 */
  async start(initiatorId: string): Promise<SocialStartResult> {
    if (this.disposed) return { ok: false, reason: 'disabled' };
    const config = this.deps.readConfig();
    if (!config.enabled) return { ok: false, reason: 'disabled' };
    if (this.active()) {
      this.notice(initiatorId, '我们正在聊天呢，等这场聊完吧。');
      return { ok: false, reason: 'busy' };
    }

    const participants = this.deps.readParticipants();
    const initiator = participants.find((pet) => pet.id === initiatorId);
    if (!initiator || !this.eligible(initiator)) {
      this.notice(initiatorId, '我现在不方便聊天哦。');
      return { ok: false, reason: 'unavailable' };
    }
    const selected = this.selectParticipants(initiator, participants, config);
    if (selected.length < 2) {
      this.notice(initiatorId, '现在没有能陪我聊天的伙伴。');
      return { ok: false, reason: 'unavailable' };
    }
    const cancel = deferred();
    const change = deferred();
    const session: ActiveSession = {
      id: `social-${this.now().toString(36)}-${(++this.seq).toString(36)}`,
      participants: selected,
      config,
      groupKey: config.participantIds ? socialGroupKey(selected.map((pet) => pet.id)) : undefined,
      locks: new Map(),
      cancelPromise: cancel.promise,
      notifyCancel: cancel.resolve,
      changePromise: change.promise,
      notifyChange: change.resolve,
      startedAt: this.now(),
      updatedAt: this.now(),
      revision: 0,
      messageSeq: 0,
      ownerReplySeq: 0,
      ownerIncoming: 0,
      ownerJoined: false,
      context: [],
      messages: [],
      ownerQueue: [],
      status: 'active',
    };
    this.session = session;

    // 组锁全有全无：固定顺序，任一失败都把本场已取得的锁回滚。
    for (const pet of [...session.participants].sort((a, b) => a.id.localeCompare(b.id))) {
      const acquired = this.deps.lock.acquire({ petId: pet.id });
      if (!acquired.ok) {
        this.releaseLocks(session);
        this.session = null;
        this.notice(initiatorId, '伙伴现在正忙，等一会儿再聊吧。');
        return { ok: false, reason: 'lock-failed' };
      }
      session.locks.set(pet.id, acquired.lockId);
    }

    await this.run(session);
    if (session.status === 'finished') {
      return { ok: true, sessionId: session.id, partnerId: selected[1].id, status: session.status };
    }
    return { ok: false, reason: session.status === 'cancelled' ? 'cancelled' : 'generate-error' };
  }

  /** 主人主动加入当前会话；不取得宠物锁。 */
  joinOwner(): SocialOwnerResult {
    const session = this.session;
    if (!session || session.status !== 'active') return { ok: false, reason: 'no-session' };
    if (!session.config.allowOwnerJoin) return { ok: false, reason: 'disabled' };
    session.ownerJoined = true;
    this.touch(session);
    this.signalChange(session);
    return { ok: true };
  }

  /** 主人退出：未回应项保留正文并标记，未处理项不再补生成。 */
  async leaveOwner(): Promise<boolean> {
    const session = this.session;
    if (!session || !session.ownerJoined) return false;
    session.ownerJoined = false;
    const pending = [session.pendingOwnerId, ...session.ownerQueue.map((message) => message.messageId)].filter(
      (id): id is string => typeof id === 'string',
    );
    session.ownerQueue.length = 0;
    session.pendingOwnerId = undefined;
    for (const messageId of new Set(pending)) {
      this.replaceMessage(session, messageId, 'unanswered');
      await this.deps.memory.setResponseStatus(messageId, 'unanswered');
    }
    this.touch(session);
    this.signalChange(session);
    return true;
  }

  /** 接受一条主人消息；写入成功后进入 FIFO，最后一轮也不会被自然结束吞掉。 */
  async sayOwner(text: string): Promise<SocialOwnerResult> {
    const session = this.session;
    if (!session || session.status !== 'active') return { ok: false, reason: 'no-session' };
    if (!session.config.allowOwnerJoin) return { ok: false, reason: 'disabled' };
    if (!session.ownerJoined) return { ok: false, reason: 'not-joined' };
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized || [...normalized].length > 500) return { ok: false, reason: 'invalid-input' };
    session.ownerIncoming += 1;
    const message: SocialMessage = {
      sessionId: session.id,
      messageId: `${session.id}-m${++session.messageSeq}`,
      speakerId: 'owner',
      speakerType: 'owner',
      speakerName: '主人',
      text: normalized,
      ts: this.now(),
      responseStatus: 'pending',
      groupKey: session.groupKey,
      participantIds: session.groupKey ? session.participants.map((pet) => pet.id) : undefined,
    };
    try {
      if (!(await this.deps.memory.append(message))) return { ok: false, reason: 'storage-error' };
      if (this.session !== session || session.status !== 'active' || !session.ownerJoined) {
        await this.deps.memory.setResponseStatus(message.messageId!, 'unanswered');
        return { ok: false, reason: session.ownerJoined ? 'no-session' : 'left' };
      }
      session.context.push(message);
      session.messages.push(message);
      session.ownerQueue.push(message);
      this.touch(session);
      this.signalChange(session);
      return { ok: true, message };
    } finally {
      session.ownerIncoming -= 1;
      this.signalChange(session);
    }
  }

  /** 手动结束或卸载：取消后续写入，并唤醒正在等待的会话。 */
  cancel(): boolean {
    const session = this.session;
    if (!session || session.status !== 'active') return false;
    session.status = 'cancelled';
    session.notifyCancel();
    this.signalChange(session);
    this.releaseLocks(session);
    return true;
  }

  /** 插件卸载；此后不再接受新会话。 */
  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  private selectParticipants(
    initiator: SocialParticipant,
    all: readonly SocialParticipant[],
    config: SocialConfig,
  ): SocialParticipant[] {
    if (config.participantIds) {
      if (!config.participantIds.includes(initiator.id)) return [];
      const byId = new Map(all.map((pet) => [pet.id, pet]));
      const rest = config.participantIds
        .filter((id) => id !== initiator.id)
        .map((id) => byId.get(id))
        .filter((pet): pet is SocialParticipant => pet !== undefined && this.eligible(pet));
      return [initiator, ...rest];
    }
    const candidates = all.filter((pet) => pet.id !== initiator.id && this.eligible(pet));
    if (candidates.length === 0) return [];
    const roll = this.deps.random?.() ?? Math.random();
    const index = Math.min(candidates.length - 1, Math.floor(Math.max(0, roll) * candidates.length));
    return [initiator, candidates[index]];
  }

  private eligible(pet: SocialParticipant): boolean {
    return (
      isDisplayed(pet.display) &&
      !this.deps.sleep.sleeping(pet.id) &&
      !this.deps.lock.locked(pet.id) &&
      petPersona(pet.conf, pet.pet).trim() !== ''
    );
  }

  private snapshot(session: ActiveSession): SocialSessionSnapshot {
    return {
      id: session.id,
      status: session.status,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      participantIds: session.participants.map((pet) => pet.id),
      participantNames: Object.fromEntries(session.participants.map((pet) => [pet.id, pet.name])),
      revision: session.revision,
      messageCount: session.messages.length,
      messages: [...session.messages],
      currentSpeakerId: session.currentSpeakerId,
      ownerJoined: session.ownerJoined,
      allowOwnerJoin: session.config.allowOwnerJoin,
    };
  }

  private touch(session: ActiveSession): void {
    session.updatedAt = this.now();
    session.revision += 1;
  }

  private signalChange(session: ActiveSession): void {
    session.notifyChange();
    const next = deferred();
    session.changePromise = next.promise;
    session.notifyChange = next.resolve;
  }

  private replaceMessage(session: ActiveSession, messageId: string, status: 'answered' | 'unanswered'): void {
    const update = (message: SocialMessage): SocialMessage =>
      message.messageId === messageId ? { ...message, responseStatus: status } : message;
    for (const list of [session.context, session.messages]) {
      const index = list.findIndex((message) => message.messageId === messageId);
      if (index >= 0) list[index] = update(list[index]);
    }
    this.touch(session);
  }

  /** 会话主循环；所有出口都经 finally 释放本场仍持有的锁。 */
  private async run(session: ActiveSession): Promise<void> {
    try {
      session.context.push(
        ...(session.groupKey
          ? await this.deps.memory.recentForGroup(session.groupKey, session.config.historyMessages)
          : await this.deps.memory.recentFor(
              session.participants[0].id,
              session.participants[1].id,
              session.config.historyMessages,
            )),
      );
      const totalTurns = session.groupKey
        ? session.participants.length * session.config.rounds
        : session.config.maxTurns;
      let turn = 0;
      while (this.valid(session)) {
        if (session.ownerQueue.length === 0 && session.ownerIncoming > 0) {
          await Promise.race([session.changePromise, session.cancelPromise]);
          continue;
        }
        if (session.ownerQueue.length === 0 && turn >= totalTurns) break;
        if (!this.renewLocks(session)) break;
        const ownerMessage = session.ownerQueue.shift();
        const speakerIndex = ownerMessage
          ? (turn + session.ownerReplySeq++) % session.participants.length
          : turn % session.participants.length;
        if (!ownerMessage) turn += 1;
        const speaker = session.participants[speakerIndex];
        session.pendingOwnerId = ownerMessage?.messageId;
        session.currentSpeakerId = speaker.id;
        this.touch(session);
        const result = await this.deps.generate({
          speaker,
          participants: session.participants,
          messages: session.context,
          maxTextChars: session.config.maxTextChars,
        });
        if (!this.valid(session)) break;
        // 主人已退出时，正在生成的回应不再演出，也不写入记忆。
        if (ownerMessage && (!session.ownerJoined || session.pendingOwnerId !== ownerMessage.messageId)) continue;
        if (!result.ok) {
          session.status = 'failed';
          if (ownerMessage?.messageId) {
            this.replaceMessage(session, ownerMessage.messageId, 'unanswered');
            await this.deps.memory.setResponseStatus(ownerMessage.messageId, 'unanswered');
          }
          this.deps.log.warn?.(`[dsh-pet] 社交生成失败 pet=${speaker.id}：${result.message ?? result.reason}`);
          break;
        }
        const text = result.text.trim();
        if (!text) {
          session.status = 'failed';
          this.deps.log.warn?.(`[dsh-pet] 社交生成结果为空 pet=${speaker.id}`);
          break;
        }
        const message: SocialMessage = {
          sessionId: session.id,
          messageId: `${session.id}-m${++session.messageSeq}`,
          speakerId: speaker.id,
          speakerType: 'pet',
          speakerName: speaker.name,
          targetId: session.groupKey
            ? undefined
            : session.participants[(speakerIndex + 1) % session.participants.length].id,
          text,
          ts: this.now(),
          groupKey: session.groupKey,
          participantIds: session.groupKey ? session.participants.map((pet) => pet.id) : undefined,
        };
        const voiceTo = this.deps.voiceConfigured() ? pickVoiceSurface(speaker.display) : null;
        this.deps.state.writePet(speaker.id, 'say', {
          text,
          duration: 10_000,
          ...(voiceTo ? { voiceTo } : {}),
        });
        session.context.push(message);
        session.messages.push(message);
        await this.deps.memory.append(message);
        if (ownerMessage?.messageId) {
          this.replaceMessage(session, ownerMessage.messageId, 'answered');
          await this.deps.memory.setResponseStatus(ownerMessage.messageId, 'answered');
          session.pendingOwnerId = undefined;
        }
        session.currentSpeakerId = undefined;
        this.touch(session);
        await Promise.race([(this.deps.delay ?? defaultDelay)(session.config.turnGapMs), session.cancelPromise]);
      }
      if (session.status === 'active') session.status = 'finished';
    } catch (error) {
      if (session.status === 'active') session.status = 'failed';
      this.deps.log.warn?.(`[dsh-pet] 社交会话异常：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      const pending = [
        session.pendingOwnerId,
        ...session.ownerQueue.map((message) => message.messageId),
        ...session.context
          .filter((message) => message.speakerType === 'owner' && message.responseStatus === 'pending')
          .map((message) => message.messageId),
      ].filter((id): id is string => typeof id === 'string');
      for (const messageId of new Set(pending)) {
        this.replaceMessage(session, messageId, 'unanswered');
        await this.deps.memory.setResponseStatus(messageId, 'unanswered');
      }
      session.ownerQueue.length = 0;
      session.currentSpeakerId = undefined;
      await this.deps.memory.setSessionStatus?.(session.id, session.status === 'active' ? 'finished' : session.status);
      this.releaseLocks(session);
      this.touch(session);
      if (this.session === session) this.session = null;
    }
  }

  /** 续期同时验证持有关系；任一失败即取消整场。 */
  private renewLocks(session: ActiveSession): boolean {
    if (!this.valid(session)) return false;
    for (const [petId, lockId] of session.locks) {
      const renewed = this.deps.lock.acquire({ petId, lockId });
      if (!renewed.ok) {
        this.cancel();
        return false;
      }
    }
    return true;
  }

  /** 会话仍是当前活动场，且双方锁编号仍归本场持有。 */
  private valid(session: ActiveSession): boolean {
    if (this.session !== session || session.status !== 'active') return false;
    for (const [petId, lockId] of session.locks) {
      if (this.deps.lock.current(petId)?.lockId !== lockId) {
        session.status = 'cancelled';
        session.notifyCancel();
        this.signalChange(session);
        return false;
      }
    }
    return true;
  }

  /** 只释放本场自己的锁；用户已经抢占的锁不能被误放。 */
  private releaseLocks(session: ActiveSession): void {
    for (const [petId, lockId] of session.locks) {
      this.deps.lock.release({ petId, lockId });
    }
    session.locks.clear();
  }

  /** 启动阶段的轻量提示，不带语音、不联动说话动画。 */
  private notice(petId: string, text: string): void {
    if (!petId) return;
    this.deps.state.writePet(petId, 'say', { text, anim: false, duration: 4000 });
  }
}
