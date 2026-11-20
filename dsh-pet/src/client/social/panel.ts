import type * as ReactNS from 'react';
import {
  joinSocialOwner,
  leaveSocialOwner,
  listSocialSessions,
  readSocialSession,
  saySocialOwner,
  stopSocialSession,
} from './api.ts';
import type { SocialMessage, SocialSession } from './types.ts';

export interface SocialPanelRuntime {
  h: typeof ReactNS.createElement;
  useState: typeof ReactNS.useState;
  useEffect: typeof ReactNS.useEffect;
  useRef: typeof ReactNS.useRef;
}

const STATUS_TEXT: Record<SocialSession['status'], string> = {
  active: '对话中',
  finished: '已结束',
  cancelled: '已取消',
  failed: '已失败',
};

const TOPIC_STAGE_TEXT: Record<NonNullable<SocialSession['topic']>['stage'], string> = {
  opening: '开场',
  expansion: '展开',
  followup: '追问',
  conflict: '分歧',
  closing: '收尾',
};

function errorText(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  const labels: Record<string, string> = {
    'no-session': '当前没有正在进行的群聊',
    'owner-disabled': '主人参与功能未开启',
    disabled: '主人参与功能未开启',
    'already-joined': '主人已经加入',
    'not-joined': '请先加入群聊',
    'invalid-input': '请输入有效内容',
    'storage-error': '聊天记录保存失败，请稍后重试',
    'unknown-session': '这场群聊不存在或已清理',
  };
  return labels[reason] ?? `操作失败：${reason}`;
}

function messageName(message: SocialMessage, session: SocialSession): string {
  if (message.speakerType === 'owner') return message.speakerName || '主人';
  return message.speakerName || session.participantNames[message.speakerId] || message.speakerId;
}

function responseText(message: SocialMessage): string {
  if (message.responseStatus === 'pending') return '等待宠物回应';
  if (message.responseStatus === 'answered') return '已回应';
  if (message.responseStatus === 'unanswered') return '未回应';
  return '';
}

