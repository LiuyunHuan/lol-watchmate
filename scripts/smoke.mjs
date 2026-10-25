import { _electron as electron } from 'playwright';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const root = process.cwd();
const output = path.join(root, 'artifacts');
fs.mkdirSync(output, { recursive: true });
const env = { ...process.env, WATCHMATE_DATA_DIR: path.join(root, '.smoke-data', String(Date.now())), WATCHMATE_TEST_MODE: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.WATCHMATE_DEV_URL;
const packaged = process.env.WATCHMATE_EXECUTABLE;
const app = await electron.launch({ executablePath: packaged || require('electron'), args: packaged ? [] : ['.'], cwd: root, env, timeout: 40000 });
const errors = [];
try {
  const page = await app.firstWindow();
  const capture = async name => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const image = await app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
      return image.toPNG().toString('base64');
    });
    fs.writeFileSync(path.join(output, name), Buffer.from(image, 'base64'));
  };
  const waitState = async (check, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const snapshot = await page.evaluate(() => window.watchmate.snapshot());
      if (check(snapshot)) return snapshot;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for desktop state: ${check.toString()}`);
  };
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true));
  await page.getByRole('button', { name: '体验演示', exact: true }).click();
  await page.getByRole('button', { name: '多人团战', exact: true }).click();
  await waitState(s => s.messages.filter(m => m.kind === 'banter').length === 2);
  const state = await page.evaluate(() => window.watchmate.snapshot());
  assert.equal(state.mode, 'demo');
  assert.equal(state.messages.find(m => m.kind === 'banter').text, '下雨了。');
  const voices = await page.evaluate(() => window.watchmate.voices());
  console.log('Installed speech voices:', voices.map(v => v.culture).join(', '));
  if (voices.some(v => v.culture.startsWith('zh'))) {
    await waitState(s => s.messages.some(m => m.kind === 'banter' && (m.speechStatus === 'done' || m.speechStatus === 'playing')), 25000);
    console.log('Native Chinese TTS and renderer playback: passed');
  } else console.log('Native Chinese TTS: requires a Windows Chinese speech voice');
  await page.getByLabel('向搭子提问').fill('左边怎么赢？');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await waitState(s => s.messages.some(m => m.kind === 'answer'));
  await capture('watchmate-desktop.png');
  await page.getByRole('button', { name: '费用提醒', exact: true }).click();
  await page.getByRole('dialog', { name: '到了本小时的预算提醒线' }).waitFor();
  await page.getByRole('button', { name: '暂停 Agent', exact: true }).click();
  await waitState(s => !s.running);
  await page.getByRole('button', { name: '系列赛', exact: true }).click();
  await page.getByRole('button', { name: '结束本局并更新' }).click();
  await waitState(s => s.memory.includes('第 1 局'));
  await page.getByRole('button', { name: '梗库', exact: true }).click();
  const generic=page.locator('.meme-card').filter({hasText:'先躺一会儿，队友还在上班。'});
  // Controlled checkbox is acknowledged asynchronously by the main-process IPC.
  // Playwright's uncheck() asserts synchronously before that reply can arrive.
  assert.equal(await generic.getByLabel('启用这句').isChecked(),true);
  await generic.getByLabel('启用这句').click();
  await waitState(s=>s.memes.some(m=>m.text==='先躺一会儿，队友还在上班。'&&m.enabled===false));
  assert.equal(await generic.getByLabel('启用这句').isChecked(),false);
  await capture('watchmate-memes.png');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('dialog', { name: '搭子的设置' }).waitFor();
  await capture('watchmate-settings.png');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const final = await page.evaluate(() => window.watchmate.snapshot());
  assert.ok(final.memory.includes('TheShy'));
  assert.equal(final.usage.length, 0);
  assert.equal('apiKey' in final.settings, false);
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'desktop-smoke.json'), JSON.stringify({ passed: true, errors, voices, messages: final.messages.length, tests: ['启动与预加载桥', '演示事件编排', '语音合成与播放（若有中文音色）', '文字问答', '预算弹窗与暂停', 'Markdown记录', '设置界面', '密钥不暴露给渲染进程'] }, null, 2));
  console.log('Desktop smoke passed; screenshots and report: artifacts/');
} finally { await app.close(); }
