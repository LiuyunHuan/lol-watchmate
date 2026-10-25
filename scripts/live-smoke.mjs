import { _electron as electron } from 'playwright';
import { createRequire } from 'node:module';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const root = process.cwd(), output = path.join(root, 'artifacts');
fs.mkdirSync(output, { recursive: true });
const requests = [];
let frameCount = 0;
const server = http.createServer(async (request, response) => {
  let input = ''; for await (const chunk of request) input += chunk;
  const body = JSON.parse(input);
  requests.push({ model: body.model, at: Date.now() });
  let text;
  if (body.model.includes('vl')) {
    frameCount++;
    text = JSON.stringify({
      phase: 'live', gameSeconds: 100 + frameCount, patch: 'test-only',
      teams: { left: '测试蓝方', right: '测试红方' }, situation: '自动化测试合成画面，不代表真实比赛。',
      players: [{ slot: 'left-top', name: 'TheShy', champion: '奥恩', dead: frameCount >= 3, deaths: frameCount >= 3 ? 1 : 0, confidence: 1, evidence: '模拟服务响应，用于验证接口链路' }],
      danmaku: [],
    });
  } else if (body.model.includes('asr')) text = '左边怎么赢';
  else text = JSON.stringify({ text: '模拟服务：阵容信息不足，先确认完整BP。', speech: '先确认完整阵容。', sourceIndexes: [], corrections: [], patchCorrection: '' });
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 100, completion_tokens: 80, seconds: 1 } }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const env = { ...process.env, WATCHMATE_DATA_DIR: path.join(root, '.smoke-data', `live-${Date.now()}`), WATCHMATE_TEST_MODE: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.WATCHMATE_DEV_URL;
const app = await electron.launch({ executablePath: require('electron'), args: ['.'], cwd: root, env, timeout: 40000 });
try {
  const page = await app.firstWindow();
  const waitState = async (predicate, timeout = 20000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const state = await page.evaluate(() => window.watchmate.snapshot());
      if (predicate(state)) return state;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`State timeout: ${predicate}`);
  };
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows()[0]; main.webContents.setAudioMuted(true); main.showInactive();
  });
  await page.evaluate(async baseUrl => {
    const state = await window.watchmate.snapshot();
    await window.watchmate.settings({
      ...state.settings, apiKey: 'local-smoke-test-only', searchKey: '', baseUrl,
      captureIntervalMs: 800, broadcastEnabled: false, autoLearn: false, danmakuEnabled: false,
      textInputRate: 1, textOutputRate: 2, visionInputRate: 1, visionOutputRate: 2, asrSecondRate: 0.001,
    });
    await window.watchmate.action({ type: 'start', mode: 'live' });
  }, `http://127.0.0.1:${port}/v1`);
  await app.evaluate(async ({ BrowserWindow }) => {
    const broadcast = new BrowserWindow({ width: 640, height: 420, title: 'Watchmate synthetic broadcast', show: false });
    await broadcast.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<html><head><title>Watchmate synthetic broadcast</title></head><body style="background:#17332c;color:#d0e8dc;font:32px sans-serif;padding:40px">WATCHMATE CAPTURE TEST<br><br>TheShy · Ornn<br>02:00 · 0 / 0 / 0</body></html>'));
    broadcast.showInactive();
  });
  await page.getByRole('button', { name: '选择窗口', exact: true }).click();
  await page.getByRole('button', { name: 'Watchmate synthetic broadcast', exact: true }).click();
  const detected = await waitState(s => s.metrics.frames >= 4);
  assert.equal(detected.messages.some(m => m.kind === 'banter'), false);
  assert.equal(detected.match.players[0].name, 'TheShy');
  assert.ok(frameCount >= 4);
  // Capture must continue while the user reads the series document.
  const beforeTab = frameCount;
  await page.getByRole('button', { name: '系列赛', exact: true }).click();
  await waitState(s => s.metrics.frames >= beforeTab + 2);
  await page.evaluate(() => window.watchmate.action({ type: 'question', text: '左边怎么赢' }));
  await waitState(s => s.messages.some(m => m.kind === 'answer'));
  assert.ok(requests.some(r => r.model === 'qwen-plus'));
  const wav = Buffer.alloc(32044);
  wav.write('RIFF', 0); wav.writeUInt32LE(32036, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(32000, 40);
  await page.evaluate(wav => window.watchmate.transcribe({ wav, seconds: 1 }), `data:audio/wav;base64,${wav.toString('base64')}`);
  await waitState(s => s.messages.filter(m => m.kind === 'answer').length >= 2);
  assert.ok(requests.some(r => r.model === 'qwen3-asr-flash'));
  await page.evaluate(() => window.watchmate.action({ type: 'pause' }));
  await new Promise(r => setTimeout(r, 300));
  const afterPause = requests.length;
  await new Promise(r => setTimeout(r, 1800));
  assert.equal(requests.length, afterPause);
  const final = await page.evaluate(() => window.watchmate.snapshot());
  assert.equal(final.running, false); assert.equal(final.speech, null);
  assert.ok(final.totalCost > 0);
  fs.writeFileSync(path.join(output, 'live-chain-smoke.json'), JSON.stringify({
    passed: true, service: 'localhost mock; NOT a real cloud/LoL benchmark',
    capturedFrames: final.metrics.frames, requestModels: requests.map(r => r.model),
    verified: ['真实Windows窗口授权采集', '采集到JPEG再发送到配置接口', '低频视觉不触发死亡玩梗', '切换面板仍继续采集', '问答接口', 'ASR接口及转提问', '暂停后停止请求', '估算费用'],
  }, null, 2));
  console.log('Live capture chain smoke passed (synthetic window + localhost model mocks).');
} finally {
  await app.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
