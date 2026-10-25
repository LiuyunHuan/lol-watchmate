import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Settings, settingsSchema, Match, Message, Meme, UsageRecord } from '../src/shared/types';

export class Storage {
  constructor(public root: string) {
    for (const name of ['', 'series', 'audio']) fs.mkdirSync(path.join(root, name), { recursive: true });
  }
  read<T>(name: string, fallback: T): T {
    try { return JSON.parse(fs.readFileSync(path.join(this.root, name), 'utf8')); } catch { return fallback; }
  }
  write(name: string, data: unknown) {
    this.atomic(path.join(this.root, name), JSON.stringify(data, null, 2));
  }
  atomic(file: string, value: string) {
    const temp = `${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, value, 'utf8'); fs.renameSync(temp, file);
  }
  saveMemory(seriesId: string, text: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(seriesId)) throw new Error('无效系列赛 ID');
    this.atomic(path.join(this.root, 'series', `${seriesId}.md`), text);
  }
  readMemory(seriesId: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(seriesId)) return '';
    try { return fs.readFileSync(path.join(this.root, 'series', `${seriesId}.md`), 'utf8'); } catch { return ''; }
  }
  saveSettings(settings: Settings, encrypt: (s: string) => string) {
    this.write('settings.json', {
      ...settings, apiKey: settings.apiKey ? encrypt(settings.apiKey) : '',
      searchKey: settings.searchKey ? encrypt(settings.searchKey) : '', encrypted: true,
    });
  }
  loadSettings(decrypt: (s: string) => string): Settings {
    const raw = this.read<any>('settings.json', {});
    try {
      // A stale legacy search credential must not discard the working model credential.
      let searchKey = ''; try { searchKey = raw.searchKey ? decrypt(raw.searchKey) : ''; } catch {}
      return settingsSchema.parse({ ...raw, capturePolicyVersion: 2,
        captureIntervalMs: raw.capturePolicyVersion === 2 ? raw.captureIntervalMs : 10000,
        apiKey: raw.apiKey ? decrypt(raw.apiKey) : '', searchKey });
    } catch { return settingsSchema.parse({}); }
  }
}
