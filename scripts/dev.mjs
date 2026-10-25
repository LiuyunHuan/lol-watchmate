import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
await import('./prepare-ocr.mjs');
await import('./build-electron.mjs');
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' });
let ready = false;
for (let i = 0; i < 100; i++) {
  try { if ((await fetch('http://127.0.0.1:5173')).ok) { ready = true; break; } } catch {}
  await new Promise(r => setTimeout(r, 150));
}
if (!ready) { vite.kill(); throw new Error('Vite 未启动'); }
const env = { ...process.env, WATCHMATE_DEV_URL: 'http://127.0.0.1:5173' };
delete env.ELECTRON_RUN_AS_NODE;
const desktop = spawn(require('electron'), ['.'], { stdio: 'inherit', env });
desktop.on('exit', () => { vite.kill(); process.exit(); });
process.on('SIGINT', () => { desktop.kill(); vite.kill(); process.exit(); });
