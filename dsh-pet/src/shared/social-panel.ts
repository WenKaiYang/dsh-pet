/**
 * 桌面群聊弹窗：与网页右栏读取同一组 /social 接口。
 * 只用 textContent 写聊天正文，轮询、提交和关闭都在此清理。
 * @module dsh-pet/src/shared/social-panel
 */
import { ROUTE_PATH } from './constants.ts';

export interface SocialTimelineMessage {
  speakerId: string;
  speakerType?: 'pet' | 'owner';
  speakerName?: string;
  text: string;
  ts: number;
  responseStatus?: 'pending' | 'answered' | 'unanswered';
}

export interface SocialTimelineSession {
  id: string;
  status: 'active' | 'finished' | 'cancelled' | 'failed';
  startedAt: number;
  participantIds: string[];
  participantNames: Record<string, string>;
  revision: number;
  messageCount: number;
  messages: SocialTimelineMessage[];
  ownerJoined: boolean;
  allowOwnerJoin: boolean;
  currentSpeakerId?: string;
}

export interface SocialDialogOptions {
  baseUrl?: string;
  x: number;
  y: number;
  clamp?: { x: number; y: number; w: number; h: number };
  onClose?: () => void;
}

export interface SocialDialogMount {
  el: HTMLElement;
  close: () => void;
}

const CSS = `
.dsh-pet-social-dialog{position:absolute;z-index:30;width:360px;height:480px;max-width:calc(100vw - 8px);max-height:calc(100vh - 8px);display:flex;flex-direction:column;gap:8px;padding:12px;background:rgba(255,255,255,.98);color:#282828;border:1px solid #ddd;border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,.22);font:13px/1.5 var(--dsh-pet-font-family,'Microsoft YaHei UI',sans-serif);pointer-events:auto;user-select:text}
.dsh-pet-social-dialog *{box-sizing:border-box}.dsh-pet-social-dialog button,.dsh-pet-social-dialog select,.dsh-pet-social-dialog textarea{font:inherit}
.dsh-pet-social-title{display:flex;align-items:center;gap:8px}.dsh-pet-social-title strong{flex:1;font-size:15px}.dsh-pet-social-close{border:0;background:transparent;font-size:18px;cursor:pointer;color:#666}
.dsh-pet-social-select,.dsh-pet-social-input{width:100%;border:1px solid #ccc;border-radius:6px;background:#fff;color:#222;padding:7px}
.dsh-pet-social-meta{font-size:11px;color:#666}.dsh-pet-social-error{padding:5px 7px;background:#fff0f0;color:#b42318;border-radius:5px;font-size:12px}
.dsh-pet-social-list{flex:1;min-height:100px;overflow-y:auto;display:flex;flex-direction:column;gap:9px;padding:3px}
.dsh-pet-social-item{display:flex;flex-direction:column;align-self:flex-start;max-width:90%;gap:2px}.dsh-pet-social-item.owner{align-self:flex-end;text-align:right}.dsh-pet-social-name,.dsh-pet-social-response{font-size:10px;color:#777}
.dsh-pet-social-bubble{padding:7px 9px;background:#f0f1f2;border-radius:9px;white-space:pre-wrap;overflow-wrap:anywhere}.dsh-pet-social-item.owner .dsh-pet-social-bubble{background:#dcf3e5}.dsh-pet-social-item.unanswered .dsh-pet-social-bubble{border:1px solid #d92d20}
.dsh-pet-social-empty{margin:auto;text-align:center;color:#777}.dsh-pet-social-composer{display:flex;flex-direction:column;gap:7px;border-top:1px solid #eee;padding-top:8px}.dsh-pet-social-input{min-height:62px;resize:vertical;user-select:text}
.dsh-pet-social-actions{display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap}.dsh-pet-social-actions button{padding:5px 9px;border:1px solid #bbb;border-radius:6px;background:#fff;color:#333;cursor:pointer}.dsh-pet-social-actions button.primary{background:#16794c;border-color:#16794c;color:#fff}.dsh-pet-social-actions button:disabled{opacity:.5;cursor:default}
`;
let styleTag: HTMLStyleElement | undefined;

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function reasonText(reason: string): string {
  const labels: Record<string, string> = {
    'no-session': '当前没有正在进行的群聊',
    'owner-disabled': '主人参与功能未开启',
    disabled: '主人参与功能未开启',
    'not-joined': '请先加入群聊',
    'already-joined': '主人已经加入',
    'invalid-input': '请输入有效内容',
    'storage-error': '聊天记录保存失败',
    'unknown-session': '这场群聊不存在或已清理',
  };
  return labels[reason] ?? `操作失败：${reason}`;
}

