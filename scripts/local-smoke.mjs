import { _electron as electron } from 'playwright';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url), root = process.cwd();
const calls = [];
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  const body = JSON.parse(raw); calls.push({ model: body.model, at: Date.now(), messages: body.messages });
  const content = body.model.includes('vl')
    ? { phase: 'live', gameSeconds: 750, situation: '模拟云端背景', players: [], danmaku: [] }
    : { text: '已结合提问新截图分析', speech: '', corrections: [], sourceIndexes: [], patchCorrection: '' };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const env = { ...process.env, WATCHMATE_DATA_DIR: path.join(root, '.smoke-data', `local-${Date.now()}`), WATCHMATE_TEST_MODE: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.WATCHMATE_DEV_URL;
const packaged = process.env.WATCHMATE_EXECUTABLE;
const app = await electron.launch({ executablePath: packaged || require('electron'), args: packaged ? [] : ['.'], env, cwd: root });
try {
  const page = await app.firstWindow();
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => requests.push(r.url()));
  page.on('console', m => { if (m.type() === 'error') console.log('Renderer:', m.text()); });
  const wait = async (test, timeout = 30000) => {
    const end = Date.now() + timeout; let s;
    while (Date.now() < end) { s = await page.evaluate(() => window.watchmate.snapshot()); if (test(s)) return s; await new Promise(r => setTimeout(r, 100)); }
    throw Error('Local state timeout: ' + JSON.stringify({ status: s.localStatus, frames: s.localFrames, ms: s.localLatencyMs, error: errors, messages: s.messages.slice(-3) }));
  };
  await app.evaluate(({ BrowserWindow }) => { const main = BrowserWindow.getAllWindows()[0]; main.webContents.setAudioMuted(true); main.showInactive(); });
  await page.evaluate(async baseUrl => {
    const s = await window.watchmate.snapshot();
    await window.watchmate.settings({ ...s.settings, apiKey: 'synthetic-only', searchKey: '', baseUrl, autoLearn: false, broadcastEnabled: false, danmakuEnabled: false, captureIntervalMs: 10000 });
    await window.watchmate.action({ type: 'start', mode: 'live' });
    await window.watchmate.action({ type: 'player', slot: 'left-top', patch: { name: 'TheShy', champion: '奥恩', locked: true } });
  }, `http://127.0.0.1:${server.address().port}/v1`);
  const html = `<html><head><title>Local OCR test broadcast</title></head><body style="margin:0;background:#111"><canvas id="c" width="640" height="420"></canvas><script>
    window.dead=false;window.start=Date.now();window.offset=0;window.freeze=false;window.freezeClock=750;window.replay='';
    const c=document.getElementById('c'),ctx=c.getContext('2d');
    window.draw=()=>{ctx.fillStyle='#111';ctx.fillRect(0,0,640,420);
      const t=window.freeze?window.freezeClock:750+Math.floor((Date.now()-window.start)/1000)+window.offset;
      ctx.fillStyle='white';ctx.font='bold 38px Arial';ctx.fillText(Math.floor(t/60)+':'+String(t%60).padStart(2,'0'),250,62);
      ctx.font='bold 28px "Microsoft YaHei",Arial';ctx.fillText(window.replay,440,60);
      for(let y=0;y<8;y++)for(let x=0;x<8;x++){let r=60+x*18,g=20+y*12,b=25;const v=(r*.299+g*.587+b*.114)*.65;ctx.fillStyle=window.dead?'rgb('+v+','+v+','+v+')':'rgb('+r+','+g+','+b+')';ctx.fillRect(40+x*8,130+y*8,8,8);}
      if(window.dead){ctx.fillStyle='white';ctx.font='bold 27px Arial';ctx.fillText('25',55,173);}
      ctx.fillStyle='#83dfc8';ctx.font='18px Arial';ctx.fillText('Synthetic HUD - not a real match',150,280);
    };window.draw();setInterval(window.draw,100);
  </script></body></html>`;
  await app.evaluate(async ({ BrowserWindow }, html) => {
    const b = new BrowserWindow({ width: 640, height: 420, frame: false, show: false, title: 'Local OCR test broadcast', webPreferences: { backgroundThrottling: false } });
    await b.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)); b.showInactive();
  }, html);
  const broadcast = (await app.windows()).find(p => p !== page);
  await page.getByRole('button', { name: '选择窗口', exact: true }).click();
  await page.getByRole('button', { name: 'Local OCR test broadcast', exact: true }).click();
  await wait(s => s.metrics.frames >= 1);
  await page.getByRole('button', { name: '校准区域', exact: true }).click();
  await page.getByRole('dialog', { name: '校准本地死亡检测' }).waitFor();
  const surface = page.locator('.calibration-surface');
  const box = await surface.boundingBox();
  const select = async (target, rect) => {
    await page.getByLabel('当前框选目标').selectOption(target);
    const [x, y, w, h] = rect;
    await page.mouse.move(box.x + x / 640 * box.width, box.y + y / 420 * box.height);
    await page.mouse.down(); await page.mouse.move(box.x + (x+w) / 640 * box.width, box.y + (y+h) / 420 * box.height, { steps: 4 }); await page.mouse.up();
  };
  await select('clock', [245, 23, 140, 45]); await select('left-top', [40, 130, 64, 64]);
  await select('replay', [430, 23, 190, 45]);
  fs.mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/local-calibration.png' });
  await page.getByRole('button', { name: '保存并开启本地检测' }).click();
  await wait(s => s.localFrames >= 4 && s.localStatus.startsWith('本地检测中'), 45000);
  await new Promise(r => setTimeout(r, 1500)); // give cached SAPI warmup time
  const evidenceAt = Date.now();
  await broadcast.evaluate(() => { window.dead = true; window.draw(); });
  const detected = await wait(s => s.messages.some(m => m.kind === 'banter'), 12000);
  const played = await wait(s => s.messages.some(m => m.kind === 'banter' && m.latencyMs != null), 15000);
  const joke = played.messages.find(m => m.kind === 'banter');
  assert.equal(joke.source, 'local');
  await new Promise(r => setTimeout(r, 1600));
  let s = await page.evaluate(() => window.watchmate.snapshot());
  assert.equal(s.messages.filter(m => m.kind === 'banter').length, 1);
  // A question forces a fresh vision request without waiting for the 10s cadence.
  const before = calls.length;
  await page.getByLabel('向搭子提问').fill('左边怎么赢'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await wait(s => s.messages.some(m => m.kind === 'answer'));
  assert.ok(calls.slice(before).some(c => c.model.includes('vl') && JSON.stringify(c.messages).includes('用户现在问')));
  await broadcast.evaluate(() => { window.replay = 'REPLAY'; });
  const englishReplay = await wait(s => s.localStatus.includes('回放允许开串') && s.messages.filter(m=>m.kind==='banter').length>=2);
  await broadcast.evaluate(() => { window.replay = '回放'; });
  await wait(s => s.localFrames >= englishReplay.localFrames + 2 && s.localStatus.includes('回放允许开串'));
  // A lower clock starts a new visible segment and may announce this death again.
  await broadcast.evaluate(() => { window.replay = ''; window.offset = -60; });
  await wait(s => s.localStatus.startsWith('本地检测中') && s.messages.filter(m=>m.kind==='banter').length>=3);
  s = await page.evaluate(() => window.watchmate.snapshot());
  assert.ok(s.messages.filter(m => m.kind === 'banter').length >= 3);
  await page.evaluate(() => window.watchmate.action({ type: 'pause' }));
  const count = calls.length, localCount = s.localFrames;
  await new Promise(r => setTimeout(r, 1500));
  s = await page.evaluate(() => window.watchmate.snapshot());
  assert.equal(calls.length, count); assert.ok(s.localFrames <= localCount + 1);
  assert.equal(requests.some(u => /^https?:/.test(u) && !u.includes('127.0.0.1')), false, 'OCR must not fetch a CDN');
  assert.deepEqual(errors, []);
  fs.writeFileSync('artifacts/local-smoke.json', JSON.stringify({
    passed: true, packaged: !!packaged, syntheticOnly: true, localFrames: detected.localFrames,
    lastLocalRecognitionMs: detected.localLatencyMs, detectionWallMs: detected.messages.find(m => m.kind === 'banter').at - evidenceAt,
    evidenceToAudioMs: joke.latencyMs, externalOCRRequests: 0,
    checks: ['实际窗口采集','手动框选校准','离线OCR时钟/死亡计时','灰头像立即触发','实际SAPI起播回执','静止画面不刷屏','回放及时间倒退允许开串','提问即时截图','暂停停止','无OCR外网请求'],
  }, null, 2));
  console.log('Local smoke passed:', { detectionWallMs: joke.at - evidenceAt, evidenceToAudioMs: joke.latencyMs, OCRms: detected.localLatencyMs });
} finally {
  await app.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
}
