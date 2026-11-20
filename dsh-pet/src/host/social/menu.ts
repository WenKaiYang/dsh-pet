/**
 * 社交右键菜单：复用第三方 MenuRegistry，一个 owner、一个消费者，卸载时唤醒并退出轮询。
 * @module dsh-pet/src/host/social/menu
 */
import { SOCIAL_MENU_OWNER, SOCIAL_MENU_START, SOCIAL_MENU_STOP, SOCIAL_MENU_VIEW } from '../../shared/social.ts';
import { MENU_WAIT_MAX_MS, type MenuRegistry } from '../menu.ts';
import type { LoggerLike } from '../log-file.ts';
import type { PollStateStore } from '../state.ts';
import type { SocialDirector } from './director.ts';

export { SOCIAL_MENU_OWNER, SOCIAL_MENU_START, SOCIAL_MENU_STOP, SOCIAL_MENU_VIEW } from '../../shared/social.ts';

/** 菜单循环需要的最小依赖。 */
export interface SocialMenuDeps {
  readonly menuRegistry: MenuRegistry;
  readonly state: Pick<PollStateStore, 'writeSection'>;
  readonly director: Pick<SocialDirector, 'start' | 'cancel'>;
  readonly showTimeline?: () => boolean;
  readonly log: LoggerLike;
}

/** 创建菜单生命周期；start 与 stop 都可重复调用。 */
export function createSocialMenu(deps: SocialMenuDeps) {
  const { menuRegistry, state, director, showTimeline = () => true, log } = deps;
  let disposed = false;
  let started = false;
  let loop: Promise<void> | null = null;

  /** 消费点击；启动操作异步执行，结束操作可以立即取消刚启动的会话。 */
  const consume = async (): Promise<void> => {
    while (!disposed) {
      const events = await menuRegistry.poll(SOCIAL_MENU_OWNER, MENU_WAIT_MAX_MS);
      if (disposed || events === null) break;
      const initiator = events[SOCIAL_MENU_START];
      if (initiator) {
        void director.start(initiator).catch((error) => {
          log.warn?.(`[dsh-pet] 社交菜单启动失败：${error instanceof Error ? error.message : String(error)}`);
        });
      }
      if (events[SOCIAL_MENU_VIEW]) {
        // 网页菜单由 client/social 当场打开面板，HTTP 事件只供桌面端消费。
      }
      if (events[SOCIAL_MENU_STOP]) director.cancel();
    }
  };

  return {
    /** 注册并启动唯一菜单循环。 */
    start(): void {
      if (disposed || started) return;
      const registered = menuRegistry.register({
        owner: SOCIAL_MENU_OWNER,
        labels: [SOCIAL_MENU_START, ...(showTimeline() ? [SOCIAL_MENU_VIEW] : []), SOCIAL_MENU_STOP],
        target: 'both',
      });
      if (!registered.ok) {
        log.warn?.(`[dsh-pet] 社交菜单注册失败：${registered.message}`);
        return;
      }
      started = true;
      state.writeSection('menu', { items: menuRegistry.snapshot() });
      loop = consume();
    },

    /** 同步注销并唤醒 poll；返回的 Promise 供测试或异步清理等待退出。 */
    async stop(): Promise<void> {
      disposed = true;
      if (started) {
        menuRegistry.clear(SOCIAL_MENU_OWNER);
        state.writeSection('menu', { items: menuRegistry.snapshot() });
        started = false;
      }
      await loop;
    },
  };
}