/** 创建群聊右栏；所有消息都以文本节点渲染。 */
export function makeSocialPanel(rt: SocialPanelRuntime): () => ReactNS.ReactElement {
  const { h, useState, useEffect, useRef } = rt;
  return function SocialPanel() {
    const [sessions, setSessions] = useState<SocialSession[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [snapshot, setSnapshot] = useState<SocialSession | null>(null);
    const [draft, setDraft] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const selectedRef = useRef('');
    const revisionRef = useRef(-1);
    const scrollRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      selectedRef.current = selectedId;
    }, [selectedId]);

    useEffect(() => {
      let disposed = false;
      let loading = false;
      const load = async () => {
        if (loading) return;
        loading = true;
        try {
          const list = await listSocialSessions();
          if (disposed) return;
          setSessions(list);
          const oldId = selectedRef.current;
          const id = list.some((item) => item.id === oldId) ? oldId : (list[0]?.id ?? '');
          if (id !== oldId) {
            selectedRef.current = id;
            revisionRef.current = -1;
            setSelectedId(id);
          }
          const fresh = id ? await readSocialSession(id, revisionRef.current) : null;
          if (!disposed) {
            if (fresh) {
              revisionRef.current = fresh.revision;
              setSnapshot(fresh);
            } else if (!id) {
              revisionRef.current = -1;
              setSnapshot(null);
            }
            setError('');
          }
        } catch (cause) {
          if (!disposed) setError(errorText(cause));
        } finally {
          loading = false;
        }
      };
      void load();
      const timer = setInterval(() => void load(), 1500);
      return () => {
        disposed = true;
        clearInterval(timer);
      };
    }, []);

    useEffect(() => {
      const element = scrollRef.current;
      if (element) element.scrollTop = element.scrollHeight;
    }, [snapshot?.revision, snapshot?.messages.length]);

    const reload = async () => {
      const list = await listSocialSessions();
      setSessions(list);
      if (selectedId) {
        const fresh = await readSocialSession(selectedId);
        revisionRef.current = fresh?.revision ?? -1;
        setSnapshot(fresh);
      }
    };

    const perform = async (action: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      setError('');
      try {
        await action();
        await reload();
      } catch (cause) {
        setError(errorText(cause));
      } finally {
        setBusy(false);
      }
    };

    const send = () => {
      const text = draft.trim();
      if (!text) return;
      void perform(async () => {
        await saySocialOwner(text);
        setDraft('');
      });
    };

    const active = snapshot?.status === 'active';
    const names = snapshot?.participantIds.map((id) => snapshot.participantNames[id] || id).join('、') ?? '';
    const sessionOptions = sessions.map((item) =>
      h(
        'option',
        { key: item.id, value: item.id },
        `${item.status === 'active' ? '●' : '○'} ${new Date(item.startedAt).toLocaleString()} · ${item.participantIds.map((id) => item.participantNames[id] || id).join('、')}`,
      ),
    );

    return h(
      'section',
      { className: 'dsh-pet-social', 'aria-label': '宠物群聊' },
      h('div', { className: 'dsh-pet-social-head' }, h('strong', null, '宠物群聊')),
      h(
        'select',
        {
          className: 'dsh-pet-social-select',
          value: selectedId,
          onChange: (event: ReactNS.ChangeEvent<HTMLSelectElement>) => {
            revisionRef.current = -1;
            setSnapshot(null);
            setSelectedId(event.target.value);
          },
          'aria-label': '选择群聊记录',
        },
        sessions.length === 0 ? h('option', { value: '' }, '暂无群聊记录') : sessionOptions,
      ),
      snapshot
        ? h(
            'div',
            { className: 'dsh-pet-social-meta' },
            h('span', null, STATUS_TEXT[snapshot.status]),
            snapshot.topic
              ? h('span', null, `· 话题：${snapshot.topic.title}（${TOPIC_STAGE_TEXT[snapshot.topic.stage]}）`)
              : null,
            h('span', null, `· ${snapshot.messageCount} 条`),
            snapshot.currentSpeakerId
              ? h(
                  'span',
                  null,
                  `· 正在发言：${snapshot.participantNames[snapshot.currentSpeakerId] || snapshot.currentSpeakerId}`,
                )
              : null,
            snapshot.ownerJoined ? h('span', null, '· 主人已加入') : null,
            h('div', { className: 'dsh-pet-social-members' }, names),
          )
        : null,
      error ? h('div', { className: 'dsh-pet-social-error', role: 'alert' }, error) : null,
      h(
        'div',
        { className: 'dsh-pet-social-messages', ref: scrollRef, 'aria-live': 'polite' },
        snapshot?.messages.length
          ? snapshot.messages.map((message, index) => {
              const owner = message.speakerType === 'owner';
              const unanswered = message.responseStatus === 'unanswered';
              return h(
                'article',
                {
                  key: `${message.ts}-${message.speakerId}-${index}`,
                  className: `dsh-pet-social-message${owner ? ' owner' : ''}${unanswered ? ' failed' : ''}`,
                },
                h(
                  'span',
                  { className: 'dsh-pet-social-message-name' },
                  `${messageName(message, snapshot)}${message.ts > 0 ? ` · ${new Date(message.ts).toLocaleTimeString()}` : ''}`,
                ),
                h('div', { className: 'dsh-pet-social-bubble' }, message.text),
                responseText(message) ? h('span', { className: 'dsh-pet-social-status' }, responseText(message)) : null,
              );
            })
          : h('div', { className: 'dsh-pet-social-empty' }, '还没有消息', h('br'), '从宠物右键菜单发起一场群聊吧'),
      ),
      active && snapshot.allowOwnerJoin
        ? h(
            'div',
            { className: 'dsh-pet-social-composer' },
            snapshot.ownerJoined
              ? h('textarea', {
                  className: 'dsh-pet-social-input',
                  value: draft,
                  maxLength: 500,
                  placeholder: '以主人身份发言，Enter 发送，Shift+Enter 换行',
                  onChange: (event: ReactNS.ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value),
                  onKeyDown: (event: ReactNS.KeyboardEvent<HTMLTextAreaElement>) => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      send();
                    }
                  },
                })
              : null,
            h(
              'div',
              { className: 'dsh-pet-social-actions' },
              snapshot.ownerJoined
                ? h(
                    'button',
                    {
                      className: 'dsh-pet-social-button',
                      disabled: busy,
                      onClick: () => void perform(leaveSocialOwner),
                    },
                    '退出群聊',
                  )
                : h(
                    'button',
                    {
                      className: 'dsh-pet-social-button',
                      disabled: busy,
                      onClick: () => void perform(joinSocialOwner),
                    },
                    '加入群聊',
                  ),
              snapshot.ownerJoined
                ? h(
                    'button',
                    { className: 'dsh-pet-social-button primary', disabled: busy || !draft.trim(), onClick: send },
                    '发送',
                  )
                : null,
              h(
                'button',
                { className: 'dsh-pet-social-button', disabled: busy, onClick: () => void perform(stopSocialSession) },
                '结束群聊',
              ),
            ),
          )
        : null,
    );
  };
}
