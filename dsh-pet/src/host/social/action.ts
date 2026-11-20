/**
 * 社交台词动作映射：本地情绪/关键词分类后，只从该宠物已有动画池里选白名单动作。
 * 模型不返回动作名；未命中保持中性待机，不写坐标、图片或第三方地址。
 * @module dsh-pet/src/host/social/action
 */
import { animationNames } from '../anim.ts';

export type SocialActionFamily = 'greeting' | 'happy' | 'thinking' | 'denying' | 'neutral';

const FAMILY_KEYWORDS: Record<Exclude<SocialActionFamily, 'neutral'>, readonly string[]> = {
  greeting: ['你好', '嗨', '早上好', '晚上好', '欢迎', '打招呼', '挥手'],
  happy: ['开心', '高兴', '哈哈', '太好了', '喜欢', '真棒', '兴奋', '可爱', '耶', '笑', '期待'],
  denying: ['不要', '不行', '拒绝', '不喜欢', '别', '算了', '摇头', '否定', '生气'],
  thinking: ['想', '觉得', '考虑', '也许', '可能', '猜', '犹豫', '思考', '怎么办', '托腮'],
};

const ANIMATION_KEYWORDS: Record<Exclude<SocialActionFamily, 'neutral'>, readonly string[]> = {
  greeting: ['挥手', '招手', '你好'],
  happy: ['开心', '跃动', '庆祝', '笑', '跳', '雀跃', '小跑'],
  denying: ['摇头', '拒绝', '生气', '叹气'],
  thinking: ['思考', '碎碎念', '托腮', '想'],
};

/** 只识别有限动作族；不确定时回落中性，避免误播。 */
export function classifySocialAction(text: string): SocialActionFamily {
  const normalized = text.toLowerCase();
  for (const family of ['greeting', 'happy', 'denying', 'thinking'] as const) {
    if (FAMILY_KEYWORDS[family].some((keyword) => normalized.includes(keyword.toLowerCase()))) return family;
  }
  return 'neutral';
}

/**
 * 从当前宠物配置动画池解析动作名。
 * 返回 undefined 表示没有合适动作；调用方只播气泡，不假定素材一定存在。
 */
export function resolveSocialAction(text: string, animations: unknown): string | undefined {
  const family = classifySocialAction(text);
  if (family === 'neutral') return undefined;
  const allowed = animationNames(animations);
  if (allowed.length === 0) return undefined;
  for (const keyword of ANIMATION_KEYWORDS[family]) {
    const hit = allowed.find((name) => name.includes(keyword));
    if (hit) return hit;
  }
  return undefined;
}
