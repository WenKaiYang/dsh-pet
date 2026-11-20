import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifySocialAction, resolveSocialAction } from './action.ts';

const animations = {
  clicks: ['点击回应-开心跃动', '点击回应-害羞惊讶'],
  categories: [{ actions: ['深度思考碎碎念'] }],
};

test('台词归入有限动作族，不确定时保持中性', () => {
  assert.equal(classifySocialAction('你好呀，很高兴见到你'), 'greeting');
  assert.equal(classifySocialAction('太好了，我很喜欢这个主意'), 'happy');
  assert.equal(classifySocialAction('让我想一想，可能再考虑一下'), 'thinking');
  assert.equal(classifySocialAction('不要，我拒绝这个安排'), 'denying');
  assert.equal(classifySocialAction('今天聊得还可以'), 'neutral');
});

test('动作只从已有动画池命中，不发明不存在的动作名', () => {
  assert.equal(resolveSocialAction('太好了！', animations), '点击回应-开心跃动');
  assert.equal(resolveSocialAction('让我想一想', animations), '深度思考碎碎念');
  assert.equal(resolveSocialAction('太好了！', {}), undefined);
  assert.equal(resolveSocialAction('随便聊聊', animations), undefined);
});
