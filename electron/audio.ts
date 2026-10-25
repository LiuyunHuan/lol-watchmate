import { spawn, ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class AudioCache {
  private pending = new Map<string, Promise<string>>();
  private processes = new Set<ChildProcess>();
  constructor(private root: string, private script: string) {}
  abort() { for (const p of this.processes) p.kill(); this.processes.clear(); }
  private run(request: object): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.script], { windowsHide: true, stdio: 'pipe' });
      this.processes.add(child);
      const timer = setTimeout(() => child.kill(), 30000);
      let output = '', failed = false;
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (part: string) => {
        output += part;
        if (output.length > 10_000_000) { failed = true; child.kill(); }
      });
      child.stderr!.resume();
      child.on('error', () => { clearTimeout(timer); this.processes.delete(child); reject(new Error('Windows 本地语音不可用')); });
      child.on('close', code => {
        clearTimeout(timer); this.processes.delete(child);
        if (code === 0 && !failed) resolve(output.trim().replace(/^\uFEFF/, ''));
        else reject(new Error('本地语音生成失败：请在 Windows 语言设置中安装中文语音包，或检查已选音色'));
      });
      child.stdin!.on('error', () => {});
      child.stdin!.end(JSON.stringify(request));
    });
  }
  async voices(): Promise<{ name: string; culture: string }[]> {
    return JSON.parse(await this.run({ mode: 'voices' }));
  }
  async audio(text: string, voice: string, rate: number): Promise<string> {
    const safe = text.slice(0, 400);
    const hash = createHash('sha256').update(JSON.stringify([safe, voice, rate])).digest('hex');
    const file = path.join(this.root, `${hash}.wav`);
    if (fs.existsSync(file)) return `data:audio/wav;base64,${fs.readFileSync(file).toString('base64')}`;
    if (this.pending.has(hash)) return this.pending.get(hash)!;
    const task = this.run({ mode: 'speak', text: safe, voice, rate }).then(raw => {
      const bytes = Buffer.from(raw, 'base64');
      if (bytes.toString('ascii', 0, 4) !== 'RIFF') throw new Error('本地语音格式异常');
      fs.writeFileSync(file, bytes);
      return `data:audio/wav;base64,${raw}`;
    }).finally(() => this.pending.delete(hash));
    this.pending.set(hash, task);
    return task;
  }
}
