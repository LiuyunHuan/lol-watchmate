// Private regression fixtures only; never exports application settings or keys.
// Run from the repository root. `--verify` checks the prepared manifest.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const target = path.resolve(process.env.WATCHMATE_FIXTURES || 'artifacts/handoff-fixtures');
const manifestFile = path.join(target, 'manifest.json');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const ids = {
  newscore: '2188f6e9-ab38-42ef-b5c4-da6cca353f66',
  scoreboard: '27e04215-37f8-4165-89e2-8b14aed8d70c',
  compact: '0548554c-d6ac-468d-bd07-8ecf6f73d6b6',
  bpfull: '3402eac5-e245-48dc-bb45-8c90a284062e',
  scene: '71e703b6-62b5-40e4-9943-e6868cbb57d3',
  scoreboard2: '22fbf03a-4559-4121-bb40-481f4fcbd734',
  compact2: 'dccc2be1-c7b5-4288-a22c-c41cddfcdd66',
};
if (process.argv.includes('--verify')) {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const expected = [...Object.keys(ids), 'observed1', 'observed2', 'observed3', 'observed4'].map(n => n + '.png');
  if (manifest.files.length !== expected.length || new Set(manifest.files.map(f => f.name)).size !== expected.length)
    throw new Error('Expected exactly 11 distinct fixtures');
  for (const file of manifest.files) {
    if (!expected.includes(file.name)) throw new Error('Unexpected fixture name');
    const bytes = fs.readFileSync(path.join(target, file.name));
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new Error('Fixture mismatch: ' + file.name);
  }
  console.log(`Verified 11 fixtures: ${target}`);
} else {
  // Read every source before writing, so a missing original cannot yield a partial export.
  const entries = Object.entries(ids).map(([name, id]) => ({ name: name + '.png',
    origin: 'user-attachment:' + id,
    source: path.join(process.env.LOCALAPPDATA || '', 'Temp', 'codex-clipboard-' + id + '.png') }));
  for (let i = 1; i <= 4; i++) entries.push({ name: `observed${i}.png`,
    origin: `browser-observation:${i}`, source: `artifacts/replay-observed-0${i}.png` });
  const prepared = entries.map(e => ({ ...e, bytes: fs.readFileSync(e.source) }));
  fs.mkdirSync(target, { recursive: true });
  for (const e of prepared) {
    const dest = path.join(target, e.name);
    if (fs.existsSync(dest) && digest(fs.readFileSync(dest)) !== digest(e.bytes))
      throw new Error('Refusing to replace a different fixture: ' + dest);
  }
  for (const e of prepared) fs.writeFileSync(path.join(target, e.name), e.bytes);
  fs.writeFileSync(manifestFile, JSON.stringify({ schemaVersion: 1, preparedAt: new Date().toISOString(),
    note: 'Private test material; not a public asset license. Truth: tests/fixtures/broadcast-truth.json. Some images were used for glyph training.',
    files: prepared.map(e => ({ name: e.name, origin: e.origin, bytes: e.bytes.length, sha256: digest(e.bytes) })) }, null, 2) + '\n');
  console.log(`Prepared 11 fixtures: ${target}`);
}
