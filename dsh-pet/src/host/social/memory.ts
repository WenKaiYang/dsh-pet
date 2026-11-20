/**
 * 社交记忆：独立 JSON、串行 read-modify-write、原子替换与容量限制。
 * 只保存已成功演出的台词；损坏数据按空历史降级，绝不影响主人聊天记忆。
 * @module dsh-pet/src/host/social/memory
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LoggerLike } from '../log-file.ts';
import type { SocialMessage } from './types.ts';

/** 文件里的一条有效记录；脏条目被丢弃，不让一条坏数据毁掉整份历史。 */
function validMessage(value: unknown): value is SocialMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.sessionId === 'string' &&
    m.sessionId !== '' &&
    typeof m.speakerId === 'string' &&
    m.speakerId !== '' &&
    typeof m.targetId === 'string' &&
    m.targetId !== '' &&
    typeof m.text === 'string' &&
    m.text !== '' &&
    typeof m.ts === 'number' &&
    Number.isFinite(m.ts) &&
    m.ts >= 0
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

  /** 追加一条台词；写盘失败只记日志并返回 false，不把已经演出的气泡判成失败。 */
  async append(message: SocialMessage): Promise<boolean> {
    return this.serialize(async () => {
      const staging = this.file + '.tmp';
      try {
        const all = await this.readAll();
        const next = pruneSocialMessages([...all, message]);
        await mkdir(dirname(this.file), { recursive: true });
        await writeFile(staging, JSON.stringify(next, null, 2), 'utf8');
        await rename(staging, this.file);
        return true;
      } catch (error) {
        await rm(staging, { force: true }).catch(() => undefined);
        this.log?.warn?.(
          `[dsh-pet] 社交记忆写入失败：${this.file}（${error instanceof Error ? error.message : String(error)}）`,
        );
        return false;
      }
    });
  }
}
