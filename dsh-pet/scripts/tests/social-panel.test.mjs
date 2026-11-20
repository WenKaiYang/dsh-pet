import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { _electron } from 'playwright';
import { rolldown } from 'rolldown';

let electronApp;
let server;
let url;
let bundleCode;
let reactBundleCode;
const calls = [];
const session = {
  id: 'social-test',
  status: 'active',
  startedAt: 1,
  updatedAt: 1,
  participantIds: ['a', 'b', 'c'],
  participantNames: { a: '薄荷', b: '可可', c: '麦芽' },
  revision: 1,
  messageCount: 1,
  messages: [{ speakerId: 'a', speakerType: 'pet', speakerName: '薄荷', text: '你好 <b>主人</b>', ts: 1 }],
  ownerJoined: false,
  allowOwnerJoin: true,
};

before(async () => {
  const bundle = await rolldown({
    input: fileURLToPath(new URL('./social-panel.fixture.js', import.meta.url)),
    platform: 'browser',
  });
  const { output } = await bundle.generate({ format: 'iife' });
  bundleCode = output[0].code;
  await bundle.close();
  const reactBundle = await rolldown({
    input: fileURLToPath(new URL('./social-react-panel.fixture.js', import.meta.url)),
    platform: 'browser',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  });
  const reactOutput = await reactBundle.generate({ format: 'iife' });
  reactBundleCode = reactOutput.output[0].code;
  await reactBundle.close();
  server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    if (req.url?.startsWith('/dsh-pet-7340/')) req.url = req.url.slice('/dsh-pet-7340'.length);
    if (req.url === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundleCode);
      return;
    }
    if (req.url === '/react-fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(reactBundleCode);
      return;
    }
    if (req.url === '/') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<html><body><script src="/fixture.js"></script></body></html>');
      return;
    }
    if (req.url === '/social/sessions' && req.method === 'GET') {
      res.end(JSON.stringify({ sessions: [session] }));
      return;
    }
    if (req.url?.startsWith('/social/session?') && req.method === 'GET') {
      res.end(JSON.stringify({ session }));
      return;
    }
    if (req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      calls.push({ url: req.url, body: raw ? JSON.parse(raw) : null });
      if (req.url === '/social/owner/join') session.ownerJoined = true;
      if (req.url === '/social/owner/leave') session.ownerJoined = false;
      if (req.url === '/social/stop') session.status = 'finished';
      if (req.url === '/social/owner/messages') {
        const input = JSON.parse(raw);
        session.messages.push({
          speakerId: 'owner',
          speakerType: 'owner',
          speakerName: '主人',
          text: input.text,
          ts: 2,
          responseStatus: 'answered',
        });
        session.messageCount = session.messages.length;
      }
      session.revision += 1;
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, SOCIAL_TEST_URL: url };
  delete env.ELECTRON_RUN_AS_NODE;
  electronApp = await _electron.launch({
    executablePath: join(homedir(), '.dsh', 'electron', 'electron.exe'),
    args: [fileURLToPath(new URL('./social-panel.fixture.cjs', import.meta.url))],
    env,
  });
});

after(async () => {
  await electronApp?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('桌面群聊面板真实 Electron：时间线、加入、发言、退出、结束与安全文本', async () => {
  const page = await electronApp.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.evaluate((base) => window.mountSocialDialog({ baseUrl: base + '/social', x: 20, y: 20 }), url);
  await page.waitForSelector('.dsh-pet-social-item');
  assert.equal(await page.locator('.dsh-pet-social-bubble b').count(), 0);
  assert.equal(await page.locator('.dsh-pet-social-bubble').first().textContent(), '你好 <b>主人</b>');
  await page.getByRole('button', { name: '加入群聊' }).click();
  await page.locator('.dsh-pet-social-input').fill('三位好，一起聊聊');
  await page.locator('.dsh-pet-social-input').press('Enter');
  await page.waitForFunction(() =>
    document.querySelector('.dsh-pet-social-list')?.textContent?.includes('三位好，一起聊聊'),
  );
  await page.getByRole('button', { name: '退出群聊' }).click();
  await page.waitForFunction(() => document.querySelector('.dsh-pet-social-input')?.hidden === true);
  await page.getByRole('button', { name: '结束群聊' }).click();
  await page.waitForFunction(() => document.querySelector('.dsh-pet-social-meta')?.textContent?.includes('已结束'));
  assert.deepEqual(
    calls.map((call) => call.url),
    ['/social/owner/join', '/social/owner/messages', '/social/owner/leave', '/social/stop'],
  );
  assert.equal(calls[1].body.text, '三位好，一起聊聊');
  assert.deepEqual(errors, []);
  await page.locator('.dsh-pet-social-close').click();
  assert.equal(await page.locator('.dsh-pet-social-dialog').count(), 0);
});

test('网页 React 群聊面板真实 DOM：连续发言、状态刷新与卸载清理', async () => {
  calls.length = 0;
  session.status = 'active';
  session.ownerJoined = false;
  session.revision += 1;
  session.messages = [{ speakerId: 'a', speakerType: 'pet', speakerName: '薄荷', text: '网页群聊', ts: 1 }];
  session.messageCount = 1;
  const page = await electronApp.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.addScriptTag({ url: '/react-fixture.js' });
  await page.evaluate(() => {
    window.disposeReactSocial = window.mountReactSocial();
  });
  await page.waitForSelector('.dsh-pet-social-message');
  await page.getByRole('button', { name: '加入群聊' }).click();
  await page.locator('.dsh-pet-social-input').fill('第一条');
  assert.equal(await page.locator('.dsh-pet-social-input').getAttribute('maxlength'), '500');
  await page.locator('.dsh-pet-social-input').press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.dsh-pet-social-message.owner').length === 1);
  await page.locator('.dsh-pet-social-input').fill('第二条');
  await page.locator('.dsh-pet-social-input').press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.dsh-pet-social-message.owner').length === 2);
  assert.deepEqual(
    calls.map((call) => call.url),
    ['/social/owner/join', '/social/owner/messages', '/social/owner/messages'],
  );
  assert.deepEqual(
    calls.slice(1).map((call) => call.body.text),
    ['第一条', '第二条'],
  );
  await page.getByRole('button', { name: '退出群聊' }).click();
  await page.getByRole('button', { name: '结束群聊' }).click();
  await page.waitForFunction(() => document.querySelector('.dsh-pet-social-meta')?.textContent?.includes('已结束'));
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.disposeReactSocial());
  assert.equal(await page.locator('.dsh-pet-social').count(), 0);
});
