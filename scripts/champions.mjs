import fs from 'node:fs/promises';
import path from 'node:path';
// Riot's versioned Data Dragon is the canonical ID/name/art source (no API key).
const version = process.argv[2] || '16.21.1';
if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Expected a Data Dragon version such as 16.21.1');
const root = path.resolve('public/champions');
await fs.mkdir(root, { recursive: true });
const previous=await fs.readFile(path.join(root,'manifest.json'),'utf8').then(JSON.parse).catch(()=>null);
async function download(url, file, reuse=true) {
  if(reuse)try { await fs.access(file); return; } catch {}
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(40000) });
      if (!response.ok) throw Error(`${response.status} ${url}`);
      await fs.writeFile(file, Buffer.from(await response.arrayBuffer())); return;
    } catch (e) { if (attempt === 2) throw e; }
  }
}
await download(`https://ddragon.leagueoflegends.com/cdn/${version}/data/zh_CN/champion.json`, path.join(root, `${version}.json`));
const data = JSON.parse(await fs.readFile(path.join(root, `${version}.json`), 'utf8'));
const champions = Object.values(data.data).map(c => ({ id: c.id, key: c.key, name: c.name, title: c.title }));
let next = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < champions.length) {
    const c = champions[next++];
    await download(`https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${c.id}.png`, path.join(root, `${c.id}.png`),previous?.version===version);
    await download(`https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${c.id}_0.jpg`, path.join(root, `${c.id}.jpg`),previous?.version===version);
  }
}));
await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ version, source: 'https://developer.riotgames.com/docs/lol#data-dragon', champions }, null, 2));
console.log(`Cached ${champions.length} champion icons, portraits and Chinese names (${version}).`);
