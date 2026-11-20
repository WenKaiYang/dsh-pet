/**
 * 双人社交会话状态机：选择伙伴、整组取锁、交替生成、演出、记忆与清理。
 * 所有外部能力显式注入；不新建上游 store，也不拥有菜单循环。
 * @module dsh-pet/src/host/social/director
 */
import type { ChatGenerateResult } from '../chat.ts';
import type { LockStore } from '../lock.ts';
import type { LoggerLike } from '../log-file.ts';
import { petPersona } from '../persona.ts';
import type { SleepStore } from '../sleep.ts';
import type { PollStateStore } from '../state.ts';
import { isDisplayed, pickVoiceSurface } from '../surface.ts';
import type { SocialConfig, SocialMessage, SocialParticipant, SocialSessionStatus } from './types.ts';

/** 一场运行中的会话；cancelPromise 只用于打断回合间隔，不取消底层模型流。 */
interface ActiveSession {
  readonly id: string;
  readonly participants: readonly [SocialParticipant, SocialParticipant];
  readonly locks: Map<string, string>;
  readonly cancelPromise: Promise<void>;
  status: SocialSessionStatus;
  notifyCancel: () => void;
}

/** 社交记忆的最小消费面。 */
export interface SocialMemoryApi {
  recentFor(petA: string, petB: string, limit: number): Promise<SocialMessage[]>;
  append(message: SocialMessage): Promise<boolean>;
}

/** 社交生成器的最小消费面。 */
export type SocialTurnGenerator = (input: {
  speaker: SocialParticipant;
  target: SocialParticipant;
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
  /** 测试可注入零等待；生产默认真正等待，并由 cancelPromise 提前结束等待。 */
  readonly delay?: (ms: number) => Promise<void>;
}

/** 启动结果；ok=true 表示会话已跑完，status 区分自然完成与被取消。 */
export type SocialStartResult =
  | { ok: true; sessionId: string; partnerId: string; status: SocialSessionStatus }
  | { ok: false; reason: 'disabled' | 'busy' | 'unavailable' | 'lock-failed' | 'generate-error' | 'cancelled' };

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

/** 默认回合间隔；测试环境保留定时器，生产不钉住宿主进程。 */
function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (process.env.NODE_TEST_CONTEXT === undefined) timer.unref?.();
  });
}

/** 一场会话的创建与调度。 */
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

  /** 当前是否有会话；用于菜单提示与测试。 */
  active(): boolean {
    return this.session?.status === 'active';
  }

  /** 发起一场双人互动；Promise 在本场完全清理后返回。 */
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
    const candidates = participants.filter((pet) => pet.id !== initiatorId && this.eligible(pet));
    if (candidates.length === 0) {
      this.notice(initiatorId, '现在没有能陪我聊天的伙伴。');
      return { ok: false, reason: 'unavailable' };
    }
    const roll = this.deps.random?.() ?? Math.random();
    const index = Math.min(candidates.length - 1, Math.floor(Math.max(0, roll) * candidates.length));
    const partner = candidates[index];
    let notifyCancel = (): void => {};
    const cancelPromise = new Promise<void>((resolve) => {
      notifyCancel = resolve;
    });
    const session: ActiveSession = {
      id: `social-${(this.deps.now?.() ?? Date.now()).toString(36)}-${(++this.seq).toString(36)}`,
      participants: [initiator, partner],
      locks: new Map(),
      cancelPromise,
      notifyCancel,
      status: 'active',
    };
    this.session = session;

    // 组锁全有全无：固定顺序，第二个失败时把第一个已经取得的锁回滚。
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

    await this.run(session, config);
    if (session.status === 'finished') {
      return { ok: true, sessionId: session.id, partnerId: partner.id, status: session.status };
    }
    return { ok: false, reason: session.status === 'cancelled' ? 'cancelled' : 'generate-error' };
  }

  /** 手动结束或卸载：取消后续写入，并唤醒正在等待回合间隔的会话。 */
  cancel(): boolean {
    const session = this.session;
    if (!session || session.status !== 'active') return false;
    session.status = 'cancelled';
    session.notifyCancel();
    this.releaseLocks(session);
    return true;
  }

  /** 插件卸载；此后不再接受新会话。 */
  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  /** 一名参与者当前是否可被选择。 */
  private eligible(pet: SocialParticipant): boolean {
    return (
      isDisplayed(pet.display) &&
      !this.deps.sleep.sleeping(pet.id) &&
      !this.deps.lock.locked(pet.id) &&
      petPersona(pet.conf, pet.pet).trim() !== ''
    );
  }

  /** 会话主循环；所有出口都经 finally 释放本场仍持有的锁。 */
  private async run(session: ActiveSession, config: SocialConfig): Promise<void> {
    const [a, b] = session.participants;
    try {
      const messages = await this.deps.memory.recentFor(a.id, b.id, config.historyMessages);
      for (let turn = 0; turn < config.maxTurns && this.valid(session); turn += 1) {
        if (!this.renewLocks(session)) break;
        const speaker = turn % 2 === 0 ? a : b;
        const target = turn % 2 === 0 ? b : a;
        const result = await this.deps.generate({ speaker, target, messages, maxTextChars: config.maxTextChars });
        // 模型流无法由本层取消；晚到结果必须先重新验明会话与锁，不能直接演出。
        if (!this.valid(session)) break;
        if (!result.ok) {
          session.status = 'failed';
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
          speakerId: speaker.id,
          targetId: target.id,
          text,
          ts: this.deps.now?.() ?? Date.now(),
        };
        const voiceTo = this.deps.voiceConfigured() ? pickVoiceSurface(speaker.display) : null;
        this.deps.state.writePet(speaker.id, 'say', {
          text,
          duration: 10_000,
          ...(voiceTo ? { voiceTo } : {}),
        });
        messages.push(message);
        await this.deps.memory.append(message);
        if (turn + 1 < config.maxTurns) {
          await Promise.race([(this.deps.delay ?? defaultDelay)(config.turnGapMs), session.cancelPromise]);
        }
      }
      if (session.status === 'active') session.status = 'finished';
    } catch (error) {
      if (session.status === 'active') session.status = 'failed';
      this.deps.log.warn?.(`[dsh-pet] 社交会话异常：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.releaseLocks(session);
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
