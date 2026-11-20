import type { PetChatTabHost } from '../chat/register.ts';
import { makeSocialPanel, type SocialPanelRuntime } from './panel.ts';
import { injectSocialCss } from './styles.ts';

const TAB_ID = 'dsh-pet-social';
const TAB_KIND = 'pet-social';
const OPEN_EVENT = 'dsh-pet:open-social';

interface SidebarTabRegistry {
  register(definition: {
    readonly id: string;
    readonly kind: string;
    readonly priority: 'extension';
    readonly title: () => string;
    readonly guide: readonly {
      id: string;
      order: number;
      title: () => string;
      description?: () => string;
    }[];
  }): () => void;
}

export function openPetSocialTab(ctx: PetChatTabHost): void {
  const controller = ctx.get?.('sidebarRight') as { openTab?(kind: string): void } | undefined;
  controller?.openTab?.(TAB_KIND);
}

/** 菜单模块只发同页事件，右栏注册处持有真正的宿主上下文。 */
export function requestSocialPanelOpen(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_EVENT));
}

export function registerPetSocialTab(ctx: PetChatTabHost, rt: SocialPanelRuntime): () => void {
  const tabs = ctx.get?.('sidebarRightTabs') as SidebarTabRegistry | undefined;
  if (!tabs || typeof tabs.register !== 'function') {
    console.warn('[dsh-pet] 右侧栏不可用：宠物群聊标签未注册');
    return () => {};
  }
  const disposeCss = injectSocialCss();
  const Panel = makeSocialPanel(rt);
  const disposeType = tabs.register({
    id: TAB_ID,
    kind: TAB_KIND,
    priority: 'extension',
    title: () => '宠物群聊',
    guide: [
      { id: TAB_KIND, order: 410, title: () => '宠物群聊', description: () => '查看实时与历史群聊，并以主人身份参与' },
    ],
  });
  ctx.slots.inject('sidebar.right.pane.tab', function* () {
    yield ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID, order: 110 }, () => rt.h(Panel, {}));
  });
  const open = () => openPetSocialTab(ctx);
  if (typeof window !== 'undefined') window.addEventListener(OPEN_EVENT, open);
  return () => {
    if (typeof window !== 'undefined') window.removeEventListener(OPEN_EVENT, open);
    disposeType();
    disposeCss();
  };
}
