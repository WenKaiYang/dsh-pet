/**
 * 社交功能组合根：读取独立配置，复用宿主已有服务，注册自己的菜单与生命周期。
 * 这是上游 host/index.ts 唯一需要装配的入口。
 * @module dsh-pet/src/host/social/index
 */
import { join } from 'node:path';
import { readAllConfig } from '../config.ts';
import type { HostContext } from '../plugin/context.ts';
import type { PetLookup } from '../plugin/pet-lookup.ts';
import type { HostSetup } from '../plugin/setup.ts';
import { SocialDirector, socialParticipantOf } from './director.ts';
import { readSocialConfig } from './config.ts';
import { generateSocialTurn } from './generate.ts';
import { SocialMemoryStore } from './memory.ts';
import { createSocialRoute } from './route.ts';
import { createSocialMenu } from './menu.ts';
import type { SocialParticipant } from './types.ts';

/** 组合根输入；不创建第二份宿主 store。 */
export type SocialFeatureInput = { ctx: HostContext } & Pick<
  HostSetup,
  'configPaths' | 'userRoot' | 'log' | 'state' | 'menuRegistry'
> &
  Pick<PetLookup, 'lock' | 'sleep'>;

/** 社交功能产物：导演负责业务，路由与宿主原有处理器组合。 */
export interface SocialFeature {
  director: SocialDirector;
  handleRoute: ReturnType<typeof createSocialRoute>;
}

/** 创建社交功能。 */
export function createSocialFeature(deps: SocialFeatureInput): SocialFeature {
  const { ctx, configPaths, userRoot, log, state, menuRegistry, lock, sleep } = deps;
  const configFile = join(userRoot, 'social-config.json');
  const memory = new SocialMemoryStore({ file: join(userRoot, 'social-memory.json'), log });

  /** 每次启动会话重新拍平成品配置，新增、删除或隐藏宠物不需要重建 director。 */
  const readParticipants = (): SocialParticipant[] => {
    const merged = readAllConfig(configPaths);
    const out: SocialParticipant[] = [];
    for (const [entry, conf] of Object.entries(merged)) {
      const pets = Array.isArray(conf.pets) ? (conf.pets as Record<string, unknown>[]) : [];
      for (const pet of pets) {
        const participant = socialParticipantOf(entry, conf, pet);
        if (participant) out.push(participant);
      }
    }
    return out;
  };

  /** 没有配置音色时完全不写 voiceTo，避免渲染端发起必然失败的语音请求。 */
  const voiceConfigured = (): boolean => {
    try {
      const voice = readAllConfig(configPaths).main?.voiceName;
      return typeof voice === 'string' && voice.trim() !== '';
    } catch {
      return false;
    }
  };

  const director = new SocialDirector({
    readConfig: () => readSocialConfig(configFile, log),
    readParticipants,
    voiceConfigured,
    memory,
    generate: (input) => generateSocialTurn({ ctx, ...input }),
    lock,
    sleep,
    state,
    log,
  });
  const menu = createSocialMenu({
    menuRegistry,
    state,
    director,
    showTimeline: () => readSocialConfig(configFile, log).showTimeline,
    log,
  });

  ctx.effect(() => {
    // 启用状态在插件加载时决定是否注册菜单；每个会话的参数仍在 start 时重新读取。
    if (readSocialConfig(configFile, log).enabled) menu.start();
    return () => {
      director.dispose();
      void menu.stop();
    };
  }, 'dsh-pet: social interactions');
  return { director, handleRoute: createSocialRoute(director) };
}
