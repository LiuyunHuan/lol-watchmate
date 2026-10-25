import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, safeStorage, session, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { Engine } from './engine';
import { Storage } from './storage';
import { AudioCache } from './audio';
import { Action, settingsSchema, slotSchema } from '../src/shared/types';
import { localProfileSchema, localReadingSchema } from '../src/shared/local';
import { broadcastSchema, viewportSchema } from '../src/shared/broadcast';
import { parseMemeMarkdown } from '../src/core/banter';

if (process.env.WATCHMATE_DATA_DIR) app.setPath('userData', path.resolve(process.env.WATCHMATE_DATA_DIR));
app.setAppUserModelId('io.watchmate.lol');
let win: BrowserWindow;
let engine: Engine;
let selectedSource: string | null = null;
const side = z.enum(['left', 'right']);
const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), mode: z.enum(['demo', 'live']) }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('question'), text: z.string().min(1).max(4000) }),
  z.object({ type: z.literal('player'), slot: slotSchema, patch: z.object({
    name: z.string().max(80).optional(), champion: z.string().max(80).optional(), allowBanter: z.boolean().optional(),
    priority: z.number().min(0).max(100).optional(), style: z.string().max(200).optional(), locked: z.boolean().optional(),
  }) }),
  z.object({ type: z.literal('team'), side, name: z.string().max(80).optional(), allowBanter: z.boolean().optional(), protect: z.boolean().optional() }),
  z.object({ type: z.literal('context'), patch: z.string().max(40).optional(), seriesTitle: z.string().max(100).optional(),
    bans: z.object({ left: z.array(z.string().max(50)).max(5), right: z.array(z.string().max(50)).max(5) }).optional() }),
  z.object({ type: z.literal('speaking'), value: z.boolean() }),
  z.object({ type: z.literal('speech'), id: z.string().max(200), event: z.enum(['started', 'done', 'error']), error: z.string().max(300).optional() }),
  z.object({ type: z.literal('demo'), event: z.enum(['death', 'teamfight', 'replay', 'bp', 'budget']) }),
  z.object({ type: z.literal('finish-game') }), z.object({ type: z.literal('next-game') }),
  z.object({ type: z.literal('new-series'), title: z.string().max(100) }),
  z.object({ type: z.literal('ack-budget') }),
  z.object({ type: z.literal('meme-search'), players: z.array(z.object({ name: z.string().trim().min(1).max(80), team: z.string().max(80), focus: z.boolean() })).min(1).max(20), cutoff: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => Number.isFinite(Date.parse(s)) && new Date(s).toISOString().startsWith(s), '无效截止日期') }),
  z.object({ type: z.literal('meme-cancel') }),
  z.object({ type: z.literal('meme-toggle'), id: z.string().uuid(), enabled: z.boolean() }),
  z.object({ type: z.literal('meme-save'), id: z.string().uuid().optional(), target: z.string().trim().min(1).max(80), text: z.string().trim().min(1).max(100), kind: z.enum(['player','team']), condition: z.enum(['death','four-allies-alive','manual-only']).optional() }),
  z.object({ type: z.literal('meme-review'), ids: z.array(z.string().uuid()).max(500), operation: z.enum(['approve','delete','restore']) }),
  z.object({type:z.literal('broadcast-area'),rect:viewportSchema}),
  z.object({type:z.literal('broadcast-reset')}),
  z.object({type:z.literal('draft-pick'),side,position:z.number().int().min(1).max(5),championId:z.string().max(60),order:z.number().int().min(1).max(5).nullable()}),
  z.object({ type: z.literal('local-arm'), value: z.boolean() }),
]);
function bind(name: string, callback: (data: any) => unknown) {
  ipcMain.handle(name, async (event, data) => {
    if (!win || event.sender.id !== win.webContents.id || event.senderFrame !== win.webContents.mainFrame) throw new Error('未授权窗口');
    return callback(data);
  });
}
async function main() {
  const storage = new Storage(app.getPath('userData'));
  const settings = storage.loadSettings(s => safeStorage.decryptString(Buffer.from(s, 'base64')));
  const resourceRoot = app.isPackaged ? path.join(process.resourcesPath, 'resources') : path.join(app.getAppPath(), 'resources');
  const audio = new AudioCache(path.join(storage.root, 'audio'), path.join(resourceRoot, 'speech.ps1'));
  engine = new Engine(storage, settings, audio);
  win = new BrowserWindow({
    width: 1440, height: 940, minWidth: 1080, minHeight: 720,
    backgroundColor: '#0d1118', title: 'LOL 观赛搭子', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => { if (process.env.WATCHMATE_TEST_MODE !== '1') win.show(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(contents.id === win.webContents.id && ['media', 'display-capture'].includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission) =>
    contents?.id === win.webContents.id && ['media', 'display-capture'].includes(permission));
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if (!selectedSource || !engine.state.running || engine.state.mode !== 'live' || request.frame !== win.webContents.mainFrame) return callback({});
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
      const source = sources.find(s => s.id === selectedSource);
      if (!source) return callback({});
      callback({ video: source });
    } catch { callback({}); }
  });
  engine.subscribe(state => { if (!win.isDestroyed()) win.webContents.send('state', state); });
  bind('snapshot', () => engine.state);
  bind('action', data => engine.action(actionSchema.parse(data) as Action));
  bind('settings', data => {
    const parsed = settingsSchema.parse(data);
    // Empty inputs retain saved keys; "__DELETE__" explicitly removes them.
    parsed.apiKey = parsed.apiKey === '__DELETE__' ? '' : parsed.apiKey || engine.settings.apiKey;
    parsed.searchKey = parsed.searchKey === '__DELETE__' ? '' : parsed.searchKey || engine.settings.searchKey;
    if ((parsed.apiKey || parsed.searchKey) && !safeStorage.isEncryptionAvailable()) throw new Error('系统凭据加密不可用，未保存密钥');
    storage.saveSettings(parsed, s => safeStorage.encryptString(s).toString('base64'));
    engine.updateSettings(parsed);
  });
  bind('sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 240, height: 135 } });
    return sources.filter(s => s.name !== 'LOL 观赛搭子').map(s => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
  });
  bind('select-source', async data => {
    const id = z.string().max(200).parse(data);
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
    if (!sources.some(s => s.id === id)) throw new Error('窗口已关闭，请重新选择');
    selectedSource = id; engine.setSource(id);
  });
  bind('frame', async data => {
    const frame = z.object({ image: z.string().max(3_000_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/), at: z.number().finite() }).parse(data);
    if (Math.abs(Date.now() - frame.at) > 10000) return;
    await engine.frame(frame.image, frame.at);
  });
  bind('local-profile', data => engine.configureLocal(localProfileSchema.parse(data)));
  bind('local-reading', data => engine.localReading(localReadingSchema.parse(data)));
  bind('broadcast', data => engine.broadcastReading(broadcastSchema.parse(data)));
  bind('question-frame', data => {
    const frame = z.object({ id: z.string().uuid(), image: z.string().max(3_000_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/).nullable(), at: z.number().finite() }).parse(data);
    engine.questionFrame(frame);
  });
  bind('transcribe', async data => {
    const audio = z.object({ wav: z.string().max(4_000_000).regex(/^data:audio\/wav;base64,[A-Za-z0-9+/=]+$/), seconds: z.number().positive().max(31) }).parse(data);
    await engine.transcribe(audio.wav, audio.seconds);
  });
  bind('audio', async data => {
    const text = z.object({ text: z.string().min(1).max(400) }).parse(data).text;
    return engine.audioFor(text);
  });
  bind('voices', () => engine.voices());
  bind('import-memes', async () => {
    const result = await dialog.showOpenDialog(win, { title: '导入 Markdown 梗库', properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled || !result.filePaths[0]) return;
    if (fs.statSync(result.filePaths[0]).size > 200_000) throw new Error('梗库文件不得超过 200 KB');
    const memes = parseMemeMarkdown(fs.readFileSync(result.filePaths[0], 'utf8'));
    if (!memes.length) throw new Error('未找到有效梗，请使用“## 选手: ID”标题和“- 短句”格式');
    engine.importMemes(memes);
  });
  bind('open-data', () => shell.openPath(storage.root));
  bind('open-url', data => {
    const url = z.string().url().max(2000).parse(data), protocol = new URL(url).protocol;
    if (!['https:', 'http:'].includes(protocol)) throw new Error('只允许打开网页链接');
    return shell.openExternal(url);
  });
  bind('export-diagnostics', async () => {
    const result = await dialog.showSaveDialog(win, { title: '导出测试记录', defaultPath: 'watchmate-diagnostics.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return;
    fs.writeFileSync(result.filePath, JSON.stringify({
      exportedAt: new Date().toISOString(), version: app.getVersion(), mode: engine.state.mode,
      metrics: engine.state.metrics, usage: engine.state.usage,
      broadcast: engine.state.broadcast?{layout:engine.state.broadcast.layout,elapsedMs:engine.state.broadcast.elapsedMs,status:engine.state.broadcast.status,recognizedChampions:engine.state.broadcast.players.filter(p=>p.championId).length}:null,
      local: { frames: engine.state.localFrames, lastRecognitionMs: engine.state.localLatencyMs, armed: engine.state.localArmed, status: engine.state.localStatus, calibratedSlots: engine.state.localProfile?.portraits.map(p => p.slot) ?? [] },
      events: engine.state.messages.map(m => ({ kind: m.kind, at: m.at, game: m.game, gameSeconds: m.gameSeconds, source: m.source, targets: m.targets, speechStatus: m.speechStatus, latencyMs: m.latencyMs })),
    }, null, 2));
  });
  if (process.env.WATCHMATE_DEV_URL === 'http://127.0.0.1:5173') await win.loadURL(process.env.WATCHMATE_DEV_URL);
  else await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}
app.whenReady().then(main);
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => engine?.dispose());