/** 挂载桌面群聊弹窗。 */
export function mountSocialDialog(options: SocialDialogOptions): SocialDialogMount {
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.textContent = CSS;
    document.head.appendChild(styleTag);
  }
  const baseUrl = options.baseUrl ?? ROUTE_PATH + '/social';
  const root = node('section', 'dsh-pet-social-dialog');
  root.setAttribute('aria-label', '宠物群聊');
  const title = node('div', 'dsh-pet-social-title');
  title.append(node('strong', undefined, '宠物群聊'));
  const closeButton = node('button', 'dsh-pet-social-close', '×');
  closeButton.title = '关闭';
  title.append(closeButton);
  const select = node('select', 'dsh-pet-social-select');
  select.setAttribute('aria-label', '选择群聊记录');
  const meta = node('div', 'dsh-pet-social-meta');
  const error = node('div', 'dsh-pet-social-error');
  error.hidden = true;
  const list = node('div', 'dsh-pet-social-list');
  const composer = node('div', 'dsh-pet-social-composer');
  const input = node('textarea', 'dsh-pet-social-input');
  input.maxLength = 500;
  input.placeholder = '以主人身份发言，Enter 发送，Shift+Enter 换行';
  const actions = node('div', 'dsh-pet-social-actions');
  const joinButton = node('button', undefined, '加入群聊');
  const leaveButton = node('button', undefined, '退出群聊');
  const sendButton = node('button', 'primary', '发送');
  const stopButton = node('button', undefined, '结束群聊');
  composer.append(input, actions);
  root.append(title, select, meta, error, list, composer);
  document.body.appendChild(root);

  const c =
    options.clamp && Number.isFinite(options.clamp.x + options.clamp.y + options.clamp.w + options.clamp.h)
      ? options.clamp
      : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
  const rect = root.getBoundingClientRect();
  root.style.left = Math.max(c.x + 4, Math.min(options.x, c.x + c.w - rect.width - 4)) + 'px';
  root.style.top = Math.max(c.y + 4, Math.min(options.y, c.y + c.h - rect.height - 4)) + 'px';

  let sessions: SocialTimelineSession[] = [];
  let snapshot: SocialTimelineSession | null = null;
  let selectedId = '';
  let closed = false;
  let busy = false;
  let loading = false;
  let lastRevision = -1;

  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(baseUrl + path, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
    });
    const body = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    return body;
  };

  const showError = (cause: unknown): void => {
    error.textContent = reasonText(cause instanceof Error ? cause.message : String(cause));
    error.hidden = false;
  };

  const render = (): void => {
    const old = selectedId;
    select.replaceChildren();
    if (!sessions.length) select.append(node('option', undefined, '暂无群聊记录'));
    for (const session of sessions) {
      const names = session.participantIds.map((id) => session.participantNames[id] || id).join('、');
      const option = node(
        'option',
        undefined,
        `${session.status === 'active' ? '●' : '○'} ${new Date(session.startedAt).toLocaleString()} · ${names}`,
      );
      option.value = session.id;
      select.append(option);
    }
    select.value = old;
    meta.textContent = snapshot
      ? `${snapshot.status === 'active' ? '对话中' : snapshot.status === 'finished' ? '已结束' : snapshot.status === 'cancelled' ? '已取消' : '已失败'} · ${snapshot.messageCount} 条 · ${snapshot.participantIds.map((id) => snapshot?.participantNames[id] || id).join('、')}`
      : '';
    if (snapshot?.currentSpeakerId) {
      meta.textContent += ` · 正在发言：${snapshot.participantNames[snapshot.currentSpeakerId] || snapshot.currentSpeakerId}`;
    }
    if (snapshot && snapshot.revision !== lastRevision) {
      lastRevision = snapshot.revision;
      list.replaceChildren();
      if (!snapshot.messages.length) list.append(node('div', 'dsh-pet-social-empty', '还没有消息'));
      for (const message of snapshot.messages) {
        const owner = message.speakerType === 'owner';
        const item = node(
          'article',
          `dsh-pet-social-item${owner ? ' owner' : ''}${message.responseStatus === 'unanswered' ? ' unanswered' : ''}`,
        );
        item.append(
          node(
            'span',
            'dsh-pet-social-name',
            (message.speakerName ||
              (owner ? '主人' : snapshot.participantNames[message.speakerId] || message.speakerId)) +
              (message.ts > 0 ? ` · ${new Date(message.ts).toLocaleTimeString()}` : ''),
          ),
        );
        item.append(node('div', 'dsh-pet-social-bubble', message.text));
        if (message.responseStatus) {
          const status =
            message.responseStatus === 'pending'
              ? '等待宠物回应'
              : message.responseStatus === 'answered'
                ? '已回应'
                : '未回应';
          item.append(node('span', 'dsh-pet-social-response', status));
        }
        list.append(item);
      }
      list.scrollTop = list.scrollHeight;
    } else if (!snapshot) {
      lastRevision = -1;
      list.replaceChildren(node('div', 'dsh-pet-social-empty', '从宠物右键菜单发起一场群聊吧'));
    }
    const active = snapshot?.status === 'active';
    composer.hidden = !active || !snapshot?.allowOwnerJoin;
    input.hidden = !snapshot?.ownerJoined;
    actions.replaceChildren();
    if (active && snapshot?.allowOwnerJoin) {
      actions.append(snapshot.ownerJoined ? leaveButton : joinButton);
      if (snapshot.ownerJoined) actions.append(sendButton);
      actions.append(stopButton);
    }
    for (const button of [joinButton, leaveButton, sendButton, stopButton]) button.disabled = busy;
    sendButton.disabled = busy || !input.value.trim();
  };

  const load = async (): Promise<void> => {
    if (loading || closed) return;
    loading = true;
    try {
      const body = await request<{ sessions: SocialTimelineSession[] }>('/sessions');
      if (closed) return;
      sessions = body.sessions;
      const previousId = selectedId;
      selectedId = sessions.some((item) => item.id === selectedId) ? selectedId : (sessions[0]?.id ?? '');
      const requestedId = selectedId;
      if (requestedId !== previousId) {
        snapshot = null;
        lastRevision = -1;
      }
      if (requestedId) {
        const afterRevision = requestedId === previousId ? lastRevision : -1;
        const timeline = await request<{ session?: SocialTimelineSession; unchanged?: boolean }>(
          `/session?id=${encodeURIComponent(requestedId)}&afterRevision=${afterRevision}`,
        );
        if (selectedId === requestedId && !timeline.unchanged) snapshot = timeline.session ?? null;
      } else {
        snapshot = null;
      }
      if (!closed) {
        error.hidden = true;
        render();
      }
    } catch (cause) {
      if (!closed) showError(cause);
    } finally {
      loading = false;
    }
  };

  const perform = async (task: () => Promise<unknown>): Promise<void> => {
    if (busy || closed) return;
    busy = true;
    error.hidden = true;
    render();
    try {
      await task();
      await load();
    } catch (cause) {
      if (!closed) showError(cause);
    } finally {
      busy = false;
      if (!closed) render();
    }
  };
  const send = (): void => {
    const text = input.value.trim();
    if (!text) return;
    void perform(async () => {
      await request('/owner/messages', { method: 'POST', body: JSON.stringify({ text }) });
      input.value = '';
    });
  };

  select.addEventListener('change', () => {
    selectedId = select.value;
    lastRevision = -1;
    void load();
  });
  input.addEventListener('input', render);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
  });
  joinButton.addEventListener('click', () => void perform(() => request('/owner/join', { method: 'POST' })));
  leaveButton.addEventListener('click', () => void perform(() => request('/owner/leave', { method: 'POST' })));
  stopButton.addEventListener('click', () => void perform(() => request('/stop', { method: 'POST' })));
  sendButton.addEventListener('click', send);

  const close = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onEscape, true);
    root.remove();
    options.onClose?.();
  };
  const onOutside = (event: MouseEvent): void => {
    if (!root.contains(event.target as Node)) close();
  };
  const onEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close();
  };
  closeButton.addEventListener('click', close);
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onEscape, true);
  const timer = setInterval(() => void load(), 1500);
  render();
  void load();
  return { el: root, close };
}
