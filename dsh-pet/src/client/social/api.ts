import { ROUTE_PATH } from '../../shared/constants.ts';
import type { SocialMessage, SocialSession } from './types.ts';

interface ErrorBody {
  error?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(ROUTE_PATH + path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  });
  const body = (await response.json().catch(() => ({}))) as T & ErrorBody;
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

export async function listSocialSessions(): Promise<SocialSession[]> {
  const body = await request<{ sessions: SocialSession[] }>('/social/sessions');
  return body.sessions;
}

export async function readSocialSession(id: string, afterRevision = -1): Promise<SocialSession | null> {
  const body = await request<{ session?: SocialSession; unchanged?: boolean }>(
    `/social/session?id=${encodeURIComponent(id)}&afterRevision=${afterRevision}`,
  );
  return body.unchanged ? null : (body.session ?? null);
}

export async function joinSocialOwner(): Promise<void> {
  await request('/social/owner/join', { method: 'POST' });
}

export async function saySocialOwner(text: string): Promise<SocialMessage> {
  const body = await request<{ message: SocialMessage }>('/social/owner/messages', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
  return body.message;
}

export async function leaveSocialOwner(): Promise<void> {
  await request('/social/owner/leave', { method: 'POST' });
}

export async function stopSocialSession(): Promise<void> {
  await request('/social/stop', { method: 'POST' });
}
