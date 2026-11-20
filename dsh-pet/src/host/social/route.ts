/**
 * 群聊面板的内部 HTTP 接口：只做路径、输入和状态应答，业务全部归 SocialDirector。
 * @module dsh-pet/src/host/social/route
 */
import { ROUTE_SEGMENT } from '../../shared/constants.ts';
import type { RouteResult } from '../http.ts';
import type { SocialDirector, SocialOwnerResult } from './director.ts';

export type SocialRouteDirector = Pick<
  SocialDirector,
  'sessions' | 'snapshotFor' | 'joinOwner' | 'sayOwner' | 'leaveOwner' | 'cancel'
>;

function json(status: number, obj: Record<string, unknown>): RouteResult {
  return { kind: 'json', status, obj };
}

function ownerFailure(result: SocialOwnerResult & { ok: false }): RouteResult {
  const status =
    result.reason === 'no-session' || result.reason === 'not-joined'
      ? 409
      : result.reason === 'storage-error'
        ? 500
        : 400;
  return json(status, { ok: false, error: result.reason });
}

/**
 * 创建社交路由；未命中返回 undefined，让现有宠物路由继续处理。
 * rawUrl 与上游 handlePetRoute 使用同一输入形状。
 */
export function createSocialRoute(director: SocialRouteDirector) {
  return async (rawUrl: string, method: string, body?: string): Promise<RouteResult | undefined> => {
    let url: URL;
    let rest: string;
    try {
      url = new URL(rawUrl, 'http://localhost');
      rest = decodeURIComponent(url.pathname.slice(ROUTE_SEGMENT.length + 1));
    } catch {
      return json(400, { ok: false, error: 'invalid-url' });
    }
    if (rest !== 'social' && !rest.startsWith('social/')) return undefined;
    if (method === 'GET' && rest === 'social/sessions') {
      return json(200, { ok: true, sessions: await director.sessions() });
    }
    if (method === 'GET' && rest === 'social/session') {
      const id = String(url.searchParams.get('id') ?? '').trim();
      if (!id) return json(400, { ok: false, error: 'invalid-session' });
      const session = await director.snapshotFor(id);
      if (!session) return json(404, { ok: false, error: 'unknown-session' });
      const after = Number(url.searchParams.get('afterRevision') ?? -1);
      if (after === session.revision) return json(200, { ok: true, unchanged: true, revision: session.revision });
      return json(200, { ok: true, session });
    }
    if (method === 'POST' && rest === 'social/owner/join') {
      const result = director.joinOwner();
      return result.ok ? json(200, { ok: true }) : ownerFailure(result);
    }
    if (method === 'POST' && rest === 'social/owner/messages') {
      let text: unknown;
      try {
        text = (JSON.parse(body ?? '{}') as { text?: unknown }).text;
      } catch {
        return json(400, { ok: false, error: 'invalid-json' });
      }
      if (typeof text !== 'string') return json(400, { ok: false, error: 'invalid-input' });
      const result = await director.sayOwner(text);
      return result.ok ? json(200, { ok: true, message: result.message }) : ownerFailure(result);
    }
    if (method === 'POST' && rest === 'social/owner/leave') {
      return json(200, { ok: true, left: await director.leaveOwner() });
    }
    if (method === 'POST' && rest === 'social/stop') {
      return json(200, { ok: true, stopped: director.cancel() });
    }
    return json(404, { ok: false, error: 'unknown-social-route' });
  };
}
