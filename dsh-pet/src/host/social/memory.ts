/**
 * 社交记忆：独立 JSON、串行 read-modify-write、原子替换与容量限制。
 * 只保存已进入会话的台词；损坏数据按空历史降级，绝不影响主人聊天记忆。
 * @module dsh-pet/src/host/social/memory
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LoggerLike } from '../log-file.ts';
import type { SocialMessage, SocialSessionSnapshot, SocialSessionSummary } from './types.ts';

/** 文件里的一条有效记录；脏条目被丢弃，不让一条坏数据毁掉整份历史。 */
function validMessage(value: unknown): value is SocialMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const m = value as Record<string, unknown>;
  const optionalString = (key: string): boolean =>
    m[key] === undefined || (typeof m[key] === 'string' && m[key] !== '');
  return (
    typeof m.sessionId === 'string' &&
    m.sessionId !== '' &&
    typeof m.speakerId === 'string' &&
    m.speakerId !== '' &&
    typeof m.text === 'string' &&
    m.text !== '' &&
    typeof m.ts === 'number' &&
    Number.isFinite(m.ts) &&
    m.ts >= 0 &&
    optionalString('targetId') &&
    optionalString('messageId') &&
    optionalString('speakerName') &&
    optionalString('groupKey') &&
    (m.speakerType === undefined || m.speakerType === 'pet' || m.speakerType === 'owner') &&
    (m.responseStatus === undefined || ['pending', 'answered', 'unanswered'].includes(String(m.responseStatus))) &&
    (m.sessionStatus === undefined || ['finished', 'cancelled', 'failed'].includes(String(m.sessionStatus))) &&
    (m.participantIds === undefined ||
      (Array.isArray(m.participantIds) && m.participantIds.every((id) => typeof id === 'string' && id !== '')))
  );
}

/** 同时应用场次与条数上限；顺序保持时间正序。 */
export function pruneSocialMessages(
  messages: readonly SocialMessage[],
  maxSessions = 20,
  maxMessages = 200,
): SocialMessage[] {
  const sessionIds = [...new Set(messages.map((message) => message.sessionId))];
  const kept = new Set(sessionIds.slice(-maxSessions));
  return messages.filter((message) => kept.has(message.sessionId)).slice(-maxMessages);
}

/** 排序后的成员集合作为跨场历史键，顺序变化不会换一间群聊。 */
export function socialGroupKey(participantIds: readonly string[]): string {
  return JSON.stringify([...new Set(participantIds)].sort((a, b) => a.localeCompare(b)));
}

/** 社交记忆存储；一个宿主实例一份，不在模块里建全局单例。 */
export class SocialMemoryStore {
  declare private readonly file: string;
  declare private readonly log?: LoggerLike;
  declare private queue: Promise<void>;

  constructor(options: { file: string; log?: LoggerLike }) {
    this.file = options.file;
    this.log = options.log;
    this.queue = Promise.resolve();
  }

  /** 把一次读写放进串行链；前一次失败不会污染后一次。 */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** 读整份文件；不存在或不可读都按空历史处理。 */
  private async readAll(): Promise<SocialMessage[]> {
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) throw new Error('root is not an array');
      return parsed.filter(validMessage);
    } catch (error) {
      this.log?.warn?.(
        `[dsh-pet] 社交记忆无法解析，已按空历史处理：${this.file}（${error instanceof Error ? error.message : String(error)}）`,
      );
      return [];
    }
  }

  private async writeAll(messages: readonly SocialMessage[]): Promise<boolean> {
    const staging = this.file + '.tmp';
    try {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(staging, JSON.stringify(pruneSocialMessages(messages), null, 2), 'utf8');
      await rename(staging, this.file);
      return true;
    } catch (error) {
      await rm(staging, { force: true }).catch(() => undefined);
      this.log?.warn?.(
        `[dsh-pet] 社交记忆写入失败：${this.file}（${error instanceof Error ? error.message : String(error)}）`,
      );
      return false;
    }
  }

  /** 查询同一对宠物的最近消息，A→B 与 B→A 都包含。 */
  async recentFor(petA: string, petB: string, limit: number): Promise<SocialMessage[]> {
    return this.serialize(async () => {
      if (limit <= 0) return [];
      const all = await this.readAll();
      return all
        .filter(
          (message) =>
            (message.speakerId === petA && message.targetId === petB) ||
            (message.speakerId === petB && message.targetId === petA),
        )
        .slice(-limit);
    });
  }

  /** 只读取完全相同成员组合的群聊历史。 */
  async recentForGroup(groupKey: string, limit: number): Promise<SocialMessage[]> {
    return this.serialize(async () => {
      if (limit <= 0) return [];
      const all = await this.readAll();
      return all.filter((message) => message.groupKey === groupKey).slice(-limit);
    });
  }

  /** 追加一条台词；写盘失败只记日志并返回 false，不把已经演出的气泡判成失败。 */
  async append(message: SocialMessage): Promise<boolean> {
    return this.serialize(async () => this.writeAll([...(await this.readAll()), message]));
  }

  /** 按消息 id 更新主人回应状态，保持其他字段不变。 */
  async setResponseStatus(messageId: string, status: 'answered' | 'unanswered'): Promise<boolean> {
    return this.serialize(async () => {
      const all = await this.readAll();
      let found = false;
      const next = all.map((message) => {
        if (message.messageId !== messageId) return message;
        found = true;
        return { ...message, responseStatus: status };
      });
      return found ? this.writeAll(next) : false;
    });
  }

  /** 将会话最终状态写入该场已有消息，取消/失败不会被历史误报为正常结束。 */
  async setSessionStatus(sessionId: string, status: 'finished' | 'cancelled' | 'failed'): Promise<boolean> {
    return this.serialize(async () => {
      const all = await this.readAll();
      let found = false;
      const next = all.map((message) => {
        if (message.sessionId !== sessionId) return message;
        found = true;
        return { ...message, sessionStatus: status };
      });
      return found ? this.writeAll(next) : false;
    });
  }

  /** 历史读取；上次进程遗留的 pending 不再伪装成仍会回应。 */
  private async history(): Promise<SocialMessage[]> {
    const all = await this.readAll();
    return all.map((message) =>
      message.speakerType === 'owner' && message.responseStatus === 'pending'
        ? { ...message, responseStatus: 'unanswered' }
        : message,
    );
  }

  /** 历史会话摘要；没有消息的空会话不进入列表。 */
  async listSessions(): Promise<SocialSessionSummary[]> {
    return this.serialize(async () => {
      const sessions = new Map<string, SocialMessage[]>();
      for (const message of await this.history()) {
        const bucket = sessions.get(message.sessionId) ?? [];
        bucket.push(message);
        sessions.set(message.sessionId, bucket);
      }
      return [...sessions.values()].reverse().map((messages) => {
        const participantIds = [
          ...new Set(
            messages.flatMap(
              (message) => message.participantIds ?? (message.speakerType === 'owner' ? [] : [message.speakerId]),
            ),
          ),
        ];
        const participantNames = Object.fromEntries(
          messages
            .filter((message) => message.speakerType !== 'owner')
            .map((message) => [message.speakerId, message.speakerName ?? message.speakerId]),
        );
        return {
          id: messages[0].sessionId,
          status: messages[messages.length - 1].sessionStatus ?? 'finished',
          startedAt: messages[0].ts,
          updatedAt: messages[messages.length - 1].ts,
          participantIds,
          participantNames,
          revision: messages.length,
          messageCount: messages.length,
        };
      });
    });
  }

  /** 读取一场有消息的历史会话。 */
  async session(sessionId: string): Promise<SocialSessionSnapshot | null> {
    return this.serialize(async () => {
      const messages = (await this.history()).filter((message) => message.sessionId === sessionId);
      if (messages.length === 0) return null;
      const participantIds = [
        ...new Set(
          messages.flatMap(
            (message) => message.participantIds ?? (message.speakerType === 'owner' ? [] : [message.speakerId]),
          ),
        ),
      ];
      const participantNames = Object.fromEntries(
        messages
          .filter((message) => message.speakerType !== 'owner')
          .map((message) => [message.speakerId, message.speakerName ?? message.speakerId]),
      );
      return {
        id: sessionId,
        status: messages[messages.length - 1].sessionStatus ?? 'finished',
        startedAt: messages[0].ts,
        updatedAt: messages[messages.length - 1].ts,
        participantIds,
        participantNames,
        revision: messages.length,
        messageCount: messages.length,
        messages,
        ownerJoined: messages.some((message) => message.speakerType === 'owner'),
        allowOwnerJoin: false,
      };
    });
  }
}
